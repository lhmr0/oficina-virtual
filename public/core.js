// Núcleo del cliente: estado, API, helpers, widgets, modal, hologramas y sonido
import { sprite } from './sprites.js';

export const S = { boot: null, project: +localStorage.getItem('ov_project') || null, unseen: 0, sound: localStorage.getItem('ov_sound') !== '0' };

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
  return `<span class="chip" style="border-color:${a.color}">${sprite('droid', a.color, px)}${h(a.name)}</span>`;
}
export function userChip(id) {
  const u = user(id);
  if (!u) return id ? `#${id}` : '<span class="muted">sistema</span>';
  return `<span class="row" style="gap:4px;display:inline-flex">${sprite(u.role === 'admin' ? 'imperial' : 'rebel', '#ff8c42', 2)}${h(u.name)}</span>`;
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
    const seq = { notify: [[880, .08], [1320, .1]], consulta: [[1400, .05], [900, .05], [1700, .06], [1100, .05], [2000, .08]], error: [[220, .15], [160, .2]], ok: [[660, .07], [990, .07], [1320, .1]] }[kind] || [[880, .1]];
    let t = ac.currentTime;
    for (const [f, d] of seq) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = f; g.gain.value = .05;
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d); t += d + .02;
    }
  } catch {}
}
