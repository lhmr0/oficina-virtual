// Oficina Virtual — servidor HTTP (API REST + SSE + estáticos). Uso: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA, PORT, now, all, one, run, J, insert, update, bus, emit, log, notify, setting, setSetting } = require('./db');
const host = require('./host');
const R = require('./runner');
const S = require('./status');
const C = require('./council');

// ---------- auth ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, h) => { const [salt, k] = String(h).split(':'); return !!k && crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(pw, salt, 64)); };
const fails = new Map(); // username → {n, until}
const LEVEL = { observador: 0, operador: 1, admin: 2 };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function userOf(req) {
  const tok = cookies(req).ov_session;
  if (!tok) return null;
  const s = one('select * from sessions where token=? and expires_at>?', tok, Date.now());
  return s ? one('select id, username, name, role, avatar, notif_prefs from users where id=? and deleted_at is null', s.user_id) : null;
}
const publicUser = u => u && { ...u, notif_prefs: J(u.notif_prefs, {}) };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, msg, code = 400) => { if (!cond) throw new HttpError(code, msg); };

// modo de login: 'password' (local) o 'google' (VPS: solo correos permitidos vía Google SSO)
const AUTH = process.env.OFICINA_AUTH || 'password';
const SECURE = host.PUBLIC_URL.startsWith('https://');
const ALLOWED = (process.env.OFICINA_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const oauthStates = new Map(); // state → {verifier, exp}
const b64u = b => b.toString('base64url');

// ---------- router ----------
const routes = [];
const r = (method, pattern, role, fn, opt = {}) => routes.push({ method, role, fn, ...opt, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

function newSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('delete from sessions where expires_at<?', Date.now());
  insert('sessions', { token, user_id: userId, expires_at: Date.now() + 12 * 3600e3 });
  res.setHeader('Set-Cookie', `ov_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${SECURE ? '; Secure' : ''}`);
}
r('GET', '/api/setup', null, () => ({ needed: AUTH === 'password' && !one('select 1 from users where deleted_at is null limit 1'), mode: AUTH }));
r('GET', '/api/auth/google', null, ({ res }) => {
  need(AUTH === 'google', 'Login con Google deshabilitado', 404);
  const state = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(32));
  for (const [k, v] of oauthStates) if (v.exp < Date.now()) oauthStates.delete(k);
  oauthStates.set(state, { verifier, exp: Date.now() + 10 * 60000 });
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: host.PUBLIC_URL + '/api/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account' });
  res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q });
  res.end();
  return RAW;
});
r('GET', '/api/auth/google/callback', null, async ({ query, res }) => {
  const back = msg => { res.writeHead(302, { Location: '/#/login?error=' + encodeURIComponent(msg) }); res.end(); return RAW; };
  const st = oauthStates.get(query.state);
  oauthStates.delete(query.state);
  if (AUTH !== 'google' || !st || st.exp < Date.now() || !query.code) return back('Inicio de sesión inválido o expirado');
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: host.PUBLIC_URL + '/api/auth/google/callback', grant_type: 'authorization_code', code_verifier: st.verifier }) }).then(r => r.json());
  if (!tok.access_token) return back('Google rechazó el inicio de sesión');
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } }).then(r => r.json());
  const email = String(info.email || '').toLowerCase();
  if (!info.email_verified || !ALLOWED.includes(email)) { log(null, 'usuario', null, 'login_rechazado', { email }); return back(`La cuenta ${email || '?'} no tiene acceso a esta oficina`); }
  let u = one('select * from users where lower(email)=? or lower(username)=?', email, email);
  if (!u) { const id = insert('users', { username: email, email, name: info.name || email, pass_hash: '-', role: 'admin', created_at: now() }); u = one('select * from users where id=?', id); }
  else if (u.deleted_at) return back('Usuario desactivado');
  else if (!u.email) update('users', u.id, { email });
  newSession(res, u.id);
  log(u.id, 'usuario', u.id, 'login', { via: 'google' });
  res.writeHead(302, { Location: '/#/estacion' }); res.end();
  return RAW;
});
r('POST', '/api/setup', null, ({ body, res }) => {
  need(AUTH === 'password', 'Esta oficina usa inicio de sesión con Google', 403);
  need(!one('select 1 from users limit 1'), 'Ya existe un comandante', 403);
  need(body.username && body.password?.length >= 6, 'Usuario y contraseña (mín. 6) requeridos');
  const id = insert('users', { username: body.username.trim(), name: body.name || body.username, pass_hash: hashPw(body.password), role: 'admin', created_at: now() });
  log(id, 'usuario', id, 'crear_admin');
  newSession(res, id);
  return { ok: true };
});
r('POST', '/api/login', null, ({ body, res }) => {
  need(AUTH === 'password', 'Esta oficina usa inicio de sesión con Google', 403);
  const u = String(body.username || '').trim();
  const f = fails.get(u);
  need(!(f && f.until > Date.now()), `Demasiados intentos. Espera ${Math.ceil(((f?.until || 0) - Date.now()) / 60000)} min`, 429);
  const row = one('select * from users where username=? and deleted_at is null', u);
  if (!row || !checkPw(String(body.password || ''), row.pass_hash)) {
    const n = (f?.until > Date.now() ? 0 : f?.n || 0) + 1;
    fails.set(u, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    log(row?.id ?? null, 'usuario', row?.id ?? null, 'login_fallido', { username: u });
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  fails.delete(u);
  newSession(res, row.id);
  log(row.id, 'usuario', row.id, 'login');
  return { ok: true };
});
r('POST', '/api/logout', 'observador', ({ req, res, user }) => {
  run('delete from sessions where token=?', cookies(req).ov_session);
  res.setHeader('Set-Cookie', 'ov_session=; Path=/; Max-Age=0');
  log(user.id, 'usuario', user.id, 'logout');
  return { ok: true };
});
r('GET', '/api/me', 'observador', ({ user }) => publicUser(user));
r('PUT', '/api/me', 'observador', ({ user, body }) => {
  const p = {};
  if (body.name) p.name = body.name;
  if (body.avatar) p.avatar = body.avatar;
  if (body.notif_prefs) p.notif_prefs = JSON.stringify(body.notif_prefs);
  if (body.password) { need(body.password.length >= 6, 'Contraseña mínimo 6'); p.pass_hash = hashPw(body.password); }
  update('users', user.id, p);
  return { ok: true };
});

// ---------- catálogos ----------
const agentPublic = a => ({ id: a.id, key: a.key, name: a.name, color: a.color, adapter: a.adapter, models: J(a.models, []), efforts: J(a.efforts, []), prices: J(a.prices, {}),
  default_model: a.default_model, default_effort: a.default_effort, enabled: !!a.enabled, status: a.status, quota_reset_at: a.quota_reset_at, max_concurrent: a.max_concurrent });
const RANKS = [[0, 'Iniciado'], [3, 'Padawan'], [10, 'Caballero Jedi'], [25, 'Maestro Jedi'], [60, 'Gran Maestro']];
const rank = n => RANKS.filter(([m]) => n >= m).at(-1)[1];
function projectsList(where = 'p.deleted_at is null') {
  const counts = all('select project_id, status, count(*) n from tasks where deleted_at is null group by 1, 2');
  return all(`select p.*, (select max(updated_at) from tasks where project_id=p.id) last_activity from projects p where ${where} order by p.updated_at desc`).map(p => {
    const c = Object.fromEntries(counts.filter(x => x.project_id === p.id).map(x => [x.status, x.n]));
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    return { ...p, folders: all('select * from project_folders where project_id=? order by is_default desc, id', p.id), counts: c, total,
      progress: total ? Math.round((c.completada || 0) / total * 100) : 0,
      agents: all('select distinct agent_id from tasks where project_id=? and agent_id is not null and deleted_at is null', p.id).map(x => x.agent_id) };
  });
}
r('GET', '/api/bootstrap', 'observador', ({ user }) => ({
  me: publicUser(user),
  users: all('select id, username, name, role, avatar from users where deleted_at is null').map(u => {
    const n = one(`select count(*) n from activity where user_id=? and action='aprobar'`, u.id).n;
    return { ...u, approvals: n, rank: rank(n) };
  }),
  areas: all('select * from areas where deleted_at is null order by id').map(a => ({ ...a, fallback_chain: J(a.fallback_chain, []) })),
  agents: all('select * from agents order by id').map(a => { const d = one(`select count(*) n from tasks where agent_id=? and status='completada'`, a.id).n; return { ...agentPublic(a), done: d, rank: rank(d) }; }),
  projects: projectsList(),
  templates: all('select * from templates order by area_id, id'),
  lenses: C.lenses(),
  queue_paused: R.isPaused(),
  machines: host.machineList(),
  auth_mode: AUTH,
  settings: { council_auto_n: setting('council_auto_n', 0), council_auto_agents: setting('council_auto_agents', []), divert_at_80: setting('divert_at_80', false), scan_min: setting('scan_min', 5), checkpoint_exclude: setting('checkpoint_exclude', R.DEFAULT_EXCLUDE) },
}));

// ---------- proyectos ----------
async function checkFolder(f) {
  const mid = +f.machine_id || host.defaultMachine();
  try { return { mid, ...(await host.call(mid, 'checkFolder', { path: f.path })) }; } catch (e) { throw new HttpError(400, `${f.path}: ${e.message}`); }
}
async function addFolder(projectId, f, userId, chk) {
  chk ||= await checkFolder(f);
  const p = chk.path;
  const first = !one('select 1 from project_folders where project_id=?', projectId);
  if (f.is_default) run('update project_folders set is_default=0 where project_id=?', projectId);
  const id = insert('project_folders', { project_id: projectId, label: f.label || p.split(/[\\/]/).pop(), path: p, is_git: chk.is_git ? 1 : 0, machine_id: chk.mid,
    use_worktrees: f.use_worktrees === false || f.use_worktrees === 0 ? 0 : 1, is_default: f.is_default || first ? 1 : 0 });
  update('projects', projectId, { kind: 'con_carpetas', updated_at: now() });
  log(userId, 'proyecto', projectId, 'agregar_carpeta', { path: p });
  return id;
}
const PSTATUS = ['planificacion', 'activo', 'pausado', 'completado', 'archivado'];
r('GET', '/api/projects', 'observador', () => projectsList());
r('POST', '/api/projects', 'operador', async ({ body, user }) => {
  need(body.name?.trim(), 'Nombre requerido');
  const checked = [];
  for (const f of body.folders || []) checked.push(await checkFolder(f));
  const id = insert('projects', { name: body.name.trim(), code: body.code || null, kind: 'solo_registro', status: PSTATUS.includes(body.status) ? body.status : 'planificacion',
    description: body.description || '', briefing: body.briefing || '', color: body.color || '#ffe81f', created_by: user.id, created_at: now(), updated_at: now() });
  for (const [i, f] of (body.folders || []).entries()) await addFolder(id, f, user.id, checked[i]);
  log(user.id, 'proyecto', id, 'crear', { nombre: body.name });
  emit('project.updated', { id });
  return { id };
});
r('PUT', '/api/projects/:id', 'operador', ({ params, body, user }) => {
  const p = one('select * from projects where id=?', +params.id); need(p, 'No existe', 404);
  const patch = {};
  for (const k of ['name', 'code', 'description', 'briefing', 'color']) if (body[k] !== undefined) patch[k] = body[k];
  if (body.status) { need(PSTATUS.includes(body.status), 'Estado inválido'); patch.status = body.status; }
  update('projects', p.id, { ...patch, updated_at: now() });
  log(user.id, 'proyecto', p.id, 'editar', patch);
  if (body.status === 'completado') bus.emit('project.completed', { id: p.id });
  emit('project.updated', { id: p.id });
  return { ok: true };
});
r('DELETE', '/api/projects/:id', 'operador', ({ params, user }) => {
  update('projects', +params.id, { deleted_at: now() }); log(user.id, 'proyecto', +params.id, 'eliminar'); emit('project.updated', { id: +params.id }); return { ok: true };
});
r('POST', '/api/projects/:id/folders', 'operador', async ({ params, body, user }) => { const id = await addFolder(+params.id, body, user.id); emit('project.updated', { id: +params.id }); return { id }; });
r('PUT', '/api/folders/:id', 'operador', ({ params, body, user }) => {
  const f = one('select * from project_folders where id=?', +params.id); need(f, 'No existe', 404);
  if (body.is_default) run('update project_folders set is_default=0 where project_id=?', f.project_id);
  const p = {};
  for (const k of ['label', 'use_worktrees', 'is_default']) if (body[k] !== undefined) p[k] = typeof body[k] === 'boolean' ? +body[k] : body[k];
  update('project_folders', f.id, p); log(user.id, 'proyecto', f.project_id, 'editar_carpeta', p); emit('project.updated', { id: f.project_id });
  return { ok: true };
});
r('DELETE', '/api/folders/:id', 'operador', ({ params, user }) => {
  const f = one('select * from project_folders where id=?', +params.id); need(f, 'No existe', 404);
  run('delete from project_folders where id=?', f.id);
  if (!one('select 1 from project_folders where project_id=?', f.project_id)) update('projects', f.project_id, { kind: 'solo_registro' });
  log(user.id, 'proyecto', f.project_id, 'quitar_carpeta', { path: f.path }); emit('project.updated', { id: f.project_id });
  return { ok: true };
});
// ---------- máquinas (agentes de campo) ----------
r('GET', '/api/machines', 'observador', () => host.machineList());
r('POST', '/api/machines', 'admin', ({ body, user }) => { need(body.name?.trim(), 'Nombre requerido'); return host.createMachine(body.name.trim(), user.id); });
r('PUT', '/api/machines/:id', 'admin', ({ params, body, user }) => {
  const m = host.machine(+params.id); need(m, 'No existe', 404);
  if (body.name) update('machines', m.id, { name: body.name });
  if (body.default) setSetting('default_machine', m.id);
  log(user.id, 'maquina', m.id, 'editar', body); emit('machine.status', { id: m.id });
  return { ok: true };
});
r('DELETE', '/api/machines/:id', 'admin', ({ params, user }) => { update('machines', +params.id, { deleted_at: now(), token_hash: null }); log(user.id, 'maquina', +params.id, 'eliminar'); emit('machine.status', { id: +params.id }); return { ok: true }; });
r('GET', '/api/machines/:id/ls', 'operador', ({ params, query }) => host.call(+params.id || host.defaultMachine(), 'listDir', { path: query.path || null }));

// ---------- tareas ----------
const taskRow = t => t && { ...t, depends_on: J(t.depends_on, []) };
r('GET', '/api/tasks', 'observador', ({ query }) => {
  const w = ['t.deleted_at is null'], p = [];
  for (const k of ['project_id', 'area_id', 'agent_id', 'assignee_user_id']) if (query[k]) { w.push(`t.${k}=?`); p.push(+query[k]); }
  if (query.status) { w.push('t.status=?'); p.push(query.status); }
  if (query.q) { w.push('(t.title like ? or t.prompt like ?)'); p.push(`%${query.q}%`, `%${query.q}%`); }
  return all(`select t.*, (select count(*) from messages m join conversations c on c.id=m.conversation_id where c.task_id=t.id and m.kind='consulta') consultas
    from tasks t where ${w.join(' and ')} order by t.kanban_order`, ...p).map(taskRow);
});
const attachmentsOf = (taskId, convIds) => all(`select id, task_id, conversation_id, name, mime, size, uploaded_by, at from attachments where ${taskId ? 'task_id=? or ' : ''}conversation_id in (${convIds.length ? convIds.join(',') : -1}) order by id`, ...(taskId ? [taskId] : []));
r('GET', '/api/tasks/:id', 'observador', async ({ params }) => {
  const t = taskRow(one('select * from tasks where id=?', +params.id)); need(t, 'No existe', 404);
  const convs = all('select * from conversations where task_id=? order by id', t.id);
  const ids = convs.map(c => c.id).concat(t.conversation_id || []);
  const inq = ids.length ? `in (${[...new Set(ids)].join(',')})` : 'in (-1)';
  return {
    task: t, project: one('select * from projects where id=?', t.project_id), folder: t.folder_id ? one('select * from project_folders where id=?', t.folder_id) : null,
    conversations: convs, messages: all(`select * from messages where conversation_id ${inq} order by id`),
    runs: all(`select * from runs where conversation_id ${inq} order by id desc`), history: all('select * from task_history where task_id=? order by id desc limit 200', t.id),
    handoffs: all('select * from handoffs where task_id=? order by id desc', t.id), children: all('select id, title, status from tasks where parent_id=? and deleted_at is null', t.id),
    deps: t.depends_on.map(id => one('select id, title, status from tasks where id=?', id)).filter(Boolean),
    dependents: all(`select id, title, status from tasks where depends_on like ? and deleted_at is null`, `%${t.id}%`).filter(x => J(one('select depends_on from tasks where id=?', x.id).depends_on, []).includes(t.id)),
    permissions: [...R.pendingPerms.entries()].filter(([, p]) => p.taskId === t.id).map(([id, p]) => ({ request_id: id, input: p.input })),
    running: [...R.active.values()].some(a => ids.includes(a.convId)), queued: R.queue.some(q => ids.includes(q.convId)),
    files: t.folder_id || !host.online(R.machineOfTask(t)) ? [] : await host.call(R.machineOfTask(t), 'listFiles', { sandbox: 'task-' + t.id }).catch(() => []),
    attachments: attachmentsOf(t.id, [...new Set(ids)]),
    machine: host.machine(R.machineOfTask(t))?.name || null, machine_online: host.online(R.machineOfTask(t)),
    proposal: t.proposal_id ? one('select * from proposals where id=?', t.proposal_id) : null,
  };
});
r('GET', '/api/tasks/:id/file', 'observador', async ({ params, query, res }) => {
  const t = one('select * from tasks where id=?', +params.id); need(t, 'No existe', 404);
  const b64 = await host.call(R.machineOfTask(t), 'readFileB64', { sandbox: 'task-' + t.id, name: String(query.name || '') });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${String(query.name).split('/').pop().replace(/"/g, '')}"` });
  res.end(Buffer.from(b64, 'base64'));
  return RAW;
});
r('GET', '/api/tasks/:id/diff', 'observador', async ({ params }) => {
  const t = one('select * from tasks where id=?', +params.id); need(t, 'No existe', 404);
  const mid = R.machineOfTask(t);
  const cwd = t.worktree_path || R.folderOf(t)?.path;
  if (!cwd) return { diff: '', log: '' };
  if (!host.online(mid)) return { diff: '', log: '', offline: true };
  return { ...(await host.call(mid, 'diff', { cwd, base: t.worktree_path ? t.base_branch : null })), branch: t.branch };
});
r('POST', '/api/tasks', 'operador', ({ body, user }) => {
  need(body.title?.trim() && body.project_id, 'Título y proyecto requeridos');
  if (body.folder_id) need(one('select 1 from project_folders where id=? and project_id=?', +body.folder_id, +body.project_id), 'La carpeta no pertenece al proyecto');
  const id = R.createTask({ ...body, title: body.title.trim() }, user.id);
  if (body.run && body.executor !== 'humano') R.runTask(id, user.id).catch(e => notify('fallo', `No se pudo ejecutar #${id}`, e.message, `#/tarea/${id}`));
  return { id };
});
const EDITABLE = ['title', 'prompt', 'area_id', 'folder_id', 'agent_id', 'model', 'effort', 'mode', 'priority', 'due_date', 'assignee_user_id', 'executor', 'depends_on', 'kanban_order'];
r('PUT', '/api/tasks/:id', 'operador', ({ params, body, user }) => {
  const id = +params.id;
  const patch = {};
  for (const k of EDITABLE) if (body[k] !== undefined) patch[k] = k === 'depends_on' ? JSON.stringify((body[k] || []).map(Number).filter(x => x && x !== id)) : (body[k] === '' ? null : body[k]);
  R.changeTask(id, patch, user.id);
  if (body.status) R.setStatus(id, body.status, user.id);
  log(user.id, 'tarea', id, 'editar', Object.keys(patch));
  return taskRow(one('select * from tasks where id=?', id));
});
r('POST', '/api/tasks/:id/move', 'operador', ({ params, body, user }) => {
  const t = one('select * from tasks where id=?', +params.id); need(t, 'No existe', 404);
  if (body.kanban_order != null) update('tasks', t.id, { kanban_order: +body.kanban_order });
  if (body.status && body.status !== t.status) {
    if (t.executor === 'agente' && ['en_curso', 'en_cola'].includes(body.status)) R.runTask(t.id, user.id).catch(e => notify('fallo', `No se pudo ejecutar #${t.id}`, e.message, `#/tarea/${t.id}`));
    else R.setStatus(t.id, body.status, user.id, { via: 'kanban' });
  }
  emit('task.updated', { id: t.id, project_id: t.project_id });
  return { ok: true };
});
const bg = (p, id) => p.catch(e => notify('fallo', `Tarea #${id}`, e.message, `#/tarea/${id}`));
r('POST', '/api/tasks/:id/run', 'operador', async ({ params, body, user }) => {
  const id = +params.id;
  const t = one('select * from tasks where id=?', id);
  need(!['en_cola', 'en_curso'].includes(t.status), 'Ya está en ejecución');
  if (R.depsPending(t).length) { R.changeTask(id, { status: 'bloqueada' }, user.id); throw new HttpError(409, 'Bloqueada por dependencias: #' + R.depsPending(t).join(', #')); }
  const fresh = body.fresh || (t.conversation_id && body.agent_id && +body.agent_id !== t.agent_id);
  bg(R.runTask(id, user.id, { ...body, fresh }), id);
  return { ok: true };
});
r('POST', '/api/tasks/:id/reply', 'operador', ({ params, body, user }) => {
  need(body.text?.trim(), 'Escribe una respuesta');
  const t = one('select * from tasks where id=?', +params.id);
  if (t.executor === 'humano' || !t.conversation_id) return noteTask(t, body.text, user);
  bg(R.runTask(t.id, user.id, { text: body.text }), t.id);
  return { ok: true };
});
function noteTask(t, text, user) {
  let cid = t.conversation_id || one('select id from conversations where task_id=? order by id desc', t.id)?.id;
  if (!cid) { cid = insert('conversations', { kind: 'tarea', task_id: t.id, project_id: t.project_id, title: t.title, created_by: user.id, created_at: now(), updated_at: now() }); }
  insert('messages', { conversation_id: cid, role: 'usuario', user_id: user.id, text, kind: 'nota', at: now() });
  log(user.id, 'tarea', t.id, 'nota');
  emit('task.updated', { id: t.id, project_id: t.project_id });
  return { ok: true };
}
r('POST', '/api/tasks/:id/note', 'operador', ({ params, body, user }) => noteTask(one('select * from tasks where id=?', +params.id), body.text, user));
r('POST', '/api/tasks/:id/abort', 'operador', ({ params, user }) => {
  const t = one('select * from tasks where id=?', +params.id);
  const ok = t.conversation_id && R.abortConv(t.conversation_id);
  log(user.id, 'tarea', t.id, 'abortar');
  return { ok: !!ok };
});
r('POST', '/api/tasks/:id/approve', 'operador', async ({ params, body, user }) => {
  const merge = await R.approveTask(+params.id, user.id, { merge: !!body.merge });
  const second = body.second_opinion ? C.secondOpinion(+params.id, user.id) : null;
  if (second && body.run_second) bg(R.runTask(second, user.id), second);
  return { ok: true, merge, second };
});
r('POST', '/api/tasks/:id/return', 'operador', ({ params, body, user }) => { need(body.comment?.trim(), 'Escribe el comentario'); bg(Promise.resolve(R.returnTask(+params.id, user.id, body.comment)), +params.id); return { ok: true }; });
r('POST', '/api/tasks/:id/handoff', 'operador', async ({ params, body, user }) => {
  need(body.agent_id || body.user_id, 'Elige agente o persona');
  return R.handoffTask(+params.id, { agent_id: body.agent_id ? +body.agent_id : null, model: body.model, effort: body.effort, user_id: body.user_id ? +body.user_id : null, reason: body.reason || 'manual' }, user.id);
});
r('POST', '/api/tasks/:id/decompose', 'operador', async ({ params, user }) => ({ ids: await C.decompose(+params.id, user.id) }));
r('POST', '/api/tasks/:id/review', 'operador', ({ params, body, user }) => {
  const t = one('select * from tasks where id=?', +params.id);
  const agents = body.agents?.length ? body.agents : [{ agent_id: t.agent_id || one('select id from agents where enabled=1 order by id').id }];
  return C.convene({ scope: { task_ids: [t.id] }, lenses: body.lenses || ['calidad', 'pruebas', 'siguiente'], agents }, user.id).then(id => ({ id }));
});
r('DELETE', '/api/tasks/:id', 'operador', ({ params, user }) => {
  const t = one('select * from tasks where id=?', +params.id);
  if (t.conversation_id) R.abortConv(t.conversation_id);
  update('tasks', t.id, { deleted_at: now() }); log(user.id, 'tarea', t.id, 'eliminar'); emit('task.updated', { id: t.id, project_id: t.project_id });
  return { ok: true };
});
r('POST', '/api/missions', 'operador', ({ body, user }) => {
  need(body.project_id && body.title, 'Proyecto y título requeridos');
  const stages = body.stages?.length ? body.stages : ['Análisis', 'Desarrollo', 'Documentación'].map(n => ({ area_id: one('select id from areas where name=?', n)?.id })).filter(s => s.area_id);
  const ids = [];
  const verbs = { Análisis: 'Analiza y planifica', Desarrollo: 'Implementa según el análisis previo', Documentación: 'Documenta lo implementado' };
  for (const s of stages) {
    const area = one('select * from areas where id=?', s.area_id);
    ids.push(R.createTask({ project_id: body.project_id, area_id: area.id, agent_id: s.agent_id, model: s.model, effort: s.effort, folder_id: body.folder_id,
      title: `[Misión] ${body.title} · ${area.name}`, prompt: `${verbs[area.name] || 'Realiza la etapa ' + area.name}: ${body.prompt || body.title}`,
      mode: area.name === 'Análisis' ? 'plan' : 'editar', depends_on: ids.slice(-1), priority: body.priority }, user.id));
  }
  log(user.id, 'mision', ids[0], 'crear', { tareas: ids });
  if (body.start) bg(R.runTask(ids[0], user.id), ids[0]);
  return { ids };
});

// ---------- conversaciones (Cantina) ----------
function chatPrompt(c, text) {
  if (c.session_id) return text;
  const p = c.project_id ? one('select * from projects where id=?', c.project_id) : null;
  return [R.RULES_CHAT, p ? `Contexto: proyecto "${p.name}". ${p.briefing || p.description || ''}` : '', c.context || '', text].filter(Boolean).join('\n\n');
}
r('GET', '/api/conversations', 'observador', ({ query }) => {
  const w = ['c.deleted_at is null', `c.kind in (${query.kind ? "'" + String(query.kind).replace(/[^a-z_]/g, '') + "'" : "'consulta_rapida'"})`], p = [];
  if (query.archived !== '1') w.push('c.archived=0');
  for (const k of ['agent_id', 'project_id']) if (query[k]) { w.push(`c.${k}=?`); p.push(+query[k]); }
  if (query.q) { w.push('(c.title like ? or exists (select 1 from messages m where m.conversation_id=c.id and m.text like ?))'); p.push(`%${query.q}%`, `%${query.q}%`); }
  return all(`select c.*, (select count(*) from messages where conversation_id=c.id) n_msgs, (select count(*) from runs where conversation_id=c.id) n_runs,
    (select coalesce(sum(tokens_in+tokens_out),0) from runs where conversation_id=c.id) tokens from conversations c where ${w.join(' and ')} order by c.pinned desc, c.updated_at desc limit 300`, ...p);
});
r('POST', '/api/conversations', 'operador', async ({ body, user }) => {
  need(body.agent_id && body.text?.trim(), 'Agente y mensaje requeridos');
  const chk = body.folder_path ? await checkFolder({ path: body.folder_path, machine_id: body.machine_id }) : null;
  const ag = one('select * from agents where id=?', +body.agent_id);
  const id = insert('conversations', { kind: 'consulta_rapida', project_id: body.project_id || null, title: body.title || body.text.trim().slice(0, 60), agent_id: ag.id,
    model: body.model || ag.default_model, effort: body.effort || ag.default_effort, mode: body.mode === 'editar' ? 'editar' : 'plan',
    folder_path: chk?.path || null, machine_id: chk?.mid || (+body.machine_id || null), created_by: user.id, created_at: now(), updated_at: now() });
  for (const aid of body.attachment_ids || []) run('update attachments set conversation_id=? where id=? and conversation_id is null and task_id is null', id, +aid);
  log(user.id, 'chat', id, 'crear', { agente: ag.key });
  R.runTurn(id, body.text, { userId: user.id, prompt: chatPrompt(one('select * from conversations where id=?', id), body.text) }).catch(() => {});
  return { id };
});
r('GET', '/api/conversations/:id', 'observador', ({ params }) => {
  const c = one('select * from conversations where id=?', +params.id); need(c, 'No existe', 404);
  return { conversation: c, messages: all('select * from messages where conversation_id=? order by id', c.id), runs: all('select * from runs where conversation_id=? order by id desc', c.id),
    permissions: [...R.pendingPerms.entries()].filter(([, p]) => p.convId === c.id).map(([id, p]) => ({ request_id: id, input: p.input })),
    running: [...R.active.values()].some(a => a.convId === c.id) || R.queue.some(q => q.convId === c.id),
    attachments: attachmentsOf(null, [c.id]), machine: host.machine(R.machineOfConv(c))?.name || null, machine_online: host.online(R.machineOfConv(c)) };
});
r('POST', '/api/conversations/:id/reply', 'operador', ({ params, body, user }) => {
  need(body.text?.trim(), 'Escribe un mensaje');
  const c = one('select * from conversations where id=?', +params.id);
  if (c.task_id && c.kind === 'tarea') { bg(R.runTask(c.task_id, user.id, { text: body.text }), c.task_id); return { ok: true }; }
  R.runTurn(c.id, body.text, { userId: user.id, prompt: chatPrompt(c, body.text) }).catch(() => {});
  return { ok: true };
});
const transcript = cid => all('select role, text from messages where conversation_id=? order by id', cid).map(m => `**${m.role}:** ${m.text}`).join('\n\n');
r('POST', '/api/conversations/:id/switch', 'operador', ({ params, body, user }) => {
  const c = one('select * from conversations where id=?', +params.id);
  const ag = one('select * from agents where id=?', +body.agent_id); need(ag, 'Agente requerido');
  const from = one('select name from agents where id=?', c.agent_id)?.name;
  update('conversations', c.id, { agent_id: ag.id, model: body.model || ag.default_model, effort: body.effort || ag.default_effort, session_id: null,
    context: `# Conversación previa con ${from} (continúas tú)\n${transcript(c.id).slice(-20000)}`, status: 'inactiva', updated_at: now() });
  insert('messages', { conversation_id: c.id, role: 'sistema', user_id: user.id, text: `Cambio de agente: ${from} → ${ag.name}`, kind: 'handoff', at: now() });
  log(user.id, 'chat', c.id, 'cambiar_agente', { de: from, a: ag.name });
  emit('conv.updated', { id: c.id });
  return { ok: true };
});
r('POST', '/api/conversations/:id/abort', 'operador', ({ params }) => ({ ok: R.abortConv(+params.id) }));
r('POST', '/api/conversations/:id/to-task', 'operador', ({ params, body, user }) => {
  const c = one('select * from conversations where id=?', +params.id);
  need(body.project_id, 'Elige un proyecto');
  const tid = R.createTask({ project_id: +body.project_id, area_id: body.area_id, folder_id: body.folder_id, agent_id: body.agent_id || c.agent_id,
    title: body.title || c.title, prompt: `${body.prompt || ''}\n\n# Conversación de origen (Cantina #${c.id})\n${transcript(c.id).slice(-12000)}`.trim() }, user.id);
  update('conversations', c.id, { task_id: tid, project_id: +body.project_id });
  insert('messages', { conversation_id: c.id, role: 'sistema', user_id: user.id, text: `Convertida en tarea #${tid}`, kind: 'nota', at: now() });
  log(user.id, 'chat', c.id, 'convertir_tarea', { tarea: tid });
  return { id: tid };
});
r('POST', '/api/conversations/:id/new-project', 'operador', ({ params, body, user }) => {
  const c = one('select * from conversations where id=?', +params.id);
  const id = insert('projects', { name: body.name || c.title, kind: 'solo_registro', status: 'planificacion', description: `Creado desde la Cantina #${c.id}`,
    briefing: body.briefing || '', created_by: user.id, created_at: now(), updated_at: now() });
  update('conversations', c.id, { project_id: id });
  log(user.id, 'proyecto', id, 'crear_desde_chat', { chat: c.id });
  return { id };
});
r('PUT', '/api/conversations/:id', 'operador', ({ params, body, user }) => {
  const p = {}; for (const k of ['title', 'pinned', 'archived']) if (body[k] !== undefined) p[k] = typeof body[k] === 'boolean' ? +body[k] : body[k];
  update('conversations', +params.id, p); log(user.id, 'chat', +params.id, 'editar', p); emit('conv.updated', { id: +params.id });
  return { ok: true };
});
r('DELETE', '/api/conversations/:id', 'operador', ({ params, user }) => { R.abortConv(+params.id); update('conversations', +params.id, { deleted_at: now() }); log(user.id, 'chat', +params.id, 'eliminar'); return { ok: true }; });
r('GET', '/api/conversations/:id/md', 'observador', ({ params, res }) => {
  const c = one('select * from conversations where id=?', +params.id);
  const ag = one('select name from agents where id=?', c.agent_id)?.name;
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="chat-${c.id}.md"` });
  res.end(`# ${c.title}\n\nAgente: ${ag} · ${c.model} · ${c.effort} · ${c.created_at}\n\n${transcript(c.id)}\n`);
  return RAW;
});
r('POST', '/api/permissions/:rid', 'operador', async ({ params, body, user }) => { await R.answerPermission(params.rid, !!body.allow, user.id); return { ok: true }; });

// ---------- adjuntos (se entregan en .oficina/adjuntos de la carpeta de trabajo antes del turno) ----------
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;
r('POST', '/api/attachments', 'operador', ({ req, query, body, user }) => {
  need(body.length, 'Archivo vacío');
  const name = String(query.name || 'archivo').replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').slice(0, 120);
  const task_id = +query.task_id || null, conversation_id = +query.conversation_id || null;
  if (task_id) need(one('select 1 from tasks where id=?', task_id), 'Tarea inexistente');
  if (conversation_id) need(one('select 1 from conversations where id=?', conversation_id), 'Conversación inexistente');
  const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
  fs.writeFileSync(path.join(DATA, 'attachments', stored), body);
  const id = insert('attachments', { task_id, conversation_id, name, mime: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), size: body.length, stored, uploaded_by: user.id, at: now() });
  log(user.id, task_id ? 'tarea' : 'chat', task_id || conversation_id, 'adjuntar', { name, size: body.length });
  if (task_id) emit('task.updated', { id: task_id, project_id: one('select project_id from tasks where id=?', task_id).project_id });
  if (conversation_id) emit('conv.updated', { id: conversation_id });
  return { id, name, size: body.length };
}, { raw: true });
r('GET', '/api/attachments/:id', 'observador', ({ params, res }) => {
  const a = one('select * from attachments where id=?', +params.id); need(a, 'No existe', 404);
  const inline = INLINE.test(a.mime);
  res.writeHead(200, { 'Content-Type': inline ? a.mime : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.name.replace(/"/g, '')}"`, 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, max-age=3600' });
  fs.createReadStream(path.join(DATA, 'attachments', a.stored)).pipe(res);
  return RAW;
});
r('DELETE', '/api/attachments/:id', 'operador', ({ params, user }) => {
  const a = one('select * from attachments where id=?', +params.id); need(a, 'No existe', 404);
  run('delete from attachments where id=?', a.id);
  fs.rmSync(path.join(DATA, 'attachments', a.stored), { force: true });
  log(user.id, 'adjunto', a.id, 'eliminar', { name: a.name });
  if (a.task_id) emit('task.updated', { id: a.task_id }); if (a.conversation_id) emit('conv.updated', { id: a.conversation_id });
  return { ok: true };
});
r('GET', '/api/runs/:id/log', 'observador', ({ params, query }) => {
  const x = one('select * from runs where id=?', +params.id); need(x, 'No existe', 404);
  const txt = x.log_path && fs.existsSync(x.log_path) ? fs.readFileSync(x.log_path, 'utf8') : '';
  return { run: x, log: query.full ? txt : txt.slice(-200000) };
});

// ---------- bandeja, notificaciones, búsqueda, historial ----------
r('GET', '/api/inbox', 'observador', () => ({
  tasks: all(`select id, title, status, project_id, agent_id, updated_at from tasks where status in ('esperando','revision','pausada_cuota','fallida') and deleted_at is null order by updated_at`),
  chats: all(`select id, title, agent_id, updated_at from conversations where status='esperando' and kind='consulta_rapida' and deleted_at is null order by updated_at`),
  permissions: [...R.pendingPerms.entries()].map(([id, p]) => ({ request_id: id, conv_id: p.convId, task_id: p.taskId, input: p.input })),
  notifications: all('select * from notifications order by id desc limit 50'), unseen: one('select count(*) n from notifications where seen=0').n,
}));
r('POST', '/api/notifications/seen', 'observador', ({ body }) => { if (body.ids?.length) run(`update notifications set seen=1 where id in (${body.ids.map(Number).join(',')})`); else run('update notifications set seen=1'); return { ok: true }; });
r('GET', '/api/search', 'observador', ({ query }) => {
  const q = String(query.q || '').trim(); if (!q) return [];
  const term = q.split(/\s+/).map(w => '"' + w.replace(/"/g, '') + '"*').join(' ');
  return all(`select kind, ref, title, snippet(fts, 3, '«', '»', '…', 14) snip from fts where fts match ? order by rank limit 50`, term).map(x => {
    if (x.kind === 'mensaje') { const c = one('select id, title, kind, task_id, deleted_at from conversations where id=?', x.ref); if (!c || c.deleted_at) return null; return { ...x, title: c.title, link: c.task_id && c.kind === 'tarea' ? `#/tarea/${c.task_id}` : `#/cantina/${c.id}` }; }
    if (x.kind === 'tarea') return { ...x, link: `#/tarea/${x.ref}` };
    return { ...x, link: `#/kanban/${x.ref}` };
  }).filter(Boolean);
});
function filters(query, map) {
  const w = [], p = [];
  for (const [k, col] of Object.entries(map)) if (query[k]) {
    if (k === 'from') { w.push(`${col} >= ?`); p.push(query.from); }
    else if (k === 'to') { w.push(`${col} <= ?`); p.push(query.to + 'T23:59:59'); }
    else if (k === 'q') { w.push(`(${col.split('|').map(c => c + ' like ?').join(' or ')})`); for (const _ of col.split('|')) p.push(`%${query.q}%`); }
    else { w.push(`${col} = ?`); p.push(isNaN(query[k]) ? query[k] : +query[k]); }
  }
  return { where: w.length ? ' and ' + w.join(' and ') : '', p };
}
const HIST = {
  chats: q => { const f = filters(q, { agent_id: 'c.agent_id', project_id: 'c.project_id', user_id: 'c.created_by', from: 'c.created_at', to: 'c.created_at', q: 'c.title' });
    return all(`select c.id, c.kind, c.title, c.agent_id, c.model, c.effort, c.status, c.task_id, c.project_id, c.created_by, c.created_at, c.updated_at,
      (select count(*) from runs where conversation_id=c.id) turnos, (select coalesce(sum(tokens_in+tokens_out),0) from runs where conversation_id=c.id) tokens
      from conversations c where c.deleted_at is null and c.kind in ('consulta_rapida','tarea')${f.where} order by c.updated_at desc`, ...f.p); },
  tareas: q => { const f = filters(q, { agent_id: 't.agent_id', project_id: 't.project_id', area_id: 't.area_id', status: 't.status', user_id: 't.created_by', from: 't.updated_at', to: 't.updated_at', q: 't.title|t.prompt' });
    return all(`select t.id, t.title, t.status, t.project_id, t.area_id, t.agent_id, t.model, t.effort, t.executor, t.created_by, t.created_at, t.updated_at,
      (select count(*) from runs where task_id=t.id) runs, (select count(*) from handoffs where task_id=t.id) relevos from tasks t where t.deleted_at is null${f.where} order by t.updated_at desc`, ...f.p); },
  ejecuciones: q => { const f = filters(q, { agent_id: 'r.agent_id', user_id: 'r.started_by', status: 'r.end_reason', from: 'r.started_at', to: 'r.started_at', project_id: 'c.project_id', q: 'r.command' });
    return all(`select r.id, r.conversation_id, r.task_id, r.agent_id, r.model, r.effort, r.turn, r.started_by, r.started_at, r.ended_at, r.exit_code, r.end_reason,
      r.tokens_in, r.tokens_out, r.cost_usd, r.command from runs r left join conversations c on c.id=r.conversation_id where c.kind != 'prueba'${f.where} order by r.id desc`, ...f.p); },
  relevos: q => { const f = filters(q, { agent_id: 'h.from_agent_id', user_id: 'h.created_by', from: 'h.at', to: 'h.at', q: 'h.reason' });
    return all(`select h.id, h.task_id, h.from_agent_id, h.to_agent_id, h.to_user_id, h.reason, h.commit_sha, h.created_by, h.at from handoffs h where 1=1${f.where} order by h.id desc`, ...f.p); },
  notificaciones: q => { const f = filters(q, { status: 'kind', from: 'at', to: 'at', q: 'title|body' });
    return all(`select * from notifications where 1=1${f.where} order by id desc`, ...f.p); },
  bitacora: q => { const f = filters(q, { user_id: 'a.user_id', status: 'a.entity', from: 'a.at', to: 'a.at', q: 'a.action|a.detail' });
    return all(`select a.*, u.name user from activity a left join users u on u.id=a.user_id where 1=1${f.where} order by a.id desc`, ...f.p); },
  papelera: () => [
    ...all(`select 'projects' entity, id, name title, deleted_at from projects where deleted_at is not null`),
    ...all(`select 'tasks' entity, id, title, deleted_at from tasks where deleted_at is not null`),
    ...all(`select 'conversations' entity, id, title, deleted_at from conversations where deleted_at is not null`)].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)),
  consejos: q => { const f = filters(q, { user_id: 'r.created_by', from: 'r.at', to: 'r.at' });
    return all(`select r.id, r.status, r.lenses, r.agents, r.project_ids, r.created_by, r.at, (select count(*) from proposals where review_id=r.id) propuestas,
      (select count(*) from proposals where review_id=r.id and status in ('aceptada','convertida')) aceptadas from reviews r where 1=1${f.where} order by r.id desc`, ...f.p); },
};
const csv = rows => { if (!rows.length) return ''; const k = Object.keys(rows[0]); return [k.join(','), ...rows.map(r => k.map(x => `"${String(r[x] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n'); };
r('GET', '/api/history/:tab', 'observador', ({ params, query, res }) => {
  const fn = HIST[params.tab]; need(fn, 'Pestaña inválida', 404);
  const rows = fn(query);
  if (query.format === 'csv') { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${params.tab}.csv"` }); res.end('﻿' + csv(rows)); return RAW; }
  const page = Math.max(1, +query.page || 1), size = 50;
  return { total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) };
});
r('GET', '/api/history/tareas/:id/timeline', 'observador', ({ params }) => all(`select h.*, u.name user from task_history h left join users u on u.id=h.user_id where task_id=? order by id`, +params.id));
r('GET', '/api/handoffs/:id', 'observador', ({ params }) => one('select * from handoffs where id=?', +params.id));
const TRASH = { projects: 'proyecto', tasks: 'tarea', conversations: 'chat' };
r('POST', '/api/restore', 'operador', ({ body, user }) => { need(TRASH[body.entity], 'Entidad inválida'); update(body.entity, +body.id, { deleted_at: null }); log(user.id, TRASH[body.entity], +body.id, 'restaurar'); return { ok: true }; });
r('POST', '/api/purge', 'admin', ({ body, user }) => { need(TRASH[body.entity], 'Entidad inválida'); run(`delete from ${body.entity} where id=? and deleted_at is not null`, +body.id); log(user.id, TRASH[body.entity], +body.id, 'purgar'); return { ok: true }; });

// ---------- Puente de Mando ----------
r('GET', '/api/status', 'observador', () => S.status());
r('POST', '/api/status/scan', 'operador', async () => { await S.scan(); return S.status(); });
r('GET', '/api/status/history', 'observador', ({ query }) => S.history(+query.hours || 24));
r('POST', '/api/agents/:id/test', 'operador', ({ params, user }) => S.testAgent(+params.id, user.id));
r('POST', '/api/notify/test', 'operador', ({ query }) => { if (query.toast) bus.emit('toast', { title: 'Prueba de notificación', body: 'La Fuerza está con la oficina.', link: '#/puente' }); else notify('sistema', 'Prueba de notificación', 'La Fuerza está con la oficina.', '#/puente'); return { ok: true }; });
r('POST', '/api/worktrees/clean', 'operador', async ({ body, user }) => {
  const f = one('select * from project_folders where id=?', +body.folder_id); need(f, 'Carpeta inválida');
  await host.call(f.machine_id || host.defaultMachine(), 'removeWorktree', { repo: f.path, path: body.path });
  log(user.id, 'git', f.id, 'limpiar_worktree', { path: body.path });
  return { ok: true };
});
r('POST', '/api/order66', 'admin', ({ user }) => ({ stopped: R.order66(user.id) }));
r('POST', '/api/queue/resume', 'admin', ({ user }) => { R.resumeQueue(user.id); return { ok: true }; });
r('POST', '/api/backup', 'admin', ({ user }) => { const f = S.backup(); log(user.id, 'sistema', null, 'respaldo', { f }); return { file: f }; });

// ---------- Configuración (admin) ----------
const AGENT_FIELDS = ['name', 'exe', 'pre_args', 'extra_args', 'models', 'efforts', 'default_model', 'default_effort', 'enabled', 'max_concurrent', 'timeout_min', 'quota_patterns', 'prices', 'color', 'adapter'];
r('GET', '/api/agents', 'admin', () => all('select * from agents order by id').map(a => ({ ...a, pre_args: J(a.pre_args, []), extra_args: J(a.extra_args, []), models: J(a.models, []), efforts: J(a.efforts, []), prices: J(a.prices, {}), quota_patterns: J(a.quota_patterns, []), last_test: J(a.last_test) })));
function agentPatch(body) {
  const p = {};
  for (const k of AGENT_FIELDS) if (body[k] !== undefined) p[k] = body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : typeof body[k] === 'boolean' ? +body[k] : body[k];
  if (p.adapter) need(R.ADAPTERS[p.adapter], 'Adaptador inválido');
  if (p.quota_patterns) for (const x of J(p.quota_patterns, [])) { try { new RegExp(x); } catch { throw new HttpError(400, 'Regex inválida: ' + x); } }
  return p;
}
r('POST', '/api/agents', 'admin', ({ body, user }) => {
  need(body.key && body.adapter && body.exe, 'key, adapter y exe requeridos');
  const id = insert('agents', { key: body.key, ...agentPatch(body) }); log(user.id, 'config', id, 'crear_agente', { key: body.key }); return { id };
});
r('PUT', '/api/agents/:id', 'admin', ({ params, body, user }) => {
  const p = agentPatch(body); update('agents', +params.id, p); log(user.id, 'config', +params.id, 'editar_agente', Object.keys(p)); emit('agent.status', { id: +params.id }); R.pump(); return { ok: true };
});
r('POST', '/api/agents/:id/reactivate', 'operador', ({ params, user }) => { update('agents', +params.id, { status: 'disponible', quota_reset_at: null, last_error: null }); log(user.id, 'agente', +params.id, 'reactivar'); emit('agent.status', { id: +params.id }); R.pump(); return { ok: true }; });
r('POST', '/api/agents/:id/detect-models', 'admin', async ({ params }) => {
  const a = one('select * from agents where id=?', +params.id);
  return { models: await host.call(host.defaultMachine(), 'detectModels', { adapter: a.adapter, exe: a.exe, pre_args: J(a.pre_args, []) }) };
});
r('POST', '/api/areas', 'admin', ({ body, user }) => { need(body.name, 'Nombre requerido'); const id = insert('areas', { name: body.name, alias: body.alias || body.name, icon: body.icon || 'radar', color: body.color || '#ffe81f', default_agent_id: body.default_agent_id || null, fallback_chain: JSON.stringify(body.fallback_chain || []), auto_fallback: +!!body.auto_fallback }); log(user.id, 'config', id, 'crear_area'); return { id }; });
r('PUT', '/api/areas/:id', 'admin', ({ params, body, user }) => {
  const p = {}; for (const k of ['name', 'alias', 'icon', 'color', 'default_agent_id', 'auto_fallback']) if (body[k] !== undefined) p[k] = typeof body[k] === 'boolean' ? +body[k] : body[k];
  if (body.fallback_chain) p.fallback_chain = JSON.stringify(body.fallback_chain.map(Number));
  update('areas', +params.id, p); log(user.id, 'config', +params.id, 'editar_area', p); return { ok: true };
});
r('DELETE', '/api/areas/:id', 'admin', ({ params, user }) => { update('areas', +params.id, { deleted_at: now() }); log(user.id, 'config', +params.id, 'eliminar_area'); return { ok: true }; });
r('POST', '/api/templates', 'operador', ({ body, user }) => { const id = insert('templates', { area_id: body.area_id || null, title: body.title, prompt: body.prompt }); log(user.id, 'config', id, 'crear_plantilla'); return { id }; });
r('PUT', '/api/templates/:id', 'operador', ({ params, body }) => { update('templates', +params.id, { area_id: body.area_id || null, title: body.title, prompt: body.prompt }); return { ok: true }; });
r('DELETE', '/api/templates/:id', 'operador', ({ params }) => { run('delete from templates where id=?', +params.id); return { ok: true }; });
r('GET', '/api/users', 'admin', () => all('select id, username, email, name, role, avatar, created_at, deleted_at from users'));
r('POST', '/api/users', 'admin', ({ body, user }) => {
  need(body.username && body.password?.length >= 6, 'Usuario y contraseña (mín. 6) requeridos'); need(LEVEL[body.role] != null, 'Rol inválido');
  need(!one('select 1 from users where username=?', body.username), 'El usuario ya existe');
  const id = insert('users', { username: body.username, name: body.name || body.username, pass_hash: hashPw(body.password), role: body.role, created_at: now() });
  log(user.id, 'usuario', id, 'crear', { rol: body.role }); return { id };
});
r('PUT', '/api/users/:id', 'admin', ({ params, body, user }) => {
  const p = {}; if (body.name) p.name = body.name; if (body.role) { need(LEVEL[body.role] != null, 'Rol inválido'); p.role = body.role; }
  if (body.password) { need(body.password.length >= 6, 'Contraseña mínimo 6'); p.pass_hash = hashPw(body.password); }
  if (body.deleted === false) p.deleted_at = null;
  update('users', +params.id, p); log(user.id, 'usuario', +params.id, 'editar', Object.keys(p)); return { ok: true };
});
r('DELETE', '/api/users/:id', 'admin', ({ params, user }) => { need(+params.id !== user.id, 'No puedes eliminarte a ti mismo'); update('users', +params.id, { deleted_at: now() }); run('delete from sessions where user_id=?', +params.id); log(user.id, 'usuario', +params.id, 'eliminar'); return { ok: true }; });
r('GET', '/api/limits', 'observador', () => all(`select * from agent_limits where source='manual'`));
r('POST', '/api/limits', 'admin', ({ body, user }) => {
  need(['5h', 'dia', 'semana', 'mes'].includes(body.win) && ['tokens', 'usd', 'runs'].includes(body.metric) && +body.limit_value > 0, 'Límite inválido');
  run(`insert into agent_limits(agent_id,source,win,metric,limit_value,updated_at) values(?,?,?,?,?,?) on conflict(agent_id,source,win,metric) do update set limit_value=excluded.limit_value, updated_at=excluded.updated_at`, +body.agent_id, 'manual', body.win, body.metric, +body.limit_value, now());
  log(user.id, 'config', +body.agent_id, 'limite', body); return { ok: true };
});
r('DELETE', '/api/limits/:id', 'admin', ({ params }) => { run(`delete from agent_limits where id=? and source='manual'`, +params.id); return { ok: true }; });
r('PUT', '/api/settings', 'admin', ({ body, user }) => {
  for (const k of ['council_auto_n', 'council_auto_agents', 'divert_at_80', 'lenses', 'scan_min', 'checkpoint_exclude', 'default_machine']) if (body[k] !== undefined) setSetting(k, body[k]);
  log(user.id, 'config', null, 'ajustes', Object.keys(body)); return { ok: true };
});

// ---------- Consejo Jedi ----------
r('POST', '/api/council/digest', 'operador', ({ body }) => C.digest(body.scope || {}));
r('POST', '/api/council', 'operador', async ({ body, user }) => ({ id: await C.convene(body, user.id) }));
r('GET', '/api/council', 'observador', () => HIST.consejos({}));
r('GET', '/api/council/:id', 'observador', ({ params }) => {
  const rv = one('select * from reviews where id=?', +params.id); need(rv, 'No existe', 404);
  return { review: { ...rv, lenses: J(rv.lenses, []), agents: J(rv.agents, []), project_ids: J(rv.project_ids, []), scope: J(rv.scope, {}) },
    proposals: all('select * from proposals where review_id=? order by votes desc, id', rv.id),
    conversations: all(`select id, title, agent_id, status from conversations where kind='consejo' and title like ?`, `Consejo #${rv.id} ·%`) };
});
r('POST', '/api/proposals/:id/accept', 'operador', ({ params, body, user }) => ({ task_id: C.accept(+params.id, user.id, body) }));
r('POST', '/api/proposals/:id/decide', 'operador', ({ params, body, user }) => { need(['descartada', 'pospuesta', 'propuesta'].includes(body.status), 'Estado inválido'); C.decide(+params.id, body.status, user.id, body.reason); return { ok: true }; });
r('POST', '/api/proposals/:id/detail', 'operador', ({ params, user }) => {
  const p = one('select * from proposals where id=?', +params.id); need(p.conversation_id, 'La propuesta no tiene conversación');
  const text = `Amplía con más detalle la propuesta "${p.title}": pasos concretos, archivos afectados, riesgos y criterio de aceptación.`;
  R.runTurn(p.conversation_id, text, { userId: user.id, prompt: text }).catch(() => {});
  return { conv_id: p.conversation_id };
});

// ---------- HTTP ----------
const RAW = Symbol('raw');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUB = path.join(__dirname, 'public');
function readBody(req, raw) {
  const max = raw ? 25e6 : 5e6;
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > max) { rej(new HttpError(413, raw ? 'Archivo demasiado grande (máx. 25 MB)' : 'Cuerpo demasiado grande')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { const b = Buffer.concat(chunks); if (raw) return res(b); try { res(b.length ? JSON.parse(b.toString('utf8')) : {}); } catch { rej(new HttpError(400, 'JSON inválido')); } });
  });
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(SECURE ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};
// rutas del agente de campo: autenticadas con su token, no con sesión de usuario
async function handleWorker(req, res, url) {
  const m = host.authWorker(req);
  if (!m) { res.writeHead(401); return res.end('token inválido'); }
  const json = x => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x ?? null)); };
  const p = url.pathname.slice('/api/worker/'.length);
  if (req.method === 'GET' && p === 'stream') return host.attachStream(m, req, res);
  if (req.method === 'POST' && p === 'hello') return json(host.hello(m, await readBody(req)));
  if (req.method === 'POST' && p === 'reply') return json(host.reply(m, await readBody(req)));
  if (req.method === 'POST' && p === 'events') return json(host.events(m, (await readBody(req)).events));
  const at = /^attachments\/(\d+)$/.exec(p);
  if (req.method === 'GET' && at) { const f = one('select * from attachments where id=?', +at[1]); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return fs.createReadStream(path.join(DATA, 'attachments', f.stored)).pipe(res); }
  res.writeHead(404); res.end();
}
function sse(req, res, user) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ user: user.id })}\n\n`);
  const fn = ev => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  bus.on('ev', fn);
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { bus.off('ev', fn); clearInterval(hb); });
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/worker/')) return handleWorker(req, res, url).catch(e => { if (!res.headersSent) res.writeHead(400); res.end(String(e.message)); });
  if (url.pathname.startsWith('/api/')) {
    const user = userOf(req);
    if (url.pathname === '/api/events') { if (!user) { res.writeHead(401); return res.end(); } return sse(req, res, user); }
    const route = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    try {
      need(route, 'Ruta no encontrada', 404);
      if (req.method !== 'GET') need(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 'Origen no permitido', 403);
      if (route.role) { need(user, 'Inicia sesión', 401); need(LEVEL[user.role] >= LEVEL[route.role], 'No tienes permiso para esto', 403); }
      const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req, route.raw) : {};
      const out = await route.fn({ req, res, user, body, params: route.re.exec(url.pathname).groups || {}, query: Object.fromEntries(url.searchParams) });
      if (out === RAW) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out ?? null));
    } catch (e) {
      const code = e.code >= 400 && e.code < 600 ? e.code : 400;
      if (!(e instanceof HttpError) && !/Transición|ejecución|bloqueada|Elige|Tarea humana|deshabilitado|permiso|Conflicto|rama|JSON|agente/i.test(e.message)) S.pushError(e);
      if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  let f = '';
  try { f = path.resolve(PUB, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname))); } catch {}
  // cualquier ruta que no sea un archivo público → al login (la SPA manda a la estación si ya hay sesión)
  if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(302, { Location: '/#/login' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer((req, res) => handle(req, res).catch(e => { S.pushError(e); try { res.writeHead(500); res.end(); } catch {} }));
server.requestTimeout = 0;
server.headersTimeout = 60000;

function startServer(port = PORT) {
  R.recover();
  setInterval(R.quotaTick, 30000);
  const scanLoop = () => S.scan().catch(S.pushError).finally(() => setTimeout(scanLoop, Math.max(1, +setting('scan_min', 5)) * 60000));
  setTimeout(scanLoop, 1000);
  setInterval(S.dailyBackup, 3600e3); setTimeout(S.dailyBackup, 5000);
  // retrospectiva semanal opcional
  setInterval(() => {
    const w = setting('council_weekly', null); if (!w) return;
    const last = setting('council_weekly_last', null);
    if (last && Date.now() - Date.parse(last) < 7 * 86400e3) return;
    setSetting('council_weekly_last', now());
    for (const p of all(`select id from projects where status='activo' and deleted_at is null`)) C.convene({ scope: { project_ids: [p.id], last_n: 20 }, lenses: ['siguiente', 'retro'], agents: w.agents || [] }, null).catch(() => {});
  }, 3600e3);
  bus.on('project.completed', ({ id }) => { if (setting('council_auto_n', 0)) C.convene({ scope: { project_ids: [id], last_n: 30 }, lenses: ['retro', 'deuda', 'documentacion'], agents: setting('council_auto_agents', []).length ? setting('council_auto_agents', []) : [{ agent_id: one('select id from agents where enabled=1 order by id').id }] }, null).catch(() => {}); });
  process.on('uncaughtException', S.pushError);
  process.on('unhandledRejection', S.pushError);
  if (AUTH === 'google' && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !ALLOWED.length)) throw new Error('OFICINA_AUTH=google requiere GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y OFICINA_ALLOWED_EMAILS');
  const bind = process.env.OFICINA_BIND || '127.0.0.1';
  return new Promise(res => server.listen(port, bind, () => { console.log(`★ Oficina Virtual en http://${bind}:${port} (login: ${AUTH}, ejecución local: ${host.LOCAL_EXEC ? 'sí' : 'no'})`); res(server); }));
}
// CLI: `node server.js crear-maquina "PC Oficina"` imprime solo el token (para crear worker.json sin pasar por la web)
if (require.main === module && process.argv[2] === 'crear-maquina') { process.stdout.write(host.createMachine(process.argv[3] || 'PC', null).token + '\n'); process.exit(0); }
else if (require.main === module) startServer();
module.exports = { server, startServer, hashPw, checkPw };
