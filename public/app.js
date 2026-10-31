// Arranque, login, shell, router, tiempo real (SSE) y bandeja de pendientes
import { S, get, post, put, h, $, $$, holo, fail, beep, agentChip, chip, ago, isAdmin, canEdit, project, opts, linkLabels, applyTheme, canListen, speak, voicePrefs, ic } from './core.js';
import { announce } from './voz.js';
import { userSprite, agentSprite } from './sprites.js';
import { VIEWS, taskForm, missionForm, approveDialog, vozForm } from './views.js';
import { captureInputState, restoreInputState, captureReplyDrafts, restoreReplyDrafts } from './ui-state.js';

const app = document.getElementById('app');
let current = null;

// ---------- login / setup ----------
const AGENTS4 = ['claude', 'codex', 'antigravity', 'commandcode'].map(k => agentSprite({ key: k }, 2.4)).join('');
const loginHead = t => `<div class="row" style="justify-content:center;gap:6px;margin-bottom:14px">${AGENTS4}</div><h1>${t}</h1>
  <p class="login-sub">Tus agentes de código (Claude, Codex, Antigravity y CommandCode) en un solo lugar.</p>`;
async function loginView() {
  const { needed, mode } = await get('/api/setup');
  const err = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
  if (mode === 'google') {
    app.innerHTML = `<div class="login"><div class="login-box panel">${loginHead('Oficina Virtual')}
      <a class="btn y" href="/api/auth/google" style="display:flex;justify-content:center">Entrar con Google</a>
      <p class="muted" style="text-align:center">Solo cuentas autorizadas.</p><div class="err" role="alert">${h(err || '')}</div></div></div>`;
    return;
  }
  app.innerHTML = `<div class="login"><div class="login-box panel">
    ${loginHead(needed ? 'Crea la cuenta de administrador' : 'Oficina Virtual')}
    <form id="lf" class="col-flex">
      ${needed ? '<label class="l">Nombre</label><input name="name" autocomplete="name">' : ''}
      <label class="l">Usuario</label><input name="username" required autocomplete="username" autofocus>
      <label class="l">Contraseña</label><input name="password" type="password" required minlength="${needed ? 6 : 1}" autocomplete="${needed ? 'new-password' : 'current-password'}">
      <button class="btn y" style="justify-content:center">${needed ? 'Crear y entrar' : 'Entrar'}</button>
      <div class="err" id="lerr" role="alert"></div>
    </form></div></div>`;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try { await post(needed ? '/api/setup' : '/api/login', b); beep('ok'); location.hash = '#/harness'; start(); }
    catch (err) { $('#lerr').textContent = err.message; beep('error'); }
  });
}

// ---------- shell: mapa de fondo + panel lateral + dock inferior (estilo Gather) ----------
export async function loadBoot() {
  S.boot = await get('/api/bootstrap');
  if (S.project && !project(S.project)) S.project = null;
  applyTheme(S.boot.me?.notif_prefs?.theme);
}
export { applyTheme };
// proyecto actual (null = todos): filtra el mapa y es el predeterminado del kanban y los formularios
export function setProject(id) {
  S.project = id || null;
  localStorage.setItem('ov_project', S.project || '');
  const s = $('#projSel'); if (s) s.value = S.project || '';
}
// barra lateral agrupada; en el celular, pestañas abajo y el resto en el menú lateral (☰)
const NAV = [
  ['Trabajo', [['harness', 'Agentes', 'agents'], ['cantina', 'Chats', 'chat'], ['kanban', 'Tareas', 'board'], ['proyectos', 'Proyectos', 'folder'], ['repos', 'Repositorios', 'branch']]],
  ['PC', [['mando', 'Mando directo', 'rocket'], ['pc', 'Control con zer0', 'monitor']]],
  ['Sistema', [['estacion', 'Oficina (mapa)', 'map'], ['puente', 'Estado', 'gauge'], ['consejo', 'Mejoras', 'council'], ['archivos', 'Historial', 'archive'], ['config', 'Configuración', 'gear']]],
];
const MENU = NAV.flatMap(([, items]) => items);
const navOk = k => k === 'config' ? isAdmin() : k === 'pc' ? canEdit() : true;
function shell() {
  const me = S.boot.me;
  app.innerHTML = `<div class="shell">
  <aside class="side" id="side" aria-label="Navegación">
    <a class="brand" href="#/harness" aria-label="Oficina, inicio">oficina<i class="brand-cursor"></i></a>
    <label class="side-proj"><span>Proyecto</span><select id="projSel" aria-label="Proyecto actual">${opts(S.boot.projects.map(p => [p.id, p.name]), S.project || '', 'Todos')}</select></label>
    ${canEdit() ? `<button class="btn y side-new" id="dNew">${ic('plus', 'sm')} Nueva tarea</button>` : ''}
    ${(() => { let n = 0; return NAV.map(([g, items]) => `<div class="side-group">${g}</div>${items.filter(([k]) => navOk(k)).map(([k, l]) => `<a class="nav" href="#/${k}" data-nav="${k}"><span class="nav-k">${String(++n).padStart(2, '0')}</span>${l}</a>`).join('')}`).join(''); })()}
    <div class="side-foot">
      <button class="nav bell" id="bellBtn"><span class="nav-k">${ic('bell', 'sm')}</span>Bandeja<span class="n" id="bellN" hidden></span></button>
      <button class="nav" id="dFind" title="Buscar y navegar (Ctrl+K)"><span class="nav-k">${ic('search', 'sm')}</span>Buscar <kbd class="right">Ctrl K</kbd></button>
      ${canListen() ? `<button class="nav" id="dVoz" data-vcmd="" title="Órdenes por voz. Con una tarea o chat abierto: aprueba, devuélvela porque…, pásala a Codex, responde…; en otra pantalla: crea una tarea, abre los chats, busca…"><span class="nav-k">${ic('mic', 'sm')}</span>Voz</button>` : ''}
      <button class="me-btn" id="meBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Menú de ${h(me.name)}">${userSprite(me, 2)}<span class="grow ellipsis">${h(me.name)}<small>${h(me.role)}</small></span></button>
    </div>
  </aside>
  <div class="main-area">
    <div id="qpaused" class="queue-paused" ${S.boot.queue_paused ? '' : 'hidden'}>⚠ Cola en pausa: no arrancan turnos nuevos ${isAdmin() ? '<button class="btn sm" id="resumeQ">Reanudar cola</button>' : ''}</div>
    <div class="map-bar" id="mapBar" hidden>
      <select id="stSel" aria-label="Filtrar la oficina por agente o área"><option value="">Todos los agentes y áreas</option>
        <optgroup label="Agente">${opts(S.boot.agents.map(a => ['a:' + a.id, a.name]), S.stationFilter)}</optgroup>
        <optgroup label="Área">${opts(S.boot.areas.map(a => ['r:' + a.id, a.name]), S.stationFilter)}</optgroup></select>
      <div class="hud-att" id="hudAtt"></div>
    </div>
    <div id="map" class="map" hidden></div>
    <section class="drawer" id="drawer" aria-label="Contenido"><main id="view" tabindex="-1"></main></section>
  </div></div>
  <nav class="tabbar" aria-label="Secciones">
    <a href="#/harness" data-nav="harness">${ic('agents')}Agentes</a>
    <a href="#/kanban" data-nav="kanban">${ic('board')}Tareas</a>
    ${canEdit() ? `<button class="tab-y" id="tNew" aria-label="Nueva tarea">${ic('plus')}Tarea</button>` : ''}
    <button class="bell" id="tBell">${ic('bell')}Bandeja<span class="n" id="tBellN" hidden></span></button>
    <button id="tMenu" aria-label="Más secciones">${ic('menu')}Más</button>
  </nav>
  <div class="menu" id="meMenu" role="menu" hidden>
    <div class="menu-head">${userSprite(me, 2.4)}<div><b>${h(me.name)}</b><small>${h(S.boot.users.find(u => u.id === me.id)?.rank || '')} · ${h(me.role)}</small></div></div>
    <a role="menuitem" href="#/config/perfil">${ic('user')}Mi perfil</a>
    ${canEdit() ? `<button role="menuitem" id="mMission">${ic('rocket')}Nueva misión</button>` : ''}
    <div class="menu-sep">Preferencias</div>
    <button role="menuitemcheckbox" id="themeBtn" aria-checked="${S.theme !== 'blanco'}">${ic('moon')}Tema oscuro<span class="switch"></span></button>
    <button role="menuitemcheckbox" id="soundBtn" aria-checked="${S.sound}">${ic('sound')}Sonido<span class="switch"></span></button>
    <button role="menuitem" id="logoutBtn" class="danger">${ic('logout')}Salir</button>
  </div>
  <dialog id="palette" class="palette" aria-label="Buscar"><input id="palQ" placeholder="Busca una tarea, proyecto o sección…" autocomplete="off"><div id="palList" role="listbox"></div></dialog>
  <aside class="inbox" id="inbox" hidden></aside>`;
  $('#projSel').onchange = e => { setProject(+e.target.value); mapSoon(0); if (current?.name === 'kanban') go('#/kanban/' + (S.project || 'todos')); else if (current && current.name !== 'estacion') { S.hxSel = null; route(); } };
  $('#stSel').onchange = e => { S.stationFilter = e.target.value; localStorage.setItem('ov_station_filter', S.stationFilter); mapSoon(0); };
  // celular: ☰ Más abre la barra lateral encima; se cierra al elegir algo o tocar fuera
  const side = open => document.body.classList.toggle('side-open', open);
  $('#tMenu').onclick = e => { e.stopPropagation(); side(!document.body.classList.contains('side-open')); };
  $('#side').addEventListener('click', e => { if (e.target.closest('a.nav')) side(false); });
  document.addEventListener('click', e => { if (document.body.classList.contains('side-open') && !e.target.closest('#side, #tMenu, #meMenu')) side(false); });
  $('#tNew')?.addEventListener('click', () => taskForm());
  $('#tBell').onclick = toggleInbox;
  const menu = $('#meMenu');
  const placeMenu = () => {
    if (menu.hidden) return;
    const trigger = $('#meBtn').getBoundingClientRect();
    const width = menu.getBoundingClientRect().width;
    menu.style.setProperty('--menu-left', Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8)) + 'px');
    menu.style.setProperty('--menu-bottom', (window.innerHeight - trigger.top + 10) + 'px');
  };
  const toggleMenu = show => { menu.hidden = !show; $('#meBtn').setAttribute('aria-expanded', show); if (show) placeMenu(); };
  $('#meBtn').onclick = e => { e.stopPropagation(); toggleMenu(menu.hidden); };
  window.addEventListener('resize', placeMenu);
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#meMenu')) toggleMenu(false); });
  menu.addEventListener('click', e => { if (e.target.closest('a')) toggleMenu(false); });
  $('#logoutBtn').onclick = async () => { await post('/api/logout'); location.hash = '#/login'; location.reload(); };
  $('#themeBtn').onclick = async e => {
    const next = S.theme === 'blanco' ? 'oscuro' : 'blanco';
    applyTheme(next);
    e.currentTarget.setAttribute('aria-checked', next !== 'blanco');
    if (S.sound) beep('ok');
    try {
      const prefs = S.boot?.me?.notif_prefs || {};
      prefs.theme = next;
      await put('/api/me', { notif_prefs: prefs });
    } catch {}
    refreshSoon(); // el mapa toma los colores de estado del tema
  };
  $('#soundBtn').onclick = e => { S.sound = !S.sound; localStorage.setItem('ov_sound', S.sound ? '1' : '0'); e.currentTarget.setAttribute('aria-checked', S.sound); if (S.sound) beep('ok'); };
  $('#mMission')?.addEventListener('click', () => { toggleMenu(false); missionForm(); });
  $('#dNew')?.addEventListener('click', () => taskForm());
  // un solo botón: con tarea/chat abierto lo atiende voz.js (data-vcmd); si no, órdenes generales
  $('#dVoz')?.addEventListener('click', e => { if (!/#\/(tarea|cantina)\/\d/.test(location.hash)) { e.stopPropagation(); vozForm(); } });
  $('#dFind').onclick = openPalette;
  $('#bellBtn').onclick = toggleInbox;
  $('#resumeQ')?.addEventListener('click', () => post('/api/queue/resume').catch(fail));
}
const go = hash => { location.hash = hash; };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (S.boot) openPalette(); return; }
  if (e.key === 'Escape' && !document.querySelector('dialog[open]') && S.boot) {
    if (!$('#inbox')?.hidden) $('#inbox').hidden = true;
    else document.body.classList.remove('side-open');
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
    ['Oficina (mapa)', 'ir a', () => go('#/estacion')],
    ...MENU.map(([k, l]) => [l, 'ir a', () => go('#/' + k)]),
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

// ---------- router: cada sección ocupa el área de contenido; la oficina (mapa) es una vista más ----------
function parseHash() {
  const [p, qs] = (location.hash.slice(2) || 'harness').split('?');
  const [name, ...rest] = p.split('/');
  return { name, args: rest.map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export async function route(soft = false) {
  const r = parseHash();
  if (r.name === 'login') return loginView();
  if (!S.boot) return start();
  const name = VIEWS[r.name] ? r.name : 'harness';
  const drawer = $('#drawer');
  // la sección de una tarea o un chat abierto se marca en la navegación
  const navName = { tarea: 'kanban' }[name] || name;
  $$('[data-nav]').forEach(a => a.dataset.nav === navName ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  const onMap = name === 'estacion';
  $('#map').hidden = $('#mapBar').hidden = !onMap; drawer.hidden = onMap;
  if (onMap) {
    current = { ...r, name, view: VIEWS.estacion };
    return renderMap();
  }
  const v = VIEWS[name];
  const el = $('#view').cloneNode(false); // elemento nuevo: sin listeners de la vista anterior
  const token = current = { ...r, name, view: v };
  try { await v.render(el, r); } catch (e) { el.innerHTML = `<div class="panel r">${h(e.message)}</div>`; }
  if (current !== token) return; // otra navegación empezó mientras cargaba
  const keep = soft ? snapshot($('#view')) : null; // tras la carga: incluye lo escrito mientras esperaba
  linkLabels(el);
  $('#view').replaceWith(el);
  if (keep) restore(el, keep, drawer); else { drawer.scrollTop = 0; el.focus({ preventScroll: true }); }
}
// el mapa se dibuja aparte y se refresca con sus propios eventos, esté o no abierto el panel
let mapBusy = false, mapT;
// el mapa se redibuja entero con cada evento: se conserva el scroll del mapa y de sus listas (misma estructura en cada render)
const mapScrollers = m => [m, ...$$('.kcol-body, .station-aside-body, .repo-body', m)];
// y el foco del teclado: se busca el mismo elemento por su data-* o id
const focusKey = e => ['id', 'task', 'agent', 'chat'].map(k => e.dataset[k] && `[data-${k}="${CSS.escape(e.dataset[k])}"]`).find(Boolean) || (e.id ? '#' + CSS.escape(e.id) : null);
async function renderMap() {
  if (current?.name !== 'estacion') return; // el mapa solo se dibuja cuando está a la vista
  if (mapBusy) return mapSoon();
  mapBusy = true;
  const m = $('#map'), keep = mapScrollers(m).map(e => e.scrollTop);
  const fk = m.contains(document.activeElement) && document.activeElement !== m ? focusKey(document.activeElement) : null;
  try { await VIEWS.estacion.render(m); } catch (e) { m.innerHTML = `<div class="panel r" style="margin:80px 16px">${h(e.message)}</div>`; }
  mapScrollers(m).forEach((e, i) => { if (keep[i]) e.scrollTop = keep[i]; });
  if (fk && !m.contains(document.activeElement)) m.querySelector(fk)?.focus({ preventScroll: true });
  mapBusy = false;
}
function mapSoon(ms = 400) { clearTimeout(mapT); mapT = setTimeout(renderMap, ms); }
// conserva lo que el usuario está escribiendo durante refrescos en vivo
function snapshot(el) {
  const scroll = {}; $$('[data-scroll]', el).forEach(s => scroll[s.dataset.scroll] = [s.scrollTop, s.scrollHeight - s.scrollTop - s.clientHeight < 40]);
  return { focus: document.activeElement?.id, inputs: captureInputState($$('input,select,textarea', el), document.activeElement), scroll, y: $('#drawer').scrollTop };
}
function restore(el, k, drawer) {
  restoreInputState(el, k.inputs);
  if (k.focus && !el.contains(document.activeElement)) document.getElementById(k.focus)?.focus({ preventScroll: true }); // botones y demás
  $$('[data-scroll]', el).forEach(s => { const x = k.scroll[s.dataset.scroll]; if (x) s.scrollTop = x[1] ? s.scrollHeight : x[0]; });
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
  for (const t of ['task.updated', 'task.created', 'conv.updated', 'run.started', 'handoff', 'activity', 'status.scan', 'council.updated', 'marcacion.status']) on(t, d => pass(t, d));
  on('run.log', d => pass('run.log', d));
  on('marcacion.log', d => pass('marcacion.log', d));
  on('agent.status', d => { reboot(); pass('agent.status', d); });
  on('project.updated', () => reboot());
  on('machine.status', d => { reboot(); pass('machine.status', d); });
  on('pc.event', d => pass('pc.event', d));
  on('queue', d => { S.boot.queue_paused = d.paused; $('#qpaused').hidden = !d.paused; });
  on('notify', n => { notifyUI(n); inboxCount(); });
  on('permiso', p => {
    beep('consulta');
    if (voicePrefs().read) speak(`Permiso solicitado: ${p.desc}. ¿Lo apruebas?`);
    holo('Permiso solicitado', p.desc, { ms: 0, alert: true, link: p.task_id ? `#/tarea/${p.task_id}` : `#/cantina/${p.conv_id}`,
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
  const mic = announce(n); // lo lee en voz alta si está activado en Mi perfil y ofrece 🎤 Responder
  holo(n.title, n.body, { link: n.link, err: ['fallo', 'cuota'].includes(n.kind), ms: ['consulta', 'cuota', 'revision'].includes(n.kind) ? 30000 : 7000, actions: mic || undefined });
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
    for (const b of [$('#bellN'), $('#tBellN')]) if (b) { b.hidden = !n; b.textContent = n; }
    document.title = (n ? `(${n}) ` : '') + baseTitle; // el mismo número que la campana
    const fav = $('#favicon');
    fav.href = fav.href.replace(/%3Crect x='6' y='0'[^%]*%2Fff3b3b'%2F%3E/, '').replace('%3C/svg%3E', n ?"%3Crect x='6' y='0' width='2' height='2' fill='%23ff3b3b'/%3E%3C/svg%3E" : '%3C/svg%3E');
    if (!$('#inbox').hidden) renderInbox(x);
  } catch {}
}
async function toggleInbox() {
  const box = $('#inbox'); box.hidden = !box.hidden;
  if (!box.hidden) renderInbox(await get('/api/inbox'));
}
function renderInbox(x) {
  const box = $('#inbox');
  const drafts = captureReplyDrafts($$('form[data-reply]', box), document.activeElement); // la bandeja se redibuja con cada aviso
  const item = (link, title, sub, extra = '') => `<div class="inbox-item" data-link="${h(link)}"><div><a href="${h(link)}">${title}</a></div><small>${sub}</small>${canEdit() ? extra : ''}</div>`;
  // responder o aprobar desde la bandeja, sin abrir la tarea
  const reply = url => `<form class="inbox-reply" data-reply="${url}"><input name="text" placeholder="Responder…" aria-label="Respuesta" autocomplete="off" required><button class="btn sm y">Enviar</button></form>`;
  box.innerHTML = `<div class="row"><h2 style="margin:0">Bandeja</h2><button class="btn sm ghost right" id="inboxClose">Cerrar</button></div>
    ${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn sm y" id="deskN">Activar notificaciones de escritorio</button>' : ''}
    <h3>Permisos (${x.permissions.length})</h3>${x.permissions.map(p => `<div class="perm">${h(JSON.stringify(p.input).slice(0, 200))}<div class="row"><button class="btn sm g" data-perm="${h(p.request_id)}" data-allow="1">Aprobar</button><button class="btn sm r" data-perm="${h(p.request_id)}" data-allow="0">Denegar</button></div></div>`).join('') || '<div class="empty">—</div>'}
    <h3>Consultas de agentes</h3>${[...x.tasks.filter(t => t.status === 'esperando').map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${agentChip(t.agent_id, 1)} ${ago(t.updated_at)}`, reply(`/api/tasks/${t.id}/reply`))),
      ...x.chats.map(c => item(`#/cantina/${c.id}`, `${ic('chat', 'sm')} ${h(c.title)}`, `${agentChip(c.agent_id, 1)} ${ago(c.updated_at)}`, reply(`/api/conversations/${c.id}/reply`)))].join('') || '<div class="empty">Nadie pregunta nada</div>'}
    <h3>Revisiones</h3>${x.tasks.filter(t => t.status === 'revision').map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${chip('revision')} ${ago(t.updated_at)}`, `<div class="row"><button class="btn sm g" data-approve="${t.id}">✔ Aprobar</button></div>`)).join('') || '<div class="empty">—</div>'}
    <h3>Relevos / fallos</h3>${x.tasks.filter(t => ['pausada_cuota', 'fallida'].includes(t.status)).map(t => item(`#/tarea/${t.id}`, `#${t.id} ${h(t.title)}`, `${chip(t.status)} ${ago(t.updated_at)}`)).join('') || '<div class="empty">—</div>'}
    <div class="row"><h3>Notificaciones</h3><button class="btn sm ghost right" id="seenAll">Marcar leídas</button></div>
    ${x.notifications.map(n => item(n.link || '#/harness', `${n.seen ? '' : '● '}${h(n.title)}`, `${h(n.body).slice(0, 120)} · ${ago(n.at)}`)).join('')}`;
  restoreReplyDrafts($$('form[data-reply]', box), drafts);
  $('#inboxClose').onclick = () => box.hidden = true;
  $('#deskN')?.addEventListener('click', async () => { await Notification.requestPermission(); renderInbox(x); });
  $('#seenAll').onclick = async () => { await post('/api/notifications/seen'); inboxCount(); };
  $$('[data-link]', box).forEach(i => i.onclick = e => { if (!e.target.closest('form,button')) location.hash = i.dataset.link; });
  $$('[data-approve]', box).forEach(b => b.onclick = async () => { try { approveDialog((await get('/api/tasks/' + b.dataset.approve)).task); } catch (err) { fail(err); } });
  box.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, text = f.text.value.trim();
    if (!text) return;
    try { await post(f.dataset.reply, { text }); holo('Respuesta enviada', text); f.closest('.inbox-item').remove(); inboxCount(); } catch (err) { fail(err); }
  };
}

// ---------- arranque ----------
async function start() {
  try { await loadBoot(); } catch { return loginView(); }
  shell(); connectSSE(); inboxCount(); setInterval(inboxCount, 60000);
  if (!location.hash || location.hash === '#/login') location.hash = '#/harness';
  route();
}
window.addEventListener('hashchange', () => { if (S.boot || location.hash === '#/login') route(); });
start();
