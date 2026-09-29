// Voz: frases para leer los avisos y órdenes habladas → acciones. Sin DOM, así se prueba en Node (test-frontend.js).

const plain = s => String(s ?? '').replace(/\[\[\w+\]\]|[*_`>#]|\bhttps?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
const short = (s, n = 300) => { s = plain(s); return s.length > n ? s.slice(0, s.lastIndexOf(' ', n) > 0 ? s.lastIndexOf(' ', n) : n) + '…' : s; };

// Lo que dice la oficina al llegar un aviso: qué pasó + qué te toca decidir
export function notifPhrase(n) {
  const t = short(n.title, 120), b = short(n.body);
  switch (n.kind) {
    case 'revision': return `${t}. ${b}. ¿La apruebas, la devuelves o la dejas para después?`;
    case 'consulta': return `${t}. ${b}`;
    case 'cuota': return `${t}. ${b} ¿La paso a otro agente?`;
    case 'permiso': return `${t}: ${b}. ¿Lo apruebas?`;
    default: return b ? `${t}. ${b}` : t;
  }
}

// Contexto de una orden: la tarea o el chat al que apunta el aviso (o la pantalla abierta)
export function ctxFromLink(link = '', kind = '') {
  const m = /#\/(tarea|cantina)\/(\d+)/.exec(link);
  return { task: m?.[1] === 'tarea' ? +m[2] : null, conv: m?.[1] === 'cantina' ? +m[2] : null, kind, link };
}

const AGENTS = [[/\bclaude\b/, 'claude'], [/\bcodex\b/, 'codex'], [/\b(antigravity|gemini|agy)\b/, 'antigravity'], [/\b(command ?code|deepseek)\b/, 'commandcode']];
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:"]/g, ' ').replace(/\s+/g, ' ').trim();

// Orden hablada → { action, task?, conv?, text?, agent?, merge? }. action: approve | return | handoff | reply | open | repeat | none | chat
export function parseCommand(text, ctx = {}) {
  const raw = String(text || '').trim(), s = norm(raw);
  // a qué tarea se refiere: "tarea 29" siempre; "la 29" solo con verbos de acción (en una respuesta "usa la 2" no es una tarea)
  const target = loose => { const m = (loose ? /\b(?:tarea|la|el|numero)\s*(\d{1,6})\b/ : /\b(?:tarea|numero)\s*(\d{1,6})\b/).exec(s); return m ? { task: +m[1], conv: null } : { task: ctx.task || null, conv: ctx.conv || null }; };
  const after = re => { const m = re.exec(raw); return m ? raw.slice(m.index + m[0].length).replace(/^[\s,:.-]+/, '').trim() : ''; };
  if (!s) return { action: 'none' };
  if (/^(si|claro|de acuerdo)$/.test(s) && ctx.kind === 'revision' && ctx.task) return { action: 'approve', task: ctx.task, conv: null, merge: false };
  if (/^(no|cancela\w*|olvida\w*|nada|despues|luego|dejala|dejalo)\b/.test(s)) return { action: 'none' };
  if (/\b(repite|repitelo|repetir|otra vez)\b/.test(s)) return { action: 'repeat' };
  if (/^(abre|abrela|abrelo|abrir|muestra\w*|ver)\b/.test(s)) return { action: 'open', ...target(true) };
  if (/^(\w+ )?(aprueb\w*|aprob\w*|aceptala|aceptalo)\b/.test(s)) return { action: 'approve', ...target(true), merge: /\b(fusion\w*|merge\w*|mezcl\w*)\b/.test(s) };
  if (/^(\w+ )?(devuelv\w*|devolver|rechaz\w*)\b/.test(s)) {
    const why = after(/\b(porque|para que)\b/i) || after(/\b(devu[eé]lv\w*|devolver|rechaz\w*)\b(\s+(la|el)(\s+tarea)?\s*\d*)?/i);
    return { action: 'return', ...target(true), text: why || raw };
  }
  const ag = AGENTS.find(([re]) => re.test(s));
  if (ag && /^(\w+ )?(pasa\w*|asign\w*|relev\w*|cambia\w*|dale|daselo|que la (haga|siga|continue))\b/.test(s)) return { action: 'handoff', ...target(true), agent: ag[1] };
  const r = /^\s*(resp[oó]nde(le)?|dile|dec[ií]le|cont[eé]sta(le)?)(\s+(a|en)\s+la\s+tarea\s+\d+)?(\s+que)?\b/i.exec(raw);
  if (r) return { action: 'reply', ...target(false), text: raw.slice(r[0].length).replace(/^[\s,:.-]+/, '').trim() || raw };
  // sin verbo reconocido: si el aviso era una consulta (o hay una tarea o chat abiertos), lo dicho es la respuesta
  if (ctx.kind === 'consulta' || ctx.conv || ctx.task) return { action: 'reply', ...target(false), text: raw };
  return { action: 'chat', text: raw };
}
