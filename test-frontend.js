'use strict';

const assert = require('node:assert/strict');

function input(id, type = 'text', value = '') {
  return {
    id, type, value, checked: false, selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focused = true; },
    dispatchEvent(e) { this.dispatched = e.type; },
  };
}

function form(url, text) {
  const field = input('', 'text', text);
  return { dataset: { reply: url }, querySelector: () => field, field };
}

async function main() {
  const ui = await import('./public/ui-state.js').catch(() => null);
  assert.ok(ui, 'public/ui-state.js must expose reusable draft state helpers');
  const { captureInputState, restoreInputState, captureReplyDrafts, restoreReplyDrafts } = ui;
  assert.equal(typeof captureInputState, 'function');
  assert.equal(typeof restoreInputState, 'function');
  assert.equal(typeof captureReplyDrafts, 'function');
  assert.equal(typeof restoreReplyDrafts, 'function');

  const draft = input('message', 'textarea', 'texto escrito durante la carga');
  draft.selectionStart = 7;
  draft.selectionEnd = 14;
  const file = input('attachment', 'file');
  file.files = [{ name: 'informe.txt' }];
  const state = captureInputState([draft, file], draft);
  const savedDraft = Object.values(state.values)[0];
  assert.equal(savedDraft.value, 'texto escrito durante la carga');
  assert.equal(savedDraft.selectionStart, 7);
  assert.equal(Object.values(state.values).length, 2);

  const refreshedDraft = input('message', 'textarea', 'stale response value');
  const refreshedFile = input('attachment', 'file');
  const root = { querySelectorAll: () => [refreshedDraft, refreshedFile] };
  restoreInputState(root, state);
  assert.equal(refreshedDraft.value, 'texto escrito durante la carga');
  assert.equal(refreshedDraft.selectionStart, 7);
  assert.equal(refreshedDraft.selectionEnd, 14);
  assert.equal(refreshedDraft.focused, true);
  assert.equal(refreshedFile.files, file.files, 'la selección de archivos sobrevive al refresco');
  assert.equal(refreshedFile.value, '', 'nunca se asigna value a un campo de archivo');
  assert.equal(refreshedFile.dispatched, 'change');

  const replies = [form('/api/tasks/12/reply', 'respuesta del borrador'), form('/api/conversations/5/reply', 'otra respuesta')];
  replies[1].field.selectionStart = 4;
  replies[1].field.selectionEnd = 10;
  const replyState = captureReplyDrafts(replies, replies[1].field);
  const refreshedReplies = [form('/api/tasks/12/reply', 'respuesta inicial'), form('/api/conversations/5/reply', '')];
  restoreReplyDrafts(refreshedReplies, replyState);
  assert.equal(refreshedReplies[0].field.value, 'respuesta del borrador');
  assert.equal(refreshedReplies[1].field.value, 'otra respuesta');
  assert.equal(refreshedReplies[1].field.selectionStart, 4);
  assert.equal(refreshedReplies[1].field.selectionEnd, 10);
  assert.equal(refreshedReplies[1].field.focused, true);

  const { parseVoz } = await import('./public/ordenes.js');
  const ctx = {
    projects: [{ id: 1, name: 'Oficina Virtual' }, { id: 2, name: 'Solo notas' }],
    agents: [{ id: 10, name: 'Claude' }, { id: 11, name: 'Codex' }],
    areas: [{ id: 20, name: 'Desarrollo', alias: 'dev' }, { id: 21, name: 'Análisis', alias: 'ana' }],
  };
  const tareaVoz = parseVoz('crea una tarea en el proyecto Oficina Virtual titulada arreglar el login para el agente Codex', ctx);
  assert.equal(tareaVoz.accion, 'tarea');
  assert.equal(tareaVoz.proyecto_id, 1);
  assert.equal(tareaVoz.agente_id, 11);
  assert.equal(tareaVoz.titulo, 'arreglar el login');
  const irVoz = parseVoz('abre la cantina', ctx);
  assert.equal(irVoz.accion, 'ir');
  assert.equal(irVoz.destino, '#/cantina');
  const chatVoz = parseVoz('pregúntale a Claude si el servidor está en línea', ctx);
  assert.equal(chatVoz.accion, 'chat');
  assert.equal(chatVoz.agente_id, 10);
  assert.match(chatVoz.texto, /servidor está en línea/);
  const buscarVoz = parseVoz('busca dictado por voz', ctx);
  assert.equal(buscarVoz.accion, 'buscar');
  assert.equal(buscarVoz.texto, 'dictado por voz');
  const tareaVoz2 = parseVoz('nueva tarea en Solo notas: comprar pan', ctx);
  assert.equal(tareaVoz2.accion, 'tarea');
  assert.equal(tareaVoz2.proyecto_id, 2);
  assert.equal(tareaVoz2.titulo, 'comprar pan');
  assert.equal(parseVoz('hola qué tal', ctx).accion, null, 'sin orden reconocible');
  // regresión (captura de pantalla del usuario): una tarea larga que menciona "encuentra"/"consulta" no debe caer en Buscar
  const dictadoLargo = parseVoz('Crea una tarea en el proyecto Oficina Virtual, donde vas a consultar por qué es que en Claude, por ejemplo, no se encuentra el modelo Sonnet 5.5, pese a que en el CLI sí está.', ctx);
  assert.equal(dictadoLargo.accion, 'tarea', 'la palabra "encuentra" dentro de una orden de tarea no debe confundir el intérprete');
  assert.equal(dictadoLargo.proyecto_id, 1);
  assert.equal(dictadoLargo.agente_id, 10);
  assert.ok(dictadoLargo.titulo.length > 0 && dictadoLargo.titulo.length <= 90, 'título acotado y no vacío');
  // regresión (2ª captura): separar "con el título X y la descripción Y"
  const conTituloYDesc = parseVoz('crear una tarea con el título en consulta de agente y la descripción sea de que se debe consultar los agentes diariamente.', ctx);
  assert.equal(conTituloYDesc.accion, 'tarea');
  assert.equal(conTituloYDesc.titulo, 'consulta de agente', 'el título no debe incluir la descripción');
  assert.match(conTituloYDesc.descripcion, /debe consultar los agentes diariamente/, 'la descripción queda aparte del título');

  console.log('FRONTEND TODO OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
