// Máquinas donde se ejecutan los agentes: la local (si el servidor corre en la PC)
// o agentes de campo remotos (worker.js) conectados por SSE saliente + POST.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DATA, now, all, one, run, insert, update, bus, emit, log, setting } = require('./db');
const H = require('./hostops');
const pc = require('./pc');

const LOCAL_EXEC = process.env.OFICINA_LOCAL_EXEC !== '0';
const deployCfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'worker.json'), 'utf8')).deploy; } catch { return null; } })(); // mismo "deploy" que el agente de campo
const local = H.create({ dataDir: DATA, strict: false, cantina: process.env.OFICINA_CANTINA ?? (process.platform === 'win32' ? 'D:/cantina' : ''), deploy: deployCfg });
const PUBLIC_URL = (process.env.OFICINA_PUBLIC_URL || `http://127.0.0.1:${process.env.OFICINA_PORT || 4242}`).replace(/\/$/, '');

if (LOCAL_EXEC && !one('select 1 from machines where is_local=1'))
  insert('machines', { name: os.hostname() + ' (este servidor)', is_local: 1, created_at: now() });

const conns = new Map();       // machineId → {send, close}
const pending = new Map();     // callId → {resolve, reject, timer, mid}
const runHandlers = new Map(); // runId → {mid, onEvent}

const machine = id => one('select * from machines where id=? and deleted_at is null', id);
const machines = (kind = 'worker') => all("select * from machines where deleted_at is null and coalesce(kind,'worker')=? order by id", kind);
function defaultMachine() {
  const d = setting('default_machine', null);
  const dm = d ? machine(d) : null;
  if (dm && (dm.kind || 'worker') === 'worker') return d;
  return (LOCAL_EXEC && one("select id from machines where is_local=1 and deleted_at is null and coalesce(kind,'worker')='worker'")?.id) || machines()[0]?.id || null;
}
const online = id => { const m = machine(id); return !!m && (m.is_local ? LOCAL_EXEC : conns.has(id)); };
const attachmentFile = id => { const a = one('select * from attachments where id=?', id); return path.join(DATA, 'attachments', a.stored); };

function rpc(mid, op, args, ms = 120000) {
  const c = conns.get(mid);
  if (!c) return Promise.reject(new Error(`La máquina "${machine(mid)?.name || mid}" no está conectada`));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, mid, timer: setTimeout(() => { pending.delete(id); reject(new Error(`La máquina no respondió a tiempo (${op})`)); }, ms) });
    c.send('call', { id, op, args });
  });
}

// Ejecuta una operación en la máquina indicada (o la por defecto)
async function call(mid, op, args = {}) {
  mid ||= defaultMachine();
  const m = machine(mid);
  if (!m) throw new Error('No hay ninguna máquina configurada para ejecutar. Conecta un agente de campo (Configuración → Máquinas).');
  if (m.is_local) {
    if (!LOCAL_EXEC) throw new Error('Este servidor no ejecuta agentes localmente');
    if (op === 'putFiles') return local.ops.putFiles(args, f => fs.readFileSync(attachmentFile(f.id)));
    return local.ops[op](args);
  }
  const ms = op === 'convertDocs' || op === 'deploy' ? 1800000
    : op === 'zer0.ask' ? 600000
    : ['detectModels', 'merge', 'push', 'repoStatus'].includes(op) ? 180000
    : ['zer0.status', 'zer0.stop', 'zer0.session.start', 'zer0.session.stop', 'zer0.approve'].includes(op) ? 30000
    : 120000;
  return rpc(mid, op, args, ms);
}

// Lanza un proceso de agente; los eventos llegan a onEvent (local directo o remoto vía /api/worker/events)
async function spawnRun(mid, spec, onEvent) {
  const m = machine(mid);
  runHandlers.set(spec.runId, { mid, onEvent });
  const wrapped = ev => { if (ev.t === 'exit') runHandlers.delete(spec.runId); onEvent(ev); };
  runHandlers.get(spec.runId).onEvent = wrapped;
  try {
    if (m.is_local) return local.spawnRun(spec, wrapped);
    return await rpc(mid, 'spawnRun', spec);
  } catch (e) { runHandlers.delete(spec.runId); throw e; }
}
const runOp = (runId, op, extra = {}) => { const r = runHandlers.get(runId); return r ? call(r.mid, op, { runId, ...extra }).catch(() => false) : Promise.resolve(false); };

// notificación sin pestañas abiertas → toast de Windows en las máquinas conectadas
bus.on('toast', ({ title, body, link }) => {
  for (const m of machines()) if (online(m.id)) call(m.id, 'toast', { title, body, url: PUBLIC_URL + '/' + (link || '') }).catch(() => {});
});

// ---------- agentes de campo ----------
const sha = s => crypto.createHash('sha256').update(s).digest();
function createMachine(name, userId, kind = 'worker') {
  const secret = crypto.randomBytes(32).toString('base64url');
  const id = insert('machines', { name, is_local: 0, kind, token_hash: sha(secret).toString('hex'), created_by: userId, created_at: now() });
  log(userId, 'maquina', id, 'crear', { name, kind });
  return { id, token: `${id}.${secret}` };
}
function authWorker(req) {
  const m = /^Bearer (\d+)\.([\w-]+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const row = machine(+m[1]);
  if (!row || row.is_local || !row.token_hash) return null;
  const a = sha(m[2]), b = Buffer.from(row.token_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? row : null;
}
// El worker se presenta: info + procesos vivos; los que el servidor creía activos y ya no existen se cierran
function hello(m, info) {
  update('machines', m.id, { info: JSON.stringify(info), last_seen: now() });
  const alive = new Set(info.runs || []);
  for (const [runId, r] of runHandlers) if (r.mid === m.id && !alive.has(runId))
    r.onEvent({ t: 'exit', code: -1, error: 'La máquina se reinició o desconectó y el proceso del agente ya no existe' });
  return { ok: true, server_time: now() };
}
function attachStream(m, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  conns.get(m.id)?.close();
  const conn = { send, close: () => res.end() };
  conns.set(m.id, conn);
  send('ready', { id: m.id });
  const hb = setInterval(() => { res.write(': ping\n\n'); update('machines', m.id, { last_seen: now() }); }, 20000);
  update('machines', m.id, { last_seen: now() });
  log(null, 'maquina', m.id, 'conectada');
  emit('machine.status', { id: m.id, online: true });
  bus.emit('machine.online', m.id);
  req.on('close', () => {
    clearInterval(hb);
    if (conns.get(m.id) === conn) {
      conns.delete(m.id);
      for (const [id, p] of pending) if (p.mid === m.id) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error('La máquina se desconectó')); }
      log(null, 'maquina', m.id, 'desconectada');
      emit('machine.status', { id: m.id, online: false });
      pc.stopSession(m.id, 'PC desconectado');
    }
  });
}
function reply(m, { id, ok, result, error }) {
  const p = pending.get(id);
  if (!p || p.mid !== m.id) return;
  clearTimeout(p.timer); pending.delete(id);
  ok ? p.resolve(result) : p.reject(new Error(error || 'Error en la máquina'));
}
function events(m, list = []) {
  update('machines', m.id, { last_seen: now() });
  for (const ev of list) {
    const r = runHandlers.get(ev.runId);
    if (!r || r.mid !== m.id) continue;
    if (ev.seq != null) { if (ev.seq <= (r.seq || 0)) continue; r.seq = ev.seq; } // lote reenviado tras perder la respuesta
    r.onEvent(ev);
  }
}
function machineList(kind = 'worker') {
  return machines(kind).map(m => ({ id: m.id, name: m.name, kind: m.kind || 'worker', is_local: !!m.is_local, online: online(m.id), last_seen: m.last_seen, info: m.info ? JSON.parse(m.info) : null,
    is_default: m.id === defaultMachine(), running: [...runHandlers.values()].filter(r => r.mid === m.id).length }));
}

module.exports = { LOCAL_EXEC, PUBLIC_URL, local, call, spawnRun, runOp, online, machine, machines, machineList, defaultMachine, createMachine, authWorker, hello, attachStream, reply, events, attachmentFile };
