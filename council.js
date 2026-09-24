// Consejo Jedi: informe de lo hecho → propuestas de mejora de uno o varios agentes → tareas
const { now, all, one, J, insert, update, bus, emit, log, notify, setting } = require('./db');
const R = require('./runner');

const LENSES = {
  siguiente: ['Siguiente paso', 'Qué hacer después para avanzar el proyecto (roadmap corto, en orden).'],
  calidad: ['Calidad de código', 'Refactors, duplicación y simplificaciones sobre lo que se cambió.'],
  pruebas: ['Pruebas', 'Qué falta probar de lo que se hizo; casos concretos.'],
  seguridad: ['Seguridad', 'Riesgos de seguridad introducidos por los cambios y cómo mitigarlos.'],
  rendimiento: ['Rendimiento', 'Cuellos de botella en lo tocado y mejoras medibles.'],
  documentacion: ['Documentación', 'Qué quedó sin documentar o desactualizado.'],
  ux: ['UX / UI', 'Mejoras de experiencia de usuario en las pantallas o flujos tocados.'],
  deuda: ['Deuda técnica', 'Atajos tomados que conviene pagar, con prioridad.'],
  retro: ['Retrospectiva de proceso', 'Qué agente/modelo/esfuerzo rindió mejor por área, qué prompts causaron devoluciones o consultas innecesarias. Puedes proponer cambios de configuración (kind "config").'],
  plantillas: ['Plantillas y misiones', 'Tareas repetitivas detectadas que conviene convertir en plantillas o misiones encadenadas.'],
  libre: ['Libre', ''],
};
const lenses = () => ({ ...LENSES, ...setting('lenses', {}) });

const FORMAT = `Responde SOLO con un bloque JSON válido (sin texto adicional) con esta forma:
{"propuestas":[{"title":"título corto","description":"qué hacer y por qué, con detalle suficiente para ejecutarlo como tarea","lens":"clave del lente","impact":"alto|medio|bajo","effort":"alto|medio|bajo","area":"Documentación|Desarrollo|Análisis|...","agent":"claude|codex|antigravity|commandcode","kind":"tarea|config","config":{"target":"agent|area","key":"clave del agente o nombre del área","field":"default_model|default_effort|timeout_min|max_concurrent|default_agent|fallback_chain","value":"nuevo valor"}}]}
"config" solo cuando kind="config". Máximo 8 propuestas, ordenadas por valor. No propongas algo ya aceptado o descartado antes.`;

// ---------- informe ----------
function selectTasks(s = {}) {
  if (s.task_ids?.length) return s.task_ids.map(id => one('select * from tasks where id=?', +id)).filter(Boolean);
  const w = [`deleted_at is null`, `status in ('completada','revision')`], p = [];
  if (s.project_ids?.length) { w.push(`project_id in (${s.project_ids.map(() => '?').join(',')})`); p.push(...s.project_ids.map(Number)); }
  if (s.area_ids?.length) { w.push(`area_id in (${s.area_ids.map(() => '?').join(',')})`); p.push(...s.area_ids.map(Number)); }
  if (s.agent_ids?.length) { w.push(`agent_id in (${s.agent_ids.map(() => '?').join(',')})`); p.push(...s.agent_ids.map(Number)); }
  if (s.from) { w.push('updated_at >= ?'); p.push(s.from); }
  if (s.to) { w.push('updated_at <= ?'); p.push(s.to + 'T23:59:59'); }
  return all(`select * from tasks where ${w.join(' and ')} order by updated_at desc limit ?`, ...p, Math.min(+s.last_n || 10, 50));
}
function digest(scope = {}) {
  const tasks = selectTasks(scope);
  const pids = [...new Set(tasks.map(t => t.project_id))];
  const parts = [`# Informe de lo hecho (${tasks.length} tareas)`];
  for (const pid of pids) {
    const p = one('select * from projects where id=?', pid);
    parts.push(`\n## Proyecto: ${p.name} (${p.status})${p.briefing ? '\n' + p.briefing.slice(0, 800) : ''}`);
    for (const t of tasks.filter(x => x.project_id === pid)) {
      const area = one('select name from areas where id=?', t.area_id)?.name || '-';
      const ag = one('select name from agents where id=?', t.agent_id)?.name || (t.executor === 'humano' ? 'humano' : '-');
      const runs = all('select agent_id, model, effort, end_reason, started_at, ended_at, tokens_in + tokens_out tk, diff_stat from runs where task_id=? order by id', t.id);
      const rets = all(`select new_value from task_history where task_id=? and field='review_comment' and new_value is not null`, t.id).map(r => r.new_value);
      const hand = all('select reason from handoffs where task_id=?', t.id).map(h => h.reason);
      const diff = [...runs].reverse().find(r => r.diff_stat)?.diff_stat;
      parts.push(`\n### #${t.id} ${t.title} [${t.status}] · área ${area} · ${ag} ${t.model || ''} ${t.effort || ''}
Objetivo: ${(t.prompt || '').slice(0, 600)}
Resumen del agente: ${(t.summary || '(sin resumen)').slice(0, 1200)}
Ejecuciones: ${runs.map(r => `${one('select key from agents where id=?', r.agent_id)?.key}/${r.model || '-'}/${r.effort || '-'}→${r.end_reason || '?'} (${r.ended_at ? Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000) + 's' : '-'}, ${r.tk} tk)`).join('; ') || 'ninguna'}${rets.length ? `\nDevoluciones del revisor: ${rets.join(' | ')}` : ''}${hand.length ? `\nRelevos: ${hand.join(', ')}` : ''}${diff ? `\nCambios:\n${diff.slice(0, 800)}` : ''}`);
    }
    const prev = all(`select title, status, discard_reason from proposals where project_id=? and status in ('aceptada','convertida','descartada') order by id desc limit 30`, pid);
    if (prev.length) parts.push(`\n### Propuestas previas (no repetir)\n${prev.map(x => `- [${x.status}] ${x.title}${x.discard_reason ? ' — motivo: ' + x.discard_reason : ''}`).join('\n')}`);
  }
  return { digest_md: parts.join('\n'), task_ids: tasks.map(t => t.id), project_ids: pids };
}

// ---------- JSON de la respuesta ----------
function extractJSON(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text || '');
  const cands = [fence?.[1], text?.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter(Boolean);
  for (const c of cands) { try { return JSON.parse(c); } catch {} }
  throw new Error('La respuesta no contiene JSON válido');
}
const LV = ['alto', 'medio', 'bajo'];
function validProposals(obj) {
  const list = Array.isArray(obj) ? obj : obj?.propuestas;
  if (!Array.isArray(list)) throw new Error('El JSON no tiene la lista "propuestas"');
  return list.filter(p => p && typeof p.title === 'string' && p.title.trim()).map(p => ({
    title: p.title.trim().slice(0, 200), description: String(p.description || '').slice(0, 4000), lens: String(p.lens || ''),
    impact: LV.includes(p.impact) ? p.impact : 'medio', effort: LV.includes(p.effort) ? p.effort : 'medio',
    area: p.area ? String(p.area) : null, agent: p.agent ? String(p.agent) : null, kind: p.kind === 'config' && p.config ? 'config' : 'tarea',
    config: p.kind === 'config' ? p.config : null, votes: +p.votes || 1, conv: p.conv ?? null }));
}
// agrupa propuestas iguales (título normalizado) y suma votos
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function consolidate(lists) {
  const m = new Map();
  for (const list of lists) for (const p of list) {
    const k = norm(p.title);
    if (m.has(k)) { const x = m.get(k); x.votes += p.votes || 1; if (p.description.length > x.description.length) x.description = p.description; }
    else m.set(k, { ...p, votes: p.votes || 1 });
  }
  const W = { alto: 3, medio: 2, bajo: 1 };
  return [...m.values()].sort((a, b) => b.votes - a.votes || W[b.impact] - W[a.impact] || W[a.effort] - W[b.effort]);
}

// ---------- convocar ----------
async function convene({ scope = {}, digest_md, lenses: ls = ['siguiente'], custom = '', agents = [], moderator = null }, userId) {
  if (!agents.length) throw new Error('Elige al menos un agente');
  const d = digest(scope);
  const md = digest_md || d.digest_md;
  const project_id = d.project_ids[0] || scope.project_ids?.[0] || null;
  const L = lenses();
  const lensTxt = ls.map(k => `- ${k}: ${L[k]?.[0] || k} — ${k === 'libre' ? custom : L[k]?.[1] || ''}`).join('\n');
  const rid = insert('reviews', { project_ids: JSON.stringify(d.project_ids), scope: JSON.stringify({ ...scope, task_ids: d.task_ids }), lenses: JSON.stringify(ls),
    agents: JSON.stringify(agents), moderator_id: moderator?.agent_id || null, digest_md: md, status: 'en_curso', created_by: userId, at: now() });
  log(userId, 'consejo', rid, 'convocar', { lentes: ls, agentes: agents.map(a => a.agent_id) });
  emit('council.updated', { id: rid });
  const frow = project_id ? one('select path, machine_id from project_folders where project_id=? order by is_default desc, id limit 1', project_id) : null;
  const folder = frow?.path || null;
  const prompt = `Eres miembro del Consejo Jedi de una oficina de desarrollo. Analiza el informe de trabajo realizado y propone mejoras concretas.
${folder ? 'Puedes leer el código real en tu carpeta de trabajo (solo lectura).' : ''}
## Lentes pedidos
${lensTxt}

${md}

${FORMAT}`;
  (async () => {
    try {
      const results = await Promise.all(agents.map(async a => {
        const ag = one('select * from agents where id=?', a.agent_id);
        const cid = insert('conversations', { kind: 'consejo', project_id, title: `Consejo #${rid} · ${ag.name}`, agent_id: ag.id, model: a.model || ag.default_model,
          effort: a.effort || ag.default_effort, mode: 'plan', folder_path: folder, machine_id: frow?.machine_id ?? null, created_by: userId, created_at: now(), updated_at: now() });
        const res = await R.runTurn(cid, null, { userId, prompt });
        try { return validProposals(extractJSON(res.final)).map(p => ({ ...p, conv: cid, agentKey: ag.key })); }
        catch (e) { insert('messages', { conversation_id: cid, role: 'sistema', text: 'JSON inválido: ' + e.message, kind: 'nota', at: now() }); return []; }
      }));
      let final = consolidate(results);
      if (moderator && agents.length > 1 && final.length) {
        const ag = one('select * from agents where id=?', moderator.agent_id);
        const cid = insert('conversations', { kind: 'consejo', project_id, title: `Consejo #${rid} · moderador ${ag.name}`, agent_id: ag.id, model: moderator.model || ag.default_model,
          effort: moderator.effort || ag.default_effort, mode: 'plan', created_by: userId, created_at: now(), updated_at: now() });
        const res = await R.runTurn(cid, null, { userId, prompt: `Eres el moderador del Consejo. Consolida estas propuestas de ${agents.length} agentes: agrupa duplicadas o equivalentes sumando "votes" (cuántos agentes la propusieron), elimina las débiles y ordénalas por impacto/esfuerzo.\n\n${JSON.stringify({ propuestas: final.map(({ conv, agentKey, ...p }) => p) })}\n\n${FORMAT} Incluye el campo "votes" en cada propuesta.` });
        try { const mod = validProposals(extractJSON(res.final)); if (mod.length) final = mod.map(p => { const loc = final.find(f => norm(f.title) === norm(p.title)); return { ...p, votes: Math.max(p.votes, loc?.votes || 1), conv: loc?.conv ?? final[0].conv }; }); } catch {}
      }
      for (const p of final) insert('proposals', { review_id: rid, title: p.title, description: p.description, lens: p.lens, impact: p.impact, effort: p.effort,
        suggested_area: p.area, suggested_agent: p.agent, votes: p.votes, kind: p.kind, status: 'propuesta', conversation_id: p.conv, project_id,
        discard_reason: p.config ? JSON.stringify(p.config) : null, at: now() });
      update('reviews', rid, { status: final.length ? 'lista' : 'sin_propuestas' });
      notify('consejo', `El Consejo #${rid} terminó`, `${final.length} propuestas de mejora`, `#/consejo/${rid}`);
    } catch (e) {
      update('reviews', rid, { status: 'error', error: e.message });
      notify('fallo', `El Consejo #${rid} falló`, e.message, `#/consejo/${rid}`);
    }
    emit('council.updated', { id: rid });
  })();
  return rid;
}

// ---------- decisiones sobre propuestas ----------
const findArea = n => n ? one('select * from areas where deleted_at is null and (lower(name)=lower(?) or lower(alias)=lower(?))', n, n) : null;
const findAgent = n => n ? one('select * from agents where lower(key)=lower(?) or lower(name)=lower(?)', n, n) : null;
function accept(pid, userId, over = {}) {
  const p = one('select * from proposals where id=?', pid);
  if (p.status === 'convertida') throw new Error('Ya se convirtió en tarea');
  if (p.kind === 'config') { applyConfig(J(p.discard_reason, {}), userId); update('proposals', pid, { status: 'aceptada', decided_by: userId }); emit('council.updated', { id: p.review_id }); return null; }
  const project_id = over.project_id || p.project_id;
  if (!project_id) throw new Error('Elige un proyecto para crear la tarea');
  const area = over.area_id ? { id: over.area_id } : findArea(p.suggested_area);
  const ag = over.agent_id ? { id: over.agent_id } : findAgent(p.suggested_agent);
  const folder = one('select id from project_folders where project_id=? order by is_default desc, id limit 1', project_id);
  const tid = R.createTask({ project_id, area_id: area?.id, agent_id: ag?.id, folder_id: over.folder_id ?? folder?.id, title: p.title,
    prompt: `${p.description}\n\n(Propuesta #${p.id} del Consejo #${p.review_id}, lente ${p.lens}, impacto ${p.impact}, esfuerzo ${p.effort})`,
    priority: p.impact === 'alto' ? 'alta' : p.impact === 'bajo' ? 'baja' : 'media', proposal_id: p.id }, userId);
  update('proposals', pid, { status: 'convertida', task_id: tid, decided_by: userId });
  log(userId, 'propuesta', pid, 'aceptar', { tarea: tid });
  emit('council.updated', { id: p.review_id });
  return tid;
}
function decide(pid, status, userId, reason = null) {
  const p = one('select * from proposals where id=?', pid);
  update('proposals', pid, { status, decided_by: userId, ...(status === 'descartada' ? { discard_reason: reason || 'sin motivo' } : {}) });
  log(userId, 'propuesta', pid, status, { motivo: reason });
  emit('council.updated', { id: p.review_id });
}
const CFG = { agent: ['default_model', 'default_effort', 'timeout_min', 'max_concurrent'], area: ['default_agent', 'fallback_chain'] };
function applyConfig(c, userId) {
  if (!CFG[c.target]?.includes(c.field)) throw new Error('Cambio de configuración no soportado: ' + JSON.stringify(c));
  if (c.target === 'agent') {
    const ag = findAgent(c.key); if (!ag) throw new Error('Agente no encontrado: ' + c.key);
    update('agents', ag.id, { [c.field]: /timeout|max/.test(c.field) ? +c.value : String(c.value) });
  } else {
    const ar = findArea(c.key); if (!ar) throw new Error('Área no encontrada: ' + c.key);
    if (c.field === 'default_agent') update('areas', ar.id, { default_agent_id: findAgent(c.value)?.id ?? ar.default_agent_id });
    else update('areas', ar.id, { fallback_chain: JSON.stringify([].concat(c.value).flatMap(v => String(v).split(/[,>→\s]+/)).map(k => findAgent(k)?.id).filter(Boolean)) });
  }
  log(userId, 'config', null, 'aplicar_propuesta', c);
}

// ---------- descomponer una tarea en subtareas ----------
async function decompose(taskId, userId) {
  const t = one('select * from tasks where id=?', taskId);
  const ag = one('select * from agents where id=?', t.agent_id || one('select default_agent_id from areas where id=?', t.area_id)?.default_agent_id);
  if (!ag) throw new Error('La tarea no tiene agente para descomponer');
  const frow = t.folder_id ? one('select path, machine_id from project_folders where id=?', t.folder_id) : null;
  const folder = frow?.path || null;
  const cid = insert('conversations', { kind: 'consejo', project_id: t.project_id, title: `Descomponer #${t.id}`, agent_id: ag.id, model: ag.default_model, effort: ag.default_effort,
    mode: 'plan', folder_path: folder, machine_id: frow?.machine_id ?? null, created_by: userId, created_at: now(), updated_at: now() });
  const areas = all('select name from areas where deleted_at is null').map(a => a.name).join(', ');
  const res = await R.runTurn(cid, null, { userId, prompt: `Descompón esta tarea en subtareas ejecutables por agentes de IA, en orden.\n# ${t.title}\n${t.prompt}\n\nÁreas disponibles: ${areas}.\nResponde SOLO JSON: {"subtareas":[{"title":"...","prompt":"instrucciones completas","area":"...","depends_on":[índices 0-based de subtareas previas]}]} (máximo 8).` });
  const obj = extractJSON(res.final);
  if (!Array.isArray(obj.subtareas)) throw new Error('El JSON no tiene "subtareas"');
  const ids = [];
  for (const s of obj.subtareas.slice(0, 8)) {
    ids.push(R.createTask({ project_id: t.project_id, parent_id: t.id, area_id: findArea(s.area)?.id || t.area_id, folder_id: t.folder_id, title: String(s.title).slice(0, 200),
      prompt: String(s.prompt || ''), depends_on: (s.depends_on || []).map(i => ids[i]).filter(Boolean), priority: t.priority }, userId));
  }
  log(userId, 'tarea', t.id, 'descomponer', { subtareas: ids });
  return ids;
}

// ---------- segunda opinión ----------
function secondOpinion(taskId, userId) {
  const t = one('select * from tasks where id=?', taskId);
  const area = one('select * from areas where id=?', t.area_id);
  const chain = [...J(area?.fallback_chain, []), ...all('select id from agents where enabled=1').map(a => a.id)];
  const other = chain.find(id => id !== t.agent_id);
  return R.createTask({ project_id: t.project_id, area_id: t.area_id, folder_id: t.folder_id, agent_id: other, mode: 'plan', priority: 'media',
    title: `Segunda opinión: #${t.id} ${t.title}`.slice(0, 200),
    prompt: `Revisa críticamente el trabajo de la tarea #${t.id} "${t.title}" (hecho por otro agente). Resumen del autor:\n${t.summary || '(sin resumen)'}\n${t.branch ? `Rama: ${t.branch} (puede estar ya fusionada; revisa los commits recientes con "oficina: tarea #${t.id}").` : ''}\nBusca bugs, casos borde, riesgos y simplificaciones. No modifiques archivos; reporta hallazgos concretos con archivo:línea.` }, userId);
}

// ---------- automatizaciones ----------
bus.on('task.completed', data => {
  const n = +setting('council_auto_n', 0);
  if (!n) return;
  const done = one(`select count(*) n from tasks where project_id=? and status='completada' and deleted_at is null`, data.project_id).n;
  if (done % n) return;
  const auto = setting('council_auto_agents', []);
  const agents = auto.length ? auto : [{ agent_id: one(`select id from agents where enabled=1 order by id limit 1`)?.id }];
  convene({ scope: { project_ids: [data.project_id], last_n: n }, lenses: ['siguiente', 'retro'], agents }, null).catch(() => {});
});

module.exports = { LENSES, lenses, digest, convene, extractJSON, validProposals, consolidate, accept, decide, applyConfig, decompose, secondOpinion };
