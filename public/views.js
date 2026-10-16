// Vistas de la oficina
import { S, get, post, put, del, h, $, $$, ago, dur, fmtDate, bytes, num, STATUS, PSTATUS, chip, agent, area, user, project, isAdmin, canEdit,
  agentChip, userChip, saber, opts, md, modal, closeModal, confirmBox, promptBox, formData, holo, fail, act, beep,
  machines, machineName, defaultMachine, folderPicker, ic, upload, attachmentsHTML, micBtn, isDictated, listen, voicePrefs, speak, stopSpeaking, WIN_LABELS, agentLimits, agentLimitsBadge, startRecording, stopRecording, isRecording, transcribir } from './core.js';
import { sprite, agentSprite, userSprite, icon, ICON_NAMES } from './sprites.js';
import { route, refreshSoon, loadBoot, setProject, applyTheme } from './app.js';
import { parseVoz } from './ordenes.js';

const go = hash => { location.hash = hash; };
const ACTIVE = ['en_curso', 'en_cola', 'esperando'];
const PRI = { alta: '▲ alta', media: '■ media', baja: '▼ baja' };
const kTok = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n);
const AVATARS = [['rebel', 'Piloto rebelde'], ['imperial', 'Oficial imperial'], ['vader', 'Darth Vader']];
const agentsOn = () => S.boot.agents.filter(a => a.enabled);

// ---------- selector agente / modelo / esfuerzo ----------
// un <select> y no <input list>: el datalist filtra por el valor actual y solo mostraba el modelo por defecto
const price = (a, m) => { const p = a?.prices?.[m]; return p ? ` · $${p[0]} / $${p[1]}` : ''; }; // USD por 1M tokens entrada / salida
const modelOpts = (a, cur) => { const ms = a?.models || [], c = cur || a?.default_model || ''; return opts((c && !ms.includes(c) ? [c, ...ms] : ms).map(m => [m, m + price(a, m)]), c, ms.length || c ? null : '—'); };
const modelEffortsOf = (a, m) => {
  const me = a?.model_efforts?.[m];
  if (Array.isArray(me) && me.length) return me;
  return a?.efforts || [];
};
function agentPicker(p, sel = {}, { modes = true, blank = false } = {}) {
  const a = agent(sel.agent_id) || (blank ? null : agentsOn()[0]);
  const agentLabel = x => {
    const lim = agentLimits(x);
    const limTxt = (lim.fiveHour ? ` [5h: ${lim.fiveHour.pct}%]` : '') + (lim.weekly ? ` [7d: ${lim.weekly.pct}%]` : '');
    return x.name + (x.status === 'sin_cuota' ? ' (sin cuota)' : '') + limTxt;
  };
  const curModel = sel.model || a?.default_model || '';
  const effs = modelEffortsOf(a, curModel);
  return `<div class="field-row">
    <div>
      <div class="row" style="justify-content:space-between"><label class="l" for="${p}agent">Agente</label><span id="${p}agentLimits">${agentLimitsBadge(a)}</span></div>
      <select id="${p}agent" name="agent_id">${opts(agentsOn().map(x => [x.id, agentLabel(x)]), a?.id, blank ? '— por defecto del área —' : null)}</select>
    </div>
    <div><label class="l" for="${p}model">Modelo</label><select id="${p}model" name="model">${modelOpts(a, sel.model)}</select></div>
    <div><label class="l" for="${p}effort">Esfuerzo</label><select id="${p}effort" name="effort">${opts(effs.map(e => [e, e]), sel.effort || a?.default_effort, '—')}</select></div>
    ${modes ? `<div><label class="l" for="${p}mode">Modo</label><select id="${p}mode" name="mode">${opts([['editar', 'Editar (autónomo: aprueba todo, como tu CLI)'], ['plan', 'Plan / solo lectura'], ['supervisado', 'Supervisado (aprobar permisos, Claude)']], sel.mode || 'editar')}</select></div>` : ''}
  </div>`;
}
function bindPicker(root, p) {
  const s = $(`#${p}agent`, root); if (!s) return;
  const updateEffort = (a, m) => {
    const effEl = $(`#${p}effort`, root);
    if (!effEl) return;
    const effs = modelEffortsOf(a, m);
    effEl.innerHTML = opts(effs.map(e => [e, e]), effs.includes(a?.default_effort) ? a?.default_effort : effs[0], '—');
  };
  s.addEventListener('change', () => {
    const a = agent(s.value);
    $(`#${p}model`, root).innerHTML = modelOpts(a);
    const mEl = $(`#${p}model`, root);
    updateEffort(a, mEl?.value);
    const limEl = $(`#${p}agentLimits`, root);
    if (limEl) limEl.innerHTML = agentLimitsBadge(a);
  });
  const mEl = $(`#${p}model`, root);
  if (mEl) mEl.addEventListener('change', () => {
    const a = agent(s.value);
    updateEffort(a, mEl.value);
  });
}
async function browseInto(input, machineId) {
  const r = await folderPicker(machineId || defaultMachine(), input.value || null);
  if (r) input.value = r;
}
// selector de máquina (solo se muestra si hay más de una)
const machineSel = (attrs, sel) => machines().length > 1
  ? `<div><label class="l">Máquina</label><select ${attrs}>${opts(machines().map(m => [m.id, `${m.name}${m.online ? '' : ' (desconectada)'}`]), sel || defaultMachine())}</select></div>`
  : `<input type="hidden" ${attrs} value="${defaultMachine() || ''}">`;
async function uploadAll(files, target) {
  const ids = [];
  for (const f of files) { holo('Subiendo…', f.name, { ms: 2000 }); ids.push((await upload(f, target)).id); }
  return ids;
}
const offlineWarn = (name, online) => online === false ? `<div class="panel r" style="margin:10px 0">⚠ La máquina <b>${h(name || '')}</b> no está conectada: lo que ejecutes queda en cola hasta que el agente de campo se conecte.</div>` : '';

// ---------- formulario de tarea ----------
export async function taskForm(t = {}, preset = {}) {
  const pid = t.project_id || preset.project_id || S.project;
  if (!S.boot.projects.length) { holo('Primero crea un proyecto', '', { link: '#/proyectos' }); return go('#/proyectos'); }
  const projTasks = pid ? await get('/api/tasks?project_id=' + pid) : [];
  const p = project(pid) || S.boot.projects[0];
  const deps = t.depends_on || [];
  const d = modal(`<h2>${t.id ? `Editar tarea #${t.id}` : 'Nueva tarea'}</h2>
    <div class="field-row">
      <div><label class="l">Proyecto</label><select name="project_id" id="tfProj" ${t.id ? 'disabled' : ''}>${opts(S.boot.projects.map(x => [x.id, x.name]), p.id)}</select></div>
      <div><label class="l">Área</label><select name="area_id" id="tfArea">${opts(S.boot.areas.map(a => [a.id, `${a.name} · ${a.alias}`]), t.area_id || preset.area_id, '—')}</select></div>
    </div>
    <label class="l">Título</label><input name="title" required value="${h(t.title || preset.title || '')}">
    <label class="l">Instrucciones para el agente ${micBtn('#tfPrompt')}</label><textarea name="prompt" id="tfPrompt" rows="6">${h(t.prompt || preset.prompt || '')}</textarea>
    <div id="tfAgentBox">${agentPicker('tf', t.agent_id ? t : { agent_id: area(t.area_id || preset.area_id)?.default_agent_id }, { blank: false })}</div>
    <div id="tfHumanBox"><label class="l">Responsable</label><select name="assignee_user_id">${opts(S.boot.users.map(u => [u.id, u.name]), t.assignee_user_id || S.boot.me.id, '—')}</select></div>
    <details class="opts" ${t.id || deps.length ? 'open' : ''}><summary>Más opciones: plantilla, quién ejecuta, carpeta, prioridad, fecha, dependencias, adjuntos</summary>
    <div class="field-row">
      <div><label class="l">Plantilla</label><select id="tfTpl">${opts(S.boot.templates.map(x => [x.id, x.title]), '', '—')}</select></div>
      <div><label class="l">Ejecuta</label><select name="executor" id="tfExec">${opts([['agente', 'Agente IA'], ['humano', 'Persona']], t.executor || 'agente')}</select></div>
      <div><label class="l">Carpeta</label><select name="folder_id" id="tfFolder">${opts(p.folders.map(f => [f.id, `${f.label}${f.is_git ? ' (git)' : ''}`]), t.id ? t.folder_id : (p.folders.find(f => f.is_default)?.id), 'Sin carpeta (sandbox)')}</select></div>
      <div><label class="l">Prioridad</label><select name="priority">${opts([['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], t.priority || 'media')}</select></div>
      <div><label class="l">Fecha límite</label><input type="date" name="due_date" value="${h(t.due_date || '')}"></div>
    </div>
    <div class="l">Depende de (se ejecuta al completarse éstas)</div>
    <div class="check-list">${projTasks.filter(x => x.id !== t.id).map(x => `<label class="row"><input type="checkbox" name="dep" value="${x.id}" ${deps.includes(x.id) ? 'checked' : ''}> #${x.id} ${h(x.title)} <small>${STATUS[x.status]}</small></label>`).join('') || '<small class="muted">No hay otras tareas en este proyecto</small>'}</div>
    <label class="l">Adjuntos (imágenes, PDF, documentos: el agente los recibe en .oficina/adjuntos)</label><input type="file" id="tfFiles" multiple></details>
    ${preset.voz ? '<input type="hidden" name="voz" value="1">' : ''}
    ${t.id ? '' : '<label class="row" style="margin-top:10px"><input type="checkbox" name="run" id="tfRun"> Ejecutar al crear</label>'}
    <div class="row" style="margin-top:12px"><button class="btn y" value="ok" id="tfSave">${t.id ? 'Guardar' : 'Crear tarea'}</button><button class="btn ghost" value="cancel" formnovalidate>Cancelar</button></div>`);
  bindPicker(d, 'tf');
  const sync = () => { const hum = $('#tfExec', d).value === 'humano'; $('#tfAgentBox', d).hidden = hum; $('#tfHumanBox', d).hidden = !hum; };
  $('#tfExec', d).onchange = sync; sync();
  $('#tfTpl', d).onchange = e => { const tp = S.boot.templates.find(x => x.id === +e.target.value); if (tp) { d.querySelector('[name=prompt]').value = tp.prompt; if (!d.querySelector('[name=title]').value) d.querySelector('[name=title]').value = tp.title; if (tp.area_id) $('#tfArea', d).value = tp.area_id; } };
  $('#tfArea', d).onchange = e => { const a = area(e.target.value); if (a?.default_agent_id && !t.id) { $('#tfagent', d).value = a.default_agent_id; $('#tfagent', d).dispatchEvent(new Event('change')); } };
  $('#tfProj', d).onchange = () => { closeModal(); taskForm({ ...formData(d), id: undefined }, { project_id: +$('#tfProj', d).value }); };
  $('#tfSave', d).onclick = async e => {
    e.preventDefault();
    const f = formData(d);
    if (!f.title.trim()) return fail('Falta el título');
    f.depends_on = $$('[name=dep]:checked', d).map(c => +c.value); delete f.dep;
    for (const k of ['area_id', 'folder_id', 'agent_id', 'assignee_user_id']) f[k] = f[k] ? +f[k] : null;
    if (f.executor === 'humano') { f.agent_id = null; }
    try {
      const files = [...$('#tfFiles', d).files];
      if (t.id) { delete f.project_id; delete f.run; await put('/api/tasks/' + t.id, f); await uploadAll(files, { task_id: t.id }); closeModal(); refreshSoon(0); }
      else {
        const run = f.run; delete f.run;
        f.project_id = +$('#tfProj', d).value;
        const r = await post('/api/tasks', f);
        await uploadAll(files, { task_id: r.id });
        if (run && f.executor !== 'humano') await post(`/api/tasks/${r.id}/run`, {});
        closeModal(); holo('Tarea creada', `#${r.id} ${f.title}`, { link: `#/tarea/${r.id}` }); refreshSoon(0);
      }
    } catch (err) { fail(err); }
  };
}

export async function missionForm() {
  const p = project(S.project) || S.boot.projects[0];
  if (!p) return go('#/proyectos');
  const stages = ['Análisis', 'Desarrollo', 'Documentación'].map(n => S.boot.areas.find(a => a.name === n)).filter(Boolean);
  const d = modal(`<h2>Nueva misión</h2><p class="muted">Crea una tarea por área, encadenadas: cada etapa recibe el resumen de la anterior y arranca sola al completarse la previa.</p>
    <div class="field-row"><div><label class="l">Proyecto</label><select name="project_id">${opts(S.boot.projects.map(x => [x.id, x.name]), p.id)}</select></div>
    <div><label class="l">Carpeta</label><select name="folder_id">${opts(p.folders.map(f => [f.id, f.label]), p.folders.find(f => f.is_default)?.id, 'Sin carpeta')}</select></div></div>
    <label class="l">Título</label><input name="title" required><label class="l">Objetivo</label><textarea name="prompt"></textarea>
    ${stages.map((a, i) => `<h3>${i + 1}. ${h(a.name)} · ${h(a.alias)}</h3>${agentPicker('ms' + i, { agent_id: a.default_agent_id }, { modes: false })}`).join('')}
    <label class="row"><input type="checkbox" name="start" checked> Lanzar la primera etapa ya</label>
    <div class="row"><button class="btn y" id="msOk">Crear misión</button><button class="btn ghost" value="c" formnovalidate>Cancelar</button></div>`);
  stages.forEach((_, i) => bindPicker(d, 'ms' + i));
  $('#msOk', d).onclick = async e => {
    e.preventDefault();
    const b = { project_id: +d.querySelector('[name=project_id]').value, folder_id: +d.querySelector('[name=folder_id]').value || null, title: d.querySelector('[name=title]').value,
      prompt: d.querySelector('[name=prompt]').value, start: d.querySelector('[name=start]').checked,
      stages: stages.map((a, i) => ({ area_id: a.id, agent_id: +$(`#ms${i}agent`, d).value, model: $(`#ms${i}model`, d).value, effort: $(`#ms${i}effort`, d).value })) };
    if (!b.title) return fail('Falta el título');
    try { const r = await post('/api/missions', b); closeModal(); holo('Misión creada', `${r.ids.length} etapas`, { link: `#/tarea/${r.ids[0]}` }); refreshSoon(0); } catch (err) { fail(err); }
  };
}

// ===================== ESTACIÓN (mapa) y KANBAN =====================
const COLS = [['pendiente', 'Pendiente'], ['en_cola', 'En cola'], ['en_curso', 'En curso'], ['esperando', 'Esperando'], ['revision', 'Revisión'], ['completada', 'Completada'], ['atascadas', 'Atascadas']];
const STUCK = ['bloqueada', 'pausada_cuota', 'fallida'];

// borde de la tarjeta = una sola señal: lo que pide atención (el área va como chip)
const CARD_C = { esperando: 'var(--yellow)', revision: 'var(--orange)', fallida: 'var(--red)', pausada_cuota: 'var(--purple)', bloqueada: 'var(--muted)', en_curso: 'var(--green)' };
const WAIT = { en_curso: '⏱', esperando: '?', revision: '!' }; // cuánto lleva en ese estado; en rojo si espera al humano más de un día
const kanbanCard = (t, showProject = true) => {
  const a = agent(t.agent_id), ar = area(t.area_id);
  const tp = showProject ? project(t.project_id) : null;
  const stale = t.status !== 'en_curso' && Date.now() - Date.parse(t.updated_at) > 864e5;
  return `<div class="kcard" draggable="${canEdit()}" data-id="${t.id}" ${CARD_C[t.status] ? `style="--c:${CARD_C[t.status]}"` : ''} tabindex="0" title="#${t.id} ${h(t.title)}">
    <div class="row" style="gap:4px;line-height:1"><small>#${t.id}</small>${tp ? `<span class="chip" style="border-color:${h(tp.color)}">${h(tp.name)}</span>` : ''}${ar ? `<span class="chip">${h(ar.alias)}</span>` : ''}${STUCK.includes(t.status) ? chip(t.status) : ''}<small class="pri-${t.priority} right">${PRI[t.priority]}</small></div>
    <a class="t" href="#/tarea/${t.id}" draggable="false">${h(t.title)}</a>
    <div class="meta">${t.executor === 'humano' ? `${userSprite(user(t.assignee_user_id), 1)}${h(user(t.assignee_user_id)?.name || 'sin asignar')}` : `${agentSprite(a, 1)}${h(a?.name || '—')} <span>${h(t.model || '')}</span>`}
    ${WAIT[t.status] ? `<span class="chip ${stale ? 'st-fallida' : 'st-' + t.status}" title="${STATUS[t.status]} desde ${fmtDate(t.updated_at)}">${WAIT[t.status]} ${ago(t.updated_at).replace('hace ', '')}</span>` : ''}
    ${t.depends_on.length ? `<span title="Depende de #${t.depends_on.join(', #')}">${ic('link', 'sm')}${t.depends_on.length}</span>` : ''}${t.due_date ? `<span title="Fecha límite">${ic('calendar', 'sm')}${h(t.due_date)}</span>` : ''}</div>
    ${canEdit() ? `<select class="kmove" aria-label="Mover #${t.id} a">${opts(COLS.filter(([k]) => k !== 'atascadas' && k !== t.status), '', 'Mover a…')}</select>` : ''}</div>`;
};

// columna: vacía se pliega a una tira (sigue aceptando tarjetas); Esperando y Revisión con tareas se destacan: son la cola del humano
const kcolHTML = (k, l, n, cards) => `<div class="kcol ${n ? '' : 'empty'} ${n && ['esperando', 'revision'].includes(k) ? 'att' : ''}" data-col="${k}" ${n ? '' : `title="${l}: sin tareas"`}>
  <div class="kcol-head"><span>${l}</span><span>${n}</span></div><div class="kcol-body">${cards}</div></div>`;

// en móvil las columnas miden casi toda la pantalla: una pestaña por columna salta directo a ella
const kTabs = cols => `<nav class="kcol-tabs" aria-label="Ir a columna">${cols.map(([k, l, list]) => `<button type="button" data-kcol="${k}">${l} <b>${list.length}</b></button>`).join('')}</nav>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-kcol]');
  if (b) b.closest('.kcol-tabs').nextElementSibling?.querySelector(`.kcol[data-col="${b.dataset.kcol}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
});

// mover una tarea (arrastrar en escritorio, "Mover a…" en pantallas táctiles, donde el arrastre HTML5 no funciona)
async function moveTask(t, status, kanban_order) {
  if (status === 'en_curso' && t.executor === 'agente' && t.status !== 'en_curso' && !await confirmBox(`¿Ejecutar #${t.id} con ${agent(t.agent_id)?.name || 'el agente'}?`, 'Ejecutar')) return refreshSoon(0);
  try { await post(`/api/tasks/${t.id}/move`, { status: status === t.status ? undefined : status, kanban_order }); } catch (err) { fail(err); }
  refreshSoon(0);
}
// con propiedades on* y no addEventListener: el mapa reutiliza el mismo elemento en cada refresco
function bindKanbanDrag(root, getTasks) {
  let dragId = null;
  const all = () => typeof getTasks === 'function' ? getTasks() : getTasks;
  root.onchange = e => { const s = e.target.closest('.kmove'); const t = s && all().find(x => x.id === +s.closest('.kcard').dataset.id); if (t && s.value) moveTask(t, s.value); };
  root.ondragstart = e => {
    const c = e.target.closest('.kcard');
    if (!c) return;
    dragId = +c.dataset.id;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  };
  root.ondragend = e => {
    e.target.closest?.('.kcard')?.classList.remove('dragging');
    $$('.kcol', root).forEach(x => x.classList.remove('over'));
  };
  $$('.kcol:not([data-col=atascadas])', root).forEach(col => { // «Atascadas» agrupa estados: soltar ahí no cambiaría nada
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('over');
      if (!dragId) return;
      const k = col.dataset.col;
      const cards = $$('.kcard', col).filter(c => +c.dataset.id !== dragId);
      const after = cards.find(c => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
      const ord = id => all().find(t => t.id === +id)?.kanban_order ?? 0;
      const i = after ? cards.indexOf(after) : cards.length;
      const prev = i > 0 ? ord(cards[i - 1].dataset.id) : (cards[0] ? ord(cards[0].dataset.id) - 1000 : Date.now());
      const next = after ? ord(after.dataset.id) : prev + 2000;
      const t = all().find(x => x.id === dragId);
      if (t) moveTask(t, k, (prev + next) / 2);
    });
  });
}

// Se dibuja en la capa #map, siempre visible detrás del panel lateral.
const AT_DESK = ['en_curso', 'en_cola', 'esperando', 'revision'];
const LIVE = ['en_curso', 'en_cola', 'esperando'];
// una sola paleta de estado: la de CSS (--green, --yellow…) del tema activo; los sprites SVG necesitan el color resuelto
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MON = { en_curso: '--green', en_cola: '--purple', esperando: '--yellow', revision: '--orange' };
const monColor = st => MON[st] ? cssVar(MON[st]) : undefined;
const BUB = { esperando: '<span class="bubble" title="Espera tu respuesta">?</span>', en_cola: '<span class="bubble z" title="En cola">…</span>', revision: '<span class="bubble o" title="Lista para tu revisión">!</span>' };

// Diálogos y sonidos temáticos estilo Gather para interactuar con adornos
const LORE_MESSAGES = {
  gonk: { sound: 'gonk', text: '⚡ GNK: "¡Gonk... gonk... gonk!"' },
  coffee: { sound: 'coffee', text: '☕ Caf negro recién servido' },
  holotable: { sound: 'holo', text: '📐 Holoproyector: Esquema táctico activo' },
  vending: { sound: 'vending', text: '🥤 Expendedora: Leche azul bien fría' },
  bookshelf: { sound: 'holo', text: '📜 Archivo: 100,000 textos Jedi catalogados' },
  pillar: { sound: 'holo', text: '🔮 Holocrón iluminado con la Fuerza' },
  whiteboard: { sound: 'notify', text: '📋 Sprint sincronizado en la pizarra' },
  workbench: { sound: 'notify', text: '🔧 Banco de trabajo listo para compilar' },
  server: { sound: 'notify', text: '💻 Servidores en línea sin anomalías' },
  plant: { sound: 'notify', text: '🌿 Ficus regado y oxigenando la estación' },
  crate: { sound: 'notify', text: '📦 Contenedor de piezas beskar sellado' },
};

function handleDecoInteract(target) {
  const key = target.dataset.interact;
  const info = LORE_MESSAGES[key] || { sound: 'notify', text: target.title || 'Detalle de la oficina' };
  beep(info.sound);
  target.classList.remove('interact-pop');
  void target.offsetWidth;
  target.classList.add('interact-pop');
  const existing = target.querySelector('.deco-bubble');
  if (existing) existing.remove();
  const b = document.createElement('span');
  b.className = 'deco-bubble';
  b.textContent = info.text;
  target.appendChild(b);
  setTimeout(() => b.remove(), 2400);
}

// adornos: van en la franja de pared de cada sala; se activan con clic pero no están en el orden de Tab (son decorado)
const deco = ([key, spr, title, cls = '', color = '']) => `<span class="deco-item deco-interactive ${cls}" data-interact="${key}" tabindex="-1" role="button" title="${h(title)}">${sprite(spr, color, 2.4)}</span>`;
const ROOM_DECO = {
  doc: [['bookshelf', 'bookshelf', 'Estantería de holocrones y códices'], ['pillar', 'archive_pillar', 'Pilar de Datacrones'], ['server', 'server', 'Servidor de archivo'], ['whiteboard', 'whiteboard', 'Pizarra de documentación'], ['plant', 'bigplant', 'Planta sagrada del archivo']],
  dev: [['whiteboard', 'whiteboard', 'Pizarra de arquitectura y sprints'], ['holotable', 'holotable', 'Holoproyector de arquitectura', 'deco-holo'], ['server', 'server', 'Cluster de compilación'], ['workbench', 'workbench', 'Banco de herramientas'], ['gonk', 'gonk', 'Droide de energía GNK', 'deco-gonk'], ['crate', 'crate', 'Caja de repuestos']],
  ana: [['holotable', 'holotable', 'Holoproyector táctico de análisis', 'deco-holo'], ['console', 'console', 'Consola de radar', '', '#3ddc84'], ['server', 'server', 'Servidor de telemetría'], ['whiteboard', 'whiteboard', 'Pizarra de análisis'], ['plant', 'bigplant', 'Planta de la sala de mando']],
};
// sala de agentes: planta a la izquierda; café y expendedora a la derecha
const ZONE_DECO = [['plant', 'bigplant', 'Planta de la oficina'], ['coffee', 'coffee', 'Estación de caf'], ['vending', 'vending', 'Expendedora de leche azul']];
const WS_ORDER = ['esperando', 'en_curso', 'en_cola']; // lo que se muestra en el puesto: primero lo que te espera
const WS_TXT = { esperando: 'Espera tu respuesta ·', en_curso: 'Trabajando en', en_cola: 'En cola ·' };
const WS_MON = { esperando: '--yellow', en_curso: '--green', libre: '--holo', sleeping: '--line2' }; // color del monitor
const ROOMS = [['doc', 'Archivo (biblioteca)'], ['dev', 'Hangar (taller)'], ['ana', 'Sala de mando (radar)']];
const NEEDS = ['esperando', 'revision', 'fallida', 'pausada_cuota'];
const agentState = (a, busy) => {
  const sleeping = a.status === 'sin_cuota' || !a.enabled;
  return { sleeping, text: busy.has(a.id) ? 'Trabajando' : sleeping ? (a.enabled ? 'Sin cuota' : 'Apagado') : 'Disponible' };
};

const estacion = {
  refreshOn: ['task.updated', 'task.created', 'conv.updated', 'run.started', 'agent.status', 'council.updated'],
  async render(el) {
    let [tasks, chats, execs, council, perms] = await Promise.all([
      get('/api/tasks'),
      get('/api/conversations'),
      get('/api/history/ejecuciones?page=1').catch(() => ({ rows: [] })),
      get('/api/council').catch(() => []),
      get('/api/inbox').then(x => x.permissions).catch(() => []),
    ]);
    const busy = new Set([...tasks.filter(t => ACTIVE.includes(t.status)).map(t => t.agent_id), ...chats.filter(c => LIVE.includes(c.status)).map(c => c.agent_id)]);
    // filtro de la estación (selector del HUD): "a:<agente>" o "r:<área>"
    const [fk, fid] = (S.stationFilter || '').split(':').map((x, i) => i ? +x : x);
    const vis = tasks.filter(t => (!S.project || t.project_id === S.project) && (!fk || (fk === 'a' ? t.agent_id : t.area_id) === fid));
    if (fk === 'a') chats = chats.filter(c => c.agent_id === fid);
    const desk = t => {
      const a = agent(t.agent_id);
      const who = t.executor === 'humano' ? userSprite(user(t.assignee_user_id), 3.8) : agentSprite(a, 3.8);
      return `<button class="desk ${t.status}" data-task="${t.id}" title="#${t.id} ${h(t.title)} · ${STATUS[t.status]}${a ? ' · ' + h(a.name) : ''}">
        <span class="who">${who}${BUB[t.status] || ''}</span>
        ${sprite('desk', monColor(t.status), 3.2)}
        ${t.status === 'en_curso' ? `<span class="desk-mug">${sprite('mug', '', 1.4)}</span>` : ''}
        <span class="lbl">${h(t.title)}</span>
      </button>`;
    };
    const free = `<span class="desk free" aria-hidden="true"><span class="who"></span>${sprite('desk', '#1d2447', 3.2)}<span class="lbl"></span></span>`;
    // la placa es el botón de la sala (teclado); el resto de la sala también abre al hacer clic
    const plaque = (ic, title, sub, label, extra = '') => `<div class="plaque"><button type="button" class="plaque-btn" aria-label="${h(label)}">${icon(ic, 2.5)}<b>${h(title)}</b></button><small>${h(sub)}</small>${extra}</div>`;
    const room = a => {
      const kind = a.room;
      const at = vis.filter(t => t.area_id === a.id && AT_DESK.includes(t.status));
      const shown = at.slice(0, 6), pend = vis.filter(t => t.area_id === a.id && t.status === 'pendiente').length;
      return `<section class="room2 room-${kind}" data-area="${a.id}" style="--c:${a.color}">
        <div class="room-rug rug-${kind}"></div>
        ${plaque(a.icon, a.alias, a.name, `${a.alias}: ${at.length} en actividad, ${pend} pendientes`, pend ? `<small class="right pend" title="Tareas pendientes">${pend} pend.</small>` : '')}
        <div class="wall">${ROOM_DECO[kind].map(deco).join('')}</div>
        <div class="desks2">${shown.map(desk).join('')}${Array(Math.max(0, 3 - shown.length)).fill(free).join('')}${at.length > 6 ? `<span class="more">+${at.length - 6}</span>` : ''}</div>
      </section>`;
    };
    const live = chats.filter(c => LIVE.includes(c.status));
    const me = S.boot.me;

    // salas fijas arriba según el tipo de sala de cada área (Configuración → Áreas); el resto va a "Más salas"
    const fixedAreas = ROOMS.map(([k]) => S.boot.areas.find(a => a.room === k)).filter(Boolean);
    const otherAreas = S.boot.areas.filter(a => !fixedAreas.includes(a));
    const otherActive = vis.filter(t => otherAreas.some(a => a.id === t.area_id) && AT_DESK.includes(t.status)).length;

    // Sala de agentes: un puesto por agente con qué hace, en qué y cuánta cuota le queda (Cantina y Consejo pasan a «Más salas»)
    const workstation = a => {
      const st = agentState(a, busy), lim = agentLimits(a);
      const mine = tasks.filter(t => t.agent_id === a.id && WS_ORDER.includes(t.status)).sort((x, y) => WS_ORDER.indexOf(x.status) - WS_ORDER.indexOf(y.status));
      const chat = live.find(c => c.agent_id === a.id), t = mine[0];
      const what = t ? `${WS_TXT[t.status]} #${t.id} ${t.title}` : chat ? `En la Cantina · ${chat.title}` : st.sleeping ? (a.enabled ? `Sin cuota${a.quota_reset_at ? ' · vuelve ' + ago(a.quota_reset_at) : ''}` : 'Apagado') : 'Disponible';
      const more = mine.length + (chat && t ? 1 : 0) - 1;
      const state = t?.status === 'esperando' || chat?.status === 'esperando' ? 'esperando' : st.sleeping ? 'sleeping' : busy.has(a.id) ? 'en_curso' : 'libre';
      const pct = lim.fiveHour?.pct;
      return `<button type="button" class="ws ws-${state}" data-agent="${a.id}" title="${h(a.name)} · ${h(what)}">
        <span class="who">${agentSprite(a, 3.8)}${state === 'esperando' ? BUB.esperando : state === 'sleeping' && a.enabled ? '<span class="bubble z" title="Sin cuota">Zz</span>' : ''}</span>
        ${sprite('desk', cssVar(WS_MON[state]), 3.2)}
        <span class="ws-name">${h(a.name)}</span>
        <span class="ws-what">${h(what)}${more > 0 ? ` <em>+${more}</em>` : ''}</span>
        ${pct != null ? `<span class="ws-quota" title="Cuota 5 h: ${pct}%${lim.weekly ? ` · semanal: ${lim.weekly.pct}%` : ''}"><i style="width:${Math.min(100, pct)}%;background:var(${pct >= 90 ? '--red' : pct >= 75 ? '--yellow' : '--green'})"></i></span>`
          : lim.usage5h?.tokens ? `<span class="ws-tok">${kTok(lim.usage5h.tokens)} tok en 5 h</span>` : ''}
      </button>`;
    };
    const myPend = perms.length + vis.filter(t => NEEDS.includes(t.status)).length + chats.filter(c => c.status === 'esperando').length;
    const zone = `<section class="agents-zone" aria-label="Sala de agentes">
      <div class="plaque">${icon('radar', 2.5)}<b>Sala de agentes</b><small>${S.boot.agents.filter(a => busy.has(a.id)).length} de ${S.boot.agents.filter(a => a.enabled).length} trabajando</small>
        <span class="zone-legend" aria-hidden="true">? espera tu respuesta · ! lista para revisión · … en cola · Zz sin cuota</span>
        <button type="button" class="btn sm right" id="btnMoreRooms" title="${h([...otherAreas.map(a => a.alias), 'Cantina', 'Consejo Jedi', 'Puente de Mando', ...(canEdit() ? ['Control del PC'] : []), 'Archivos Jedi'].join(', '))}">Más salas <span class="n">${otherAreas.length + (canEdit() ? 5 : 4)}</span>${otherActive + live.length ? ` · ${otherActive + live.length} activas` : ''}</button></div>
      <div class="ws-row">
        ${deco(ZONE_DECO[0])}
        <button type="button" class="ws ws-me" id="wsMe" title="Tu puesto: abre la Bandeja">
          <span class="who">${userSprite(me, 3.8)}</span>${sprite('desk', cssVar(myPend ? '--orange' : '--holo'), 3.2)}
          <span class="ws-name">${h(me.name.split(' ')[0])} · tú</span><span class="ws-what">${myPend ? `${myPend} por decidir` : 'Nada pendiente'}</span>
        </button>
        ${S.boot.agents.filter(a => a.enabled).map(workstation).join('')}
        ${ZONE_DECO.slice(1).map(deco).join('')}
      </div>
    </section>`;

    // una fila por tarea o chat (su último turno y cuántos hubo); lo que está en curso primero
    const byTarget = new Map();
    for (const r of execs?.rows || []) { const k = r.task_id ? 't' + r.task_id : 'c' + r.conversation_id; if (byTarget.has(k)) byTarget.get(k).n++; else byTarget.set(k, { ...r, n: 1 }); }
    const runsList = [...byTarget.values()].slice(0, 8).sort((x, y) => !y.ended_at - !x.ended_at);
    const RUN_END = { listo: '✓ listo', consulta: '? consulta', abortado: '■ abortado' };
    const runItemHTML = r => {
      const a = agent(r.agent_id);
      const t = tasks.find(x => x.id === r.task_id);
      const targetTitle = t ? `#${t.id} ${t.title}` : (r.task_id ? `Tarea #${r.task_id}` : `Chat #${r.conversation_id}`);
      const isRunning = !r.ended_at;
      const isOk = r.exit_code === 0 || ['listo', 'consulta', 'completado'].includes(r.end_reason);
      const statusDot = isRunning ? '<span class="dot ok blink"></span>' : isOk ? '<span class="dot ok"></span>' : '<span class="dot bad"></span>';
      const statusText = isRunning ? 'en curso' : `${RUN_END[r.end_reason] || `${isOk ? '✓' : '✗'} ${h(String(r.end_reason || (isOk ? 'ok' : 'error')).replace('_', ' '))}`} · ${dur((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000)}`;
      const tok = (r.tokens_in || 0) + (r.tokens_out || 0);
      return `<a class="run-item ${isRunning ? 'running' : ''}" href="${r.task_id ? `#/tarea/${r.task_id}` : `#/cantina/${r.conversation_id}`}">
        <div class="row" style="justify-content:space-between;gap:4px">
          <span class="row" style="gap:5px;font-size:var(--fs-sm);font-weight:600">${agentSprite(a, 1.5)} ${h(a?.name || 'Agente')}</span>
          <span class="run-status ${isOk || isRunning ? '' : 't-red'}">${statusDot} ${statusText}</span>
        </div>
        <div class="run-desc ellipsis" title="${h(targetTitle)}">${h(targetTitle)}${r.n > 1 ? ` · ${r.n} turnos` : ''}</div>
        <div class="run-meta row" style="justify-content:space-between"><span>${h(r.model || '')}</span><span>${tok ? kTok(tok) + ' tok · ' : ''}${r.cost_usd ? '$' + r.cost_usd.toFixed(2) + ' · ' : ''}${ago(r.started_at)}</span></div>
      </a>`;
    };
    // visible salvo que el usuario lo oculte: lleva también Repositorios, que importa aunque no haya ejecuciones
    const sideHidden = localStorage.getItem('ov_station_aside') === '0';

    // lo que espera al humano, en la barra superior (siempre a la vista): permisos primero, con su acción directa
    const att = (link, st, label, title, actions = '') => `<span class="att-item st-${st}"><a href="${link}" title="${h(title)}"><em>${label}</em>${h(title)}</a>${canEdit() ? actions : ''}</span>`;
    const needs = [
      ...perms.map(p => att(p.task_id ? `#/tarea/${p.task_id}` : `#/cantina/${p.conv_id}`, 'fallida', 'Permiso',
        p.task_id ? `#${p.task_id} ${tasks.find(t => t.id === p.task_id)?.title || ''}` : chats.find(c => c.id === p.conv_id)?.title || 'Chat',
        `<button type="button" class="att-btn" data-perm="${h(p.request_id)}" data-allow="1" title="Aprobar el permiso">✔</button><button type="button" class="att-btn" data-perm="${h(p.request_id)}" data-allow="0" title="Denegar el permiso">✕</button>`)),
      ...vis.filter(t => NEEDS.includes(t.status)).map(t => att(`#/tarea/${t.id}`, t.status, STATUS[t.status], `#${t.id} ${t.title}`,
        t.status === 'revision' ? `<button type="button" class="att-btn" data-att-approve="${t.id}" title="Aprobar #${t.id}">✔ Aprobar</button>` : '')),
      ...chats.filter(c => c.status === 'esperando').map(c => att(`#/cantina/${c.id}`, 'esperando', STATUS.esperando, c.title)),
    ];
    const slot = $('#hudAtt');
    if (slot) {
      slot.innerHTML = needs.length ? `<nav class="attention" aria-label="Necesita atención"><b>Necesita atención</b>${needs.join('')}</nav>` : '';
      slot.onclick = e => { const b = e.target.closest('[data-att-approve]'); if (b) get('/api/tasks/' + b.dataset.attApprove).then(x => approveDialog(x.task), fail); };
    }

    const kbHidden = localStorage.getItem('ov_station_kanban') === '0';
    const cols = COLS.map(([k, l]) => [k, l, vis.filter(t => k === 'atascadas' ? STUCK.includes(t.status) : t.status === k).sort((a, b) => a.kanban_order - b.kanban_order)]);
    el.innerHTML = `<div class="station-layout">
      <div class="station-top-row">
        <div class="station-main">
          <div class="floor">
            <div class="wing wing-top">${fixedAreas.map(room).join('')}</div>
            ${zone}
          </div>
        </div>
        <aside class="station-aside" id="stationAside" ${sideHidden ? 'hidden' : ''} aria-label="Repositorios y últimas ejecuciones">
          <section class="repo-box" id="repoBox" aria-label="Repositorios">
            <div class="station-aside-head"><b class="aside-title">${ic('branch', 'sm')} Repositorios</b><button type="button" class="btn sm ghost" id="repoFetch" title="Traer el estado del remoto (git fetch)">⟳</button></div>
            <div class="repo-body" id="repoBody">${reposCache.key === (S.project || 0) && reposCache.html || '<div class="empty" style="padding:10px;font-size:var(--fs-xs)">Cargando…</div>'}</div>
          </section>
          <div class="station-aside-head">
            <b class="aside-title"><span class="dot ok"></span> Ejecuciones</b>
            <div class="row" style="gap:4px">
              <a href="#/archivos/ejecuciones" class="btn sm ghost">Historial</a>
              <button type="button" class="btn sm ghost" id="hideSideBtn" aria-label="Ocultar repositorios y ejecuciones">✕</button>
            </div>
          </div>
          <div class="station-aside-body">${runsList.map(runItemHTML).join('') || '<div class="empty" style="padding:14px">Sin ejecuciones recientes</div>'}</div>
        </aside>
        <button type="button" class="station-tab-btn" id="openSideBtn" ${sideHidden ? '' : 'hidden'} title="Ver repositorios y últimas ejecuciones">${ic('branch', 'sm')} <span>Repos y ejecuciones</span>${runsList.some(r => !r.ended_at) ? '<span class="dot ok blink"></span>' : ''}</button>
      </div>

      <section class="station-kanban-box ${kbHidden ? 'collapsed' : ''}" id="stationKanban" aria-label="Tablero Kanban de tareas">
        <div class="station-kanban-head">
          <div class="row" style="gap:8px">
            <b class="aside-title">Tablero</b>
            <span class="chip">${vis.length} tareas</span>
            ${S.project ? `<span class="chip" style="border-color:${h(project(S.project)?.color)}">${h(project(S.project)?.name)}</span>` : ''}
          </div>
          <div class="row" style="gap:6px">
            <a class="btn sm ghost" href="#/kanban/${S.project || 'todos'}">Tablero completo ↗</a>
            <button type="button" class="btn sm ghost" id="toggleKanbanBtn" aria-expanded="${!kbHidden}">${kbHidden ? '▲ Mostrar' : '▼ Ocultar'}</button>
          </div>
        </div>
        ${kTabs(cols)}
        <div class="kanban" id="skGrid">
          ${cols.map(([k, l, list]) => {
            // completadas: solo las 5 más recientes; el resto en el tablero completo
            const cut = k === 'completada' && list.length > 5;
            const shown = cut ? [...list].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 5) : list;
            return kcolHTML(k, l, list.length, shown.map(t => kanbanCard(t, !S.project)).join('') + (cut ? `<a class="btn sm ghost" href="#/kanban/${S.project || 'todos'}">Ver las ${list.length} ↗</a>` : ''));
          }).join('')}
        </div>
      </section>
    </div>`;

    bindKanbanDrag(el, vis);
    loadRepos(el, false, true);

    el.onclick = e => {
      if (e.target.closest('.kmove')) return;
      if (repoClick(e, el)) return;
      const tk = e.target.closest('#toggleKanbanBtn');
      if (tk) {
        const isCollapsed = $('#stationKanban', el).classList.toggle('collapsed');
        localStorage.setItem('ov_station_kanban', isCollapsed ? '0' : '1');
        tk.textContent = isCollapsed ? '▲ Mostrar' : '▼ Ocultar';
        tk.setAttribute('aria-expanded', !isCollapsed);
        return;
      }
      const side = e.target.closest('#hideSideBtn,#openSideBtn');
      if (side) {
        const show = side.id === 'openSideBtn';
        localStorage.setItem('ov_station_aside', show ? '1' : '0');
        $('#stationAside', el).hidden = !show;
        $('#openSideBtn', el).hidden = show;
        return;
      }
      if (e.target.closest('#btnMoreRooms')) return otherRoomsModal(vis, busy, otherAreas, live, council[0]);
      if (e.target.closest('#wsMe')) return $('#bellBtn')?.click();
      const di = e.target.closest('.deco-interactive');
      if (di) { e.stopPropagation(); return handleDecoInteract(di); }
      const ag = e.target.closest('[data-agent]'); if (ag) return agentCard(agent(ag.dataset.agent), tasks, busy);
      const kc = e.target.closest('.kcard');
      if (kc) return go('#/tarea/' + kc.dataset.id);
      const d = e.target.closest('[data-task]'); if (d) return go('#/tarea/' + d.dataset.task);
      const r = e.target.closest('[data-area]'); if (r) roomModal(+r.dataset.area, vis);
    };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('.kcard')) e.target.click(); };
  },
};

// ---------- Repositorios: estado de la rama base y de las ramas de cada tarea ----------
// se carga aparte del mapa: consulta git en la máquina y puede tardar
// lazy: lo pide el refresco del mapa (cada evento); se pinta del caché y git se consulta como mucho cada 30 s
async function loadRepos(el, fetch = false, lazy = false) {
  if (!$('#repoBox', el)) return;
  const key = S.project || 0;
  if (lazy && reposCache.key === key && Date.now() - reposCache.at < 30000) return;
  if (fetch) $('#repoBody', el).innerHTML = '<div class="empty" style="padding:10px">Consultando remoto…</div>';
  const repos = await get(`/api/repos?fetch=${fetch ? 1 : 0}${S.project ? '&project_id=' + S.project : ''}`).catch(e => [{ folder: {}, error: e.message }]);
  for (const x of repos) REPOS.set(x.folder.id, x);
  const html = repos.map(repoHTML).join('') || `<div class="empty" style="padding:10px;font-size:var(--fs-xs)">${S.project ? 'Este proyecto no tiene carpetas git.' : 'Ningún proyecto tiene carpetas git.'} Agrégalas en Proyecto → Carpetas.</div>`;
  if (key !== (S.project || 0)) return; // cambió el proyecto mientras consultaba
  reposCache = { key, at: Date.now(), html };
  const body = $('#repoBody', el); // el mapa pudo redibujarse mientras tanto
  if (body) body.innerHTML = html;
}
const REPOS = new Map(); // último estado de cada carpeta, para el análisis
let reposCache = { key: null, at: 0, html: '' };
// botones de Repositorios, en el mapa y en el panel #/repos; true si el clic era suyo
function repoClick(e, el) {
  const q = s => e.target.closest(s), reload = () => loadRepos(el);
  let b;
  if (q('#repoFetch')) loadRepos(el, true);
  else if ((b = q('[data-mergeall]'))) mergeAll(REPOS.get(+b.dataset.mergeall), reload);
  else if ((b = q('[data-analyze]'))) analyzeRepo(REPOS.get(+b.dataset.analyze), reload);
  else if ((b = q('[data-merge]'))) get('/api/tasks/' + b.dataset.merge).then(x => approveDialog(x.task), fail);
  else if ((b = q('[data-push]'))) act(() => post(`/api/folders/${b.dataset.push}/push`), 'Push hecho').then(reload, () => {});
  else if ((b = q('[data-deploy]'))) deployRepo(b.dataset.deploy, b.dataset.name, b.dataset.target).then(reload);
  else return false;
  return true;
}
// estado que escriben hooks/plugins (IJFW, Serena, Claude…): no es código del proyecto
const NOISE = /^\.(ijfw|serena|claude|commandcode|omc|sisyphus|codex|oficina|vscode)\//;
const repoName = f => `${f.project_name || ''}${f.label ? ' · ' + f.label : ''}`;
function repoHTML(x) {
  const f = x.folder, name = repoName(f);
  if (x.error) return `<div class="repo"><b class="ellipsis">${h(name)}</b><small class="t-red">${h(x.error)}</small></div>`;
  // archivos que tocan varias ramas pendientes: se fusionan bien si git no marca choque, pero conviene revisarlos juntos
  const byFile = {};
  for (const b of x.branches) for (const p of b.files || []) (byFile[p] ||= []).push(b.task_id);
  const br = x.branches.map(b => {
    const shared = [...new Set((b.files || []).flatMap(p => byFile[p].filter(id => id !== b.task_id)))];
    const st = b.missing ? '<span class="muted">rama borrada</span>'
      : !b.ahead ? '<span class="muted">ya integrada</span>'
      : b.conflicts.length ? `<span class="t-red" title="${h(b.conflicts.join('\n'))}">⚠ choca (${b.conflicts.length})</span>`
      : '<span class="t-green">✔ fusionable</span>';
    return `<div class="repo-br">
      <a href="#/tarea/${b.task_id}" class="ellipsis" title="${h(b.branch)}">#${b.task_id} ${h(b.title)}</a>
      <div class="run-meta">${STATUS[b.status] || h(b.status)} · ${b.ahead || 0} commits · ${(b.files || []).length} arch · ${st}${b.behind ? ` · ${b.behind} atrás` : ''}${shared.length ? ` · <span class="t-orange" title="Tocan los mismos archivos">↔ #${shared.join(', #')}</span>` : ''}</div>
      ${canEdit() && b.ahead && ['revision', 'esperando'].includes(b.status) ? `<button type="button" class="btn sm g" data-merge="${b.task_id}">Aprobar y fusionar</button>` : ''}
    </div>`;
  }).join('');
  const sync = x.upstream ? `↑${x.ahead} ↓${x.behind}` : 'sin remoto';
  const dirty = x.changes?.filter(c => !NOISE.test(c.file)).length;
  const local = !x.changes?.length ? 'limpio'
    : `<button type="button" class="btn sm ${dirty ? 'warn' : 'ghost'}" data-analyze="${f.id}" title="Ver qué es y qué hacer">${dirty ? `${dirty} sin commit` : 'solo ruido de herramientas'} · revisar</button>`;
  const ld = x.last_deploy, ldOk = ld && JSON.parse(ld.detail || '{}').ok;
  return `<div class="repo" style="border-left:3px solid ${h(f.color || 'var(--line)')}">
    <div class="row" style="justify-content:space-between;gap:4px"><b class="ellipsis" title="${h(f.path)}">${h(name)}</b><code title="${h(x.log.join('\n'))}">${h(x.head)}</code></div>
    <div class="repo-kv"><span>Remoto</span><b>${sync}</b><span>Local</span><b>${local}</b><span>Ramas</span><b>${x.branches.filter(b => b.ahead).length} pendientes</b>
      ${x.deploy ? `<span>Destino</span><b>${h(x.deploy.target)}${ld ? `<br><small style="color:var(${ldOk ? '--muted' : '--red'})">${ldOk ? '✓' : '✗'} último despliegue ${ago(ld.at)}</small>` : ''}</b>` : ''}</div>
    ${br}
    ${canEdit() ? `<div class="row" style="gap:4px">
      ${(n => n ? `<button type="button" class="btn sm g" data-mergeall="${f.id}" data-n="${n}" title="Aprueba y fusiona todas las tareas en revisión, de la más antigua a la más nueva">⇉ Fusionar listas (${n})</button>` : '')(x.branches.filter(b => b.status === 'revision').length)}
      ${x.upstream ? `<button type="button" class="btn sm" data-push="${f.id}" title="git pull --no-rebase + push de ${h(x.head)}: nunca pisa lo remoto">⇅ Push${x.ahead ? ` (${x.ahead})` : ''}</button>` : ''}
      ${x.deploy ? `<button type="button" class="btn sm warn" data-deploy="${f.id}" data-name="${h(name)}" data-target="${h(x.deploy.target)}" title="Desplegar en ${h(x.deploy.target)}">${ic('rocket', 'sm')} Desplegar</button>` : '<small class="muted" title="Agrega el repo en &quot;deploy&quot; de worker.json">sin despliegue configurado</small>'}
    </div>` : ''}
  </div>`;
}
// cambios hechos directo en la carpeta base: fuera de toda rama de tarea, no se suben ni despliegan sin commit
function analyzeRepo(x, reload) {
  const real = x.changes.filter(c => !NOISE.test(c.file)), noise = x.changes.filter(c => NOISE.test(c.file));
  const ST = { M: 'modificado', D: 'borrado', '??': 'nuevo', A: 'agregado', R: 'renombrado' };
  const also = file => x.branches.filter(b => b.ahead && b.files?.includes(file)).map(b => '#' + b.task_id);
  const clash = real.filter(c => also(c.file).length);
  const d = modal(`<h2>Cambios sin commit · ${h(repoName(x.folder))}</h2>
    <p class="muted">Son cambios hechos <b>directo en la carpeta base</b> (${h(x.head)}), fuera de las ramas de las tareas: por ti, un chat de la Cantina en modo Editar o una herramienta. Mientras no tengan commit, <b>Push no se hace</b> y <b>no se despliegan</b>.</p>
    ${clash.length ? `<p class="t-orange">⚠ ${clash.length} también los cambia una tarea pendiente. Haz commit primero: al fusionar esa tarea git combina ambos cambios (o crea una tarea para resolver el choque). Sin commit, git se niega a fusionar para no pisarlos.</p>` : ''}
    ${real.length ? `<div class="table-wrap"><table class="grid"><tr><th></th><th>Archivo</th><th>Estado</th><th>Tareas</th></tr>
      ${real.map(c => `<tr><td><input type="checkbox" name="f" value="${h(c.file)}" checked aria-label="Incluir ${h(c.file)}"></td><td><code>${h(c.file)}</code></td><td>${ST[c.st] || h(c.st)}</td><td>${also(c.file).join(', ') || '—'}</td></tr>`).join('')}</table></div>
      ${canEdit() ? `<label class="l">Mensaje del commit</label><input name="message" value="cambios directos en ${h(x.head)}">
      <div class="row" style="margin-top:10px"><button class="btn g" id="rcOk">Commit de los marcados</button><button class="btn ghost" value="c">Cerrar</button></div>` : ''}`
    : '<p>No hay cambios de código.</p>'}
    ${noise.length ? `<details style="margin-top:10px"><summary class="muted">${noise.length} archivos de herramientas (.ijfw, .claude…): no son código, se ignoran</summary><small><code>${noise.map(c => h(c.st + ' ' + c.file)).join('<br>')}</code></small></details>` : ''}
    ${!real.length || !canEdit() ? '<button class="btn ghost" value="c" style="margin-top:10px">Cerrar</button>' : ''}`);
  const ok = $('#rcOk', d);
  if (ok) ok.onclick = async e => {
    e.preventDefault();
    const files = $$('input[name=f]:checked', d).map(i => i.value);
    try { const r = await post(`/api/folders/${x.folder.id}/commit`, { files, message: $('input[name=message]', d).value }); closeModal(); holo('Commit hecho', r.head); reload(); } catch (err) { fail(err); }
  };
}
async function mergeAll(x, reload) {
  const list = x.branches.filter(b => b.status === 'revision');
  if (!await confirmBox(`¿Aprobar y fusionar en ${x.head} las tareas ${list.map(b => '#' + b.task_id).join(', ')}?`, 'Fusionar')) return;
  holo('Fusionando…', repoName(x.folder), { ms: 4000 });
  try {
    const r = await post(`/api/folders/${x.folder.id}/merge-all`);
    modal(`<h2>⇉ Fusión de ${h(repoName(x.folder))}</h2>
      ${r.map(t => `<div class="kv"><b><a href="#/tarea/${t.id}">#${t.id} ${h(t.title)}</a></b><span style="color:var(${t.ok ? '--green' : '--red'})">${t.ok ? '✔ fusionada' : h(t.error)}</span></div>`).join('') || '<p>No había tareas en revisión.</p>'}
      <button class="btn ghost" value="c" style="margin-top:10px">Cerrar</button>`);
    refreshSoon(0); reload();
  } catch (e) { fail(e); }
}
async function deployRepo(id, name, target) {
  if (!await confirmBox(`¿Desplegar ${name} en ${target}? Se despliega la rama base tal como está en la carpeta (haz push antes si corresponde).`, 'Desplegar', true)) return;
  holo('Desplegando…', name, { ms: 4000 });
  try {
    const r = await post(`/api/folders/${id}/deploy`);
    modal(`<h2>${r.ok ? '✔ Despliegue terminado' : '✖ Despliegue falló'}</h2><small>${h(name)}</small><div class="console" style="height:300px">${h(r.output)}</div><button class="btn ghost" value="c">Cerrar</button>`);
  } catch (e) { fail(e); }
}

// ficha rápida del agente (en móvil no hay hover para ver estado y cuota)
function agentCard(a, tasks, busy) {
  const st = agentState(a, busy), lim = agentLimits(a);
  const mine = tasks.filter(t => t.agent_id === a.id && AT_DESK.includes(t.status));
  const win = (l, w) => w ? `<div class="kv"><b>${l}</b><span>${w.pct}%${w.resets_at ? ' · reinicia ' + ago(w.resets_at) : ''}</span></div>` : '';
  const d = modal(`<div class="agent-head" style="--c:${h(a.color)}">${agentSprite(a, 6)}<div><h2 style="margin:0">${h(a.name)}</h2>
      <span class="chip ${st.sleeping ? 'st-fallida' : busy.has(a.id) ? 'st-en_curso' : 'st-completada'}">${st.text}</span> <small class="muted">${h(a.default_model || '')}</small></div></div>
    ${win('Límite 5 horas', lim.fiveHour)}${win('Límite semanal', lim.weekly)}${!lim.fiveHour && !lim.weekly ? '<p class="muted">El CLI no informa límites de uso.</p>' : ''}
    <h3>En su escritorio (${mine.length})</h3>
    ${mine.map(t => `<button type="button" class="room-link" data-t="${t.id}">${chip(t.status)}<span class="ellipsis">#${t.id} ${h(t.title)}</span></button>`).join('') || '<p class="muted">Sin tareas activas.</p>'}
    <div class="row" style="margin-top:14px">${canEdit() && a.enabled ? '<button class="btn y" id="acNew">+ Asignarle una tarea</button>' : ''}<a class="btn ghost" href="#/puente" data-close>Puente de Mando</a><button class="btn ghost" value="c">Cerrar</button></div>`);
  $$('[data-t]', d).forEach(b => b.onclick = e => { e.preventDefault(); closeModal(); go('#/tarea/' + b.dataset.t); });
  $('#acNew', d)?.addEventListener('click', e => { e.preventDefault(); closeModal(); taskForm({ agent_id: a.id }); });
}

function otherRoomsModal(vis, busy, otherAreas, live, lastCouncil) {
  const lamp = a => cssVar(a.status === 'sin_cuota' ? '--red' : !a.enabled ? '--line2' : busy.has(a.id) ? '--green' : '--holo');
  const card = (attrs, c, ic, title, sub, body) => `<button type="button" class="more-room-card" ${attrs} style="--c:${c}"><div class="card-head">${icon(ic, 3)}<div><b>${h(title)}</b><br><small class="muted">${h(sub)}</small></div></div>${body}</button>`;
  const d = modal(`<h2>Más salas de la estación</h2>
    <div class="more-rooms-grid">
      ${otherAreas.map(a => {
        const at = vis.filter(t => t.area_id === a.id && AT_DESK.includes(t.status)).length;
        const pend = vis.filter(t => t.area_id === a.id && t.status === 'pendiente').length;
        return card(`data-area-modal="${a.id}"`, a.color, a.icon, a.alias, a.name, `<div class="card-meta"><b>${at}</b> en actividad · <b>${pend}</b> pendientes</div>`);
      }).join('')}
      ${card('data-go-modal="#/cantina"', '#ffe81f', 'cantina', 'Cantina', 'Consultas rápidas', `<div class="card-meta">${live.length ? `<b>${live.length}</b> consultas activas: ${live.map(c => h(c.title)).slice(0, 2).join(', ')}` : 'Nadie en la barra'}</div>`)}
      ${card('data-go-modal="#/consejo"', '#b98cff', 'holocron', 'Consejo Jedi', 'Propuestas de mejora', `<div class="card-meta">${lastCouncil ? `Última sesión ${ago(lastCouncil.at)} · ${lastCouncil.aceptadas}/${lastCouncil.propuestas} aceptadas` : 'Aún no se ha reunido'}</div>`)}
      ${card('data-go-modal="#/puente"', '#4fc3f7', 'radar', 'Puente de Mando', 'Estado y límites de agentes', `<div class="consoles">${S.boot.agents.map(a => `<span title="${h(a.name)}">${sprite('console', lamp(a), 2.5)}</span>`).join('')}</div>`)}
      ${canEdit() ? card('data-go-modal="#/pc"', '#00e5ff', 'radar', 'Control del PC', 'zer0 en tiempo real', '<div class="card-meta">Sesión paso a paso, capturas y aprobación remota.</div>') : ''}
      ${card('data-go-modal="#/archivos"', '#8c97c9', 'holocron', 'Archivos Jedi', 'Historial y ejecuciones', '<div class="card-meta">Chats, tareas, ejecuciones, relevos y bitácora.</div>')}
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost" value="c">Cerrar</button></div>`);
  $$('[data-area-modal]', d).forEach(b => b.onclick = e => { e.preventDefault(); closeModal(); roomModal(+b.dataset.areaModal, vis); });
  $$('[data-go-modal]', d).forEach(b => b.onclick = e => { e.preventDefault(); closeModal(); go(b.dataset.goModal); });
}
function roomModal(areaId, tasks) {
  const a = area(areaId);
  const list = tasks.filter(t => t.area_id === areaId && t.status !== 'completada');
  const d = modal(`<div class="row">${icon(a.icon, 4)}<h2 style="margin:0">${h(a.alias)} · ${h(a.name)}</h2></div>
    <table class="grid" style="margin-top:10px"><tr><th>#</th><th>Tarea</th><th>Estado</th><th>Agente</th></tr>
    ${list.map(t => `<tr class="click" data-t="${t.id}"><td>${t.id}</td><td>${h(t.title)}<br><small>${h(project(t.project_id)?.name || '')}</small></td><td>${chip(t.status)}</td><td>${t.executor === 'humano' ? userChip(t.assignee_user_id) : agentChip(t.agent_id)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin tareas abiertas</td></tr>'}</table>
    <div class="row" style="margin-top:12px">${canEdit() ? '<button class="btn y" id="rmNew">+ Tarea en esta área</button>' : ''}<button class="btn ghost" value="c">Cerrar</button></div>`);
  $$('[data-t]', d).forEach(r => r.onclick = () => { closeModal(); go('#/tarea/' + r.dataset.t); });
  $('#rmNew', d)?.addEventListener('click', e => { e.preventDefault(); closeModal(); taskForm({}, { area_id: areaId }); });
}

// ===================== PROYECTOS =====================
const proyectos = {
  refreshOn: ['task.updated', 'task.created'],
  async render(el) {
    await loadBoot();
    const f = S.projFilter ||= { status: '', q: '' };
    const list = S.boot.projects.filter(p => (!f.status || p.status === f.status) && (!f.q || (p.name + ' ' + (p.code || '') + ' ' + p.description).toLowerCase().includes(f.q.toLowerCase())));
    el.innerHTML = `<div class="row"><h1 style="margin:0">Proyectos</h1><span class="right">${canEdit() ? '<button class="btn y" id="np">+ Proyecto</button>' : ''}</span></div>
      <div class="row" style="margin:12px 0"><select id="pfSt" style="width:auto">${opts(Object.entries(PSTATUS), f.status, 'Todos los estados')}</select><input id="pfQ" placeholder="Buscar proyecto" value="${h(f.q)}" style="max-width:280px"></div>
      <div class="panel table-wrap"><table class="grid"><tr><th>Código</th><th>Proyecto</th><th>Tipo</th><th>Estado</th><th>Carpetas</th><th>Avance</th><th>Tareas</th><th>Agentes</th><th>Actividad</th><th></th></tr>
      ${list.map(p => `<tr class="click" data-p="${p.id}"><td><span style="color:${h(p.color)}">■</span> ${h(p.code || '-')}</td><td><b><a href="#/kanban/${p.id}">${h(p.name)}</a></b><br><small>${h(p.description).slice(0, 80)}</small></td>
        <td>${p.kind === 'con_carpetas' ? `${ic('folder', 'sm')} carpetas` : `${ic('note', 'sm')} registro`}</td><td>${chip(p.status === 'activo' ? 'en_curso' : p.status === 'completado' ? 'completada' : p.status === 'pausado' ? 'esperando' : 'pendiente', PSTATUS[p.status])}</td>
        <td>${p.folders.map(x => `<span class="chip" title="${h(x.path)}">${h(x.label)}${x.is_git ? ' (git)' : ''}</span>`).join(' ') || '<small class="muted">—</small>'}</td>
        <td>${saber(p.progress, p.color)}<small>${p.progress}% (${p.counts.completada || 0}/${p.total})</small></td>
        <td>${['en_curso', 'esperando', 'revision', 'fallida'].filter(s => p.counts[s]).map(s => chip(s, `${STATUS[s]} ${p.counts[s]}`)).join(' ') || '<small class="muted">—</small>'}</td>
        <td>${p.agents.map(id => agentSprite(agent(id), 2)).join('')}</td><td><small>${ago(p.last_activity || p.updated_at)}</small></td>
        <td class="row" style="flex-wrap:nowrap">${canEdit() ? `<button class="btn sm ghost" data-edit="${p.id}">Editar</button>` : ''}<button class="btn sm" data-ficha="${p.id}">Ficha</button></td></tr>`).join('') || '<tr><td colspan="10" class="empty">No hay proyectos. Crea el primero.</td></tr>'}
      </table></div>`;
    $('#np', el)?.addEventListener('click', () => projectForm());
    $('#pfSt', el).onchange = e => { f.status = e.target.value; route(true); };
    $('#pfQ', el).oninput = e => { f.q = e.target.value; clearTimeout(S.pq); S.pq = setTimeout(() => route(true), 300); };
    el.onclick = e => {
      const ed = e.target.closest('[data-edit]'); if (ed) return projectForm(project(ed.dataset.edit));
      const fi = e.target.closest('[data-ficha]'); if (fi) return projectCard(+fi.dataset.ficha);
      const r = e.target.closest('[data-p]'); if (r) { setProject(+r.dataset.p); go('#/kanban/' + r.dataset.p); }
    };
  },
};
function folderRow(f, i) {
  return `<div class="panel" style="padding:8px;margin:6px 0" data-fi="${i}"><div class="field-row">
    <div><label class="l">Etiqueta</label><input data-k="label" value="${h(f.label || '')}" placeholder="backend"></div>
    ${f.id ? `<div><label class="l">Máquina</label><span class="chip">${h(machineName(f.machine_id || defaultMachine()))}</span></div>` : machineSel('data-k="machine_id"', f.machine_id)}
    <div style="grid-column:span 2"><label class="l">Ruta</label><div class="row" style="flex-wrap:nowrap"><input data-k="path" value="${h(f.path || '')}" placeholder="C:\\proyectos\\mi-app" ${f.id ? 'disabled' : ''}>${f.id ? '' : '<button class="btn sm" data-browse>Examinar</button>'}</div></div></div>
    <div class="row"><label class="row" style="font-size:var(--fs-md)"><input type="checkbox" data-k="use_worktrees" ${f.use_worktrees !== 0 ? 'checked' : ''}> worktree por tarea (git)</label>
    <label class="row" style="font-size:var(--fs-md)"><input type="radio" name="isdef" data-k="is_default" ${f.is_default ? 'checked' : ''}> por defecto</label>
    ${f.id ? `<span class="chip">${f.is_git ? 'git' : 'sin git'}</span>` : ''}<button class="btn sm r right" data-rmf="${i}">Quitar</button></div></div>`;
}
function projectForm(p = null) {
  const folders = p ? p.folders.map(f => ({ ...f })) : [];
  const d = modal(`<h2>${p ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
    <div class="field-row"><div><label class="l">Nombre</label><input name="name" required value="${h(p?.name || '')}"></div><div><label class="l">Código</label><input name="code" value="${h(p?.code || '')}" placeholder="SIJ"></div>
    <div><label class="l">Estado</label><select name="status">${opts(Object.entries(PSTATUS), p?.status || 'planificacion')}</select></div><div><label class="l">Color</label><input type="color" name="color" value="${h(p?.color || '#ffe81f')}" style="height:40px"></div></div>
    <label class="l">Descripción</label><textarea name="description" rows="2">${h(p?.description || '')}</textarea>
    <label class="l">Briefing (instrucciones que reciben todos los agentes en este proyecto)</label><textarea name="briefing" rows="3">${h(p?.briefing || '')}</textarea>
    <h3>Carpetas locales <small class="muted">(opcional: sin carpetas es un proyecto solo de registro)</small></h3><div id="fl"></div>
    <button class="btn sm" id="addF">+ Carpeta</button>
    <div class="row" style="margin-top:14px"><button class="btn y" id="pSave">Guardar</button>${p ? '<button class="btn r" id="pDel">Eliminar</button>' : ''}<button class="btn ghost" value="c" formnovalidate>Cancelar</button></div>`);
  const draw = () => { $('#fl', d).innerHTML = folders.map(folderRow).join('') || '<p class="muted">Sin carpetas: proyecto de registro (las tareas de agente corren en un sandbox).</p>'; };
  draw();
  const read = () => $$('[data-fi]', d).forEach(r => { const f = folders[+r.dataset.fi]; for (const i of $$('[data-k]', r)) f[i.dataset.k] = i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value; });
  $('#addF', d).onclick = e => { e.preventDefault(); read(); folders.push({ use_worktrees: 1, is_default: !folders.length }); draw(); };
  d.onclick = async e => {
    const b = e.target.closest('[data-browse]'); if (b) { e.preventDefault(); const row = b.closest('[data-fi]'); return browseInto($('[data-k=path]', row), $('[data-k=machine_id]', row)?.value); }
    const rm = e.target.closest('[data-rmf]'); if (rm) {
      e.preventDefault(); read(); const f = folders[+rm.dataset.rmf];
      if (f.id) { if (!await confirmBox(`¿Quitar la carpeta ${f.label}?`, 'Quitar', true)) return projectForm(p); await del('/api/folders/' + f.id).catch(fail); await loadBoot(); return projectForm(project(p.id)); }
      folders.splice(+rm.dataset.rmf, 1); draw();
    }
  };
  $('#pSave', d).onclick = async e => {
    e.preventDefault(); read();
    const b = formData(d); delete b.isdef;
    if (!b.name.trim()) return fail('Falta el nombre');
    try {
      if (p) {
        await put('/api/projects/' + p.id, b);
        for (const f of folders) {
          if (f.id) await put('/api/folders/' + f.id, { label: f.label, use_worktrees: f.use_worktrees, is_default: f.is_default });
          else if (f.path) await post(`/api/projects/${p.id}/folders`, f);
        }
      } else {
        const r = await post('/api/projects', { ...b, folders: folders.filter(f => f.path) });
        S.project = r.id; localStorage.setItem('ov_project', r.id);
      }
      closeModal(); await loadBoot(); location.reload();
    } catch (err) { fail(err); }
  };
  $('#pDel', d)?.addEventListener('click', async e => { e.preventDefault(); if (await confirmBox(`¿Enviar "${p.name}" a la papelera?`, 'Eliminar', true)) { await del('/api/projects/' + p.id).catch(fail); await loadBoot(); location.reload(); } });
}
async function projectCard(pid) {
  const p = project(pid);
  const [tasks, runs, acts] = await Promise.all([get('/api/tasks?project_id=' + pid), get('/api/history/ejecuciones?project_id=' + pid), get('/api/history/bitacora')]);
  const byAgent = {};
  for (const r of runs.rows) { const x = byAgent[r.agent_id] ||= { n: 0, ok: 0, t: 0, tk: 0, usd: 0 }; x.n++; if (['listo', 'consulta'].includes(r.end_reason)) x.ok++; if (r.ended_at) x.t += (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000; x.tk += r.tokens_in + r.tokens_out; x.usd += r.cost_usd; }
  modal(`<h2>${h(p.name)} ${chip('pendiente', PSTATUS[p.status])}</h2><p>${h(p.description)}</p>
    ${p.briefing ? `<h3>Briefing</h3><div class="panel">${md(p.briefing)}</div>` : ''}
    <h3>Carpetas</h3>${p.folders.map(f => `<div><b>${h(f.label)}</b> <code>${h(f.path)}</code> ${f.is_git ? '(git)' : ''}</div>`).join('') || '<small class="muted">Proyecto de registro</small>'}
    <h3>Avance</h3>${saber(p.progress, p.color)} ${p.progress}% · ${tasks.length} tareas · ${Object.entries(p.counts).map(([s, n]) => chip(s, `${STATUS[s]} ${n}`)).join(' ')}
    <h3>Métricas por agente (últimas ${runs.total} ejecuciones)</h3><table class="grid"><tr><th>Agente</th><th>Runs</th><th>Éxito</th><th>Duración media</th><th>Tokens</th><th>Costo</th></tr>
    ${Object.entries(byAgent).map(([id, x]) => `<tr><td>${agentChip(id)}</td><td>${x.n}</td><td>${Math.round(x.ok / x.n * 100)}%</td><td>${dur(x.t / x.n)}</td><td>${num(x.tk)}</td><td>$${x.usd.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin ejecuciones</td></tr>'}</table>
    <h3>Bitácora reciente</h3>${acts.rows.filter(a => (a.entity === 'proyecto' && a.entity_id === pid) || (a.entity === 'tarea' && tasks.some(t => t.id === a.entity_id))).slice(0, 15).map(a => `<div><small>${fmtDate(a.at)}</small> ${h(a.user || 'sistema')} · ${h(a.entity)} #${a.entity_id} ${h(a.action)}</div>`).join('') || '<small class="muted">—</small>'}
    <div class="row" style="margin-top:12px"><a class="btn y" href="#/kanban/${pid}" data-close>Abrir kanban</a><a class="btn" href="#/consejo?project=${pid}" data-close>Convocar consejo</a><button class="btn ghost" value="c">Cerrar</button></div>`);
}

// ===================== KANBAN =====================
const kanban = {
  refreshOn: ['task.updated', 'task.created', 'agent.status'],
  async render(el, r) {
    // #/kanban/todos = todos los proyectos; sin argumento usa el proyecto actual (vacío = todos)
    let pid = r.args[0] === 'todos' ? null : +r.args[0] || S.project;
    if (pid && !project(pid)) pid = null;
    setProject(pid);
    const p = project(pid);
    const f = S.kf ||= { area: '', agent: '', pri: '', who: '' };
    const all = await get('/api/tasks' + (pid ? '?project_id=' + pid : ''));
    const tasks = all.filter(t => (!f.area || t.area_id === +f.area) && (!f.agent || t.agent_id === +f.agent) && (!f.pri || t.priority === f.pri) && (!f.who || t.assignee_user_id === +f.who));
    const cols = COLS.map(([k, l]) => [k, l, tasks.filter(t => k === 'atascadas' ? STUCK.includes(t.status) : t.status === k).sort((a, b) => a.kanban_order - b.kanban_order)]);
    el.innerHTML = `<div class="row"><h1 style="margin:0">Kanban</h1>
      <select id="kfProj" style="width:auto;max-width:260px" aria-label="Proyecto">${opts(S.boot.projects.map(x => [x.id, x.name]), pid || '', 'Todos los proyectos')}</select>${p ? chip('pendiente', PSTATUS[p.status]) : ''}
      <span class="right">${canEdit() ? '<button class="btn y" id="kt">+ Tarea</button><button class="btn" id="km">+ Misión</button>' : ''}<a class="btn o" href="#/consejo${pid ? '?project=' + pid : ''}">Consejo</a>${p ? '<button class="btn ghost" id="kf">Ficha</button>' : ''}</span></div>
      <div class="row" style="margin:12px 0">
        <select id="kfA" style="width:auto">${opts(S.boot.areas.map(a => [a.id, a.name]), f.area, 'Todas las áreas')}</select>
        <select id="kfG" style="width:auto">${opts(S.boot.agents.map(a => [a.id, a.name]), f.agent, 'Todos los agentes')}</select>
        <select id="kfP" style="width:auto">${opts([['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], f.pri, 'Toda prioridad')}</select>
        <select id="kfW" style="width:auto">${opts(S.boot.users.map(u => [u.id, u.name]), f.who, 'Cualquier responsable')}</select>
        <small class="muted">Arrastra a "En curso" para ejecutar con el agente asignado.</small></div>
      ${kTabs(cols)}<div class="kanban">${cols.map(([k, l, list]) => kcolHTML(k, l, list.length, list.map(t => kanbanCard(t, !pid)).join(''))).join('')}</div>`;
    $('#kt', el)?.addEventListener('click', () => taskForm({}, { project_id: pid }));
    $('#km', el)?.addEventListener('click', missionForm);
    $('#kf', el)?.addEventListener('click', () => projectCard(pid));
    $('#kfProj', el).onchange = e => go('#/kanban/' + (e.target.value || 'todos'));
    for (const [id, k] of [['#kfA', 'area'], ['#kfG', 'agent'], ['#kfP', 'pri'], ['#kfW', 'who']]) $(id, el).onchange = e => { f[k] = e.target.value; route(true); };
    el.onclick = e => { const c = !e.target.closest('.kmove') && e.target.closest('.kcard'); if (c) go('#/tarea/' + c.dataset.id); };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('.kcard')) go('#/tarea/' + e.target.dataset.id); };
    bindKanbanDrag(el, all);
  },
};

// ===================== REPOSITORIOS (panel: también en móvil, donde el mapa no muestra la barra lateral) =====================
const repos = {
  async render(el) {
    el.innerHTML = `<div class="row"><h1 style="margin:0">Repositorios</h1><button type="button" class="btn sm right" id="repoFetch" title="Traer el estado del remoto (git fetch)">⟳ Consultar remoto</button></div>
      <p class="muted">Rama base de cada carpeta git, ramas de tareas pendientes, push y despliegue.</p>
      <section id="repoBox"><div class="repo-body repo-page" id="repoBody">${reposCache.key === (S.project || 0) && reposCache.html || '<div class="empty">Cargando…</div>'}</div></section>`;
    el.onclick = e => repoClick(e, el);
    loadRepos(el);
  },
};

// ===================== TAREA =====================
const logClass = l => l.startsWith('⚠') || /\[(?:AVISO|ERROR)\]/i.test(l) ? 'w' : /^[▶■]|^Listo:/i.test(l) ? 's' : l.startsWith('💬') ? 'e' : '';
const logHTML = txt => txt.split('\n').map(l => `<div class="${logClass(l)}">${h(l)}</div>`).join('');
// ponytail: tope fijo de líneas en pantalla; el log completo sigue en el servidor y se pide con el botón
const LOG_MAX = 1000;
const MORE = '<button type="button" class="btn sm ghost" data-more>⤒ Ver líneas anteriores</button>';
function showLog(c, txt, all = false) {
  const lines = txt.split('\n'), cut = all ? 0 : Math.max(0, lines.length - LOG_MAX);
  c.innerHTML = (cut ? MORE : '') + logHTML(lines.slice(cut).join('\n'));
}
function appendLog(c, line) {
  const stick = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
  c.insertAdjacentHTML('beforeend', `<div class="${logClass(line)}">${h(line)}</div>`);
  if (!stick) return; // quien lee arriba no sufre saltos: se recorta al volver al final
  let extra = c.querySelectorAll(':scope > div').length - LOG_MAX;
  if (extra > 0 && c.dataset.run && !c.querySelector(':scope > [data-more]')) c.insertAdjacentHTML('afterbegin', MORE);
  while (extra-- > 0) c.querySelector(':scope > div').remove();
  c.scrollTop = c.scrollHeight;
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-more]')?.parentElement;
  if (c?.dataset.run) get(`/api/runs/${c.dataset.run}/log`).then(lg => { showLog(c, lg.log, true); c.scrollTop = 0; }, fail);
});
function messagesHTML(msgs) {
  return msgs.map(m => `<div class="msg ${m.role} ${m.kind === 'consulta' ? 'consulta' : ''}"><div class="who">${m.role === 'agente' ? agentChip(m.agent_id, 1) : m.role === 'usuario' ? userChip(m.user_id) : 'SISTEMA'} · ${fmtDate(m.at)}${m.kind !== 'mensaje' ? ' · ' + h(m.kind) : ''}${m.role === 'agente' && window.speechSynthesis ? '<button type="button" class="btn sm ghost" data-say title="Leer en voz alta" aria-label="Leer en voz alta">' + ic('sound', 'sm') + '</button>' : ''}</div><div class="body">${md(m.text)}</div></div>`).join('') || '<div class="empty">Sin mensajes</div>';
}
function permsHTML(perms) {
  return perms.map(p => `<div class="perm"><b class="lbl-up">${ic('lock', 'sm')} Permiso solicitado</b><pre style="white-space:pre-wrap">${h(JSON.stringify(p.input, null, 1)).slice(0, 800)}</pre>
    <button class="btn sm g" data-perm="${h(p.request_id)}" data-allow="1">Aprobar</button><button class="btn sm r" data-perm="${h(p.request_id)}" data-allow="0">Denegar</button></div>`).join('');
}
function renderStructuredDiff(diff) {
  if (!diff) return '';
  const chunks = diff.split(/^diff --git /m).filter(Boolean);
  const diffLine = l => `<span style="color:${l.startsWith('+') ? '#7CFC00' : l.startsWith('-') ? '#ff6b6b' : l.startsWith('@@') ? '#4fc3f7' : '#bbb'}">${h(l)}</span>`;
  if (!chunks.length || (chunks.length === 1 && !diff.startsWith('diff --git'))) {
    return `<pre class="console" style="height:auto;max-height:70vh">${diff.split('\n').map(diffLine).join('\n')}</pre>`;
  }
  return chunks.map((chunk, i) => {
    const lines = chunk.split('\n');
    const headerMatch = /^[ab]\/(.*?)\s+[ab]\/(.*)/.exec(lines[0]) || /^(.+)/.exec(lines[0]);
    const fname = headerMatch ? (headerMatch[2] || headerMatch[1]) : 'archivo';
    const adds = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
    const dels = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
    const bodyHtml = lines.map(diffLine).join('\n');
    return `<details class="diff-file" ${i < 3 ? 'open' : ''}>
      <summary><span>${ic('note', 'sm')} <b>${h(fname)}</b></span> <span><small style="color:#7CFC00">+${adds}</small> <small style="color:#ff6b6b">-${dels}</small></span></summary>
      <pre class="diff-body">${bodyHtml}</pre>
    </details>`;
  }).join('');
}
const tarea = {
  event(type, d, cur) {
    const id = +cur.args[0];
    if (type === 'run.log' && d.task_id === id) {
      const c = $('#console');
      if (c && (+c.dataset.run === d.run_id || c.dataset.live === '1')) {
        if (+c.dataset.run !== d.run_id) { c.dataset.run = d.run_id; c.innerHTML = ''; }
        appendLog(c, d.line);
      }
      return 'handled';
    }
    if (['task.updated', 'run.started', 'handoff'].includes(type) && (d.id === id || d.task_id === id)) return 'refresh';
    if (type === 'conv.updated' || type === 'permiso') return 'refresh';
  },
  async render(el, r) {
    const id = +r.args[0];
    const x = await get('/api/tasks/' + id);
    const t = x.task, a = agent(t.agent_id), ar = area(t.area_id);
    const tab = (S.taskTabs ||= {})[id] || 'consola'; // pestaña recordada por tarea
    const running = x.running || x.queued;
    const can = canEdit();
    const btn = (cond, id2, cls, label) => cond && can ? `<button class="btn ${cls}" id="${id2}">${label}</button>` : '';
    const reply = () => `<form id="replyF" class="col-flex" style="margin-top:10px">${can ? `<textarea id="replyT" placeholder="${t.executor === 'humano' || !t.conversation_id ? 'Agregar nota…' : t.status === 'esperando' ? 'Responde al agente…' : 'Mensaje para el agente (reanuda la sesión)…'}" rows="3"></textarea>
      <div class="row"><button class="btn y">${t.executor === 'humano' || !t.conversation_id ? 'Agregar nota' : 'Enviar al agente'}</button>${micBtn('#replyT')}${t.conversation_id && t.executor === 'agente' ? '<button class="btn ghost" id="noteB" type="button">Solo nota</button>' : ''}</div>` : ''}</form>`;
    el.innerHTML = `<div class="row"><a href="#/kanban/${t.project_id}" class="btn ghost sm">← ${h(x.project.name)}</a><h1 style="margin:0">#${t.id} ${h(t.title)}</h1>${chip(t.status)}</div>
      <div class="task-meta">${[
        t.executor === 'humano' ? `Persona: <b>${h(user(t.assignee_user_id)?.name || 'sin asignar')}</b>` : `${agentSprite(a, 1.5)} <b>${h(a?.name || '—')}</b> ${h(t.model || '-')} · ${h(t.effort || '-')}`,
        ar ? `${h(ar.alias)} · ${h(ar.name)}` : '',
        `<span class="pri-${t.priority}">${PRI[t.priority]}</span>`,
        x.folder ? `<span title="${h(x.folder.path)}">carpeta ${h(x.folder.label)}</span>` : 'sandbox',
        t.executor === 'agente' && machines().length ? `máquina ${h(x.machine || '')}` : '',
        t.branch ? `rama <code>${h(t.branch)}</code>` : '', t.due_date ? `vence ${h(t.due_date)}` : '',
        `creada por ${h(user(t.created_by)?.name || '-')} ${ago(t.created_at)}`].filter(Boolean).join(' · ')}
        ${t.executor === 'agente' ? (t.mode === 'editar' ? '<span class="chip st-revision" title="Sin sandbox: puede ejecutar comandos, hacer push y desplegar con tus credenciales">modo Editar</span>' : `<span class="chip">modo ${h(t.mode)}</span>`) : ''}</div>
      <div class="row">
        ${btn(t.executor === 'agente' && !running && t.status !== 'completada', 'bRun', 'y', t.conversation_id && ['esperando', 'fallida', 'pausada_cuota'].includes(t.status) ? '▶ Ejecutar de nuevo' : '▶ Ejecutar')}
        ${btn(running, 'bAbort', 'r', '■ Abortar')}
        ${btn(['revision', 'esperando'].includes(t.status), 'bApprove', 'g', '✔ Aprobar')}
        ${btn(t.executor === 'humano' && t.status !== 'completada', 'bHumDone', 'g', 'Marcar completada')}
        ${btn(t.status === 'revision', 'bReturn', '', '↩ Devolver')}
        ${btn(t.status !== 'completada', 'bHand', '', '⇄ Pasar a otro')}
        ${can ? `<details class="more-menu"><summary class="btn ghost">⋯ Más</summary><div class="menu-pop">
          ${btn(true, 'bEdit', 'ghost', 'Editar')}
          ${btn(t.executor === 'agente' && !running, 'bDecomp', 'ghost', 'Descomponer')}
          ${btn(['completada', 'revision'].includes(t.status), 'bReview', 'ghost', '¿Qué mejorarías?')}
          ${btn(true, 'bDel', 'r', 'Eliminar')}</div></details>` : ''}
      </div>
      ${permsHTML(x.permissions)}
      ${t.executor === 'agente' && t.status !== 'completada' ? offlineWarn(x.machine, x.machine_online) : ''}
      ${t.status === 'esperando' ? `<div class="panel y" style="margin:10px 0"><b class="lbl-up" style="color:var(--yellow)">? EL AGENTE ESPERA TU RESPUESTA</b><div>${md((([a, b = '']) => b.trim() || a)((x.messages.filter(m => m.role === 'agente').at(-1)?.text || '').split('[[CONSULTA]]')))}</div>${tab !== 'chat' ? reply() : ''}</div>` : ''}
      ${t.status === 'pausada_cuota' ? `<div class="panel r" style="margin:10px 0"><b class="lbl-up">${h(a?.name)} se quedó sin cuota</b><p>El avance quedó guardado (checkpoint + snapshot). Elige quién continúa.</p>${can ? '<button class="btn y" id="bHand2">Elegir relevo</button>' : ''} ${a?.quota_reset_at ? `<small>o espera a ${h(a.name)}: vuelve ${ago(a.quota_reset_at)}</small>` : ''}</div>` : ''}
      ${t.summary ? `<div class="panel h" style="margin:10px 0"><b class="lbl-up" style="color:var(--holo)">RESUMEN DEL AGENTE</b>${md(t.summary)}</div>` : ''}
      ${t.review_comment ? `<div class="panel" style="margin:10px 0"><b class="lbl-up">COMENTARIO DE REVISIÓN</b>${md(t.review_comment)}</div>` : ''}
      <div class="panel" style="margin:10px 0"><div class="row"><b class="lbl-up">ADJUNTOS (${x.attachments.length})</b>
        ${can ? '<label class="btn sm right">+ Adjuntar<input type="file" id="attIn" multiple hidden></label>' : ''}</div>${attachmentsHTML(x.attachments, can)}</div>
      <div class="tabs" style="margin-top:14px">${[['consola', 'Consola'], ['chat', `Chat (${x.messages.length})`], ['cambios', 'Cambios'], ['runs', `Ejecuciones (${x.runs.length})`], ['relevos', `Relevos (${x.handoffs.length})`], ['historial', 'Historial'], ['detalles', 'Detalles']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="tabBody"></div>`;
    const body = $('#tabBody', el);
    if (tab === 'consola') {
      const runId = S.taskRun?.[id] || x.runs[0]?.id;
      body.innerHTML = x.runs.length ? `<div class="row" style="justify-content:space-between;margin-bottom:6px">
        <div class="row"><select id="runSel" style="width:auto">${opts(x.runs.map(r => [r.id, `Turno ${r.turn} · ${agent(r.agent_id)?.name} · ${r.end_reason || 'en curso'} · ${fmtDate(r.started_at)}`]), runId)}</select>
        <small class="muted">${h(x.runs.find(r => r.id === runId)?.command || '')}</small></div>
        <button type="button" class="btn sm ghost" id="fsConsoleBtn" title="Pantalla completa">⛶ Maximizar</button>
      </div><div class="console" id="console" data-scroll="console" data-run="${runId}" data-live="${runId === x.runs[0]?.id ? 1 : 0}">cargando…</div>` : '<div class="empty">Aún no se ejecuta. Pulsa ▶ Ejecutar.</div>';
      if (runId) {
        get(`/api/runs/${runId}/log`).then(lg => { const c = $('#console', el); if (c) { showLog(c, lg.log); c.scrollTop = c.scrollHeight; } });
        $('#runSel', body).onchange = e => { (S.taskRun ||= {})[id] = +e.target.value; route(true); };
      }
    } else if (tab === 'chat') {
      body.innerHTML = `<div class="chat" data-scroll="chat">${messagesHTML(x.messages)}</div>${reply()}`;
      const c = $('.chat', body); c.scrollTop = c.scrollHeight;
    } else if (tab === 'cambios') {
      body.innerHTML = '<div class="empty">Cargando diff…</div>';
      get(`/api/tasks/${id}/diff`).then(df => {
        body.innerHTML = df.diff || df.log ? `${df.log ? `<h3>Commits</h3><pre class="console" style="height:auto;max-height:200px">${h(df.log)}</pre>` : ''}<h3>Diff de cambios</h3>${renderStructuredDiff(df.diff)}` : `<div class="empty">Sin cambios en git${x.files.length ? '' : ''}.</div>`;
        if (x.files.length) body.insertAdjacentHTML('beforeend', `<h3>Archivos generados</h3>${x.files.map(f => `<div><a href="/api/tasks/${id}/file?name=${encodeURIComponent(f.name)}">${h(f.name)}</a> <small>${bytes(f.size)}</small></div>`).join('')}`);
      });
    } else if (tab === 'runs') {
      body.innerHTML = `<div class="table-wrap"><table class="grid"><tr><th>Turno</th><th>Agente</th><th>Modelo</th><th>Inicio</th><th>Duración</th><th>Fin</th><th>Tokens</th><th>Costo</th><th>Cambios</th></tr>
        ${x.runs.map(r => `<tr class="click" data-run="${r.id}"><td>${r.turn}</td><td>${agentChip(r.agent_id)}</td><td>${h(r.model || '')} ${h(r.effort || '')}</td><td>${fmtDate(r.started_at)}<br><small>${userChip(r.started_by)}</small></td>
        <td>${r.ended_at ? dur((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) : '…'}</td><td>${h(r.end_reason || 'en curso')}</td><td>${num(r.tokens_in + r.tokens_out)}</td><td>$${(r.cost_usd || 0).toFixed(3)}</td><td><small>${h((r.diff_stat || '').split('\n').pop())}</small></td></tr>`).join('')}</table></div>`;
      $$('[data-run]', body).forEach(tr => tr.onclick = () => { (S.taskRun ||= {})[id] = +tr.dataset.run; S.taskTabs[id] = 'consola'; route(true); });
    } else if (tab === 'relevos') {
      body.innerHTML = x.handoffs.map(hd => `<div class="panel" style="margin:8px 0"><div class="row">${agentChip(hd.from_agent_id)} → ${hd.to_user_id ? userChip(hd.to_user_id) : hd.to_agent_id ? agentChip(hd.to_agent_id) : '<span class="chip st-esperando">pendiente de decidir</span>'}
        <span class="chip">${h(hd.reason)}</span>${hd.commit_sha ? `<span class="chip">commit ${h(hd.commit_sha)}</span>` : ''}<small class="right">${fmtDate(hd.at)}</small></div>
        <details><summary>Ver snapshot de relevo</summary><div class="chat">${md(hd.snapshot_md)}</div></details></div>`).join('') || '<div class="empty">Sin relevos</div>';
    } else if (tab === 'historial') {
      body.innerHTML = `<table class="grid"><tr><th>Cuándo</th><th>Quién</th><th>Campo</th><th>Antes</th><th>Después</th></tr>${x.history.map(hh => `<tr><td>${fmtDate(hh.at)}</td><td>${userChip(hh.user_id)}</td><td>${h(hh.field)}</td><td><small>${h(String(hh.old_value ?? '').slice(0, 80))}</small></td><td><small>${h(String(hh.new_value ?? '').slice(0, 80))}</small></td></tr>`).join('')}</table>`;
    } else {
      body.innerHTML = `<h3>Instrucciones</h3><div class="panel">${md(t.prompt || '(vacío)')}</div>
        ${x.deps.length ? `<h3>Depende de</h3>${x.deps.map(d2 => `<div><a href="#/tarea/${d2.id}">#${d2.id} ${h(d2.title)}</a> ${chip(d2.status)}</div>`).join('')}` : ''}
        ${x.dependents.length ? `<h3>Bloquea a</h3>${x.dependents.map(d2 => `<div><a href="#/tarea/${d2.id}">#${d2.id} ${h(d2.title)}</a> ${chip(d2.status)}</div>`).join('')}` : ''}
        ${x.children.length ? `<h3>Subtareas</h3>${x.children.map(d2 => `<div><a href="#/tarea/${d2.id}">#${d2.id} ${h(d2.title)}</a> ${chip(d2.status)}</div>`).join('')}` : ''}
        ${t.parent_id ? `<h3>Tarea padre</h3><a href="#/tarea/${t.parent_id}">#${t.parent_id}</a>` : ''}
        ${x.proposal ? `<h3>Origen</h3><a href="#/consejo/${x.proposal.review_id}">Propuesta #${x.proposal.id} del Consejo #${x.proposal.review_id}</a>` : ''}
        ${t.worktree_path ? `<h3>Worktree</h3><code>${h(t.worktree_path)}</code>` : ''}`;
    }
    $$('.tabs [data-tab]', el).forEach(b => b.onclick = () => { S.taskTabs[id] = b.dataset.tab; route(true); });
    $('#attIn', el)?.addEventListener('change', async e => { try { await uploadAll([...e.target.files], { task_id: id }); e.target.value = ''; holo('Adjuntado', 'Lo recibirá el agente en su próximo turno'); } catch (err) { fail(err); } });
    $('#replyF', el)?.addEventListener('submit', async e => {
      e.preventDefault(); const text = $('#replyT').value.trim(); if (!text) return;
      try { await post(`/api/tasks/${id}/reply`, { text, voz: isDictated($('#replyT')) }); $('#replyT').value = ''; beep('ok'); refreshSoon(0); } catch (err) { fail(err); }
    });
    $('#noteB', el)?.addEventListener('click', async () => { const text = $('#replyT').value.trim(); if (!text) return; await act(() => post(`/api/tasks/${id}/note`, { text })); $('#replyT').value = ''; refreshSoon(0); });
    const on = (sel, fn) => $(sel, el)?.addEventListener('click', fn);
    on('#fsConsoleBtn', () => {
      const c = $('#console', el);
      const isFs = c?.classList.toggle('fullscreen');
      const b = $('#fsConsoleBtn', el);
      if (b) b.textContent = isFs ? '✕ Restaurar' : '⛶ Maximizar';
    });
    on('#bRun', () => runDialog(t));
    on('#bAbort', async () => { if (await confirmBox('¿Abortar la ejecución?', 'Abortar', true)) act(() => post(`/api/tasks/${id}/abort`), 'Abortando…'); });
    on('#bApprove', () => approveDialog(t));
    on('#bReturn', async () => { const c = await promptBox('Devolver tarea', 'Qué debe corregir el agente', '', true); if (c) act(() => post(`/api/tasks/${id}/return`, { comment: c }), 'Tarea devuelta'); });
    on('#bHand', () => handoffDialog(t)); on('#bHand2', () => handoffDialog(t));
    on('#bEdit', () => taskForm(t));
    on('#bDecomp', async () => { holo('Descomponiendo…', 'El agente está proponiendo subtareas'); try { const r = await post(`/api/tasks/${id}/decompose`); holo('Subtareas creadas', r.ids.map(i => '#' + i).join(', '), { link: '#/kanban/' + t.project_id }); } catch (e) { fail(e); } });
    on('#bReview', async () => { const r = await act(() => post(`/api/tasks/${id}/review`, {}), 'Consejo convocado'); go('#/consejo/' + r.id); });
    on('#bHumDone', () => act(() => put(`/api/tasks/${id}`, { status: 'completada' }), 'Completada'));
    on('#bDel', async () => { if (await confirmBox(`¿Enviar #${id} a la papelera?`, 'Eliminar', true)) { await act(() => del('/api/tasks/' + id)); go('#/kanban/' + t.project_id); } });
  },
};
function runDialog(t) {
  const d = modal(`<h2>Ejecutar #${t.id}</h2>${agentPicker('rd', t)}
    <label class="row" style="margin-top:10px"><input type="checkbox" name="fresh"> Empezar sesión nueva (no reanudar la anterior)</label>
    <p class="muted">Carpeta: ${t.folder_id ? h(project(t.project_id)?.folders.find(f => f.id === t.folder_id)?.path || '') : 'sandbox de la oficina'} · máquina ${h(machineName(project(t.project_id)?.folders.find(f => f.id === t.folder_id)?.machine_id || defaultMachine()))}${t.mode === 'editar' ? ' · el agente podrá modificar archivos.' : ''}</p>
    <div class="row"><button class="btn y" id="rdOk">▶ Ejecutar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
  bindPicker(d, 'rd');
  $('#rdOk', d).onclick = async e => {
    e.preventDefault();
    const f = formData(d);
    try { await post(`/api/tasks/${t.id}/run`, { agent_id: +f.agent_id, model: f.model, effort: f.effort, mode: f.mode, fresh: f.fresh }); closeModal(); (S.taskTabs ||= {})[t.id] = 'consola'; if (S.taskRun) delete S.taskRun[t.id]; beep('ok'); refreshSoon(0); } catch (err) { fail(err); }
  };
}
export function approveDialog(t) {
  const d = modal(`<h2>Aprobar #${t.id}</h2>
    ${t.branch ? `<label class="row"><input type="checkbox" name="merge" checked> Fusionar la rama <code>${h(t.branch)}</code> en <code>${h(t.base_branch)}</code></label>` : ''}
    ${t.executor === 'agente' ? `<label class="row"><input type="checkbox" name="second_opinion"> Crear tarea de segunda opinión con otro agente</label><label class="row"><input type="checkbox" name="run_second"> …y ejecutarla ya</label>` : ''}
    <div class="row" style="margin-top:12px"><button class="btn g" id="apOk">✔ Aprobar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
  $('#apOk', d).onclick = async e => {
    e.preventDefault();
    try { const r = await post(`/api/tasks/${t.id}/approve`, formData(d)); closeModal(); beep('ok'); holo('Tarea completada', r.merge ? 'Rama fusionada' : '', r.second ? { link: '#/tarea/' + r.second } : {}); refreshSoon(0); } catch (err) { fail(err); }
  };
}
function handoffDialog(t) {
  const d = modal(`<h2>Relevo de #${t.id}</h2><p class="muted">Se guarda un checkpoint y un snapshot (progreso, git, chat, log) que recibe quien continúe.</p>
    <div class="row"><label class="row"><input type="radio" name="kind" value="agente" checked> Otro agente</label><label class="row"><input type="radio" name="kind" value="persona"> Una persona</label></div>
    <div id="hdA">${agentPicker('hd', { agent_id: agentsOn().find(a => a.id !== t.agent_id && a.status !== 'sin_cuota')?.id }, { modes: false })}</div>
    <div id="hdP" hidden><label class="l">Persona</label><select name="user_id">${opts(S.boot.users.map(u => [u.id, u.name]), S.boot.me.id)}</select></div>
    <label class="l">Motivo</label><input name="reason" value="${t.status === 'pausada_cuota' ? 'cuota' : 'manual'}">
    <div class="row" style="margin-top:12px"><button class="btn y" id="hdOk">⇄ Pasar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
  bindPicker(d, 'hd');
  $$('[name=kind]', d).forEach(r => r.onchange = () => { const p = d.querySelector('[name=kind]:checked').value === 'persona'; $('#hdA', d).hidden = p; $('#hdP', d).hidden = !p; });
  $('#hdOk', d).onclick = async e => {
    e.preventDefault();
    const f = formData(d); const persona = d.querySelector('[name=kind]:checked').value === 'persona';
    try { await post(`/api/tasks/${t.id}/handoff`, persona ? { user_id: +f.user_id, reason: f.reason } : { agent_id: +f.agent_id, model: f.model, effort: f.effort, reason: f.reason }); closeModal(); holo('Relevo en marcha'); refreshSoon(0); } catch (err) { fail(err); }
  };
}

// ===================== CANTINA =====================
const cantina = {
  event(type, d, cur) {
    const cid = +cur.args[0];
    if (type === 'run.log') {
      if (d.conv_id !== cid) return 'handled';
      const c = $('#chatLive'); if (c) { c.hidden = false; c.dataset.run = d.run_id; appendLog(c, d.line); }
      return 'handled';
    }
    if (type === 'conv.updated' || type === 'run.started' || type === 'permiso') return 'refresh';
  },
  async render(el, r) {
    const cid = +r.args[0];
    const q = S.chatQ ||= { q: '', archived: false };
    const list = await get(`/api/conversations?q=${encodeURIComponent(q.q)}${q.archived ? '&archived=1' : ''}`);
    const left = `<div class="col-flex"><button class="btn y" id="newChat">+ Nueva consulta</button><input id="chatQ" placeholder="Buscar chats" value="${h(q.q)}">
      <label class="row" style="font-size:var(--fs-md)"><input type="checkbox" id="chatArch" ${q.archived ? 'checked' : ''}> ver archivados</label>
      <div class="chat-list" data-scroll="clist">${list.map(c => `<div class="chat-item ${c.id === cid ? 'on' : ''}" data-c="${c.id}"><div class="row" style="gap:6px">${agentSprite(agent(c.agent_id), 2)}<a class="ellipsis grow" href="#/cantina/${c.id}"><b>${c.pinned ? ic('pin', 'sm') + ' ' : ''}${h(c.title)}</b></a>${c.status === 'esperando' ? '<span class="chip st-esperando">?</span>' : c.status === 'en_curso' ? '<span class="chip st-en_curso">…</span>' : ''}</div><small>${h(agent(c.agent_id)?.name)} · ${c.n_runs} turnos · ${ago(c.updated_at)}</small></div>`).join('') || '<div class="empty">Sin consultas todavía</div>'}</div></div>`;
    let right;
    if (!cid) {
      right = `<div class="panel y"><h2 style="margin-top:0">Nueva consulta rápida</h2><p class="muted">Pregunta lo que sea a un agente sin crear tarea. Queda en el historial y puedes convertirla en tarea o proyecto.</p>
        <form id="ncF"><label class="l">Mensaje ${micBtn('#ncText')}</label><textarea name="text" id="ncText" rows="5" required></textarea>
        ${agentPicker('nc', {}, { modes: false })}
        <details class="opts"><summary>Opciones: solo lectura · carpeta de la Cantina · sin adjuntos</summary>
        <div class="field-row"><div><label class="l">Modo</label><select name="mode">${opts([['plan', 'Solo lectura'], ['editar', 'Puede editar archivos']], 'plan')}</select></div>
        <div><label class="l">Proyecto (contexto, opcional)</label><select name="project_id" id="ncProj">${opts(S.boot.projects.map(p => [p.id, p.name]), '', '—')}</select></div></div>
        <div class="field-row">${machineSel('name="machine_id" id="ncMachine"')}</div>
        <label class="l">Carpeta (vacío = carpeta de la Cantina)</label><div class="row" style="flex-wrap:nowrap"><input name="folder_path" id="ncFolder" placeholder="D:\\cantina"><button class="btn sm" type="button" id="ncBrowse">Examinar</button></div>
        <label class="l">Adjuntos (opcional)</label><input type="file" id="ncFiles" multiple></details>
        <button class="btn y" style="margin-top:10px">Enviar a la cantina</button></form></div>`;
    } else {
      const x = await get('/api/conversations/' + cid);
      const c = x.conversation;
      right = `<div class="panel"><div class="row"><h2 style="margin:0" class="grow ellipsis">${c.pinned ? ic('pin', 'sm') + ' ' : ''}${h(c.title)}</h2>${chip(c.status === 'inactiva' ? 'completada' : c.status === 'error' ? 'fallida' : c.status === 'sin_cuota' ? 'pausada_cuota' : c.status, c.status)}</div>
        ${offlineWarn(x.machine, x.machine_online)}
        <div class="row" style="margin:8px 0">${agentChip(c.agent_id)}${machines().length > 1 ? `<span class="chip">${ic('monitor', 'sm')} ${h(x.machine || '')}</span>` : ''}<span class="chip">${h(c.model || '-')} · ${h(c.effort || '-')} · ${c.mode === 'plan' ? 'lectura' : 'edición'}</span>${c.folder_path ? `<span class="chip" title="${h(c.folder_path)}">${ic('folder', 'sm')} ${h(c.folder_path.split(/[\\/]/).pop())}</span>` : ''}${c.project_id ? `<span class="chip">${h(project(c.project_id)?.name || '')}</span>` : ''}${c.task_id ? `<a class="chip" href="#/tarea/${c.task_id}">→ tarea #${c.task_id}</a>` : ''}</div>
        ${canEdit() ? `<div class="row">${x.running ? '<button class="btn sm r" id="cAbort">■ Abortar</button>' : ''}<button class="btn sm" id="cSwitch">⇄ Cambiar agente</button><button class="btn sm g" id="cTask">→ Tarea</button><button class="btn sm" id="cProj">→ Proyecto</button>
          <button class="btn sm ghost" id="cRename">Renombrar</button><button class="btn sm ghost" id="cPin">${c.pinned ? 'Desfijar' : 'Fijar'}</button><button class="btn sm ghost" id="cArch">${c.archived ? 'Desarchivar' : 'Archivar'}</button>
          <a class="btn sm ghost" href="/api/conversations/${cid}/md">Exportar .md</a><button class="btn sm r" id="cDel">Eliminar</button></div>` : ''}
        ${permsHTML(x.permissions)}
        ${x.attachments.length ? `<div style="margin-top:8px">${attachmentsHTML(x.attachments, canEdit())}</div>` : ''}
        <div class="chat" data-scroll="chat" style="margin-top:10px">${messagesHTML(x.messages)}</div>
        <div class="console" id="chatLive" style="height:160px" ${x.running ? '' : 'hidden'}></div>
        ${canEdit() ? `<form id="crF" class="col-flex" style="margin-top:10px"><textarea id="crT" rows="3" placeholder="${c.status === 'esperando' ? 'Responde la consulta…' : 'Sigue la conversación…'}"></textarea><div class="row"><button class="btn y" ${x.running ? 'disabled' : ''}>Enviar</button>${micBtn('#crT')}<label class="btn ghost">${ic('clip', 'sm')} Adjuntar<input type="file" id="crFiles" multiple hidden></label><small id="crFilesN" class="muted"></small></div></form>` : ''}</div>`;
      setTimeout(() => { const ch = $('.chat', el); if (ch) ch.scrollTop = ch.scrollHeight; });
      if (x.running && x.runs[0]) get(`/api/runs/${x.runs[0].id}/log`).then(lg => { const lv = $('#chatLive', el); if (lv) { lv.dataset.run = x.runs[0].id; showLog(lv, lg.log); lv.scrollTop = lv.scrollHeight; } });
    }
    el.innerHTML = `<h1>Cantina de Mos Eisley</h1><div class="cantina">${left}<div>${right}</div></div>`;
    $('#newChat', el).onclick = () => go('#/cantina');
    $('#chatQ', el).oninput = e => { q.q = e.target.value; clearTimeout(S.cq); S.cq = setTimeout(() => route(true), 300); };
    $('#chatArch', el).onchange = e => { q.archived = e.target.checked; route(true); };
    $$('[data-c]', el).forEach(i => i.onclick = () => go('#/cantina/' + i.dataset.c));
    if (!cid) {
      bindPicker(el, 'nc');
      if (S.voiceDraft) {
        const draft = $('#ncText', el);
        draft.value = S.voiceDraft;
        draft.dataset.voz = '1';
        S.voiceDraft = null;
      }
      $('#ncBrowse', el).onclick = () => browseInto($('#ncFolder', el), $('#ncMachine', el)?.value);
      $('#ncProj', el).onchange = e => { const p = project(e.target.value); const f = p?.folders.find(x => x.is_default); if (f && !$('#ncFolder', el).value) $('#ncFolder', el).value = f.path; };
      $('#ncF', el).onsubmit = async e => {
        e.preventDefault(); const f = formData(e.target);
        try {
          const attachment_ids = await uploadAll([...$('#ncFiles', el).files], {});
          const r2 = await post('/api/conversations', { ...f, agent_id: +f.agent_id, project_id: +f.project_id || null, machine_id: +f.machine_id || null, attachment_ids, voz: isDictated($('#ncText', el)) });
          beep('ok'); go('#/cantina/' + r2.id);
        } catch (err) { fail(err); }
      };
      return;
    }
    const on = (sel, fn) => $(sel, el)?.addEventListener('click', fn);
    $('#crFiles', el)?.addEventListener('change', e => { $('#crFilesN', el).textContent = [...e.target.files].map(f => f.name).join(', '); });
    $('#crF', el)?.addEventListener('submit', async e => {
      e.preventDefault(); const text = $('#crT').value.trim(); if (!text) return;
      try { await uploadAll([...$('#crFiles', el).files], { conversation_id: cid }); await post(`/api/conversations/${cid}/reply`, { text, voz: isDictated($('#crT')) }); $('#crT').value = ''; refreshSoon(0); } catch (err) { fail(err); }
    });
    on('#cAbort', () => act(() => post(`/api/conversations/${cid}/abort`)));
    on('#cRename', async () => { const v = await promptBox('Renombrar', 'Título', $('h2', el).textContent.trim()); if (v) await act(() => put('/api/conversations/' + cid, { title: v })); });
    on('#cPin', () => act(() => put('/api/conversations/' + cid, { pinned: !$('#cPin').textContent.includes('Desfijar') ? 1 : 0 })));
    on('#cArch', () => act(() => put('/api/conversations/' + cid, { archived: $('#cArch').textContent === 'Archivar' ? 1 : 0 })));
    on('#cDel', async () => { if (await confirmBox('¿Enviar el chat a la papelera?', 'Eliminar', true)) { await act(() => del('/api/conversations/' + cid)); go('#/cantina'); } });
    on('#cSwitch', () => {
      const d = modal(`<h2>Cambiar de agente</h2><p class="muted">El nuevo agente recibe el historial completo de esta conversación como contexto.</p>${agentPicker('sw', {}, { modes: false })}<div class="row"><button class="btn y" id="swOk">Cambiar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
      bindPicker(d, 'sw');
      $('#swOk', d).onclick = async e => { e.preventDefault(); const f = formData(d); try { await post(`/api/conversations/${cid}/switch`, { agent_id: +f.agent_id, model: f.model, effort: f.effort }); closeModal(); refreshSoon(0); } catch (err) { fail(err); } };
    });
    on('#cTask', () => {
      const d = modal(`<h2>Convertir en tarea</h2><div class="field-row"><div><label class="l">Proyecto</label><select name="project_id" id="ctP">${opts(S.boot.projects.map(p => [p.id, p.name]), S.project)}</select></div>
        <div><label class="l">Área</label><select name="area_id">${opts(S.boot.areas.map(a => [a.id, a.name]), '', '—')}</select></div></div>
        <label class="l">Título</label><input name="title" value="${h($('h2', el).textContent.trim())}"><label class="l">Instrucciones adicionales</label><textarea name="prompt"></textarea>
        <p class="muted">La conversación completa se adjunta a la tarea y queda vinculada.</p><div class="row"><button class="btn y" id="ctOk">Crear tarea</button><button class="btn ghost" value="c">Cancelar</button></div>`);
      $('#ctOk', d).onclick = async e => { e.preventDefault(); const f = formData(d); if (!f.project_id) return fail('Crea un proyecto primero'); try { const r2 = await post(`/api/conversations/${cid}/to-task`, { ...f, project_id: +f.project_id, area_id: +f.area_id || null, folder_id: project(f.project_id)?.folders.find(x => x.is_default)?.id || null }); closeModal(); go('#/tarea/' + r2.id); } catch (err) { fail(err); } };
    });
    on('#cProj', async () => { const n = await promptBox('Crear proyecto desde este chat', 'Nombre del proyecto', $('h2', el).textContent.trim()); if (n) { const r2 = await act(() => post(`/api/conversations/${cid}/new-project`, { name: n }), 'Proyecto creado'); await loadBoot(); S.project = r2.id; localStorage.setItem('ov_project', r2.id); go('#/proyectos'); } });
  },
};

// ===================== CONSEJO JEDI =====================
const QUAD = [['Victorias rápidas', p => p.impact !== 'bajo' && p.effort !== 'alto'], ['Grandes misiones', p => p.impact !== 'bajo' && p.effort === 'alto'], ['Relleno', p => p.impact === 'bajo' && p.effort !== 'alto'], ['Trampas del Sarlacc', p => p.impact === 'bajo' && p.effort === 'alto']];
const consejo = {
  refreshOn: ['council.updated'],
  event(type, d) { if (type === 'council.updated') return 'refresh'; },
  async render(el, r) {
    const rid = +r.args[0];
    if (!rid) {
      const list = await get('/api/council');
      el.innerHTML = `<div class="row"><h1 style="margin:0">Consejo Jedi</h1><span class="right">${canEdit() ? '<button class="btn y" id="conv">Convocar consejo</button>' : ''}</span></div>
        <p class="muted">Envía un informe de lo último que se hizo a uno o varios agentes y recibe propuestas de mejora priorizadas que puedes convertir en tareas.</p>
        <div class="panel table-wrap"><table class="grid"><tr><th>#</th><th>Fecha</th><th>Proyectos</th><th>Lentes</th><th>Agentes</th><th>Estado</th><th>Propuestas</th></tr>
        ${list.map(v => `<tr class="click" data-r="${v.id}"><td>${v.id}</td><td>${fmtDate(v.at)}<br><small>${userChip(v.created_by)}</small></td><td>${JSON.parse(v.project_ids || '[]').map(p => h(project(p)?.name || '#' + p)).join(', ')}</td>
          <td>${JSON.parse(v.lenses || '[]').map(l => `<span class="chip">${h(S.boot.lenses[l]?.[0] || l)}</span>`).join(' ')}</td><td>${JSON.parse(v.agents || '[]').map(a => agentSprite(agent(a.agent_id), 2)).join('')}</td>
          <td>${chip(v.status === 'lista' ? 'completada' : v.status === 'error' ? 'fallida' : 'en_curso', v.status)}</td><td>${v.aceptadas}/${v.propuestas} aceptadas</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aún no se ha reunido el consejo</td></tr>'}</table></div>`;
      $('#conv', el)?.addEventListener('click', () => conveneDialog(+r.query.project || S.project));
      $$('[data-r]', el).forEach(t => t.onclick = () => go('#/consejo/' + t.dataset.r));
      if (r.query.project && canEdit() && !S.convOpened) { S.convOpened = true; conveneDialog(+r.query.project); setTimeout(() => S.convOpened = false, 1000); }
      return;
    }
    const x = await get('/api/council/' + rid);
    const v = x.review, props = x.proposals;
    const pc = p => `<div class="prop ${p.status}"><div class="row"><b class="grow">${h(p.title)}</b>${p.votes > 1 ? `<span class="votes">★${p.votes}</span>` : ''}</div>
      <div class="row" style="gap:4px;margin:4px 0"><span class="chip">${h(S.boot.lenses[p.lens]?.[0] || p.lens || '-')}</span><span class="chip">impacto ${h(p.impact)}</span><span class="chip">esfuerzo ${h(p.effort)}</span>${p.suggested_area ? `<span class="chip">${h(p.suggested_area)}</span>` : ''}${p.suggested_agent ? `<span class="chip">${h(p.suggested_agent)}</span>` : ''}${p.kind === 'config' ? '<span class="chip st-revision">configuración</span>' : ''}${p.status !== 'propuesta' ? chip(p.status === 'descartada' ? 'fallida' : 'completada', p.status) : ''}</div>
      <div>${md(p.description)}</div>${p.discard_reason && p.status === 'descartada' ? `<small>Motivo: ${h(p.discard_reason)}</small>` : ''}${p.task_id ? `<a href="#/tarea/${p.task_id}">→ tarea #${p.task_id}</a>` : ''}
      ${canEdit() && ['propuesta', 'pospuesta'].includes(p.status) ? `<div class="row"><button class="btn sm g" data-acc="${p.id}">${p.kind === 'config' ? 'Aplicar' : '→ Tarea'}</button><button class="btn sm r" data-dis="${p.id}">Descartar</button><button class="btn sm ghost" data-pos="${p.id}">Posponer</button>${p.conversation_id ? `<button class="btn sm" data-dsc="${p.conversation_id}">Discutir</button><button class="btn sm ghost" data-det="${p.id}">Más detalle</button>` : ''}</div>` : ''}</div>`;
    el.innerHTML = `<div class="row"><a class="btn ghost sm" href="#/consejo">← Consejos</a><h1 style="margin:0">Consejo #${rid}</h1>${chip(v.status === 'lista' ? 'completada' : v.status === 'error' ? 'fallida' : 'en_curso', v.status)}<small class="muted">${fmtDate(v.at)}</small></div>
      <div class="row" style="margin:10px 0">${v.lenses.map(l => `<span class="chip">${h(S.boot.lenses[l]?.[0] || l)}</span>`).join('')} ${v.agents.map(a => agentChip(a.agent_id)).join('')}${v.moderator_id ? ` moderador: ${agentChip(v.moderator_id)}` : ''}</div>
      ${v.status === 'en_curso' ? `<div class="panel h">Los agentes están deliberando… ${x.conversations.map(c => `<a href="#/cantina/${c.id}">${h(c.title)}</a> ${chip(c.status === 'inactiva' ? 'completada' : c.status, c.status)}`).join(' · ')}</div>` : ''}
      ${v.error ? `<div class="panel r">${h(v.error)}</div>` : ''}
      <details style="margin:10px 0"><summary class="lbl-up" style="cursor:pointer">Informe enviado al consejo</summary><div class="panel">${md(v.digest_md)}</div></details>
      ${props.length ? `<h2>Matriz impacto × esfuerzo</h2><div class="matrix">${QUAD.map(([n, fn]) => `<div class="q"><h3>${n}</h3>${props.filter(p => p.status !== 'descartada' && fn(p)).map(p => `<div>• ${h(p.title)} ${p.votes > 1 ? `<span class="votes">★${p.votes}</span>` : ''}</div>`).join('') || '<small class="muted">—</small>'}</div>`).join('')}</div>
      <h2>Propuestas</h2><div class="grid2">${props.map(pc).join('')}</div>` : v.status !== 'en_curso' ? '<div class="empty">Sin propuestas</div>' : ''}
      <h3>Conversaciones del consejo</h3>${x.conversations.map(c => `<div><a href="#/cantina/${c.id}">${h(c.title)}</a></div>`).join('')}`;
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.acc) {
        const p = props.find(y => y.id === +b.dataset.acc);
        if (p.kind === 'config') return act(() => post(`/api/proposals/${p.id}/accept`, {}), 'Configuración aplicada').then(() => loadBoot());
        const d = modal(`<h2>Crear tarea desde propuesta</h2><b>${h(p.title)}</b>
          <div class="field-row"><div><label class="l">Proyecto</label><select name="project_id">${opts(S.boot.projects.map(z => [z.id, z.name]), p.project_id || S.project)}</select></div>
          <div><label class="l">Área</label><select name="area_id">${opts(S.boot.areas.map(a => [a.id, a.name]), S.boot.areas.find(a => a.name.toLowerCase() === String(p.suggested_area || '').toLowerCase())?.id, '—')}</select></div></div>
          ${agentPicker('pa', { agent_id: S.boot.agents.find(a => [a.key, a.name.toLowerCase()].includes(String(p.suggested_agent || '').toLowerCase()))?.id }, { modes: false })}
          <div class="row"><button class="btn y" id="paOk">Crear tarea</button><button class="btn ghost" value="c">Cancelar</button></div>`);
        bindPicker(d, 'pa');
        $('#paOk', d).onclick = async ev => { ev.preventDefault(); const f = formData(d); try { const r2 = await post(`/api/proposals/${p.id}/accept`, { project_id: +f.project_id, area_id: +f.area_id || null, agent_id: +f.agent_id }); closeModal(); holo('Tarea creada', '#' + r2.task_id, { link: '#/tarea/' + r2.task_id }); } catch (err) { fail(err); } };
      }
      if (b.dataset.dis) { const why = await promptBox('Descartar propuesta', 'Motivo (el próximo consejo no la repetirá)'); if (why != null) act(() => post(`/api/proposals/${b.dataset.dis}/decide`, { status: 'descartada', reason: why })); }
      if (b.dataset.pos) act(() => post(`/api/proposals/${b.dataset.pos}/decide`, { status: 'pospuesta' }));
      if (b.dataset.dsc) go('#/cantina/' + b.dataset.dsc);
      if (b.dataset.det) { const r2 = await act(() => post(`/api/proposals/${b.dataset.det}/detail`), 'Pidiendo detalle…'); go('#/cantina/' + r2.conv_id); }
    };
  },
};
async function conveneDialog(pid) {
  const L = S.boot.lenses;
  const d = modal(`<h2>Convocar al Consejo Jedi</h2>
    <h3>1 · Alcance: ¿qué trabajo revisar?</h3>
    <div class="field-row">${[['project_ids', 'Proyectos', S.boot.projects, pid], ['area_ids', 'Áreas', S.boot.areas], ['agent_ids', 'Hecho por', S.boot.agents]].map(([n, l, list, sel]) =>
      `<div><div class="l">${l} <small>(ninguno = todos)</small></div><div class="check-list">${list.map(x => `<label class="row"><input type="checkbox" name="${n}" value="${x.id}" ${x.id === sel ? 'checked' : ''}> ${h(x.name)}</label>`).join('')}</div></div>`).join('')}</div>
    <div class="field-row"><div><label class="l">Últimas N tareas</label><input type="number" name="last_n" value="10" min="1" max="50"></div><div><label class="l">Desde</label><input type="date" name="from"></div><div><label class="l">Hasta</label><input type="date" name="to"></div></div>
    <button class="btn sm" id="cvDig">Generar informe</button>
    <label class="l">Informe (editable antes de enviar)</label><textarea name="digest_md" id="cvMd" rows="8" placeholder="Pulsa «Generar informe»"></textarea>
    <h3>2 · Lentes: ¿qué tipo de mejora buscas?</h3>
    <div class="grid3">${Object.entries(L).map(([k, [n, desc]]) => `<label class="row" style="font-size:var(--fs-md);align-items:flex-start" title="${h(desc)}"><input type="checkbox" name="lens" value="${k}" ${['siguiente'].includes(k) ? 'checked' : ''}><span><b>${h(n)}</b><br><small>${h(desc).slice(0, 70)}</small></span></label>`).join('')}</div>
    <label class="l">Pedido libre (lente «Libre»)</label><input name="custom" placeholder="p. ej. ¿cómo reducimos los tiempos de respuesta?">
    <h3>3 · ¿Quién opina?</h3>
    ${agentsOn().map((a, i) => `<div class="row" style="margin:4px 0"><label class="row" style="min-width:170px"><input type="checkbox" name="ag" value="${a.id}" ${i === 0 ? 'checked' : ''}>${agentSprite(a, 2)} ${h(a.name)}</label>
      <select style="max-width:220px" data-m="${a.id}">${modelOpts(a)}</select>
      <select style="max-width:120px" data-e="${a.id}">${opts(a.efforts.map(e => [e, e]), a.default_effort)}</select></div>`).join('')}
    <label class="l">Moderador (consolida si opinan varios)</label><select name="moderator">${opts(agentsOn().map(a => [a.id, a.name]), '', 'Sin moderador (consolidación automática)')}</select>
    <div class="row" style="margin-top:12px"><button class="btn y" id="cvOk">Convocar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
  const scope = () => {
    const ms = n => $$(`[name=${n}]:checked`, d).map(c => +c.value);
    return { project_ids: ms('project_ids'), area_ids: ms('area_ids'), agent_ids: ms('agent_ids'), last_n: +d.querySelector('[name=last_n]').value, from: d.querySelector('[name=from]').value, to: d.querySelector('[name=to]').value };
  };
  $('#cvDig', d).onclick = async e => { e.preventDefault(); try { $('#cvMd', d).value = (await post('/api/council/digest', { scope: scope() })).digest_md; } catch (err) { fail(err); } };
  $('#cvOk', d).onclick = async e => {
    e.preventDefault();
    const agents = $$('[name=ag]:checked', d).map(c => ({ agent_id: +c.value, model: $(`[data-m="${c.value}"]`, d).value, effort: $(`[data-e="${c.value}"]`, d).value }));
    const lenses = $$('[name=lens]:checked', d).map(c => c.value);
    if (!agents.length || !lenses.length) return fail('Elige al menos un agente y un lente');
    const mod = +d.querySelector('[name=moderator]').value;
    try {
      const r = await post('/api/council', { scope: scope(), digest_md: $('#cvMd', d).value || undefined, lenses, custom: d.querySelector('[name=custom]').value, agents, moderator: mod ? { agent_id: mod } : null });
      closeModal(); beep('ok'); go('#/consejo/' + r.id);
    } catch (err) { fail(err); }
  };
}

// ===================== ARCHIVOS JEDI =====================
const TABS = [['buscar', 'Buscar'], ['chats', 'Chats'], ['tareas', 'Tareas'], ['ejecuciones', 'Ejecuciones'], ['relevos', 'Relevos'], ['notificaciones', 'Notificaciones'], ['bitacora', 'Holocrón (bitácora)'], ['consejos', 'Consejos'], ['papelera', 'Papelera']];
const COLSDEF = {
  chats: [['#', r => r.id], ['Chat', r => `${h(r.title)}<br><small>${r.kind === 'tarea' ? 'de tarea #' + r.task_id : 'consulta rápida'}</small>`], ['Agente', r => agentChip(r.agent_id)], ['Modelo', r => h(`${r.model || ''} ${r.effort || ''}`)], ['Turnos', r => r.turnos], ['Tokens', r => num(r.tokens)], ['Autor', r => userChip(r.created_by)], ['Actualizado', r => fmtDate(r.updated_at)]],
  tareas: [['#', r => r.id], ['Tarea', r => h(r.title)], ['Proyecto', r => h(project(r.project_id)?.name || '')], ['Área', r => h(area(r.area_id)?.name || '')], ['Estado', r => chip(r.status)], ['Ejecuta', r => r.executor === 'humano' ? 'persona' : agentChip(r.agent_id)], ['Runs', r => r.runs], ['Relevos', r => r.relevos], ['Creó', r => userChip(r.created_by)], ['Actualizada', r => fmtDate(r.updated_at)]],
  ejecuciones: [['#', r => r.id], ['Tarea/Chat', r => r.task_id ? `tarea #${r.task_id}` : `chat #${r.conversation_id}`], ['Agente', r => agentChip(r.agent_id)], ['Modelo', r => h(`${r.model || ''} ${r.effort || ''}`)], ['Inicio', r => fmtDate(r.started_at)], ['Duración', r => r.ended_at ? dur((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) : '…'], ['Fin', r => h(r.end_reason || 'en curso')], ['Arranque', r => r.first_out_at ? dur((Date.parse(r.first_out_at) - Date.parse(r.started_at)) / 1000) : '—'], ['Tokens', r => num(r.tokens_in + r.tokens_out)], ['Caché', r => r.tokens_in ? Math.round((r.tokens_cache || 0) / r.tokens_in * 100) + '%' : '—'], ['Costo', r => '$' + (r.cost_usd || 0).toFixed(3)], ['Lanzó', r => userChip(r.started_by)]],
  relevos: [['#', r => r.id], ['Tarea', r => `#${r.task_id}`], ['De', r => agentChip(r.from_agent_id)], ['A', r => r.to_user_id ? userChip(r.to_user_id) : r.to_agent_id ? agentChip(r.to_agent_id) : 'pendiente'], ['Motivo', r => h(r.reason)], ['Commit', r => h(r.commit_sha || '')], ['Cuándo', r => fmtDate(r.at)]],
  notificaciones: [['Tipo', r => h(r.kind)], ['Título', r => h(r.title)], ['Detalle', r => `<small>${h(r.body).slice(0, 160)}</small>`], ['Cuándo', r => fmtDate(r.at)], ['Leída', r => r.seen ? '✔' : '●']],
  bitacora: [['Cuándo', r => fmtDate(r.at)], ['Quién', r => h(r.user || 'sistema')], ['Entidad', r => `${h(r.entity)} ${r.entity_id ? '#' + r.entity_id : ''}`], ['Acción', r => h(r.action)], ['Detalle', r => `<small>${h(r.detail).slice(0, 200)}</small>`]],
  consejos: [['#', r => r.id], ['Fecha', r => fmtDate(r.at)], ['Lentes', r => h(JSON.parse(r.lenses || '[]').join(', '))], ['Estado', r => h(r.status)], ['Aceptadas', r => `${r.aceptadas}/${r.propuestas}`]],
  papelera: [['Tipo', r => ({ projects: 'Proyecto', tasks: 'Tarea', conversations: 'Chat' }[r.entity])], ['#', r => r.id], ['Título', r => h(r.title)], ['Eliminado', r => fmtDate(r.deleted_at)], ['', r => `<button class="btn sm g" data-restore="${r.entity}:${r.id}">Restaurar</button>${isAdmin() ? `<button class="btn sm r" data-purge="${r.entity}:${r.id}">Purgar</button>` : ''}`]],
};
const LINK = {
  chats: r => r.kind === 'tarea' && r.task_id ? '#/tarea/' + r.task_id : '#/cantina/' + r.id, tareas: r => '#/tarea/' + r.id, consejos: r => '#/consejo/' + r.id,
  notificaciones: r => r.link, bitacora: r => r.entity === 'tarea' ? '#/tarea/' + r.entity_id : r.entity === 'chat' ? '#/cantina/' + r.entity_id : r.entity === 'consejo' ? '#/consejo/' + r.entity_id : null,
};
// valores del filtro «estado» según la pestaña (el servidor lo aplica a status, end_reason o kind)
const stFilter = tab => ({ // función: NOTIF_KINDS se declara más abajo
  tareas: ['Estado', Object.entries(STATUS)],
  ejecuciones: ['Fin', ['listo', 'consulta', 'cuota', 'error', 'abortado', 'timeout', 'sin_marcador', 'interrumpido'].map(x => [x, x.replace('_', ' ')])],
  notificaciones: ['Tipo', NOTIF_KINDS],
})[tab];
const archivos = {
  async render(el, r) {
    const tab = r.args[0] || 'buscar';
    const f = S.af ||= {};
    const q = { ...f, ...(tab === 'buscar' ? { q: r.query.q ?? f.sq ?? '' } : {}) };
    let bodyHTML = '';
    if (tab === 'buscar') {
      const res = q.q ? await get('/api/search?q=' + encodeURIComponent(q.q)) : [];
      f.sq = q.q;
      bodyHTML = `<form id="sF" class="row"><input id="sQ" value="${h(q.q)}" placeholder="Buscar en tareas, chats y proyectos…" style="max-width:520px"><button class="btn y">Buscar</button></form>
        <div style="margin-top:12px">${res.map(x => `<div class="inbox-item" data-link="${h(x.link)}"><span class="chip">${h(x.kind)}</span> <b>${h(x.title || '')}</b><div><small>${h(x.snip).replace(/«/g, '<mark>').replace(/»/g, '</mark>')}</small></div></div>`).join('') || (q.q ? '<div class="empty">Sin resultados</div>' : '<div class="empty">Escribe algo para buscar en todo el historial</div>')}</div>`;
    } else {
      const qs = new URLSearchParams(Object.entries({ ...f, page: f.page || 1 }).filter(([k, v]) => v && k !== 'sq')).toString();
      const data = await get(`/api/history/${tab}?${qs}`);
      const cols = COLSDEF[tab];
      bodyHTML = `<div class="row" style="margin-bottom:10px">
        <select id="afU" style="width:auto">${opts(S.boot.users.map(u => [u.id, u.name]), f.user_id, 'Usuario')}</select>
        <select id="afG" style="width:auto">${opts(S.boot.agents.map(a => [a.id, a.name]), f.agent_id, 'Agente')}</select>
        <select id="afP" style="width:auto">${opts(S.boot.projects.map(p => [p.id, p.name]), f.project_id, 'Proyecto')}</select>
        <select id="afA" style="width:auto">${opts(S.boot.areas.map(a => [a.id, a.name]), f.area_id, 'Área')}</select>
        ${stFilter(tab) ? `<select id="afS" style="width:auto">${opts(stFilter(tab)[1], f.status, stFilter(tab)[0])}</select>` : tab === 'bitacora' ? `<input id="afS" style="max-width:180px" placeholder="entidad: tarea, chat, git…" value="${h(f.status || '')}">` : ''}<input id="afF" type="date" style="max-width:170px" value="${h(f.from || '')}"><input id="afT" type="date" style="max-width:170px" value="${h(f.to || '')}">
        <input id="afQ" style="max-width:200px" placeholder="texto" value="${h(f.q || '')}"><button class="btn sm" id="afGo">Filtrar</button><button class="btn sm ghost" id="afClr">Limpiar</button>
        <a class="btn sm o" href="/api/history/${tab}?${qs}&format=csv">CSV</a></div>
        <div class="panel table-wrap"><table class="grid"><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>
        ${data.rows.map((row, i) => `<tr class="click" data-i="${i}">${cols.map(c => `<td>${c[1](row)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">Vacío</td></tr>`}</table></div>
        <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="pgP" ${data.page <= 1 ? 'disabled' : ''}>◀</button><span>Página ${data.page} de ${Math.max(1, Math.ceil(data.total / data.size))} · ${data.total} registros</span><button class="btn sm ghost" id="pgN" ${data.page * data.size >= data.total ? 'disabled' : ''}>▶</button></div>`;
      S.arows = data.rows;
    }
    el.innerHTML = `<h1>Archivos Jedi</h1><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${bodyHTML}`;
    $$('[data-t]', el).forEach(b => b.onclick = () => { f.page = 1; delete f.status; go('#/archivos/' + b.dataset.t); }); // el estado significa otra cosa en cada pestaña
    $('#sF', el)?.addEventListener('submit', e => { e.preventDefault(); go('#/archivos/buscar?q=' + encodeURIComponent($('#sQ').value)); });
    const apply = () => { Object.assign(f, { user_id: $('#afU').value, agent_id: $('#afG').value, project_id: $('#afP').value, area_id: $('#afA').value, status: $('#afS')?.value || '', from: $('#afF').value, to: $('#afT').value, q: $('#afQ').value, page: 1 }); route(true); };
    $('#afGo', el)?.addEventListener('click', apply);
    $('#afQ', el)?.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
    $('#afClr', el)?.addEventListener('click', () => { for (const k of Object.keys(f)) if (k !== 'sq') delete f[k]; route(true); });
    $('#pgP', el)?.addEventListener('click', () => { f.page = (f.page || 1) - 1; route(true); });
    $('#pgN', el)?.addEventListener('click', () => { f.page = (f.page || 1) + 1; route(true); });
    el.onclick = async e => {
      const rs = e.target.closest('[data-restore]'); if (rs) { const [entity, id] = rs.dataset.restore.split(':'); await act(() => post('/api/restore', { entity, id: +id }), 'Restaurado'); await loadBoot(); return route(true); }
      const pg = e.target.closest('[data-purge]'); if (pg) { if (await confirmBox('¿Borrar definitivamente? No se puede deshacer.', 'Purgar', true)) { const [entity, id] = pg.dataset.purge.split(':'); await act(() => post('/api/purge', { entity, id: +id })); route(true); } return; }
      const lk = e.target.closest('[data-link]'); if (lk) return go(lk.dataset.link);
      const tr = e.target.closest('tr[data-i]'); if (!tr || e.target.closest('a,button')) return;
      const row = S.arows[+tr.dataset.i];
      if (tab === 'ejecuciones') { const lg = await get(`/api/runs/${row.id}/log`); return modal(`<h2>Ejecución #${row.id}</h2><small>${h(lg.run.command || '')}</small><div class="console">${logHTML(lg.log)}</div><button class="btn ghost" value="c">Cerrar</button>`); }
      if (tab === 'relevos') { const hd = await get('/api/handoffs/' + row.id); return modal(`<h2>Relevo #${row.id}</h2><div class="chat">${md(hd.snapshot_md)}</div><div class="row"><a class="btn y" href="#/tarea/${row.task_id}" data-close>Ir a la tarea</a><button class="btn ghost" value="c">Cerrar</button></div>`); }
      const l = LINK[tab]?.(row); if (l) go(l);
    };
  },
};

// ===================== PUENTE DE MANDO =====================
const lvl = p => p >= 90 ? 'var(--red)' : p >= 75 ? 'var(--yellow)' : 'var(--green)';
const STATE = { disponible: ['ok', 'Disponible'], ocupado: ['warn', 'Ocupado'], sin_cuota: ['bad', 'Sin cuota'], error: ['bad', 'Error'], no_encontrado: ['bad', 'No encontrado'], deshabilitado: ['off', 'Deshabilitado'] };
const WINL = { five_hour: '5 horas', seven_day: '7 días', primary: 'primaria', secondary: 'secundaria', seven_day_opus: '7 días Opus', seven_day_sonnet: '7 días Sonnet' };
const puente = {
  refreshOn: ['status.scan', 'agent.status', 'run.started', 'task.updated', 'machine.status'],
  event(type) { if (type === 'run.log') return 'handled'; },
  async render(el) {
    const [s, hist] = await Promise.all([get('/api/status'), get('/api/status/history?hours=24')]);
    const card = a => {
      const [d, l] = STATE[a.state] || ['warn', a.state];
      const snaps = hist.filter(x => x.agent_id === a.id).slice(-48);
      const max = Math.max(1, ...snaps.map(x => x.detail.usage5h?.tokens || 0));
      return `<div class="panel agent-card" style="--c:${a.color}"><div class="row">${agentSprite(a, 4)}<div class="grow"><h2 style="margin:0;color:${a.color}">${h(a.name)}</h2><span class="dot ${d}"></span> <b>${l}</b>${a.state === 'sin_cuota' && a.quota_reset_at ? ` · vuelve ${ago(a.quota_reset_at)}` : ''}</div>
        <div class="col-flex" style="gap:0">${canEdit() ? `<button class="btn sm" data-test="${a.id}">Probar</button>` : ''}${a.state === 'sin_cuota' && canEdit() ? `<button class="btn sm y" data-react="${a.id}">Reactivar</button>` : ''}</div></div>
        <div style="margin-top:6px">${agentLimitsBadge(a)}</div>
        <div class="kv" style="margin-top:8px"><b>Versión</b><span>${h(a.version || (a.found === false ? 'no encontrado' : '—'))}</span><b>Ejecutable</b><span class="ellipsis" title="${h(a.exe)}">${h(a.exe)}</span>
          <b>Trabajo</b><span>${a.busy}/${a.max_concurrent} activos · ${a.queued} en cola</span><b>Por defecto</b><span>${h(a.default_model)} · ${h(a.default_effort)}</span>
          <b>Éxito</b><span>${a.success_rate ?? '—'}% · media ${a.avg_duration_s != null ? dur(a.avg_duration_s) : '—'} · ${a.tasks_done} tareas</span>
          <b>Cortes cuota 7d</b><span>${a.quota_cuts_7d}${a.last_quota_cut ? ' · último ' + ago(a.last_quota_cut) : ''}</span>
          ${a.last_test ? `<b>Última prueba</b><span>${a.last_test.ok ? '✔ OK' : '✘ ' + h(a.last_test.error || a.last_test.end_reason || 'falló')} · ${a.last_test.latency_ms ? dur(a.last_test.latency_ms / 1000) : ''} · ${ago(a.last_test.at)}</span>` : ''}
          ${a.last_error ? `<b>Último error</b><span class="t-red">${h(a.last_error).slice(0, 180)}</span>` : ''}</div>
        <h3>Límites informados por el CLI</h3>${a.limits_cli.map(x => `<div class="limit"><span>${h(WIN_LABELS[x.win] || WINL[x.win] || x.win)}</span>${saber(x.used_value, lvl(x.used_value))}<span>${Math.round(x.used_value)}%${x.resets_at ? `<br><small>${ago(x.resets_at)}</small>` : ''}</span></div>`).join('') || '<small class="muted">No informado por el CLI (se capturan al ejecutar)</small>'}
        ${a.limits_manual.length ? `<h3>Límites manuales</h3>${a.limits_manual.map(x => `<div class="limit"><span>${h(x.win)} ${h(x.metric)}</span>${saber(x.pct, lvl(x.pct))}<span>${x.pct}%<br><small>${num(Math.round(x.used_value * 100) / 100)}/${num(x.limit_value)}</small></span></div>`).join('')}` : ''}
        <h3>Consumo medido</h3><table class="grid"><tr><th></th><th>Tokens</th><th>Costo</th><th>Runs</th></tr>${Object.entries(a.usage).map(([w, u]) => `<tr><td>${w}</td><td>${num(u.tokens)}</td><td>$${u.usd.toFixed(2)}</td><td>${u.runs}</td></tr>`).join('')}</table>
        <h3>Tokens (ventana 5h) · últimas 24h</h3><div class="spark" style="--c:${a.color}">${snaps.map(x => `<i style="height:${Math.max(2, (x.detail.usage5h?.tokens || 0) / max * 100)}%" title="${fmtDate(x.at)} · ${x.state}"></i>`).join('') || '<small class="muted">sin datos</small>'}</div></div>`;
    };
    el.innerHTML = `<div class="row"><h1 style="margin:0">Puente de Mando</h1><small class="muted">último escaneo ${ago(s.last_scan)}</small>
      <span class="right">${canEdit() ? '<button class="btn y" id="scan">Escanear ahora</button><button class="btn" id="ntest">Notificación de prueba</button><button class="btn ghost" id="ttest">Toast Windows</button>' : ''}
      ${isAdmin() ? (s.queue_paused ? '<button class="btn g" id="resume">Reanudar cola</button>' : '<button class="btn r" id="o66">ORDEN 66</button>') : ''}</span></div>
      ${s.queue_paused ? '<div class="panel r" style="margin:10px 0">La cola está en pausa: nada nuevo se ejecuta.</div>' : ''}
      <h2>Máquinas</h2><div class="grid3">${s.machines.map(m => `<div class="panel ${m.online ? 'h' : 'r'}"><div class="row">${sprite('desk', cssVar(m.online ? '--green' : '--red'), 3)}<div class="grow"><b class="lbl-up">${h(m.name)}</b>${m.is_default ? ' ★' : ''}<br>
        <span class="dot ${m.online ? 'ok' : 'bad'}"></span> ${m.online ? 'conectada' : 'desconectada'} · ${m.is_local ? 'este servidor' : 'agente de campo'}</div></div>
        <div class="kv" style="margin-top:6px"><b>Visto</b><span>${ago(m.last_seen)}</span><b>Equipo</b><span>${h(m.info?.hostname || '-')} ${h(m.info?.platform || '')}</span><b>Ejecutando</b><span>${m.running}</span>${m.info?.roots ? `<b>Raíces</b><span class="ellipsis">${h(m.info.roots.join(', '))}</span>` : ''}</div></div>`).join('') || `<div class="panel r">No hay máquinas. ${isAdmin() ? '<a href="#/config/maquinas">Conecta esta PC</a>' : ''}</div>`}</div>
      <h2>Agentes</h2><div class="grid2">${s.agents.filter(a => a.enabled || a.found !== false).map(card).join('')}</div>
      <h2>Trabajo en curso</h2><div class="panel table-wrap"><table class="grid"><tr><th>Run</th><th>Tarea / chat</th><th>Agente</th><th>Modelo</th><th>PID</th><th>Memoria</th><th>CPU</th><th>Desde</th><th></th></tr>
        ${s.work.active.map(w => `<tr><td>${w.run_id}</td><td><a href="${w.task_id ? '#/tarea/' + w.task_id : '#/cantina/' + w.conv_id}">${h(w.title || '')}</a></td><td>${agentChip(w.agent_id)}</td><td>${h(w.model || '')} ${h(w.effort || '')}</td><td>${w.pid}</td><td>${h(w.mem || '-')}</td><td>${h(w.cpu_time || '-')}</td><td>${ago(w.started_at)}</td>
        <td>${canEdit() ? `<button class="btn sm r" data-abort="${w.task_id ? 't' + w.task_id : 'c' + w.conv_id}">Abortar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Ningún droide trabajando</td></tr>'}</table>
        <p>En cola: ${s.work.queue.map(q => h(q.title)).join(', ') || '—'} · Bloqueadas: ${s.work.blocked} · Fallidas 24h: ${s.work.failed_24h} · Permisos pendientes: ${s.work.permissions.length}</p>
        <h3>Esperando a un humano</h3>${[...s.work.waiting.map(t => `<a href="#/tarea/${t.id}">#${t.id} ${h(t.title)}</a> ${chip(t.status)}`), ...s.work.waiting_chats.map(c => `<a href="#/cantina/${c.id}">${ic('chat', 'sm')} ${h(c.title)}</a>`)].join(' · ') || '<small class="muted">nada</small>'}</div>
      <h2>Carpetas y git</h2><div class="panel table-wrap"><table class="grid"><tr><th>Proyecto</th><th>Carpeta</th><th>Estado</th><th>Rama</th><th>Sin commit</th><th>Worktrees</th><th>Libre</th></tr>
        ${s.folders.map(f => `<tr><td>${h(f.project)}</td><td><b>${h(f.label)}</b><br><small>${h(f.path)}</small></td><td><span class="dot ${f.exists ? 'ok' : 'bad'}"></span> ${f.exists ? (f.is_git ? 'git' : 'sin git') : 'NO EXISTE'}</td><td>${h(f.branch || '-')}</td><td>${f.dirty ?? '-'}</td>
        <td>${f.worktrees.map(w => `<div><small>${h(w.path.split(/[\\/]/).pop())} ${w.task_id ? `<a href="#/tarea/${w.task_id}">#${w.task_id}</a>` : ''}</small>${w.orphan && canEdit() ? ` <button class="btn sm r" data-clean="${f.id}|${h(w.path)}">Limpiar</button>` : ''}</div>`).join('') || '-'}</td><td>${bytes(f.free_bytes)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin carpetas asociadas</td></tr>'}</table></div>
      <h2>Sistema</h2><div class="panel"><div class="kv"><b>Activo desde</b><span>${dur(s.system.uptime_s)}</span><b>Node</b><span>${h(s.system.node)} · PID ${s.system.pid}</span><b>Base de datos</b><span>${bytes(s.system.db_bytes)}</span>
        <b>Logs / sandbox</b><span>${bytes(s.system.runs_bytes)} / ${bytes(s.system.sandbox_bytes)}</span><b>Respaldos</b><span>${s.system.backups} · último ${h(s.system.last_backup || 'ninguno')}</span><b>Pestañas conectadas</b><span>${s.system.sse_clients}</span></div>
        <h3>Errores recientes del servidor</h3>${s.system.errors.map(e => `<div><small>${fmtDate(e.at)}</small> <code>${h(e.msg).slice(0, 300)}</code></div>`).join('') || '<small class="muted">Ninguno. La Fuerza está equilibrada.</small>'}</div>`;
    const on = (sel, fn) => $(sel, el)?.addEventListener('click', fn);
    on('#scan', async () => { holo('Escaneando…'); await act(() => post('/api/status/scan')); refreshSoon(0); });
    on('#ntest', () => act(() => post('/api/notify/test')));
    on('#ttest', () => act(() => post('/api/notify/test?toast=1'), 'Toast enviado a Windows'));
    on('#o66', async () => { if (await confirmBox('ORDEN 66: abortar TODAS las ejecuciones y pausar la cola?', 'Ejecutar la orden', true)) { const r = await act(() => post('/api/order66')); holo('Orden 66 ejecutada', `${r.stopped} ejecuciones detenidas`, { err: true }); } });
    on('#resume', () => act(() => post('/api/queue/resume'), 'Cola reanudada'));
    el.onclick = async e => {
      const t = e.target.closest('[data-test]'); if (t) { t.disabled = true; t.textContent = 'Probando…'; try { const r = await post(`/api/agents/${t.dataset.test}/test`); holo(r.ok ? 'Prueba OK' : 'Prueba falló', r.ok ? `Respondió "${r.reply}" en ${dur(r.latency_ms / 1000)}` : (r.error || r.end_reason), { err: !r.ok }); } catch (err) { fail(err); } refreshSoon(0); }
      const rc = e.target.closest('[data-react]'); if (rc) act(() => post(`/api/agents/${rc.dataset.react}/reactivate`), 'Agente reactivado');
      const ab = e.target.closest('[data-abort]'); if (ab) { const k = ab.dataset.abort; act(() => post(k[0] === 't' ? `/api/tasks/${k.slice(1)}/abort` : `/api/conversations/${k.slice(1)}/abort`), 'Abortando…'); }
      const cl = e.target.closest('[data-clean]'); if (cl) { const [folder_id, path] = cl.dataset.clean.split('|'); await act(() => post('/api/worktrees/clean', { folder_id: +folder_id, path }), 'Worktree eliminado'); refreshSoon(0); }
    };
  },
};

// ===================== CONFIGURACIÓN =====================
const NOTIF_KINDS = [['consulta', 'Consultas de agentes'], ['permiso', 'Permisos (modo supervisado)'], ['revision', 'Tareas listas para revisión'], ['cuota', 'Agente sin cuota'], ['fallo', 'Fallos'], ['relevo', 'Relevos'], ['consejo', 'Consejo terminado'], ['limite', 'Límite al 80%'], ['agente', 'Agente disponible'], ['sistema', 'Sistema']];
const config = {
  event(type, d) {
    if (type === 'marcacion.log') {
      const c = $('#marcarConsole');
      if (c) {
        c.style.display = 'block';
        appendLog(c, d.line);
      }
      return 'handled';
    }
    if (type === 'marcacion.status') {
      const b = $('#btnMarcar');
      const st = $('#marcarState');
      if (d.running) {
        if (b) b.disabled = true;
        if (st) { st.hidden = false; st.textContent = 'ejecutando...'; st.className = 'chip'; }
      } else {
        if (b) b.disabled = false;
        if (st) {
          st.hidden = false;
          st.textContent = d.error ? 'error' : (d.code === 0 ? 'completado' : 'código ' + d.code);
          st.className = 'chip ' + (d.code === 0 && !d.error ? 'g' : 'r');
        }
      }
      return 'handled';
    }
  },
  async render(el, r) {
    const admin = isAdmin();
    const tabs = [...(admin ? [['maquinas', 'Máquinas'], ['agentes', 'Agentes'], ['areas', 'Áreas'], ['usuarios', 'Usuarios'], ['limites', 'Límites'], ['auto', 'Automatización']] : []), ['plantillas', 'Plantillas'], ['apariencia', 'Apariencia'], ['perfil', 'Mi perfil']];
    const tab = tabs.find(t => t[0] === r.args[0]) ? r.args[0] : tabs[0][0];
    let body = '';
    if (tab === 'maquinas') {
      const [ms, pcs] = await Promise.all([get('/api/machines'), get('/api/pc')]);
      body = `<p class="muted">Una máquina es donde se ejecutan los agentes y viven los archivos. Si la oficina corre en el VPS, conecta tu PC con el <b>agente de campo</b>: sale hacia el VPS por HTTPS (no abre puertos) y ejecuta aquí Claude, Codex, git y archivos.</p>
        <div class="panel table-wrap"><table class="grid"><tr><th>Máquina (agente de campo)</th><th>Tipo</th><th>Estado</th><th>Equipo</th><th>Visto</th><th></th></tr>
        ${ms.map(m => `<tr><td><b>${h(m.name)}</b>${m.is_default ? ' ★ por defecto' : ''}</td><td>${m.is_local ? 'este servidor' : 'agente de campo'}</td><td><span class="dot ${m.online ? 'ok' : 'bad'}"></span> ${m.online ? 'conectada' : 'desconectada'}</td>
          <td>${h(m.info?.hostname || '-')}<br><small>${h((m.info?.roots || []).join(', '))}</small></td><td>${ago(m.last_seen)}</td>
          <td>${m.is_default ? '' : `<button class="btn sm y" data-mdef="${m.id}">Por defecto</button>`}<button class="btn sm ghost" data-mren="${m.id}">Renombrar</button>${m.is_local ? '' : `<button class="btn sm r" data-mdel="${m.id}">Eliminar</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin agentes de campo</td></tr>'}</table></div>
        <h3 style="margin-top:16px">Máquinas zer0 (Windows)</h3>
        <p class="muted">Máquinas con zer0 conectado para control remoto visual paso a paso desde la oficina.</p>
        <div class="panel table-wrap"><table class="grid"><tr><th>Máquina</th><th>Estado</th><th>Equipo</th><th>Visto</th><th></th></tr>
        ${pcs.map(p => `<tr><td><b>${h(p.name)}</b></td><td><span class="dot ${p.online ? 'ok' : 'bad'}"></span> ${p.online ? 'conectada' : 'desconectada'}</td>
          <td>${h((p.info?.host || p.info?.hostname) || '-')}</td><td>${ago(p.last_seen)}</td>
          <td><a class="btn sm y" href="#/pc/${p.id}">Controlar</a><button class="btn sm ghost" data-mren="${p.id}">Renombrar</button><button class="btn sm r" data-mdel="${p.id}">Eliminar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin máquinas zer0 registradas</td></tr>'}</table></div>
        <form class="panel" id="newMachine" style="margin-top:16px"><h3>Conectar una PC</h3>
          <div class="field-row">
            <div><label class="l">Tipo</label><select name="kind"><option value="worker">Agente de campo</option><option value="zer0">zer0 (Windows)</option></select></div>
            <div><label class="l">Nombre</label><input name="name" required placeholder="PC de la oficina"></div>
          </div>
          <button class="btn y" style="margin-top:10px">Generar token</button></form>`;
    } else if (tab === 'agentes') {
      const list = await get('/api/agents');
      body = list.map(a => `<form class="panel agent-card" data-agent="${a.id}" style="--c:${a.color};margin-bottom:14px">
        <div class="row">${agentSprite(a, 4)}<h2 style="margin:0;color:${a.color}">${h(a.name)}</h2><span class="chip">${h(a.key)} · adaptador ${h(a.adapter)}</span><label class="row right"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''}> habilitado</label></div>
        <div class="field-row"><div><label class="l">Nombre</label><input name="name" value="${h(a.name)}"></div><div><label class="l">Color</label><input type="color" name="color" value="${h(a.color || '#4fc3f7')}" style="height:40px"></div>
          <div><label class="l">Concurrencia máx.</label><input type="number" name="max_concurrent" min="1" value="${a.max_concurrent}"></div><div><label class="l">Timeout (min)</label><input type="number" name="timeout_min" min="1" value="${a.timeout_min}"></div></div>
        <label class="l">Ejecutable</label><input name="exe" value="${h(a.exe)}">
        <div class="field-row"><div><label class="l">Args previos (JSON)</label><input name="pre_args" value="${h(JSON.stringify(a.pre_args))}"></div><div><label class="l">Args extra (JSON, al final)</label><input name="extra_args" value="${h(JSON.stringify(a.extra_args))}"></div></div>
        <label class="l">Modelos (separados por coma)</label><div class="row" style="flex-wrap:nowrap"><input name="models" value="${h(a.models.join(', '))}"><button class="btn sm" data-detect="${a.id}" type="button">Detectar</button></div>
        <div class="field-row"><div><label class="l">Esfuerzos</label><input name="efforts" value="${h(a.efforts.join(', '))}"></div><div><label class="l">Modelo por defecto</label><input name="default_model" value="${h(a.default_model)}"></div><div><label class="l">Esfuerzo por defecto</label><input name="default_effort" value="${h(a.default_effort)}"></div></div>
        <label class="l">Precios USD por 1M tokens (modelo = entrada / salida / caché, uno por línea)</label><textarea name="prices" rows="4">${h(Object.entries(a.prices || {}).map(([m, p]) => `${m} = ${p.join(' / ')}`).join('\n'))}</textarea>
        <label class="l">Patrones de cuota agotada (regex, uno por línea)</label><textarea name="quota_patterns" rows="3">${h(a.quota_patterns.join('\n'))}</textarea>
        <div class="row"><button class="btn y">Guardar</button><button class="btn" type="button" data-test="${a.id}">Probar</button>${a.last_test ? `<small>${a.last_test.ok ? '✔' : '✘'} ${ago(a.last_test.at)}</small>` : ''}</div></form>`).join('') +
        `<details class="panel"><summary class="lbl-up" style="cursor:pointer">+ Agregar agente</summary><form id="newAg"><div class="field-row"><div><label class="l">Clave</label><input name="key" required></div><div><label class="l">Nombre</label><input name="name"></div>
        <div><label class="l">Adaptador</label><select name="adapter">${opts([['claude', 'claude'], ['codex', 'codex'], ['agy', 'agy'], ['commandcode', 'commandcode'], ['fake', 'fake (pruebas)']], 'claude')}</select></div></div>
        <label class="l">Ejecutable</label><input name="exe" required><button class="btn y" style="margin-top:10px">Crear</button></form></details>`;
    } else if (tab === 'areas') {
      body = S.boot.areas.map(a => `<form class="panel" data-area="${a.id}" style="margin-bottom:12px;border-color:${a.color}"><div class="row">${icon(a.icon, 4)}<h2 style="margin:0">${h(a.name)}</h2></div>
        <div class="field-row"><div><label class="l">Nombre</label><input name="name" value="${h(a.name)}"></div><div><label class="l">Alias</label><input name="alias" value="${h(a.alias)}"></div>
        <div><label class="l">Icono</label><select name="icon">${opts(ICON_NAMES.map(i => [i, i]), a.icon)}</select></div><div><label class="l">Color</label><input type="color" name="color" value="${h(a.color)}" style="height:40px"></div>
        <div><label class="l">Sala en el mapa</label><select name="room">${opts(ROOMS, a.room, 'Solo en «Más salas»')}</select></div></div>
        <div class="field-row"><div><label class="l">Agente por defecto</label><select name="default_agent_id">${opts(S.boot.agents.map(x => [x.id, x.name]), a.default_agent_id, '—')}</select></div>
        <div><label class="l">Cadena de relevo (claves en orden)</label><input name="chain" value="${h(a.fallback_chain.map(id => agent(id)?.key).filter(Boolean).join(', '))}" placeholder="claude, codex, commandcode"></div></div>
        <label class="row"><input type="checkbox" name="auto_fallback" ${a.auto_fallback ? 'checked' : ''}> Relevo automático al siguiente de la cadena si un agente se queda sin cuota</label>
        <div class="row"><button class="btn y">Guardar</button><button class="btn r" type="button" data-delarea="${a.id}">Eliminar área</button></div></form>`).join('') +
        `<form class="panel" id="newArea"><h3>Nueva área (sala)</h3><div class="field-row"><div><label class="l">Nombre</label><input name="name" required placeholder="QA"></div><div><label class="l">Alias</label><input name="alias" placeholder="Sala de pruebas de Kamino"></div><div><label class="l">Icono</label><select name="icon">${opts(ICON_NAMES.map(i => [i, i]), 'radar')}</select></div><div><label class="l">Sala en el mapa</label><select name="room">${opts(ROOMS, '', 'Solo en «Más salas»')}</select></div></div><button class="btn y" style="margin-top:10px">Crear área</button></form>`;
    } else if (tab === 'usuarios') {
      const users = await get('/api/users');
      body = `<div class="panel table-wrap"><table class="grid"><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Creado</th><th></th></tr>${users.map(u => `<tr><td>${h(u.username)}${u.deleted_at ? ' <small>(eliminado)</small>' : ''}</td><td>${h(u.name)}</td>
        <td><select data-role="${u.id}" style="width:auto">${opts([['admin', 'admin'], ['operador', 'operador'], ['observador', 'observador']], u.role)}</select></td><td>${fmtDate(u.created_at)}</td>
        <td><button class="btn sm" data-pw="${u.id}">Contraseña</button>${u.deleted_at ? `<button class="btn sm g" data-undel="${u.id}">Reactivar</button>` : `<button class="btn sm r" data-deluser="${u.id}">Eliminar</button>`}</td></tr>`).join('')}</table></div>
        <form class="panel" id="newUser" style="margin-top:12px"><h3>Nuevo usuario</h3><div class="field-row"><div><label class="l">Usuario</label><input name="username" required></div><div><label class="l">Nombre</label><input name="name"></div>
        <div><label class="l">Rol</label><select name="role">${opts([['operador', 'operador'], ['observador', 'observador'], ['admin', 'admin']], 'operador')}</select></div><div><label class="l">Contraseña</label><input name="password" type="password" minlength="6" required></div></div><button class="btn y" style="margin-top:10px">Crear</button></form>`;
    } else if (tab === 'limites') {
      const lims = await get('/api/limits');
      body = `<p class="muted">Límites propios para vigilar consumo (la oficina los mide con sus ejecuciones). Al llegar al 80% se notifica.</p><div class="panel table-wrap"><table class="grid"><tr><th>Agente</th><th>Ventana</th><th>Métrica</th><th>Límite</th><th></th></tr>
        ${lims.map(l => `<tr><td>${agentChip(l.agent_id)}</td><td>${h(l.win)}</td><td>${h(l.metric)}</td><td>${num(l.limit_value)}</td><td><button class="btn sm r" data-dellim="${l.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin límites manuales</td></tr>'}</table></div>
        <form class="panel" id="newLim" style="margin-top:12px"><div class="field-row"><div><label class="l">Agente</label><select name="agent_id">${opts(S.boot.agents.map(a => [a.id, a.name]))}</select></div><div><label class="l">Ventana</label><select name="win">${opts([['5h', '5 horas'], ['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']])}</select></div>
        <div><label class="l">Métrica</label><select name="metric">${opts([['tokens', 'Tokens'], ['usd', 'USD'], ['runs', 'Ejecuciones']])}</select></div><div><label class="l">Límite</label><input type="number" name="limit_value" min="1" required></div></div><button class="btn y" style="margin-top:10px">Agregar límite</button></form>`;
    } else if (tab === 'auto') {
      const st = S.boot.settings;
      body = `<form class="panel" id="autoF"><h3>Consejo Jedi automático</h3>
        <label class="l">Convocar retrospectiva cada N tareas completadas por proyecto (0 = apagado)</label><input type="number" name="council_auto_n" min="0" value="${st.council_auto_n}" style="max-width:160px">
        <label class="l">Agentes del consejo automático</label>${agentsOn().map(a => `<label class="row"><input type="checkbox" name="caa" value="${a.id}" ${st.council_auto_agents.some(x => x.agent_id === a.id) ? 'checked' : ''}>${h(a.name)}</label>`).join('')}
        <h3>Límites y estado</h3><label class="row"><input type="checkbox" name="divert_at_80" ${st.divert_at_80 ? 'checked' : ''}> Deshabilitar un agente al llegar al 80% de un límite (sus tareas nuevas van al relevo)</label>
        <label class="l">Escaneo del Puente cada (min)</label><input type="number" name="scan_min" min="1" value="${st.scan_min}" style="max-width:160px">
        <h3>Git</h3><label class="l">Carpetas que nunca entran en los checkpoints (una por línea; estado de herramientas/hooks)</label><textarea name="checkpoint_exclude" rows="3">${h((st.checkpoint_exclude || []).join('\n'))}</textarea>
        <h3>Lentes del consejo (JSON opcional para agregar/modificar)</h3><textarea name="lenses" rows="4" placeholder='{"accesibilidad":["Accesibilidad","Problemas WCAG en lo tocado"]}'></textarea>
        <div class="row"><button class="btn y">Guardar</button><button class="btn" type="button" id="bk">Respaldar base de datos ahora</button></div></form>`;
    } else if (tab === 'plantillas') {
      body = S.boot.templates.map(t => `<form class="panel" data-tpl="${t.id}" style="margin-bottom:10px"><div class="field-row"><div><label class="l">Área</label><select name="area_id">${opts(S.boot.areas.map(a => [a.id, a.name]), t.area_id, '—')}</select></div><div><label class="l">Título</label><input name="title" value="${h(t.title)}"></div></div>
        <label class="l">Instrucciones</label><textarea name="prompt">${h(t.prompt)}</textarea><div class="row"><button class="btn y">Guardar</button><button class="btn r" type="button" data-deltpl="${t.id}">Eliminar</button></div></form>`).join('') +
        `<form class="panel" id="newTpl"><h3>Nueva plantilla</h3><div class="field-row"><div><label class="l">Área</label><select name="area_id">${opts(S.boot.areas.map(a => [a.id, a.name]), '', '—')}</select></div><div><label class="l">Título</label><input name="title" required></div></div><label class="l">Instrucciones</label><textarea name="prompt" required></textarea><button class="btn y" style="margin-top:10px">Crear</button></form>`;
    } else if (tab === 'apariencia') {
      const cur = S.theme || 'oscuro';
      body = `<form class="panel" id="themeF">
        <h3>Tema y apariencia visual</h3>
        <p class="muted">Personaliza la estética galáctica de la Oficina Virtual. Los cambios se aplican al instante y se guardan en tu perfil.</p>
        <div class="theme-picks">
          <label class="theme-card ${cur === 'oscuro' ? 'on' : ''}" data-t="oscuro">
            <span class="theme-swatch dark-swatch"></span>
            <input type="radio" name="theme" value="oscuro" ${cur === 'oscuro' ? 'checked' : ''} style="display:none">
            <b>Oscuro (Espacio profundo)</b>
            <small class="muted">Fondo estelar negro, paneles azul noche y acentos clásicos Star Wars en amarillo y cian holográfico.</small>
          </label>
          <label class="theme-card ${cur === 'blanco' ? 'on' : ''}" data-t="blanco">
            <span class="theme-swatch light-swatch"></span>
            <input type="radio" name="theme" value="blanco" ${cur === 'blanco' ? 'checked' : ''} style="display:none">
            <b>Crema / Hueso (Tatooine)</b>
            <small class="muted">Fondo cálido tono hueso y arena, paneles marfil y alto contraste descansado para la vista.</small>
          </label>
        </div>
        <div class="row"><button class="btn y">Guardar tema</button></div>
      </form>`;
    } else {
      const me = S.boot.me, prefs = me.notif_prefs || {};
      body = `<form class="panel" id="meF"><div class="row">${userSprite(me, 5)}<div><h2 style="margin:0">${h(me.name)}</h2><small>${h(me.username)} · ${h(me.role)} · ${h(S.boot.users.find(u => u.id === me.id)?.rank || '')}</small></div></div>
        <label class="l">Nombre</label><input name="name" value="${h(me.name)}"><label class="l">Nueva contraseña (vacío = no cambiar)</label><input name="password" type="password" minlength="6" autocomplete="new-password">
        <h3>Avatar</h3>
        <div class="theme-picks">
          ${AVATARS.map(([k, l]) => `<label class="theme-card avatar-card ${(me.avatar || 'rebel') === k ? 'on' : ''}" data-av="${k}">
            <input type="radio" name="avatar" value="${k}" ${(me.avatar || 'rebel') === k ? 'checked' : ''} style="display:none">
            ${sprite(k, '#ff8c42', 4)}
            <b>${l}</b>
          </label>`).join('')}
        </div>
        <h3>Notificaciones de escritorio</h3>${NOTIF_KINDS.map(([k, l]) => `<label class="row"><input type="checkbox" name="n_${k}" ${prefs[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}
        <p class="muted">Permiso del navegador: ${'Notification' in window ? Notification.permission : 'no soportado'}. Si no hay pestañas abiertas, la oficina usa notificaciones de Windows.</p>
        <div class="row"><button class="btn y">Guardar</button>${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn" type="button" id="askN">Permitir notificaciones</button>' : ''}</div></form>
        <div class="panel" style="margin-top:14px">
          <h3>Voz de la oficina</h3>
          <p class="muted">La voz y la lectura de avisos se guardan en este dispositivo. Para responder hablando, usa el micrófono del aviso o de la barra.</p>
          <label class="l" for="voiceSel">Voz</label><select id="voiceSel"><option value="">Cargando voces…</option></select>
          <label class="l" for="voiceSpeed">Velocidad: <output id="voiceSpeedValue"></output></label>
          <input type="range" id="voiceSpeed" min="0.5" max="2" step="0.1">
          <label class="row"><input type="checkbox" id="readNotif"> Leer avisos nuevos en voz alta</label>
          <div class="row"><button class="btn" type="button" id="voiceTest">Probar voz</button><button class="btn ghost" type="button" id="voiceStop">Detener</button></div>
        </div>
        <div class="panel" id="marcacionCard" style="margin-top:14px">
          <h3>Marcación (SICAPE)</h3>
          <p class="muted" id="marcarInfo">Ejecuta marcar_ahora.bat localmente en la PC del agente.</p>
          <div class="row" style="align-items:center;gap:10px">
            <button class="btn y" type="button" id="btnMarcar">Marcar</button>
            <span id="marcarState" class="chip" hidden></span>
          </div>
          <div class="console" id="marcarConsole" style="margin-top:10px;height:240px;display:none"></div>
        </div>`;
    }
    el.innerHTML = `<h1>Configuración</h1><div class="tabs">${tabs.map(([k, l]) => `<button data-ct="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
    if (tab === 'perfil') {
      const voiceSel = $('#voiceSel', el), voiceSpeed = $('#voiceSpeed', el);
      const vp = voicePrefs();
      let chosenVoice = localStorage.getItem('ov_voice') || vp.voice;
      voiceSpeed.value = vp.speed;
      $('#voiceSpeedValue', el).value = `${vp.speed.toFixed(1)}×`;
      $('#readNotif', el).checked = vp.read;
      const fillVoices = serverVoices => {
        if (!voiceSel.isConnected) return;
        voiceSel.replaceChildren();
        const addGroup = (label, voices) => {
          if (!voices.length) return;
          const group = document.createElement('optgroup'); group.label = label;
          for (const [value, name] of voices) { const option = document.createElement('option'); option.value = value; option.textContent = name; group.append(option); }
          voiceSel.append(group);
        };
        addGroup('Servidor', serverVoices.map(v => ['ia:' + v.id, v.label]));
        addGroup('Navegador', (window.speechSynthesis?.getVoices() || []).filter(v => /^es/i.test(v.lang)).map(v => ['nav:' + v.name, `${v.name} (${v.lang})`]));
        if (!voiceSel.options.length) { const option = document.createElement('option'); option.textContent = 'No hay voces disponibles'; option.value = ''; voiceSel.append(option); }
        if ([...voiceSel.options].some(o => o.value === chosenVoice)) voiceSel.value = chosenVoice;
      };
      let serverVoices = [];
      fillVoices(serverVoices);
      if (S.boot?.ia) get('/api/voices').then(v => { serverVoices = Array.isArray(v) ? v : []; fillVoices(serverVoices); }).catch(() => fillVoices(serverVoices));
      window.speechSynthesis?.addEventListener?.('voiceschanged', () => fillVoices(serverVoices), { once: true });
      voiceSel.onchange = () => { chosenVoice = voiceSel.value; localStorage.setItem('ov_voice', chosenVoice); };
      voiceSpeed.oninput = () => { localStorage.setItem('ov_voice_speed', voiceSpeed.value); $('#voiceSpeedValue', el).value = `${(+voiceSpeed.value).toFixed(1)}×`; };
      $('#readNotif', el).onchange = e => localStorage.setItem('ov_read_notif', e.target.checked ? '1' : '0');
      $('#voiceTest', el).onclick = () => speak('Hola. Soy la voz de tu oficina. Te avisaré cuando una tarea necesite tu decisión.', { voice: voiceSel.value, speed: +voiceSpeed.value });
      $('#voiceStop', el).onclick = () => stopSpeaking();
      get('/api/me/marcacion').then(m => {
        const cons = $('#marcarConsole', el);
        const b = $('#btnMarcar', el);
        const st = $('#marcarState', el);
        const info = $('#marcarInfo', el);
        if (info && m.path) info.textContent = `Script: ${m.path}`;
        if (cons && m.last_log?.length) {
          cons.style.display = 'block';
          cons.innerHTML = m.last_log.map(l => `<div class="${logClass(l)}">${h(l)}</div>`).join('');
          cons.scrollTop = cons.scrollHeight;
        }
        if (m.running) {
          if (b) b.disabled = true;
          if (st) { st.hidden = false; st.textContent = 'ejecutando...'; st.className = 'chip'; }
          if (cons) cons.style.display = 'block';
        } else if (m.last_result && st) {
          st.hidden = false;
          st.textContent = m.last_result.code === 0 ? 'completado' : 'código ' + m.last_result.code;
          st.className = 'chip ' + (m.last_result.code === 0 ? 'g' : 'r');
        }
      }).catch(() => {});
    }
    $$('[data-ct]', el).forEach(b => b.onclick = () => go('#/config/' + b.dataset.ct));
    const list = s => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    el.onsubmit = async e => {
      e.preventDefault();
      const fm = e.target, f = formData(fm);
      try {
        if (fm.dataset.agent) {
          let pre, extra; try { pre = JSON.parse(f.pre_args || '[]'); extra = JSON.parse(f.extra_args || '[]'); } catch { return fail('Args deben ser JSON, p. ej. ["--flag"]'); }
          await put('/api/agents/' + fm.dataset.agent, { ...f, pre_args: pre, extra_args: extra, models: list(f.models), efforts: list(f.efforts), prices: Object.fromEntries(f.prices.split('\n').map(l => l.split('=')).filter(x => x.length === 2 && x[0].trim()).map(([m, v]) => [m.trim(), v.split('/').map(Number).filter(n => !isNaN(n))])), quota_patterns: list(f.quota_patterns.replace(/,/g, '\u0000')).map(x => x.replace(/\u0000/g, ',')), max_concurrent: +f.max_concurrent, timeout_min: +f.timeout_min });
          holo('Agente guardado'); await loadBoot();
        } else if (fm.id === 'newMachine') {
          const m = await post('/api/machines', f);
          if (f.kind === 'zer0') {
            modal(`<h2>Token para zer0: "${h(f.name)}"</h2>
              <p class="panel r">Cópialo ahora: <b>no se vuelve a mostrar</b>. Se usa para conectar zer0 a la Oficina Virtual.</p>
              <label class="l">URL de la oficina</label><input readonly value="${h(location.origin)}">
              <label class="l" style="margin-top:8px">Token de la máquina</label><textarea rows="2" readonly>${h(m.token)}</textarea>
              <p class="muted">Abre zer0 en Windows, ve a «Oficina Virtual», pega la URL y este token, y pulsa «Conectar».</p>
              <div class="row" style="margin-top:10px"><a class="btn y" href="#/pc/${m.id}" data-close>Ir a Control del PC</a><button class="btn ghost" value="c">Listo</button></div>`);
          } else {
            const cfg = JSON.stringify({ url: location.origin, token: m.token, roots: ['C:\\Users\\TU_USUARIO'] }, null, 2);
            modal(`<h2>Token de la máquina "${h(f.name)}"</h2><p class="panel r">Cópialo ahora: <b>no se vuelve a mostrar</b>. Quien lo tenga puede ejecutar agentes en esa PC.</p>
              <label class="l">worker.json (junto a worker.js en la PC)</label><textarea rows="7" readonly>${h(cfg)}</textarea>
              <p class="muted">En "roots" pon las carpetas donde el agente puede trabajar. Luego en la PC: <code>node worker.js</code> (o instalar-agente.ps1 para que arranque solo).</p>
              <button class="btn ghost" value="c">Listo</button>`);
          }
          await loadBoot();
          route(true);
          return;
        } else if (fm.id === 'newAg') { await post('/api/agents', f); await loadBoot(); route(true); }
        else if (fm.dataset.area) { await put('/api/areas/' + fm.dataset.area, { name: f.name, alias: f.alias, icon: f.icon, color: f.color, room: f.room, default_agent_id: +f.default_agent_id || null, auto_fallback: f.auto_fallback, fallback_chain: list(f.chain).map(k => S.boot.agents.find(a => a.key === k)?.id).filter(Boolean) }); holo('Área guardada'); await loadBoot(); }
        else if (fm.id === 'newArea') { await post('/api/areas', f); await loadBoot(); route(true); }
        else if (fm.id === 'newUser') { await post('/api/users', f); route(true); }
        else if (fm.id === 'newLim') { await post('/api/limits', { ...f, agent_id: +f.agent_id }); route(true); }
        else if (fm.id === 'autoF') {
          let lenses; if (f.lenses.trim()) { try { lenses = JSON.parse(f.lenses); } catch { return fail('JSON de lentes inválido'); } }
          await put('/api/settings', { council_auto_n: +f.council_auto_n, council_auto_agents: $$('[name=caa]:checked', fm).map(c => ({ agent_id: +c.value })), divert_at_80: f.divert_at_80, scan_min: +f.scan_min, checkpoint_exclude: list(f.checkpoint_exclude), ...(lenses ? { lenses } : {}) });
          holo('Ajustes guardados'); await loadBoot();
        } else if (fm.dataset.tpl) { await put('/api/templates/' + fm.dataset.tpl, { ...f, area_id: +f.area_id || null }); holo('Plantilla guardada'); await loadBoot(); }
        else if (fm.id === 'newTpl') { await post('/api/templates', { ...f, area_id: +f.area_id || null }); await loadBoot(); route(true); }
        else if (fm.id === 'themeF') {
          const chosenTheme = f.theme || S.theme || 'oscuro';
          applyTheme(chosenTheme);
          const prefs = S.boot?.me?.notif_prefs || {};
          prefs.theme = chosenTheme;
          await put('/api/me', { notif_prefs: prefs });
          holo('Tema guardado', chosenTheme === 'blanco' || chosenTheme === 'crema' ? 'Tema crema (Tatooine) activado' : 'Tema oscuro (Espacio profundo) activado');
          await loadBoot();
        } else if (fm.id === 'meF') {
          const notif_prefs = Object.fromEntries(NOTIF_KINDS.map(([k]) => [k, f['n_' + k]]));
          const chosenTheme = f.theme || S.theme || 'oscuro';
          notif_prefs.theme = chosenTheme;
          applyTheme(chosenTheme);
          await put('/api/me', { name: f.name, avatar: f.avatar, password: f.password || undefined, notif_prefs }); holo('Perfil guardado'); await loadBoot();
        }
        beep('ok');
      } catch (err) { fail(err); }
    };
    el.onclick = async e => {
      const tc = e.target.closest('.theme-card[data-t]');
      if (tc) {
        const t = tc.dataset.t;
        applyTheme(t);
        $$('.theme-card[data-t]', el).forEach(c => {
          const match = c.dataset.t === t;
          c.classList.toggle('on', match);
          const r = $('input[name=theme]', c);
          if (r) r.checked = match;
        });
        $('#themeBtn')?.setAttribute('aria-checked', t !== 'blanco');
        if (S.sound) beep('ok');
      }
      const ac = e.target.closest('.theme-card[data-av]');
      if (ac) {
        const av = ac.dataset.av;
        $$('.theme-card[data-av]', el).forEach(c => {
          const match = c.dataset.av === av;
          c.classList.toggle('on', match);
          const r = $('input[name=avatar]', c);
          if (r) r.checked = match;
        });
        if (S.sound) beep('ok');
      }
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'btnMarcar') {
        b.disabled = true;
        const cons = $('#marcarConsole', el);
        if (cons) { cons.style.display = 'block'; cons.innerHTML = '<div class="w">Iniciando marcación...</div>'; }
        const st = $('#marcarState', el);
        if (st) { st.hidden = false; st.textContent = 'ejecutando...'; st.className = 'chip'; }
        try {
          await post('/api/me/marcar');
        } catch (err) {
          b.disabled = false;
          if (st) { st.hidden = false; st.textContent = 'error'; st.className = 'chip r'; }
          if (cons) cons.insertAdjacentHTML('beforeend', `<div class="e">${h(err.message)}</div>`);
          fail(err);
        }
      }
      if (b.dataset.detect) { b.disabled = true; try { const r2 = await post(`/api/agents/${b.dataset.detect}/detect-models`); if (r2.models.length) { b.previousElementSibling.value = r2.models.join(', '); holo(`${r2.models.length} modelos detectados`, 'Pulsa Guardar para conservarlos'); } else holo('No se detectaron modelos', '', { err: true }); } catch (err) { fail(err); } b.disabled = false; }
      if (b.dataset.test) { b.disabled = true; b.textContent = 'Probando…'; try { const r2 = await post(`/api/agents/${b.dataset.test}/test`); holo(r2.ok ? 'Prueba OK' : 'Prueba falló', r2.ok ? `"${r2.reply}" en ${dur(r2.latency_ms / 1000)} · sesión ${r2.session_id || '-'}` : (r2.error || r2.end_reason), { err: !r2.ok, ms: 12000 }); } catch (err) { fail(err); } route(true); }
      if (b.dataset.delarea && await confirmBox('¿Eliminar el área?', 'Eliminar', true)) { await act(() => del('/api/areas/' + b.dataset.delarea)); await loadBoot(); route(true); }
      if (b.dataset.deltpl) { await act(() => del('/api/templates/' + b.dataset.deltpl)); await loadBoot(); route(true); }
      if (b.dataset.pw) { const p = await promptBox('Nueva contraseña', 'Mínimo 6 caracteres'); if (p) act(() => put('/api/users/' + b.dataset.pw, { password: p }), 'Contraseña cambiada'); }
      if (b.dataset.deluser && await confirmBox('¿Eliminar usuario?', 'Eliminar', true)) { await act(() => del('/api/users/' + b.dataset.deluser)); route(true); }
      if (b.dataset.undel) { await act(() => put('/api/users/' + b.dataset.undel, { deleted: false })); route(true); }
      if (b.dataset.dellim) { await act(() => del('/api/limits/' + b.dataset.dellim)); route(true); }
      if (b.dataset.mdef) { await act(() => put('/api/machines/' + b.dataset.mdef, { default: true }), 'Máquina por defecto'); await loadBoot(); route(true); }
      if (b.dataset.mren) { const n = await promptBox('Renombrar máquina', 'Nombre'); if (n) { await act(() => put('/api/machines/' + b.dataset.mren, { name: n })); await loadBoot(); route(true); } }
      if (b.dataset.mdel && await confirmBox('¿Eliminar la máquina? Su token deja de funcionar.', 'Eliminar', true)) { await act(() => del('/api/machines/' + b.dataset.mdel)); await loadBoot(); route(true); }
      if (b.id === 'bk') { const r2 = await act(() => post('/api/backup')); holo('Respaldo creado', r2.file); }
      if (b.id === 'askN') { await Notification.requestPermission(); route(true); }
    };
    $$('[data-role]', el).forEach(s => s.onchange = () => act(() => put('/api/users/' + s.dataset.role, { role: s.value }), 'Rol actualizado'));
  },
};

// ===================== CONTROL DEL PC (zer0) =====================
let pcTimer = null;
const pcProposalTimes = new Map();

// ponytail: agrupación O(N) lineal de eventos por stepId; techo de 200 eventos por sesión en el servidor
function groupPcSteps(events) {
  const steps = [];
  let currentStep = null;
  let anonIndex = 1;

  for (const ev of events) {
    if (!ev || !ev.type?.startsWith('step.')) continue;
    const stepId = ev.data?.stepId;
    if (stepId) {
      currentStep = steps.find(s => s.stepId === stepId);
      if (!currentStep) {
        const last = steps[steps.length - 1];
        if (last && !last.stepId) {
          last.stepId = stepId;
          currentStep = last;
        } else {
          currentStep = { stepId, num: steps.length + 1 };
          steps.push(currentStep);
        }
      }
    } else {
      if (ev.type === 'step.captured') {
        currentStep = { stepId: null, num: steps.length + 1 };
        steps.push(currentStep);
      } else if (!currentStep) {
        currentStep = { stepId: 'step-' + (anonIndex++), num: steps.length + 1 };
        steps.push(currentStep);
      }
    }

    if (ev.type === 'step.captured') {
      currentStep.captured = ev;
      if (ev.frameId) currentStep.beforeFrameId = ev.frameId;
    } else if (ev.type === 'step.proposal') {
      currentStep.proposal = ev;
      currentStep.tool = ev.data?.tool;
      currentStep.summary = ev.data?.summary;
      currentStep.auto = ev.data?.auto === true;          // zer0 la ejecuta sola (bajo riesgo)
      currentStep.askReason = ev.data?.askReason || '';    // por que zer0 pide aprobacion (regla o motivo del motor)
      currentStep.modelRisk = ev.data?.modelRisk || '';
      currentStep.explanation = ev.data?.explanation || '';   // lo que el motor dice que va a hacer y por que
    } else if (ev.type === 'step.approved') {
      currentStep.decision = 'approved';
      currentStep.by = ev.data?.by || '';
      currentStep.approved = ev;
    } else if (ev.type === 'step.rejected') {
      currentStep.decision = 'rejected';
      currentStep.rejected = ev;
    } else if (ev.type === 'step.expired') {
      currentStep.decision = 'expired';
      currentStep.expired = ev;
    } else if (ev.type === 'step.result') {
      currentStep.result = ev;
      if (ev.frameId) currentStep.afterFrameId = ev.frameId;
      currentStep.ok = ev.data?.ok;
      currentStep.resultMessage = ev.data?.message;
    }
  }

  steps.forEach((s, idx) => {
    if (!s.stepId) s.stepId = 'st-' + (idx + 1);
  });
  return steps;
}

const pc = {
  refreshOn: ['pc.event', 'machine.status'],
  event(type, d, cur) {
    if (type === 'pc.event') {
      const curId = cur?.args?.[0] ? +cur.args[0] : S.pcId;
      if (!curId || d.machine === curId) return 'refresh';
      return 'handled';
    }
    if (type === 'machine.status') return 'refresh';
  },
  async render(el, r) {
    if (!canEdit()) {
      el.innerHTML = '<div class="panel r" style="margin:20px">Acceso restringido: se requiere rol de operador o administrador.</div>';
      return;
    }

    const pcs = await get('/api/pc');
    if (!pcs || !pcs.length) {
      el.innerHTML = `<div class="row"><h1 style="margin:0">Control del PC (zer0)</h1></div>
        <div class="panel r" style="margin-top:16px">
          <h3>No hay PCs con zer0 registrados</h3>
          <p>Crea una máquina de tipo zer0 en <a href="#/config/maquinas">Configuración → Máquinas</a> para conectar un PC con Windows.</p>
        </div>`;
      return;
    }

    const mid = +r.args[0] || S.pcId || pcs[0].id;
    S.pcId = mid;
    const curPc = pcs.find(p => p.id === mid) || pcs[0];

    let st = null;
    if (curPc.online) {
      try { st = await get('/api/pc/' + curPc.id + '/status'); } catch {}
    }

    let sess = null;
    if (isAdmin()) {
      try { sess = await get('/api/pc/' + curPc.id + '/session'); } catch {}
    }

    const oc = st?.officeControl || st?.payload?.officeControl || {};
    const busy = !!(st?.busy || (sess && sess.state === 'active'));
    const admin = isAdmin();

    // Avisos si falta permiso en zer0
    const avisos = [];
    if (!oc.enabled) {
      avisos.push('Control desde oficina desactivado. Actívalo en la ventana de zer0 en Windows para poder iniciar sesiones.');
    }
    if (oc.enabled && !oc.sendFrames) {
      avisos.push('Envío de capturas desactivado. Actívalo en la ventana de zer0 en Windows si deseas ver la pantalla.');
    }
    if (oc.enabled && !oc.remoteApproval) {
      avisos.push('Aprobación remota desactivada. Actívalo en la ventana de zer0 en Windows para aprobar acciones desde aquí.');
    }

    const events = sess?.events || [];
    const steps = groupPcSteps(events);
    const lastDone = [...events].reverse().find(e => e.type === 'session.done');
    const isSessionActive = sess && sess.state === 'active';
    const isDisconnected = !curPc.online;

    // Interruptores
    const ctrlText = oc.enabled
      ? `Control desde oficina: activo${oc.expiresAt ? ' hasta ' + (fmtDate(oc.expiresAt).split(' ')[1] || fmtDate(oc.expiresAt)) : ''}`
      : 'Control desde oficina: apagado';
    const framesText = oc.sendFrames ? 'Capturas: activo' : 'Capturas: apagado';
    const apprText = oc.remoteApproval ? 'Aprobación remota: activo' : 'Aprobación remota: apagado';
    const ap = oc.autoApproval || {};
    const autoText = ap.enabled ? `Auto-aprobación de bajo riesgo: activa (${ap.scope === '*' || !ap.scope ? 'todas las apps' : ap.scope})` : 'Auto-aprobación de bajo riesgo: apagada';

    const selectorHtml = pcs.length > 1
      ? `<select id="pcSel" aria-label="Elegir PC">${pcs.map(p => `<option value="${p.id}" ${p.id === curPc.id ? 'selected' : ''}>${h(p.name)} (${p.online ? 'en línea' : 'desconectado'})</option>`).join('')}</select>`
      : `<b class="lbl-up" style="font-size:1.1em">${h(curPc.name)}</b>`;

    let timelineHtml = '';
    if (!sess) {
      timelineHtml = '<div class="empty">Sin sesiones registradas en este PC.</div>';
    } else {
      let pendingStep = null;
      const stepsHtml = steps.map(s => {
        const isPending = s.proposal && !s.decision && !s.result && isSessionActive;
        if (isPending) pendingStep = s;

        let stChip = '';
        if (s.result) {
          stChip = `<span class="chip ${s.ok ? 'st-completada' : 'st-fallida'}">${s.ok ? 'Resultado: OK' : 'Resultado: Falló'}</span>`;
        } else if (s.decision === 'approved') {
          stChip = s.by === 'auto' ? '<span class="chip st-en_curso">Automática · ejecutando...</span>' : '<span class="chip st-en_curso">Aprobada · ejecutando...</span>';
        } else if (s.decision === 'rejected') {
          stChip = '<span class="chip st-bloqueada">Rechazada</span>';
        } else if (s.decision === 'expired') {
          stChip = '<span class="chip st-pausada_cuota">Caducada</span>';
        } else if (s.proposal) {
          stChip = '<span class="chip st-esperando">Esperando aprobación</span>';
        } else {
          stChip = '<span class="chip st-en_curso">Capturando...</span>';
        }

        const beforeImg = s.beforeFrameId
          ? `<a href="/api/pc/${curPc.id}/frame/${s.beforeFrameId}" target="_blank" rel="noopener"><img src="/api/pc/${curPc.id}/frame/${s.beforeFrameId}" alt="Captura antes" style="width:100%;max-height:280px;object-fit:contain;background:#000;border-radius:4px;border:1px solid var(--line);display:block"></a>`
          : '<div class="panel r" style="text-align:center;padding:20px 8px"><small class="muted">Capturas no compartidas</small></div>';

        const afterImg = s.afterFrameId
          ? `<a href="/api/pc/${curPc.id}/frame/${s.afterFrameId}" target="_blank" rel="noopener"><img src="/api/pc/${curPc.id}/frame/${s.afterFrameId}" alt="Captura después" style="width:100%;max-height:280px;object-fit:contain;background:#000;border-radius:4px;border:1px solid var(--line);display:block"></a>`
          : (s.result ? '<div class="panel r" style="text-align:center;padding:20px 8px"><small class="muted">Capturas no compartidas</small></div>' : '');

        return `<div class="panel" style="margin-bottom:12px;border-left:4px solid ${isPending ? 'var(--yellow)' : s.result ? (s.ok ? 'var(--green)' : 'var(--red)') : 'var(--line)'}">
          <div class="row" style="margin-bottom:6px">
            <b>Paso #${s.num} · <code style="font-size:0.9em">${h(s.stepId)}</code></b>
            <span class="right">${s.by === 'auto' || s.auto ? '<span class="chip st-completada" title="Acción de bajo riesgo: zer0 la ejecutó sin pedir aprobación">⚡ auto</span> ' : ''}${stChip}</span>
          </div>

          ${s.proposal ? `<div style="margin:8px 0;padding:8px;background:rgba(255,255,255,0.03);border-radius:4px">
            ${s.explanation ? `<div style="margin-bottom:6px"><b>Qué va a hacer:</b> ${h(s.explanation)}</div>` : ''}
            <div><b>Herramienta:</b> <code>${h(s.tool || 'acción')}</code></div>
            <div style="margin-top:4px"><b>Propuesta:</b> <span>${h(s.summary || '—')}</span></div>
            ${s.askReason ? `<div style="margin-top:4px"><b>Por qué necesita tu aprobación:</b> <span>${h(s.askReason)}</span>${s.modelRisk ? ` <span class="chip st-pausada_cuota">riesgo según el motor: ${h(s.modelRisk)}</span>` : ''}</div>` : ''}
          </div>` : ''}

          ${isPending ? `<div class="panel y" style="margin:10px 0">
            <div class="row">
              <b>Confirmar acción para ejecutar en Windows:</b>
              <span class="right" id="pcCountdown" style="font-weight:bold;color:var(--yellow)">60 s restantes</span>
            </div>
            <div style="margin:6px 0"><code>${h(s.tool || '')}: ${h(s.summary || '')}</code></div>
            ${s.askReason ? `<div style="margin:6px 0"><b>Motivo de la consulta:</b> ${h(s.askReason)}</div>` : ''}
            ${!oc.remoteApproval ? '<p class="muted t-warn" style="margin:6px 0">⚠ La aprobación remota está desactivada en el PC. Debe aprobarse en la ventana de zer0 en Windows.</p>' : ''}
            <div class="row" style="margin-top:10px">
              <button class="btn y" id="pcApprove" data-step="${h(s.stepId)}" ${!admin || !oc.remoteApproval ? 'disabled' : ''}>Aprobar acción</button>
              <button class="btn r" id="pcReject" data-step="${h(s.stepId)}" ${!admin || !oc.remoteApproval ? 'disabled' : ''}>Rechazar acción</button>
            </div>
          </div>` : ''}

          ${s.result ? `<div style="margin:6px 0">
            <span class="chip ${s.ok ? 'st-completada' : 'st-fallida'}">${s.ok ? '✔ Acción ejecutada' : '✘ Falló'}</span>
            ${s.resultMessage ? `<span style="margin-left:6px">${h(s.resultMessage)}</span>` : ''}
          </div>` : ''}

          <div class="field-row" style="margin-top:10px;gap:10px">
            <div><small class="muted" style="display:block;margin-bottom:4px">Pantalla ANTES de la acción</small>${beforeImg}</div>
            ${afterImg ? `<div><small class="muted" style="display:block;margin-bottom:4px">Pantalla DESPUÉS de la acción</small>${afterImg}</div>` : ''}
          </div>
        </div>`;
      }).join('');

      let sessionStatusBadge = '';
      if (sess.state === 'active') {
        sessionStatusBadge = isDisconnected ? '<span class="chip r">PC desconectado</span>' : '<span class="chip st-en_curso">En curso</span>';
      } else if (sess.state === 'stopped') {
        sessionStatusBadge = `<span class="chip r">Detenida${sess.reason ? ': ' + h(sess.reason) : ''}</span>`;
      } else if (sess.state === 'done') {
        sessionStatusBadge = `<span class="chip g">Finalizada${sess.reason ? ': ' + h(sess.reason) : ''}</span>`;
      }

      timelineHtml = `
        <div class="row" style="margin-bottom:10px;align-items:center">
          <div><b>Sesión:</b> <code style="font-size:0.9em">${h(sess.id)}</code></div>
          <div class="right">${sessionStatusBadge}</div>
        </div>
        ${lastDone && lastDone.data?.reason === 'completed' && steps.length === 0 ? `<div class="panel y" style="margin-bottom:12px">
          <b>zer0 no hizo nada:</b> ${h(lastDone.data?.message || '')}<div class="muted" style="margin-top:6px">Reformula la instrucción (por ejemplo, deja abierta y en primer plano la ventana que quieres usar) e inténtalo de nuevo.</div>
        </div>` : lastDone ? `<div class="panel ${lastDone.data?.reason === 'completed' ? 'g' : 'r'}" style="margin-bottom:12px">
          <b>Sesión finalizada:</b> razón <code>${h(lastDone.data?.reason || 'terminada')}</code>${lastDone.data?.message ? ` · ${h(lastDone.data.message)}` : ''}
        </div>` : ''}
        ${isDisconnected && isSessionActive ? '<div class="panel r" style="margin-bottom:12px"><b>PC desconectado:</b> la máquina perdió la conexión con la oficina durante la sesión.</div>' : ''}
        <div class="pc-steps">${stepsHtml || '<div class="empty">Iniciando sesión...</div>'}</div>
      `;
    }

    el.innerHTML = `
      <div class="row" style="align-items:center;margin-bottom:12px">
        <h1 style="margin:0">Control del PC (zer0)</h1>
        <div class="grow" style="margin-left:12px">${selectorHtml}</div>
        <div class="row right" style="gap:8px">
          <button class="btn r" id="pcStop" title="Detener sesión y acciones inmediatamente">Detener</button>
        </div>
      </div>

      <!-- Panel de estado del PC -->
      <div class="panel ${curPc.online ? '' : 'r'}" style="margin-bottom:14px">
        <div class="row" style="align-items:center">
          <span class="dot ${curPc.online ? 'ok' : 'bad'}"></span>
          <b>${curPc.online ? 'PC conectado' : 'PC desconectado'}</b>
          ${(curPc.info?.host || curPc.info?.hostname) ? `· <code>${h(curPc.info.host || curPc.info.hostname)}</code>` : ''}
          <small class="muted">· visto ${ago(curPc.last_seen)}</small>
          <span class="right">
            ${curPc.online ? `<span class="chip ${busy ? 'st-en_curso' : 'st-completada'}">${busy ? 'Ocupada' : 'Libre'}</span>` : '<span class="chip r">Desconectado</span>'}
            ${curPc.online && st ? `<span class="chip ${st.actionsStopped ? 'st-fallida' : 'st-completada'}">${st.actionsStopped ? 'Acciones detenidas (Stop)' : 'Acciones habilitadas'}</span>` : ''}
          </span>
        </div>

        ${curPc.online ? `
          <div class="row" style="gap:8px;margin-top:10px">
            <span class="chip ${oc.enabled ? 'st-completada' : 'st-bloqueada'}">${h(ctrlText)}</span>
            <span class="chip ${oc.sendFrames ? 'st-completada' : 'st-bloqueada'}">${h(framesText)}</span>
            <span class="chip ${oc.remoteApproval ? 'st-completada' : 'st-bloqueada'}">${h(apprText)}</span>
            <span class="chip ${ap.enabled ? 'st-completada' : 'st-bloqueada'}" title="Las acciones de bajo riesgo se ejecutan sin pedir aprobación; escribir texto, teclas, abrir apps o URLs y los clics dudosos siempre se consultan">${h(autoText)}</span>
          </div>
          ${avisos.length ? `<div class="panel r" style="margin-top:10px">${avisos.map(a => `<div>⚠ ${h(a)}</div>`).join('')}</div>` : ''}
        ` : `
          <div class="panel r" style="margin-top:10px">
            <b>PC desconectado:</b> abre zer0 en Windows para reconectar este equipo a la oficina.
          </div>
        `}
      </div>

      <!-- Formularios de sesión y pregunta -->
      ${admin ? `
        <form class="panel" id="pcWinForm" style="margin-bottom:14px">
          <h3>Control sin supervisión por tiempo limitado</h3>
          <small class="muted">Habilita en el PC el control remoto, las capturas y la aprobación desde aquí durante el tiempo elegido. Se corta con «Detener» o al vencer (máx. 12 h).</small>
          <div class="row" style="margin-top:10px;gap:12px;align-items:center;flex-wrap:wrap">
            <select name="minutes">${opts([['30', '30 min'], ['60', '1 h'], ['240', '4 h'], ['480', '8 h'], ['720', '12 h']], '60')}</select>
            <label class="row" style="gap:6px"><input type="checkbox" name="autoApproval" checked> Aprobar solas las acciones de bajo riesgo</label>
            <button class="btn y" id="pcBtnWin" ${!curPc.online ? 'disabled' : ''}>${oc.enabled ? 'Renovar ventana' : 'Habilitar control'}</button>
          </div>
          ${curPc.online && st && st.webEnableAllowed === false ? '<small class="muted t-warn">Primero, una sola vez: en zer0 (pestaña Oficina Virtual) marca «Permitir que la oficina habilite el control por tiempo limitado».</small>' : ''}
        </form>

        <form class="panel" id="pcSessionForm" style="margin-bottom:14px">
          <h3>Iniciar sesión de control</h3>
          <div class="field-row">
            <div>
              <label class="l">Máx. pasos (1–10)</label>
              <input type="number" name="maxSteps" min="1" max="10" value="8">
            </div>
          </div>
          <small class="muted">El motor y el modelo los define la app de Windows.</small>
          <label class="l">Instrucción ${micBtn('#pcInst')}</label>
          <textarea id="pcInst" name="instruction" rows="3" required maxlength="4000" placeholder="Escribe lo que zer0 debe hacer en el PC..."></textarea>
          <div class="row" style="margin-top:10px;align-items:center">
            <button class="btn y" id="pcBtnStart" ${!curPc.online || busy ? 'disabled' : ''}>Iniciar sesión</button>
            ${!curPc.online ? '<small class="muted t-warn">PC desconectado</small>' : ''}
            ${curPc.online && busy ? '<small class="muted t-warn">PC ocupado con otra sesión o consulta</small>' : ''}
            ${curPc.online && !oc.enabled ? '<small class="muted t-warn">Pulsa «Habilitar control» arriba</small>' : ''}
          </div>
        </form>

        <details class="panel" style="margin-bottom:14px">
          <summary class="lbl-up" style="cursor:pointer">Pregunta rápida (ask)</summary>
          <form id="pcAskForm" style="margin-top:10px">
            <label class="l">Pregunta ${micBtn('#pcAskText')}</label>
            <textarea id="pcAskText" name="text" rows="2" required maxlength="12000" placeholder="Consulta rápida a zer0..."></textarea>
            <label class="row" style="margin-top:6px"><input type="checkbox" name="includeScreen"> Incluir captura de pantalla</label>
            <div class="row" style="margin-top:10px">
              <button class="btn y" id="pcBtnAsk" ${!curPc.online || busy ? 'disabled' : ''}>Preguntar</button>
            </div>
            <div id="pcAskResult" style="margin-top:10px" hidden></div>
          </form>
        </details>
      ` : '<div class="panel" style="margin-bottom:14px"><small class="muted">Solo administradores pueden iniciar sesiones o hacer consultas.</small></div>'}

      <!-- Línea de tiempo de la sesión -->
      <h2>Línea de tiempo de la sesión</h2>
      <div id="pcTimeline">${timelineHtml}</div>
    `;

    // ponytail: cuenta atrás de 60 s local en el cliente; si se desfasa del PC, zer0 rechaza con 422 el step vencido
    clearInterval(pcTimer);
    const cdEl = $('#pcCountdown', el);
    if (cdEl && steps.some(s => s.proposal && !s.decision && !s.result && isSessionActive)) {
      const pendingS = steps.find(s => s.proposal && !s.decision && !s.result && isSessionActive);
      if (!pcProposalTimes.has(pendingS.stepId)) {
        pcProposalTimes.set(pendingS.stepId, Date.now());
      }
      const updateCd = () => {
        const elapsed = Math.floor((Date.now() - pcProposalTimes.get(pendingS.stepId)) / 1000);
        const rem = Math.max(0, 60 - elapsed);
        const curCd = $('#pcCountdown', el);
        if (!curCd) { clearInterval(pcTimer); return; }
        if (rem <= 0) {
          clearInterval(pcTimer);
          curCd.textContent = 'Caducado (60 s)';
          curCd.style.color = 'var(--red)';
          const bApp = $('#pcApprove', el), bRej = $('#pcReject', el);
          if (bApp) bApp.disabled = true;
          if (bRej) bRej.disabled = true;
        } else {
          curCd.textContent = `${rem} s restantes`;
        }
      };
      updateCd();
      pcTimer = setInterval(updateCd, 1000);
    }

    const sel = $('#pcSel', el);
    if (sel) sel.onchange = e => go('#/pc/' + e.target.value);

    const btnStop = $('#pcStop', el);
    if (btnStop) {
      btnStop.onclick = async () => {
        btnStop.disabled = true;
        try {
          await post(`/api/pc/${curPc.id}/stop`);
          holo('PC detenido', 'Se solicitó detener la sesión y acciones', { err: true });
          refreshSoon(0);
        } catch (err) {
          fail(err);
          btnStop.disabled = false;
        }
      };
    }

    const winF = $('#pcWinForm', el);
    if (winF) {
      winF.onsubmit = async e => {
        e.preventDefault();
        const f = formData(winF);
        const b = $('#pcBtnWin', winF);
        b.disabled = true;
        try {
          await post(`/api/pc/${curPc.id}/window`, { minutes: +f.minutes, autoApproval: !!f.autoApproval });
          holo('Control habilitado', 'zer0 aceptará sesiones hasta que venza la ventana');
          refreshSoon(0);
        } catch (err) {
          fail(err);
          b.disabled = false;
        }
      };
    }

    const sessF = $('#pcSessionForm', el);
    if (sessF) {
      sessF.onsubmit = async e => {
        e.preventDefault();
        const f = formData(sessF);
        const bStart = $('#pcBtnStart', sessF);
        if (bStart) { bStart.disabled = true; bStart.textContent = 'Iniciando…'; }
        try {
          const body = {
            instruction: f.instruction.trim(),
            maxSteps: +f.maxSteps || 8
          };
          await post(`/api/pc/${curPc.id}/session`, body);
          holo('Sesión iniciada', 'zer0 está ejecutando la instrucción');
          refreshSoon(0);
        } catch (err) {
          fail(err);
          if (bStart) { bStart.disabled = false; bStart.textContent = 'Iniciar sesión'; }
        }
      };
    }

    const askF = $('#pcAskForm', el);
    if (askF) {
      askF.onsubmit = async e => {
        e.preventDefault();
        const f = formData(askF);
        const bAsk = $('#pcBtnAsk', askF);
        if (bAsk) { bAsk.disabled = true; bAsk.textContent = 'Consultando…'; }
        try {
          const body = {
            text: f.text.trim(),
            includeScreen: !!f.includeScreen
          };
          const rAsk = await post(`/api/pc/${curPc.id}/ask`, body);
          const out = $('#pcAskResult', askF);
          if (out) {
            out.hidden = false;
            const txt = rAsk.message || (rAsk.payload ? JSON.stringify(rAsk.payload, null, 2) : 'OK');
            out.innerHTML = `<div class="panel"><b>Respuesta de zer0:</b><div style="white-space:pre-wrap;margin-top:4px">${h(txt)}</div></div>`;
          }
        } catch (err) {
          fail(err);
        } finally {
          if (bAsk) { bAsk.disabled = false; bAsk.textContent = 'Preguntar'; }
        }
      };
    }

    el.onclick = async e => {
      const bApp = e.target.closest('#pcApprove');
      if (bApp && !bApp.disabled) {
        bApp.disabled = true;
        const stepId = bApp.dataset.step;
        try {
          await post(`/api/pc/${curPc.id}/approve`, { sessionId: sess.id, stepId, decision: 'approve' });
          holo('Acción aprobada', 'Enviada al PC');
          refreshSoon(0);
        } catch (err) {
          fail(err);
          bApp.disabled = false;
        }
        return;
      }

      const bRej = e.target.closest('#pcReject');
      if (bRej && !bRej.disabled) {
        bRej.disabled = true;
        const stepId = bRej.dataset.step;
        try {
          await post(`/api/pc/${curPc.id}/approve`, { sessionId: sess.id, stepId, decision: 'reject' });
          holo('Acción rechazada', 'Enviada al PC');
          refreshSoon(0);
        } catch (err) {
          fail(err);
          bRej.disabled = false;
        }
        return;
      }
    };
  }
};

// ===================== MANDO DIRECTO (MOVIL, VOZ, PROYECTOS Y CONTROL TACTIL PC) =====================
function detectVoiceAgent(rawText, agentsList, projectsList) {
  let text = String(rawText || '').trim();
  let agentId = null;
  let broadcast = false;
  let shell = false;
  let projectId = null;
  for (const p of (projectsList || [])) {
    const escaped = p.name.replace(/[.*+?^()[\]{}|\\]/g, '\\$&');
    const rxP = new RegExp('^proyecto\\s+' + escaped + '[,:\\s]+', 'i');
    if (rxP.test(text)) { projectId = p.id; text = text.replace(rxP, '').trim(); break; }
  }
  if (/^(powershell|terminal|consola|cmd)[,:\s]+/i.test(text)) {
    shell = true;
    text = text.replace(/^(powershell|terminal|consola|cmd)[,:\s]+/i, '').trim();
  } else if (/^(todos|consejo|rafaga|ráfaga|broadcast)[,:\s]+/i.test(text)) {
    broadcast = true;
    text = text.replace(/^(todos|consejo|rafaga|ráfaga|broadcast)[,:\s]+/i, '').trim();
  } else {
    const mapRx = [
      ['claude', /^claude[,:\s]+/i],
      ['codex', /^c[oó]dex[,:\s]+/i],
      ['antigravity', /^(antigravity|agy|gemini)[,:\s]+/i],
      ['commandcode', /^(command\s*code|comando)[,:\s]+/i]
    ];
    for (const [key, rx] of mapRx) {
      if (rx.test(text)) {
        const found = (agentsList || []).find(a => a.key === key);
        if (found) { agentId = found.id; text = text.replace(rx, '').trim(); break; }
      }
    }
  }
  return { text: text || rawText, agentId, broadcast, shell, projectId };
}

async function showPcScreenModal() {
  const d = modal('<h2>📸 Control Táctil de tu PC Windows</h2><div class="empty">Capturando pantalla en vivo...</div>');
  let clickMode = 'left';
  let autoTimer = null;
  d.addEventListener('close', () => { if (autoTimer) clearInterval(autoTimer); }, { once: true });

  const paintFrame = (res) => {
    const img = d.querySelector('#pcLiveImg');
    const meta = d.querySelector('#pcLiveMeta');
    if (img && res?.jpegB64) {
      img.src = 'data:image/jpeg;base64,' + res.jpegB64;
      if (meta) meta.textContent = 'Resolución: ' + (res.width || 1920) + '×' + (res.height || 1080) + ' · Toca cualquier punto de la imagen para hacer clic en tu PC';
      return;
    }
    d.querySelector('form').innerHTML = '<div class="row" style="justify-content:space-between">' +
      '<h2 style="margin:0">📸 Pantalla Interactiva de tu PC</h2>' +
      '<button type="button" class="btn sm ghost" data-close>✕ Cerrar</button></div>' +
      '<small class="muted" id="pcLiveMeta">Resolución: ' + (res.width || 1920) + '×' + (res.height || 1080) + ' · Toca la imagen para hacer clic en tu PC</small>' +
      '<div class="row" style="margin:8px 0;gap:6px">' +
        '<button type="button" class="btn sm y" data-cmode="left">👆 Clic Izq</button>' +
        '<button type="button" class="btn sm ghost" data-cmode="double">⚡ Doble Clic</button>' +
        '<button type="button" class="btn sm ghost" data-cmode="right">🖱️ Clic Der</button>' +
        '<button type="button" class="btn sm" id="btnRefScreen">🔄 Refrescar</button>' +
        '<label class="row" style="font-size:var(--fs-xs);margin-left:auto"><input type="checkbox" id="chkAutoScreen"> En vivo (3s)</label>' +
      '</div>' +
      '<div style="position:relative;background:#000;border:2px solid var(--holo);border-radius:8px;overflow:hidden;cursor:crosshair">' +
        '<img id="pcLiveImg" src="data:image/jpeg;base64,' + res.jpegB64 + '" alt="Pantalla PC" style="width:100%;max-height:58vh;object-fit:contain;display:block;user-select:none">' +
      '</div>' +
      '<div class="row" style="margin-top:8px;gap:6px">' +
        '<input id="pcTypeInput" placeholder="Escribir texto en la ventana activa de la PC..." style="flex:1">' +
        '<button type="button" class="btn sm y" id="btnSendType">⌨️ Escribir</button>' +
      '</div>' +
      '<div class="row" style="margin-top:6px;gap:4px">' +
        [['enter','↵ Enter'],['esc','Esc'],['tab','⇥ Tab'],['space','Espacio'],['backspace','⌫ Borrar'],['win','⊞ Win'],['altf4','✕ Alt+F4']].map(([k,l]) => '<button type="button" class="btn sm ghost" data-pckey="' + k + '">' + l + '</button>').join('') +
      '</div>';

    d.querySelectorAll('[data-cmode]').forEach(b => {
      b.onclick = () => {
        clickMode = b.dataset.cmode;
        d.querySelectorAll('[data-cmode]').forEach(x => { x.classList.toggle('y', x === b); x.classList.toggle('ghost', x !== b); });
      };
    });

    const imgEl = d.querySelector('#pcLiveImg');
    if (imgEl) {
      imgEl.onclick = async ev => {
        const rect = imgEl.getBoundingClientRect();
        const rx = (ev.clientX - rect.left) / rect.width;
        const ry = (ev.clientY - rect.top) / rect.height;
        const metaEl = d.querySelector('#pcLiveMeta');
        if (metaEl) metaEl.textContent = '⏳ Enviando clic a tu PC...';
        try {
          const next = await post('/api/mando/pc-click', {
            rx,
            ry,
            button: clickMode === 'right' ? 'right' : 'left',
            double: clickMode === 'double'
          });
          paintFrame(next);
        } catch (err) { fail(err); }
      };
    }

    const rb = d.querySelector('#btnRefScreen');
    if (rb) rb.onclick = async () => { rb.disabled = true; try { paintFrame(await get('/api/mando/screen')); } catch (e) { fail(e); } rb.disabled = false; };

    const autoChk = d.querySelector('#chkAutoScreen');
    if (autoChk) autoChk.onchange = () => {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      if (autoChk.checked) {
        autoTimer = setInterval(async () => {
          if (!d.open) return clearInterval(autoTimer);
          try { paintFrame(await get('/api/mando/screen')); } catch {}
        }, 3000);
      }
    };

    const sendType = async () => {
      const inp = d.querySelector('#pcTypeInput');
      if (!inp || !inp.value) return;
      const val = inp.value;
      inp.value = '';
      try { paintFrame(await post('/api/mando/pc-key', { text: val })); } catch (e) { fail(e); }
    };
    const btnType = d.querySelector('#btnSendType');
    if (btnType) btnType.onclick = sendType;
    const inpType = d.querySelector('#pcTypeInput');
    if (inpType) inpType.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendType(); } };

    d.querySelectorAll('[data-pckey]').forEach(b => {
      b.onclick = async () => {
        try { paintFrame(await post('/api/mando/pc-key', { key: b.dataset.pckey })); } catch (e) { fail(e); }
      };
    });
  };

  try { paintFrame(await get('/api/mando/screen')); } catch (err) {
    d.querySelector('form').innerHTML = '<div class="panel r">' + h(err.message) + '</div><button class="btn ghost" data-close>Cerrar</button>';
  }
}

async function importProjectsModal() {
  const d = modal('<h2>📥 Importar proyectos desde tu PC</h2><div class="empty">Escaneando carpetas en tu PC...</div>');
  const loadDir = async (dirPath) => {
    try {
      const q = dirPath ? ('?path=' + encodeURIComponent(dirPath)) : '';
      const res = await get('/api/mando/discover' + q);
      const listHtml = res.candidates.map((c, idx) => {
        return '<label class="row" style="padding:6px 4px;border-bottom:1px solid var(--line)">' +
          '<input type="checkbox" name="imp" data-idx="' + idx + '" ' + (c.is_git && !c.already ? 'checked' : '') + ' ' + (c.already ? 'disabled' : '') + '>' +
          '<b>' + h(c.name) + '</b> ' +
          (c.is_git ? '<span class="chip st-completada">git</span>' : '<span class="chip">carpeta</span>') +
          (c.already ? '<small class="muted right">ya importado</small>' : '<small class="muted right">' + h(c.path) + '</small>') +
        '</label>';
      }).join('') || '<div class="empty">No se encontraron subcarpetas</div>';
      d.querySelector('form').innerHTML = '<h2>📥 Importar proyectos de tu PC</h2>' +
        '<p class="muted">Selecciona las carpetas de tu PC Windows para centralizarlas como proyectos en la Oficina Virtual.</p>' +
        '<div class="row" style="margin:8px 0"><code class="grow ellipsis">' + h(res.base_path || '') + '</code>' +
        (res.parent ? '<button type="button" class="btn sm" id="impUp">⬆ Subir carpeta</button>' : '') +
        '<button type="button" class="btn sm" id="impBrowse">📁 Otra ruta...</button></div>' +
        '<div class="check-list" style="max-height:48vh">' + listHtml + '</div>' +
        '<div class="row" style="margin-top:12px"><button type="button" class="btn y" id="impOk">Importar seleccionados</button>' +
        '<button type="button" class="btn ghost" data-close>Cancelar</button></div>';
      const upBtn = d.querySelector('#impUp');
      if (upBtn) upBtn.onclick = () => loadDir(res.parent);
      const brBtn = d.querySelector('#impBrowse');
      if (brBtn) brBtn.onclick = async () => { const picked = await folderPicker(res.machine_id, res.base_path); if (picked) loadDir(picked); };
      const okBtn = d.querySelector('#impOk');
      if (okBtn) okBtn.onclick = async () => {
        const checked = [...d.querySelectorAll('input[name=imp]:checked')].map(ch => res.candidates[+ch.dataset.idx]).filter(Boolean);
        if (!checked.length) return fail('Marca al menos una carpeta');
        okBtn.disabled = true; okBtn.textContent = 'Importando...';
        try {
          const out = await post('/api/mando/import', { machine_id: res.machine_id, folders: checked });
          await loadBoot();
          if (out.imported?.length) setProject(out.imported[0]);
          closeModal();
          holo('Proyectos importados', checked.length + ' carpetas vinculadas');
          refreshSoon(0);
        } catch (err) { fail(err); okBtn.disabled = false; }
      };
    } catch (err) { d.querySelector('form').innerHTML = '<div class="panel r">' + h(err.message) + '</div><button class="btn ghost" data-close>Cerrar</button>'; }
  };
  loadDir(null);
}

const mando = {
  refreshOn: ['conv.updated', 'task.updated', 'run.started', 'project.updated', 'agent.status'],
  event(type, d) {
    if (type === 'run.log') {
      const c = document.getElementById('mandoLiveConsole');
      if (c) { c.hidden = false; c.dataset.run = d.run_id; appendLog(c, d.line); }
      return 'handled';
    }
    if (['conv.updated', 'task.updated', 'run.started'].includes(type)) return 'refresh';
  },
  async render(el) {
    const pid = S.project || S.boot.projects[0]?.id || null;
    if (pid && pid !== S.project) setProject(pid);
    const st = await get('/api/mando/state' + (pid ? '?project_id=' + pid : ''));
    const curProj = project(pid);
    const defFolder = st.folders?.[0] || null;
    const ags = agentsOn();
    S.mandoAgent = S.mandoAgent || ags[0]?.id || 'all';
    S.mandoMode = S.mandoMode || 'editar';

    const agentButtons = ags.map(a => {
      const isSel = String(S.mandoAgent) === String(a.id);
      return '<button type="button" class="btn ' + (isSel ? 'y' : 'ghost') + '" data-magent="' + a.id + '" style="border-left:3px solid ' + h(a.color) + '">' +
        agentSprite(a, 1.8) + ' <span>' + h(a.name) + '</span> ' + agentLimitsBadge(a, true) + '</button>';
    }).join('') +
    '<button type="button" class="btn ' + (S.mandoAgent === 'all' ? 'y' : 'ghost') + '" data-magent="all" title="Lanza los 4 agentes en paralelo sobre el proyecto">⚡ Todos (4 IA)</button>' +
    '<button type="button" class="btn ' + (S.mandoAgent === 'shell' ? 'y' : 'ghost') + '" data-magent="shell" title="Ejecutar comando directo en PowerShell sin pasar por IA">💻 PowerShell</button>';

    const promptsRapidos = [
      ['📊 Estado del Proyecto', 'Analiza el estado actual de este repositorio, los últimos commits y archivos modificados, y dame un resumen ejecutivo en español.'],
      ['🐛 Buscar bugs', 'Revisa los archivos recientes de este proyecto en busca de posibles errores o casos borde y dime cómo solucionarlos.'],
      ['🧪 Correr pruebas', 'Ejecuta la suite de pruebas de este proyecto y dime si todo pasa o qué falló.'],
      ['🖥️ Top CPU/RAM en PC', '__ps__:Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 Name,Id,CPU,WorkingSet | Format-Table -AutoSize']
    ];

    const msgsHtml = (st.messages || []).slice(-30).map(m => {
      const convObj = st.conversations.find(c => c.id === m.conversation_id);
      const agObj = agent(m.agent_id || convObj?.agent_id);
      return '<div class="msg ' + h(m.role) + '">' +
        '<div class="who">' + (m.role === 'agente' ? agentChip(agObj?.id, 1.5) : m.role === 'usuario' ? userChip(m.user_id) : 'SISTEMA / PC') +
        ' · ' + fmtDate(m.at) + (convObj ? ' · <a href="#/cantina/' + convObj.id + '">' + h(convObj.title.slice(0, 30)) + '</a>' : '') +
        (m.role === 'agente' ? ' <button type="button" class="btn sm ghost" data-say title="Leer en voz alta">' + ic('sound', 'sm') + '</button>' : '') +
        '</div><div class="body">' + md(m.text) + '</div></div>';
    }).join('') || '<div class="empty">Habla con 🎤 o escribe abajo para controlar tus proyectos o tu PC con Claude, Codex, Antigravity, CommandCode o PowerShell.</div>';

    const activeTasksHtml = (st.tasks || []).slice(0, 5).map(t => {
      return '<a class="room-link" href="#/tarea/' + t.id + '">' + chip(t.status) + ' <b class="ellipsis">#' + t.id + ' ' + h(t.title) + '</b> <small>' + (agent(t.agent_id)?.name || 'humano') + '</small></a>';
    }).join('') || '<small class="muted">Sin tareas recientes en este proyecto</small>';

    el.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div class="row"><h1 style="margin:0">🚀 Mando Directo</h1><span class="chip st-en_curso">Voz + 4 IA + Control PC</span></div>' +
      '<div class="row">' +
        (canEdit() ? '<button type="button" class="btn sm y" id="btnScreenPC">📸 Controlar Pantalla PC</button>' : '') +
        (canEdit() ? '<button type="button" class="btn sm" id="btnImpPC">📥 Importar Carpetas PC</button>' : '') +
        (canEdit() ? '<button type="button" class="btn sm ghost" id="btnNewProj">+ Proyecto</button>' : '') +
      '</div></div>' +
      (canEdit() ? '<div class="panel" style="margin-bottom:12px;padding:10px 12px">' +
        '<div class="row" style="justify-content:space-between;gap:6px">' +
          '<small class="lbl-up" style="color:var(--holo)">⚡ Acciones Rápidas en tu PC Windows (1 toque)</small>' +
          '<div class="row" style="gap:4px">' +
            '<button type="button" class="btn sm ghost" data-pcq="vscode">💻 Abrir en VS Code</button>' +
            '<button type="button" class="btn sm ghost" data-pcq="explorer">📂 Abrir Carpeta en PC</button>' +
            '<button type="button" class="btn sm ghost" id="btnClipGet">📋 Ver Portapapeles PC</button>' +
            '<button type="button" class="btn sm ghost" id="btnClipSet">📲 Enviar a Portapapeles</button>' +
            '<button type="button" class="btn sm ghost" id="btnOpenUrl">🌐 Abrir Web en PC</button>' +
            '<button type="button" class="btn sm ghost" data-pcq="vol_down">🔉</button>' +
            '<button type="button" class="btn sm ghost" data-pcq="vol_mute">🔇</button>' +
            '<button type="button" class="btn sm ghost" data-pcq="vol_up">🔊</button>' +
            '<button type="button" class="btn sm warn" data-pcq="lock">🔒 Bloquear PC</button>' +
          '</div>' +
        '</div>' +
      '</div>' : '') +
      '<div class="panel y" style="margin-bottom:12px">' +
        '<div class="field-row" style="align-items:end">' +
          '<div><label class="l" for="mandoProjSel">1. Proyecto / Carpeta Activa en PC</label>' +
          '<select id="mandoProjSel">' + opts(S.boot.projects.map(p => [p.id, p.name + (p.folders?.length ? ' (' + p.folders[0].label + ')' : '')]), pid || '', '— Raíz General PC / Cantina —') + '</select></div>' +
          '<div><label class="l" for="mandoModeSel">2. Modo de Acción</label>' +
          '<select id="mandoModeSel">' + opts([
            ['editar', '⚡ Directo · Editar archivos y ejecutar comandos en PC'],
            ['plan', '🔍 Directo · Solo lectura / Análisis'],
            ['tarea', '🌿 Crear Tarea Kanban (Worktree Git aislado)']
          ], S.mandoMode) + '</select></div>' +
        '</div>' +
        '<div class="row" style="margin-top:8px;justify-content:space-between">' +
          '<small class="muted">📁 Ruta en Windows: <code>' + h(defFolder ? defFolder.path : 'C:\\Users\\LOCALADMINPJ / D:\\cantina') + '</code></small>' +
          '<div class="row" style="gap:4px">' +
            (curProj ? '<a class="btn sm ghost" href="#/kanban/' + curProj.id + '">📋 Kanban (' + (curProj.total || 0) + ')</a>' : '') +
            '<a class="btn sm ghost" href="#/repos">🌿 Git / Deploy</a>' +
          '</div>' +
        '</div>' +
        '<div class="l" style="margin-top:10px">3. Ejecutor (puedes tocar uno o nombrarlo al hablar: "Claude...", "Codex...", "Antigravity...", "CommandCode...", "PowerShell...")</div>' +
        '<div class="row" id="mandoAgentsBar" style="gap:6px;margin-top:4px">' + agentButtons + '</div>' +
        '<div class="row" style="gap:6px;margin-top:10px">' +
          promptsRapidos.map(([lbl, pr]) => '<button type="button" class="btn sm ghost" data-qprompt="' + h(pr) + '">' + h(lbl) + '</button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="console" id="mandoLiveConsole" style="height:170px;margin-bottom:12px" ' + (st.runningConvs?.length ? '' : 'hidden') + '>⚡ Ejecutando en tu PC Windows...</div>' +
      '<div class="panel">' +
        '<div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Conversación y Consola de Resultados</h3>' +
        '<label class="row" style="font-size:var(--fs-sm)"><input type="checkbox" id="mandoFresh"> Sesión nueva</label></div>' +
        '<div class="chat" id="mandoChatBox" data-scroll="mchat" style="max-height:46vh">' + msgsHtml + '</div>' +
        (canEdit() ? '<form id="mandoForm" class="col-flex" style="margin-top:10px">' +
          '<textarea id="mandoInput" rows="3" placeholder="Escribe o pulsa 🎤 para hablar (ej: Claude revisa este proyecto, o PowerShell git status)..." required></textarea>' +
          '<div class="row">' +
            '<button type="submit" class="btn y" id="mandoSendBtn">▶ Ejecutar ahora</button>' +
            '<button type="button" class="btn" id="mandoVoiceDirect" title="Dictar por voz y ejecutar al instante">🎤 Hablar y Ejecutar</button>' +
            micBtn('#mandoInput') +
          '</div></form>' : '') +
      '</div>' +
      '<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Tareas del proyecto</h3>' + activeTasksHtml + '</div>';

    const chatBox = el.querySelector('#mandoChatBox');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

    const projSel = el.querySelector('#mandoProjSel');
    if (projSel) projSel.onchange = e => { setProject(+e.target.value || null); route(true); };

    const modeSel = el.querySelector('#mandoModeSel');
    if (modeSel) modeSel.onchange = e => { S.mandoMode = e.target.value; };

    const scrBtn = el.querySelector('#btnScreenPC');
    if (scrBtn) scrBtn.onclick = () => showPcScreenModal();

    const impBtn = el.querySelector('#btnImpPC');
    if (impBtn) impBtn.onclick = () => importProjectsModal();

    const newProjBtn = el.querySelector('#btnNewProj');
    if (newProjBtn) newProjBtn.onclick = () => projectForm();

    el.querySelectorAll('[data-pcq]').forEach(b => {
      b.onclick = async () => {
        const actName = b.dataset.pcq;
        if (actName === 'lock' && !await confirmBox('¿Bloquear la sesión de tu PC Windows ahora?', 'Bloquear PC', true)) return;
        try {
          const r = await post('/api/mando/pc-quick', { project_id: pid, action: actName });
          holo('PC Windows', r.msg || 'Listo');
        } catch (e) { fail(e); }
      };
    });

    const clipGetBtn = el.querySelector('#btnClipGet');
    if (clipGetBtn) clipGetBtn.onclick = async () => {
      try {
        const r = await post('/api/mando/pc-quick', { project_id: pid, action: 'clip_get' });
        modal('<h2>📋 Portapapeles actual de tu PC</h2><textarea rows="6" readonly>' + h(r.clipboard || '') + '</textarea><div class="row" style="margin-top:10px"><button type="button" class="btn ghost" data-close>Cerrar</button></div>');
      } catch (e) { fail(e); }
    };

    const clipSetBtn = el.querySelector('#btnClipSet');
    if (clipSetBtn) clipSetBtn.onclick = async () => {
      const txt = await promptBox('Enviar al portapapeles de tu PC', 'Texto a copiar en Windows:', '', true);
      if (txt != null) {
        try { const r = await post('/api/mando/pc-quick', { project_id: pid, action: 'clip_set', value: txt }); holo('Portapapeles PC', r.msg); } catch (e) { fail(e); }
      }
    };

    const openUrlBtn = el.querySelector('#btnOpenUrl');
    if (openUrlBtn) openUrlBtn.onclick = async () => {
      const u = await promptBox('Abrir página en el navegador de tu PC', 'URL (https://...):', 'https://');
      if (u && u !== 'https://') {
        try { const r = await post('/api/mando/pc-quick', { project_id: pid, action: 'open_url', value: u }); holo('Navegador PC', r.msg); } catch (e) { fail(e); }
      }
    };

    el.querySelectorAll('[data-magent]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.magent;
        S.mandoAgent = (v === 'all' || v === 'shell') ? v : +v;
        route(true);
      };
    });

    const sendOrder = async (rawText, isVoice) => {
      let forceShell = false;
      let cleanText = rawText;
      if (rawText.startsWith('__ps__:')) {
        forceShell = true;
        cleanText = rawText.slice(7);
      }
      const parsed = isVoice ? detectVoiceAgent(cleanText, ags, S.boot.projects) : { text: cleanText, agentId: null, broadcast: false, shell: forceShell, projectId: null };
      if (parsed.projectId && parsed.projectId !== pid) setProject(parsed.projectId);
      const targetProj = parsed.projectId || pid;
      const isShell = parsed.shell || forceShell || S.mandoAgent === 'shell';
      const isBroadcast = !isShell && (parsed.broadcast || S.mandoAgent === 'all');
      const targetAgent = parsed.agentId || ((S.mandoAgent === 'all' || S.mandoAgent === 'shell') ? ags[0]?.id : +S.mandoAgent);
      const fresh = !!el.querySelector('#mandoFresh')?.checked;
      const sendBtn = el.querySelector('#mandoSendBtn');
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Ejecutando...'; }
      try {
        const r = await post('/api/mando/send', {
          project_id: targetProj,
          agent_id: targetAgent,
          broadcast: isBroadcast,
          shell: isShell,
          mode: S.mandoMode,
          text: parsed.text,
          voz: !!isVoice,
          fresh
        });
        beep('ok');
        if (r.kind === 'tarea') {
          holo('Tarea creada y en ejecución', '#' + r.task_id, { link: '#/tarea/' + r.task_id });
        } else if (r.kind === 'shell') {
          holo('PowerShell ejecutado', parsed.text.slice(0, 60));
        } else {
          holo(isBroadcast ? 'Ráfaga enviada a los 4 agentes' : 'Orden en ejecución', parsed.text.slice(0, 80));
        }
        refreshSoon(100);
      } catch (err) { fail(err); } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '▶ Ejecutar ahora'; }
      }
    };

    el.querySelectorAll('[data-qprompt]').forEach(b => {
      b.onclick = () => sendOrder(b.dataset.qprompt, false);
    });

    const form = el.querySelector('#mandoForm');
    if (form) {
      form.onsubmit = async e => {
        e.preventDefault();
        const inp = el.querySelector('#mandoInput');
        const val = inp.value.trim();
        if (!val) return;
        const wasVoz = isDictated(inp);
        inp.value = '';
        await sendOrder(val, wasVoz);
      };
    }

    const vBtn = el.querySelector('#mandoVoiceDirect');
    if (vBtn) {
      vBtn.onclick = async () => {
        const heard = await listen(stState => {
          vBtn.textContent = stState === 'rec' ? '⏹ Escuchando (toca para enviar)...' : stState === 'busy' ? '⏳ Transcribiendo...' : '🎤 Hablar y Ejecutar';
          vBtn.classList.toggle('r', stState === 'rec');
        });
        if (heard) await sendOrder(heard, true);
      };
    }
  }
};

export const VIEWS = { estacion, mando, proyectos, kanban, repos, tarea, cantina, consejo, archivos, puente, config, pc };


// ---------- órdenes por voz desde el dock: dictar → interpretar → confirmar → ejecutar ----------
export function vozForm() {
  if (!S.boot?.ia && !(window.SpeechRecognition || window.webkitSpeechRecognition)) return holo('Voz no disponible', 'Activa OFICINA_IA_URL o usa Chrome/Edge con soporte de voz.', { err: true });
  const d = modal(`<h2>🎤 Orden por voz</h2>
    <p class="muted">Pulsa el micro y habla. Ejemplos: «crea una tarea en el proyecto Oficina Virtual titulada arreglar el login para el agente Codex», «abre la cantina», «pregúntale a Claude si el servidor está en línea», «busca dictado por voz».</p>
    <div class="row" style="margin:6px 0"><button type="button" class="btn y" id="vzMic">🎤 Hablar</button><small id="vzState" class="muted"></small></div>
    <div id="vzBox"></div>`);
  const box = $('#vzBox', d), state = $('#vzState', d), mic = $('#vzMic', d);
  mic.onclick = async () => {
    if (isRecording()) return stopRecording(); // segundo clic: termina y transcribe
    try {
      await startRecording(async blob => {
        mic.textContent = '⏳'; mic.disabled = true; mic.classList.remove('r'); state.textContent = 'Transcribiendo…';
        try {
          const texto = await transcribir(blob);
          state.textContent = '';
          if (!texto) return holo('No se entendió el audio', 'Intenta hablar más cerca del micrófono.');
          pintarOrden(box, texto, parseVoz(texto, { projects: S.boot.projects, areas: S.boot.areas, agents: agentsOn() }));
        } catch (err) { state.textContent = ''; fail(err); } finally { mic.textContent = '🎤 Hablar'; mic.disabled = false; }
      });
    } catch { state.textContent = ''; return fail('No se pudo usar el micrófono: revisa el permiso del navegador'); }
    mic.textContent = '⏹ Parar'; mic.classList.add('r'); state.textContent = 'Grabando…';
  };
}
// tarjeta de confirmación: la orden se puede corregir antes de ejecutarla
function pintarOrden(box, texto, o) {
  const head = `<div class="panel" style="margin-bottom:10px"><small class="muted">Se entendió</small><div>«${h(texto)}»</div></div>`;
  const repetir = '<button type="button" class="btn ghost" id="vzAgain">Repetir</button>';
  const agentes = opts(agentsOn().map(a => [a.id, a.name]), o.agente_id, '— por defecto —');
  if (o.accion === 'ir' && o.destino) {
    box.innerHTML = head + `<p>Ir a <b>${h(o.destinoNombre)}</b>.</p><div class="row"><button type="button" class="btn y" id="vzGo">Ir</button>${repetir}</div>`;
    $('#vzGo', box).onclick = () => { closeModal(); go(o.destino); };
  } else if (o.accion === 'buscar') {
    box.innerHTML = head + `<p>Buscar en el historial: <b>${h(o.texto)}</b></p><div class="row"><button type="button" class="btn y" id="vzGo">Buscar</button>${repetir}</div>`;
    $('#vzGo', box).onclick = () => { closeModal(); go('#/archivos/buscar?q=' + encodeURIComponent(o.texto)); };
  } else if (o.accion === 'chat') {
    box.innerHTML = head + `<div class="field-row"><div><label class="l">Agente</label><select id="vzAgent">${agentes}</select></div>
      <div><label class="l">Proyecto (contexto, opcional)</label><select id="vzProj">${opts(S.boot.projects.map(p => [p.id, p.name]), o.proyecto_id, '—')}</select></div></div>
      <label class="l">Mensaje</label><textarea id="vzText" rows="4">${h(o.texto)}</textarea>
      <div class="row" style="margin-top:10px"><button type="button" class="btn y" id="vzDo">Enviar a la Cantina</button>${repetir}</div>`;
    $('#vzDo', box).onclick = async () => {
      const agent_id = +$('#vzAgent', box).value, text = $('#vzText', box).value.trim();
      if (!agent_id) return fail('Elige un agente');
      if (!text) return fail('El mensaje está vacío');
      try { const r = await post('/api/conversations', { agent_id, text, project_id: +$('#vzProj', box).value || null, voz: true }); closeModal(); beep('ok'); go('#/cantina/' + r.id); } catch (err) { fail(err); }
    };
  } else if (o.accion === 'tarea') {
    // reutiliza el formulario real de "Nueva tarea" (todos los campos) prellenado con lo dictado
    closeModal();
    taskForm({ title: o.titulo, prompt: o.descripcion || o.prompt, project_id: o.proyecto_id || S.project || S.boot.projects[0]?.id || null, area_id: o.area_id || null, agent_id: o.agente_id || null }, { voz: true });
  } else {
    box.innerHTML = head + `<p class="muted">No reconocí una orden de la oficina. Elige qué hacer con lo dictado:</p>
      <div class="row"><button type="button" class="btn y" id="vzDo">Crear tarea</button><button type="button" class="btn" id="vzChat">Enviar a la Cantina</button>${repetir}</div>`;
    $('#vzDo', box).onclick = () => { closeModal(); taskForm({ title: texto.slice(0, 90), prompt: texto }, { voz: true }); };
    $('#vzChat', box).onclick = () => pintarOrden(box, texto, { accion: 'chat', agente_id: null, area_id: null, proyecto_id: null, texto });
  }
  $('#vzAgain', box)?.addEventListener('click', () => { box.innerHTML = ''; });
}