// Puente de Mando: estado de agentes, límites, trabajo, carpetas y sistema
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA, now, all, one, run, J, insert, update, bus, emit, notify, setting, setSetting } = require('./db');
const R = require('./runner');

const started = Date.now();
const errors = [];            // errores recientes del servidor
const pushError = e => { errors.unshift({ at: now(), msg: String(e?.stack || e).slice(0, 600) }); errors.length = Math.min(errors.length, 30); };
const versions = {};          // agentId → {found, version, at}
let lastScan = null;

const sh = (exe, args, timeout = 20000) => new Promise(res => execFile(exe, args, { timeout, windowsHide: true, encoding: 'utf8' },
  (err, out, errOut) => res({ err, out: (out || '').trim(), errOut: (errOut || '').trim() })));

async function probe(ag) {
  const r = await sh(ag.exe, [...J(ag.pre_args, []), '--version']);
  const found = !(r.err && (r.err.code === 'ENOENT' || /not found|no se encuentra|Cannot find module/i.test(r.errOut)));
  versions[ag.id] = { found, version: found ? (r.out || r.errOut).split(/\r?\n/)[0].slice(0, 80) : null, at: now() };
  return versions[ag.id];
}

// ventanas de consumo medidas por la oficina
const WIN = { '5h': 5 * 3600e3, dia: 86400e3, semana: 7 * 86400e3, mes: 30 * 86400e3 };
function usage(agentId, win) {
  const since = new Date(Date.now() - WIN[win]).toISOString();
  return one(`select coalesce(sum(tokens_in + tokens_out),0) tokens, coalesce(sum(cost_usd),0) usd, count(*) runs from runs where agent_id=? and started_at>=?`, agentId, since);
}

function agentCard(ag) {
  const v = versions[ag.id] || {};
  const runs = all('select end_reason, started_at, ended_at from runs where agent_id=? and ended_at is not null order by id desc limit 200', ag.id);
  const ok = runs.filter(r => ['listo', 'consulta', 'sin_marcador'].includes(r.end_reason)).length;
  const dur = runs.filter(r => r.ended_at).map(r => Date.parse(r.ended_at) - Date.parse(r.started_at));
  const cli = all(`select * from agent_limits where agent_id=? and source='cli' order by win`, ag.id);
  const manual = all(`select * from agent_limits where agent_id=? and source='manual'`, ag.id).map(l => {
    const u = usage(ag.id, l.win) || {};
    const used = l.metric === 'usd' ? u.usd : l.metric === 'runs' ? u.runs : u.tokens;
    return { ...l, used_value: used, pct: l.limit_value ? Math.round(used / l.limit_value * 1000) / 10 : 0 };
  });
  const cuts = one(`select count(*) n, max(ended_at) last from runs where agent_id=? and end_reason='cuota' and started_at>=?`, ag.id, new Date(Date.now() - 7 * 86400e3).toISOString());
  let state = ag.status;
  if (!ag.enabled) state = 'deshabilitado';
  if (v.found === false) state = 'no_encontrado';
  return {
    id: ag.id, key: ag.key, name: ag.name, color: ag.color, enabled: !!ag.enabled, exe: ag.exe, found: v.found ?? null, version: v.version ?? null,
    state, quota_reset_at: ag.quota_reset_at, last_error: ag.last_error, last_test: J(ag.last_test),
    busy: [...R.active.values()].filter(a => a.agentId === ag.id).length, max_concurrent: ag.max_concurrent,
    queued: R.queue.filter(q => one('select agent_id from conversations where id=?', q.convId)?.agent_id === ag.id).length,
    limits_cli: cli, limits_manual: manual, usage: Object.fromEntries(Object.keys(WIN).map(w => [w, usage(ag.id, w)])),
    quota_cuts_7d: cuts.n, last_quota_cut: cuts.last,
    models: J(ag.models, []), efforts: J(ag.efforts, []), default_model: ag.default_model, default_effort: ag.default_effort,
    success_rate: runs.length ? Math.round(ok / runs.length * 100) : null, avg_duration_s: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length / 1000) : null,
    tasks_done: one(`select count(*) n from tasks where agent_id=? and status='completada' and deleted_at is null`, ag.id).n,
  };
}

async function processes() {
  const pids = [...R.active.values()].map(a => a.proc.pid).filter(Boolean);
  if (!pids.length || process.platform !== 'win32') return {};
  const r = await sh('tasklist', ['/V', '/FO', 'CSV', '/NH']);
  const m = {};
  for (const l of r.out.split(/\r?\n/)) {
    const c = l.match(/"([^"]*)"/g)?.map(x => x.slice(1, -1)); if (!c) continue;
    if (pids.includes(+c[1])) m[c[1]] = { mem: c[4], cpu_time: c[7] };
  }
  return m;
}

function folders() {
  return all(`select f.*, p.name project from project_folders f join projects p on p.id=f.project_id where p.deleted_at is null`).map(f => {
    const exists = fs.existsSync(f.path);
    const g = exists && R.isGit(f.path);
    let free = null; try { const s = fs.statfsSync(f.path); free = s.bavail * s.bsize; } catch {}
    const wts = g ? (R.tryGit(f.path, 'worktree', 'list', '--porcelain') || '').split(/\r?\n/).filter(l => l.startsWith('worktree ') && l.includes('.oficina-worktrees'))
      .map(l => { const p = path.normalize(l.slice(9)); const t = one('select id, status from tasks where worktree_path=? and deleted_at is null', p); return { path: p, task_id: t?.id ?? null, orphan: !t || t.status === 'completada' }; }) : [];
    return { id: f.id, project: f.project, label: f.label, path: f.path, exists, is_git: g, branch: g ? R.tryGit(f.path, 'rev-parse', '--abbrev-ref', 'HEAD') : null,
      dirty: g ? (R.tryGit(f.path, 'status', '--porcelain') || '').split(/\r?\n/).filter(Boolean).length : null, worktrees: wts, free_bytes: free };
  });
}

const dirSize = d => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {} return n; };

async function status() {
  const agents = all('select * from agents order by id').map(agentCard);
  const procs = await processes();
  const act = [...R.active.values()].map(a => {
    const r = one('select * from runs where id=?', a.runId);
    const c = one('select * from conversations where id=?', a.convId);
    return { run_id: a.runId, conv_id: a.convId, task_id: r.task_id, title: c.title, agent_id: a.agentId, model: r.model, effort: r.effort, pid: a.proc.pid,
      started_at: r.started_at, ...(procs[a.proc.pid] || {}) };
  });
  const cnt = s => one(`select count(*) n from tasks where status=? and deleted_at is null`, s).n;
  const backups = fs.readdirSync(path.join(DATA, 'backups')).sort();
  return {
    at: now(), last_scan: lastScan, queue_paused: R.isPaused(),
    agents,
    work: { active: act, queue: R.queue.map(q => ({ conv_id: q.convId, title: one('select title from conversations where id=?', q.convId)?.title })),
      waiting: all(`select id, title, status, project_id from tasks where status in ('esperando','revision','pausada_cuota') and deleted_at is null order by updated_at`),
      waiting_chats: all(`select id, title from conversations where status='esperando' and kind='consulta_rapida' and deleted_at is null`),
      permissions: [...R.pendingPerms.entries()].map(([id, p]) => ({ request_id: id, conv_id: p.convId, task_id: p.taskId })),
      blocked: cnt('bloqueada'), failed_24h: one(`select count(*) n from tasks where status='fallida' and updated_at>=? and deleted_at is null`, new Date(Date.now() - 86400e3).toISOString()).n },
    folders: folders(),
    system: { uptime_s: Math.round((Date.now() - started) / 1000), node: process.version, pid: process.pid,
      db_bytes: fs.statSync(path.join(DATA, 'oficina.db')).size, runs_bytes: dirSize(path.join(DATA, 'runs')), sandbox_bytes: dirSize(path.join(DATA, 'sandbox')),
      last_backup: backups.at(-1) || null, backups: backups.length, sse_clients: bus.listenerCount('ev'), errors: errors.slice(0, 10) },
  };
}

// escaneo periódico: versiones, snapshots y alertas de límites
async function scan() {
  const agents = all('select * from agents order by id');
  await Promise.all(agents.map(probe));
  const alerted = setting('alerted', {});
  const at = now();
  for (const ag of agents) {
    const c = agentCard(one('select * from agents where id=?', ag.id));
    const lim = [...c.limits_cli.map(l => ({ win: l.win, pct: l.used_value, key: `cli-${l.win}-${l.resets_at}` })),
      ...c.limits_manual.map(l => ({ win: l.win + ' ' + l.metric, pct: l.pct, key: `man-${l.win}-${l.metric}-${at.slice(0, 10)}` }))];
    for (const l of lim) if (l.pct >= 80 && !alerted[ag.id + l.key]) {
      alerted[ag.id + l.key] = at;
      notify('limite', `${ag.name} al ${Math.round(l.pct)}% de su límite`, `Ventana: ${l.win}`, '#/puente');
      if (setting('divert_at_80', false)) update('agents', ag.id, { enabled: 0 });
    }
    insert('status_snapshots', { agent_id: ag.id, state: c.state, detail: JSON.stringify({ version: c.version, limits: lim.map(l => [l.win, l.pct]), busy: c.busy, queued: c.queued, usage5h: c.usage['5h'] }), at });
  }
  setSetting('alerted', alerted);
  run('delete from status_snapshots where at < ?', new Date(Date.now() - 30 * 86400e3).toISOString());
  lastScan = at;
  emit('status.scan', { at });
}
function history(hours = 24) {
  return all('select agent_id, state, detail, at from status_snapshots where at>=? order by at', new Date(Date.now() - hours * 3600e3).toISOString()).map(s => ({ ...s, detail: J(s.detail, {}) }));
}

// Probar: prompt mínimo real, sin ensuciar el historial (kind='prueba')
async function testAgent(agentId, userId) {
  const ag = one('select * from agents where id=?', agentId);
  const v = await probe(ag);
  if (!v.found) { update('agents', ag.id, { last_test: JSON.stringify({ ok: false, at: now(), error: 'Ejecutable no encontrado' }) }); return { ok: false, error: 'Ejecutable no encontrado', version: null }; }
  const cid = insert('conversations', { kind: 'prueba', title: 'Prueba ' + ag.name, agent_id: ag.id, model: ag.default_model, effort: ag.default_effort, mode: 'plan', created_by: userId, created_at: now(), updated_at: now() });
  const t0 = Date.now();
  const res = await R.runTurn(cid, null, { userId, prompt: 'Responde solo la palabra OK.' });
  const c = one('select * from conversations where id=?', cid);
  const out = { ok: /ok/i.test(res.final || '') && !res.error, at: now(), latency_ms: Date.now() - t0, session_id: c.session_id, reply: (res.final || '').slice(0, 100), end_reason: res.end_reason, error: (res.error || '').slice(0, 300), version: v.version };
  update('agents', ag.id, { last_test: JSON.stringify(out) });
  emit('agent.status', { id: ag.id });
  return out;
}

function backup() {
  const f = path.join(DATA, 'backups', `oficina-${now().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const list = fs.readdirSync(path.join(DATA, 'backups')).sort();
  for (const old of list.slice(0, Math.max(0, list.length - 14))) fs.rmSync(path.join(DATA, 'backups', old));
  return path.basename(f);
}
function dailyBackup() {
  const last = fs.readdirSync(path.join(DATA, 'backups')).sort().at(-1);
  if (!last || !last.includes(now().slice(0, 10))) try { backup(); } catch (e) { pushError(e); }
}

module.exports = { status, scan, history, testAgent, backup, dailyBackup, pushError, errors, probe, usage };
