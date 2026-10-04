// pc.js — Gestión de sesiones en memoria, frames y validación de eventos para zer0
// ponytail: sesiones y frames residen solo en memoria (Map); la persistencia en disco está expresamente prohibida.
const crypto = require('node:crypto');
const { emit, now } = require('./db');

class HttpError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}
const need = (cond, msg, code = 400) => {
  if (!cond) throw new HttpError(code, msg);
};

const getTtlMs = () => Number(process.env.OFICINA_PC_FRAME_TTL_MS || 600000);

const VALID_EVENT_TYPES = new Set([
  'session.started',
  'step.captured',
  'step.proposal',
  'step.approved',
  'step.rejected',
  'step.expired',
  'step.result',
  'session.done'
]);

// mid -> sess
const sessions = new Map();
// mid -> 'ask' | 'session' (exclusión mutua y una sola operación activa)
const busyLocks = new Map();
// mid -> Array<number> (timestamps de eventos en el último segundo)
const rateLimits = new Map();

function isBusy(mid) {
  if (busyLocks.has(mid)) return true;
  const sess = sessions.get(mid);
  return !!sess && sess.state === 'active';
}

function acquire(mid, type) {
  if (isBusy(mid)) return false;
  busyLocks.set(mid, type);
  return true;
}

function release(mid, type) {
  if (type) {
    if (busyLocks.get(mid) === type) busyLocks.delete(mid);
  } else {
    busyLocks.delete(mid);
  }
}

function scheduleFrameEviction(sess) {
  if (sess.evictTimer) clearTimeout(sess.evictTimer);
  const ttl = getTtlMs();
  sess.evictTimer = setTimeout(() => {
    sess.frames.clear();
    sess.evictTimer = null;
  }, ttl);
  if (sess.evictTimer.unref) sess.evictTimer.unref();
}

function startSession(mid, userId, sessionId) {
  const prev = sessions.get(mid);
  if (prev?.evictTimer) clearTimeout(prev.evictTimer);

  const sess = {
    id: sessionId,
    mid,
    state: 'active',
    userId,
    startedAt: now(),
    events: [],
    frames: new Map(), // frameId -> Buffer (máx. 20)
    lastSeq: null,
    stopReason: null,
    doneReason: null,
    evictTimer: null
  };
  sessions.set(mid, sess);
  return sess;
}

function clearSession(mid, prev = null) {
  const sess = sessions.get(mid);
  if (sess?.evictTimer) clearTimeout(sess.evictTimer);
  if (prev) sessions.set(mid, prev);
  else sessions.delete(mid);
  busyLocks.delete(mid);
}

function stopSession(mid, reason = 'detenida') {
  busyLocks.delete(mid);
  const sess = sessions.get(mid);
  if (!sess) return;
  if (sess.state === 'active') {
    sess.state = 'stopped';
    sess.stopReason = reason;
    scheduleFrameEviction(sess);
  }
}

function getSession(mid) {
  const sess = sessions.get(mid);
  if (!sess) return null;
  return {
    id: sess.id,
    state: sess.state,
    reason: sess.stopReason || sess.doneReason || null,
    events: sess.events.map(e => ({
      seq: e.seq,
      type: e.type,
      data: e.data,
      frameId: e.frameId ?? null
    }))
  };
}

function frame(mid, frameId) {
  const sess = sessions.get(mid);
  if (!sess) return null;
  return sess.frames.get(frameId) || null;
}

function ingest(machine, body) {
  need(machine && machine.id, 'Máquina inválida', 401);
  const mid = machine.id;

  // 1. Rate limit: 5 ev/s por máquina
  const nowTs = Date.now();
  const recent = (rateLimits.get(mid) || []).filter(t => t > nowTs - 1000);
  if (recent.length >= 5) {
    throw new HttpError(429, 'Demasiados eventos (máx. 5 por segundo)');
  }
  recent.push(nowTs);
  rateLimits.set(mid, recent);

  need(body && typeof body === 'object', 'Cuerpo inválido', 400);

  // 2. Validación de propiedad de sesión entre máquinas
  for (const [otherMid, otherSess] of sessions) {
    if (otherMid !== mid && otherSess && otherSess.id === body.sessionId) {
      throw new HttpError(403, 'No autorizado: la sesión pertenece a otra máquina');
    }
  }

  // 3. Sesión activa de ESTA máquina
  const sess = sessions.get(mid);
  need(sess && sess.id === body.sessionId, 'Sesión no encontrada o ID inválido', 400);
  need(sess.state === 'active', 'La sesión no está activa', 400);

  // 4. Seq entero y estrictamente creciente
  need(Number.isInteger(body.seq), 'seq debe ser un entero', 400);
  need(sess.lastSeq == null || body.seq > sess.lastSeq, 'seq debe ser creciente', 400);

  // 5. Tipo de evento válido
  need(VALID_EVENT_TYPES.has(body.type), 'Tipo de evento inválido: ' + body.type, 400);

  // 6. data: objeto <= 8 KB
  if (body.data !== undefined && body.data !== null) {
    need(typeof body.data === 'object' && !Array.isArray(body.data), 'data debe ser un objeto', 400);
    const dataStr = JSON.stringify(body.data);
    need(Buffer.byteLength(dataStr, 'utf8') <= 8192, 'data excede 8 KB', 400);
  }

  // 7. Validación de frame (opcional)
  let frameId = null;
  if (body.frame !== undefined && body.frame !== null) {
    need(typeof body.frame === 'object' && !Array.isArray(body.frame), 'frame debe ser un objeto', 400);
    need(typeof body.frame.jpegB64 === 'string', 'jpegB64 requerido', 400);
    need(Number.isInteger(body.frame.width) && body.frame.width > 0 && body.frame.width <= 4000, 'width inválido (1..4000)', 400);
    need(Number.isInteger(body.frame.height) && body.frame.height > 0 && body.frame.height <= 4000, 'height inválido (1..4000)', 400);

    const b64 = body.frame.jpegB64.trim();
    need(b64.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b64.replace(/\s+/g, '')), 'base64 inválido', 400);

    const buf = Buffer.from(b64, 'base64');
    need(buf.length <= 400 * 1024, 'Frame excede 400 KB', 400);
    need(buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8, 'Cabecera JPEG inválida (se esperaba FF D8)', 400);

    frameId = crypto.randomUUID();
    sess.frames.set(frameId, buf);
    // Tope 20 frames por PC: se descarta el más antiguo
    if (sess.frames.size > 20) {
      const oldest = sess.frames.keys().next().value;
      sess.frames.delete(oldest);
    }
  }

  // Evento aceptado: actualizamos lastSeq
  sess.lastSeq = body.seq;

  // Tope 200 eventos por sesión: se descarta el más antiguo
  sess.events.push({
    seq: body.seq,
    type: body.type,
    data: body.data || {},
    frameId
  });
  if (sess.events.length > 200) {
    sess.events.shift();
  }

  // Si la sesión terminó normalmente
  if (body.type === 'session.done') {
    sess.state = 'done';
    sess.doneReason = body.data?.reason || 'completed';
    scheduleFrameEviction(sess);
    busyLocks.delete(mid);
  }

  // SSE global existente SIN datos ni imágenes: solo {machine, sessionId, seq, type}
  emit('pc.event', { machine: mid, sessionId: sess.id, seq: body.seq, type: body.type });

  return { ok: true };
}

module.exports = {
  isBusy,
  acquire,
  release,
  startSession,
  clearSession,
  stopSession,
  getSession,
  frame,
  ingest
};
