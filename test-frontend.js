'use strict';

const assert = require('node:assert/strict');

function input(id, type = 'text', value = '') {
  return {
    id, type, value, checked: false, selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focused = true; },
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
  assert.equal(Object.values(state.values).length, 1, 'file input values must never be copied');

  const refreshedDraft = input('message', 'textarea', 'stale response value');
  const refreshedFile = input('attachment', 'file');
  const root = { querySelectorAll: () => [refreshedDraft, refreshedFile] };
  restoreInputState(root, state);
  assert.equal(refreshedDraft.value, 'texto escrito durante la carga');
  assert.equal(refreshedDraft.selectionStart, 7);
  assert.equal(refreshedDraft.selectionEnd, 14);
  assert.equal(refreshedDraft.focused, true);

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

  const logs = await import('./public/log-window.js').catch(() => null);
  assert.ok(logs, 'public/log-window.js must provide a bounded, pageable log window');
  assert.equal(typeof logs.createLogWindow, 'function');
  const windowed = logs.createLogWindow(500);
  windowed.append(Array.from({ length: 10000 }, (_, i) => `línea ${i}`));
  assert.equal(windowed.visible().length, 500);
  assert.equal(windowed.visible()[0], 'línea 9500');
  assert.equal(windowed.visible()[499], 'línea 9999');
  assert.equal(windowed.canPrevious(), true);
  windowed.previous();
  assert.equal(windowed.visible()[0], 'línea 9000');
  assert.equal(windowed.canNext(), true);
  windowed.append('línea 10000', { follow: false });
  assert.equal(windowed.visible()[0], 'línea 9000', 'new events must not move a reader away from older lines');
  while (windowed.canNext()) windowed.next();
  assert.equal(windowed.visible()[499], 'línea 10000');
  assert.equal(windowed.canPrevious(), true);

  console.log('FRONTEND TODO OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
