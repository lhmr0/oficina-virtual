// Motor de ejecución: adaptadores de CLIs, cola, turnos, estados de tarea, cuota/relevo, git
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA, now, all, one, run, J, insert, update, bus, emit, log, notify, setting, setSetting } = require('./db');

// ---------- estados ----------
const STATUS = ['pendiente', 'bloqueada', 'en_cola', 'en_curso', 'esperando', 'revision', 'completada', 'pausada_cuota', 'fallida'];
const RUNNING = ['en_cola', 'en_curso'];
const RULES = `## Reglas de la oficina (obligatorias)
1. Mantén el archivo .oficina/progreso.md en tu carpeta de trabajo: objetivo, checklist de pasos hechos y pendientes, decisiones y archivos tocados. Actualízalo después de cada paso importante (así otro agente puede continuar si te detienes).
2. Si necesitas una decisión del usuario, termina tu respuesta con la línea [[CONSULTA]] seguida de la pregunta (y opciones si aplica). No inventes la decisión.
3. Cuando termines, termina tu respuesta con la línea [[LISTO]] seguida de un resumen breve de lo hecho.`;
const RULES_CHAT = 'Si necesitas que el usuario decida algo antes de seguir, termina con la línea [[CONSULTA]] y la pregunta.';

// ---------- git ----------
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
const isGit = p => tryGit(p, 'rev-parse', '--is-inside-work-tree') === 'true';
function exclude(repo, lines) {
  const f = path.resolve(repo, tryGit(repo, 'rev-parse', '--git-common-dir') || '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const add = lines.filter(l => !cur.split(/\r?\n/).includes(l));
  if (add.length) fs.appendFileSync(f, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
}
function commit(cwd, msg) {
  if (!tryGit(cwd, 'status', '--porcelain')) return null;
  git(cwd, 'add', '-A');
  try { git(cwd, 'commit', '-q', '-m', msg); } catch { git(cwd, '-c', 'user.name=Oficina Virtual', '-c', 'user.email=oficina@localhost', 'commit', '-q', '-m', msg); }
  return git(cwd, 'rev-parse', '--short', 'HEAD');
}
// estado que hooks/herramientas del usuario dejan en cada carpeta (solo afecta archivos sin versionar)
const DEFAULT_EXCLUDE = ['.ijfw/', '.serena/', '/AGENTS.md', '/CLAUDE.md'];
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

// ---------- rutas seguras ----------
// ruta canónica larga: los CLIs rechazan escribir si el cwd viene en formato 8.3 (LOCALA~1)
const canon = p => { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } };
function validFolder(p) {
  if (!p || !path.isAbsolute(p)) return 'La ruta debe ser absoluta';
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return 'La carpeta no existe';
  const r = canon(p);
  if (path.dirname(r) === r) return 'No se permite la raíz de un disco';
  const bad = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean).map(x => path.resolve(x).toLowerCase());
  if (bad.some(b => r.toLowerCase() === b || r.toLowerCase().startsWith(b + path.sep))) return 'No se permiten carpetas del sistema';
  return null;
}

// ---------- directorio de trabajo de una tarea ----------
function workdir(task) {
  if (!task.folder_id) {
    const d = path.join(DATA, 'sandbox', 'task-' + task.id);
    fs.mkdirSync(d, { recursive: true });
    return { cwd: d, lock: null, git: false };
  }
  const f0 = one('select * from project_folders where id=?', task.folder_id);
  if (!f0) throw new Error('La carpeta de la tarea ya no existe en el proyecto');
  const f = { ...f0, path: canon(f0.path) };
  const g = isGit(f.path);
  if (g) exclude(f.path, ['.oficina/', '.oficina-worktrees/', ...setting('checkpoint_exclude', DEFAULT_EXCLUDE)]);
  if (g && f.use_worktrees && tryGit(f.path, 'rev-parse', 'HEAD')) {
    if (task.worktree_path && fs.existsSync(task.worktree_path)) return { cwd: task.worktree_path, lock: null, git: true, wt: true };
    const branch = task.branch || `oficina/task-${task.id}-${slug(task.title)}`;
    const wt = path.join(f.path, '.oficina-worktrees', 'task-' + task.id);
    const base = task.base_branch || git(f.path, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (tryGit(f.path, 'rev-parse', '--verify', branch)) git(f.path, 'worktree', 'add', wt, branch);
    else git(f.path, 'worktree', 'add', '-b', branch, wt);
    update('tasks', task.id, { branch, worktree_path: wt, base_branch: base });
    return { cwd: wt, lock: null, git: true, wt: true };
  }
  return { cwd: f.path, lock: 'folder-' + f.id, git: g };
}

// ---------- adaptadores ----------
// args(c, ctx) → {args, stdin}; parse(obj|string, st) acumula en st: sessionId, final, error, tokens, cost, limits[], permission
const cap = (s, n = 24000) => s.length > n ? s.slice(0, n / 2) + '\n…[recortado]…\n' + s.slice(-n / 2) : s;
const ADAPTERS = {
  claude: {
    args(c, { first, prompt, supervised }) {
      const a = ['-p', '--output-format', 'stream-json', '--verbose', first ? '--session-id' : '--resume', c.session_id];
      if (c.model) a.push('--model', c.model);
      if (c.effort) a.push('--effort', c.effort);
      if (supervised) {
        a.push('--input-format', 'stream-json', '--permission-mode', 'default', '--permission-prompt-tool', 'stdio');
        return { args: a, stdin: JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n', keepOpen: true };
      }
      a.push('--permission-mode', c.mode === 'plan' ? 'plan' : 'acceptEdits');
      return { args: a, stdin: prompt };
    },
    newSession: () => crypto.randomUUID(),
    parse(o, st, out) {
      if (o.type === 'assistant') for (const b of o.message?.content || []) {
        if (b.type === 'text' && b.text) out('💬 ' + b.text);
        if (b.type === 'tool_use') out(`🔧 ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`);
      }
      if (o.type === 'rate_limit_event') {
        const i = o.rate_limit_info || {};
        for (const [w, v] of Object.entries(i.unifiedWindows || {})) st.limits.push({ win: w, pct: v.utilization * 100, resets: v.resetsAt });
        if (i.status === 'rejected') { st.quota = true; st.resetAt = i.resetsAt; }
      }
      if (o.type === 'control_request' && o.request?.subtype === 'can_use_tool') st.onPermission?.(o);
      if (o.type === 'result') {
        st.final = o.result ?? ''; st.cost = o.total_cost_usd || 0; st.done = true;
        const u = o.usage || {};
        st.tin = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); st.tout = u.output_tokens || 0;
        if (o.is_error) st.error = o.result || o.subtype;
      }
    },
  },
  codex: {
    args(c, { first, prompt }) {
      const a = ['exec'];
      if (!first) a.push('resume');
      a.push('--json', '--skip-git-repo-check', '-c', `sandbox_mode="${c.mode === 'plan' ? 'read-only' : 'workspace-write'}"`);
      if (c.model) a.push('-m', c.model);
      if (c.effort) a.push('-c', `model_reasoning_effort="${c.effort}"`);
      if (!first) a.push(c.session_id);
      a.push('-');
      return { args: a, stdin: prompt };
    },
    parse(o, st, out) {
      if (o.type === 'thread.started') st.sessionId = o.thread_id;
      const it = o.item;
      if (o.type === 'item.completed' && it) {
        if (it.type === 'agent_message') { st.final = it.text; out('💬 ' + it.text); }
        else if (it.type === 'command_execution') out(`🔧 $ ${it.command} → ${it.exit_code ?? ''}`);
        else if (it.type === 'file_change') out(`📝 ${JSON.stringify(it.changes || '').slice(0, 200)}`);
        else if (it.type === 'error') out('⚠ ' + it.message);
      }
      if (o.type === 'turn.completed') { st.error = null; st.tin = o.usage?.input_tokens || 0; st.tout = o.usage?.output_tokens || 0; }
      if (o.type === 'turn.failed') st.error = o.error?.message || 'turn.failed';
      if (o.type === 'error') st.error = o.message;
      const rl = o.rate_limits || o.msg?.rate_limits || o.info?.rate_limits;
      if (rl) for (const [w, v] of Object.entries(rl)) if (v && v.used_percent != null)
        st.limits.push({ win: w, pct: v.used_percent, resets: v.resets_at || (v.resets_in_seconds ? Date.now() / 1000 + v.resets_in_seconds : null) });
    },
  },
  agy: {
    args(c, { first, prompt }) {
      const a = ['-p', cap(prompt), '--output-format', 'stream-json', '--mode', c.mode === 'plan' ? 'plan' : 'accept-edits'];
      if (c.model) a.push('--model', c.model);
      if (c.effort && !/-(low|medium|high)$/.test(c.model || '')) a.push('--effort', c.effort); // agy rechaza --effort si el modelo ya lo trae
      if (!first) a.push('--conversation', c.session_id);
      return { args: a, stdin: null };
    },
    parse(o, st, out) {
      if (o.event === 'init') st.sessionId = o.conversation_id;
      const s = o.step_update;
      if (s?.text_delta) { st.buf = (st.buf || '') + s.text_delta; }
      if (s?.state === 'DONE' && st.buf) { out('💬 ' + st.buf); st.buf = ''; }
      if (s?.step_type && s.step_type !== 'agent_response' && s.step_type !== 'user_input' && s.state === 'DONE') out('🔧 ' + s.step_type);
      if (o.event === 'result') {
        const r = o.result || {};
        st.final = r.response || ''; st.sessionId = r.conversation_id || st.sessionId;
        st.tin = r.usage?.input_tokens || 0; st.tout = r.usage?.output_tokens || 0;
        if (r.status && r.status !== 'SUCCESS') st.error = r.error || r.status;
      }
    },
  },
  commandcode: {
    args(c, { first, prompt, convId }) {
      const a = ['-p', cap(prompt), '-t', '--output-format', 'json', '--permission-mode', c.mode === 'plan' ? 'plan' : 'auto-accept'];
      if (c.model) a.push('-m', c.model);
      if (c.effort) a.push('--effort', c.effort);
      if (first) a.push('-n', 'oficina-' + convId); else a.push('--session', c.session_id);
      return { args: a, stdin: null };
    },
    parse(o, st, out) {
      const e = o.event;
      if (e?.type === 'run_start') st.sessionId = e.sessionId;
      if (e?.type === 'tool_call_start' || e?.type === 'tool_start') out('🔧 ' + (e.name || e.toolName || 'herramienta'));
      if (e?.type === 'run_error') st.error = e.error?.message;
      if (o.type === 'result') {
        st.final = o.finalText || ''; st.sessionId = o.sessionId || st.sessionId;
        st.tin = o.usage?.inputTokens || 0; st.tout = o.usage?.outputTokens || 0;
        if (o.subtype === 'error' || o.error) st.error = o.error || 'error';
        if (st.final) out('💬 ' + st.final);
      }
    },
  },
  // agente de pruebas: pre_args = ['-e', script]; imprime texto plano
  fake: {
    args(c, { prompt }) { return { args: [], stdin: prompt }; },
    newSession: () => 'fake-' + crypto.randomUUID().slice(0, 8),
    parse(line, st, out) { st.final = (st.final ? st.final + '\n' : '') + line; out(line); },
  },
};

// ---------- cola y procesos activos ----------
const queue = [];              // {convId, prompt, userId, supervised, lock, resolve}
const active = new Map();      // runId → {proc, convId, agentId, lock, st, aborted, timedOut}
const pendingPerms = new Map();// requestId → {runId, input, convId}
const PRI = { alta: 0, media: 1, baja: 2 };
const isPaused = () => setting('queue_paused', false);

function agentOf(id) { return one('select * from agents where id=?', id); }
function conv(id) { return one('select * from conversations where id=?', id); }
function taskOfConv(c) { return c.task_id ? one('select * from tasks where id=?', c.task_id) : null; }
const busyCount = agentId => [...active.values()].filter(a => a.agentId === agentId).length;

function pump() {
  if (isPaused()) return;
  for (const item of [...queue]) {
    const c = conv(item.convId);
    const ag = agentOf(c.agent_id);
    if (!ag?.enabled || ag.status === 'sin_cuota') continue;
    if (busyCount(ag.id) >= ag.max_concurrent) continue;
    if (item.lock && [...active.values()].some(a => a.lock === item.lock)) continue;
    queue.splice(queue.indexOf(item), 1);
    start(item).catch(e => { finishConv(item, { end_reason: 'error', error: e.message, final: '' }); });
  }
}

// Encola un turno. Devuelve promesa con el resultado del turno.
function runTurn(convId, userText, { userId = null, prompt = null, supervised = false, lock = null, priority = 'media', silentUserMsg = false } = {}) {
  const c = conv(convId);
  if (queue.some(q => q.convId === convId) || [...active.values()].some(a => a.convId === convId)) throw new Error('Esta conversación ya está en ejecución');
  if (userText && !silentUserMsg) insert('messages', { conversation_id: convId, role: 'usuario', user_id: userId, text: userText, kind: 'mensaje', at: now() });
  update('conversations', convId, { status: 'en_cola', updated_at: now() });
  emit('conv.updated', { id: convId });
  return new Promise(resolve => {
    queue.push({ convId, prompt: prompt || userText, userId, supervised, lock, resolve, pri: PRI[priority] ?? 1, at: Date.now() });
    queue.sort((a, b) => a.pri - b.pri || a.at - b.at);
    pump();
  });
}

async function start(item) {
  const c = conv(item.convId);
  const ag = agentOf(c.agent_id);
  const ad = ADAPTERS[ag.adapter];
  const task = taskOfConv(c);
  const first = !c.session_id;
  if (first && ad.newSession) update('conversations', c.id, { session_id: ad.newSession() });
  const cc = conv(c.id);
  let cwd = cc.folder_path || path.join(DATA, 'sandbox', 'conv-' + c.id);
  if (task) { cwd = workdir(one('select * from tasks where id=?', task.id)).cwd; }
  fs.mkdirSync(cwd, { recursive: true });
  const supervised = item.supervised && ag.adapter === 'claude';
  const b = ad.args(cc, { first, prompt: item.prompt, supervised, convId: c.id });
  const args = [...J(ag.pre_args, []), ...b.args, ...J(ag.extra_args, [])];
  const turn = (one('select count(*) n from runs where conversation_id=?', c.id).n || 0) + 1;
  const runId = insert('runs', { conversation_id: c.id, task_id: task?.id ?? null, agent_id: ag.id, model: cc.model, effort: cc.effort, turn,
    command: [ag.exe, ...args].map(x => (/\s/.test(x) ? JSON.stringify(x.length > 120 ? x.slice(0, 120) + '…' : x) : x)).join(' '),
    started_by: item.userId, started_at: now(), log_path: path.join(DATA, 'runs', 'run-' + Date.now() + '-' + c.id + '.log') });
  const r = one('select * from runs where id=?', runId);
  const logf = fs.openSync(r.log_path, 'a');
  const out = line => { fs.writeSync(logf, line + '\n'); emit('run.log', { run_id: runId, conv_id: c.id, task_id: task?.id ?? null, line }); };
  out(`▶ ${ag.name} · ${cc.model || 'modelo por defecto'} · ${cc.effort || '-'} · turno ${turn} · ${cwd}`);

  const st = { limits: [], final: '', error: null, tin: 0, tout: 0, cost: 0 };
  const proc = spawn(ag.exe, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OFICINA_TASK: String(task?.id ?? ''), OFICINA_CONV: String(c.id) } });
  const act = { proc, convId: c.id, agentId: ag.id, lock: item.lock, st, runId };
  active.set(runId, act);
  update('runs', runId, { pid: proc.pid ?? null });
  update('conversations', c.id, { status: 'en_curso', updated_at: now() });
  if (task) setStatus(task.id, 'en_curso', item.userId, { run: runId }, true);
  refreshAgentStatus(ag.id);
  emit('run.started', { run_id: runId, conv_id: c.id, task_id: task?.id ?? null, agent_id: ag.id });

  if (supervised) st.onPermission = o => {
    pendingPerms.set(o.request_id, { runId, input: o.request.input, convId: c.id, taskId: task?.id ?? null });
    const desc = `${o.request.tool_name}: ${JSON.stringify(o.request.input).slice(0, 300)}`;
    insert('messages', { conversation_id: c.id, role: 'agente', agent_id: ag.id, text: `🔐 Permiso solicitado · ${desc}`, kind: 'permiso', at: now() });
    emit('permiso', { request_id: o.request_id, conv_id: c.id, task_id: task?.id ?? null, tool: o.request.tool_name, desc });
    notify('permiso', `${ag.name} pide permiso`, desc, task ? `#/tarea/${task.id}` : `#/cantina/${c.id}`);
    out('🔐 esperando permiso: ' + desc);
  };
  proc.on('error', e => { st.error = `No se pudo iniciar ${ag.exe}: ${e.message}`; });
  if (b.stdin != null) { proc.stdin.write(b.stdin); if (!b.keepOpen) proc.stdin.end(); } else proc.stdin.end();

  let buf = '', errTail = '';
  proc.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let o = null; try { o = JSON.parse(line); } catch {}
      try { ad.parse(ag.adapter === 'fake' ? line : (o ?? null) || {}, st, out); } catch (e) { out('⚠ parser: ' + e.message); }
      if (!o && ag.adapter !== 'fake') out(line);
      if (st.done && b.keepOpen && !proc.stdin.destroyed) proc.stdin.end();
    }
  });
  proc.stderr.on('data', d => { const s = String(d); errTail = (errTail + s).slice(-3000); for (const l of s.split(/\r?\n/)) if (l.trim()) out('⚠ ' + l); });
  const timer = setTimeout(() => { act.timedOut = true; kill(proc); }, (ag.timeout_min || 30) * 60000);

  const code = await new Promise(res => proc.on('close', res));
  clearTimeout(timer);
  if (buf.trim()) { try { ad.parse(ag.adapter === 'fake' ? buf.trim() : JSON.parse(buf), st, out); } catch { out(buf.trim()); } }
  active.delete(runId);
  for (const [k, v] of pendingPerms) if (v.runId === runId) pendingPerms.delete(k);

  // clasificar
  const quotaRe = new RegExp(J(ag.quota_patterns, []).join('|') || '$^', 'i');
  const errText = st.error || (code !== 0 ? (errTail || st.final || `exit ${code}`) : '');
  let end_reason;
  if (act.aborted) end_reason = 'abortado';
  else if (act.timedOut) end_reason = 'timeout';
  else if (st.quota || (errText && quotaRe.test(errText))) end_reason = 'cuota';
  else if (errText) end_reason = 'error';
  else if (/\[\[CONSULTA\]\]/.test(st.final)) end_reason = 'consulta';
  else if (/\[\[LISTO\]\]/.test(st.final)) end_reason = 'listo';
  else end_reason = 'sin_marcador';
  out(`■ fin: ${end_reason} (exit ${code})${errText ? ' · ' + errText.slice(0, 300) : ''}`);
  fs.closeSync(logf);

  if (st.sessionId && st.sessionId !== cc.session_id) update('conversations', c.id, { session_id: st.sessionId });
  update('runs', runId, { ended_at: now(), exit_code: code, end_reason, tokens_in: st.tin, tokens_out: st.tout, cost_usd: st.cost });
  saveLimits(ag.id, st.limits);
  if (end_reason === 'cuota') markQuota(ag, errText || '', st.resetAt);
  else if (end_reason !== 'error') update('agents', ag.id, { last_error: null });
  if (end_reason === 'error') update('agents', ag.id, { last_error: errText.slice(0, 500) });

  const res = { run_id: runId, end_reason, final: st.final, error: errText, code };
  await finishConv(item, res);
  refreshAgentStatus(ag.id);
  pump();
}

async function finishConv(item, res) {
  const c = conv(item.convId);
  const ag = agentOf(c.agent_id);
  const text = (res.final || '').trim();
  if (text) insert('messages', { conversation_id: c.id, role: 'agente', agent_id: ag.id, text, kind: res.end_reason === 'consulta' ? 'consulta' : 'mensaje', at: now() });
  if (res.end_reason === 'error' || res.end_reason === 'cuota' || res.end_reason === 'timeout')
    insert('messages', { conversation_id: c.id, role: 'sistema', text: `${res.end_reason.toUpperCase()}: ${(res.error || '').slice(0, 800)}`, kind: 'nota', at: now() });
  const task = taskOfConv(c);
  if (task) await onTaskTurnEnd(task.id, res, item);
  else {
    const status = { consulta: 'esperando', cuota: 'sin_cuota', error: 'error', timeout: 'error' }[res.end_reason] || 'inactiva';
    update('conversations', c.id, { status, updated_at: now() });
    if (res.end_reason === 'consulta') notify('consulta', `${ag.name} te consulta`, question(text), `#/cantina/${c.id}`);
    if (res.end_reason === 'cuota') notify('cuota', `${ag.name} sin cuota`, 'La consulta rápida se detuvo. Puedes continuarla con otro agente.', `#/cantina/${c.id}`);
  }
  emit('conv.updated', { id: c.id });
  item.resolve?.(res);
}
// texto de la pregunta: lo que va tras [[CONSULTA]] (o lo previo si el marcador va al final), sin markdown
const question = t => { const [a, b = ''] = String(t).split('[[CONSULTA]]'); return (b.trim() || a).replace(/\*\*|`|\[\[\w+\]\]/g, '').trim().slice(-400); };

function kill(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  else proc.kill('SIGKILL');
}
function abortConv(convId) {
  const qi = queue.findIndex(q => q.convId === convId);
  if (qi >= 0) { const [it] = queue.splice(qi, 1); finishConv(it, { end_reason: 'abortado', final: '' }); return true; }
  for (const a of active.values()) if (a.convId === convId) { a.aborted = true; kill(a.proc); return true; }
  return false;
}
function answerPermission(requestId, allow, userId) {
  const p = pendingPerms.get(requestId);
  if (!p) throw new Error('El permiso ya no está pendiente');
  const a = active.get(p.runId);
  const response = allow ? { behavior: 'allow', updatedInput: p.input } : { behavior: 'deny', message: 'Denegado por el usuario desde la oficina' };
  a.proc.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) + '\n');
  pendingPerms.delete(requestId);
  insert('messages', { conversation_id: p.convId, role: 'usuario', user_id: userId, text: allow ? '✅ Permiso aprobado' : '⛔ Permiso denegado', kind: 'permiso', at: now() });
  log(userId, 'permiso', p.convId, allow ? 'aprobar' : 'denegar', { requestId });
  emit('conv.updated', { id: p.convId });
}

// ---------- cuota / límites ----------
function parseReset(text, epoch) {
  if (epoch) return new Date(epoch * 1000).toISOString();
  const pipe = /\|(\d{10})\b/.exec(text); if (pipe) return new Date(pipe[1] * 1000).toISOString();
  const m = /try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(text) || /(?:reset|resets|reinicia)\D{0,20}(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(text);
  if (m) {
    let h = +m[1]; if (m[3]) { h %= 12; if (/pm/i.test(m[3])) h += 12; }
    const d = new Date(); d.setHours(h, +m[2], 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return new Date(Date.now() + 60 * 60000).toISOString(); // ponytail: sin hora conocida, reintentar en 1 h
}
function markQuota(ag, text, epoch) {
  const at = parseReset(text, epoch);
  update('agents', ag.id, { status: 'sin_cuota', quota_reset_at: at, last_error: text.slice(0, 500) });
  log(null, 'agente', ag.id, 'sin_cuota', { hasta: at });
  emit('agent.status', { id: ag.id });
}
function saveLimits(agentId, limits) {
  for (const l of limits) run(`insert into agent_limits(agent_id,source,win,metric,limit_value,used_value,resets_at,updated_at) values(?,?,?,?,?,?,?,?)
    on conflict(agent_id,source,win,metric) do update set used_value=excluded.used_value, resets_at=excluded.resets_at, updated_at=excluded.updated_at`,
  agentId, 'cli', l.win, 'pct', 100, Math.round(l.pct * 10) / 10, l.resets ? new Date(l.resets * 1000).toISOString() : null, now());
  if (limits.length) emit('agent.status', { id: agentId });
}
function refreshAgentStatus(agentId) {
  const ag = agentOf(agentId);
  if (ag.status === 'sin_cuota') return emit('agent.status', { id: agentId });
  const s = busyCount(agentId) ? 'ocupado' : (ag.last_error ? 'error' : 'disponible');
  if (s !== ag.status) update('agents', agentId, { status: s });
  emit('agent.status', { id: agentId });
}
// reactiva agentes cuya cuota ya se reinició
function quotaTick() {
  for (const ag of all(`select * from agents where status='sin_cuota' and quota_reset_at is not null and quota_reset_at <= ?`, now())) {
    update('agents', ag.id, { status: 'disponible', quota_reset_at: null, last_error: null });
    notify('agente', `${ag.name} vuelve a estar disponible`, 'Su cuota se reinició.', '#/puente');
    emit('agent.status', { id: ag.id });
  }
  pump();
}

// ---------- tareas ----------
const TRANS = {
  pendiente: ['en_cola', 'en_curso', 'bloqueada', 'revision', 'completada', 'esperando'],
  bloqueada: ['pendiente', 'en_cola'],
  en_cola: ['en_curso', 'pendiente', 'fallida', 'esperando', 'revision', 'pausada_cuota'],
  en_curso: ['esperando', 'revision', 'pausada_cuota', 'fallida', 'pendiente', 'en_cola', 'completada'],
  esperando: ['en_cola', 'en_curso', 'revision', 'completada', 'pendiente', 'fallida', 'pausada_cuota'],
  revision: ['completada', 'en_cola', 'pendiente', 'esperando', 'en_curso'],
  completada: ['pendiente', 'revision'],
  pausada_cuota: ['en_cola', 'pendiente', 'esperando', 'en_curso'],
  fallida: ['en_cola', 'pendiente', 'en_curso', 'esperando'],
};
function setStatus(taskId, status, userId, detail = {}, system = false) {
  const t = one('select * from tasks where id=?', taskId);
  if (!STATUS.includes(status)) throw new Error('Estado inválido: ' + status);
  if (t.status === status) return t;
  if (!system && !(TRANS[t.status] || []).includes(status)) throw new Error(`Transición no permitida: ${t.status} → ${status}`);
  if (!system && RUNNING.includes(t.status) && t.executor === 'agente') throw new Error('La tarea está en ejecución; abórtala primero');
  if (!system && t.executor === 'agente' && RUNNING.includes(status)) throw new Error('Para ejecutar usa el botón Ejecutar');
  changeTask(taskId, { status }, userId);
  log(userId, 'tarea', taskId, 'estado', { de: t.status, a: status, ...detail });
  if (status === 'completada') onCompleted(taskId, userId);
  return one('select * from tasks where id=?', taskId);
}
// actualiza campos registrando task_history
function changeTask(taskId, patch, userId) {
  const t = one('select * from tasks where id=?', taskId);
  const at = now();
  const diff = {};
  for (const [k, v] of Object.entries(patch)) if (String(t[k] ?? '') !== String(v ?? '')) {
    diff[k] = v;
    insert('task_history', { task_id: taskId, field: k, old_value: t[k] == null ? null : String(t[k]), new_value: v == null ? null : String(v), user_id: userId, at });
  }
  if (Object.keys(diff).length) { update('tasks', taskId, { ...diff, updated_at: at }); emit('task.updated', { id: taskId, project_id: t.project_id }); }
  return diff;
}
function onCompleted(taskId, userId) {
  bus.emit('task.completed', { id: taskId, project_id: one('select project_id from tasks where id=?', taskId).project_id });
  // desbloquear dependientes
  for (const d of all(`select * from tasks where status='bloqueada' and deleted_at is null and depends_on like ?`, `%${taskId}%`)) {
    if (!J(d.depends_on, []).includes(taskId)) continue;
    if (depsPending(d).length) continue;
    changeTask(d.id, { status: 'pendiente' }, null);
    if (d.executor === 'agente' && d.agent_id) runTaskBg(d.id, userId).catch(e => notify('error', `No se pudo iniciar tarea #${d.id}`, e.message, `#/tarea/${d.id}`));
  }
}
const depsPending = t => J(t.depends_on, []).filter(id => (one('select status from tasks where id=?', id)?.status || 'completada') !== 'completada');

function taskPrompt(t, extra = '') {
  const p = one('select * from projects where id=?', t.project_id);
  const area = one('select * from areas where id=?', t.area_id);
  const deps = J(t.depends_on, []).map(id => one('select id,title,summary from tasks where id=?', id)).filter(Boolean);
  return [RULES,
    `# Proyecto: ${p.name}`, p.briefing ? `## Instrucciones del proyecto\n${p.briefing}` : '',
    `# Tarea #${t.id}: ${t.title}${area ? ` (Área: ${area.name})` : ''}`, t.prompt || '',
    deps.length ? `# Resultado de tareas previas\n${deps.map(d => `## #${d.id} ${d.title}\n${d.summary || '(sin resumen)'}`).join('\n\n')}` : '',
    t.review_comment ? `# Comentario del revisor (corrige esto)\n${t.review_comment}` : '',
    extra].filter(Boolean).join('\n\n');
}

// Ejecuta (o reanuda) una tarea. opts: {agent_id, model, effort, mode, supervised, extra}
function runTask(taskId, userId, opts = {}) {
  let t = one('select * from tasks where id=?', taskId);
  if (t.executor !== 'agente') throw new Error('Tarea humana: no se ejecuta con agente');
  if (RUNNING.includes(t.status)) throw new Error('La tarea ya está en ejecución');
  if (depsPending(t).length) { changeTask(taskId, { status: 'bloqueada' }, userId); throw new Error('Tarea bloqueada por dependencias: #' + depsPending(t).join(', #')); }
  const patch = {};
  for (const k of ['agent_id', 'model', 'effort', 'mode']) if (opts[k] != null && opts[k] !== '') patch[k] = opts[k];
  if (!t.agent_id && !patch.agent_id) throw new Error('Elige un agente');
  changeTask(taskId, { ...patch, attempts: (t.attempts || 0) + 1 }, userId);
  t = one('select * from tasks where id=?', taskId);
  const ag = agentOf(t.agent_id);
  if (!ag.enabled) throw new Error(`${ag.name} está deshabilitado`);
  const wd = workdir(t);
  let c = t.conversation_id ? conv(t.conversation_id) : null;
  const newConv = !c || c.agent_id !== t.agent_id || opts.fresh;
  if (newConv) {
    const cid = insert('conversations', { kind: 'tarea', task_id: t.id, project_id: t.project_id, title: t.title, agent_id: t.agent_id, model: t.model || ag.default_model,
      effort: t.effort || ag.default_effort, mode: t.mode === 'plan' ? 'plan' : 'editar', created_by: userId, created_at: now(), updated_at: now() });
    changeTask(t.id, { conversation_id: cid }, userId);
    c = conv(cid);
  } else update('conversations', c.id, { model: t.model || c.model, effort: t.effort || c.effort, mode: t.mode === 'plan' ? 'plan' : 'editar' });
  const prompt = newConv ? taskPrompt(t, opts.extra) : `${opts.text || 'Continúa con la tarea.'}

(Recuerda: termina con [[LISTO]] y un resumen si terminaste, o con [[CONSULTA]] y la pregunta si necesitas una decisión.)`;
  setStatus(t.id, 'en_cola', userId, {}, true);
  log(userId, 'tarea', t.id, 'ejecutar', { agente: ag.key, modelo: t.model, esfuerzo: t.effort });
  if (newConv) insert('messages', { conversation_id: c.id, role: 'sistema', user_id: userId, text: `Tarea asignada a ${ag.name} (${t.model || ag.default_model} · ${t.effort || ag.default_effort})`, kind: 'nota', at: now() });
  return runTurn(c.id, newConv ? null : opts.text, { userId, prompt, supervised: t.mode === 'supervisado', lock: wd.lock, priority: t.priority });
}

const runTaskBg = (...a) => Promise.resolve().then(() => runTask(...a));

async function onTaskTurnEnd(taskId, res, item) {
  const t = one('select * from tasks where id=?', taskId);
  const ag = agentOf(t.agent_id);
  const link = `#/tarea/${t.id}`;
  const cwd = (() => { try { return workdir(t).cwd; } catch { return null; } })();
  const wt = t.worktree_path && cwd === t.worktree_path;
  let diff = null;
  if (cwd && wt) {
    const why = { listo: 'listo', consulta: 'consulta', cuota: 'cuota', error: 'error', timeout: 'timeout', abortado: 'abortado' }[res.end_reason] || 'turno';
    try { commit(cwd, `oficina: checkpoint task-${t.id} (${ag.key}, ${why})`); } catch {}
    diff = tryGit(cwd, 'diff', '--stat', `${t.base_branch}...HEAD`);
  } else if (cwd && isGit(cwd)) diff = tryGit(cwd, 'diff', '--stat');
  if (diff != null) update('runs', res.run_id, { diff_stat: diff });
  const S = (s, d) => setStatus(t.id, s, null, d, true);
  switch (res.end_reason) {
    case 'listo':
      changeTask(t.id, { summary: (res.final.split('[[LISTO]]')[1] || res.final).trim().slice(0, 4000), review_comment: null }, null);
      S('revision'); notify('revision', `Tarea #${t.id} lista para revisión`, `${ag.name}: ${t.title}`, link); break;
    case 'consulta': case 'sin_marcador':
      S('esperando'); notify('consulta', `${ag.name} consulta en tarea #${t.id}`, question(res.final) || 'Terminó el turno sin marcador; revisa y responde.', link); break;
    case 'cuota': {
      const h = createHandoff(t.id, 'cuota', null);
      S('pausada_cuota', { handoff: h });
      notify('cuota', `${ag.name} se quedó sin combustible`, `Tarea #${t.id} ${t.title}. Avance guardado; elige quién continúa.`, link);
      const area = one('select * from areas where id=?', t.area_id);
      if (area?.auto_fallback) {
        const next = J(area.fallback_chain, []).map(agentOf).find(a => a && a.id !== ag.id && a.enabled && a.status !== 'sin_cuota');
        if (next) setTimeout(() => handoffTask(t.id, { agent_id: next.id, reason: 'cuota (relevo automático)' }, null).catch(e => notify('error', 'Relevo automático falló', e.message, link)), 10);
      }
      break;
    }
    case 'abortado': S('pendiente', { motivo: 'abortado' }); break;
    case 'timeout': createHandoff(t.id, 'timeout', null); S('fallida', { motivo: 'timeout' }); notify('fallo', `Tarea #${t.id} excedió el tiempo`, t.title, link); break;
    default: {
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|\b50[0-9]\b|overloaded|network/i.test(res.error || '');
      if (transient && !item.retried) {
        S('pendiente');
        setTimeout(() => runTaskBg(t.id, item.userId, { text: 'Hubo un error de red; continúa donde quedaste.' }).catch(() => {}), 5000);
        notify('fallo', `Tarea #${t.id}: error transitorio, reintentando`, (res.error || '').slice(0, 200), link);
        break;
      }
      createHandoff(t.id, 'error', null);
      S('fallida', { error: (res.error || '').slice(0, 300) }); notify('fallo', `Tarea #${t.id} falló`, (res.error || '').slice(0, 300), link);
    }
  }
}

// ---------- relevo ----------
function snapshot(t) {
  let cwd = null; try { cwd = workdir(t).cwd; } catch {}
  const prog = cwd && fs.existsSync(path.join(cwd, '.oficina', 'progreso.md')) ? fs.readFileSync(path.join(cwd, '.oficina', 'progreso.md'), 'utf8') : '(no existe .oficina/progreso.md)';
  const msgs = t.conversation_id ? all('select role, text, kind from messages where conversation_id=? order by id desc limit 12', t.conversation_id).reverse() : [];
  const lastRun = t.conversation_id ? one('select * from runs where conversation_id=? order by id desc limit 1', t.conversation_id) : null;
  const tail = lastRun?.log_path && fs.existsSync(lastRun.log_path) ? fs.readFileSync(lastRun.log_path, 'utf8').split('\n').slice(-60).join('\n') : '';
  const gitInfo = cwd && t.worktree_path ? [tryGit(cwd, 'log', '--oneline', `${t.base_branch}..HEAD`), tryGit(cwd, 'diff', '--stat', `${t.base_branch}...HEAD`)].filter(Boolean).join('\n\n') : (cwd && isGit(cwd) ? tryGit(cwd, 'diff', '--stat') : '');
  return `# Relevo de la tarea #${t.id}: ${t.title}
## Objetivo
${t.prompt || '(sin descripción)'}
## Progreso registrado (.oficina/progreso.md)
${prog}
## Últimos mensajes
${msgs.map(m => `- [${m.role}${m.kind !== 'mensaje' ? '/' + m.kind : ''}] ${m.text.slice(0, 1200)}`).join('\n') || '(sin mensajes)'}
## Cambios en git
${gitInfo || '(sin cambios registrados)'}
## Últimas líneas del log
\`\`\`
${tail}
\`\`\``;
}
function createHandoff(taskId, reason, userId, to = {}) {
  const t = one('select * from tasks where id=?', taskId);
  let sha = null;
  try { const cwd = workdir(t).cwd; if (t.worktree_path) { commit(cwd, `oficina: checkpoint task-${t.id} (relevo: ${reason})`); sha = tryGit(cwd, 'rev-parse', '--short', 'HEAD'); } } catch {}
  const id = insert('handoffs', { task_id: t.id, conversation_id: t.conversation_id, from_agent_id: t.agent_id, to_agent_id: to.agent_id || null,
    to_user_id: to.user_id || null, reason, snapshot_md: snapshot(t), commit_sha: sha, created_by: userId, at: now() });
  emit('handoff', { id, task_id: t.id });
  return id;
}
// Pasa la tarea a otro agente (o persona) con el snapshot como contexto
async function handoffTask(taskId, { agent_id, model, effort, user_id, reason = 'manual' }, userId) {
  const t = one('select * from tasks where id=?', taskId);
  if (RUNNING.includes(t.status)) { abortConv(t.conversation_id); await new Promise(r => setTimeout(r, 1500)); }
  const last = one('select * from handoffs where task_id=? and to_agent_id is null and to_user_id is null order by id desc limit 1', taskId);
  let hid;
  if (last) { update('handoffs', last.id, { to_agent_id: agent_id || null, to_user_id: user_id || null, reason: last.reason + (reason !== last.reason ? ' → ' + reason : '') }); hid = last.id; }
  else hid = createHandoff(taskId, reason, userId, { agent_id, user_id });
  const h = one('select * from handoffs where id=?', hid);
  const from = agentOf(t.agent_id);
  if (user_id) {
    changeTask(taskId, { executor: 'humano', assignee_user_id: user_id }, userId);
    setStatus(taskId, 'pendiente', userId, { relevo: hid }, true);
    log(userId, 'tarea', taskId, 'relevo', { a_usuario: user_id, motivo: reason });
    return { handoff: hid };
  }
  const to = agentOf(agent_id);
  changeTask(taskId, { agent_id, model: model || to.default_model, effort: effort || to.default_effort }, userId);
  if (t.conversation_id) insert('messages', { conversation_id: t.conversation_id, role: 'sistema', user_id: userId, text: `Relevo: ${from?.name} → ${to.name} (${reason})`, kind: 'handoff', at: now() });
  log(userId, 'tarea', taskId, 'relevo', { de: from?.key, a: to.key, motivo: reason });
  notify('relevo', `Relevo en tarea #${taskId}`, `${from?.name} → ${to.name} (${reason})`, `#/tarea/${taskId}`);
  const extra = `# RELEVO\nContinúas el trabajo que dejó ${from?.name} (motivo: ${reason}). Revisa el estado real de los archivos y .oficina/progreso.md antes de seguir; no repitas lo ya hecho.\n\n${h.snapshot_md}`;
  setStatus(taskId, 'pendiente', userId, {}, true);
  runTaskBg(taskId, userId, { fresh: true, extra }).catch(e => notify('error', `Relevo de tarea #${taskId} falló`, e.message, `#/tarea/${taskId}`));
  return { handoff: hid };
}

// ---------- aprobar / devolver ----------
function approveTask(taskId, userId, { merge = false } = {}) {
  const t = one('select * from tasks where id=?', taskId);
  if (!['revision', 'esperando'].includes(t.status)) throw new Error('Solo se aprueban tareas en revisión');
  let mergeInfo = null;
  if (merge && t.worktree_path) {
    const f = one('select * from project_folders where id=?', t.folder_id);
    const cur = git(f.path, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (cur !== t.base_branch) throw new Error(`La carpeta base está en la rama ${cur}, no en ${t.base_branch}`);
    try { git(f.path, 'merge', '--no-ff', '-m', `oficina: tarea #${t.id} ${t.title}`, t.branch); mergeInfo = 'fusionada'; }
    catch (e) {
      tryGit(f.path, 'merge', '--abort');
      const nid = createTask({ project_id: t.project_id, area_id: t.area_id, folder_id: t.folder_id, title: `Resolver conflicto al fusionar tarea #${t.id}`,
        prompt: `Fusiona la rama ${t.branch} en ${t.base_branch} resolviendo los conflictos. Error de git:\n${e.stderr || e.message}`, agent_id: t.agent_id, priority: 'alta' }, userId);
      notify('fallo', `Conflicto al fusionar tarea #${t.id}`, `Se creó la tarea #${nid} para resolverlo.`, `#/tarea/${nid}`);
      throw new Error(`Conflicto al fusionar. Se creó la tarea #${nid} para resolverlo.`);
    }
    tryGit(f.path, 'worktree', 'remove', '--force', t.worktree_path);
    tryGit(f.path, 'branch', '-d', t.branch);
    changeTask(t.id, { worktree_path: null }, userId);
  }
  setStatus(t.id, 'completada', userId, { merge: mergeInfo }, true);
  log(userId, 'tarea', t.id, 'aprobar', { merge: mergeInfo });
  return mergeInfo;
}
function returnTask(taskId, userId, comment) {
  const t = one('select * from tasks where id=?', taskId);
  changeTask(taskId, { review_comment: comment }, userId);
  log(userId, 'tarea', taskId, 'devolver', { comentario: comment });
  if (t.executor === 'agente' && t.conversation_id) return runTask(taskId, userId, { text: `El revisor devolvió la tarea con este comentario, corrígelo:\n${comment}` });
  setStatus(taskId, 'pendiente', userId, {}, true);
}

function createTask(d, userId) {
  const area = d.area_id ? one('select * from areas where id=?', d.area_id) : null;
  const agent_id = d.executor === 'humano' ? null : (d.agent_id || area?.default_agent_id || null);
  const ag = agent_id ? agentOf(agent_id) : null;
  const deps = (d.depends_on || []).map(Number).filter(Boolean);
  const id = insert('tasks', { project_id: d.project_id, area_id: d.area_id || null, folder_id: d.folder_id || null, parent_id: d.parent_id || null,
    title: d.title, prompt: d.prompt || '', executor: d.executor || 'agente', agent_id, assignee_user_id: d.assignee_user_id || null,
    model: d.model || ag?.default_model || null, effort: d.effort || ag?.default_effort || null, mode: d.mode || 'editar', priority: d.priority || 'media',
    due_date: d.due_date || null, depends_on: JSON.stringify(deps), proposal_id: d.proposal_id || null, status: 'pendiente',
    kanban_order: Date.now(), created_by: userId, assigned_by: userId, created_at: now(), updated_at: now() });
  if (depsPending(one('select * from tasks where id=?', id)).length) update('tasks', id, { status: 'bloqueada' });
  log(userId, 'tarea', id, 'crear', { titulo: d.title, agente: ag?.key });
  emit('task.created', { id, project_id: d.project_id });
  return id;
}

// ---------- arranque / emergencias ----------
function recover() {
  for (const r of all('select * from runs where ended_at is null')) update('runs', r.id, { ended_at: now(), end_reason: 'interrumpido' });
  for (const c of all(`select * from conversations where status in ('en_curso','en_cola')`)) {
    update('conversations', c.id, { status: 'esperando' });
    insert('messages', { conversation_id: c.id, role: 'sistema', text: 'El servidor se reinició y la ejecución se interrumpió. Responde (ej. "continúa") para reanudar la sesión.', kind: 'nota', at: now() });
  }
  for (const t of all(`select * from tasks where status in ('en_curso','en_cola') and deleted_at is null`)) update('tasks', t.id, { status: 'esperando' });
  for (const a of all(`select * from agents where status in ('ocupado')`)) update('agents', a.id, { status: 'disponible' });
}
function order66(userId) {
  setSetting('queue_paused', true);
  const n = queue.length + active.size;
  for (const it of queue.splice(0)) finishConv(it, { end_reason: 'abortado', final: '' });
  for (const a of active.values()) { a.aborted = true; kill(a.proc); }
  log(userId, 'sistema', null, 'orden66', { detenidos: n });
  notify('sistema', 'Orden 66 ejecutada', `${n} ejecuciones detenidas. La cola está en pausa.`, '#/puente');
  emit('queue', { paused: true });
  return n;
}
function resumeQueue(userId) { setSetting('queue_paused', false); log(userId, 'sistema', null, 'reanudar_cola'); emit('queue', { paused: false }); pump(); }

module.exports = { DEFAULT_EXCLUDE, canon, ADAPTERS, STATUS, RULES, RULES_CHAT, queue, active, pendingPerms, runTurn, runTask, runTaskBg, abortConv, answerPermission, setStatus, changeTask,
  createTask, approveTask, returnTask, handoffTask, createHandoff, snapshot, taskPrompt, validFolder, isGit, tryGit, workdir, recover, order66,
  resumeQueue, quotaTick, parseReset, saveLimits, markQuota, pump, question, isPaused, depsPending };
