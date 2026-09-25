// Arranque, login, shell, router, tiempo real (SSE) y bandeja de pendientes
import { S, get, post, h, $, $$, holo, fail, beep, agentChip, chip, ago, isAdmin, canEdit, project, opts, linkLabels } from './core.js';
import { sprite } from './sprites.js';
import { VIEWS, taskForm, missionForm } from './views.js';

const app = document.getElementById('app');
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

// ---------- shell: mapa de fondo + panel lateral + dock inferior (estilo Gather) ----------
export async function loadBoot() {
  S.boot = await get('/api/bootstrap');
  if (S.project && !project(S.project)) S.project = null;
  applyTheme(S.boot.me.notif_prefs?.theme);
}
// tema por usuario (se guarda en su perfil); localStorage solo evita el parpadeo al cargar
export function applyTheme(t) {
  t = t === 'crema' ? 'crema' : 'oscuro';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ov_theme', t); } catch {}
}
try { document.documentElement.dataset.theme = localStorage.getItem('ov_theme') || 'oscuro'; } catch {}
// proyecto actual (null = todos): filtra el mapa y es el predeterminado del kanban y los formularios
export function setProject(id) {
  S.project = id || null;
  localStorage.setItem('ov_project', S.project || '');
  const s = $('#projSel'); if (s) s.value = S.project || '';
}
const MENU = [['proyectos', 'Proyectos'], ['kanban', 'Kanban'], ['cantina', 'Cantina'], ['consejo', 'Consejo Jedi'], ['archivos', 'Archivos Jedi'], ['puente', 'Puente de Mando'], ['config', 'Configuración']];
const WIDE = ['proyectos', 'kanban', 'consejo', 'archivos', 'puente', 'config'];
function shell() {
  const me = S.boot.me;
  app.innerHTML = `
  <div class="hud-tl">
    <a class="logo" href="#/estacion" title="Volver al mapa">★ OFICINA</a>
    <select id="projSel" aria-label="Proyecto que se muestra en el mapa">${opts(S.boot.projects.map(p => [p.id, p.name]), S.project || '', 'Todos los proyectos')}</select>
  </div>
  <div id="qpaused" class="queue-paused" ${S.boot.queue_paused ? '' : 'hidden'}>⚠ Cola en pausa (Orden 66) ${isAdmin() ? '<button class="btn sm y" id="resumeQ">Reanudar cola</button>' : ''}</div>
  <div id="map" class="map"></div>
  <aside class="drawer" id="drawer" hidden aria-label="Panel">
    <button class="drawer-x" id="drawerX" title="Cerrar (Esc)" aria-label="Cerrar panel">✕</button>
    <main id="view" tabindex="-1"></main>
  </aside>
  <nav class="dock" aria-label="Acciones">
    <button class="dock-me" id="meBtn" aria-haspopup="menu" aria-expanded="false">${sprite(me.role === 'admin' ? 'imperial' : 'rebel', '#ff8c42', 2)}<span>${h(me.name.split(' ')[0])}</span></button>
    ${canEdit() ? '<button id="dNew" class="dock-y">+ Tarea</button>' : ''}
    <a href="#/kanban">Kanban</a>
    <a href="#/cantina">Cantina</a>
    <button id="dFind" title="Buscar y navegar (Ctrl+K)">Buscar <kbd>Ctrl K</kbd></button>
    <button class="bell" id="bellBtn" aria-label="Bandeja">Bandeja<span class="n" id="bellN" hidden></span></button>
  </nav>
  <div class="menu" id="meMenu" role="menu" hidden>
    <div class="menu-head">${h(me.name)}<br><small>${h(S.boot.users.find(u => u.id === me.id)?.rank || '')} · ${h(me.role)}</small></div>
    ${MENU.filter(([k]) => k !== 'config' || isAdmin()).map(([k, l]) => `<a role="menuitem" href="#/${k}">${l}</a>`).join('')}
    ${canEdit() ? '<button role="menuitem" id="mMission">Nueva misión</button>' : ''}
    <button role="menuitem" id="soundBtn">Sonido: ${S.sound ? 'sí' : 'no'}</button>
    <button role="menuitem" id="logoutBtn">Salir</button>
  </div>
  <dialog id="palette" class="palette" aria-label="Buscar"><input id="palQ" placeholder="Busca una tarea, proyecto o sección…" autocomplete="off"><div id="palList" role="listbox"></div></dialog>
  <aside class="inbox" id="inbox" hidden></aside>`;
  $('#projSel').onchange = e => { setProject(+e.target.value); mapSoon(0); if (current?.name === 'kanban') go('#/kanban/' + (S.project || 'todos')); };
  $('#drawerX').onclick = closeDrawer;
  const menu = $('#meMenu');
  const toggleMenu = show => { menu.hidden = !show; $('#meBtn').setAttribute('aria-expanded', show); };
  $('#meBtn').onclick = e => { e.stopPropagation(); toggleMenu(menu.hidden); };
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#meMenu')) toggleMenu(false); });
  menu.addEventListener('click', e => { if (e.target.closest('a')) toggleMenu(false); });
  $('#logoutBtn').onclick = async () => { await post('/api/logout'); location.hash = '#/login'; location.reload(); };
  $('#soundBtn').onclick = e => { S.sound = !S.sound; localStorage.setItem('ov_sound', S.sound ? '1' : '0'); e.target.textContent = 'Sonido: ' + (S.sound ? 'sí' : 'no'); if (S.sound) beep('ok'); };
  $('#mMission')?.addEventListener('click', () => { toggleMenu(false); missionForm(); });
  $('#dNew')?.addEventListener('click', () => taskForm());
  $('#dFind').onclick = openPalette;
  $('#bellBtn').onclick = toggleInbox;
  $('#resumeQ')?.addEventListener('click', () => post('/api/queue/resume').catch(fail));
}
const go = hash => { location.hash = hash; };
const closeDrawer = () => go('#/estacion');
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (S.boot) openPalette(); return; }
  if (e.key === 'Escape' && !document.querySelector('dialog[open]') && S.boot) {
    if (!$('#inbox')?.hidden) $('#inbox').hidden = true;
    else if (!$('#drawer')?.hidden) closeDrawer();
  }
});

// ---------- paleta de comandos (Ctrl+K) ----------
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STATUS_TXT = { pendiente: 'pendiente', bloqueada: 'bloqueada', en_cola: 'en cola', en_curso: 'en curso', esperando: 'espera respuesta', revision: 'revisión', completada: 'completada', pausada_cuota: 'sin cuota', fallida: 'fallida' };
async function openPalette() {
  const d = $('#palette'), q = $('#palQ'), list = $('#palList');
  if (d.open) return;
  q.value = ''; d.showModal();
  let tasks = [];
  const base = [
    ...(canEdit() ? [['Nueva tarea', 'acción', () => taskForm()], ['Nueva misión', 'acción', () => missionForm()], ['Nueva consulta rápida', 'acción', () => go('#/cantina')]] : []),
    ['Estación', 'ir a', () => go('#/estacion')],
    ...MENU.filter(([k]) => k !== 'config' || isAdmin()).map(([k, l]) => [l, 'ir a', () => go('#/' + k)]),
    ['Kanban de todos los proyectos', 'ir a', () => go('#/kanban/todos')],
    ...S.boot.projects.map(p => [p.name, 'proyecto', () => go('#/kanban/' + p.id)]),
  ];
  let items = [], sel = 0;
  const draw = () => {
    const t = norm(q.value.trim());
    const found = t ? tasks.filter(x => norm(`#${x.id} ${x.title}`).includes(t)).slice(0, 8).map(x => [`#${x.id} ${x.title}`, STATUS_TXT[x.status] || x.status, () => go('#/tarea/' + x.id)]) : [];
    items = [...base.filter(([l]) => !t || norm(l).includes(t)), ...found];
    if (t) items.push([`Buscar «${q.value.trim()}» en el historial`, 'archivos', () => go('#/archivos/buscar?q=' + encodeURIComponent(q.value.trim()))]);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map(([l, k], i) => `<div class="pal-item ${i === sel ? 'on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}"><span>${h(l)}</span><small>${h(k)}</small></div>`).join('') || '<div class="empty">Sin resultados</div>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => { const it = items[i]; if (!it) return; d.close(); it[2](); };
  q.oninput = () => { sel = 0; draw(); };
  q.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  };
  list.onclick = e => { const it = e.target.closest('[data-i]'); if (it) pick(+it.dataset.i); };
  d.onclick = e => { if (e.target === d) d.close(); }; // clic fuera de la caja
  draw(); q.focus();
  get('/api/tasks').then(t => { tasks = t; if (d.open) draw(); }).catch(() => {}); // las tareas llegan después: la paleta ya responde
}

// ---------- router: la estación es el mapa; todo lo demás abre el panel lateral ----------
function parseHash() {
  const [p, qs] = (location.hash.slice(2) || 'estacion').split('?');
  const [name, ...rest] = p.split('/');
  return { name, args: rest.map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export async function route(soft = false) {
  const r = parseHash();
  if (r.name === 'login') return loginView();
  if (!S.boot) return start();
  const name = VIEWS[r.name] ? r.name : 'estacion';
  const drawer = $('#drawer');
  if (name === 'estacion') {
    current = { ...r, name, view: VIEWS.estacion };
    drawer.hidden = true; document.body.classList.remove('drawer-open');
    return renderMap();
  }
  const v = VIEWS[name];
  drawer.hidden = false; document.body.classList.add('drawer-open');
  drawer.classList.toggle('wide', WIDE.includes(name));
  const old = $('#view');
  const keep = soft ? snapshot(old) : null;
  const el = old.cloneNode(false); // elemento nuevo: sin listeners de la vista anterior
  const token = current = { ...r, name, view: v };
  try { await v.render(el, r); } catch (e) { el.innerHTML = `<div class="panel r">${h(e.message)}</div>`; }
  if (current !== token) return; // otra navegación empezó mientras cargaba
  linkLabels(el);
  $('#view').replaceWith(el);
  if (keep) restore(el, keep, drawer); else { drawer.scrollTop = 0; el.focus({ preventScroll: true }); }
}
// el mapa se dibuja aparte y se refresca con sus propios eventos, esté o no abierto el panel
let mapBusy = false, mapT;
async function renderMap() {
  if (mapBusy) return mapSoon();
  mapBusy = true;
  try { await VIEWS.estacion.render($('#map')); } catch (e) { $('#map').innerHTML = `<div class="panel r" style="margin:80px 16px">${h(e.message)}</div>`; }
  mapBusy = false;
}
function mapSoon(ms = 400) { clearTimeout(mapT); mapT = setTimeout(renderMap, ms); }
// conserva lo que el usuario está escribiendo durante refrescos en vivo
function snapshot(el) {
  const vals = {}; $$('[id]', el).forEach(i => { if ('value' in i && i.type !== 'button') vals[i.id] = i.type === 'checkbox' ? i.checked : i.value; });
  const scroll = {}; $$('[data-scroll]', el).forEach(s => scroll[s.dataset.scroll] = [s.scrollTop, s.scrollHeight - s.scrollTop - s.clientHeight < 40]);
  return { vals, focus: document.activeElement?.id, scroll, y: $('#drawer').scrollTop };
}
function restore(el, k, drawer) {
  for (const [id, v] of Object.entries(k.vals)) { const i = document.getElementById(id); if (i && el.contains(i)) { if (i.type === 'checkbox') i.checked = v; else if (i.tagName !== 'SELECT' || [...i.options].some(o => o.value === v)) i.value = v; } }
  $$('[data-scroll]', el).forEach(s => { const x = k.scroll[s.dataset.scroll]; if (x) s.scrollTop = x[1] ? s.scrollHeight : x[0]; });
  if (k.focus) document.getElementById(k.focus)?.focus({ preventScroll: true });
  drawer.scrollTop = k.y;
}
let refreshT;
export function refreshSoon(ms = 350) { clearTimeout(refreshT); refreshT = setTimeout(() => { if (current?.name !== 'estacion') route(true); mapSoon(0); }, ms); }
let bootT;
const reboot = () => { clearTimeout(bootT); bootT = setTimeout(async () => { await loadBoot(); refreshSoon(0); }, 400); };

// ---------- tiempo real ----------
function connectSSE() {
  const es = new EventSource('/api/events');
  const on = (t, fn) => es.addEventListener(t, e => fn(JSON.parse(e.data)));
  let inboxT;
  const pass = (t, d) => { if (['task.updated', 'conv.updated'].includes(t)) { clearTimeout(inboxT); inboxT = setTimeout(inboxCount, 800); } if (VIEWS.estacion.refreshOn.includes(t)) mapSoon(); if (current?.name === 'estacion') return; const r = current?.view.event?.(t, d, current); if (r === 'handled') return; if (r === 'refresh' || (current?.view.refreshOn || []).includes(t)) refreshSoon(); };
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
  shell(); connectSSE(); inboxCount(); setInterval(inboxCount, 60000); renderMap();
  if (!location.hash || location.hash === '#/login') location.hash = '#/estacion';
  route();
}
window.addEventListener('hashchange', () => { if (S.boot || location.hash === '#/login') route(); });
start();
