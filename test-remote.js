// Pruebas unitarias del protocolo remoto. Uso: node --no-warnings test-remote.js
const assert = require('node:assert/strict');
const { createOutbox } = require('./remote-events');

function testBoundedSequencedOutbox() {
  const box = createOutbox({ maxPending: 3 });
  assert.equal(box.reserveRun('run-a'), true);
  assert.equal(box.push('run-a', { t: 'out', line: 'uno' }), true);
  assert.equal(box.push('run-a', { t: 'out', line: 'dos' }), true);
  assert.equal(box.push('run-a', { t: 'out', line: 'se descarta al llenarse' }), false);

  // La salida terminal usa el espacio reservado para el proceso y comunica el recorte.
  assert.equal(box.push('run-a', { t: 'exit', code: 7 }), true);
  assert.deepEqual(box.pending().map(e => e.seq), [1, 2, 3]);
  assert.equal(box.pending().at(-1).dropped_logs, 1);
  assert.equal(box.pending().at(-1).code, 7);
  assert.equal(box.pending().length, 3, 'la cola nunca supera su límite');
}

function testAcknowledgementIsPerRunAndContiguous() {
  const box = createOutbox({ maxPending: 8 });
  for (const runId of ['run-a', 'run-b']) {
    box.reserveRun(runId);
    box.push(runId, { t: 'out', line: 'primero' });
    box.push(runId, { t: 'exit', code: 0 });
  }

  const batch = box.batch(8);
  assert.equal(box.acknowledge({ 'run-a': 1 }), 1);
  assert.deepEqual(box.pending().filter(e => e.runId === 'run-a').map(e => e.seq), [2]);
  assert.deepEqual(box.pending().filter(e => e.runId === 'run-b').map(e => e.seq), [1, 2]);

  // Respuesta perdida: el mismo ACK puede repetirse sin afectar los otros runs.
  assert.equal(box.acknowledge({ 'run-a': 1 }), 0);
  assert.equal(box.acknowledge({ 'run-a': 2, 'run-b': 2 }), 3);
  assert.equal(box.pending().length, 0);

  // Compatibilidad: los servidores antiguos responden 2xx sin ACK acumulativo.
  box.reserveRun('run-c');
  box.push('run-c', { t: 'exit', code: 0 });
  const legacyBatch = box.batch(8);
  assert.equal(box.acknowledge(null, legacyBatch), 1);
  assert.equal(box.pending().length, 0);
  assert.ok(batch.length > 0);
}

testBoundedSequencedOutbox();
testAcknowledgementIsPerRunAndContiguous();
console.log('✔ protocolo remoto: cola acotada, terminal preservado, secuencias y ACK compatibles');
