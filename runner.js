// Motor de ejecución: adaptadores de CLIs, cola, turnos, estados de tarea, cuota/relevo, git.
// Todo lo que toca archivos/procesos pasa por host (máquina local o agente de campo remoto).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA, now, all, one, run, J, insert, update, bus, emit, log, notify, setting, setSetting } = require('./db');
const host = require('./host');

// ---------- estados ----------
const STATUS = ['pendiente', 'bloqueada', 'en_cola', 'en_curso', 'esperando', 'revision', 'completada', 'pausada_cuota', 'fallida'];
const RUNNING = ['en_cola', 'en_curso'];
const RULES = `## Reglas de la oficina (obligatorias)
1. Mantén el archivo .oficina/progreso.md en tu carpeta de trabajo: objetivo, checklist de pasos hechos y pendientes, decisiones y archivos tocados. Actualízalo después de cada paso importante (así otro agente puede continuar si te detienes).
2. Si necesitas una decisión del usuario, termina tu respuesta con la línea [[CONSULTA]] seguida de la pregunta (y opciones si aplica). No inventes la decisión.
3. Cuando termines, termina tu respuesta con la línea [[LISTO]] seguida de un resumen breve de lo hecho.`;
const RULES_CHAT = 'Si necesitas que el usuario decida algo antes de seguir, termina con la línea [[CONSULTA]] y la pregunta.';
const REMINDER = '(Recuerda: termina con [[LISTO]] y un resumen si terminaste, o con [[CONSULTA]] y la pregunta si necesitas una decisión.)';
// estado que hooks/herramientas del usuario dejan en cada carpeta (solo afecta archivos sin versionar)
const DEFAULT_EXCLUDE = ['.ijfw/', '.serena/', '/AGENTS.md', '/CLAUDE.md'];

// ---------- máquina y carpeta de cada tarea/conversación ----------
const folderOf = t => t?.folder_id ? one('select * from project_folders where id=?', t.folder_id) : null;
function machineOfTask(t) {
  const f = folderOf(t);
  if (f) return f.machine_id || host.defaultMachine();
  const c = t.conversation_id ? one('select machine_id from conversations where id=?', t.conversation_id) : null;
  return c?.machine_id || host.defaultMachine();
}
function machineOfConv(c) {
  if (c.task_id && c.kind === 'tarea') return machineOfTask(one('select * from tasks where id=?', c.task_id));
  return c.machine_id || host.defaultMachine();
}
// bloqueo por carpeta cuando no hay worktree (git sin worktrees o carpeta sin git)
function staticLock(t) {
  const f = folderOf(t);
  return f && !(f.is_git && f.use_worktrees) ? `folder-${f.id}` : null;
}
async function workdir(t) {
  const mid = machineOfTask(t);
  const f = folderOf(t);
  if (t.folder_id && !f) throw new Error('La carpeta de la tarea ya no existe en el proyecto');
  const r = f
    ? await host.call(mid, 'workdir', { folder: { path: f.path, use_worktrees: !!f.use_worktrees }, task: { id: t.id, title: t.title, branch: t.branch, worktree_path: t.worktree_path, base_branch: t.base_branch }, exclude: setting('checkpoint_exclude', DEFAULT_EXCLUDE) })
    : await host.call(mid, 'workdir', { sandbox: 'task-' + t.id });
  if (r.worktree_path) update('tasks', t.id, { branch: r.branch, worktree_path: r.worktree_path, base_branch: r.base_branch });
  return { ...r, mid };
}

// ---------- adaptadores ----------
// args(c, ctx) → {args, stdin}; parse(obj|string, st) acumula en st: sessionId, final, error, tokens, cost, limits[], permission
const cap = (s, n = 24000) => s.length > n ? s.slice(0, n / 2) + '\n…[recortado]…\n' + s.slice(-n / 2) : s;
function codexFallback(model, defaultModel, available) {
  const alternatives = (Array.isArray(available) ? available : []).filter(m => m && m !== model);
  return alternatives.includes(defaultModel) ? defaultModel
    : alternatives.includes('gpt-5.6-terra') ? 'gpt-5.6-terra'
    : alternatives[0] || null;
}
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
      a.push('--permission-mode', c.mode === 'plan' ? 'plan' : 'bypassPermissions'); // editar: sin terminal no hay a quién pedir permiso
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
        st.tin = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); st.tcache = u.cache_read_input_tokens || 0; st.tout = u.output_tokens || 0;
        if (o.is_error) st.error = o.result || o.subtype;
      }
    },
  },
  codex: {
    args(c, { first, prompt }) {
      const a = ['exec'];
      if (!first) a.push('resume');
      // editar = sin sandbox (el sandbox de Windows no ve las credenciales de git: push/deploy fallaban); plan = solo lectura
      a.push('--json', '--skip-git-repo-check', ...(c.mode === 'plan' ? ['-c', 'sandbox_mode="read-only"'] : ['--dangerously-bypass-approvals-and-sandbox']));
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
      if (o.type === 'turn.completed') { st.error = null; st.tin = o.usage?.input_tokens || 0; st.tcache = o.usage?.cached_input_tokens || 0; st.tout = o.usage?.output_tokens || 0; }
      if (o.type === 'turn.failed') st.error = o.error?.message || 'turn.failed';
      if (o.type === 'error') st.error = o.message || o.error?.message || String(o.error || 'error');
      const rl = o.rate_limits || o.msg?.rate_limits || o.info?.rate_limits;
      if (rl) for (const [w, v] of Object.entries(rl)) if (v && v.used_percent != null)
        st.limits.push({ win: w, pct: v.used_percent, resets: v.resets_at || (v.resets_in_seconds ? Date.now() / 1000 + v.resets_in_seconds : null) });
    },
  },
  agy: {
    args(c, { first, prompt, cwd }) {
      // sin terminal agy no puede pedir permisos y los niega todos → auto-aprobar (como el skill antigravity-agents);
      // en plan se suma --sandbox (restringe la terminal). Editar corre en el worktree de la tarea.
      const a = ['-p', cap(prompt), '--output-format', 'stream-json', '--mode', c.mode === 'plan' ? 'plan' : 'accept-edits', '--dangerously-skip-permissions'];
      if (c.mode === 'plan') a.push('--sandbox');
      if (cwd) a.push('--add-dir', cwd); // sin esto agy ejecuta los comandos en su propia carpeta scratch
      if (c.model) a.push('--model', c.model);
      if (c.effort && !/-(low|medium|high)$/.test(c.model || '')) a.push('--effort', c.effort); // agy rechaza --effort si el modelo ya lo trae
      if (!first) a.push('--conversation', c.session_id);
      return { args: a, stdin: null };
    },
    parse(o, st, out) {
      if (o.event === 'init') st.sessionId = o.conversation_id;
      const s = o.step_update;
      if (s?.step_type === 'agent_response') {
        if (s.text_delta) st.buf = (st.buf || '') + s.text_delta;
        if (s.state === 'DONE' && st.buf) { out('💬 ' + st.buf); st.buf = ''; st.agyResponseShown = true; }
      }
      if (s?.step_type === 'tool' && s.state === 'DONE') {
        const info = s.tool_info || {};
        const name = [info.name, s.tool_name].find(n => n && !['tool', 'system_message', 'checkpoint', 'user_input'].includes(String(n).toLowerCase()));
        if (!name) return;
        const compact = value => typeof value === 'string' ? value : JSON.stringify(value);
        const params = info.parameters;
        const detail = params && Object.keys(params).length
          ? (params.CommandLine || params.command || params.command_line || compact(params)) : '';
        out(`🔧 ${name}${detail ? ' · ' + cap(detail, 400) : ''}`);
        if (info.output != null && info.output !== '') out('  ↳ ' + cap(compact(info.output).trim(), 1000));
        if (info.error) out('⚠ ' + name + ': ' + cap(compact(info.error), 500));
      }
      if (o.event === 'result') {
        const r = o.result || {};
        st.final = r.response || ''; st.sessionId = r.conversation_id || st.sessionId;
        if (st.buf) { out('💬 ' + st.buf); st.buf = ''; st.agyResponseShown = true; }
        if (st.final && !st.agyResponseShown) out('💬 ' + st.final);
        st.tcache = r.usage?.cache_read_tokens || 0; st.tin = (r.usage?.input_tokens || 0) + st.tcache; st.tout = r.usage?.output_tokens || 0; // agy informa la caché aparte
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
const active = new Map();      // runId → {convId, agentId, mid, lock, st, aborted, timedOut}
const pendingPerms = new Map();// requestId → {runId, input, convId, taskId}
const PRI = { alta: 0, media: 1, baja: 2 };
const isPaused = () => setting('queue_paused', false);

function agentOf(id) { return one('select * from agents where id=?', id); }
function conv(id) { return one('select * from conversations where id=?', id); }
function taskOfConv(c) { return c.task_id && c.kind === 'tarea' ? one('select * from tasks where id=?', c.task_id) : null; }
const busyCount = agentId => [...active.values()].filter(a => a.agentId === agentId).length;

function pump() {
  if (isPaused()) return;
  for (const item of [...queue]) {
    const c = conv(item.convId);
    const ag = agentOf(c.agent_id);
    if (!ag?.enabled || ag.status === 'sin_cuota') continue;
    if (busyCount(ag.id) >= ag.max_concurrent) continue;
    const mid = machineOfConv(c);
    if (!host.online(mid)) continue; // la PC está apagada/desconectada: espera en cola
    if (item.lock && [...active.values()].some(a => a.lock === item.lock)) continue;
    queue.splice(queue.indexOf(item), 1);
    start(item, mid).catch(e => finishConv(item, { end_reason: 'error', error: e.message, final: '' }));
  }
}
bus.on('machine.online', () => setTimeout(pump, 200));

// Encola un turno. Devuelve promesa con el resultado del turno.
function runTurn(convId, userText, { userId = null, prompt = null, supervised = false, lock = null, priority = 'media' } = {}) {
  if (queue.some(q => q.convId === convId) || [...active.values()].some(a => a.convId === convId)) throw new Error('Esta conversación ya está en ejecución');
  if (userText) insert('messages', { conversation_id: convId, role: 'usuario', user_id: userId, text: userText, kind: 'mensaje', at: now() });
  update('conversations', convId, { status: 'en_cola', updated_at: now() });
  emit('conv.updated', { id: convId });
  const c = conv(convId);
  if (!host.online(machineOfConv(c))) insert('messages', { conversation_id: convId, role: 'sistema', text: `La máquina "${host.machine(machineOfConv(c))?.name || '?'}" no está conectada: el turno queda en cola y arrancará cuando se conecte.`, kind: 'nota', at: now() });
  return new Promise(resolve => {
    queue.push({ convId, prompt: prompt || userText, userId, supervised, lock, resolve, pri: PRI[priority] ?? 1, at: Date.now() });
    queue.sort((a, b) => a.pri - b.pri || a.at - b.at);
    pump();
  });
}

// adjuntos de la conversación (y de su tarea) aún no anunciados al agente
function attachmentsFor(c, sinceRun) {
  const since = sinceRun?.started_at || '';
  const list = all(`select * from attachments where (conversation_id=? ${c.task_id ? 'or task_id=?' : ''}) order by id`, c.id, ...(c.task_id ? [c.task_id] : []));
  return { all: list, fresh: list.filter(a => a.at > since) };
}

async function start(item, mid) {
  const c = conv(item.convId);
  const ag = agentOf(c.agent_id);
  const ad = ADAPTERS[ag.adapter];
  const task = taskOfConv(c);
  let first = !c.session_id;
  if (first && ad.newSession) update('conversations', c.id, { session_id: ad.newSession() });
  const cc = conv(c.id);
  // reservar el cupo antes de cualquier await para que pump() no lance dos veces
  const act = { convId: c.id, agentId: ag.id, mid, lock: item.lock, st: null, runId: null };
  const key = 'pre-' + c.id;
  active.set(key, act);
  let cwd;
  try {
    cwd = task ? (await workdir(one('select * from tasks where id=?', task.id))).cwd
      : cc.folder_path || (await host.call(mid, 'workdir', { sandbox: 'conv-' + c.id })).cwd;
  } catch (e) { active.delete(key); throw e; }
  // El catálogo del agente puede quedar desactualizado; consulta la máquina que ejecutará Codex.
  if (ag.adapter === 'codex' && cc.model) {
    try {
      const available = await host.call(mid, 'detectModels', { adapter: 'codex', exe: ag.exe, pre_args: J(ag.pre_args, []) });
      if (available.length && !available.includes(cc.model)) {
        const previous = cc.model;
        const next = codexFallback(previous, ag.default_model, available);
        if (next) {
          cc.model = next;
          first = true;
          update('conversations', c.id, { model: next, session_id: null });
          if (task) update('tasks', task.id, { model: next });
          item.modelNotice = `El modelo ${previous} no está disponible en esta máquina; se usará ${next}.`;
        }
      }
    } catch { /* Sin catálogo local: el CLI validará el modelo al ejecutar. */ }
  }
  const lastRun = one('select * from runs where conversation_id=? order by id desc limit 1', c.id);
  const att = attachmentsFor(cc, first ? null : lastRun);
  let prompt = item.prompt;
  if (first && lastRun) {
    const hist = all(`select role,text from messages where conversation_id=? and kind!='nota' order by id desc limit 20`, c.id).reverse();
    prompt = [task ? taskPrompt(task) : RULES_CHAT, '# Conversación hasta ahora (la sesión anterior se perdió; retoma desde aquí)',
      hist.map(m => `**${m.role}:** ${m.text}`).join('\n\n'), '# Mensaje actual', item.prompt].join('\n\n');
  }
  if (att.all.length) {
    try {
      const rel = await host.call(mid, 'putFiles', { cwd, files: att.all.map(a => ({ id: a.id, name: a.name, size: a.size })) });
      const fresh = att.fresh.map(a => rel[att.all.indexOf(a)]);
      if (fresh.length) prompt += `\n\n# Archivos adjuntos (ya están en tu carpeta de trabajo)\n${att.fresh.map((a, i) => `- ${fresh[i]} (${a.mime || 'archivo'}, ${Math.ceil(a.size / 1024)} KB)`).join('\n')}\nLéelos con tus herramientas si los necesitas.`;
    } catch (e) { prompt += `\n\n(No se pudieron entregar los adjuntos: ${e.message})`; }
  }
  const supervised = item.supervised && ag.adapter === 'claude';
  const b = ad.args(cc, { first, prompt, supervised, convId: c.id, cwd });
  const args = [...J(ag.pre_args, []), ...b.args, ...J(ag.extra_args, [])];
  const turn = (one('select count(*) n from runs where conversation_id=?', c.id).n || 0) + 1;
  const runId = insert('runs', { conversation_id: c.id, task_id: task?.id ?? null, agent_id: ag.id, model: cc.model, effort: cc.effort, turn,
    command: [ag.exe, ...args].map(x => (/\s/.test(x) ? JSON.stringify(x.length > 120 ? x.slice(0, 120) + '…' : x) : x)).join(' '),
    started_by: item.userId, started_at: now(), log_path: path.join(DATA, 'runs', 'run-' + Date.now() + '-' + c.id + '.log') });
  const logf = fs.openSync(one('select log_path from runs where id=?', runId).log_path, 'a');
  const out = line => { fs.writeSync(logf, line + '\n'); emit('run.log', { run_id: runId, conv_id: c.id, task_id: task?.id ?? null, line }); };
  const mname = host.machine(mid)?.name || '';
  out(`▶ ${ag.name} · ${cc.model || 'modelo por defecto'} · ${cc.effort || '-'} · turno ${turn} · ${mname} · ${cwd}`);
  if (item.modelNotice) { out('ℹ ' + item.modelNotice); item.modelNotice = null; }

  const st = { limits: [], final: '', error: null, tin: 0, tout: 0, cost: 0 };
  Object.assign(act, { st, runId });
  active.delete(key); active.set(runId, act);
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

  let errTail = '';
  let exitRes;
  const exited = new Promise(r => { exitRes = r; });
  const onEvent = ev => {
    if (ev.t === 'out') {
      let o = null; try { o = JSON.parse(ev.line); } catch {}
      try { ad.parse(ag.adapter === 'fake' ? ev.line : (o ?? null) || {}, st, out); } catch (e) { out('⚠ parser: ' + e.message); }
      if (!o && ag.adapter !== 'fake') out(ev.line);
      if (st.sessionId && st.sessionId !== st.savedSid) { st.savedSid = st.sessionId; update('conversations', c.id, { session_id: st.sessionId }); }
      if (st.done && b.keepOpen && !st.ended) { st.ended = true; host.runOp(runId, 'endRun'); }
    } else if (ev.t === 'err') {
      errTail = (errTail + ev.text).slice(-3000);
      for (const l of ev.text.split(/\r?\n/)) if (l.trim()) out('⚠ ' + l);
    } else if (ev.t === 'exit') {
      if (ev.error) st.error = ev.error;
      exitRes(ev.code);
    }
  };
  const timer = setTimeout(() => { act.timedOut = true; host.runOp(runId, 'killRun'); }, (ag.timeout_min || 30) * 60000);
  try {
    const { pid } = await host.spawnRun(mid, { runId, exe: ag.exe, args, cwd, env: { OFICINA_TASK: String(task?.id ?? ''), OFICINA_CONV: String(c.id) }, stdin: b.stdin, keepOpen: b.keepOpen }, onEvent);
    update('runs', runId, { pid: pid ?? null });
  } catch (e) { st.error = e.message; exitRes(-1); }

  const code = await exited;
  clearTimeout(timer);
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
  let retryModel = null;
  if (ag.adapter === 'codex' && !item.codexModelRetried && /model is not supported when using Codex with a ChatGPT account/i.test(errText)) {
    let available = [];
    try { available = await host.call(mid, 'detectModels', { adapter: 'codex', exe: ag.exe, pre_args: J(ag.pre_args, []) }); } catch {}
    retryModel = act.aborted ? null : codexFallback(cc.model, ag.default_model, available);
    if (retryModel) {
      const previous = cc.model;
      update('conversations', c.id, { model: retryModel, session_id: null, status: 'en_cola' });
      if (task) update('tasks', task.id, { model: retryModel });
      item.codexModelRetried = true;
      item.modelNotice = `Codex rechazó ${previous}; se reintenta con ${retryModel}.`;
    }
  }
  if (act.aborted) { retryModel = null; end_reason = 'abortado'; }
  out(`■ fin: ${end_reason} (exit ${code})${errText ? ' · ' + errText.slice(0, 300) : ''}`);
  fs.closeSync(logf);

  // costo: el que informa el CLI (Claude) o estimado con la tabla de precios del agente (caché al 10 % si no hay precio propio)
  const pr = J(ag.prices, {})[cc.model || ag.default_model];
  if (!st.cost && pr) st.cost = ((st.tin - (st.tcache || 0)) * pr[0] + (st.tcache || 0) * (pr[2] ?? pr[0] / 10) + st.tout * pr[1]) / 1e6;
  if (!retryModel && st.sessionId && st.sessionId !== cc.session_id) update('conversations', c.id, { session_id: st.sessionId });
  update('runs', runId, { ended_at: now(), exit_code: code, end_reason, tokens_in: st.tin, tokens_out: st.tout, cost_usd: st.cost });
  saveLimits(ag.id, st.limits);
  if (end_reason === 'cuota') markQuota(ag, errText || '', st.resetAt);
  else if (end_reason !== 'error') update('agents', ag.id, { last_error: null });
  if (end_reason === 'error') update('agents', ag.id, { last_error: errText.slice(0, 500) });

  active.delete(runId);
  if (retryModel) {
    queue.push(item);
    queue.sort((a, b) => a.pri - b.pri || a.at - b.at);
    pump();
    return;
  }

  await finishConv(item, { run_id: runId, end_reason, final: st.final, error: errText, code });
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
  try {
    if (task) await onTaskTurnEnd(task.id, res, item);
    else {
      const status = { consulta: 'esperando', cuota: 'sin_cuota', error: 'error', timeout: 'error' }[res.end_reason] || 'inactiva';
      update('conversations', c.id, { status, updated_at: now() });
      if (res.end_reason === 'consulta') notify('consulta', `${ag.name} te consulta`, question(text), `#/cantina/${c.id}`);
      if (res.end_reason === 'cuota') notify('cuota', `${ag.name} sin cuota`, 'La consulta rápida se detuvo. Puedes continuarla con otro agente.', `#/cantina/${c.id}`);
    }
  } finally {
    emit('conv.updated', { id: c.id });
    item.resolve?.(res);
  }
}
// texto de la pregunta: lo que va tras [[CONSULTA]] (o lo previo si el marcador va al final), sin markdown
const question = t => { const [a, b = ''] = String(t).split('[[CONSULTA]]'); return (b.trim() || a).replace(/\*\*|`|\[\[\w+\]\]/g, '').trim().slice(-400); };

function abortConv(convId) {
  const qi = queue.findIndex(q => q.convId === convId);
  if (qi >= 0) { const [it] = queue.splice(qi, 1); finishConv(it, { end_reason: 'abortado', final: '' }); return true; }
  for (const a of active.values()) if (a.convId === convId && a.runId) { a.aborted = true; host.runOp(a.runId, 'killRun'); return true; }
  return false;
}
async function answerPermission(requestId, allow, userId) {
  const p = pendingPerms.get(requestId);
  if (!p) throw new Error('El permiso ya no está pendiente');
  const response = allow ? { behavior: 'allow', updatedInput: p.input } : { behavior: 'deny', message: 'Denegado por el usuario desde la oficina' };
  await host.runOp(p.runId, 'writeRun', { data: JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) + '\n' });
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

// Ejecuta (o reanuda) una tarea. Lanza error sincrónico si no se puede encolar; devuelve la promesa del turno.
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
  if (t.folder_id && !folderOf(t)) throw new Error('La carpeta de la tarea ya no existe en el proyecto');
  let c = t.conversation_id ? conv(t.conversation_id) : null;
  const newConv = !c || c.agent_id !== t.agent_id || opts.fresh;
  if (newConv) {
    const cid = insert('conversations', { kind: 'tarea', task_id: t.id, project_id: t.project_id, title: t.title, agent_id: t.agent_id, model: t.model || ag.default_model,
      effort: t.effort || ag.default_effort, mode: t.mode === 'plan' ? 'plan' : 'editar', machine_id: c?.machine_id ?? null, created_by: userId, created_at: now(), updated_at: now() });
    changeTask(t.id, { conversation_id: cid }, userId);
    c = conv(cid);
  } else update('conversations', c.id, { model: t.model || c.model, effort: t.effort || c.effort, mode: t.mode === 'plan' ? 'plan' : 'editar' });
  const prompt = newConv ? taskPrompt(t, opts.extra) : `${opts.text || 'Continúa con la tarea.'}\n\n${REMINDER}`;
  setStatus(t.id, 'en_cola', userId, {}, true);
  log(userId, 'tarea', t.id, 'ejecutar', { agente: ag.key, modelo: t.model, esfuerzo: t.effort });
  if (newConv) insert('messages', { conversation_id: c.id, role: 'sistema', user_id: userId, text: `Tarea asignada a ${ag.name} (${t.model || ag.default_model} · ${t.effort || ag.default_effort})`, kind: 'nota', at: now() });
  return runTurn(c.id, newConv ? null : opts.text, { userId, prompt, supervised: t.mode === 'supervisado', lock: staticLock(t), priority: t.priority });
}
const runTaskBg = (...a) => Promise.resolve().then(() => runTask(...a));

async function onTaskTurnEnd(taskId, res, item) {
  const t = one('select * from tasks where id=?', taskId);
  const ag = agentOf(t.agent_id);
  const link = `#/tarea/${t.id}`;
  const mid = machineOfTask(t);
  if (host.online(mid)) {
    try {
      if (t.worktree_path) {
        await host.call(mid, 'checkpoint', { cwd: t.worktree_path, message: `oficina: checkpoint task-${t.id} (${ag.key}, ${res.end_reason})` });
        const g = await host.call(mid, 'gitInfo', { cwd: t.worktree_path, base: t.base_branch });
        if (g.git) update('runs', res.run_id, { diff_stat: g.diffStat ?? '' });
      } else if (folderOf(t)) {
        const g = await host.call(mid, 'gitInfo', { cwd: folderOf(t).path });
        if (g.git) update('runs', res.run_id, { diff_stat: g.diffStat ?? '' });
      }
    } catch {}
  }
  const S = (s, d) => setStatus(t.id, s, null, d, true);
  switch (res.end_reason) {
    case 'listo':
      changeTask(t.id, { summary: (res.final.split('[[LISTO]]')[1] || res.final).trim().slice(0, 4000), review_comment: null }, null);
      S('revision'); notify('revision', `Tarea #${t.id} lista para revisión`, `${ag.name}: ${t.title}`, link); break;
    case 'consulta': case 'sin_marcador':
      S('esperando'); notify('consulta', `${ag.name} consulta en tarea #${t.id}`, question(res.final) || 'Terminó el turno sin marcador; revisa y responde.', link); break;
    case 'cuota': {
      const h = await createHandoff(t.id, 'cuota', null);
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
    case 'timeout': await createHandoff(t.id, 'timeout', null); S('fallida', { motivo: 'timeout' }); notify('fallo', `Tarea #${t.id} excedió el tiempo`, t.title, link); break;
    default: {
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|\b50[0-9]\b|overloaded|network|se desconectó|se reinició/i.test(res.error || '');
      if (transient && !item.retried) {
        S('pendiente');
        setTimeout(() => runTaskBg(t.id, item.userId, { text: 'Hubo un error de red o de la máquina; continúa donde quedaste.' }).catch(() => {}), 5000);
        notify('fallo', `Tarea #${t.id}: error transitorio, reintentando`, (res.error || '').slice(0, 200), link);
        break;
      }
      await createHandoff(t.id, 'error', null);
      S('fallida', { error: (res.error || '').slice(0, 300) }); notify('fallo', `Tarea #${t.id} falló`, (res.error || '').slice(0, 300), link);
    }
  }
}

// ---------- relevo ----------
async function snapshot(t) {
  const mid = machineOfTask(t);
  const cwd = t.worktree_path || folderOf(t)?.path || null;
  let prog = '(no existe .oficina/progreso.md)', gitInfo = '';
  if (cwd && host.online(mid)) {
    try { prog = (await host.call(mid, 'readText', { cwd, rel: '.oficina/progreso.md' })) || prog; } catch {}
    try { const g = await host.call(mid, 'gitInfo', { cwd, base: t.worktree_path ? t.base_branch : null }); gitInfo = [g.log, g.diffStat].filter(Boolean).join('\n\n'); } catch {}
  }
  const msgs = t.conversation_id ? all('select role, text, kind from messages where conversation_id=? order by id desc limit 12', t.conversation_id).reverse() : [];
  const lastRun = t.conversation_id ? one('select * from runs where conversation_id=? order by id desc limit 1', t.conversation_id) : null;
  const tail = lastRun?.log_path && fs.existsSync(lastRun.log_path) ? fs.readFileSync(lastRun.log_path, 'utf8').split('\n').slice(-60).join('\n') : '';
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
async function createHandoff(taskId, reason, userId, to = {}) {
  const t = one('select * from tasks where id=?', taskId);
  let sha = null;
  const mid = machineOfTask(t);
  if (t.worktree_path && host.online(mid)) try { sha = await host.call(mid, 'checkpoint', { cwd: t.worktree_path, message: `oficina: checkpoint task-${t.id} (relevo: ${reason})` }); } catch {}
  const id = insert('handoffs', { task_id: t.id, conversation_id: t.conversation_id, from_agent_id: t.agent_id, to_agent_id: to.agent_id || null,
    to_user_id: to.user_id || null, reason, snapshot_md: await snapshot(t), commit_sha: sha, created_by: userId, at: now() });
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
  else hid = await createHandoff(taskId, reason, userId, { agent_id, user_id });
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
async function approveTask(taskId, userId, { merge = false } = {}) {
  const t = one('select * from tasks where id=?', taskId);
  if (!['revision', 'esperando'].includes(t.status)) throw new Error('Solo se aprueban tareas en revisión');
  let mergeInfo = null;
  if (merge && t.worktree_path) {
    const f = folderOf(t);
    const r = await host.call(machineOfTask(t), 'merge', { repo: f.path, branch: t.branch, base_branch: t.base_branch, message: `oficina: tarea #${t.id} ${t.title}`, worktree_path: t.worktree_path });
    if (r.error) throw new Error(r.error);
    if (r.conflict) {
      const nid = createTask({ project_id: t.project_id, area_id: t.area_id, folder_id: t.folder_id, title: `Resolver conflicto al fusionar tarea #${t.id}`,
        prompt: `Fusiona la rama ${t.branch} en ${t.base_branch} resolviendo los conflictos. Error de git:\n${r.conflict}`, agent_id: t.agent_id, priority: 'alta' }, userId);
      notify('fallo', `Conflicto al fusionar tarea #${t.id}`, `Se creó la tarea #${nid} para resolverlo.`, `#/tarea/${nid}`);
      throw new Error(`Conflicto al fusionar. Se creó la tarea #${nid} para resolverlo.`);
    }
    mergeInfo = 'fusionada';
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
const orphans = new Map(); // runId → máquina: procesos que pueden seguir vivos en la PC tras un reinicio del servidor
bus.on('machine.online', mid => { for (const [runId, m] of orphans) if (m === mid) { orphans.delete(runId); host.call(mid, 'killRun', { runId }).catch(() => {}); } });
function recover() {
  for (const r of all('select * from runs where ended_at is null')) {
    update('runs', r.id, { ended_at: now(), end_reason: 'interrumpido' });
    const c = conv(r.conversation_id); if (c) orphans.set(r.id, machineOfConv(c));
  }
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
  for (const a of active.values()) if (a.runId) { a.aborted = true; host.runOp(a.runId, 'killRun'); }
  log(userId, 'sistema', null, 'orden66', { detenidos: n });
  notify('sistema', 'Orden 66 ejecutada', `${n} ejecuciones detenidas. La cola está en pausa.`, '#/puente');
  emit('queue', { paused: true });
  return n;
}
function resumeQueue(userId) { setSetting('queue_paused', false); log(userId, 'sistema', null, 'reanudar_cola'); emit('queue', { paused: false }); pump(); }

module.exports = { DEFAULT_EXCLUDE, ADAPTERS, STATUS, RULES, RULES_CHAT, codexFallback, queue, active, pendingPerms, runTurn, runTask, runTaskBg, abortConv, answerPermission, setStatus, changeTask,
  createTask, approveTask, returnTask, handoffTask, createHandoff, snapshot, taskPrompt, workdir, folderOf, machineOfTask, machineOfConv, recover, order66,
  resumeQueue, quotaTick, parseReset, saveLimits, markQuota, pump, question, isPaused, depsPending };
