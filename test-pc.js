// Pruebas de integración de zer0 en Oficina Virtual. Uso: node --no-warnings test-pc.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-test-pc-'));
process.env.OFICINA_DATA = path.join(TMP, 'data');
process.env.OFICINA_NO_TOAST = '1';
process.env.OFICINA_KILL_GRACE_MS = '400';
process.env.OFICINA_CANTINA = path.join(TMP, 'cantina');
process.env.OFICINA_PC_FRAME_TTL_MS = '300';
const PORT = 4300 + Math.floor(Math.random() * 500);
process.env.OFICINA_PORT = String(PORT);

const { startServer } = require('./server');
const { one, all, insert, update, bus } = require('./db');

let cookie = '';
async function api(method, url, body, raw) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const j = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(j?.error || res.status); e.status = res.status; throw e; }
  return j;
}

async function loginUser(username, password) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const sc = res.headers.get('set-cookie');
  assert.ok(sc, 'debe devolver cookie');
  return sc.split(';')[0];
}

async function apiAs(userCookie, method, url, body, raw) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  const j = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(j?.error || res.status); e.status = res.status; throw e; }
  return j;
}

const rejects = async (p, re) => { try { await p; } catch (e) { if (re) assert.match(e.message, re); return e; } assert.fail('se esperaba error'); };
async function until(fn, ms = 15000, msg = 'condición') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); }
  assert.fail('timeout esperando ' + msg);
}

const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0xff, 0xd9
]);

function fakeZer0(token, handler) {
  return new Promise(async (resolve, reject) => {
    try {
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const helloRes = await fetch(`http://127.0.0.1:${PORT}/api/worker/hello`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ kind: 'zer0', host: 'test-fake', version: '1', runs: [] })
      });
      assert.equal(helloRes.status, 200);

      const u = new URL(`http://127.0.0.1:${PORT}/api/worker/stream`);
      const req = http.request(u, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      }, res => {
        let buf = '';
        res.on('data', chunk => {
          buf += chunk.toString('utf8');
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const block of parts) {
            let event = '', data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              if (line.startsWith('data: ')) data = line.slice(6).trim();
            }
            if (event === 'ready') {
              resolve({
                close: () => {
                  try { req.destroy(); } catch {}
                },
                ev: async (body) => {
                  return fetch(`http://127.0.0.1:${PORT}/api/worker/pc-event`, {
                    method: 'POST',
                    headers: h,
                    body: JSON.stringify(body)
                  });
                }
              });
            } else if (event === 'call' && data) {
              const { id, op, args } = JSON.parse(data);
              Promise.resolve()
                .then(() => handler(op, args))
                .then(result => {
                  return fetch(`http://127.0.0.1:${PORT}/api/worker/reply`, {
                    method: 'POST',
                    headers: h,
                    body: JSON.stringify({ id, ok: true, result })
                  });
                })
                .catch(err => {
                  return fetch(`http://127.0.0.1:${PORT}/api/worker/reply`, {
                    method: 'POST',
                    headers: h,
                    body: JSON.stringify({ id, ok: false, error: err.message })
                  });
                });
            }
          }
        });
      });
      req.on('error', () => {});
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

(async () => {
  let server = null;
  let failed = 0;
  const t = async (name, fn) => { try { await fn(); console.log('✔', name); } catch (e) { failed++; console.error('✘', name, '\n  ', e.stack || e); } };
  try {
    server = await startServer(PORT);
    assert.equal((await api('GET', '/api/setup')).needed, true);
    await api('POST', '/api/setup', { username: 'vader', password: 'secreto1', name: 'Darth' });

    await t('máquina zer0: no es la máquina por defecto ni ejecutor', async () => {
      const w = await api('POST', '/api/machines', { name: 'PC-worker' });
      const z = await api('POST', '/api/machines', { name: 'zer0-pc', kind: 'zer0' });
      assert.match(z.token, /^\d+\.[\w-]+$/);
      assert.equal(require('./db').one('select kind from machines where id=?', z.id).kind, 'zer0');
      const host = require('./host');
      assert.ok(!host.machines().some(m => m.id === z.id));
      assert.ok(host.machines('zer0').some(m => m.id === z.id));
      assert.notEqual(host.defaultMachine(), z.id);
      assert.ok(!(await api('GET', '/api/machines')).some(m => m.id === z.id));
    });

    await t('token zer0: solo hello/stream/reply/pc-event', async () => {
      const z = await api('POST', '/api/machines', { name: 'zer0-b', kind: 'zer0' });
      const h = { Authorization: `Bearer ${z.token}` };
      const u = p => `http://127.0.0.1:${PORT}/api/worker/${p}`;
      assert.equal((await fetch(u('hello'), { method: 'POST', headers: h, body: '{}' })).status, 200);
      assert.equal((await fetch(u('attachments/1'), { headers: h })).status, 403);
      assert.equal((await fetch(u('events'), { method: 'POST', headers: h, body: '{"events":[]}' })).status, 403);
    });

    // ---------- Casos de la Tarea 2 (a - l) ----------

    await t('caso a: GET /api/pc lista la máquina online:true', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-a', kind: 'zer0' });
      const fz = await fakeZer0(z.token, () => ({ ok: true }));
      try {
        const pcs = await api('GET', '/api/pc');
        const found = pcs.find(m => m.id === z.id);
        assert.ok(found, 'debe listar la máquina zer0');
        assert.equal(found.online, true);
        assert.equal(found.name, 'PC-a');
        assert.equal(found.kind, 'zer0');
      } finally {
        fz.close();
      }
    });

    await t('caso b: ask admin ok y el handler recibe solo {text, includeScreen} (el motor lo define zer0)', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-b', kind: 'zer0' });
      let receivedOp = null, receivedArgs = null;
      const fz = await fakeZer0(z.token, (op, args) => {
        receivedOp = op;
        receivedArgs = args;
        return { ok: true, message: 'respuesta' };
      });
      try {
        const res = await api('POST', `/api/pc/${z.id}/ask`, {
          text: 'haz una captura',
          engine: 'claude',
          model: 'claude-3-5-sonnet',
          includeScreen: true
        });
        assert.equal(receivedOp, 'zer0.ask');
        assert.deepEqual(receivedArgs, { text: 'haz una captura', includeScreen: true });
        assert.equal(res.ok, true);
      } finally {
        fz.close();
      }
    });

    await t('ventana: la web abre el control por tiempo limitado y valida minutos', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-win', kind: 'zer0' });
      let got = null;
      const fz = await fakeZer0(z.token, (op, args) => {
        if (op === 'zer0.window.open') { got = args; return args.minutes === 99 ? { ok: false, message: 'Esta app no permite que la oficina habilite el control.' } : { ok: true, payload: { enabled: true } }; }
        return { ok: true };
      });
      try {
        const r1 = await api('POST', `/api/pc/${z.id}/window`, { minutes: 60, autoApproval: true });
        assert.deepEqual(got, { minutes: 60, autoApproval: true });
        assert.equal(r1.enabled, true);
        await api('POST', `/api/pc/${z.id}/window`, { minutes: 30 });
        assert.deepEqual(got, { minutes: 30, autoApproval: false });
        for (const bad of [{ minutes: 4 }, { minutes: 721 }, { minutes: 'x' }, { minutes: 60, extra: 1 }, { minutes: 60, autoApproval: 'si' }, {}])
          assert.equal((await api('POST', `/api/pc/${z.id}/window`, bad, true)).status, 400, JSON.stringify(bad));
        assert.equal((await api('POST', `/api/pc/${z.id}/window`, { minutes: 99 }, true)).status, 422);
      } finally { fz.close(); }
    });

    await t('caso c: operador/observador permisos exactos', async () => {
      await api('POST', '/api/users', { username: 'operador1', password: 'password1', role: 'operador' });
      await api('POST', '/api/users', { username: 'observador1', password: 'password1', role: 'observador' });
      const opCookie = await loginUser('operador1', 'password1');
      const obsCookie = await loginUser('observador1', 'password1');

      const z = await api('POST', '/api/machines', { name: 'PC-c', kind: 'zer0' });
      const fz = await fakeZer0(z.token, (op) => {
        if (op === 'zer0.status') return { ok: true, payload: { busy: false, actionsStopped: false, officeControl: { enabled: false, expiresAt: null, sendFrames: false, remoteApproval: false }, session: null } };
        return { ok: true };
      });
      try {
        // observador: solo GET /api/pc
        const obsPc = await apiAs(obsCookie, 'GET', '/api/pc');
        assert.ok(Array.isArray(obsPc));
        assert.equal((await apiAs(obsCookie, 'GET', `/api/pc/${z.id}/status`, null, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'POST', `/api/pc/${z.id}/stop`, {}, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'POST', `/api/pc/${z.id}/ask`, { text: 't', engine: 'claude' }, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'POST', `/api/pc/${z.id}/session`, { instruction: 'i', engine: 'claude' }, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'GET', `/api/pc/${z.id}/session`, null, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'POST', `/api/pc/${z.id}/approve`, { sessionId: 's', stepId: '1', decision: 'approve' }, true)).status, 403);
        assert.equal((await apiAs(obsCookie, 'GET', `/api/pc/${z.id}/frame/f1`, null, true)).status, 403);

        // operador: 200 en status y stop; 403 en ask, session, approve, frame, GET session
        const opStatus = await apiAs(opCookie, 'GET', `/api/pc/${z.id}/status`);
        assert.ok(opStatus);
        const opStop = await apiAs(opCookie, 'POST', `/api/pc/${z.id}/stop`, {});
        assert.ok(opStop);
        assert.equal((await apiAs(opCookie, 'POST', `/api/pc/${z.id}/ask`, { text: 't', engine: 'claude' }, true)).status, 403);
        assert.equal((await apiAs(opCookie, 'POST', `/api/pc/${z.id}/session`, { instruction: 'i', engine: 'claude' }, true)).status, 403);
        assert.equal((await apiAs(opCookie, 'GET', `/api/pc/${z.id}/session`, null, true)).status, 403);
        assert.equal((await apiAs(opCookie, 'POST', `/api/pc/${z.id}/approve`, { sessionId: 's', stepId: '1', decision: 'approve' }, true)).status, 403);
        assert.equal((await apiAs(opCookie, 'GET', `/api/pc/${z.id}/frame/f1`, null, true)).status, 403);
      } finally {
        fz.close();
      }
    });

    await t('caso d: payloads inválidos en ask y session → 400 y handler NO se invoca', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-d', kind: 'zer0' });
      let handlerCalls = 0;
      const fz = await fakeZer0(z.token, () => {
        handlerCalls++;
        return { ok: true };
      });
      try {
        // ask: texto vacío
        assert.equal((await api('POST', `/api/pc/${z.id}/ask`, { text: '', engine: 'claude' }, true)).status, 400);
        // ask: 12001 chars
        assert.equal((await api('POST', `/api/pc/${z.id}/ask`, { text: 'a'.repeat(12001), engine: 'claude' }, true)).status, 400);
        // ask: engine inválido
        assert.equal((await api('POST', `/api/pc/${z.id}/ask`, { text: 'ok', engine: 'x' }, true)).status, 400);
        // ask: campos extra
        assert.equal((await api('POST', `/api/pc/${z.id}/ask`, { text: 'ok', engine: 'claude', extra: true }, true)).status, 400);

        // session: instrucción vacía
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: '', engine: 'claude' }, true)).status, 400);
        // session: 4001 chars
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'a'.repeat(4001), engine: 'claude' }, true)).status, 400);
        // session: engine inválido
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'ok', engine: 'x' }, true)).status, 400);
        // session: maxSteps 11
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'ok', engine: 'claude', maxSteps: 11 }, true)).status, 400);
        // session: campos extra
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'ok', engine: 'claude', extra: 123 }, true)).status, 400);

        assert.equal(handlerCalls, 0, 'handler no debe haber sido llamado');
      } finally {
        fz.close();
      }
    });

    await t('caso e: offline → 409', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-e', kind: 'zer0' });
      assert.equal((await api('GET', `/api/pc/${z.id}/status`, null, true)).status, 409);
      assert.equal((await api('POST', `/api/pc/${z.id}/ask`, { text: 'hola', engine: 'claude' }, true)).status, 409);
      assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'hola', engine: 'claude' }, true)).status, 409);
    });

    await t('caso f: ok:false de zer0 → 422 con su mensaje', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-f', kind: 'zer0' });
      const fz = await fakeZer0(z.token, () => ({ ok: false, message: 'Motor no disponible en el cliente' }));
      try {
        const res = await api('POST', `/api/pc/${z.id}/ask`, { text: 'hola', engine: 'claude' }, true);
        assert.equal(res.status, 422);
        const body = await res.json();
        assert.match(body.error, /Motor no disponible en el cliente/);
      } finally {
        fz.close();
      }
    });

    await t('caso g: un segundo ask o session mientras hay uno en curso → 409 sin invocar al handler', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-g', kind: 'zer0' });
      let handlerCalls = 0;
      let finishFirstAsk;
      const firstAskBarrier = new Promise(r => { finishFirstAsk = r; });

      const fz = await fakeZer0(z.token, async () => {
        handlerCalls++;
        await firstAskBarrier;
        return { ok: true, message: 'terminado' };
      });

      try {
        const p1 = api('POST', `/api/pc/${z.id}/ask`, { text: 'primero', engine: 'claude' });
        await until(() => handlerCalls === 1, 2000, 'primer ask recibido');

        const resAsk = await api('POST', `/api/pc/${z.id}/ask`, { text: 'segundo', engine: 'claude' }, true);
        assert.equal(resAsk.status, 409);

        const resSess = await api('POST', `/api/pc/${z.id}/session`, { instruction: 'sesion', engine: 'claude' }, true);
        assert.equal(resSess.status, 409);

        assert.equal(handlerCalls, 1, 'handler solo debe invocarse una vez');

        finishFirstAsk();
        await p1;
      } finally {
        if (finishFirstAsk) finishFirstAsk();
        fz.close();
      }
    });

    await t('caso h: cliente falso cerrado a mitad de ask → error HTTP limpio y tras reconectar un nuevo ask funciona', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-h', kind: 'zer0' });
      let fz = await fakeZer0(z.token, async () => {
        setTimeout(() => fz.close(), 10);
        await new Promise(() => {});
      });

      const res = await api('POST', `/api/pc/${z.id}/ask`, { text: 'pregunta', engine: 'claude' }, true);
      assert.ok(res.status >= 400 && res.status < 500, `código limpio esperado, recibido ${res.status}`);

      const fz2 = await fakeZer0(z.token, () => ({ ok: true, message: 'segundo ask ok' }));
      try {
        const res2 = await api('POST', `/api/pc/${z.id}/ask`, { text: 'nueva pregunta', engine: 'claude' });
        assert.equal(res2.ok, true);
      } finally {
        fz2.close();
      }
    });

    await t('caso i: flujo de sesión completo, eventos, frame y SSE sin datos ni imagen', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-i', kind: 'zer0' });
      let capturedSessionId = null;
      const fz = await fakeZer0(z.token, (op, args) => {
        if (op === 'zer0.session.start') {
          capturedSessionId = args.sessionId;
          return { ok: true };
        }
        return { ok: true };
      });

      const sseEvents = [];
      const onEv = (ev) => { if (ev.type === 'pc.event') sseEvents.push(ev.data); };
      bus.on('ev', onEv);

      try {
        const sessRes = await api('POST', `/api/pc/${z.id}/session`, {
          instruction: 'haz clic en el boton',
          engine: 'claude',
          maxSteps: 5
        });
        assert.ok(sessRes.sessionId);
        assert.equal(sessRes.sessionId, capturedSessionId);
        const sid = sessRes.sessionId;

        await fz.ev({ sessionId: sid, seq: 1, type: 'session.started', data: {} });
        await fz.ev({
          sessionId: sid,
          seq: 2,
          type: 'step.captured',
          data: { stepId: 'st-1' },
          frame: { jpegB64: TINY_JPEG.toString('base64'), width: 320, height: 240 }
        });
        await fz.ev({
          sessionId: sid,
          seq: 3,
          type: 'step.proposal',
          data: { stepId: 'st-1', tool: 'click', summary: 'clic en guardar' }
        });
        await fz.ev({
          sessionId: sid,
          seq: 4,
          type: 'step.result',
          data: { stepId: 'st-1', ok: true, message: 'clic ejecutado' },
          frame: { jpegB64: TINY_JPEG.toString('base64'), width: 320, height: 240 }
        });
        await fz.ev({
          sessionId: sid,
          seq: 5,
          type: 'session.done',
          data: { reason: 'completed', message: 'tarea finalizada' }
        });

        const sessionData = await api('GET', `/api/pc/${z.id}/session`);
        assert.equal(sessionData.id, sid);
        assert.equal(sessionData.events.length, 5);
        assert.equal(sessionData.events[0].seq, 1);
        assert.equal(sessionData.events[0].type, 'session.started');
        assert.equal(sessionData.events[0].frameId, null);

        const f1 = sessionData.events[1].frameId;
        assert.ok(f1, 'step.captured debe tener frameId');

        const f2 = sessionData.events[3].frameId;
        assert.ok(f2, 'step.result debe tener frameId');

        const frameRes = await api('GET', `/api/pc/${z.id}/frame/${f1}`, null, true);
        assert.equal(frameRes.status, 200);
        assert.equal(frameRes.headers.get('content-type'), 'image/jpeg');
        assert.match(frameRes.headers.get('cache-control') || '', /no-store/);
        const bytes = Buffer.from(await frameRes.arrayBuffer());
        assert.deepEqual(bytes, TINY_JPEG);

        assert.equal(sseEvents.length, 5);
        for (const ev of sseEvents) {
          assert.equal(ev.machine, z.id);
          assert.equal(ev.sessionId, sid);
          assert.ok(ev.seq != null);
          assert.ok(ev.type);
          assert.equal(ev.data, undefined, 'SSE global no debe contener data');
          assert.equal(ev.frame, undefined, 'SSE global no debe contener frame');
        }
      } finally {
        bus.off('ev', onEv);
        fz.close();
      }
    });

    await t('caso j: frames inválidos rechazados (400/403) y rate limit (429)', async () => {
      const z1 = await api('POST', '/api/machines', { name: 'PC-j1', kind: 'zer0' });
      const z2 = await api('POST', '/api/machines', { name: 'PC-j2', kind: 'zer0' });

      let sid1 = null;
      const fz1 = await fakeZer0(z1.token, (op, args) => { if (op === 'zer0.session.start') sid1 = args.sessionId; return { ok: true }; });
      const fz2 = await fakeZer0(z2.token, () => ({ ok: true }));

      try {
        const sRes = await api('POST', `/api/pc/${z1.id}/session`, { instruction: 'test', engine: 'agy' });
        const sid = sRes.sessionId;

        // Frame sin FF D8
        const notJpeg = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
        const r1 = await fz1.ev({ sessionId: sid, seq: 10, type: 'step.captured', frame: { jpegB64: notJpeg, width: 100, height: 100 } });
        assert.equal(r1.status, 400);

        // Frame > 400 KB (401 KB)
        const bigB64 = Buffer.alloc(401 * 1024, 0xff).toString('base64');
        const r2 = await fz1.ev({ sessionId: sid, seq: 11, type: 'step.captured', frame: { jpegB64: bigB64, width: 100, height: 100 } });
        assert.equal(r2.status, 400);

        // sessionId distinto del actual
        const r3 = await fz1.ev({ sessionId: 'otro-uuid', seq: 12, type: 'session.started', data: {} });
        assert.ok(r3.status === 400 || r3.status === 403);

        // Evento enviado por máquina equivocada
        const r4 = await fz2.ev({ sessionId: sid, seq: 13, type: 'session.started', data: {} });
        assert.equal(r4.status, 403);

        const sess = await api('GET', `/api/pc/${z1.id}/session`);
        assert.equal(sess.events.length, 0);

        // Rate limit: más de 5 eventos por segundo -> 429
        let got429 = false;
        for (let seq = 20; seq < 30; seq++) {
          const r = await fz1.ev({ sessionId: sid, seq, type: 'step.proposal', data: { stepId: 's', tool: 't', summary: 's' } });
          if (r.status === 429) got429 = true;
        }
        assert.ok(got429, 'debe devolver 429 tras superar 5 ev/s');
      } finally {
        fz1.close();
        fz2.close();
      }
    });

    await t('caso k: approve reenvía los 3 campos exactos y 422 si zer0 rechaza', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-k', kind: 'zer0' });
      let receivedApprove = null;
      let approveShouldFail = false;
      const fz = await fakeZer0(z.token, (op, args) => {
        if (op === 'zer0.approve') {
          receivedApprove = args;
          if (approveShouldFail) return { ok: false, message: 'Paso ya caducado' };
          return { ok: true, message: 'Aprobado con éxito' };
        }
        return { ok: true };
      });

      try {
        const res = await api('POST', `/api/pc/${z.id}/approve`, {
          sessionId: 'sess-123',
          stepId: 'step-456',
          decision: 'approve'
        });
        assert.deepEqual(receivedApprove, {
          sessionId: 'sess-123',
          stepId: 'step-456',
          decision: 'approve'
        });

        approveShouldFail = true;
        const errRes = await api('POST', `/api/pc/${z.id}/approve`, {
          sessionId: 'sess-123',
          stepId: 'step-456',
          decision: 'reject'
        }, true);
        assert.equal(errRes.status, 422);
        const errBody = await errRes.json();
        assert.match(errBody.error, /Paso ya caducado/);
      } finally {
        fz.close();
      }
    });

    await t('caso l: desconectar cliente falso con sesión activa → stopped y evicción de frames tras TTL', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-l', kind: 'zer0' });
      let sid = null;
      let fz = await fakeZer0(z.token, (op, args) => {
        if (op === 'zer0.session.start') sid = args.sessionId;
        return { ok: true };
      });

      const sRes = await api('POST', `/api/pc/${z.id}/session`, { instruction: 'trabajo', engine: 'codex' });
      sid = sRes.sessionId;

      await fz.ev({
        sessionId: sid,
        seq: 1,
        type: 'step.captured',
        data: {},
        frame: { jpegB64: TINY_JPEG.toString('base64'), width: 100, height: 100 }
      });

      const beforeSess = await api('GET', `/api/pc/${z.id}/session`);
      assert.equal(beforeSess.state, 'active');
      const frameId = beforeSess.events[0].frameId;
      assert.ok(frameId);

      assert.equal((await api('GET', `/api/pc/${z.id}/frame/${frameId}`, null, true)).status, 200);

      fz.close();
      await new Promise(r => setTimeout(r, 60));

      const afterSess = await api('GET', `/api/pc/${z.id}/session`);
      assert.equal(afterSess.state, 'stopped');

      await new Promise(r => setTimeout(r, 400));

      const evictRes = await api('GET', `/api/pc/${z.id}/frame/${frameId}`, null, true);
      assert.equal(evictRes.status, 404);
    });

    await t('aprobación por riesgo: auto/by/askReason/modelRisk llegan intactos a la web', async () => {
      const z = await api('POST', '/api/machines', { name: 'PC-riesgo', kind: 'zer0' });
      const fz = await fakeZer0(z.token, () => ({ ok: true }));
      try {
        const sid = (await api('POST', `/api/pc/${z.id}/session`, { instruction: 'x', engine: 'agy' })).sessionId;
        await fz.ev({ sessionId: sid, seq: 1, type: 'step.proposal', data: { stepId: 'a1', tool: 'click', summary: 'clic', auto: true, modelRisk: 'low' } });
        await new Promise(r => setTimeout(r, 250));
        await fz.ev({ sessionId: sid, seq: 2, type: 'step.approved', data: { stepId: 'a1', by: 'auto' } });
        await new Promise(r => setTimeout(r, 250));
        await fz.ev({ sessionId: sid, seq: 3, type: 'step.proposal', data: { stepId: 'a2', tool: 'type_text', summary: 'escribir', askReason: 'Herramienta type_text requiere aprobación', modelRisk: 'medium' } });
        const ev = (await api('GET', `/api/pc/${z.id}/session`)).events;
        const p1 = ev.find(e => e.seq === 1).data, ap = ev.find(e => e.seq === 2).data, p2 = ev.find(e => e.seq === 3).data;
        assert.equal(p1.auto, true); assert.equal(p1.modelRisk, 'low');
        assert.equal(ap.by, 'auto');
        assert.equal(p2.askReason, 'Herramienta type_text requiere aprobación'); assert.equal(p2.modelRisk, 'medium'); assert.ok(!p2.auto);
        // el estado de la PC expone la auto-aprobacion que informa zer0
      } finally { fz.close(); }
    });

    await t('sesión colgada: el servidor la vence y libera la PC', async () => {
      process.env.OFICINA_PC_SESSION_MAX_MS = '200';
      try {
        const z = await api('POST', '/api/machines', { name: 'PC-m', kind: 'zer0' });
        const fz = await fakeZer0(z.token, () => ({ ok: true }));
        await api('POST', `/api/pc/${z.id}/session`, { instruction: 'x', engine: 'codex' });
        await rejects(api('POST', `/api/pc/${z.id}/session`, { instruction: 'y', engine: 'codex' }), /ocupado/);
        await until(async () => (await api('GET', `/api/pc/${z.id}/session`)).state === 'stopped', 3000, 'sesión vencida');
        assert.equal((await api('POST', `/api/pc/${z.id}/session`, { instruction: 'z', engine: 'codex' })).sessionId.length > 10, true);
        fz.close();
      } finally { delete process.env.OFICINA_PC_SESSION_MAX_MS; }
    });

  } catch (e) {
    failed++;
    console.error('✘ error fatal en la suite', e.stack || e);
  } finally {
    if (server) server.close();
    console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK');
    process.exit(failed ? 1 : 0);
  }
})();
