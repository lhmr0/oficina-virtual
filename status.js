// Puente de Mando: estado de agentes, límites, trabajo, carpetas y sistema
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA, now, all, one, run, J, insert, update, bus, emit, notify, setting, setSetting } = require('./db');
const R = require('./runner');
const host = require('./host');

const started = Date.now();
const errors = [];            // errores recientes del servidor
const pushError = e => { errors.unshift({ at: now(), msg: String(e?.stack || e).slice(0, 600) }); errors.length = Math.min(errors.length, 30); };
const versions = {};          // agentId → {found, version, at} (en la máquina por defecto)
let lastScan = null;

async function probe(ag) {
  const mid = host.defaultMachine();
  if (!host.online(mid)) return versions[ag.id] || { found: null, version: null };
  try {
    const v = await host.call(mid, 'probe', { exe: ag.exe, pre_args: J(ag.pre_args, []) });
    versions[ag.id] = { ...v, at: now() };
    if (v.found) {
      try {
        const detected = await host.call(mid, 'detectModels', { adapter: ag.adapter, exe: ag.exe, pre_args: J(ag.pre_args, []) });
        if (Array.isArray(detected) && detected.length) {
          const cur = J(ag.models, []);
          const missing = detected.filter(m => !cur.includes(m));
          if (missing.length) {
            const next = [...new Set([...detected, ...cur])];
            update('agents', ag.id, { models: JSON.stringify(next) });
            ag.models = JSON.stringify(next);
            emit('agent.status', { id: ag.id });
          }
        }
      } catch {}
    }
  }
  catch (e) { versions[ag.id] = { found: null, version: null, error: e.message, at: now() }; }
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
  const byM = {};
  for (const a of R.active.values()) if (a.runId) (byM[a.mid] ||= []).push(one('select pid from runs where id=?', a.runId)?.pid);
  const m = {};
  for (const [mid, pids] of Object.entries(byM)) try { Object.assign(m, await host.call(+mid, 'processes', { pids: pids.filter(Boolean) })); } catch {}
  return m;
}

async function folders() {
  const rows = all(`select f.*, p.name project from project_folders f join projects p on p.id=f.project_id where p.deleted_at is null`);
  return Promise.all(rows.map(async f => {
    const mid = f.machine_id || host.defaultMachine();
    const base = { id: f.id, project: f.project, label: f.label, path: f.path, machine_id: mid, machine: host.machine(mid)?.name, online: host.online(mid) };
    if (!base.online) return { ...base, exists: null, worktrees: [] };
    try {
      const i = await host.call(mid, 'folderInfo', { path: f.path });
      const worktrees = i.worktrees.map(p => { const t = one('select id, status from tasks where worktree_path=? and deleted_at is null', p); return { path: p, task_id: t?.id ?? null, orphan: !t || t.status === 'completada' }; });
      return { ...base, ...i, worktrees };
    } catch (e) { return { ...base, exists: null, error: e.message, worktrees: [] }; }
  }));
}

const dirSize = d => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {} return n; };

async function status() {
  const agents = all('select * from agents order by id').map(agentCard);
  const procs = await processes();
  const act = [...R.active.values()].filter(a => a.runId).map(a => {
    const r = one('select * from runs where id=?', a.runId);
    const c = one('select * from conversations where id=?', a.convId);
    return { run_id: a.runId, conv_id: a.convId, task_id: r.task_id, title: c.title, agent_id: a.agentId, model: r.model, effort: r.effort, pid: r.pid,
      machine: host.machine(a.mid)?.name, started_at: r.started_at, ...(procs[r.pid] || {}) };
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
    folders: await folders(),
    machines: host.machineList(),
    system: { uptime_s: Math.round((Date.now() - started) / 1000), node: process.version, pid: process.pid,
      db_bytes: fs.statSync(path.join(DATA, 'oficina.db')).size, runs_bytes: dirSize(path.join(DATA, 'runs')), sandbox_bytes: dirSize(path.join(DATA, 'sandbox')),
      last_backup: backups.at(-1) || null, backups: backups.length, sse_clients: bus.listenerCount('ev'), errors: errors.slice(0, 10) },
  };
}

// escaneo periódico: versiones, snapshots y alertas de límites
async function scan() {
  const agents = all('select * from agents order by id');
  await Promise.all(agents.map(probe));
  const mid = host.defaultMachine();
  if (host.online(mid)) for (const ag of agents.filter(a => a.adapter === 'agy' && a.enabled)) // cuota de Antigravity aunque no haya corrido nada
    try { R.saveLimits(ag.id, R.agyLimits(await host.call(mid, 'agyQuota'), ag.default_model)); } catch {}
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
