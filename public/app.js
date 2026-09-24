// Arranque, login, shell, router, tiempo real (SSE) y bandeja de pendientes
import { S, get, post, h, $, $$, holo, fail, beep, agentChip, chip, ago, isAdmin, project, opts, linkLabels } from './core.js';
import { sprite } from './sprites.js';
import { VIEWS } from './views.js';

const app = document.getElementById('app');
const NAV = [
  ['estacion', 'Estación', 'droid'], ['proyectos', 'Proyectos', 'rebel'], ['kanban', 'Kanban', 'desk'], ['cantina', 'Cantina', 'rebel'],
  ['consejo', 'Consejo Jedi', 'imperial'], ['archivos', 'Archivos Jedi', 'droid'], ['puente', 'Puente de Mando', 'imperial'], ['config', 'Configuración', 'droid'],
];
let current = null;

// ---------- login / setup ----------
const CRAWL = `<div class="crawl"><div class="crawl-text"><h2>OFICINA VIRTUAL</h2><p>Hace mucho tiempo, en una oficina muy, muy lejana...</p>
<p>Los droides Claude, Codex, Antigravity y CommandCode esperan órdenes en la estación. Documentación, Desarrollo y Análisis necesitan manos (y circuitos).</p>
<p>Cada tarea queda registrada en los Archivos Jedi. Si un droide se queda sin combustible, otro toma el relevo y nada se pierde.</p>
<p>Que la Fuerza acompañe a tu backlog...</p></div></div>`;
async function loginView() {
  const { needed, mode } = await get('/api/setup');
  const err = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
  if (mode === 'google') {
    app.innerHTML = `<div class="login">${CRAWL}<div class="login-box panel y"><h1>IDENTIFÍCATE,<br>PILOTO</h1>
      <a class="btn y" href="/api/auth/google" style="display:block;text-align:center">Entrar con Google</a>
      <p class="muted" style="text-align:center">Solo cuentas autorizadas.</p><div class="err" role="alert">${h(err || '')}</div></div></div>`;
    return;
  }
  app.innerHTML = `<div class="login">${CRAWL}<div class="login-box panel y">
    <h1>${needed ? 'CREAR COMANDANTE' : 'IDENTIFÍCATE,<br>PILOTO'}</h1>
    <form id="lf" class="col-flex">
      ${needed ? '<label class="l">Nombre</label><input name="name" autocomplete="name">' : ''}
      <label class="l">Usuario</label><input name="username" required autocomplete="username" autofocus>
      <label class="l">Contraseña</label><input name="password" type="password" required minlength="${needed ? 6 : 1}" autocomplete="${needed ? 'new-password' : 'current-password'}">
      <button class="btn y">${needed ? 'Fundar la oficina' : 'Entrar'}</button>
      <div class="err" id="lerr" role="alert"></div>
    </form></div></div>`;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try { await post(needed ? '/api/setup' : '/api/login', b); beep('ok'); location.hash = '#/estacion'; start(); }
    catch (err) { $('#lerr').textContent = err.message; beep('error'); }
  });
}

// ---------- shell ----------
export async function loadBoot() {
  S.boot = await get('/api/bootstrap');
  if (S.project && !project(S.project)) S.project = null;
  if (!S.project && S.boot.projects[0]) S.project = S.boot.projects[0].id;
}
function shell() {
  const me = S.boot.me;
  app.innerHTML = `
  <header class="top">
    <a class="logo" href="#/estacion">★ OFICINA VIRTUAL</a>
    <select id="projSel" aria-label="Proyecto actual">${opts(S.boot.projects.map(p => [p.id, p.name]), S.project, '— Sin proyecto —')}</select>
    <input class="search" id="gsearch" placeholder="Buscar en todo…" aria-label="Buscar">
    <div class="right row">
      <button class="btn ghost sm" id="soundBtn" title="Sonido">${S.sound ? '♪ ON' : '♪ OFF'}</button>
      <button class="btn ghost sm bell" id="bellBtn" aria-label="Bandeja">BANDEJA<span class="n" id="bellN" hidden></span></button>
      <span class="me">${sprite(me.role === 'admin' ? 'imperial' : 'rebel', '#ff8c42', 3)}<span>${h(me.name)}<br><small>${h(S.boot.users.find(u => u.id === me.id)?.rank || '')} · ${h(me.role)}</small></span></span>
      <button class="btn ghost sm" id="logoutBtn">Salir</button>
    </div>
  </header>
  <div id="qpaused" class="queue-paused" ${S.boot.queue_paused ? '' : 'hidden'}>⚠ COLA EN PAUSA (Orden 66) ${isAdmin() ? '<button class="btn sm y" id="resumeQ">Reanudar cola</button>' : ''}</div>
  <div class="layout">
    <nav class="nav" aria-label="Secciones">${NAV.map(([k, l, s]) => (k === 'archivos' ? '<div class="sep"></div>' : '') + `<a href="#/${k}" data-k="${k}">${sprite(s, '#4fc3f7', 2)}${l}</a>`).join('')}</nav>
    <main id="view" tabindex="-1"></main>
  </div>
  <aside class="inbox" id="inbox" hidden></aside>`;
  $('#projSel').onchange = e => { S.project = +e.target.value || null; localStorage.setItem('ov_project', S.project || ''); if (['kanban', 'estacion'].includes(current?.name)) route(); };
  $('#logoutBtn').onclick = async () => { await post('/api/logout'); location.hash = '#/login'; location.reload(); };
  $('#soundBtn').onclick = e => { S.sound = !S.sound; localStorage.setItem('ov_sound', S.sound ? '1' : '0'); e.target.textContent = S.sound ? '♪ ON' : '♪ OFF'; if (S.sound) beep('ok'); };
  $('#bellBtn').onclick = toggleInbox;
  $('#resumeQ')?.addEventListener('click', () => post('/api/queue/resume').catch(fail));
  $('#gsearch').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) location.hash = '#/archivos/buscar?q=' + encodeURIComponent(e.target.value.trim()); });
}

// ---------- router ----------
function parseHash() {
  const [p, qs] = (location.hash.slice(2) || 'estacion').split('?');
  const [name, ...rest] = p.split('/');
  return { name, args: rest.map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export async function route(soft = false) {
  const r = parseHash();
  if (r.name === 'login') return loginView();
  if (!S.boot) return start();
  const v = VIEWS[r.name] || VIEWS.estacion;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === r.name));
  const old = $('#view');
  const keep = soft ? snapshot(old) : null;
  const el = old.cloneNode(false); // elemento nuevo: sin listeners de la vista anterior
  const token = current = { ...r, view: v };
  try { await v.render(el, r); } catch (e) { el.innerHTML = `<div class="panel r">${h(e.message)}</div>`; }
  if (current !== token) return; // otra navegación empezó mientras cargaba
  linkLabels(el);
  $('#view').replaceWith(el);
  if (keep) restore(el, keep); else { window.scrollTo(0, 0); }
}
// conserva lo que el usuario está escribiendo durante refrescos en vivo
function snapshot(el) {
  const vals = {}; $$('[id]', el).forEach(i => { if ('value' in i && i.type !== 'button') vals[i.id] = i.type === 'checkbox' ? i.checked : i.value; });
  const scroll = {}; $$('[data-scroll]', el).forEach(s => scroll[s.dataset.scroll] = [s.scrollTop, s.scrollHeight - s.scrollTop - s.clientHeight < 40]);
  return { vals, focus: document.activeElement?.id, scroll, y: window.scrollY };
}
function restore(el, k) {
  for (const [id, v] of Object.entries(k.vals)) { const i = document.getElementById(id); if (i && el.contains(i)) { if (i.type === 'checkbox') i.checked = v; else if (i.tagName !== 'SELECT' || [...i.options].some(o => o.value === v)) i.value = v; } }
  $$('[data-scroll]', el).forEach(s => { const x = k.scroll[s.dataset.scroll]; if (x) s.scrollTop = x[1] ? s.scrollHeight : x[0]; });
  if (k.focus) document.getElementById(k.focus)?.focus();
  window.scrollTo(0, k.y);
}
let refreshT;
export function refreshSoon(ms = 350) { clearTimeout(refreshT); refreshT = setTimeout(() => route(true), ms); }
let bootT;
const reboot = () => { clearTimeout(bootT); bootT = setTimeout(async () => { await loadBoot(); refreshSoon(0); }, 400); };

// ---------- tiempo real ----------
function connectSSE() {
  const es = new EventSource('/api/events');
  const on = (t, fn) => es.addEventListener(t, e => fn(JSON.parse(e.data)));
  let inboxT;
  const pass = (t, d) => { if (['task.updated', 'conv.updated'].includes(t)) { clearTimeout(inboxT); inboxT = setTimeout(inboxCount, 800); } const r = current?.view.event?.(t, d, current); if (r === 'handled') return; if (r === 'refresh' || (current?.view.refreshOn || []).includes(t)) refreshSoon(); };
  for (const t of ['task.updated', 'task.created', 'conv.updated', 'run.started', 'handoff', 'activity', 'status.scan', 'council.updated']) on(t, d => pass(t, d));
  on('run.log', d => pass('run.log', d));
  on('agent.status', d => { reboot(); pass('agent.status', d); });
  on('project.updated', () => reboot());
  on('machine.status', d => { reboot(); pass('machine.status', d); });
  on('queue', d => { S.boot.queue_paused = d.paused; $('#qpaused').hidden = !d.paused; });
  on('notify', n => { notifyUI(n); inboxCount(); });
  on('permiso', p => {
    beep('consulta');
    holo('🔐 Permiso solicitado', p.desc, { ms: 0, link: p.task_id ? `#/tarea/${p.task_id}` : `#/cantina/${p.conv_id}`,
      actions: `<button class="btn sm g" data-perm="${h(p.request_id)}" data-allow="1">Aprobar</button><button class="btn sm r" data-perm="${h(p.request_id)}" data-allow="0">Denegar</button>` });
    desktop('Permiso solicitado', p.desc, p.task_id ? `#/tarea/${p.task_id}` : `#/cantina/${p.conv_id}`);
    pass('permiso', p);
  });
  es.addEventListener('hello', () => { if (S.sseLost) { S.sseLost = false; reboot(); } });
  es.onerror = () => { S.sseLost = true; };
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-perm]');
  if (!b) return;
  try { await post('/api/permissions/' + encodeURIComponent(b.dataset.perm), { allow: b.dataset.allow === '1' }); b.closest('.holo')?.remove(); refreshSoon(); } catch (err) { fail(err); }
});
function notifyUI(n) {
  const kind = { consulta: 'consulta', fallo: 'error', cuota: 'error', revision: 'ok', permiso: 'consulta' }[n.kind] || 'notify';
  beep(kind);
  holo(n.title, n.body, { link: n.link, err: ['fallo', 'cuota'].includes(n.kind), ms: ['consulta', 'cuota'].includes(n.kind) ? 15000 : 7000 });
  const prefs = S.boot.me.notif_prefs || {};
  if (prefs[n.kind] !== false) desktop(n.title, n.body, n.link);
}
function desktop(title, body, link) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  const n = new Notification('★ ' + title, { body: String(body || '').slice(0, 200), tag: title });
  n.onclick = () => { window.focus(); if (link) location.hash = link; n.close(); };
}
let baseTitle = 'Oficina Virtual';
async function inboxCount() {
  try {
    const x = await get('/api/inbox');
    const pend = x.tasks.filter(t => ['esperando', 'pausada_cuota'].includes(t.status)).length + x.chats.length + x.permissions.length;
    const n = pend + x.tasks.filter(t => t.status === 'revision').length;
    const b = $('#bellN'); if (b) { b.hidden = !n; b.textContent = n; }
    document.title = (pend ? `(${pend}) ` : '') + baseTitle;
    const fav = $('#favicon');
    fav.href = fav.href.replace(/%3Crect x='6' y='0'[^%]*%2Fff3b3b'%2F%3E/, '').replace('%3C/svg%3E', pend ? "%3Crect x='6' y='0' width='2' height='2' fill='%23ff3b3b'/%3E%3C/svg%3E" : '%3C/svg%3E');
    if (!$('#inbox').hidden) renderInbox(x);
  } catch {}
}
async function toggleInbox() {
  const box = $('#inbox'); box.hidden = !box.hidden;
  if (!box.hidden) renderInbox(await get('/api/inbox'));
}
function renderInbox(x) {
  const box = $('#inbox');
  const item = (link, title, sub) => `<div class="inbox-item" data-link="${h(link)}"><div>${title}</div><small>${sub}</small></div>`;
  box.innerHTML = `<div class="row"><h2 style="margin:0">Bandeja</h2><button class="btn sm ghost right" id="inboxClose">Cerrar</button></div>
    ${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn sm y" id="deskN">Activar notificaciones de escritorio</button>' : ''}
    <h3>Permisos (${x.permissions.length})</h3>${x.permissions.map(p => `<div class="perm">${h(JSON.stringify(p.input).slice(0, 200))}<div class="row"><button class="btn sm g" data-perm="${h(p.request_id)}" data-allow="1">Aprobar</button><button class="btn sm r" data-perm="${h(p.request_id)}" data-allow="0">Denegar</button></div></div>`).join('') || '<div class="empty">—</div>'}
    <h3>Consultas de agentes</h3>${[...x.tasks.filter(t => t.status === 'esperando').map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${agentChip(t.agent_id, 1)} ${ago(t.updated_at)}`)),
      ...x.chats.map(c => item(`#/cantina/${c.id}`, `💬 ${h(c.title)}`, `${agentChip(c.agent_id, 1)} ${ago(c.updated_at)}`))].join('') || '<div class="empty">Nadie pregunta nada</div>'}
    <h3>Revisiones</h3>${x.tasks.filter(t => t.status === 'revision').map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${chip('revision')} ${ago(t.updated_at)}`)).join('') || '<div class="empty">—</div>'}
    <h3>Relevos / fallos</h3>${x.tasks.filter(t => ['pausada_cuota', 'fallida'].includes(t.status)).map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${chip(t.status)} ${ago(t.updated_at)}`)).join('') || '<div class="empty">—</div>'}
    <div class="row"><h3>Notificaciones</h3><button class="btn sm ghost right" id="seenAll">Marcar leídas</button></div>
    ${x.notifications.map(n => item(n.link || '#/estacion', `${n.seen ? '' : '● '}${h(n.title)}`, `${h(n.body).slice(0, 120)} · ${ago(n.at)}`)).join('')}`;
  $('#inboxClose').onclick = () => box.hidden = true;
  $('#deskN')?.addEventListener('click', async () => { await Notification.requestPermission(); renderInbox(x); });
  $('#seenAll').onclick = async () => { await post('/api/notifications/seen'); inboxCount(); };
  $$('[data-link]', box).forEach(i => i.onclick = () => { location.hash = i.dataset.link; });
}

// ---------- arranque ----------
async function start() {
  try { await loadBoot(); } catch { return loginView(); }
  shell(); connectSSE(); inboxCount(); setInterval(inboxCount, 60000);
  if (!location.hash || location.hash === '#/login') location.hash = '#/estacion';
  route();
}
window.addEventListener('hashchange', () => { if (S.boot || location.hash === '#/login') route(); });
start();
