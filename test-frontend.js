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

  const { parseCommand, notifPhrase, ctxFromLink } = await import('./public/comandos.js');
  const review = ctxFromLink('#/tarea/29', 'revision');
  assert.deepEqual(review, { task: 29, conv: null, kind: 'revision', link: '#/tarea/29' });
  assert.deepEqual(parseCommand('aprueba la 29', review), { action: 'approve', task: 29, conv: null, merge: false });
  assert.deepEqual(parseCommand('sí', review), { action: 'approve', task: 29, conv: null, merge: false });
  assert.deepEqual(parseCommand('devuélvela porque falta la prueba', review), { action: 'return', task: 29, conv: null, text: 'falta la prueba' });
  assert.deepEqual(parseCommand('pásala a Codex', review), { action: 'handoff', task: 29, conv: null, agent: 'codex' });
  assert.deepEqual(parseCommand('después', review), { action: 'none' });
  assert.deepEqual(parseCommand('repite', review), { action: 'repeat' });
  assert.deepEqual(parseCommand('responde en la tarea 30: ya está listo', review), { action: 'reply', task: 30, conv: null, text: 'ya está listo' });
  assert.deepEqual(parseCommand('Necesito revisar la 2', ctxFromLink('#/cantina/7', 'consulta')), { action: 'reply', task: null, conv: 7, text: 'Necesito revisar la 2' });
  assert.deepEqual(parseCommand('Idea nueva', {}), { action: 'chat', text: 'Idea nueva' });
  assert.match(notifPhrase({ kind: 'revision', title: 'Tarea 29 lista', body: 'Revisar cambios' }), /¿La apruebas, la devuelves/);

  console.log('FRONTEND TODO OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
