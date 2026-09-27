'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { create } = require('./hostops');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-hostops-'));
const dataDir = path.join(temp, 'data');
const sandbox = path.join(dataDir, 'sandbox', 'task-1');
const cwd = path.join(temp, 'work');
fs.mkdirSync(sandbox, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
const ops = create({ dataDir }).ops;

function linkOrSkip(target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
      console.log(`SKIP enlaces simbólicos (${process.platform}: ${error.code})`);
      return false;
    }
    throw error;
  }
}

async function main() {
  try {
    fs.writeFileSync(path.join(sandbox, 'normal.txt'), 'normal');
    fs.mkdirSync(path.join(sandbox, 'nested'));
    fs.writeFileSync(path.join(sandbox, 'nested', 'inside.txt'), 'inside');

    assert.deepEqual(
      ops.listFiles({ sandbox: 'task-1' }).map(file => file.name).sort(),
      ['nested/inside.txt', 'normal.txt'],
      'lista los archivos normales del sandbox'
    );
    assert.equal(Buffer.from(ops.readFileB64({ sandbox: 'task-1', name: 'nested/inside.txt' }), 'base64').toString(), 'inside');
    for (const invalidSandbox of ['..', '../outside', 'task-1/../../outside', '']) {
      assert.throws(() => ops.listFiles({ sandbox: invalidSandbox }), /sandbox|ruta|carpeta/i, `rechaza sandbox ${JSON.stringify(invalidSandbox)}`);
    }
    for (const invalidName of ['../outside.txt', 'nested/../../outside.txt', path.resolve(temp, 'outside.txt')]) {
      assert.throws(() => ops.readFileB64({ sandbox: 'task-1', name: invalidName }), /archivo|ruta|sandbox/i, `rechaza ruta ${JSON.stringify(invalidName)}`);
    }

    const outside = path.join(temp, 'outside.txt');
    fs.writeFileSync(outside, 'outside secret');
    const outsideLink = path.join(sandbox, 'outside-link.txt');
    if (linkOrSkip(outside, outsideLink, 'file')) {
      assert.ok(!ops.listFiles({ sandbox: 'task-1' }).some(file => file.name === 'outside-link.txt'), 'omite enlaces a archivos al listar');
      assert.throws(() => ops.readFileB64({ sandbox: 'task-1', name: 'outside-link.txt' }), /enlace|archivo|ruta|sandbox/i, 'rechaza descargar enlaces a archivos');
    }

    const outsideDir = path.join(temp, 'outside-dir');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside directory secret');
    const dirLink = path.join(sandbox, 'outside-dir');
    if (linkOrSkip(outsideDir, dirLink, 'junction')) {
      assert.ok(!ops.listFiles({ sandbox: 'task-1' }).some(file => file.name.startsWith('outside-dir/')), 'no recorre junctions al listar');
      assert.throws(() => ops.readFileB64({ sandbox: 'task-1', name: 'outside-dir/secret.txt' }), /enlace|archivo|ruta|sandbox/i, 'rechaza componentes que son junctions');
    }
    const sandboxLink = path.join(dataDir, 'sandbox', 'task-2');
    if (linkOrSkip(outsideDir, sandboxLink, 'junction')) {
      assert.throws(() => ops.listFiles({ sandbox: 'task-2' }), /sandbox|ruta/i, 'rechaza el propio directorio sandbox cuando es junction');
      assert.throws(() => ops.readFileB64({ sandbox: 'task-2', name: 'secret.txt' }), /sandbox|ruta/i);
      fs.rmSync(sandboxLink, { recursive: true, force: true });
    }

    const attachments = [
      { id: 10, name: 'nota.txt', size: 4 },
      { id: 11, name: 'nota.txt', size: 4 },
      { id: 12, name: 'a?.txt', size: 3 },
      { id: 13, name: 'a*.txt', size: 3 },
      { id: 14, name: 'Case.txt', size: 3 },
      { id: 15, name: 'case.txt', size: 3 },
    ];
    const bytes = new Map([[10, Buffer.from('uno!')], [11, Buffer.from('dos!')], [12, Buffer.from('abc')], [13, Buffer.from('xyz')], [14, Buffer.from('ABC')], [15, Buffer.from('XYZ')]]);
    const refs = await ops.putFiles({ cwd, files: attachments }, file => bytes.get(file.id));
    assert.equal(refs[0], '.oficina/adjuntos/nota__10.txt', 'la ruta incorpora la identidad del adjunto');
    assert.equal(new Set(refs).size, attachments.length, 'asigna una ruta distinta a cada identidad, incluidas colisiones normalizadas');
    for (let i = 0; i < refs.length; i++) {
      assert.deepEqual(fs.readFileSync(path.join(cwd, refs[i])), bytes.get(attachments[i].id), `la referencia ${attachments[i].id} entrega sus bytes`);
    }
    const laterRef = await ops.putFiles({ cwd, files: [attachments[1]] }, file => bytes.get(file.id));
    assert.equal(laterRef[0], refs[1], 'la identidad conserva su ruta al llegar sola o después de otra conversación');
    assert.deepEqual(fs.readFileSync(path.join(cwd, laterRef[0])), bytes.get(11));

    // Un archivo previo con el mismo nombre y tamaño no representa necesariamente el mismo adjunto.
    const sameSize = [{ id: 20, name: 'cambio.bin', size: 4 }];
    const first = await ops.putFiles({ cwd, files: sameSize }, () => Buffer.from('AAAA'));
    await ops.putFiles({ cwd, files: sameSize }, () => Buffer.from('BBBB'));
    assert.equal(fs.readFileSync(path.join(cwd, first[0])).toString(), 'BBBB', 'actualiza bytes aunque coincidan nombre y tamaño');

    // listNewFiles / readNewFile: archivos que el agente genera en una tarea con carpeta git (worktree)
    const repo = path.join(temp, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 'a@a.com'); git('config', 'user.name', 'a');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v1');
    git('add', '.'); git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'contenido nuevo');
    fs.mkdirSync(path.join(repo, 'salida'));
    fs.writeFileSync(path.join(repo, 'salida', 'reporte.csv'), 'a,b');
    git('add', 'salida/reporte.csv'); git('commit', '-q', '-m', 'agrega reporte');

    assert.deepEqual(
      ops.listNewFiles({ cwd: repo, base }).map(f => f.name).sort(),
      ['nuevo.txt', 'salida/reporte.csv'],
      'lista archivos sin commitear y archivos agregados desde base_branch'
    );
    assert.equal(Buffer.from(ops.readNewFile({ cwd: repo, name: 'salida/reporte.csv' }), 'base64').toString(), 'a,b');
    assert.throws(() => ops.readNewFile({ cwd: repo, name: '../outside.txt' }), /ruta|archivo/i, 'rechaza escapar del worktree');
    assert.deepEqual(ops.listNewFiles({ cwd: path.join(temp, 'no-existe') }), [], 'carpeta inexistente devuelve lista vacía');

    console.log('OK hostops');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
