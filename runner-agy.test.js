const assert = require('node:assert/strict');
const { ADAPTERS } = require('./runner');

function parse(events) {
  const lines = [];
  const state = {};
  for (const event of events) ADAPTERS.agy.parse(event, state, line => lines.push(line));
  return { lines, state };
}

const step = (step_type, state, extra = {}) => ({ event: 'step_update', step_update: { step_type, state, ...extra } });

const run = parse([
  { event: 'init', conversation_id: 'conversation-1' },
  step('system_message', 'DONE'),
  step('agent_response', 'ACTIVE', { text_delta: 'Voy a ' }),
  step('agent_response', 'DONE', { text_delta: 'revisar.' }),
  step('tool', 'ACTIVE', { tool_name: 'run_command' }),
  step('tool', 'DONE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hola' }, output: 'hola\r\n' } }),
  step('tool', 'DONE', { tool_info: { name: 'write_to_file', parameters: { TargetFile: 'nota.txt' }, error: { type: 'WriteError', message: 'Permiso denegado' } } }),
  step('checkpoint', 'DONE'),
  { event: 'result', result: { response: 'Voy a revisar.', status: 'SUCCESS', conversation_id: 'conversation-1' } },
]);
assert.deepEqual(run.lines, [
  '💬 Voy a revisar.',
  '🔧 run_command · echo hola',
  '  ↳ hola',
  '🔧 write_to_file · {"TargetFile":"nota.txt"}',
  '⚠ write_to_file: {"type":"WriteError","message":"Permiso denegado"}',
]);
assert.equal(run.state.final, 'Voy a revisar.');
assert.equal(run.state.sessionId, 'conversation-1');

const fallback = parse([{ event: 'result', result: { response: 'Respuesta sin deltas.', status: 'SUCCESS' } }]);
assert.deepEqual(fallback.lines, ['💬 Respuesta sin deltas.']);

console.log('✔ parser agy: texto, herramientas, resultado y pasos internos');
