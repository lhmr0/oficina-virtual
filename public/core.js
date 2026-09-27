// Núcleo del cliente: estado, API, helpers, widgets, modal, hologramas y sonido
import { agentSprite, userSprite } from './sprites.js';

export const S = { boot: null, project: +localStorage.getItem('ov_project') || null, stationFilter: localStorage.getItem('ov_station_filter') || '', unseen: 0, sound: localStorage.getItem('ov_sound') !== '0', theme: localStorage.getItem('ov_theme') || 'oscuro' };

export function applyTheme(theme) {
  const isLight = (theme === 'blanco' || theme === 'crema');
  S.theme = isLight ? 'blanco' : 'oscuro';
  const val = isLight ? 'crema' : 'oscuro';
  try { localStorage.setItem('ov_theme', val); } catch {}
  document.documentElement.setAttribute('data-theme', val);
  const meta = document.getElementById('metaTheme');
  if (meta) meta.content = isLight ? '#f4ede2' : '#070913';
}
applyTheme(S.theme);

export async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (r.status === 401 && !url.includes('/login')) { location.hash = '#/login'; throw new Error('Inicia sesión'); }
  if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
  return j;
}
export const get = u => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const del = u => api('DELETE', u);

export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export function ago(ts) {
  if (!ts) return '-';
  const s = (Date.now() - Date.parse(ts)) / 1000;
  if (s < 0) return 'en ' + dur(-s);
  if (s < 60) return 'hace un momento';
  return 'hace ' + dur(s);
}
export function dur(s) {
  s = Math.round(s);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm';
  return Math.floor(s / 86400) + 'd';
}
export const fmtDate = ts => ts ? new Date(ts).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '-';
export const bytes = n => n == null ? '-' : n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB';
export const num = n => (n || 0).toLocaleString('es');

export const STATUS = {
  pendiente: 'Pendiente', bloqueada: 'Bloqueada', en_cola: 'En cola', en_curso: 'En curso', esperando: 'Esperando', revision: 'Revisión',
  completada: 'Completada', pausada_cuota: 'Sin cuota', fallida: 'Fallida',
};
export const PSTATUS = { planificacion: 'Planificación', activo: 'Activo', pausado: 'Pausado', completado: 'Completado', archivado: 'Archivado' };
export const chip = (st, label) => `<span class="chip st-${h(st)}">${h(label ?? STATUS[st] ?? st)}</span>`;

export const agent = id => S.boot?.agents.find(a => a.id === +id);
export const area = id => S.boot?.areas.find(a => a.id === +id);
export const user = id => S.boot?.users.find(u => u.id === +id);
export const project = id => S.boot?.projects.find(p => p.id === +id);
export const isAdmin = () => S.boot?.me.role === 'admin';
export const canEdit = () => S.boot?.me.role !== 'observador';

export function agentChip(id, px = 2) {
  const a = agent(id);
  if (!a) return '<span class="muted">—</span>';
  return `<span class="chip" style="border-color:${a.color}">${agentSprite(a, px)}${h(a.name)}</span>`;
}
export function userChip(id) {
  const u = user(id);
  if (!u) return id ? `#${id}` : '<span class="muted">sistema</span>';
  return `<span class="row" style="gap:4px;display:inline-flex">${userSprite(u, 2)}${h(u.name)}</span>`;
}
export const WIN_LABELS = {
  five_hour: '5 horas',
  '5h': '5 horas',
  primary: '5 horas',
  seven_day: '7 días (semanal)',
  '7d': '7 días (semanal)',
  secondary: '7 días (semanal)',
  weekly: 'Semanal',
  seven_day_opus: '7 días Opus',
  seven_day_sonnet: '7 días Sonnet',
};

export function agentLimits(a) {
  if (!a) return { fiveHour: null, weekly: null, list: [], usage5h: null, usage7d: null };
  const list = a.limits_cli || [];
  const fiveHour = list.find(l => ['five_hour', '5h', 'primary'].includes(l.win));
  const weekly = list.find(l => ['seven_day', '7d', 'secondary', 'weekly'].includes(l.win));
  return {
    fiveHour: fiveHour ? { pct: Math.round(fiveHour.used_value), resets_at: fiveHour.resets_at } : null,
    weekly: weekly ? { pct: Math.round(weekly.used_value), resets_at: weekly.resets_at } : null,
    list,
    usage5h: a.usage5h || null,
    usage7d: a.usage7d || null,
  };
}

export function agentLimitsBadge(a, compact = false) {
  const lim = agentLimits(a);
  if (!lim.fiveHour && !lim.weekly) {
    if (a?.status === 'sin_cuota') return `<span class="lim-badge bad">Sin cuota</span>`;
    if (lim.usage5h?.tokens) return `<span class="lim-badge ok" title="${num(lim.usage5h.tokens)} tokens en 5h">${bytesTxt(lim.usage5h.tokens)}/5h</span>`;
    return `<span class="lim-badge off">—</span>`;
  }
  const parts = [];
  const colorOf = pct => pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'ok';
  if (lim.fiveHour) {
    const tip = `Límite 5h: ${lim.fiveHour.pct}%${lim.fiveHour.resets_at ? ' · reinicia ' + ago(lim.fiveHour.resets_at) : ''}`;
    parts.push(`<span class="lim-badge ${colorOf(lim.fiveHour.pct)}" title="${h(tip)}">5h:${lim.fiveHour.pct}%</span>`);
  }
  if (lim.weekly && !compact) {
    const tip = `Límite semanal: ${lim.weekly.pct}%${lim.weekly.resets_at ? ' · reinicia ' + ago(lim.weekly.resets_at) : ''}`;
    parts.push(`<span class="lim-badge ${colorOf(lim.weekly.pct)}" title="${h(tip)}">7d:${lim.weekly.pct}%</span>`);
  }
  return parts.join(' ');
}

export const saber = (pct, color) => `<div class="saber" title="${Math.round(pct)}%"><div class="hilt"></div><div class="track"><div class="blade" style="width:${Math.max(0, Math.min(100, pct))}%;--c:${color || 'var(--holo)'}"></div></div></div>`;
export const opts = (list, sel, blank) => (blank != null ? `<option value="">${h(blank)}</option>` : '') + list.map(([v, l]) => `<option value="${h(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${h(l)}</option>`).join('');

// markdown mínimo para mensajes
export function md(t) {
  const parts = String(t ?? '').split(/```[\w-]*\n?/);
  return parts.map((p, i) => i % 2 ? `<pre>${h(p)}</pre>` : `<p>${h(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[\[(CONSULTA|LISTO)\]\]/g, '<span class="chip st-esperando">$1</span>')}</p>`).join('');
}

// ---------- modal ----------
const dlg = () => document.getElementById('modal');
export function modal(html, onMount) {
  const d = dlg();
  d.innerHTML = `<form method="dialog" style="margin:0">${html}</form>`;
  d.showModal();
  linkLabels(d);
  onMount?.(d);
  return d;
}
// asocia cada <label class="l"> con el control que le sigue (lectores de pantalla y clic en la etiqueta)
let lid = 0;
export function linkLabels(root) {
  for (const l of root.querySelectorAll('label.l:not([for])')) {
    const c = l.nextElementSibling?.matches('input,select,textarea') ? l.nextElementSibling : l.nextElementSibling?.querySelector('input,select,textarea');
    if (!c) continue;
    c.id ||= 'f' + ++lid;
    l.htmlFor = c.id;
  }
}
export const closeModal = () => dlg().close();
// botones/enlaces con data-close cierran el modal (sin JS en línea: la CSP lo bloquea)
document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog')?.close(); });

// ---------- máquinas y carpetas ----------
export const machines = () => S.boot?.machines || [];
export const machineName = id => machines().find(m => m.id === +id)?.name || '—';
export const defaultMachine = () => machines().find(m => m.is_default)?.id || machines()[0]?.id;
// Selector de carpetas en la máquina (funciona desde el celular: navega el disco de la PC vía el agente de campo)
export function folderPicker(machineId, start) {
  const d = document.getElementById('picker');
  return new Promise(resolve => {
    let cur = null;
    const load = async p => {
      d.innerHTML = '<div class="empty">Leyendo carpetas…</div>';
      try {
        const x = await get(`/api/machines/${machineId || 0}/ls${p ? '?path=' + encodeURIComponent(p) : ''}`);
        cur = x.path;
        d.innerHTML = `<h2>Elegir carpeta · ${h(machineName(machineId || defaultMachine()))}</h2>
          <div class="row"><code class="grow ellipsis">${h(x.path || 'Raíces permitidas')}</code>${x.is_git ? '<span class="chip st-completada">git</span>' : ''}</div>
          <div class="chat-list" style="max-height:50vh;margin:10px 0">
            ${x.parent ? `<button type="button" class="chat-item" data-p="${h(x.parent)}">⬆ ..</button>` : x.path ? '<button type="button" class="chat-item" data-p="">⬆ raíces</button>' : ''}
            ${x.dirs.map(f => `<button type="button" class="chat-item" data-p="${h(f.path)}">📁 ${h(f.name)}</button>`).join('') || '<div class="empty">Sin subcarpetas</div>'}
          </div>
          <div class="row"><button class="btn y" id="pkOk" ${x.path ? '' : 'disabled'}>Elegir esta carpeta</button><button class="btn ghost" id="pkNo">Cancelar</button></div>`;
        d.querySelectorAll('[data-p]').forEach(i => i.onclick = () => load(i.dataset.p));
        d.querySelector('#pkOk').onclick = () => { d.close(); resolve(cur); };
        d.querySelector('#pkNo').onclick = () => { d.close(); resolve(null); };
      } catch (e) { d.innerHTML = `<div class="panel r">${h(e.message)}</div><button class="btn ghost" id="pkNo">Cerrar</button>`; d.querySelector('#pkNo').onclick = () => { d.close(); resolve(null); }; }
    };
    d.showModal();
    load(start || null);
  });
}

// ---------- adjuntos ----------
export async function upload(file, { task_id, conversation_id } = {}) {
  const q = new URLSearchParams({ name: file.name, ...(task_id ? { task_id } : {}), ...(conversation_id ? { conversation_id } : {}) });
  const r = await fetch('/api/attachments?' + q, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
  return j;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-delatt]'); if (!b) return;
  e.preventDefault();
  if (await confirmBox('¿Quitar el adjunto?', 'Quitar', true)) del('/api/attachments/' + b.dataset.delatt).catch(fail);
});
export const bytesTxt = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
export function attachmentsHTML(list, canDelete) {
  if (!list?.length) return '<small class="muted">Sin adjuntos</small>';
  return `<div class="row">${list.map(a => `<div class="chip">${/^image\//.test(a.mime) ? `<img src="/api/attachments/${a.id}" alt="" style="width:40px;height:40px;object-fit:cover;image-rendering:auto">` : '📎'}
    <a href="/api/attachments/${a.id}" target="_blank" rel="noopener">${h(a.name)}</a> <small>${bytesTxt(a.size)}</small>${canDelete ? `<button class="btn sm r" data-delatt="${a.id}" title="Quitar">×</button>` : ''}</div>`).join('')}</div>`;
}
export function confirmBox(text, okLabel = 'Confirmar', danger) {
  return new Promise(res => {
    const d = modal(`<h2>${h(text)}</h2><div class="row"><button class="btn ${danger ? 'r' : 'y'}" value="ok">${h(okLabel)}</button><button class="btn ghost" value="no">Cancelar</button></div>`);
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
  });
}
export function promptBox(title, label, value = '', multiline) {
  return new Promise(res => {
    const d = modal(`<h2>${h(title)}</h2><label class="l">${h(label)}</label>${multiline ? `<textarea name="v">${h(value)}</textarea>` : `<input name="v" value="${h(value)}">`}
      <div class="row"><button class="btn y" value="ok">Aceptar</button><button class="btn ghost" value="no">Cancelar</button></div>`);
    d.addEventListener('close', () => res(d.returnValue === 'ok' ? d.querySelector('[name=v]').value : null), { once: true });
  });
}
export const formData = el => Object.fromEntries([...el.querySelectorAll('[name]')].map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));

// ---------- hologramas (toasts) ----------
export function holo(title, body = '', { link, err, ms = 7000, actions } = {}) {
  const el = document.createElement('div');
  el.className = 'holo' + (err ? ' err' : '');
  el.innerHTML = `<b>${h(title)}</b><div>${h(body).slice(0, 300)}</div>${actions ? `<div class="row" style="margin-top:6px">${actions}</div>` : ''}`;
  if (link) { el.style.cursor = 'pointer'; el.addEventListener('click', e => { if (!e.target.closest('button')) { location.hash = link; el.remove(); } }); }
  document.getElementById('holo').append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}
export const fail = e => holo('Error', e.message || e, { err: true });
export async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) holo(okMsg); return r; } catch (e) { fail(e); throw e; }
}

// ---------- sonido chiptune ----------
let ac;
export function beep(kind = 'notify') {
  if (!S.sound) return;
  try {
    ac ||= new AudioContext();
    const seq = {
      notify: [[880, .08], [1320, .1]],
      consulta: [[1400, .05], [900, .05], [1700, .06], [1100, .05], [2000, .08]],
      error: [[220, .15], [160, .2]],
      ok: [[660, .07], [990, .07], [1320, .1]],
      gonk: [[160, .14], [110, .2]],
      dejarik: [[587, .06], [880, .06], [1174, .08], [1760, .1]],
      arcade: [[440, .04], [660, .04], [880, .04], [1320, .12]],
      coffee: [[520, .04], [620, .04], [780, .06]],
      cooler: [[320, .06], [440, .06], [280, .08]],
      mouse: [[1800, .04], [2600, .05], [2200, .06]],
      holo: [[1200, .06], [1600, .08]],
      vending: [[700, .05], [500, .08], [900, .07]],
    }[kind] || [[880, .1]];
    let t = ac.currentTime;
    for (const [f, d] of seq) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = f; g.gain.value = .05;
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d); t += d + .02;
    }
  } catch {}
}
