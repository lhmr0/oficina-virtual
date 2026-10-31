// Harness: lee los chats que los 4 CLIs guardan en ESTA PC (Claude Code/Desktop, Codex, Antigravity, CommandCode),
// para verlos por proyecto y seguirlos desde la oficina con el mismo agente (misma sesión) o con otro (con el contexto).
// Solo lectura; lo usan hostops (servidor local) y el agente de campo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude', 'projects');
const CODEX_DB = path.join(HOME, '.codex', 'state_5.sqlite');
const AGY = path.join(HOME, '.gemini', 'antigravity-cli');
const CC = path.join(HOME, '.commandcode', 'projects');

const norm = p => String(p || '').replace(/^\\\\\?\\/, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const under = (p, r) => { p = norm(p); r = norm(r); return !!r && (p === r || p.startsWith(r + '\\')); };
const iso = v => { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const clip = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const sqlite = f => { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(f, { readOnly: true }); };
const lines = buf => buf.toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// texto que el CLI inyecta (recordatorios, salida de comandos locales, AGENTS.md): no es del usuario
const injected = t => /^\s*(<[a-z_-]+[\s>]|# AGENTS\.md|Caveat:)/i.test(t);
function readPart(f, from, len) { const fd = fs.openSync(f, 'r'); try { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, from); return b.subarray(0, n); } finally { fs.closeSync(fd); } }
// ponytail: el listado lee solo el inicio y el final de cada jsonl (rápido con archivos de decenas de MB); el título puede faltar si quedó en medio
function headTail(f, n = 256 * 1024) {
  const size = fs.statSync(f).size;
  if (size <= 2 * n) return lines(fs.readFileSync(f));
  const h = readPart(f, 0, n).toString('utf8'), t = readPart(f, size - n, n).toString('utf8');
  return lines(Buffer.from(h.slice(0, h.lastIndexOf('\n')) + '\n' + t.slice(t.indexOf('\n') + 1)));
}

// cada ruta ya tiene limit sesiones: dejar de leer archivos
const enough = (out, paths, limit) => paths.every(p => out.filter(s => under(s.cwd, p)).length >= limit);

// ---------- uso de la ventana de contexto (lo que muestra /context en Claude Code) ----------
// ponytail: ventanas conocidas por modelo (Codex trae la suya exacta); si lo medido la supera, se asume 1M. Revisar al salir modelos nuevos
function ctxWindow(agent, model) {
  const m = String(model || '').toLowerCase();
  if (agent === 'claude') return /\[1m\]/.test(m) || (/-[5-9]-/.test(m) && !/haiku/.test(m)) ? 1e6 : 2e5;
  if (agent === 'agy') return 1048576;
  return 2e5;
}
function ctxOf(agent, model, used, { window = null, estimated = false } = {}) {
  if (!used) return null;
  let w = window || ctxWindow(agent, model);
  if (used > w && !estimated) w = Math.max(1e6, used); // medido: la ventana real es mayor; estimado: se queda en tope
  return { used: Math.round(used), window: w, pct: Math.min(100, Math.round(used / w * 100)), estimated };
}

// ---------- Claude Code / Claude Desktop: ~/.claude/projects/<ruta codificada>/<sesión>.jsonl ----------
const claudeText = m => {
  const c = m?.content;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : []).filter(b => b.type === 'text').map(b => b.text).join('\n');
};
function claudeMsgs(L) {
  const out = [];
  for (const o of L) {
    if (o.isSidechain || o.isMeta || !['user', 'assistant'].includes(o.type)) continue;
    const t = claudeText(o.message).trim();
    if (!t || injected(t)) continue;
    const role = o.type === 'user' ? 'usuario' : 'agente';
    const last = out[out.length - 1];
    if (last?.role === role && role === 'agente') last.text += '\n\n' + t; else out.push({ role, text: t, at: o.timestamp });
  }
  return out;
}
function claudeMeta(L) {
  const m = { title: null, cwd: null, permission_mode: null, source: null, model: null, branch: null, used: 0 };
  for (const o of L) {
    // contexto = lo que entró al modelo en la última respuesta (tras /compact, la siguiente respuesta ya viene chica)
    const u = o.type === 'assistant' && !o.isSidechain && o.message?.usage;
    if (u) m.used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
    if (o.type === 'system' && o.subtype === 'compact_boundary') m.used = o.compactMetadata?.postTokens || 0;
    if (o.type === 'custom-title' || o.type === 'ai-title') m.title = o.customTitle || o.aiTitle || m.title;
    if (o.type === 'summary' && !m.title) m.title = o.summary;
    if (o.cwd) m.cwd = o.cwd;
    if (o.permissionMode) m.permission_mode = o.permissionMode;
    if (o.entrypoint) m.source = o.entrypoint;
    if (o.gitBranch) m.branch = o.gitBranch;
    if (o.type === 'assistant' && o.message?.model && o.message.model !== '<synthetic>') m.model = o.message.model;
  }
  return m;
}
function claudeList(paths, limit) {
  if (!fs.existsSync(CLAUDE)) return [];
  const pre = paths.map(p => norm(p).replace(/[^a-z0-9]/g, '-'));
  const files = [];
  for (const d of fs.readdirSync(CLAUDE)) {
    if (!pre.some(x => d.toLowerCase().startsWith(x))) continue;
    for (const f of fs.readdirSync(path.join(CLAUDE, d))) if (f.endsWith('.jsonl')) { const full = path.join(CLAUDE, d, f); files.push({ full, mtime: fs.statSync(full).mtimeMs }); }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const { full, mtime } of files) {
    if (enough(out, paths, limit)) break;
    const L = headTail(full), m = claudeMeta(L);
    if (!m.cwd || !paths.some(p => under(m.cwd, p) && !enough(out, [p], limit))) continue;
    const msgs = claudeMsgs(L);
    if (!msgs.length) continue;
    const lastUser = [...msgs].reverse().find(x => x.role === 'usuario');
    out.push({ agent: 'claude', id: path.basename(full, '.jsonl'), cwd: m.cwd, title: clip(m.title || msgs[0].text, 90), updated_at: iso(mtime),
      preview: clip(msgs[msgs.length - 1].text), last_user: clip(lastUser?.text), source: m.source, permission_mode: m.permission_mode, model: m.model, branch: m.branch, ctx: ctxOf('claude', m.model, m.used) });
  }
  return out;
}
function claudeFile(id) {
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(CLAUDE)) return null;
  for (const d of fs.readdirSync(CLAUDE)) { const f = path.join(CLAUDE, d, id + '.jsonl'); if (fs.existsSync(f)) return f; }
  return null;
}

// ---------- Codex (CLI, VS Code y app de escritorio): ~/.codex/state_5.sqlite + rollout jsonl (a veces .zst) ----------
function codexList(paths, limit) {
  if (!fs.existsSync(CODEX_DB)) return [];
  const db = sqlite(CODEX_DB);
  try {
    const rows = db.prepare(`select id, cwd, rollout_path, title, first_user_message, preview, updated_at_ms, source, approval_mode, sandbox_policy, model, git_branch
      from threads where archived=0 and coalesce(thread_source,'user')='user' order by updated_at_ms desc limit 400`).all();
    return rows.filter(r => paths.some(p => under(r.cwd, p))).slice(0, limit * paths.length * 2).map(r => ({ ctx: codexCtx(codexFile(r.rollout_path), r.model),
      agent: 'codex', id: r.id, cwd: norm(r.cwd) && r.cwd.replace(/^\\\\\?\\/, ''), title: clip(r.title || r.first_user_message, 90), updated_at: iso(r.updated_at_ms),
      preview: clip(r.preview || r.first_user_message), last_user: null, source: String(r.source).startsWith('{') ? 'subagente' : r.source,
      permission_mode: /never|bypass|danger/i.test(r.approval_mode + r.sandbox_policy) ? 'bypassPermissions' : r.approval_mode, model: r.model, branch: r.git_branch }));
  } finally { db.close(); }
}
// Codex comprime los rollouts viejos a .zst sin actualizar la ruta (o los archiva)
const codexFile = rp => rp && [rp, rp + '.zst', path.join(HOME, '.codex', 'archived_sessions', path.basename(rp)), path.join(HOME, '.codex', 'archived_sessions', path.basename(rp) + '.zst')].find(x => fs.existsSync(x));
const codexLines = f => f.endsWith('.zst') ? lines(zlib.zstdDecompressSync(fs.readFileSync(f))) : headTail(f);
// Codex anota en cada turno los tokens del último pedido y la ventana exacta del modelo
function codexCtx(f, model, L = null) {
  if (!f) return null;
  const tc = (L || codexLines(f)).filter(o => o.payload?.type === 'token_count' && o.payload.info).at(-1)?.payload.info;
  return tc ? ctxOf('codex', model, tc.last_token_usage?.total_tokens, { window: tc.model_context_window }) : null;
}
function codexMsgs(id) {
  const db = sqlite(CODEX_DB);
  let r; try { r = db.prepare('select rollout_path, cwd, model from threads where id=?').get(id); } finally { db.close(); }
  const f = codexFile(r?.rollout_path);
  if (!f) return null;
  let buf = fs.readFileSync(f);
  if (f.endsWith('.zst')) buf = zlib.zstdDecompressSync(buf);
  const out = [], L = lines(buf);
  for (const o of L) {
    const p = o.payload;
    if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const t = (p.content || []).filter(c => /text/.test(c.type)).map(c => c.text).join('\n').trim();
    if (t && !injected(t)) out.push({ role: p.role === 'user' ? 'usuario' : 'agente', text: t, at: o.timestamp });
  }
  return { cwd: r.cwd.replace(/^\\\\\?\\/, ''), model: r.model, ctx: codexCtx(f, r.model, L), messages: out };
}

// ---------- Antigravity (agy): conversation_summaries.db + conversations/<id>.db (pasos en protobuf) ----------
const agyCwd = uris => { try { return fileURLToPath(JSON.parse(uris)[0]); } catch { return null; } };
function agyList(paths, limit) {
  const f = path.join(AGY, 'conversation_summaries.db');
  if (!fs.existsSync(f)) return [];
  const db = sqlite(f);
  try {
    return db.prepare('select conversation_id id, title, preview, last_modified_time t, workspace_uris w, killed from conversation_summaries where nesting_depth=0 order by last_modified_time desc limit 400').all()
      .map(r => ({ ...r, cwd: agyCwd(r.w) })).filter(r => r.cwd && paths.some(p => under(r.cwd, p))).slice(0, limit * paths.length * 2)
      .map(r => ({ agent: 'agy', id: r.id, cwd: r.cwd, title: clip(r.title, 90), updated_at: iso(r.t), preview: clip(r.preview), last_user: null, source: 'antigravity', permission_mode: null, model: null, branch: null, ctx: agyCtx(r.id) }));
  } finally { db.close(); }
}
// ponytail: agy no guarda tokens legibles: estimado ≈ bytes de los pasos / 4 (cuenta también lo que agy ya resumió: tiende a sobrestimar)
function agyCtx(id) {
  const f = path.join(AGY, 'conversations', id + '.db');
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
  const db = sqlite(f);
  try { return ctxOf('agy', null, (db.prepare('select sum(length(step_payload)) n from steps').get().n || 0) / 4, { estimated: true }); } finally { db.close(); }
}
// ponytail: decodificador protobuf mínimo (sin esquema): junta los strings UTF-8 legibles de cada paso; si agy cambia el formato, se ve menos texto, no se rompe
function pbStrings(buf, out = [], depth = 0) {
  let i = 0;
  const n = buf.length;
  const varint = () => { let r = 0, s = 0, b; do { if (i >= n) throw 0; b = buf[i++]; r += (b & 127) * 2 ** s; s += 7; } while (b & 128); return r; };
  try {
    while (i < n) {
      const wt = varint() & 7;
      if (wt === 0) varint(); else if (wt === 1) i += 8; else if (wt === 5) i += 4;
      else if (wt === 2) {
        const L = varint(); if (i + L > n) throw 0;
        const sub = buf.subarray(i, i + L); i += L;
        const before = out.length;
        if (!(depth < 12 && pbStrings(sub, out, depth + 1))) {
          out.length = before;
          const t = sub.toString('utf8');
          if (!t.includes('\ufffd') && !/[\x00-\x08\x0e-\x1f]/.test(t) && /\p{L}{3}/u.test(t)) out.push(t);
        }
      } else throw 0;
    }
    return true;
  } catch { return false; }
}
function agyMsgs(id) {
  const f = path.join(AGY, 'conversations', id + '.db');
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
  const db = sqlite(f), out = [];
  try {
    for (const s of db.prepare('select step_type, step_payload from steps where step_type in (14, 15) order by idx').all()) {
      const o = []; pbStrings(Buffer.from(s.step_payload || []), o);
      const t = o.filter(x => !/^\s*[{[]/.test(x) && !injected(x) && /\S+\s+\S+\s+\S+/.test(x)).sort((a, b) => b.length - a.length)[0];
      if (t) out.push({ role: s.step_type === 14 ? 'usuario' : 'agente', text: t.trim(), at: null }); // 14 = entrada del usuario, 15 = respuesta del agente
    }
  } finally { db.close(); }
  const sdb = sqlite(path.join(AGY, 'conversation_summaries.db'));
  let w; try { w = sdb.prepare('select workspace_uris w from conversation_summaries where conversation_id=?').get(id)?.w; } finally { sdb.close(); }
  return { cwd: agyCwd(w), ctx: agyCtx(id), messages: out };
}

// ---------- CommandCode: ~/.commandcode/projects/<slug>/<sesión>.jsonl ----------
function ccFiles() {
  if (!fs.existsSync(CC)) return [];
  const files = [];
  for (const d of fs.readdirSync(CC)) for (const f of fs.readdirSync(path.join(CC, d))) {
    if (!/^[\w-]+\.jsonl$/.test(f) || f.endsWith('.checkpoints.jsonl')) continue;
    const full = path.join(CC, d, f);
    files.push({ full, mtime: fs.statSync(full).mtimeMs });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}
function ccMsgs(L) {
  return L.filter(o => o.type === 'message' && ['user', 'assistant'].includes(o.message?.role)).map(o => ({
    role: o.message.role === 'user' ? 'usuario' : 'agente', text: (o.message.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), at: o.timestamp,
  })).filter(m => m.text && !injected(m.text));
}
// ponytail: CommandCode no guarda tokens: estimado ≈ bytes desde la última compactación / 5 (el JSON infla ~25 %)
function ccCtx(f) {
  const buf = fs.readFileSync(f), i = buf.lastIndexOf('"type":"compaction"');
  return ctxOf('commandcode', null, (buf.length - Math.max(i, 0)) / 5, { estimated: true });
}
function ccList(paths, limit) {
  const out = [];
  for (const { full, mtime } of ccFiles()) {
    if (enough(out, paths, limit)) break;
    const cwd = lines(readPart(full, 0, 4096))[0]?.cwd;
    if (!cwd || !paths.some(p => under(cwd, p) && !enough(out, [p], limit))) continue;
    const msgs = ccMsgs(headTail(full));
    if (!msgs.length) continue;
    out.push({ agent: 'commandcode', id: path.basename(full, '.jsonl'), cwd, title: clip(msgs[0].text, 90), updated_at: iso(mtime), preview: clip(msgs[msgs.length - 1].text),
      last_user: null, source: 'commandcode', permission_mode: null, model: null, branch: null, ctx: ccCtx(full) });
  }
  return out;
}

// ---------- API ----------
const LISTS = { claude: claudeList, codex: codexList, agy: agyList, commandcode: ccList };
// sesiones recientes de cada agente cuyo cwd está dentro de alguna de las rutas; limit = por agente y ruta
function list(paths, limit = 5) {
  paths = (paths || []).filter(Boolean);
  const out = [], errors = {};
  if (!paths.length) return { sessions: out, errors };
  for (const [k, fn] of Object.entries(LISTS)) {
    try {
      const all = fn(paths, limit);
      for (const p of paths) out.push(...all.filter(s => under(s.cwd, p)).slice(0, limit).map(s => ({ ...s, path: p })));
    } catch (e) { errors[k] = e.message; }
  }
  return { sessions: out, errors };
}
// mensajes de una sesión (los últimos max)
function transcript(agent, id, max = 80) {
  let r = null;
  if (agent === 'claude') { const f = claudeFile(id); if (f) { const L = lines(fs.readFileSync(f)); const m = claudeMeta(L); r = { cwd: m.cwd, permission_mode: m.permission_mode, model: m.model, source: m.source, ctx: ctxOf('claude', m.model, m.used), messages: claudeMsgs(L) }; } }
  else if (agent === 'codex') r = codexMsgs(id);
  else if (agent === 'agy') r = agyMsgs(id);
  else if (agent === 'commandcode') { const f = ccFiles().find(x => path.basename(x.full, '.jsonl') === id)?.full; if (f) { const L = lines(fs.readFileSync(f)); r = { cwd: L[0]?.cwd, ctx: ccCtx(f), messages: ccMsgs(L) }; } }
  else throw new Error('Agente desconocido: ' + agent);
  if (!r) throw new Error('No encontré esa sesión en esta PC');
  return { ...r, total: r.messages.length, messages: r.messages.slice(-max) };
}

module.exports = { list, transcript, pbStrings, norm, under };

if (require.main === module) { // autoprueba: node sesiones.js [ruta]
  const assert = require('node:assert');
  assert(under('\\\\?\\C:\\A\\b\\c', 'c:/a/B'));
  assert(!under('C:\\A\\bc', 'C:\\A\\b'));
  // protobuf: campo 1 = "hola mundo" dentro de un mensaje anidado en el campo 2
  const inner = Buffer.concat([Buffer.from([0x0a, 10]), Buffer.from('hola mundo')]);
  const o = []; pbStrings(Buffer.concat([Buffer.from([0x12, inner.length]), inner]), o);
  assert.deepStrictEqual(o, ['hola mundo']);
  const p = process.argv[2] || process.cwd(), r = list([p], 3);
  console.log(r.errors, r.sessions.map(s => `${s.agent.padEnd(11)} ${s.updated_at} ${s.title}`).join('\n'));
  for (const s of r.sessions.filter((x, i, a) => a.findIndex(y => y.agent === x.agent) === i)) { const t = transcript(s.agent, s.id, 2); console.log(s.agent, t.total, 'msgs ·', clip(t.messages.at(-1)?.text, 80)); }
}
