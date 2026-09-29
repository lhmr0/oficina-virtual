// Núcleo del cliente: estado, API, helpers, widgets, modal, hologramas y sonido
import { agentSprite, userSprite } from './sprites.js';

// iconos de línea (24×24, trazo): controles y etiquetas de la interfaz. Los sprites pixel son del mapa; los emoji, del contenido
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  council: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.5 18a10 10 0 1 1 17 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 13l2 2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5z"/><circle cx="15" cy="9" r="1.5"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 17.5V21M8 21h8"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-7 4-11 8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/>',
};
export const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

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
            ${x.dirs.map(f => `<button type="button" class="chat-item" data-p="${h(f.path)}">${ic('folder', 'sm')} ${h(f.name)}</button>`).join('') || '<div class="empty">Sin subcarpetas</div>'}
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
  return `<div class="row">${list.map(a => `<div class="chip">${/^image\//.test(a.mime) ? `<img src="/api/attachments/${a.id}" alt="" style="width:40px;height:40px;object-fit:cover;image-rendering:auto">` : ic('clip', 'sm')}
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

// ---------- voz: 🎤 dicta (Whisper en el servidor interno) y 🔊 lee en voz alta (voz del servidor o del navegador) ----------
// micBtn('#id') junto al textarea; al enviar, voz: isDictated(ta) avisa al agente que el texto viene de un dictado
export const canListen = () => !!(S.boot?.ia && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const micBtn = sel => canListen() ? `<button type="button" class="btn ghost" data-mic="${sel}" title="Dictar por voz (pulsa otra vez para terminar)">🎤</button>` : '';
export const isDictated = ta => { const v = ta?.dataset.voz === '1'; if (ta) delete ta.dataset.voz; return v; };
export function paintMic(b, st) { // st: rec | busy | idle
  const t = b.querySelector('.mi') || b;
  t.textContent = st === 'rec' ? '⏹' : st === 'busy' ? '⏳' : (b.dataset.icon || '🎤');
  b.disabled = st === 'busy'; b.classList.toggle('r', st === 'rec');
}
let recording = null;
// graba del micrófono; al parar entrega el audio a onStop. Lanza si el navegador no concede permiso.
export async function startRecording(onStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [], rec = new MediaRecorder(stream);
  rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); recording = null; onStop(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
  rec.start(); recording = rec;
  return rec;
}
export const stopRecording = () => { const r = recording; if (r) r.stop(); return r; };
export const isRecording = () => recording;
// audio → texto con Whisper (servicio de IA del servidor interno, a través del agente de campo)
export async function transcribir(blob) {
  const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
  return j?.text || '';
}
// Graba hasta el siguiente clic en cualquier 🎤 y devuelve lo transcrito ('' si no se entendió; null si falló o si este clic solo detuvo la grabación)
export async function listen(onState = () => {}) {
  if (recording) { recording.stop(); return null; }
  stopSpeaking();
  try {
    const blob = await new Promise((res, rej) => startRecording(res).then(() => onState('rec'), rej));
    onState('busy');
    const text = await transcribir(blob);
    if (!text) holo('No se entendió el audio', 'Intenta hablar más cerca del micrófono.');
    return text;
  } catch (err) { fail(err.name === 'NotAllowedError' || err.name === 'NotFoundError' ? 'No se pudo usar el micrófono: revisa el permiso del navegador' : err); return null; } finally { onState('idle'); }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-mic]'); if (!b) return;
  e.preventDefault();
  const sel = b.dataset.mic; if (!document.querySelector(sel)) return;
  // la vista pudo re-renderizarse mientras hablabas: se buscan de nuevo el botón y el textarea
  const text = await listen(st => paintMic(document.querySelector(`[data-mic="${sel}"]`) || b, st));
  const ta = document.querySelector(sel);
  if (text && ta) { ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + text; ta.dataset.voz = '1'; ta.focus(); }
});

// Voz para leer (por dispositivo, en Mi perfil): 'ia:<id>' = servidor interno, 'nav:<nombre>' = voz del navegador
export const voicePrefs = () => ({ voice: localStorage.getItem('ov_voice') || (S.boot?.ia ? 'ia:chatterbox-latam' : ''),
  speed: +localStorage.getItem('ov_voice_speed') || 1, read: localStorage.getItem('ov_read_notif') === '1' });
export function splitSpeechText(text, limit = 180) {
  const chunks = [];
  while (text.length > limit) {
    const part = text.slice(0, limit);
    const pause = [...part.matchAll(/[.!?;:]\s+/g)].at(-1);
    const space = part.lastIndexOf(' ');
    const cut = pause && pause.index >= limit / 2 ? pause.index + pause[0].length : space >= limit / 2 ? space + 1 : limit;
    chunks.push(text.slice(0, cut).trim());
    text = text.slice(cut).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}
let audio = null;
let speechRequest = null, speechSeq = 0;
export function stopSpeaking() { speechSeq++; speechRequest?.abort(); speechRequest = null; if (audio) { audio.pause(); audio = null; } window.speechSynthesis?.cancel(); }
export const isSpeaking = () => !!audio || !!window.speechSynthesis?.speaking;
export async function speak(text, prefs = voicePrefs()) {
  stopSpeaking();
  const seq = speechSeq;
  text = String(text || '').replace(/\[\[\w+\]\]|[*_`#>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return;
  if (prefs.voice.startsWith('ia:') && S.boot?.ia) {
    try {
      const chunks = prefs.voice === 'ia:chatterbox-latam' ? splitSpeechText(text.slice(0, 1500)) : [text.slice(0, 1500)];
      for (const chunk of chunks) {
        if (seq !== speechSeq) return;
        const controller = speechRequest = new AbortController();
        const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ text: chunk, voice: prefs.voice.slice(3), speed: prefs.speed }) });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Error ${r.status}`);
        const blob = await r.blob();
        if (seq !== speechSeq) return;
        speechRequest = null;
        const a = audio = new Audio(URL.createObjectURL(blob));
        const ended = new Promise(res => { a.onended = a.onpause = res; });
        await a.play();
        await ended;
        URL.revokeObjectURL(a.src); if (audio === a) audio = null;
      }
      return;
    } catch (err) {
      if (seq !== speechSeq || err.name === 'AbortError') return;
      speechRequest = null;
      audio = null;
      if (err.name === 'NotAllowedError') return; // el navegador no deja sonar hasta que toques la página una vez
    } // si el servidor no responde, lee la voz del navegador
  }
  if (seq !== speechSeq) return;
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = prefs.speed;
  const v = speechSynthesis.getVoices().find(x => 'nav:' + x.name === prefs.voice) || speechSynthesis.getVoices().find(x => /^es/i.test(x.lang));
  if (v) { u.voice = v; u.lang = v.lang; }
  await new Promise(res => { u.onend = u.onerror = res; speechSynthesis.speak(u); });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (!b) return;
  if (isSpeaking()) return stopSpeaking();
  speak(b.closest('.msg')?.querySelector('.body')?.innerText || '');
});

// ---------- hologramas (toasts) ----------
export function holo(title, body = '', { link, err, ms = 7000, actions, alert } = {}) {
  const el = document.createElement('div');
  el.className = 'holo' + (err ? ' err' : '');
  if (alert) el.setAttribute('role', 'alert'); // permisos: el lector de pantalla los anuncia de inmediato
  el.innerHTML = `<b>${h(title)}</b><div>${h(body).slice(0, 300)}</div>${actions ? `<div class="row" style="margin-top:6px">${actions}</div>` : ''}`;
  if (link) { el.style.cursor = 'pointer'; el.addEventListener('click', e => { if (!e.target.closest('button')) { location.hash = link; el.remove(); } }); }
  const wrap = document.getElementById('holo');
  wrap.append(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove(); // tope de 3 a la vista: lo pendiente sigue en Bandeja y en la barra de arriba
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
