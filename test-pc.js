// Pruebas de integración de zer0 en Oficina Virtual. Uso: node --no-warnings test-pc.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-test-pc-'));
process.env.OFICINA_DATA = path.join(TMP, 'data');
process.env.OFICINA_NO_TOAST = '1';
process.env.OFICINA_KILL_GRACE_MS = '400';
process.env.OFICINA_CANTINA = path.join(TMP, 'cantina');
const PORT = 4300 + Math.floor(Math.random() * 500);
process.env.OFICINA_PORT = String(PORT);

const { startServer } = require('./server');
const { one, all, insert, update, bus } = require('./db');

let cookie = '';
async function api(method, url, body, raw) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
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

  } catch (e) {
    failed++;
    console.error('✘ error fatal en la suite', e.stack || e);
  } finally {
    if (server) server.close();
    console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK');
    process.exit(failed ? 1 : 0);
  }
})();
