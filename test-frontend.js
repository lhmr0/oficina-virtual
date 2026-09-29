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
  const settings = new Map();
  globalThis.localStorage = {
    getItem: key => settings.has(key) ? settings.get(key) : null,
    setItem: (key, value) => settings.set(key, String(value)),
    removeItem: key => settings.delete(key),
  };
  globalThis.document = {
    documentElement: { setAttribute() {} },
    getElementById: () => null,
    addEventListener() {},
  };
  const { S, voicePrefs, splitSpeechText, speak, stopSpeaking } = await import('./public/core.js');
  assert.equal(voicePrefs().voice, '', 'sin servidor de IA no se elige una voz remota');
  S.boot = { ia: true };
  assert.equal(voicePrefs().voice, 'ia:chatterbox-latam', 'Chatterbox es la voz predeterminada con IA');
  localStorage.setItem('ov_voice', 'ia:piper-claude');
  assert.equal(voicePrefs().voice, 'ia:piper-claude', 'se conserva la voz guardada por el usuario');
  localStorage.setItem('ov_voice', 'nav:voz elegida');
  assert.equal(voicePrefs().voice, 'nav:voz elegida', 'también se conserva una voz del navegador');
  localStorage.removeItem('ov_voice');

  const longText = ('Una frase completa para probar las pausas. Otra frase con palabras largas; ').repeat(6).trim();
  const chunks = splitSpeechText(longText);
  assert.ok(chunks.length > 1 && chunks.every(chunk => chunk.length <= 180));
  assert.equal(chunks.join(' '), longText, 'la partición no pierde palabras');
  assert.deepEqual(splitSpeechText('a'.repeat(181)).map(chunk => chunk.length), [180, 1]);

  const requests = [];
  let played = 0, autoEnd = true, currentAudio;
  globalThis.window = { speechSynthesis: { cancel() {} } };
  globalThis.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, blob: async () => ({}) };
  };
  const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:voz';
  URL.revokeObjectURL = () => {};
  globalThis.Audio = class {
    constructor(src) { this.src = src; currentAudio = this; }
    async play() { played++; if (autoEnd) queueMicrotask(() => this.onended()); }
    pause() { this.onpause?.(); }
  };
  await speak(longText, { voice: 'ia:chatterbox-latam', speed: 1 });
  assert.equal(requests.length, chunks.length, 'se pide un WAV por fragmento en orden');
  assert.deepEqual(requests.map(request => request.text), chunks);
  assert.equal(played, chunks.length, 'se reproducen todos los fragmentos');
  requests.length = 0;
  autoEnd = false;
  currentAudio = null;
  const reading = speak(longText, { voice: 'ia:chatterbox-latam', speed: 1 });
  while (!currentAudio || currentAudio.onpause == null) await new Promise(resolve => setImmediate(resolve));
  stopSpeaking();
  await reading;
  assert.equal(requests.length, 1, 'detener la voz impide pedir los fragmentos restantes');
  requests.length = 0;
  autoEnd = true;
  await speak(longText, { voice: 'ia:piper-claude', speed: 1 });
  assert.equal(requests.length, 1, 'las otras voces conservan una sola solicitud');
  assert.equal(requests[0].text, longText);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;

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
