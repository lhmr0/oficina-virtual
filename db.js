// Esquema SQLite + helpers + bus de eventos (SSE)
const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const DATA0 = process.env.OFICINA_DATA || path.join(__dirname, 'data');
for (const d of ['', 'runs', 'sandbox', 'backups']) fs.mkdirSync(path.join(DATA0, d), { recursive: true });
const DATA = fs.realpathSync.native(DATA0);

const db = new DatabaseSync(path.join(DATA, 'oficina.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
create table if not exists users (id integer primary key, username text unique not null, name text, pass_hash text not null,
  role text not null default 'operador', avatar text default 'rebel', notif_prefs text default '{}', created_at text, deleted_at text);
create table if not exists sessions (token text primary key, user_id integer not null, expires_at integer not null);
create table if not exists projects (id integer primary key, name text not null, code text, kind text not null default 'solo_registro',
  status text not null default 'planificacion', description text default '', briefing text default '', color text default '#ffe81f',
  created_by integer, created_at text, updated_at text, deleted_at text);
create table if not exists project_folders (id integer primary key, project_id integer not null, label text, path text not null,
  is_git integer default 0, use_worktrees integer default 1, is_default integer default 0);
create table if not exists areas (id integer primary key, name text not null, alias text, icon text, color text,
  default_agent_id integer, fallback_chain text default '[]', auto_fallback integer default 0, deleted_at text);
create table if not exists agents (id integer primary key, key text unique not null, name text, adapter text not null, exe text not null,
  pre_args text default '[]', extra_args text default '[]', models text default '[]', efforts text default '[]',
  default_model text default '', default_effort text default '', enabled integer default 1, max_concurrent integer default 2,
  timeout_min integer default 30, quota_patterns text default '[]', color text, status text default 'disponible',
  quota_reset_at text, last_test text, last_error text);
create table if not exists tasks (id integer primary key, project_id integer not null, area_id integer, folder_id integer, parent_id integer,
  title text not null, prompt text default '', executor text default 'agente', agent_id integer, assignee_user_id integer,
  model text, effort text, mode text default 'editar', status text not null default 'pendiente', priority text default 'media',
  due_date text, kanban_order real default 0, conversation_id integer, branch text, worktree_path text, depends_on text default '[]',
  attempts integer default 0, summary text, proposal_id integer, base_branch text, review_comment text, created_by integer, assigned_by integer,
  created_at text, updated_at text, deleted_at text);
create table if not exists conversations (id integer primary key, kind text not null default 'consulta_rapida', task_id integer,
  project_id integer, title text, agent_id integer, model text, effort text, mode text default 'plan', session_id text,
  folder_path text, status text default 'inactiva', pinned integer default 0, archived integer default 0, context text,
  created_by integer, created_at text, updated_at text, deleted_at text);
create table if not exists messages (id integer primary key, conversation_id integer not null, role text not null, user_id integer,
  agent_id integer, text text not null, kind text default 'mensaje', at text);
create table if not exists runs (id integer primary key, conversation_id integer, task_id integer, agent_id integer, model text, effort text,
  turn integer, command text, pid integer, started_by integer, started_at text, ended_at text, exit_code integer, end_reason text,
  tokens_in integer default 0, tokens_out integer default 0, cost_usd real default 0, log_path text, diff_stat text);
create table if not exists task_history (id integer primary key, task_id integer, field text, old_value text, new_value text, user_id integer, at text);
create table if not exists handoffs (id integer primary key, task_id integer, conversation_id integer, from_agent_id integer, to_agent_id integer,
  to_user_id integer, reason text, snapshot_md text, commit_sha text, created_by integer, at text);
create table if not exists templates (id integer primary key, area_id integer, title text, prompt text);
create table if not exists activity (id integer primary key, user_id integer, entity text, entity_id integer, action text, detail text, at text);
create table if not exists notifications (id integer primary key, kind text, title text, body text, link text, seen integer default 0, at text);
create table if not exists agent_limits (id integer primary key, agent_id integer, source text, win text, metric text,
  limit_value real, used_value real, resets_at text, updated_at text, unique(agent_id, source, win, metric));
create table if not exists status_snapshots (id integer primary key, agent_id integer, state text, detail text, at text);
create table if not exists reviews (id integer primary key, project_ids text, scope text, lenses text, agents text, moderator_id integer,
  digest_md text, status text default 'en_curso', error text, created_by integer, at text);
create table if not exists proposals (id integer primary key, review_id integer, title text, description text, lens text, impact text,
  effort text, suggested_area text, suggested_agent text, votes integer default 1, kind text default 'tarea', status text default 'propuesta',
  discard_reason text, task_id integer, conversation_id integer, project_id integer, decided_by integer, at text);
create table if not exists settings (key text primary key, value text);
create table if not exists machines (id integer primary key, name text not null, is_local integer default 0, token_hash text, info text,
  last_seen text, created_by integer, created_at text, deleted_at text);
create table if not exists attachments (id integer primary key, task_id integer, conversation_id integer, name text not null, mime text,
  size integer, stored text not null, uploaded_by integer, at text);

create virtual table if not exists fts using fts5(kind unindexed, ref unindexed, title, body);
create trigger if not exists fts_msg after insert on messages begin
  insert into fts(kind, ref, title, body) values ('mensaje', new.conversation_id, '', new.text); end;
create trigger if not exists fts_task_i after insert on tasks begin
  insert into fts(kind, ref, title, body) values ('tarea', new.id, new.title, new.prompt); end;
create trigger if not exists fts_task_u after update of title, prompt on tasks begin
  delete from fts where kind = 'tarea' and ref = new.id;
  insert into fts(kind, ref, title, body) values ('tarea', new.id, new.title, new.prompt); end;
create trigger if not exists fts_proj_i after insert on projects begin
  insert into fts(kind, ref, title, body) values ('proyecto', new.id, new.name, new.description || ' ' || new.briefing); end;
create trigger if not exists fts_proj_u after update of name, description, briefing on projects begin
  delete from fts where kind = 'proyecto' and ref = new.id;
  insert into fts(kind, ref, title, body) values ('proyecto', new.id, new.name, new.description || ' ' || new.briefing); end;
create index if not exists ix_tasks_project on tasks(project_id);
create index if not exists ix_msg_conv on messages(conversation_id);
create index if not exists ix_runs_conv on runs(conversation_id);
create index if not exists ix_activity_at on activity(at);
`);

// migraciones simples: columnas agregadas después de la primera versión
const addCol = (t, c, def) => { if (!db.prepare(`pragma table_info(${t})`).all().some(x => x.name === c)) db.exec(`alter table ${t} add column ${c} ${def}`); };
addCol('project_folders', 'machine_id', 'integer');
addCol('conversations', 'machine_id', 'integer');
addCol('users', 'email', 'text');
addCol('agents', 'prices', "text default '{}'");
addCol('agents', 'model_efforts', "text default '{}'");
fs.mkdirSync(path.join(DATA0, 'attachments'), { recursive: true });

const now = () => new Date().toISOString();
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

// insert({tabla, obj}) → id
function insert(table, obj) {
  const k = Object.keys(obj);
  return Number(run(`insert into ${table} (${k.join(',')}) values (${k.map(() => '?').join(',')})`, ...k.map(x => obj[x])).lastInsertRowid);
}
function update(table, id, obj) {
  const k = Object.keys(obj);
  if (k.length) run(`update ${table} set ${k.map(x => x + '=?').join(',')} where id=?`, ...k.map(x => obj[x]), id);
}

const bus = new EventEmitter();
bus.setMaxListeners(100);
const emit = (type, data) => bus.emit('ev', { type, data });

function log(user_id, entity, entity_id, action, detail = {}) {
  insert('activity', { user_id, entity, entity_id, action, detail: JSON.stringify(detail), at: now() });
  emit('activity', { entity, entity_id, action });
}

// Notificación: SSE a la oficina; si no hay ninguna pestaña conectada, toast de Windows en las máquinas (host.js)
const PORT = Number(process.env.OFICINA_PORT || 4242);
function notify(kind, title, body = '', link = '') {
  const id = insert('notifications', { kind, title, body: String(body).slice(0, 2000), link, at: now() });
  emit('notify', { id, kind, title, body: String(body).slice(0, 500), link });
  if (bus.listenerCount('ev') === 0 && !process.env.OFICINA_NO_TOAST) bus.emit('toast', { title, body, link });
  return id;
}

const setting = (key, def) => { const r = one('select value from settings where key=?', key); return r ? J(r.value, def) : def; };
const setSetting = (key, v) => run('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value', key, JSON.stringify(v));

// ---------- seed ----------
if (!one('select 1 from areas limit 1')) {
  const a = [['Documentación', 'Archivo Jedi', 'holocron', '#4fa3ff'], ['Desarrollo', 'Hangar', 'xwing', '#ff7a1a'], ['Análisis', 'Sala de Mando', 'radar', '#3ddc84']];
  for (const [name, alias, icon, color] of a) insert('areas', { name, alias, icon, color });
}
if (!one('select 1 from agents limit 1')) {
  const Q = ['usage limit', 'rate limit', '\\b429\\b', 'quota', 'insufficient credits', 'credit balance', 'try again at', 'limit reached'];
  const ccEntry = '%APPDATA%/npm/node_modules/command-code/dist/index.mjs'; // se expande en la máquina que ejecuta
  const ag = [
    { key: 'claude', name: 'Claude', adapter: 'claude', exe: 'claude', color: '#ff8c42',
      models: ['sonnet', 'opus', 'haiku', 'fable', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_model: 'sonnet', default_effort: 'medium' },
    { key: 'codex', name: 'Codex', adapter: 'codex', exe: 'codex', color: '#3ddc84',
      models: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_model: 'gpt-6-luna', default_effort: 'medium' },
    { key: 'antigravity', name: 'Antigravity', adapter: 'agy', exe: 'agy', color: '#4fa3ff',
      models: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-3.7-flash-high', 'gemini-3.7-flash-medium', 'gemini-3.7-flash-low', 'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low', 'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'], efforts: ['low', 'medium', 'high', 'max'], default_model: 'gemini-3.8-flash-high', default_effort: 'medium' },
    { key: 'commandcode', name: 'CommandCode', adapter: 'commandcode', exe: 'node', pre_args: [ccEntry], color: '#ff4d4d',
      models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3', 'zai-org/glm-5.3', 'qwen/qwen3.8-max'], efforts: ['low', 'medium', 'high', 'max'], default_model: 'deepseek/deepseek-v4-flash', default_effort: 'medium' },
  ];
  for (const x of ag) insert('agents', { ...x, pre_args: JSON.stringify(x.pre_args || []), models: JSON.stringify(x.models), efforts: JSON.stringify(x.efforts), quota_patterns: JSON.stringify(Q) });
  const areas = all('select id, name from areas');
  const id = k => one('select id from agents where key=?', k).id;
  for (const ar of areas) {
    const chain = ar.name === 'Desarrollo' ? ['claude', 'codex', 'commandcode'] : ar.name === 'Análisis' ? ['claude', 'antigravity', 'codex'] : ['antigravity', 'claude', 'codex'];
    update('areas', ar.id, { default_agent_id: id(chain[0]), fallback_chain: JSON.stringify(chain.map(id)) });
  }
  const tpl = [['Documentación', 'Documentar módulo', 'Documenta el módulo/carpeta indicado: propósito, uso, API pública y ejemplos. Crea o actualiza el README correspondiente.'],
    ['Desarrollo', 'Corregir bug', 'Reproduce el bug descrito, encuentra la causa raíz, corrígelo y agrega una prueba que falle sin el arreglo.'],
    ['Análisis', 'Analizar requerimiento', 'Analiza el requerimiento: alcance, riesgos, dependencias, y propone un plan en pasos concretos. No modifiques archivos.']];
  for (const [an, title, prompt] of tpl) insert('templates', { area_id: areas.find(a => a.name === an).id, title, prompt });
}
// Precio API en USD por 1M tokens: [entrada, salida, entrada en caché]. Fuentes oficiales, consultadas 2026-09-24:
// claude: platform.claude.com/docs/en/about-claude/pricing (sonnet=Sonnet 5, opus=Opus 5.5, haiku=Haiku 4.5, fable=Fable 5.1)
// codex: developers.openai.com/api/docs/pricing (contexto corto) · antigravity: ai.google.dev/gemini-api/docs/pricing (Flash: precio hasta 31/12/2026)
// commandcode: api-docs.deepseek.com (hora pico), platform.kimi.ai, docs.z.ai, alibabacloud.com model-studio (Singapur)
// Con suscripción (Claude Max, ChatGPT, etc.) no pagas esto: sirve como costo equivalente para comparar. Editable en Configuración → Agentes.
const PRICES = {
  claude: { sonnet: [2, 10, 0.2], opus: [4, 20, 0.2], haiku: [1, 5, 0.1], fable: [10, 50, 0.25] },
  codex: { 'gpt-5.6-terra': [2, 12, 0.2], 'gpt-5.6-sol': [4, 20, 0.4], 'gpt-5.6-luna': [0.2, 1.2, 0.02], 'gpt-5.5': [5, 30, 0.5], 'gpt-6-luna': [0.1, 0.5, 0.01], 'gpt-6-sol': [2, 10, 0.2], 'gpt-6-astra': [5, 25, 0.5] },
  antigravity: { 'gemini-3.8-flash-high': [0.75, 3.75], 'gemini-3.8-flash-medium': [0.75, 3.75], 'gemini-3.8-flash-low': [0.75, 3.75], 'gemini-3.1-pro-high': [2, 12], 'gemini-3.1-pro-low': [2, 12],
    'claude-sonnet-4-6': [3, 15, 0.3], 'claude-opus-4-6-thinking': [5, 25, 0.5] },
  commandcode: { 'deepseek/deepseek-v4-flash': [0.3, 1.2, 0.006], 'deepseek/deepseek-v4-pro': [1.32, 3.96, 0.044], 'moonshotai/kimi-k3': [3, 15, 0.3], 'zai-org/glm-5.3': [1.4, 4.4, 0.26], 'qwen/qwen3.8-max': [2, 6] },
};
for (const a of all("select id, key from agents where prices is null or prices in ('', '{}')")) if (PRICES[a.key]) update('agents', a.id, { prices: JSON.stringify(PRICES[a.key]) });

// sincronizar modelos y precios nuevos de Codex en bases existentes
const cxInit = one("select id, models, default_model, prices from agents where key='codex'");
if (cxInit) {
  const cur = J(cxInit.models, []);
  const fresh = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'];
  const missing = fresh.filter(m => !cur.includes(m));
  const def = (!cxInit.default_model || cxInit.default_model === 'gpt-5.6-terra') ? 'gpt-6-luna' : cxInit.default_model;
  if (missing.length || def !== cxInit.default_model) {
    update('agents', cxInit.id, { models: JSON.stringify([...new Set([...fresh, ...cur])]), default_model: def });
  }
  const curP = J(cxInit.prices, {});
  let pUp = false;
  for (const [m, pr] of Object.entries(PRICES.codex)) { if (!curP[m]) { curP[m] = pr; pUp = true; } }
  if (pUp) update('agents', cxInit.id, { prices: JSON.stringify(curP) });
}


module.exports = { db, DATA, PORT, now, all, one, run, J, insert, update, bus, emit, log, notify, setting, setSetting };
