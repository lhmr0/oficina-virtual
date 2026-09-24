// Vistas de la oficina
import { S, get, post, put, del, h, $, $$, ago, dur, fmtDate, bytes, num, STATUS, PSTATUS, chip, agent, area, user, project, isAdmin, canEdit,
  agentChip, userChip, saber, opts, md, modal, closeModal, confirmBox, promptBox, formData, holo, fail, act, beep,
  machines, machineName, defaultMachine, folderPicker, upload, attachmentsHTML } from './core.js';
import { sprite, icon, ICON_NAMES } from './sprites.js';
import { route, refreshSoon, loadBoot } from './app.js';

const go = hash => { location.hash = hash; };
const ACTIVE = ['en_curso', 'en_cola', 'esperando'];
const PRI = { alta: '▲ alta', media: '■ media', baja: '▼ baja' };
const agentsOn = () => S.boot.agents.filter(a => a.enabled);

// ---------- selector agente / modelo / esfuerzo ----------
function agentPicker(p, sel = {}, { modes = true, blank = false } = {}) {
  const a = agent(sel.agent_id) || (blank ? null : agentsOn()[0]);
  return `<div class="field-row">
    <div><label class="l" for="${p}agent">Agente</label><select id="${p}agent" name="agent_id">${opts(agentsOn().map(x => [x.id, x.name + (x.status === 'sin_cuota' ? ' (sin cuota)' : '')]), a?.id, blank ? '— por defecto del área —' : null)}</select></div>
    <div><label class="l" for="${p}model">Modelo</label><input id="${p}model" name="model" list="${p}models" value="${h(sel.model || a?.default_model || '')}"><datalist id="${p}models">${(a?.models || []).map(m => `<option value="${h(m)}">`).join('')}</datalist></div>
    <div><label class="l" for="${p}effort">Esfuerzo</label><select id="${p}effort" name="effort">${opts((a?.efforts || []).map(e => [e, e]), sel.effort || a?.default_effort, '—')}</select></div>
    ${modes ? `<div><label class="l" for="${p}mode">Modo</label><select id="${p}mode" name="mode">${opts([['editar', 'Editar (auto-acepta cambios)'], ['plan', 'Plan / solo lectura'], ['supervisado', 'Supervisado (aprobar permisos, Claude)']], sel.mode || 'editar')}</select></div>` : ''}
  </div>`;
}
function bindPicker(root, p) {
  const s = $(`#${p}agent`, root); if (!s) return;
  s.addEventListener('change', () => {
    const a = agent(s.value);
    $(`#${p}models`, root).innerHTML = (a?.models || []).map(m => `<option value="${h(m)}">`).join('');
    $(`#${p}model`, root).value = a?.default_model || '';
    $(`#${p}effort`, root).innerHTML = opts((a?.efforts || []).map(e => [e, e]), a?.default_effort, '—');
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
      <div><label class="l">Plantilla</label><select id="tfTpl">${opts(S.boot.templates.map(x => [x.id, x.title]), '', '—')}</select></div>
    </div>
    <label class="l">Título</label><input name="title" required value="${h(t.title || preset.title || '')}">
    <label class="l">Instrucciones para el agente</label><textarea name="prompt" rows="6">${h(t.prompt || preset.prompt || '')}</textarea>
    <div class="field-row">
      <div><label class="l">Ejecuta</label><select name="executor" id="tfExec">${opts([['agente', 'Agente IA'], ['humano', 'Persona']], t.executor || 'agente')}</select></div>
      <div><label class="l">Carpeta</label><select name="folder_id" id="tfFolder">${opts(p.folders.map(f => [f.id, `${f.label}${f.is_git ? ' (git)' : ''}`]), t.id ? t.folder_id : (p.folders.find(f => f.is_default)?.id), 'Sin carpeta (sandbox)')}</select></div>
      <div><label class="l">Prioridad</label><select name="priority">${opts([['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], t.priority || 'media')}</select></div>
      <div><label class="l">Fecha límite</label><input type="date" name="due_date" value="${h(t.due_date || '')}"></div>
    </div>
    <div id="tfAgentBox">${agentPicker('tf', t.agent_id ? t : { agent_id: area(t.area_id || preset.area_id)?.default_agent_id }, { blank: false })}</div>
    <div id="tfHumanBox"><label class="l">Responsable</label><select name="assignee_user_id">${opts(S.boot.users.map(u => [u.id, u.name]), t.assignee_user_id || S.boot.me.id, '—')}</select></div>
    <label class="l">Depende de (se ejecuta al completarse éstas)</label>
    <select name="depends_on" id="tfDeps" multiple size="4">${projTasks.filter(x => x.id !== t.id).map(x => `<option value="${x.id}" ${deps.includes(x.id) ? 'selected' : ''}>#${x.id} ${h(x.title)} (${STATUS[x.status]})</option>`).join('')}</select>
    <label class="l">Adjuntos (imágenes, PDF, documentos: el agente los recibe en .oficina/adjuntos)</label><input type="file" id="tfFiles" multiple>
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
    f.depends_on = [...$('#tfDeps', d).selectedOptions].map(o => +o.value);
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

async function missionForm() {
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

// ===================== ESTACIÓN =====================
const estacion = {
  refreshOn: ['task.updated', 'task.created', 'conv.updated', 'run.started', 'agent.status'],
  async render(el) {
    const [tasks, chats] = await Promise.all([get('/api/tasks'), get('/api/conversations')]);
    const onlyProj = localStorage.getItem('ov_only_proj') === '1' && S.project;
    const vis = tasks.filter(t => !onlyProj || t.project_id === S.project);
    const busy = new Set([...vis.filter(t => ACTIVE.includes(t.status)).map(t => t.agent_id), ...chats.filter(c => ['en_curso', 'en_cola', 'esperando'].includes(c.status)).map(c => c.agent_id)]);
    const desk = t => {
      const a = agent(t.agent_id);
      const who = t.executor === 'humano' ? sprite('rebel', '#ff8c42', 4) : sprite('droid', a?.color, 4);
      const bub = t.status === 'esperando' ? '<span class="bubble">?</span>' : t.status === 'en_cola' ? '<span class="bubble z">…</span>' : '';
      return `<div class="station-desk ${t.status === 'en_curso' ? 'busy' : ''}" data-task="${t.id}" title="#${t.id} ${h(t.title)} · ${STATUS[t.status]}" tabindex="0" role="button">
        <div class="who" style="position:relative">${who}${bub}</div><span class="screen">${sprite('desk', t.status === 'esperando' ? '#ffe81f' : t.status === 'en_curso' ? '#3ddc84' : '#4fc3f7', 4)}</span>
        <div class="lbl">#${t.id} ${h(t.title.slice(0, 22))}</div></div>`;
    };
    const empty = `<div class="station-desk"><div class="who"></div>${sprite('desk', '#1d2447', 4)}<div class="lbl">libre</div></div>`;
    const rooms = S.boot.areas.map(a => {
      const at = vis.filter(t => t.area_id === a.id);
      const act = at.filter(t => ACTIVE.includes(t.status));
      const c = s => at.filter(t => t.status === s).length;
      return `<div class="room" data-area="${a.id}" style="--c:${a.color}"><div class="room-head">${icon(a.icon)}<b>${h(a.alias)}</b><small>${h(a.name)}</small>
        <span class="right row" style="gap:4px">${chip('pendiente', c('pendiente'))}${chip('en_curso', c('en_curso') + c('en_cola'))}${chip('esperando', c('esperando'))}${chip('revision', c('revision'))}</span></div>
        <div class="desks">${act.map(desk).join('')}${Array(Math.max(0, 3 - act.length)).fill(empty).join('')}</div></div>`;
    }).join('');
    const live = chats.filter(c => ['en_curso', 'en_cola', 'esperando'].includes(c.status));
    const cantina = `<div class="room" data-cantina="1" style="--c:#ffe81f"><div class="room-head">${icon('cantina')}<b>Cantina de Mos Eisley</b><small>Consultas rápidas</small><span class="right">${chip('en_curso', live.length + ' activas')}</span></div>
      <div class="desks">${live.map(c => `<div class="station-desk ${c.status === 'en_curso' ? 'busy' : ''}" data-chat="${c.id}" title="${h(c.title)}" tabindex="0" role="button"><div class="who" style="position:relative">${sprite('droid', agent(c.agent_id)?.color, 4)}${c.status === 'esperando' ? '<span class="bubble">?</span>' : ''}</div><span class="screen">${sprite('desk', '#ffe81f', 4)}</span><div class="lbl">${h(c.title.slice(0, 22))}</div></div>`).join('') || '<p class="muted" style="padding:8px">La cantina está tranquila. Pide una consulta rápida.</p>'}</div></div>`;
    const idle = S.boot.agents.filter(a => !busy.has(a.id));
    const corridor = `<div class="corridor"><span class="label">PASILLO · droides en espera</span>${idle.map((a, i) => {
      if (a.status === 'sin_cuota') return `<div class="walker sleeping" style="left:${8 + i * 22}%;animation:none" title="${h(a.name)} sin cuota hasta ${fmtDate(a.quota_reset_at)}">${sprite('droid', a.color, 4)}<span class="bubble z">Zz ${a.quota_reset_at ? new Date(a.quota_reset_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>`;
      if (!a.enabled) return `<div class="walker sleeping" style="left:${8 + i * 22}%;animation:none" title="${h(a.name)} deshabilitado">${sprite('droid', a.color, 4)}</div>`;
      return `<div class="walker" style="--d:${10 + i * 3}s;animation-delay:-${i * 2}s" title="${h(a.name)} disponible">${sprite('droid', a.color, 4)}</div>`;
    }).join('')}</div>`;
    el.innerHTML = `<div class="row"><h1 style="margin:0">Estación</h1>
      <label class="row" style="font-size:17px"><input type="checkbox" id="onlyProj" ${onlyProj ? 'checked' : ''}> solo proyecto actual</label>
      <span class="right">${canEdit() ? `<button class="btn y" id="nt">+ Tarea</button><button class="btn" id="nm">+ Misión</button><button class="btn o" id="nc">+ Consulta</button>` : ''}</span></div>
      <div class="agent-strip" style="margin:12px 0">${S.boot.agents.map(a => `<div class="agent-pill" style="--c:${a.color}">${sprite('droid', a.color, 3)}<div><b class="pixel" style="font-size:9px">${h(a.name)}</b><br><small>${h(a.rank)} · ${busy.has(a.id) ? 'trabajando' : a.status === 'sin_cuota' ? 'sin cuota' : a.enabled ? 'disponible' : 'apagado'}</small></div></div>`).join('')}</div>
      <div class="station">${rooms}${cantina}${corridor}</div>
      <div class="legend"><span>${sprite('desk', '#3ddc84', 2)} trabajando</span><span><span class="chip st-esperando">?</span> espera tu respuesta</span><span><span class="chip">…</span> en cola</span><span>Zz sin cuota</span></div>`;
    $('#onlyProj', el).onchange = e => { localStorage.setItem('ov_only_proj', e.target.checked ? '1' : '0'); refreshSoon(0); };
    $('#nt', el)?.addEventListener('click', () => taskForm());
    $('#nm', el)?.addEventListener('click', missionForm);
    $('#nc', el)?.addEventListener('click', () => go('#/cantina'));
    el.onclick = e => {
      const d = e.target.closest('[data-task]'); if (d) return go('#/tarea/' + d.dataset.task);
      const c = e.target.closest('[data-chat]'); if (c) return go('#/cantina/' + c.dataset.chat);
      if (e.target.closest('[data-cantina]')) return go('#/cantina');
      const r = e.target.closest('[data-area]'); if (r) roomModal(+r.dataset.area, vis);
    };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('[data-task],[data-chat]')) e.target.click(); };
  },
};
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
      ${list.map(p => `<tr class="click" data-p="${p.id}"><td><span style="color:${h(p.color)}">■</span> ${h(p.code || '-')}</td><td><b>${h(p.name)}</b><br><small>${h(p.description).slice(0, 80)}</small></td>
        <td>${p.kind === 'con_carpetas' ? '📁 carpetas' : '📝 registro'}</td><td>${chip(p.status === 'activo' ? 'en_curso' : p.status === 'completado' ? 'completada' : p.status === 'pausado' ? 'esperando' : 'pendiente', PSTATUS[p.status])}</td>
        <td>${p.folders.map(x => `<span class="chip" title="${h(x.path)}">${h(x.label)}${x.is_git ? ' (git)' : ''}</span>`).join(' ') || '<small class="muted">—</small>'}</td>
        <td>${saber(p.progress, p.color)}<small>${p.progress}% (${p.counts.completada || 0}/${p.total})</small></td>
        <td>${['en_curso', 'esperando', 'revision', 'fallida'].filter(s => p.counts[s]).map(s => chip(s, `${STATUS[s]} ${p.counts[s]}`)).join(' ') || '<small class="muted">—</small>'}</td>
        <td>${p.agents.map(id => sprite('droid', agent(id)?.color, 2)).join('')}</td><td><small>${ago(p.last_activity || p.updated_at)}</small></td>
        <td class="row" style="flex-wrap:nowrap">${canEdit() ? `<button class="btn sm ghost" data-edit="${p.id}">Editar</button>` : ''}<button class="btn sm" data-ficha="${p.id}">Ficha</button></td></tr>`).join('') || '<tr><td colspan="10" class="empty">No hay proyectos. Crea el primero.</td></tr>'}
      </table></div>`;
    $('#np', el)?.addEventListener('click', () => projectForm());
    $('#pfSt', el).onchange = e => { f.status = e.target.value; route(true); };
    $('#pfQ', el).oninput = e => { f.q = e.target.value; clearTimeout(S.pq); S.pq = setTimeout(() => route(true), 300); };
    el.onclick = e => {
      const ed = e.target.closest('[data-edit]'); if (ed) return projectForm(project(ed.dataset.edit));
      const fi = e.target.closest('[data-ficha]'); if (fi) return projectCard(+fi.dataset.ficha);
      const r = e.target.closest('[data-p]'); if (r) { S.project = +r.dataset.p; localStorage.setItem('ov_project', S.project); $('#projSel').value = S.project; go('#/kanban/' + r.dataset.p); }
    };
  },
};
function folderRow(f, i) {
  return `<div class="panel" style="padding:8px;margin:6px 0" data-fi="${i}"><div class="field-row">
    <div><label class="l">Etiqueta</label><input data-k="label" value="${h(f.label || '')}" placeholder="backend"></div>
    ${f.id ? `<div><label class="l">Máquina</label><span class="chip">${h(machineName(f.machine_id || defaultMachine()))}</span></div>` : machineSel('data-k="machine_id"', f.machine_id)}
    <div style="grid-column:span 2"><label class="l">Ruta</label><div class="row" style="flex-wrap:nowrap"><input data-k="path" value="${h(f.path || '')}" placeholder="C:\\proyectos\\mi-app" ${f.id ? 'disabled' : ''}>${f.id ? '' : '<button class="btn sm" data-browse>Examinar</button>'}</div></div></div>
    <div class="row"><label class="row" style="font-size:17px"><input type="checkbox" data-k="use_worktrees" ${f.use_worktrees !== 0 ? 'checked' : ''}> worktree por tarea (git)</label>
    <label class="row" style="font-size:17px"><input type="radio" name="isdef" data-k="is_default" ${f.is_default ? 'checked' : ''}> por defecto</label>
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
  for (const r of runs.rows) { const x = byAgent[r.agent_id] ||= { n: 0, ok: 0, t: 0, tk: 0, usd: 0 }; x.n++; if (['listo', 'consulta', 'sin_marcador'].includes(r.end_reason)) x.ok++; if (r.ended_at) x.t += (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000; x.tk += r.tokens_in + r.tokens_out; x.usd += r.cost_usd; }
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
const COLS = [['pendiente', 'Pendiente'], ['en_cola', 'En cola'], ['en_curso', 'En curso'], ['esperando', 'Esperando'], ['revision', 'Revisión'], ['completada', 'Completada'], ['atascadas', 'Atascadas']];
const STUCK = ['bloqueada', 'pausada_cuota', 'fallida'];
const kanban = {
  refreshOn: ['task.updated', 'task.created', 'agent.status'],
  async render(el, r) {
    const pid = +r.args[0] || S.project;
    if (!pid || !project(pid)) { el.innerHTML = `<h1>Kanban</h1><div class="panel empty">Elige un proyecto arriba o <a href="#/proyectos">crea uno</a>.</div>`; return; }
    if (pid !== S.project) { S.project = pid; localStorage.setItem('ov_project', pid); const s = $('#projSel'); if (s) s.value = pid; }
    const p = project(pid);
    const f = S.kf ||= { area: '', agent: '', pri: '', who: '' };
    const all = await get('/api/tasks?project_id=' + pid);
    const tasks = all.filter(t => (!f.area || t.area_id === +f.area) && (!f.agent || t.agent_id === +f.agent) && (!f.pri || t.priority === f.pri) && (!f.who || t.assignee_user_id === +f.who));
    const card = t => {
      const a = agent(t.agent_id), ar = area(t.area_id);
      return `<div class="kcard" draggable="${canEdit()}" data-id="${t.id}" style="--c:${ar?.color || '#46529a'}" tabindex="0">
        <div class="row" style="gap:6px"><small>#${t.id}</small>${ar ? `<span class="chip">${h(ar.alias)}</span>` : ''}${STUCK.includes(t.status) ? chip(t.status) : ''}<small class="pri-${t.priority} right">${PRI[t.priority]}</small></div>
        <div class="t">${h(t.title)}</div>
        <div class="meta">${t.executor === 'humano' ? `${sprite('rebel', '#ff8c42', 2)}${h(user(t.assignee_user_id)?.name || 'sin asignar')}` : `${sprite('droid', a?.color, 2)}${h(a?.name || '—')} <span>${h(t.model || '')}${t.effort ? '·' + h(t.effort) : ''}</span>`}
        ${t.status === 'en_curso' ? `<span class="chip st-en_curso">⏱ ${ago(t.updated_at).replace('hace ', '')}</span>` : ''}${t.status === 'esperando' ? '<span class="chip st-esperando">? responde</span>' : ''}
        ${t.depends_on.length ? `<span title="Depende de #${t.depends_on.join(', #')}">⛓${t.depends_on.length}</span>` : ''}${t.due_date ? `<span>📅${h(t.due_date)}</span>` : ''}</div></div>`;
    };
    el.innerHTML = `<div class="row"><h1 style="margin:0"><span style="color:${h(p.color)}">■</span> ${h(p.name)}</h1>${chip('pendiente', PSTATUS[p.status])}
      <span class="right">${canEdit() ? '<button class="btn y" id="kt">+ Tarea</button><button class="btn" id="km">+ Misión</button>' : ''}<a class="btn o" href="#/consejo?project=${pid}">Consejo</a><button class="btn ghost" id="kf">Ficha</button></span></div>
      <div class="row" style="margin:12px 0">
        <select id="kfA" style="width:auto">${opts(S.boot.areas.map(a => [a.id, a.name]), f.area, 'Todas las áreas')}</select>
        <select id="kfG" style="width:auto">${opts(S.boot.agents.map(a => [a.id, a.name]), f.agent, 'Todos los agentes')}</select>
        <select id="kfP" style="width:auto">${opts([['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], f.pri, 'Toda prioridad')}</select>
        <select id="kfW" style="width:auto">${opts(S.boot.users.map(u => [u.id, u.name]), f.who, 'Cualquier responsable')}</select>
        <small class="muted">Arrastra a "En curso" para ejecutar con el agente asignado.</small></div>
      <div class="kanban">${COLS.map(([k, l]) => {
        const list = tasks.filter(t => k === 'atascadas' ? STUCK.includes(t.status) : t.status === k).sort((a, b) => a.kanban_order - b.kanban_order);
        return `<div class="kcol" data-col="${k}"><div class="kcol-head"><span>${l}</span><span>${list.length}</span></div><div class="kcol-body">${list.map(card).join('')}</div></div>`;
      }).join('')}</div>`;
    $('#kt', el)?.addEventListener('click', () => taskForm({}, { project_id: pid }));
    $('#km', el)?.addEventListener('click', missionForm);
    $('#kf', el).onclick = () => projectCard(pid);
    for (const [id, k] of [['#kfA', 'area'], ['#kfG', 'agent'], ['#kfP', 'pri'], ['#kfW', 'who']]) $(id, el).onchange = e => { f[k] = e.target.value; route(true); };
    el.onclick = e => { const c = e.target.closest('.kcard'); if (c) go('#/tarea/' + c.dataset.id); };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('.kcard')) go('#/tarea/' + e.target.dataset.id); };
    let dragId = null;
    el.addEventListener('dragstart', e => { const c = e.target.closest('.kcard'); if (!c) return; dragId = +c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', e => { e.target.closest?.('.kcard')?.classList.remove('dragging'); $$('.kcol', el).forEach(x => x.classList.remove('over')); });
    $$('.kcol', el).forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async e => {
        e.preventDefault(); col.classList.remove('over');
        if (!dragId) return;
        const k = col.dataset.col;
        const cards = $$('.kcard', col).filter(c => +c.dataset.id !== dragId);
        const after = cards.find(c => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
        const ord = id => all.find(t => t.id === +id)?.kanban_order ?? 0;
        const i = after ? cards.indexOf(after) : cards.length;
        const prev = i > 0 ? ord(cards[i - 1].dataset.id) : (cards[0] ? ord(cards[0].dataset.id) - 1000 : Date.now());
        const next = after ? ord(after.dataset.id) : prev + 2000;
        const t = all.find(x => x.id === dragId);
        const status = k === 'atascadas' ? t.status : k;
        if (status === 'en_curso' && t.executor === 'agente' && t.status !== 'en_curso' && !await confirmBox(`¿Ejecutar #${t.id} con ${agent(t.agent_id)?.name || 'el agente'}?`, 'Ejecutar')) return;
        try { await post(`/api/tasks/${dragId}/move`, { status: status === t.status ? undefined : status, kanban_order: (prev + next) / 2 }); refreshSoon(0); } catch (err) { fail(err); refreshSoon(0); }
      });
    });
  },
};

// ===================== TAREA =====================
const logClass = l => l.startsWith('⚠') ? 'w' : /^[▶■]/.test(l) ? 's' : l.startsWith('💬') ? 'e' : '';
const logHTML = txt => txt.split('\n').map(l => `<div class="${logClass(l)}">${h(l)}</div>`).join('');
function messagesHTML(msgs) {
  return msgs.map(m => `<div class="msg ${m.role} ${m.kind === 'consulta' ? 'consulta' : ''}"><div class="who">${m.role === 'agente' ? agentChip(m.agent_id, 1) : m.role === 'usuario' ? userChip(m.user_id) : 'SISTEMA'} · ${fmtDate(m.at)}${m.kind !== 'mensaje' ? ' · ' + h(m.kind) : ''}</div>${md(m.text)}</div>`).join('') || '<div class="empty">Sin mensajes</div>';
}
function permsHTML(perms) {
  return perms.map(p => `<div class="perm"><b class="pixel" style="font-size:9px">🔐 PERMISO SOLICITADO</b><pre style="white-space:pre-wrap">${h(JSON.stringify(p.input, null, 1)).slice(0, 800)}</pre>
    <button class="btn sm g" data-perm="${h(p.request_id)}" data-allow="1">Aprobar</button><button class="btn sm r" data-perm="${h(p.request_id)}" data-allow="0">Denegar</button></div>`).join('');
}
const tarea = {
  event(type, d, cur) {
    const id = +cur.args[0];
    if (type === 'run.log' && d.task_id === id) {
      const c = $('#console');
      if (c && (+c.dataset.run === d.run_id || c.dataset.live === '1')) {
        if (+c.dataset.run !== d.run_id) { c.dataset.run = d.run_id; c.innerHTML = ''; }
        const stick = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
        c.insertAdjacentHTML('beforeend', `<div class="${logClass(d.line)}">${h(d.line)}</div>`);
        if (stick) c.scrollTop = c.scrollHeight;
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
    const tab = S.taskTab ||= 'consola';
    const running = x.running || x.queued;
    const can = canEdit();
    const btn = (cond, id2, cls, label) => cond && can ? `<button class="btn ${cls}" id="${id2}">${label}</button>` : '';
    el.innerHTML = `<div class="row"><a href="#/kanban/${t.project_id}" class="btn ghost sm">← ${h(x.project.name)}</a><h1 style="margin:0">#${t.id} ${h(t.title)}</h1>${chip(t.status)}</div>
      <div class="row" style="margin:10px 0">${ar ? `<span class="chip" style="border-color:${ar.color}">${h(ar.alias)} · ${h(ar.name)}</span>` : ''}
        ${t.executor === 'humano' ? `<span class="chip">Persona: ${h(user(t.assignee_user_id)?.name || 'sin asignar')}</span>` : `${agentChip(t.agent_id)}<span class="chip">${h(t.model || '-')} · ${h(t.effort || '-')} · ${h(t.mode)}</span>`}
        <span class="chip pri-${t.priority}">${PRI[t.priority]}</span>${x.folder ? `<span class="chip" title="${h(x.folder.path)}">📁 ${h(x.folder.label)}</span>` : '<span class="chip">sandbox</span>'}
        ${t.executor === 'agente' && machines().length ? `<span class="chip">🖥 ${h(x.machine || '')}${x.machine_online ? '' : ' (desconectada)'}</span>` : ''}
        ${t.branch ? `<span class="chip">rama ${h(t.branch)}</span>` : ''}${t.due_date ? `<span class="chip">📅 ${h(t.due_date)}</span>` : ''}<small class="muted">creada por ${h(user(t.created_by)?.name || '-')} ${ago(t.created_at)}</small></div>
      <div class="row">
        ${btn(t.executor === 'agente' && !running && t.status !== 'completada', 'bRun', 'y', t.conversation_id && ['esperando', 'fallida', 'pausada_cuota'].includes(t.status) ? '▶ Ejecutar de nuevo' : '▶ Ejecutar')}
        ${btn(running, 'bAbort', 'r', '■ Abortar')}
        ${btn(['revision', 'esperando'].includes(t.status), 'bApprove', 'g', '✔ Aprobar')}
        ${btn(t.status === 'revision', 'bReturn', 'o', '↩ Devolver')}
        ${btn(t.status !== 'completada', 'bHand', '', '⇄ Pasar a otro')}
        ${btn(true, 'bEdit', 'ghost', 'Editar')}
        ${btn(t.executor === 'agente' && !running, 'bDecomp', 'ghost', 'Descomponer')}
        ${btn(['completada', 'revision'].includes(t.status), 'bReview', 'ghost', '¿Qué mejorarías?')}
        ${btn(t.executor === 'humano' && t.status !== 'completada', 'bHumDone', 'g', 'Marcar completada')}
        ${btn(true, 'bDel', 'r right', 'Eliminar')}
      </div>
      ${permsHTML(x.permissions)}
      ${t.executor === 'agente' && t.status !== 'completada' ? offlineWarn(x.machine, x.machine_online) : ''}
      ${t.status === 'esperando' ? `<div class="panel y" style="margin:10px 0"><b class="pixel" style="font-size:9px;color:var(--yellow)">? EL AGENTE ESPERA TU RESPUESTA</b><div>${md((([a, b = '']) => b.trim() || a)((x.messages.filter(m => m.role === 'agente').at(-1)?.text || '').split('[[CONSULTA]]')))}</div></div>` : ''}
      ${t.status === 'pausada_cuota' ? `<div class="panel r" style="margin:10px 0"><b class="pixel" style="font-size:9px">⛽ ${h(a?.name)} SE QUEDÓ SIN CUOTA</b><p>El avance quedó guardado (checkpoint + snapshot). Elige quién continúa.</p>${can ? '<button class="btn y" id="bHand2">Elegir relevo</button>' : ''} ${a?.quota_reset_at ? `<small>o espera a ${h(a.name)}: vuelve ${ago(a.quota_reset_at)}</small>` : ''}</div>` : ''}
      ${t.summary ? `<div class="panel h" style="margin:10px 0"><b class="pixel" style="font-size:9px;color:var(--holo)">RESUMEN DEL AGENTE</b>${md(t.summary)}</div>` : ''}
      ${t.review_comment ? `<div class="panel" style="margin:10px 0"><b class="pixel" style="font-size:9px">COMENTARIO DE REVISIÓN</b>${md(t.review_comment)}</div>` : ''}
      <div class="panel" style="margin:10px 0"><div class="row"><b class="pixel" style="font-size:9px">ADJUNTOS (${x.attachments.length})</b>
        ${can ? '<label class="btn sm right">+ Adjuntar<input type="file" id="attIn" multiple hidden></label>' : ''}</div>${attachmentsHTML(x.attachments, can)}</div>
      <div class="tabs" style="margin-top:14px">${[['consola', 'Consola'], ['chat', `Chat (${x.messages.length})`], ['cambios', 'Cambios'], ['runs', `Ejecuciones (${x.runs.length})`], ['relevos', `Relevos (${x.handoffs.length})`], ['historial', 'Historial'], ['detalles', 'Detalles']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="tabBody"></div>`;
    const body = $('#tabBody', el);
    const reply = () => `<form id="replyF" class="col-flex" style="margin-top:10px">${can ? `<textarea id="replyT" placeholder="${t.executor === 'humano' || !t.conversation_id ? 'Agregar nota…' : t.status === 'esperando' ? 'Responde al agente…' : 'Mensaje para el agente (reanuda la sesión)…'}" rows="3"></textarea>
      <div class="row"><button class="btn y">${t.executor === 'humano' || !t.conversation_id ? 'Agregar nota' : 'Enviar al agente'}</button>${t.conversation_id && t.executor === 'agente' ? '<button class="btn ghost" id="noteB" type="button">Solo nota</button>' : ''}</div>` : ''}</form>`;
    if (tab === 'consola') {
      const runId = S.taskRun?.[id] || x.runs[0]?.id;
      body.innerHTML = x.runs.length ? `<div class="row"><select id="runSel" style="width:auto">${opts(x.runs.map(r => [r.id, `Turno ${r.turn} · ${agent(r.agent_id)?.name} · ${r.end_reason || 'en curso'} · ${fmtDate(r.started_at)}`]), runId)}</select>
        <small class="muted">${h(x.runs.find(r => r.id === runId)?.command || '')}</small></div><div class="console" id="console" data-scroll="console" data-run="${runId}" data-live="${runId === x.runs[0]?.id ? 1 : 0}">cargando…</div>` : '<div class="empty">Aún no se ejecuta. Pulsa ▶ Ejecutar.</div>';
      if (runId) {
        get(`/api/runs/${runId}/log`).then(lg => { const c = $('#console', el); if (c) { c.innerHTML = logHTML(lg.log); c.scrollTop = c.scrollHeight; } });
        $('#runSel', body).onchange = e => { (S.taskRun ||= {})[id] = +e.target.value; route(true); };
      }
    } else if (tab === 'chat') {
      body.innerHTML = `<div class="chat" data-scroll="chat">${messagesHTML(x.messages)}</div>${reply()}`;
      const c = $('.chat', body); c.scrollTop = c.scrollHeight;
    } else if (tab === 'cambios') {
      body.innerHTML = '<div class="empty">Cargando diff…</div>';
      get(`/api/tasks/${id}/diff`).then(df => {
        body.innerHTML = df.diff || df.log ? `${df.log ? `<h3>Commits</h3><pre class="console" style="height:auto;max-height:200px">${h(df.log)}</pre>` : ''}<h3>Diff</h3><pre class="console" style="height:auto;max-height:70vh">${df.diff.split('\n').map(l => `<span style="color:${l.startsWith('+') ? '#7CFC00' : l.startsWith('-') ? '#ff6b6b' : l.startsWith('@@') ? '#4fc3f7' : '#bbb'}">${h(l)}</span>`).join('\n')}</pre>` : `<div class="empty">Sin cambios en git${x.files.length ? '' : ''}.</div>`;
        if (x.files.length) body.insertAdjacentHTML('beforeend', `<h3>Archivos producidos (sandbox)</h3>${x.files.map(f => `<div><a href="/api/tasks/${id}/file?name=${encodeURIComponent(f.name)}">${h(f.name)}</a> <small>${bytes(f.size)}</small></div>`).join('')}`);
      });
    } else if (tab === 'runs') {
      body.innerHTML = `<div class="table-wrap"><table class="grid"><tr><th>Turno</th><th>Agente</th><th>Modelo</th><th>Inicio</th><th>Duración</th><th>Fin</th><th>Tokens</th><th>Costo</th><th>Cambios</th></tr>
        ${x.runs.map(r => `<tr class="click" data-run="${r.id}"><td>${r.turn}</td><td>${agentChip(r.agent_id)}</td><td>${h(r.model || '')} ${h(r.effort || '')}</td><td>${fmtDate(r.started_at)}<br><small>${userChip(r.started_by)}</small></td>
        <td>${r.ended_at ? dur((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) : '…'}</td><td>${h(r.end_reason || 'en curso')}</td><td>${num(r.tokens_in + r.tokens_out)}</td><td>$${(r.cost_usd || 0).toFixed(3)}</td><td><small>${h((r.diff_stat || '').split('\n').pop())}</small></td></tr>`).join('')}</table></div>`;
      $$('[data-run]', body).forEach(tr => tr.onclick = () => { (S.taskRun ||= {})[id] = +tr.dataset.run; S.taskTab = 'consola'; route(true); });
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
    $$('.tabs [data-tab]', el).forEach(b => b.onclick = () => { S.taskTab = b.dataset.tab; route(true); });
    $('#attIn', el)?.addEventListener('change', async e => { try { await uploadAll([...e.target.files], { task_id: id }); holo('Adjuntado', 'Lo recibirá el agente en su próximo turno'); } catch (err) { fail(err); } });
    $('#replyF', el)?.addEventListener('submit', async e => {
      e.preventDefault(); const text = $('#replyT').value.trim(); if (!text) return;
      try { await post(`/api/tasks/${id}/reply`, { text }); $('#replyT').value = ''; beep('ok'); refreshSoon(0); } catch (err) { fail(err); }
    });
    $('#noteB', el)?.addEventListener('click', async () => { const text = $('#replyT').value.trim(); if (!text) return; await act(() => post(`/api/tasks/${id}/note`, { text })); $('#replyT').value = ''; refreshSoon(0); });
    const on = (sel, fn) => $(sel, el)?.addEventListener('click', fn);
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
    try { await post(`/api/tasks/${t.id}/run`, { agent_id: +f.agent_id, model: f.model, effort: f.effort, mode: f.mode, fresh: f.fresh }); closeModal(); S.taskTab = 'consola'; if (S.taskRun) delete S.taskRun[t.id]; beep('ok'); refreshSoon(0); } catch (err) { fail(err); }
  };
}
function approveDialog(t) {
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
      const c = $('#chatLive'); if (c) { c.hidden = false; c.insertAdjacentHTML('beforeend', `<div class="${logClass(d.line)}">${h(d.line)}</div>`); c.scrollTop = c.scrollHeight; }
      return 'handled';
    }
    if (type === 'conv.updated' || type === 'run.started' || type === 'permiso') return 'refresh';
  },
  async render(el, r) {
    const cid = +r.args[0];
    const q = S.chatQ ||= { q: '', archived: false };
    const list = await get(`/api/conversations?q=${encodeURIComponent(q.q)}${q.archived ? '&archived=1' : ''}`);
    const left = `<div class="col-flex"><button class="btn y" id="newChat">+ Nueva consulta</button><input id="chatQ" placeholder="Buscar chats" value="${h(q.q)}">
      <label class="row" style="font-size:17px"><input type="checkbox" id="chatArch" ${q.archived ? 'checked' : ''}> ver archivados</label>
      <div class="chat-list" data-scroll="clist">${list.map(c => `<div class="chat-item ${c.id === cid ? 'on' : ''}" data-c="${c.id}"><div class="row" style="gap:6px">${sprite('droid', agent(c.agent_id)?.color, 2)}<b class="ellipsis grow">${c.pinned ? '📌 ' : ''}${h(c.title)}</b>${c.status === 'esperando' ? '<span class="chip st-esperando">?</span>' : c.status === 'en_curso' ? '<span class="chip st-en_curso">…</span>' : ''}</div><small>${h(agent(c.agent_id)?.name)} · ${c.n_runs} turnos · ${ago(c.updated_at)}</small></div>`).join('') || '<div class="empty">Sin consultas todavía</div>'}</div></div>`;
    let right;
    if (!cid) {
      right = `<div class="panel y"><h2 style="margin-top:0">Nueva consulta rápida</h2><p class="muted">Pregunta lo que sea a un agente sin crear tarea. Queda en el historial y puedes convertirla en tarea o proyecto.</p>
        <form id="ncF">${agentPicker('nc', {}, { modes: false })}
        <div class="field-row"><div><label class="l">Modo</label><select name="mode">${opts([['plan', 'Solo lectura'], ['editar', 'Puede editar archivos']], 'plan')}</select></div>
        <div><label class="l">Proyecto (contexto, opcional)</label><select name="project_id" id="ncProj">${opts(S.boot.projects.map(p => [p.id, p.name]), '', '—')}</select></div></div>
        <div class="field-row">${machineSel('name="machine_id" id="ncMachine"')}</div>
        <label class="l">Carpeta (opcional)</label><div class="row" style="flex-wrap:nowrap"><input name="folder_path" id="ncFolder" placeholder="C:\\ruta\\al\\código"><button class="btn sm" type="button" id="ncBrowse">Examinar</button></div>
        <label class="l">Mensaje</label><textarea name="text" id="ncText" rows="5" required></textarea>
        <label class="l">Adjuntos (opcional)</label><input type="file" id="ncFiles" multiple>
        <button class="btn y" style="margin-top:10px">Enviar a la cantina</button></form></div>`;
    } else {
      const x = await get('/api/conversations/' + cid);
      const c = x.conversation;
      right = `<div class="panel"><div class="row"><h2 style="margin:0" class="grow ellipsis">${c.pinned ? '📌 ' : ''}${h(c.title)}</h2>${chip(c.status === 'inactiva' ? 'completada' : c.status === 'error' ? 'fallida' : c.status === 'sin_cuota' ? 'pausada_cuota' : c.status, c.status)}</div>
        ${offlineWarn(x.machine, x.machine_online)}
        <div class="row" style="margin:8px 0">${agentChip(c.agent_id)}${machines().length > 1 ? `<span class="chip">🖥 ${h(x.machine || '')}</span>` : ''}<span class="chip">${h(c.model || '-')} · ${h(c.effort || '-')} · ${c.mode === 'plan' ? 'lectura' : 'edición'}</span>${c.folder_path ? `<span class="chip" title="${h(c.folder_path)}">📁 ${h(c.folder_path.split(/[\\/]/).pop())}</span>` : ''}${c.project_id ? `<span class="chip">${h(project(c.project_id)?.name || '')}</span>` : ''}${c.task_id ? `<a class="chip" href="#/tarea/${c.task_id}">→ tarea #${c.task_id}</a>` : ''}</div>
        ${canEdit() ? `<div class="row">${x.running ? '<button class="btn sm r" id="cAbort">■ Abortar</button>' : ''}<button class="btn sm" id="cSwitch">⇄ Cambiar agente</button><button class="btn sm g" id="cTask">→ Tarea</button><button class="btn sm" id="cProj">→ Proyecto</button>
          <button class="btn sm ghost" id="cRename">Renombrar</button><button class="btn sm ghost" id="cPin">${c.pinned ? 'Desfijar' : 'Fijar'}</button><button class="btn sm ghost" id="cArch">${c.archived ? 'Desarchivar' : 'Archivar'}</button>
          <a class="btn sm ghost" href="/api/conversations/${cid}/md">Exportar .md</a><button class="btn sm r" id="cDel">Eliminar</button></div>` : ''}
        ${permsHTML(x.permissions)}
        ${x.attachments.length ? `<div style="margin-top:8px">${attachmentsHTML(x.attachments, canEdit())}</div>` : ''}
        <div class="chat" data-scroll="chat" style="margin-top:10px">${messagesHTML(x.messages)}</div>
        <div class="console" id="chatLive" style="height:160px" ${x.running ? '' : 'hidden'}></div>
        ${canEdit() ? `<form id="crF" class="col-flex" style="margin-top:10px"><textarea id="crT" rows="3" placeholder="${c.status === 'esperando' ? 'Responde la consulta…' : 'Sigue la conversación…'}"></textarea><div class="row"><button class="btn y" ${x.running ? 'disabled' : ''}>Enviar</button><label class="btn ghost">📎 Adjuntar<input type="file" id="crFiles" multiple hidden></label><small id="crFilesN" class="muted"></small></div></form>` : ''}</div>`;
      setTimeout(() => { const ch = $('.chat', el); if (ch) ch.scrollTop = ch.scrollHeight; });
      if (x.running && x.runs[0]) get(`/api/runs/${x.runs[0].id}/log`).then(lg => { const lv = $('#chatLive', el); if (lv) { lv.innerHTML = logHTML(lg.log); lv.scrollTop = lv.scrollHeight; } });
    }
    el.innerHTML = `<h1>Cantina de Mos Eisley</h1><div class="cantina">${left}<div>${right}</div></div>`;
    $('#newChat', el).onclick = () => go('#/cantina');
    $('#chatQ', el).oninput = e => { q.q = e.target.value; clearTimeout(S.cq); S.cq = setTimeout(() => route(true), 300); };
    $('#chatArch', el).onchange = e => { q.archived = e.target.checked; route(true); };
    $$('[data-c]', el).forEach(i => i.onclick = () => go('#/cantina/' + i.dataset.c));
    if (!cid) {
      bindPicker(el, 'nc');
      $('#ncBrowse', el).onclick = () => browseInto($('#ncFolder', el), $('#ncMachine', el)?.value);
      $('#ncProj', el).onchange = e => { const p = project(e.target.value); const f = p?.folders.find(x => x.is_default); if (f && !$('#ncFolder', el).value) $('#ncFolder', el).value = f.path; };
      $('#ncF', el).onsubmit = async e => {
        e.preventDefault(); const f = formData(e.target);
        try {
          const attachment_ids = await uploadAll([...$('#ncFiles', el).files], {});
          const r2 = await post('/api/conversations', { ...f, agent_id: +f.agent_id, project_id: +f.project_id || null, machine_id: +f.machine_id || null, attachment_ids });
          beep('ok'); go('#/cantina/' + r2.id);
        } catch (err) { fail(err); }
      };
      return;
    }
    const on = (sel, fn) => $(sel, el)?.addEventListener('click', fn);
    $('#crFiles', el)?.addEventListener('change', e => { $('#crFilesN', el).textContent = [...e.target.files].map(f => f.name).join(', '); });
    $('#crF', el)?.addEventListener('submit', async e => {
      e.preventDefault(); const text = $('#crT').value.trim(); if (!text) return;
      try { await uploadAll([...$('#crFiles', el).files], { conversation_id: cid }); await post(`/api/conversations/${cid}/reply`, { text }); $('#crT').value = ''; refreshSoon(0); } catch (err) { fail(err); }
    });
    on('#cAbort', () => act(() => post(`/api/conversations/${cid}/abort`)));
    on('#cRename', async () => { const v = await promptBox('Renombrar', 'Título', $('h2', el).textContent.replace('📌 ', '')); if (v) await act(() => put('/api/conversations/' + cid, { title: v })); });
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
        <label class="l">Título</label><input name="title" value="${h($('h2', el).textContent.replace('📌 ', ''))}"><label class="l">Instrucciones adicionales</label><textarea name="prompt"></textarea>
        <p class="muted">La conversación completa se adjunta a la tarea y queda vinculada.</p><div class="row"><button class="btn y" id="ctOk">Crear tarea</button><button class="btn ghost" value="c">Cancelar</button></div>`);
      $('#ctOk', d).onclick = async e => { e.preventDefault(); const f = formData(d); if (!f.project_id) return fail('Crea un proyecto primero'); try { const r2 = await post(`/api/conversations/${cid}/to-task`, { ...f, project_id: +f.project_id, area_id: +f.area_id || null, folder_id: project(f.project_id)?.folders.find(x => x.is_default)?.id || null }); closeModal(); go('#/tarea/' + r2.id); } catch (err) { fail(err); } };
    });
    on('#cProj', async () => { const n = await promptBox('Crear proyecto desde este chat', 'Nombre del proyecto', $('h2', el).textContent.replace('📌 ', '')); if (n) { const r2 = await act(() => post(`/api/conversations/${cid}/new-project`, { name: n }), 'Proyecto creado'); await loadBoot(); S.project = r2.id; localStorage.setItem('ov_project', r2.id); go('#/proyectos'); } });
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
          <td>${JSON.parse(v.lenses || '[]').map(l => `<span class="chip">${h(S.boot.lenses[l]?.[0] || l)}</span>`).join(' ')}</td><td>${JSON.parse(v.agents || '[]').map(a => sprite('droid', agent(a.agent_id)?.color, 2)).join('')}</td>
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
      <details style="margin:10px 0"><summary class="pixel" style="font-size:9px;cursor:pointer">Informe enviado al consejo</summary><div class="panel">${md(v.digest_md)}</div></details>
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
    <div class="field-row"><div><label class="l">Proyectos</label><select name="project_ids" multiple size="3">${S.boot.projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${h(p.name)}</option>`).join('')}</select></div>
      <div><label class="l">Áreas</label><select name="area_ids" multiple size="3">${S.boot.areas.map(a => `<option value="${a.id}">${h(a.name)}</option>`).join('')}</select></div>
      <div><label class="l">Hecho por</label><select name="agent_ids" multiple size="3">${S.boot.agents.map(a => `<option value="${a.id}">${h(a.name)}</option>`).join('')}</select></div></div>
    <div class="field-row"><div><label class="l">Últimas N tareas</label><input type="number" name="last_n" value="10" min="1" max="50"></div><div><label class="l">Desde</label><input type="date" name="from"></div><div><label class="l">Hasta</label><input type="date" name="to"></div></div>
    <button class="btn sm" id="cvDig">Generar informe</button>
    <label class="l">Informe (editable antes de enviar)</label><textarea name="digest_md" id="cvMd" rows="8" placeholder="Pulsa «Generar informe»"></textarea>
    <h3>2 · Lentes: ¿qué tipo de mejora buscas?</h3>
    <div class="grid3">${Object.entries(L).map(([k, [n, desc]]) => `<label class="row" style="font-size:17px;align-items:flex-start" title="${h(desc)}"><input type="checkbox" name="lens" value="${k}" ${['siguiente'].includes(k) ? 'checked' : ''}><span><b>${h(n)}</b><br><small>${h(desc).slice(0, 70)}</small></span></label>`).join('')}</div>
    <label class="l">Pedido libre (lente «Libre»)</label><input name="custom" placeholder="p. ej. ¿cómo reducimos los tiempos de respuesta?">
    <h3>3 · ¿Quién opina?</h3>
    ${agentsOn().map((a, i) => `<div class="row" style="margin:4px 0"><label class="row" style="min-width:170px"><input type="checkbox" name="ag" value="${a.id}" ${i === 0 ? 'checked' : ''}>${sprite('droid', a.color, 2)} ${h(a.name)}</label>
      <input style="max-width:220px" data-m="${a.id}" list="cvm${a.id}" value="${h(a.default_model)}"><datalist id="cvm${a.id}">${a.models.map(m => `<option value="${h(m)}">`).join('')}</datalist>
      <select style="max-width:120px" data-e="${a.id}">${opts(a.efforts.map(e => [e, e]), a.default_effort)}</select></div>`).join('')}
    <label class="l">Moderador (consolida si opinan varios)</label><select name="moderator">${opts(agentsOn().map(a => [a.id, a.name]), '', 'Sin moderador (consolidación automática)')}</select>
    <div class="row" style="margin-top:12px"><button class="btn y" id="cvOk">Convocar</button><button class="btn ghost" value="c">Cancelar</button></div>`);
  const scope = () => {
    const ms = n => [...d.querySelector(`[name=${n}]`).selectedOptions].map(o => +o.value);
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
  ejecuciones: [['#', r => r.id], ['Tarea/Chat', r => r.task_id ? `tarea #${r.task_id}` : `chat #${r.conversation_id}`], ['Agente', r => agentChip(r.agent_id)], ['Modelo', r => h(`${r.model || ''} ${r.effort || ''}`)], ['Inicio', r => fmtDate(r.started_at)], ['Duración', r => r.ended_at ? dur((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) : '…'], ['Fin', r => h(r.end_reason || 'en curso')], ['Tokens', r => num(r.tokens_in + r.tokens_out)], ['Costo', r => '$' + (r.cost_usd || 0).toFixed(3)], ['Lanzó', r => userChip(r.started_by)]],
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
        <input id="afS" style="max-width:140px" placeholder="estado/tipo" value="${h(f.status || '')}"><input id="afF" type="date" style="max-width:170px" value="${h(f.from || '')}"><input id="afT" type="date" style="max-width:170px" value="${h(f.to || '')}">
        <input id="afQ" style="max-width:200px" placeholder="texto" value="${h(f.q || '')}"><button class="btn sm" id="afGo">Filtrar</button><button class="btn sm ghost" id="afClr">Limpiar</button>
        <a class="btn sm o" href="/api/history/${tab}?${qs}&format=csv">CSV</a></div>
        <div class="panel table-wrap"><table class="grid"><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>
        ${data.rows.map((row, i) => `<tr class="click" data-i="${i}">${cols.map(c => `<td>${c[1](row)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">Vacío</td></tr>`}</table></div>
        <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="pgP" ${data.page <= 1 ? 'disabled' : ''}>◀</button><span>Página ${data.page} de ${Math.max(1, Math.ceil(data.total / data.size))} · ${data.total} registros</span><button class="btn sm ghost" id="pgN" ${data.page * data.size >= data.total ? 'disabled' : ''}>▶</button></div>`;
      S.arows = data.rows;
    }
    el.innerHTML = `<h1>Archivos Jedi</h1><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${bodyHTML}`;
    $$('[data-t]', el).forEach(b => b.onclick = () => { f.page = 1; go('#/archivos/' + b.dataset.t); });
    $('#sF', el)?.addEventListener('submit', e => { e.preventDefault(); go('#/archivos/buscar?q=' + encodeURIComponent($('#sQ').value)); });
    const apply = () => { Object.assign(f, { user_id: $('#afU').value, agent_id: $('#afG').value, project_id: $('#afP').value, area_id: $('#afA').value, status: $('#afS').value, from: $('#afF').value, to: $('#afT').value, q: $('#afQ').value, page: 1 }); route(true); };
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
      return `<div class="panel agent-card" style="--c:${a.color}"><div class="row">${sprite('droid', a.color, 4)}<div class="grow"><h2 style="margin:0;color:${a.color}">${h(a.name)}</h2><span class="dot ${d}"></span> <b>${l}</b>${a.state === 'sin_cuota' && a.quota_reset_at ? ` · vuelve ${ago(a.quota_reset_at)}` : ''}</div>
        <div class="col-flex" style="gap:0">${canEdit() ? `<button class="btn sm" data-test="${a.id}">Probar</button>` : ''}${a.state === 'sin_cuota' && canEdit() ? `<button class="btn sm y" data-react="${a.id}">Reactivar</button>` : ''}</div></div>
        <div class="kv" style="margin-top:8px"><b>Versión</b><span>${h(a.version || (a.found === false ? 'no encontrado' : '—'))}</span><b>Ejecutable</b><span class="ellipsis" title="${h(a.exe)}">${h(a.exe)}</span>
          <b>Trabajo</b><span>${a.busy}/${a.max_concurrent} activos · ${a.queued} en cola</span><b>Por defecto</b><span>${h(a.default_model)} · ${h(a.default_effort)}</span>
          <b>Éxito</b><span>${a.success_rate ?? '—'}% · media ${a.avg_duration_s != null ? dur(a.avg_duration_s) : '—'} · ${a.tasks_done} tareas</span>
          <b>Cortes cuota 7d</b><span>${a.quota_cuts_7d}${a.last_quota_cut ? ' · último ' + ago(a.last_quota_cut) : ''}</span>
          ${a.last_test ? `<b>Última prueba</b><span>${a.last_test.ok ? '✔ OK' : '✘ ' + h(a.last_test.error || a.last_test.end_reason || 'falló')} · ${a.last_test.latency_ms ? dur(a.last_test.latency_ms / 1000) : ''} · ${ago(a.last_test.at)}</span>` : ''}
          ${a.last_error ? `<b>Último error</b><span style="color:var(--red)">${h(a.last_error).slice(0, 180)}</span>` : ''}</div>
        <h3>Límites informados por el CLI</h3>${a.limits_cli.map(x => `<div class="limit"><span>${h(WINL[x.win] || x.win)}</span>${saber(x.used_value, lvl(x.used_value))}<span>${Math.round(x.used_value)}%${x.resets_at ? `<br><small>${ago(x.resets_at)}</small>` : ''}</span></div>`).join('') || '<small class="muted">No informado por el CLI (se capturan al ejecutar)</small>'}
        ${a.limits_manual.length ? `<h3>Límites manuales</h3>${a.limits_manual.map(x => `<div class="limit"><span>${h(x.win)} ${h(x.metric)}</span>${saber(x.pct, lvl(x.pct))}<span>${x.pct}%<br><small>${num(Math.round(x.used_value * 100) / 100)}/${num(x.limit_value)}</small></span></div>`).join('')}` : ''}
        <h3>Consumo medido</h3><table class="grid"><tr><th></th><th>Tokens</th><th>Costo</th><th>Runs</th></tr>${Object.entries(a.usage).map(([w, u]) => `<tr><td>${w}</td><td>${num(u.tokens)}</td><td>$${u.usd.toFixed(2)}</td><td>${u.runs}</td></tr>`).join('')}</table>
        <h3>Tokens (ventana 5h) · últimas 24h</h3><div class="spark" style="--c:${a.color}">${snaps.map(x => `<i style="height:${Math.max(2, (x.detail.usage5h?.tokens || 0) / max * 100)}%" title="${fmtDate(x.at)} · ${x.state}"></i>`).join('') || '<small class="muted">sin datos</small>'}</div></div>`;
    };
    el.innerHTML = `<div class="row"><h1 style="margin:0">Puente de Mando</h1><small class="muted">último escaneo ${ago(s.last_scan)}</small>
      <span class="right">${canEdit() ? '<button class="btn y" id="scan">Escanear ahora</button><button class="btn" id="ntest">Notificación de prueba</button><button class="btn ghost" id="ttest">Toast Windows</button>' : ''}
      ${isAdmin() ? (s.queue_paused ? '<button class="btn g" id="resume">Reanudar cola</button>' : '<button class="btn r" id="o66">ORDEN 66</button>') : ''}</span></div>
      ${s.queue_paused ? '<div class="panel r" style="margin:10px 0">La cola está en pausa: nada nuevo se ejecuta.</div>' : ''}
      <h2>Máquinas</h2><div class="grid3">${s.machines.map(m => `<div class="panel ${m.online ? 'h' : 'r'}"><div class="row">${sprite('desk', m.online ? '#3ddc84' : '#ff3b3b', 3)}<div class="grow"><b class="pixel" style="font-size:9px">${h(m.name)}</b>${m.is_default ? ' ★' : ''}<br>
        <span class="dot ${m.online ? 'ok' : 'bad'}"></span> ${m.online ? 'conectada' : 'desconectada'} · ${m.is_local ? 'este servidor' : 'agente de campo'}</div></div>
        <div class="kv" style="margin-top:6px"><b>Visto</b><span>${ago(m.last_seen)}</span><b>Equipo</b><span>${h(m.info?.hostname || '-')} ${h(m.info?.platform || '')}</span><b>Ejecutando</b><span>${m.running}</span>${m.info?.roots ? `<b>Raíces</b><span class="ellipsis">${h(m.info.roots.join(', '))}</span>` : ''}</div></div>`).join('') || `<div class="panel r">No hay máquinas. ${isAdmin() ? '<a href="#/config/maquinas">Conecta esta PC</a>' : ''}</div>`}</div>
      <h2>Agentes</h2><div class="grid2">${s.agents.filter(a => a.enabled || a.found !== false).map(card).join('')}</div>
      <h2>Trabajo en curso</h2><div class="panel table-wrap"><table class="grid"><tr><th>Run</th><th>Tarea / chat</th><th>Agente</th><th>Modelo</th><th>PID</th><th>Memoria</th><th>CPU</th><th>Desde</th><th></th></tr>
        ${s.work.active.map(w => `<tr><td>${w.run_id}</td><td><a href="${w.task_id ? '#/tarea/' + w.task_id : '#/cantina/' + w.conv_id}">${h(w.title || '')}</a></td><td>${agentChip(w.agent_id)}</td><td>${h(w.model || '')} ${h(w.effort || '')}</td><td>${w.pid}</td><td>${h(w.mem || '-')}</td><td>${h(w.cpu_time || '-')}</td><td>${ago(w.started_at)}</td>
        <td>${canEdit() ? `<button class="btn sm r" data-abort="${w.task_id ? 't' + w.task_id : 'c' + w.conv_id}">Abortar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Ningún droide trabajando</td></tr>'}</table>
        <p>En cola: ${s.work.queue.map(q => h(q.title)).join(', ') || '—'} · Bloqueadas: ${s.work.blocked} · Fallidas 24h: ${s.work.failed_24h} · Permisos pendientes: ${s.work.permissions.length}</p>
        <h3>Esperando a un humano</h3>${[...s.work.waiting.map(t => `<a href="#/tarea/${t.id}">#${t.id} ${h(t.title)}</a> ${chip(t.status)}`), ...s.work.waiting_chats.map(c => `<a href="#/cantina/${c.id}">💬 ${h(c.title)}</a>`)].join(' · ') || '<small class="muted">nada</small>'}</div>
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
  async render(el, r) {
    const admin = isAdmin();
    const tabs = [...(admin ? [['maquinas', 'Máquinas'], ['agentes', 'Agentes'], ['areas', 'Áreas'], ['usuarios', 'Usuarios'], ['limites', 'Límites'], ['auto', 'Automatización']] : []), ['plantillas', 'Plantillas'], ['perfil', 'Mi perfil']];
    const tab = tabs.find(t => t[0] === r.args[0]) ? r.args[0] : tabs[0][0];
    let body = '';
    if (tab === 'maquinas') {
      const ms = await get('/api/machines');
      body = `<p class="muted">Una máquina es donde se ejecutan los agentes y viven los archivos. Si la oficina corre en el VPS, conecta tu PC con el <b>agente de campo</b>: sale hacia el VPS por HTTPS (no abre puertos) y ejecuta aquí Claude, Codex, git y archivos.</p>
        <div class="panel table-wrap"><table class="grid"><tr><th>Máquina</th><th>Tipo</th><th>Estado</th><th>Equipo</th><th>Visto</th><th></th></tr>
        ${ms.map(m => `<tr><td><b>${h(m.name)}</b>${m.is_default ? ' ★ por defecto' : ''}</td><td>${m.is_local ? 'este servidor' : 'agente de campo'}</td><td><span class="dot ${m.online ? 'ok' : 'bad'}"></span> ${m.online ? 'conectada' : 'desconectada'}</td>
          <td>${h(m.info?.hostname || '-')}<br><small>${h((m.info?.roots || []).join(', '))}</small></td><td>${ago(m.last_seen)}</td>
          <td>${m.is_default ? '' : `<button class="btn sm y" data-mdef="${m.id}">Por defecto</button>`}<button class="btn sm ghost" data-mren="${m.id}">Renombrar</button>${m.is_local ? '' : `<button class="btn sm r" data-mdel="${m.id}">Eliminar</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin máquinas</td></tr>'}</table></div>
        <form class="panel" id="newMachine" style="margin-top:12px"><h3>Conectar una PC (agente de campo)</h3><label class="l">Nombre</label><input name="name" required placeholder="PC de la oficina"><button class="btn y" style="margin-top:10px">Generar token</button></form>`;
    } else if (tab === 'agentes') {
      const list = await get('/api/agents');
      body = list.map(a => `<form class="panel agent-card" data-agent="${a.id}" style="--c:${a.color};margin-bottom:14px">
        <div class="row">${sprite('droid', a.color, 4)}<h2 style="margin:0;color:${a.color}">${h(a.name)}</h2><span class="chip">${h(a.key)} · adaptador ${h(a.adapter)}</span><label class="row right"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''}> habilitado</label></div>
        <div class="field-row"><div><label class="l">Nombre</label><input name="name" value="${h(a.name)}"></div><div><label class="l">Color</label><input type="color" name="color" value="${h(a.color || '#4fc3f7')}" style="height:40px"></div>
          <div><label class="l">Concurrencia máx.</label><input type="number" name="max_concurrent" min="1" value="${a.max_concurrent}"></div><div><label class="l">Timeout (min)</label><input type="number" name="timeout_min" min="1" value="${a.timeout_min}"></div></div>
        <label class="l">Ejecutable</label><input name="exe" value="${h(a.exe)}">
        <div class="field-row"><div><label class="l">Args previos (JSON)</label><input name="pre_args" value="${h(JSON.stringify(a.pre_args))}"></div><div><label class="l">Args extra (JSON, al final)</label><input name="extra_args" value="${h(JSON.stringify(a.extra_args))}"></div></div>
        <label class="l">Modelos (separados por coma)</label><div class="row" style="flex-wrap:nowrap"><input name="models" value="${h(a.models.join(', '))}"><button class="btn sm" data-detect="${a.id}" type="button">Detectar</button></div>
        <div class="field-row"><div><label class="l">Esfuerzos</label><input name="efforts" value="${h(a.efforts.join(', '))}"></div><div><label class="l">Modelo por defecto</label><input name="default_model" value="${h(a.default_model)}"></div><div><label class="l">Esfuerzo por defecto</label><input name="default_effort" value="${h(a.default_effort)}"></div></div>
        <label class="l">Patrones de cuota agotada (regex, uno por línea)</label><textarea name="quota_patterns" rows="3">${h(a.quota_patterns.join('\n'))}</textarea>
        <div class="row"><button class="btn y">Guardar</button><button class="btn" type="button" data-test="${a.id}">Probar</button>${a.last_test ? `<small>${a.last_test.ok ? '✔' : '✘'} ${ago(a.last_test.at)}</small>` : ''}</div></form>`).join('') +
        `<details class="panel"><summary class="pixel" style="font-size:9px;cursor:pointer">+ Agregar agente</summary><form id="newAg"><div class="field-row"><div><label class="l">Clave</label><input name="key" required></div><div><label class="l">Nombre</label><input name="name"></div>
        <div><label class="l">Adaptador</label><select name="adapter">${opts([['claude', 'claude'], ['codex', 'codex'], ['agy', 'agy'], ['commandcode', 'commandcode'], ['fake', 'fake (pruebas)']], 'claude')}</select></div></div>
        <label class="l">Ejecutable</label><input name="exe" required><button class="btn y" style="margin-top:10px">Crear</button></form></details>`;
    } else if (tab === 'areas') {
      body = S.boot.areas.map(a => `<form class="panel" data-area="${a.id}" style="margin-bottom:12px;border-color:${a.color}"><div class="row">${icon(a.icon, 4)}<h2 style="margin:0">${h(a.name)}</h2></div>
        <div class="field-row"><div><label class="l">Nombre</label><input name="name" value="${h(a.name)}"></div><div><label class="l">Alias</label><input name="alias" value="${h(a.alias)}"></div>
        <div><label class="l">Icono</label><select name="icon">${opts(ICON_NAMES.map(i => [i, i]), a.icon)}</select></div><div><label class="l">Color</label><input type="color" name="color" value="${h(a.color)}" style="height:40px"></div></div>
        <div class="field-row"><div><label class="l">Agente por defecto</label><select name="default_agent_id">${opts(S.boot.agents.map(x => [x.id, x.name]), a.default_agent_id, '—')}</select></div>
        <div><label class="l">Cadena de relevo (claves en orden)</label><input name="chain" value="${h(a.fallback_chain.map(id => agent(id)?.key).filter(Boolean).join(', '))}" placeholder="claude, codex, commandcode"></div></div>
        <label class="row"><input type="checkbox" name="auto_fallback" ${a.auto_fallback ? 'checked' : ''}> Relevo automático al siguiente de la cadena si un agente se queda sin cuota</label>
        <div class="row"><button class="btn y">Guardar</button><button class="btn r" type="button" data-delarea="${a.id}">Eliminar área</button></div></form>`).join('') +
        `<form class="panel" id="newArea"><h3>Nueva área (sala)</h3><div class="field-row"><div><label class="l">Nombre</label><input name="name" required placeholder="QA"></div><div><label class="l">Alias</label><input name="alias" placeholder="Sala de pruebas de Kamino"></div><div><label class="l">Icono</label><select name="icon">${opts(ICON_NAMES.map(i => [i, i]), 'radar')}</select></div></div><button class="btn y" style="margin-top:10px">Crear área</button></form>`;
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
    } else {
      const me = S.boot.me, prefs = me.notif_prefs || {};
      body = `<form class="panel" id="meF"><div class="row">${sprite(me.role === 'admin' ? 'imperial' : 'rebel', '#ff8c42', 5)}<div><h2 style="margin:0">${h(me.name)}</h2><small>${h(me.username)} · ${h(me.role)} · ${h(S.boot.users.find(u => u.id === me.id)?.rank || '')}</small></div></div>
        <label class="l">Nombre</label><input name="name" value="${h(me.name)}"><label class="l">Nueva contraseña (vacío = no cambiar)</label><input name="password" type="password" minlength="6" autocomplete="new-password">
        <h3>Notificaciones de escritorio</h3>${NOTIF_KINDS.map(([k, l]) => `<label class="row"><input type="checkbox" name="n_${k}" ${prefs[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}
        <p class="muted">Permiso del navegador: ${'Notification' in window ? Notification.permission : 'no soportado'}. Si no hay pestañas abiertas, la oficina usa notificaciones de Windows.</p>
        <div class="row"><button class="btn y">Guardar</button>${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn" type="button" id="askN">Permitir notificaciones</button>' : ''}</div></form>`;
    }
    el.innerHTML = `<h1>Configuración</h1><div class="tabs">${tabs.map(([k, l]) => `<button data-ct="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
    $$('[data-ct]', el).forEach(b => b.onclick = () => go('#/config/' + b.dataset.ct));
    const list = s => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    el.onsubmit = async e => {
      e.preventDefault();
      const fm = e.target, f = formData(fm);
      try {
        if (fm.dataset.agent) {
          let pre, extra; try { pre = JSON.parse(f.pre_args || '[]'); extra = JSON.parse(f.extra_args || '[]'); } catch { return fail('Args deben ser JSON, p. ej. ["--flag"]'); }
          await put('/api/agents/' + fm.dataset.agent, { ...f, pre_args: pre, extra_args: extra, models: list(f.models), efforts: list(f.efforts), quota_patterns: list(f.quota_patterns.replace(/,/g, '\u0000')).map(x => x.replace(/\u0000/g, ',')), max_concurrent: +f.max_concurrent, timeout_min: +f.timeout_min });
          holo('Agente guardado'); await loadBoot();
        } else if (fm.id === 'newMachine') {
          const m = await post('/api/machines', f);
          const cfg = JSON.stringify({ url: location.origin, token: m.token, roots: ['C:\\Users\\TU_USUARIO'] }, null, 2);
          modal(`<h2>Token de la máquina "${h(f.name)}"</h2><p class="panel r">Cópialo ahora: <b>no se vuelve a mostrar</b>. Quien lo tenga puede ejecutar agentes en esa PC.</p>
            <label class="l">worker.json (junto a worker.js en la PC)</label><textarea rows="7" readonly>${h(cfg)}</textarea>
            <p class="muted">En "roots" pon las carpetas donde el agente puede trabajar. Luego en la PC: <code>node worker.js</code> (o instalar-agente.ps1 para que arranque solo).</p>
            <button class="btn ghost" value="c">Listo</button>`);
          return loadBoot();
        } else if (fm.id === 'newAg') { await post('/api/agents', f); await loadBoot(); route(true); }
        else if (fm.dataset.area) { await put('/api/areas/' + fm.dataset.area, { name: f.name, alias: f.alias, icon: f.icon, color: f.color, default_agent_id: +f.default_agent_id || null, auto_fallback: f.auto_fallback, fallback_chain: list(f.chain).map(k => S.boot.agents.find(a => a.key === k)?.id).filter(Boolean) }); holo('Área guardada'); await loadBoot(); }
        else if (fm.id === 'newArea') { await post('/api/areas', f); await loadBoot(); route(true); }
        else if (fm.id === 'newUser') { await post('/api/users', f); route(true); }
        else if (fm.id === 'newLim') { await post('/api/limits', { ...f, agent_id: +f.agent_id }); route(true); }
        else if (fm.id === 'autoF') {
          let lenses; if (f.lenses.trim()) { try { lenses = JSON.parse(f.lenses); } catch { return fail('JSON de lentes inválido'); } }
          await put('/api/settings', { council_auto_n: +f.council_auto_n, council_auto_agents: $$('[name=caa]:checked', fm).map(c => ({ agent_id: +c.value })), divert_at_80: f.divert_at_80, scan_min: +f.scan_min, checkpoint_exclude: list(f.checkpoint_exclude), ...(lenses ? { lenses } : {}) });
          holo('Ajustes guardados'); await loadBoot();
        } else if (fm.dataset.tpl) { await put('/api/templates/' + fm.dataset.tpl, { ...f, area_id: +f.area_id || null }); holo('Plantilla guardada'); await loadBoot(); }
        else if (fm.id === 'newTpl') { await post('/api/templates', { ...f, area_id: +f.area_id || null }); await loadBoot(); route(true); }
        else if (fm.id === 'meF') {
          const notif_prefs = Object.fromEntries(NOTIF_KINDS.map(([k]) => [k, f['n_' + k]]));
          await put('/api/me', { name: f.name, password: f.password || undefined, notif_prefs }); holo('Perfil guardado'); await loadBoot();
        }
        beep('ok');
      } catch (err) { fail(err); }
    };
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
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

export const VIEWS = { estacion, proyectos, kanban, tarea, cantina, consejo, archivos, puente, config };
