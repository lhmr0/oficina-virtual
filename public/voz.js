// Intérprete de órdenes por voz de la Oficina Virtual.
// Sin modelo: reconoce el vocabulario cerrado de la oficina (secciones, proyectos, agentes, áreas)
// y devuelve una orden que la interfaz muestra para confirmar antes de ejecutar nada.
// Módulo ES puro (sin DOM) para poder probarlo en Node desde test-frontend.js.

export const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Palabras de relleno que no forman parte del título ni del mensaje
const GLUE = new Set(('crea crear creame agrega agregar agregame anade anadir programa programar genera generar ' +
  'nueva nuevo una uno unas la el los las tarea tareas mision misiones en al a de del para por con que lo haga haz hazme ' +
  'quiero necesito proyecto busca buscar buscame encuentra encontrar favor asignada asignado encargado responsable sobre acerca dime decir dile preguntale pregunta preguntar ' +
  'consulta consultar pide pedir muestrame muestra abre abrir ve ir vamos llevame entra entrar pon ponme cantina rapida')
  .split(/\s+/).filter(Boolean).map(norm));

// Muletillas que introducen el título ("titulada X", "llamada X"…)
const MARCA = new Set(('titulada titulado titulo llamada llamado nombre diga digase llame').split(/\s+/).map(norm));
// Conectores tras los que ya no hay título
const CORTE = [' para el agente', ' para la agente', ' para que lo', ' que lo haga', ' con el agente', ' al agente',
  ' asignada a', ' asignado a'].map(norm);

const SECCIONES = [
  ['consejo jedi', 'Consejo Jedi', '#/consejo'],
  ['archivos jedi', 'Archivos Jedi', '#/archivos'],
  ['puente de mando', 'Puente de Mando', '#/puente'],
  ['cantina', 'Cantina', '#/cantina'],
  ['kanban', 'Kanban', '#/kanban'],
  ['tablero', 'Kanban', '#/kanban'],
  ['proyectos', 'Proyectos', '#/proyectos'],
  ['consejo', 'Consejo Jedi', '#/consejo'],
  ['archivos', 'Archivos Jedi', '#/archivos'],
  ['puente', 'Puente de Mando', '#/puente'],
  ['configuracion', 'Configuración', '#/config'],
  ['ajustes', 'Configuración', '#/config'],
  ['perfil', 'Mi perfil', '#/config/perfil'],
  ['estacion', 'Estación', '#/estacion'],
  ['mapa', 'Estación', '#/estacion'],
  ['oficina', 'Estación', '#/estacion'],
];

const borde = c => !c || !/[a-z0-9]/.test(c);

// índice del vocablo en el texto normalizado, exigiendo límites de palabra
function indice(n, aguja) {
  const q = norm(aguja);
  if (!q) return -1;
  let i = n.indexOf(q);
  while (i !== -1) {
    if (borde(n[i - 1]) && borde(n[i + q.length])) return i;
    i = n.indexOf(q, i + 1);
  }
  return -1;
}

// texto original + versión normalizada + mapa de cada carácter normalizado a su origen
function preparar(s) {
  const src = String(s ?? '');
  let n = '', k = 0;
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const b = src[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let j = 0; j < b.length; j++) { n += b[j]; map[k++] = i; }
  }
  return { src, n, map };
}
// deja solo las palabras útiles (sin verbos, proyecto, agente ni conectores)
function limpiar(resto) {
  let t = String(resto).replace(/[.,;:!?¿¡"“”«»()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const tn = norm(t);
  for (const m of CORTE) { const i = tn.indexOf(m); if (i >= 0) { t = t.slice(0, i); break; } }
  const words = t.split(' ').filter(Boolean);
  while (words.length && (GLUE.has(norm(words[0])) || MARCA.has(norm(words[0])))) words.shift();
  while (words.length && (GLUE.has(norm(words[words.length - 1])) || MARCA.has(norm(words[words.length - 1])))) words.pop();
  return words.join(' ').trim();
}

// el verbo de la orden se busca AL INICIO (una orden puede mencionar "encuentra", "consulta"… dentro)
const PRE = '^(por favor |porfa |eh |oye |hola )*';
const IR = new RegExp(PRE + '(abre|abrir|ve|ir|vamos|muestrame|muestra|llevame|entra|entrar|pon|ponme)\\b');
const BUSCAR = new RegExp(PRE + '(busca|buscame|buscar|encuentra|encontrar)\\b');
const CHAT = new RegExp(PRE + '(pregunta|preguntale|preguntar|consulta|consultar|dile|decir|pide|pedir)\\b');
const CREAR = new RegExp(PRE + '(crea|crear|creame|agrega|agregar|agregame|anade|anadir|programa|programar|genera|generar|haz|hazme|necesito|quiero)\\b');
const TAREA = /\btareas?\b|\bmision(es)?\b/;
// texto + { projects, areas, agents } → orden lista para confirmar
export function parseVoz(texto, ctx = {}) {
  const projects = ctx.projects || [], areas = ctx.areas || [], agents = ctx.agents || [];
  const { src, n, map } = preparar(texto);
  const del = new Array(src.length).fill(false);
  const borra = (a, b) => { for (let k = a; k < b; k++) del[map[k]] = true; };
  const resto = () => { let out = ''; for (let i = 0; i < src.length; i++) if (!del[i]) out += src[i]; return out; };

  const o = { accion: null, transcripcion: String(texto ?? '').trim(), proyecto_id: null, agente_id: null, area_id: null,
    titulo: '', texto: '', destino: null, destinoNombre: '', confianza: 0 };

  // el nombre (más largo) que aparezca en el dictado
  const mejor = (lista, nombres) => {
    let hit = null;
    for (const it of lista) for (const nom of nombres(it)) {
      const i = indice(n, nom);
      if (i >= 0 && (!hit || norm(nom).length > hit.len)) hit = { it, i, len: norm(nom).length };
    }
    return hit;
  };
  const pj = mejor(projects, p => [p.name, p.code].filter(Boolean));
  if (pj) { o.proyecto_id = pj.it.id; borra(pj.i, pj.i + pj.len); }
  const ar = mejor(areas, a => [a.name, a.alias].filter(Boolean));
  if (ar) { o.area_id = ar.it.id; borra(ar.i, ar.i + ar.len); }
  const ag = mejor(agents, a => [a.name, a.key].filter(Boolean));
  if (ag) { o.agente_id = ag.it.id; borra(ag.i, ag.i + ag.len); }

  let sec = null;
  for (const [k, nom, hash] of SECCIONES) {
    const i = indice(n, k);
    if (i >= 0 && (!sec || norm(k).length > sec.len)) sec = { len: norm(k).length, nom, hash, k };
  }

  const arranque = n.replace(/^[\s,.;:!?¿¡"«»()-]+/, '');
  if (sec && IR.test(arranque)) { o.accion = 'ir'; o.destino = sec.hash; o.destinoNombre = sec.nom; o.confianza = 1; return o; }
  if (/\bcantina\b/.test(n) && !TAREA.test(n)) { o.accion = 'chat'; o.texto = limpiar(resto()) || o.transcripcion; o.confianza = o.agente_id ? 0.9 : 0.6; return o; }
  if (TAREA.test(n) || CREAR.test(arranque)) {
    o.accion = 'tarea'; o.prompt = o.transcripcion;
    let t = limpiar(resto());
    if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '').trim();
    o.titulo = t || o.transcripcion.slice(0, 90);
    o.confianza = o.proyecto_id ? 0.9 : 0.5; return o;
  }
  if (CHAT.test(arranque)) { o.accion = 'chat'; o.texto = limpiar(resto()) || o.transcripcion; o.confianza = o.agente_id ? 0.9 : 0.6; return o; }
  if (BUSCAR.test(arranque)) { o.accion = 'buscar'; o.texto = limpiar(resto()) || o.transcripcion; o.confianza = 0.8; return o; }
  return o;
}