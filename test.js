// Self-check end-to-end con agentes falsos. Uso: node --no-warnings test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-test-'));
process.env.OFICINA_DATA = path.join(TMP, 'data');
process.env.OFICINA_NO_TOAST = '1';
process.env.OFICINA_KILL_GRACE_MS = '400';
process.env.OFICINA_CANTINA = path.join(TMP, 'cantina');
const PORT = 4300 + Math.floor(Math.random() * 500);
process.env.OFICINA_PORT = String(PORT);

const { startServer } = require('./server');
const { one, all, insert, update, bus } = require('./db');
const R = require('./runner');
const C = require('./council');

// agente falso: decide su respuesta según palabras clave del prompt (stdin)
const FAKE = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const fs=require('fs');
if(s.includes('Consejo Jedi')||s.includes('moderador'))return console.log('Aquí va:\\n\`\`\`json\\n'+JSON.stringify({propuestas:[{title:'Agregar pruebas',description:'Cubrir salida.txt',impact:'alto',effort:'bajo',area:'Desarrollo',agent:'fake'},{title:'Documentar API',description:'README',impact:'medio',effort:'bajo',area:'Documentación'}]})+'\\n\`\`\`');
if(s.includes('JSONMALO'))return console.log('no hay json aquí');
if(s.includes('ADJUNTO')&&!s.includes('# RELEVO')){const rel=(s.match(/- (\\.oficina\\/adjuntos\\/[^\\s]+)/)||[])[1];if(!rel)throw Error('No encontré la ruta anunciada del adjunto');const t=fs.readFileSync(rel,'utf8');fs.writeFileSync('salida.txt',t);return console.log('Leí: '+t+'\\n[[LISTO]] Leí: '+t);}
if(s.includes('Descompón'))return console.log(JSON.stringify({subtareas:[{title:'Sub A',prompt:'a',area:'Análisis'},{title:'Sub B',prompt:'b',area:'Desarrollo',depends_on:[0]}]}));
if(s.includes('sesión anterior se perdió')){fs.writeFileSync('ctx-prompt.txt',s);return console.log('[[LISTO]] retomé');}
if(s.includes('# RELEVO')){fs.writeFileSync('relevo-prompt.txt',s);return console.log('Continué.\\n[[LISTO]] Relevo completado');}
if(s.includes('SINMARCA'))return console.log('olvidé el marcador');
if(s.includes('PREGUNTA'))return console.log('Necesito saber algo.\\n[[CONSULTA]] ¿Cómo se llama el archivo?');
if(s.includes('CUOTA')){console.error("You've hit your usage limit. try again at 3:00 PM");process.exit(1)}
if(s.includes('FALLA')){console.error('boom');process.exit(1)}
if(s.includes('LENTO'))return setTimeout(()=>{},600000);
fs.mkdirSync('.oficina',{recursive:true});fs.writeFileSync('.oficina/progreso.md','- [x] paso 1');
fs.writeFileSync('salida.txt','hecho '+s.length);console.log('Hecho.\\n[[LISTO]] Creé salida.txt');});`;

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
const task = id => one('select * from tasks where id=?', id);
const events = [];
bus.on('ev', e => events.push(e));

function gitRepo(name) {
  const d = path.join(TMP, name); fs.mkdirSync(d);
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'README.md'), '# repo');
  g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return d;
}

(async () => {
  let server = null;
  let failed = 0;
  const t = async (name, fn) => { try { await fn(); console.log('✔', name); } catch (e) { failed++; console.error('✘', name, '\n  ', e.stack || e); } };
  try {
    server = await startServer(PORT);
    await t('auth: setup único, login incorrecto, bloqueo tras 5 intentos', async () => {
      assert.equal((await api('GET', '/api/setup')).needed, true);
      await api('POST', '/api/setup', { username: 'vader', password: 'secreto1', name: 'Darth' });
      await rejects(api('POST', '/api/setup', { username: 'x', password: 'secreto1' }), /Ya existe/);
      cookie = '';
      await rejects(api('GET', '/api/me'), /Inicia sesión/);
      await rejects(api('POST', '/api/login', { username: 'vader', password: 'mal' }), /incorrectos/);
      for (let i = 0; i < 4; i++) await rejects(api('POST', '/api/login', { username: 'vader', password: 'mal' }));
      await rejects(api('POST', '/api/login', { username: 'vader', password: 'secreto1' }), /Demasiados intentos/);
    });

    // vader queda bloqueado 5 min; la suite usa otro admin creado directo en BD.
    const { hashPw } = require('./server');
    insert('users', { username: 'leia', name: 'Leia', pass_hash: hashPw('secreto1'), role: 'admin', created_at: new Date().toISOString() });
    insert('users', { username: 'r2', name: 'R2', pass_hash: hashPw('secreto1'), role: 'observador', created_at: new Date().toISOString() });

  // un error de sintaxis en un módulo del frontend deja la app en negro sin que ninguna API falle
  await t('frontend: los módulos de public/ compilan', async () => {
    for (const f of fs.readdirSync(path.join(__dirname, 'public')).filter(f => f.endsWith('.js')))
      execFileSync(process.execPath, ['--check', '--input-type=module'], { input: fs.readFileSync(path.join(__dirname, 'public', f)), stdio: ['pipe', 'ignore', 'pipe'] });
  });
  for (const script of ['test-hostops.js', 'test-frontend.js']) {
    const file = path.join(__dirname, script);
    if (fs.existsSync(file)) await t(`regresión: ${script}`, async () => execFileSync(process.execPath, ['--no-warnings', file], { stdio: 'inherit' }));
  }
  await t('codex: límites 5h/semanal leídos del rollout de la sesión', async () => {
    const home = path.join(TMP, 'codex-home'), day = path.join(home, 'sessions', '2026', '09', '26');
    fs.mkdirSync(day, { recursive: true });
    const tc = pct => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: pct, window_minutes: 300, resets_at: 1790471863 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1791058663 } } } });
    fs.writeFileSync(path.join(day, 'rollout-2026-09-26T19-08-08-abc12345-6789.jsonl'), [JSON.stringify({ type: 'session_meta' }), tc(10), tc(42), ''].join('\n'));
    const prev = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
    try {
      const ops = require('./hostops').create({ dataDir: TMP }).ops;
      const rl = ops.codexLimits({ thread_id: 'abc12345-6789' });
      assert.equal(rl.primary.used_percent, 42, 'toma el último token_count');
      assert.equal(rl.secondary.used_percent, 12);
      assert.equal(ops.codexLimits({ thread_id: '../../etc' }), null);
      assert.equal(ops.codexLimits({ thread_id: 'no-existe-123' }), null);
    } finally { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; }
  });
  await t('antigravity: cuota por modelo → ventana de 5 h (modelo pedido o el más consumido)', async () => {
    const q = { models: [{ label: 'Gemini 3.8 Flash (High)', remaining: 0.75, resets: '2026-09-27T04:46:48Z' }, { label: 'Claude Opus 4.6 (Thinking)', remaining: 0.1, resets: '2026-09-27T05:11:32Z' }] };
    assert.deepEqual(R.agyLimits(q, 'gemini-3.8-flash-high'), [{ win: 'five_hour', pct: 25, resets: '2026-09-27T04:46:48Z' }]);
    assert.equal(Math.round(R.agyLimits(q, 'otro')[0].pct), 90);
    assert.deepEqual(R.agyLimits(null, 'x'), []);
  });
  await t('áreas: tipo de sala sembrado, validado y editable', async () => {
    cookie = ''; await api('POST', '/api/login', { username: 'leia', password: 'secreto1' });
    const areas = (await api('GET', '/api/bootstrap')).areas;
    assert.equal(areas.find(a => a.name === 'Desarrollo').room, 'dev');
    const { id } = await api('POST', '/api/areas', { name: 'QA', room: 'hackeo' });
    assert.equal(one('select room from areas where id=?', id).room, '');
    await api('PUT', '/api/areas/' + id, { room: 'ana' });
    assert.equal(one('select room from areas where id=?', id).room, 'ana');
    await api('DELETE', '/api/areas/' + id);
  });
  await t('PWA: manifest servido sin sesión y con iconos que existen', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
    assert.equal(r.headers.get('content-type'), 'application/manifest+json');
    for (const i of (await r.json()).icons) assert.equal((await fetch(`http://127.0.0.1:${PORT}${i.src}`)).headers.get('content-type'), 'image/png', i.src);
  });

  await t('login admin y roles (observador no ejecuta)', async () => {
    cookie = ''; await api('POST', '/api/login', { username: 'r2', password: 'secreto1' });
    assert.equal((await api('GET', '/api/me')).role, 'observador');
    await rejects(api('POST', '/api/projects', { name: 'x' }), /permiso/);
    cookie = ''; await api('POST', '/api/login', { username: 'leia', password: 'secreto1' });
    assert.equal((await api('GET', '/api/me')).username, 'leia');
    await api('PUT', '/api/me', { notif_prefs: { theme: 'blanco' } });
    assert.equal((await api('GET', '/api/me')).notif_prefs?.theme, 'blanco');
  });

  await t('perfil: avatar por usuario (Darth Vader) se guarda y el sprite existe', async () => {
    const { pathToFileURL } = require('node:url');
    const SP = await import(pathToFileURL(path.join(__dirname, 'public', 'sprites.js')).href);
    assert.match(SP.userSprite({ avatar: 'vader' }, 2), /^<svg/);
    assert.notEqual(SP.userSprite({ avatar: 'vader' }), SP.userSprite({ avatar: 'rebel' }));
    assert.equal(SP.userSprite({ role: 'admin' }), SP.sprite('imperial', '#ff8c42', 2, ''), 'sin avatar cae al rol');
    for (const k of ['vader', 'mono', 'cr7', 'bebe']) {
      const svg = SP.sprite(k, '#fff', 2);
      assert.doesNotMatch(svg, /fill="undefined"/, `${k}: todos los colores están en la paleta`);
      assert.match(svg, /viewBox="0 0 24 24" width="32" height="32"/, `${k}: 24×24 escalado al tamaño de uno de 16`);
    }
    await api('PUT', '/api/me', { avatar: 'vader' });
    assert.equal((await api('GET', '/api/me')).avatar, 'vader');
    const users = await api('GET', '/api/users');
    assert.equal(users.find(u => u.username === 'leia').avatar, 'vader');
    assert.equal(users.find(u => u.username === 'r2').avatar, 'rebel', 'los demás conservan su avatar');
  });

  // agentes falsos
  const mk = (key, extra = {}) => insert('agents', { key, name: key, adapter: 'fake', exe: process.execPath, pre_args: JSON.stringify(['-e', FAKE]), models: '["m1"]', efforts: '["low"]',
    default_model: 'm1', default_effort: 'low', max_concurrent: 1, timeout_min: 1, quota_patterns: JSON.stringify(['usage limit', 'try again at']), color: '#fff', ...extra });
  const fake = mk('fake'), fake2 = mk('fake2'), fake3 = mk('fake3');
  const areas = all('select * from areas');
  const dev = areas.find(a => a.name === 'Desarrollo').id, docs = areas.find(a => a.name === 'Documentación').id, ana = areas.find(a => a.name === 'Análisis').id;
  update('areas', dev, { fallback_chain: JSON.stringify([fake, fake2]) });

  const repo = gitRepo('repo'), repo2 = gitRepo('repo2');
  let pid, folder1, folder2, regPid;

  await t('proyectos: rutas inválidas rechazadas, 2 carpetas, solo-registro', async () => {
    await rejects(api('POST', '/api/projects', { name: 'Malo', folders: [{ path: 'C:\\' }] }), /raíz/);
    await rejects(api('POST', '/api/projects', { name: 'Malo', folders: [{ path: path.join(TMP, 'noexiste') }] }), /no existe/);
    pid = (await api('POST', '/api/projects', { name: 'Estrella', status: 'activo', briefing: 'Usa español.', folders: [{ label: 'back', path: repo }, { label: 'docs', path: repo2 }] })).id;
    const p = (await api('GET', '/api/projects')).find(x => x.id === pid);
    assert.equal(p.kind, 'con_carpetas'); assert.equal(p.folders.length, 2); assert.equal(p.folders[0].is_git, 1);
    [folder1, folder2] = p.folders.map(f => f.id);
    regPid = (await api('POST', '/api/projects', { name: 'Solo notas' })).id;
    assert.equal((await api('GET', '/api/projects')).find(x => x.id === regPid).kind, 'solo_registro');
  });

  await t('tarea humana: se mueve sin runner; transiciones inválidas rechazadas; historial con autor', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Llamar a Yoda', executor: 'humano' })).id;
    await api('POST', `/api/tasks/${id}/move`, { status: 'revision' });
    await rejects(api('PUT', `/api/tasks/${id}`, { status: 'bloqueada' }), /Transición no permitida/);
    await api('PUT', `/api/tasks/${id}`, { status: 'completada', priority: 'alta' });
    assert.equal(task(id).status, 'completada');
    const h = all('select * from task_history where task_id=?', id);
    assert.ok(h.some(x => x.field === 'priority' && x.new_value === 'alta' && x.user_id));
    assert.ok(one(`select 1 from activity where entity='tarea' and entity_id=? and action='estado' and user_id is not null`, id));
  });

  await t('agente sin carpeta corre en data/sandbox y termina en revisión con [[LISTO]]', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Redactar', prompt: 'escribe', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'revision', 15000, 'revision');
    assert.ok(fs.existsSync(path.join(process.env.OFICINA_DATA, 'sandbox', 'task-' + id, 'salida.txt')));
    assert.match(task(id).summary, /Creé salida/);
    assert.equal(one('select status from conversations where id=?', task(id).conversation_id).status, 'inactiva', 'la conversación de la tarea no queda en_curso');
    const d = await api('GET', `/api/tasks/${id}`);
    assert.ok(d.files.some(f => f.name === 'salida.txt'));
    assert.ok(events.some(e => e.type === 'run.log' && e.data.task_id === id));
  });

  let qid;
  await t('consulta → esperando + SSE consulta; respuesta reanuda; worktree + diff; aprobar y fusionar', async () => {
    qid = (await api('POST', '/api/tasks', { project_id: pid, folder_id: folder1, area_id: dev, title: 'Crear archivo', prompt: 'PREGUNTA primero', agent_id: fake })).id;
    await api('POST', `/api/tasks/${qid}/run`, {});
    await until(() => task(qid).status === 'esperando', 15000, 'esperando');
    assert.ok(events.some(e => e.type === 'notify' && e.data.kind === 'consulta'));
    const wt = task(qid).worktree_path;
    assert.ok(wt && fs.existsSync(wt) && wt.includes('.oficina-worktrees'));
    const sess = one('select session_id from conversations where id=?', task(qid).conversation_id).session_id;
    await api('POST', `/api/tasks/${qid}/reply`, { text: 'se llama salida.txt' });
    await until(() => task(qid).status === 'revision', 15000, 'revision');
    assert.equal(one('select session_id from conversations where id=?', task(qid).conversation_id).session_id, sess, 'misma sesión');
    assert.equal(one('select count(*) n from runs where task_id=?', qid).n, 2);
    const diff = await api('GET', `/api/tasks/${qid}/diff`);
    assert.match(diff.diff, /salida\.txt/);
    assert.ok(!/progreso\.md/.test(diff.diff), '.oficina excluido de git');
    const d = await api('GET', `/api/tasks/${qid}`);
    assert.ok(d.files.some(f => f.name === 'salida.txt'), 'lista el archivo generado en el worktree (tarea con carpeta git)');
    const dl = await api('GET', `/api/tasks/${qid}/file?name=salida.txt`, null, true);
    assert.equal(await dl.text(), fs.readFileSync(path.join(wt, 'salida.txt'), 'utf8'), 'descarga el mismo contenido del archivo generado');
    await api('POST', `/api/tasks/${qid}/approve`, { merge: true });
    assert.equal(task(qid).status, 'completada');
    assert.ok(fs.existsSync(path.join(repo, 'salida.txt')), 'fusionado en main');
    assert.ok(!/.ijfw/.test(diff.diff), 'estado de hooks excluido');
    assert.ok(!fs.existsSync(wt), 'worktree limpiado');
  });

  await t('segunda carpeta: la tarea corre en la carpeta elegida', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: pid, folder_id: folder2, title: 'En docs', prompt: 'x', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'revision');
    assert.ok(task(id).worktree_path.startsWith(require('./host').local.canon(repo2)));
  });

  await t('error → fallida; timeout mata el proceso', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Falla', prompt: 'FALLA', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'fallida');
    update('agents', fake3, { timeout_min: 0.02 });
    const id2 = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Lento', prompt: 'LENTO', agent_id: fake3, run: true })).id;
    await until(() => task(id2).status === 'fallida', 15000, 'timeout');
    assert.equal(one('select end_reason from runs where task_id=? order by id desc', id2).end_reason, 'timeout');
    update('agents', fake3, { timeout_min: 1 });
  });

  await t('máquina sin respuesta: tras el timeout libera el cupo y conserva el bloqueo de carpeta hasta reconciliar (también tras reiniciar)', async () => {
    const H = require('./host');
    const origCall = H.call, origRunOp = H.runOp;
    const plain = path.join(TMP, 'plana'); fs.mkdirSync(plain);
    const pp = (await api('POST', '/api/projects', { name: 'Plana', folders: [{ label: 'p', path: plain }] })).id;
    const pf = (await api('GET', '/api/projects')).find(p => p.id === pp).folders[0].id;
    H.runOp = async () => false; // la máquina no recibe el killRun
    H.call = (mid, op, args) => op === 'killRun' ? Promise.reject(new Error('La máquina se desconectó')) : origCall(mid, op, args);
    try {
      update('agents', fake3, { timeout_min: 0.02 });
      const a = (await api('POST', '/api/tasks', { project_id: pp, folder_id: pf, title: 'Colgada', prompt: 'LENTO', agent_id: fake3, run: true })).id;
      await until(() => task(a).status === 'fallida', 15000, 'timeout sin exit');
      const ra = one('select * from runs where task_id=? order by id desc', a);
      assert.equal(ra.end_reason, 'timeout'); assert.equal(ra.ended_at, null, 'fin no confirmado');
      assert.ok(![...R.active.values()].some(x => x.agentId === fake3), 'cupo del agente liberado');
      const b = (await api('POST', '/api/tasks', { project_id: pp, folder_id: pf, title: 'Misma carpeta', prompt: 'x', agent_id: fake2, run: true })).id;
      await new Promise(r => setTimeout(r, 500));
      assert.equal(task(b).status, 'en_cola', 'la carpeta sigue bloqueada');
      R.orphans.clear(); R.recover(); // reinicio del servidor: el bloqueo se reconstruye desde runs.ended_at null
      R.pump(); await new Promise(r => setTimeout(r, 500));
      assert.notEqual(task(b).status, 'revision', 'bloqueo persistente tras reiniciar');
      assert.ok(R.orphans.has(ra.id));
      H.call = origCall; H.runOp = origRunOp;
      bus.emit('machine.online', one('select id from machines where is_local=1').id);
      await until(() => task(b).status === 'revision', 15000, 'b corre tras reconciliar');
      assert.ok(one('select ended_at from runs where id=?', ra.id).ended_at, 'fin confirmado al reconciliar');
    } finally { H.call = origCall; H.runOp = origRunOp; update('agents', fake3, { timeout_min: 1 }); }
  });

  await t('cola respeta max_concurrent', async () => {
    const a = (await api('POST', '/api/tasks', { project_id: regPid, title: 'L1', prompt: 'LENTO', agent_id: fake3, run: true })).id;
    const b = (await api('POST', '/api/tasks', { project_id: regPid, title: 'L2', prompt: 'escribe', agent_id: fake3, run: true })).id;
    await until(() => task(a).status === 'en_curso');
    await new Promise(r => setTimeout(r, 500));
    assert.equal(task(b).status, 'en_cola');
    await api('POST', `/api/tasks/${a}/abort`, {});
    await until(() => task(b).status === 'revision', 15000, 'b corre tras abortar a');
    assert.equal(task(a).status, 'pendiente');
  });

  await t('cuota → pausada_cuota + snapshot + checkpoint + reset; relevo automático a otro agente con snapshot', async () => {
    update('areas', dev, { auto_fallback: 1 });
    const id = (await api('POST', '/api/tasks', { project_id: pid, folder_id: folder1, area_id: dev, title: 'Cuota', prompt: 'CUOTA', agent_id: fake, run: true })).id;
    await until(() => one('select 1 from handoffs where task_id=?', id), 15000, 'handoff');
    const ag = one('select * from agents where id=?', fake);
    assert.equal(ag.status, 'sin_cuota');
    assert.equal(new Date(ag.quota_reset_at).getMinutes(), 0);
    const h = one('select * from handoffs where task_id=?', id);
    assert.match(h.snapshot_md, /Relevo de la tarea/); assert.match(h.snapshot_md, /usage limit/);
    await until(() => task(id).status === 'revision' && task(id).agent_id === fake2, 20000, 'relevo automático');
    const wt = task(id).worktree_path;
    assert.match(fs.readFileSync(path.join(wt, 'relevo-prompt.txt'), 'utf8'), /Continúas el trabajo que dejó fake/);
    assert.equal(one('select to_agent_id from handoffs where task_id=?', id).to_agent_id, fake2);
    update('areas', dev, { auto_fallback: 0 });
    update('agents', fake, { status: 'disponible', quota_reset_at: null, last_error: null });
  });

  await t('cuota reiniciada: la tarea pausada sigue sola con el mismo agente', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Cuota2', prompt: 'CUOTA', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'pausada_cuota', 15000, 'pausada');
    update('agents', fake, { quota_reset_at: new Date(Date.now() - 1000).toISOString() });
    R.quotaTick();
    await until(() => task(id).status === 'revision', 15000, 'reanudada');
    assert.equal(task(id).agent_id, fake);
    assert.equal(one('select count(*) n from runs where task_id=?', id).n, 2);
  });

  await t('turno sin marcador: un recordatorio automático y luego sí consulta', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Sin marca', prompt: 'SINMARCA', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'revision', 15000, 'revisión tras recordatorio');
    assert.deepEqual(all('select end_reason from runs where task_id=? order by id', id).map(r => r.end_reason), ['sin_marcador', 'listo']);
  });

  await t('Codex/Antigravity: el uso acumulado de la sesión se guarda como delta por turno (y migración)', async () => {
    const orig = R.ADAPTERS.fake.parse;
    let n = 0;
    R.ADAPTERS.fake.cumulative = true;
    R.ADAPTERS.fake.parse = (l, st, out) => { orig(l, st, out); st.tin = n * 100; st.tout = n * 10; };
    try {
      n = 1; const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Acumula', prompt: 'PREGUNTA', agent_id: fake, run: true })).id;
      await until(() => task(id).status === 'esperando', 15000, 'turno 1');
      n = 3; await api('POST', `/api/tasks/${id}/reply`, { text: 'sigue' });
      await until(() => task(id).status === 'revision', 15000, 'turno 2');
      assert.deepEqual(all('select tokens_in i, tokens_out o from runs where task_id=? order by id', id).map(r => [r.i, r.o]), [[100, 10], [200, 20]]);
    } finally { R.ADAPTERS.fake.parse = orig; delete R.ADAPTERS.fake.cumulative; }
    const cx = one("select id from agents where key='codex'").id;
    const c = insert('conversations', { kind: 'prueba', agent_id: cx });
    const r = [[500, 50, 5], [800, 80, 8], [0, 0, 0], [300, 30, 3]].map(([i, o, usd]) => insert('runs', { conversation_id: c, agent_id: cx, tokens_in: i, tokens_out: o, cost_usd: usd }));
    require('./db').migrateUsageDelta();
    assert.deepEqual(r.map(id => one('select tokens_in i, tokens_out o, cost_usd u from runs where id=?', id)).map(x => [x.i, x.o, +x.u.toFixed(2)]),
      [[500, 50, 5], [300, 30, 3], [0, 0, 0], [300, 30, 3]], 'delta; si baja es sesión nueva');
  });

  await t('relevo manual a otro agente y a una persona', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Manual', prompt: 'PREGUNTA', agent_id: fake, run: true })).id;
    await until(() => task(id).status === 'esperando');
    await api('POST', `/api/tasks/${id}/handoff`, { agent_id: fake2, reason: 'prefiero otro' });
    await until(() => task(id).agent_id === fake2 && task(id).status === 'revision' && one('select count(*) n from runs where task_id=?', id).n === 2, 15000, 'relevo manual');
    await api('POST', `/api/tasks/${id}/handoff`, { user_id: 1 });
    assert.equal(task(id).executor, 'humano'); assert.equal(task(id).status, 'pendiente');
  });

  await t('dependencias: bloqueada hasta completar y luego se ejecuta sola', async () => {
    const a = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Dep A', executor: 'humano' })).id;
    const b = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Dep B', prompt: 'x', agent_id: fake2, depends_on: [a] })).id;
    assert.equal(task(b).status, 'bloqueada');
    await rejects(api('POST', `/api/tasks/${b}/run`, {}), /dependencias/);
    await api('PUT', `/api/tasks/${a}`, { status: 'completada' });
    await until(() => task(b).status === 'revision', 15000, 'dependiente ejecutada');
  });

  let cid;
  await t('Cantina: consulta rápida multi-turno, cambio de agente, convertir en tarea, FTS', async () => {
    cid = (await api('POST', '/api/conversations', { agent_id: fake, text: 'PREGUNTA sobre el sable azul' })).id;
    await until(() => one('select status from conversations where id=?', cid).status === 'esperando');
    await api('POST', `/api/conversations/${cid}/reply`, { text: 'sigue' });
    await until(() => one('select count(*) n from runs where conversation_id=?', cid).n === 2 && one('select status from conversations where id=?', cid).status === 'inactiva');
    await api('POST', `/api/conversations/${cid}/switch`, { agent_id: fake2 });
    await api('POST', `/api/conversations/${cid}/reply`, { text: 'continúa tú' });
    await until(() => one('select count(*) n from runs where conversation_id=? and agent_id=?', cid, fake2).n === 1 && !['en_curso', 'en_cola'].includes(one('select status from conversations where id=?', cid).status));
    assert.match(one('select context from conversations where id=?', cid).context, /sable azul/, 'el nuevo agente recibe el historial');
    const tid = (await api('POST', `/api/conversations/${cid}/to-task`, { project_id: regPid, area_id: docs })).id;
    assert.match(task(tid).prompt, /sable azul/);
    assert.equal(one('select task_id from conversations where id=?', cid).task_id, tid);
    const s = await api('GET', '/api/search?q=sable');
    assert.ok(s.some(x => x.kind === 'mensaje' && x.link === `#/cantina/${cid}`));
    assert.ok(s.some(x => x.kind === 'tarea'));
    const h = await api('GET', '/api/history/chats');
    assert.ok(h.rows.some(x => x.id === cid));
  });

  await t('Cantina: carpeta fija compartida; los chats en modo edición no escriben a la vez', async () => {
    const dir = process.env.OFICINA_CANTINA;
    const a = (await api('POST', '/api/conversations', { agent_id: fake3, text: 'LENTO', mode: 'editar' })).id;
    await until(() => one('select status from conversations where id=?', a).status === 'en_curso', 15000, 'a corre');
    const b = (await api('POST', '/api/conversations', { agent_id: fake2, text: 'escribe', mode: 'editar' })).id;
    await new Promise(r => setTimeout(r, 500));
    assert.equal(one('select status from conversations where id=?', b).status, 'en_cola', 'b espera la carpeta');
    await api('POST', `/api/conversations/${a}/abort`, {});
    await until(() => one('select status from conversations where id=?', b).status === 'inactiva', 15000, 'b corre tras a');
    assert.ok(fs.existsSync(path.join(dir, 'salida.txt')), 'escribe en la carpeta fija de la Cantina');
    const pl = (await api('POST', '/api/conversations', { agent_id: fake, text: 'PREGUNTA en lectura' })).id; // modo lectura: sin bloqueo
    await until(() => one('select status from conversations where id=?', pl).status === 'esperando', 15000, 'lectura');
  });

  await t('papelera: soft-delete y restaurar', async () => {
    await api('DELETE', `/api/conversations/${cid}`);
    assert.ok((await api('GET', '/api/history/papelera')).rows.some(x => x.entity === 'conversations' && x.id === cid));
    await api('POST', '/api/restore', { entity: 'conversations', id: cid });
    assert.equal(one('select deleted_at from conversations where id=?', cid).deleted_at, null);
  });

  await t('parser de límites Claude/Codex → agent_limits y bootstrap', async () => {
    const st = { limits: [] };
    R.ADAPTERS.claude.parse({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', unifiedWindows: { five_hour: { utilization: 0.31, resetsAt: 1790281800 }, seven_day: { utilization: 0.85, resetsAt: 1790460000 } } } }, st, () => {});
    R.ADAPTERS.codex.parse({ type: 'token_count', rate_limits: { primary: { used_percent: 42, resets_in_seconds: 600 }, secondary: { used_percent: 78, resets_at: '2026-09-30T12:00:00.000Z' } } }, st, () => {});
    R.saveLimits(fake, st.limits);
    const l = all(`select * from agent_limits where agent_id=? and source='cli'`, fake);
    assert.equal(l.find(x => x.win === 'seven_day').used_value, 85);
    assert.equal(l.find(x => x.win === 'primary').used_value, 42);
    assert.equal(l.find(x => x.win === 'secondary').used_value, 78);
    assert.match(R.parseReset("Claude AI usage limit reached|1790281800"), /^2026-/);

    const boot = await api('GET', '/api/bootstrap');
    const fa = boot.agents.find(a => a.id === fake);
    assert.ok(Array.isArray(fa.limits_cli), 'bootstrap incluye limits_cli');
    assert.equal(fa.limits_cli.find(x => x.win === 'primary')?.used_value, 42);
    assert.ok(fa.usage5h !== undefined, 'bootstrap incluye usage5h');
  });

  await t('Codex usa un modelo disponible al faltar el seleccionado', async () => {
    assert.equal(R.codexFallback('gpt-6-luna', 'gpt-5.6-terra', ['gpt-5.6-sol', 'gpt-5.6-terra']), 'gpt-5.6-terra');
    assert.equal(R.codexFallback('gpt-6-luna', 'gpt-6-luna', ['gpt-5.6-terra']), 'gpt-5.6-terra');
    assert.equal(R.codexFallback('gpt-6-luna', 'gpt-5.6-terra', ['gpt-6-luna']), null);
    assert.equal(R.codexFallback('gpt-6-luna', 'gpt-6-luna', ['gpt-6-luna']), null);
    assert.equal(R.codexFallback('gpt-6-luna', 'gpt-5.6-terra', []), null);
    assert.equal(R.codexFallback('otro', 'no-existe', ['gpt-5.6-terra', 'gpt-6-luna']), 'gpt-6-luna');
  });

  await t('Codex reintenta una sola vez cuando la cuenta rechaza el modelo', async () => {
    const H = require('./host');
    const originalCall = H.call;
    const cli = `if(process.argv.includes('bad')){console.log(JSON.stringify({type:'error',status:400,error:{type:'invalid_request_error',message:"The 'bad' model is not supported when using Codex with a ChatGPT account."}}));process.exit(1)}console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'[[LISTO]] correcto'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}))`;
    const codex = mk('codex-falso', { adapter: 'codex', pre_args: JSON.stringify(['-e', cli]), models: '["bad","good"]', default_model: 'good' });
    let detectCount = 0, releaseDetect, releaseAbort = () => {};
    const delayedDetect = new Promise(resolve => { releaseDetect = resolve; });
    H.call = (mid, op, args) => op === 'detectModels'
      ? (++detectCount === 2 ? delayedDetect : Promise.resolve(['bad', 'good']))
      : originalCall(mid, op, args);
    try {
      const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Reintento Codex', prompt: 'prueba', agent_id: codex, model: 'bad', run: true })).id;
      await until(() => detectCount === 2, 15000, 'catálogo tras error Codex');
      const convId = task(id).conversation_id;
      assert.ok([...R.active.values()].some(a => a.convId === convId), 'reserva activa mientras se consulta el catálogo');
      assert.throws(() => R.runTurn(convId, null, { prompt: 'duplicado' }), /ya está en ejecución/);
      releaseDetect(['bad', 'good']);
      await until(() => task(id).status === 'revision', 15000, 'reintento Codex');
      const runs = all('select model,end_reason from runs where task_id=? order by id', id);
      assert.deepEqual(runs.map(r => r.model), ['bad', 'good']);
      assert.deepEqual(runs.map(r => r.end_reason), ['error', 'listo']);
      assert.equal(task(id).model, 'good');
      assert.deepEqual(JSON.parse(one('select models from agents where id=?', codex).models), ['bad', 'good'], 'una máquina no cambia la lista global');
      assert.equal(one('select session_id from conversations where id=?', task(id).conversation_id).session_id, null);
      const missing = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Catálogo Codex', prompt: 'prueba', agent_id: codex, model: 'missing', run: true })).id;
      await until(() => task(missing).status === 'revision', 15000, 'selección disponible Codex');
      assert.deepEqual(all('select model from runs where task_id=?', missing).map(r => r.model), ['good']);
      assert.equal(task(missing).model, 'good');
      let abortDetects = 0;
      const delayedAbort = new Promise(resolve => { releaseAbort = resolve; });
      H.call = (mid, op, args) => op === 'detectModels'
        ? (++abortDetects === 2 ? delayedAbort : Promise.resolve(['bad', 'good']))
        : originalCall(mid, op, args);
      const aborted = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Abortar Codex', prompt: 'prueba', agent_id: codex, model: 'bad', run: true })).id;
      await until(() => abortDetects === 2, 15000, 'catálogo antes de abortar');
      await api('POST', `/api/tasks/${aborted}/abort`, {});
      releaseAbort(['bad', 'good']);
      await until(() => task(aborted).status === 'pendiente', 15000, 'tarea Codex abortada');
      assert.equal(all('select id from runs where task_id=?', aborted).length, 1, 'no se reencola tras abortar');
    } finally { releaseDetect(['bad', 'good']); releaseAbort(['bad', 'good']); H.call = originalCall; }
  });

  await t('Puente de Mando: secciones y agente no encontrado', async () => {
    const bad = insert('agents', { key: 'fantasma', name: 'Fantasma', adapter: 'fake', exe: path.join(TMP, 'noexiste.exe'), enabled: 1 });
    await api('POST', '/api/limits', { agent_id: fake, win: 'dia', metric: 'runs', limit_value: 2 });
    const s = await api('POST', '/api/status/scan');
    for (const k of ['agents', 'work', 'folders', 'system']) assert.ok(s[k], k);
    assert.equal(s.agents.find(a => a.id === bad).state, 'no_encontrado');
    assert.ok(s.agents.find(a => a.id === fake).limits_manual[0].pct >= 80);
    assert.ok(events.some(e => e.type === 'notify' && e.data.kind === 'limite'), 'alerta 80%');
    assert.ok(s.folders.length >= 2);
    update('agents', bad, { enabled: 0 });
  });

  await t('sincronización automática de modelos en probe de agentes', async () => {
    const H = require('./host');
    const origCall = H.call;
    const testAg = insert('agents', { key: 'sync-test', name: 'SyncTest', adapter: 'codex', exe: process.execPath, models: '["gpt-5.5"]', default_model: 'gpt-5.5', enabled: 1 });
    H.call = (mid, op, args) => {
      if (op === 'probe') return Promise.resolve({ found: true, version: '1.0.0' });
      if (op === 'detectModels') return Promise.resolve(['gpt-6-luna', 'gpt-6-sol', 'gpt-5.5']);
      return origCall(mid, op, args);
    };
    try {
      await api('POST', '/api/status/scan');
      const updated = JSON.parse(one('select models from agents where id=?', testAg).models);
      assert.deepEqual(updated, ['gpt-6-luna', 'gpt-6-sol', 'gpt-5.5'], 'modelos nuevos incorporados automáticamente');
    } finally { H.call = origCall; update('agents', testAg, { enabled: 0 }); }
  });

  await t('Consejo: digest, JSON inválido, consolidación con votos, aceptar crea tarea, descartar', async () => {
    const d = await api('POST', '/api/council/digest', { scope: { project_ids: [pid], last_n: 5 } });
    assert.match(d.digest_md, /Crear archivo/); assert.match(d.digest_md, /salida\.txt/);
    assert.throws(() => C.validProposals(C.extractJSON('nada')), /JSON/);
    const merged = C.consolidate([[{ title: 'Agregar pruebas', description: 'a', impact: 'alto', effort: 'bajo' }], [{ title: 'agregar  PRUEBAS!', description: 'abc', impact: 'alto', effort: 'bajo' }]]);
    assert.equal(merged.length, 1); assert.equal(merged[0].votes, 2);
    const rid = (await api('POST', '/api/council', { scope: { project_ids: [pid] }, lenses: ['siguiente', 'pruebas'], agents: [{ agent_id: fake }, { agent_id: fake2 }], moderator: { agent_id: fake3 } })).id;
    await until(() => one('select status from reviews where id=?', rid).status !== 'en_curso', 20000, 'consejo');
    const rv = await api('GET', `/api/council/${rid}`);
    assert.equal(rv.review.status, 'lista');
    const p = rv.proposals.find(x => x.title === 'Agregar pruebas');
    assert.equal(p.votes, 2);
    const tid = (await api('POST', `/api/proposals/${p.id}/accept`, {})).task_id;
    assert.equal(task(tid).proposal_id, p.id); assert.equal(task(tid).area_id, dev); assert.equal(task(tid).agent_id, fake);
    const other = rv.proposals.find(x => x.title === 'Documentar API');
    await api('POST', `/api/proposals/${other.id}/decide`, { status: 'descartada', reason: 'ya existe' });
    assert.match(C.digest({ project_ids: [pid] }).digest_md, /\[descartada\] Documentar API — motivo: ya existe/);
    // agente que no devuelve JSON → sin propuestas, sin romper
    const cid2 = insert('conversations', { kind: 'consejo', title: 't', agent_id: fake, mode: 'plan' });
    const res = await R.runTurn(cid2, null, { prompt: 'JSONMALO' });
    assert.throws(() => C.validProposals(C.extractJSON(res.final)));
  });

  await t('descomponer tarea en subtareas con dependencias; misión encadenada', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, area_id: ana, title: 'Grande', prompt: 'x', agent_id: fake })).id;
    const { ids } = await api('POST', `/api/tasks/${id}/decompose`);
    assert.equal(ids.length, 2); assert.deepEqual(JSON.parse(task(ids[1]).depends_on), [ids[0]]); assert.equal(task(ids[0]).parent_id, id);
    const m = await api('POST', '/api/missions', { project_id: regPid, title: 'Hiperimpulsor', prompt: 'reparar', stages: [{ area_id: ana, agent_id: fake }, { area_id: dev, agent_id: fake2 }] });
    assert.equal(task(m.ids[1]).status, 'bloqueada');
  });

  await t('Orden 66 detiene todo y pausa la cola', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'L', prompt: 'LENTO', agent_id: fake3, run: true })).id;
    await until(() => task(id).status === 'en_curso');
    const r = await api('POST', '/api/order66');
    assert.ok(r.stopped >= 1);
    await until(() => task(id).status === 'pendiente');
    await api('POST', `/api/tasks/${id}/run`, {});
    await new Promise(r => setTimeout(r, 400));
    assert.equal(task(id).status, 'en_cola', 'la cola en pausa no arranca nada');
    await api('POST', '/api/queue/resume');
    await until(() => task(id).status === 'en_curso');
    await api('POST', `/api/tasks/${id}/abort`);
    await until(() => task(id).status === 'pendiente');
  });

  await t('historial exporta CSV y timeline', async () => {
    const res = await api('GET', '/api/history/bitacora?format=csv', null, true);
    assert.match(await res.text(), /entity/);
    assert.ok((await api('GET', `/api/history/tareas/${qid}/timeline`)).length > 3);
  });

  await t('recuperación tras reinicio: en_curso → esperando', async () => {
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Rec', executor: 'humano' })).id;
    const c2 = insert('conversations', { kind: 'tarea', task_id: id, status: 'en_curso', agent_id: fake });
    update('tasks', id, { status: 'en_curso', conversation_id: c2 });
    insert('runs', { conversation_id: c2, task_id: id, agent_id: fake, started_at: new Date().toISOString() });
    R.recover();
    assert.equal(task(id).status, 'esperando');
    assert.equal(one('select end_reason from runs where conversation_id=?', c2).end_reason, 'interrumpido');
    // turno cortado antes de capturar la sesión: al continuar recibe la tarea y el chat, no solo "continúa"
    const id3 = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Comparar ofertas', prompt: 'OBJETIVO-ORIGINAL', agent_id: fake })).id;
    const c3 = insert('conversations', { kind: 'tarea', task_id: id3, status: 'en_curso', agent_id: fake, model: 'm1', effort: 'low', mode: 'editar' });
    update('tasks', id3, { status: 'en_curso', conversation_id: c3 });
    insert('runs', { conversation_id: c3, task_id: id3, agent_id: fake, started_at: new Date().toISOString() });
    R.recover(); // se reanuda sola, sin que el usuario responda
    await until(() => task(id3).status === 'revision', 15000, 'revisión tras retomar');
    const ctx = fs.readFileSync(path.join(process.env.OFICINA_DATA, 'sandbox', 'task-' + id3, 'ctx-prompt.txt'), 'utf8');
    assert.match(ctx, /OBJETIVO-ORIGINAL/); assert.match(ctx, /servidor se reinició/);
    // dos cortes seguidos: no insiste, decide el usuario
    const id4 = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Cortes', prompt: 'x', agent_id: fake })).id;
    const c4 = insert('conversations', { kind: 'tarea', task_id: id4, status: 'en_curso', agent_id: fake, mode: 'editar' });
    update('tasks', id4, { status: 'en_curso', conversation_id: c4 });
    insert('runs', { conversation_id: c4, task_id: id4, agent_id: fake, end_reason: 'interrumpido', started_at: new Date().toISOString(), ended_at: new Date().toISOString() });
    insert('runs', { conversation_id: c4, task_id: id4, agent_id: fake, started_at: new Date().toISOString() });
    R.recover();
    await new Promise(r => setTimeout(r, 500));
    assert.equal(task(id4).status, 'esperando');
    assert.match(one("select text from messages where conversation_id=? order by id desc", c4).text, /Responde/);
  });

  await t('eventos del worker: un lote reenviado se aplica una sola vez', async () => {
    const H = require('./host');
    const mid = one('select id from machines where is_local=1').id;
    const seen = [];
    await H.spawnRun(mid, { runId: 'dup-1', exe: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)'], cwd: TMP }, ev => seen.push(ev));
    const batch = [{ runId: 'dup-1', seq: 1, t: 'out', line: 'uno' }, { runId: 'dup-1', seq: 2, t: 'out', line: 'dos' }];
    H.events({ id: mid }, batch);
    H.events({ id: mid }, batch); // respuesta perdida → el worker reenvía
    H.events({ id: mid }, [...batch, { runId: 'dup-1', seq: 3, t: 'out', line: 'tres' }]);
    H.events({ id: mid }, [{ runId: 'dup-1', t: 'out', line: 'worker antiguo' }]); // sin seq: compatibilidad
    assert.deepEqual(seen.filter(e => e.t === 'out').map(e => e.line), ['uno', 'dos', 'tres', 'worker antiguo']);
    await H.runOp('dup-1', 'killRun');
  });

  // ---------- agente de campo remoto (worker.js en otro proceso) ----------
  const { spawn } = require('node:child_process');
  let worker;
  const spawnWorker = token => spawn(process.execPath, ['--no-warnings', 'worker.js'], { cwd: __dirname, stdio: 'ignore',
    env: { ...process.env, OFICINA_URL: `http://127.0.0.1:${PORT}`, OFICINA_TOKEN: token, OFICINA_WORKER_DATA: path.join(TMP, 'wdata'), OFICINA_WORKER_ROOTS: TMP,
      OFICINA_WORKER_ALLOW_ANY: '1', OFICINA_WORKER_CONFIG: path.join(TMP, 'no-existe.json') } });
  const machineOnline = async id => (await api('GET', '/api/machines')).find(x => x.id === id)?.online;

  await t('agente de campo: token, raíces, adjuntos, worktree remoto, fusión, cola sin conexión y reconexión', async () => {
    const m = await api('POST', '/api/machines', { name: 'PC remota' });
    assert.match(m.token, /^\d+\.[\w-]+$/);
    const bad = await fetch(`http://127.0.0.1:${PORT}/api/worker/hello`, { method: 'POST', headers: { Authorization: `Bearer ${m.id}.falso` }, body: '{}' });
    assert.equal(bad.status, 401);
    worker = spawnWorker(m.token);
    await until(() => machineOnline(m.id), 15000, 'worker conectado');
    await rejects(api('POST', '/api/projects', { name: 'Fuera', folders: [{ path: os.homedir(), machine_id: m.id }] }), /raíces/);
    const repo3 = gitRepo('repo3');
    const pid3 = (await api('POST', '/api/projects', { name: 'Remoto', folders: [{ label: 'r', path: repo3, machine_id: m.id }] })).id;
    const f3 = (await api('GET', '/api/projects')).find(p => p.id === pid3).folders[0];
    assert.equal(f3.machine_id, m.id);
    assert.ok((await api('GET', `/api/machines/${m.id}/ls?path=${encodeURIComponent(TMP)}`)).dirs.some(d => d.name === 'repo3'), 'selector de carpetas remoto');
    const id = (await api('POST', '/api/tasks', { project_id: pid3, folder_id: f3.id, title: 'Remota', prompt: 'lee el ADJUNTO', agent_id: fake2 })).id;
    const up = await fetch(`http://127.0.0.1:${PORT}/api/attachments?task_id=${id}&name=nota.txt`, { method: 'POST', headers: { cookie, 'Content-Type': 'text/plain' }, body: 'secreto del sable' });
    assert.equal(up.status, 200);
    const dl = await fetch(`http://127.0.0.1:${PORT}/api/attachments/${(await up.json()).id}`, { headers: { cookie } });
    assert.equal(await dl.text(), 'secreto del sable'); assert.equal(dl.headers.get('content-security-policy'), 'sandbox');
    await api('POST', `/api/tasks/${id}/run`, {});
    await until(() => task(id).status === 'revision', 20000, 'tarea remota en revisión');
    assert.match(task(id).summary, /secreto del sable/, 'el agente leyó el adjunto en la PC');
    assert.ok(task(id).worktree_path.includes('repo3'));
    const diff = await api('GET', `/api/tasks/${id}/diff`);
    assert.match(diff.diff, /salida\.txt/); assert.ok(!/adjuntos|progreso/.test(diff.diff), '.oficina fuera de git');
    await api('POST', `/api/tasks/${id}/approve`, { merge: true });
    assert.ok(fs.existsSync(path.join(repo3, 'salida.txt')), 'fusionado en la PC');
    worker.kill();
    await until(async () => !(await machineOnline(m.id)), 15000, 'worker desconectado');
    const id2 = (await api('POST', '/api/tasks', { project_id: pid3, folder_id: f3.id, title: 'Espera la PC', prompt: 'x', agent_id: fake2, run: true })).id;
    await new Promise(r => setTimeout(r, 800));
    assert.equal(task(id2).status, 'en_cola', 'queda en cola con la PC apagada');
    worker = spawnWorker(m.token);
    await until(() => task(id2).status === 'revision', 25000, 'arranca al reconectar');
  });
  worker?.kill();

  await t('precios por modelo: sembrados, editables y costo estimado del run', async () => {
    const cx = (await api('GET', '/api/agents')).find(a => a.key === 'codex');
    assert.deepEqual(cx.prices['gpt-5.6-terra'], [2, 12, 0.2]);
    await api('PUT', '/api/agents/' + fake, { prices: { m1: [1000000, 2000000] } }); // $1 por token de entrada, $2 de salida
    assert.deepEqual((await api('GET', '/api/agents')).find(a => a.id === fake).prices, { m1: [1000000, 2000000] });
    const id = (await api('POST', '/api/tasks', { project_id: regPid, title: 'Costo', prompt: 'x', agent_id: fake })).id;
    const orig = R.ADAPTERS.fake.parse;
    R.ADAPTERS.fake.parse = (l, st, out) => { orig(l, st, out); st.tin = 3; st.tcache = 1; st.tout = 1; };
    try {
      await api('POST', `/api/tasks/${id}/run`, {});
      await until(() => task(id).status === 'revision', 15000, 'revisión');
    } finally { R.ADAPTERS.fake.parse = orig; }
    // 2 de entrada × $1 + 1 en caché × $0.1 (10 % por defecto) + 1 de salida × $2
    assert.equal(+one('select cost_usd from runs where task_id=?', id).cost_usd.toFixed(4), 4.1);
  });

  await t('fin de run aunque un hijo huérfano retenga stdout (hooks del CLI)', async () => {
    const H = require('./hostops').create({ dataDir: path.join(TMP, 'orf') });
    const child = `require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'inherit'}).unref();console.log('[[LISTO]] ok')`;
    const t0 = Date.now(), evs = [];
    await new Promise(res => H.spawnRun({ runId: 'orf1', exe: process.execPath, args: ['-e', child], cwd: TMP }, e => { evs.push(e); if (e.t === 'exit') res(); }));
    assert.ok(Date.now() - t0 < 10000, 'debió terminar por la gracia de 3 s');
    assert.ok(evs.some(e => e.t === 'out' && /LISTO/.test(e.line)));
  });

  await t('modo Google (VPS): sin contraseñas, redirección PKCE, estado inválido y cabeceras de seguridad', async () => {
    const GP = PORT + 1;
    const g = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: __dirname, stdio: 'ignore', env: { ...process.env, OFICINA_AUTH: 'google', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
      OFICINA_ALLOWED_EMAILS: 'a@pj.gob.pe', OFICINA_DATA: path.join(TMP, 'gdata'), OFICINA_PORT: String(GP), OFICINA_LOCAL_EXEC: '0', OFICINA_PUBLIC_URL: 'https://ua.csjla.pe' } });
    try {
      const u = p => `http://127.0.0.1:${GP}${p}`;
      await until(() => fetch(u('/api/setup')).then(r => r.ok).catch(() => false), 10000, 'servidor google');
      const st = await (await fetch(u('/api/setup'))).json();
      assert.deepEqual(st, { needed: false, mode: 'google' });
      assert.equal((await fetch(u('/api/login'), { method: 'POST', body: '{"username":"x","password":"y"}' })).status, 403);
      assert.equal((await fetch(u('/api/bootstrap'))).status, 401);
      const r = await fetch(u('/api/auth/google'), { redirect: 'manual' });
      const loc = new URL(r.headers.get('location'));
      assert.equal(loc.host, 'accounts.google.com');
      assert.equal(loc.searchParams.get('redirect_uri'), 'https://ua.csjla.pe/api/auth/google/callback');
      assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
      const cb = await fetch(u('/api/auth/google/callback?state=falso&code=x'), { redirect: 'manual' });
      assert.match(cb.headers.get('location'), /#\/login\?error=/);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.match(r.headers.get('strict-transport-security'), /max-age/);
      assert.equal((await fetch(u('/api/worker/hello'), { method: 'POST', body: '{}' })).status, 401);
      for (const p of ['/login', '/no/existe', '/%E0%A4%A', '/../server.js']) {
        const x = await fetch(u(p), { redirect: 'manual' });
        assert.equal(x.status, 302, p); assert.equal(x.headers.get('location'), '/#/login', p);
      }
      assert.equal((await fetch(u('/app.js'))).status, 200);
      assert.equal((await fetch(u('/api/no-existe'))).status, 404);
    } finally { g.kill(); }
  });

  await t('marcación SICAPE: detección de script, ejecución y stream de consola en Mi Perfil', async () => {
    const prevEnv = process.env.OFICINA_MARCACION_PATH;
    const mDir = path.join(TMP, 'marcacion-sicape');
    fs.mkdirSync(mDir, { recursive: true });
    const isWin = process.platform === 'win32';
    const batPath = path.join(mDir, 'marcar-ahora.bat');
    if (isWin) {
      fs.writeFileSync(batPath, '@echo off\r\necho ============================================================\r\necho  Marcacion SICAPE - Marcar ahora\r\necho ============================================================\r\necho   DNI:   70000000\r\necho  Listo: marcacion enviada con la hora del servidor SICAPE.\r\npause\r\n');
    } else {
      fs.writeFileSync(batPath, '#!/bin/sh\necho "Marcacion SICAPE - Marcar ahora"\necho "  DNI:   70000000"\necho "Listo: marcacion enviada con la hora del servidor SICAPE."\n');
      fs.chmodSync(batPath, 0o755);
    }
    process.env.OFICINA_MARCACION_PATH = batPath;
    try {
      const info = await api('GET', '/api/me/marcacion');
      assert.equal(info.found, true, 'debe encontrar el script');
      assert.equal(info.running, false);

      const r = await api('POST', '/api/me/marcar');
      assert.equal(r.ok, true);

      await until(async () => {
        const st = await api('GET', '/api/me/marcacion');
        return !st.running && st.last_result?.code === 0;
      }, 10000, 'fin de la marcación');

      const finalSt = await api('GET', '/api/me/marcacion');
      assert.equal(finalSt.last_result.code, 0);
      assert.ok(finalSt.last_log.some(l => l.includes('Marcacion SICAPE')), 'debe contener log de marcacion');
      assert.ok(finalSt.last_log.some(l => l.includes('DNI:   70000000')), 'debe contener DNI en log');
    } finally {
      if (prevEnv !== undefined) process.env.OFICINA_MARCACION_PATH = prevEnv;
      else delete process.env.OFICINA_MARCACION_PATH;
    }
  });

  await t('actualización diaria: detección y sincronización de modelos y esfuerzos de los 4 agentes', async () => {
    const H = require('./hostops').create({ dataDir: path.join(TMP, 'models-test') });
    // Probar detectEfforts en hostops
    const clEfforts = await H.ops.detectEfforts({ adapter: 'claude', exe: 'claude' });
    assert.ok(clEfforts.includes('low') && clEfforts.includes('high'));
    const cxEfforts = await H.ops.detectEfforts({ adapter: 'codex', exe: 'codex' });
    assert.ok(cxEfforts.includes('low') && cxEfforts.includes('max'));
    const agyEfforts = await H.ops.detectEfforts({ adapter: 'agy', exe: 'agy' });
    assert.ok(agyEfforts.includes('low') && agyEfforts.includes('high'));
    const ccEfforts = await H.ops.detectEfforts({ adapter: 'commandcode', exe: 'node' });
    assert.ok(ccEfforts.includes('low') && ccEfforts.includes('medium'));

    // Probar detectModelEfforts en hostops
    const clModelEfforts = await H.ops.detectModelEfforts({ adapter: 'claude', exe: 'claude' });
    assert.ok(clModelEfforts['sonnet']?.includes('high'));
    const agyModelEfforts = await H.ops.detectModelEfforts({ adapter: 'agy', exe: 'agy' });
    assert.deepEqual(agyModelEfforts['gemini-3.8-flash-high'], ['high']);

    // Probar actualizar-modelos.js con una base de datos de prueba
    const { collectAgentData, syncAgentsToDb } = require('./actualizar-modelos');
    const testDbPath = path.join(TMP, 'sync-test.db');
    const { DatabaseSync } = require('node:sqlite');
    const tdb = new DatabaseSync(testDbPath);
    tdb.exec(`create table agents (id integer primary key, key text unique, name text, models text default '[]', efforts text default '[]', default_model text default '', default_effort text default '');`);
    tdb.prepare(`insert into agents (key, name, models, efforts) values ('claude', 'Claude', '["sonnet"]', '["medium"]'), ('codex', 'Codex', '["gpt-5.5"]', '["low"]'), ('antigravity', 'Antigravity', '[]', '[]'), ('commandcode', 'CommandCode', '[]', '[]');`).run();

    const mockData = {
      claude: { name: 'Claude', models: ['sonnet', 'opus'], efforts: ['low', 'medium', 'high'], modelEfforts: { sonnet: ['low', 'medium', 'high'] }, fallbackModel: 'sonnet' },
      codex: { name: 'Codex', models: ['gpt-6-luna', 'gpt-5.5'], efforts: ['low', 'medium', 'high', 'max'], modelEfforts: { 'gpt-6-luna': ['low', 'medium', 'high', 'max'] }, fallbackModel: 'gpt-6-luna' },
      antigravity: { name: 'Antigravity', models: ['gemini-3.8-flash-high'], efforts: ['high'], modelEfforts: { 'gemini-3.8-flash-high': ['high'] }, fallbackModel: 'gemini-3.8-flash-high' },
      commandcode: { name: 'CommandCode', models: ['deepseek/deepseek-v4-flash'], efforts: ['medium'], modelEfforts: {}, fallbackModel: 'deepseek/deepseek-v4-flash' }
    };

    const syncRes = syncAgentsToDb(testDbPath, mockData);
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.updated.length, 4);

    const updatedClaude = tdb.prepare('select * from agents where key=?').get('claude');
    assert.deepEqual(JSON.parse(updatedClaude.models), ['sonnet', 'opus']);
    assert.deepEqual(JSON.parse(updatedClaude.efforts), ['low', 'medium', 'high']);
    assert.ok(JSON.parse(updatedClaude.model_efforts).sonnet);

    const updatedCodex = tdb.prepare('select * from agents where key=?').get('codex');
    assert.ok(JSON.parse(updatedCodex.models).includes('gpt-6-luna'));
    assert.ok(JSON.parse(updatedCodex.efforts).includes('max'));
  });

  } catch (e) {
    failed++;
    console.error('✘ error fatal en la suite', e.stack || e);
  } finally {
    if (server) server.close();
    for (const a of R.active.values()) if (a.runId) require('./host').runOp(a.runId, 'killRun');
    console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK');
    process.exit(failed ? 1 : 0);
  }
})();
