// Agente de campo: conecta ESTA PC con la oficina del VPS y ejecuta aquí agentes, git y archivos.
// Conexión solo saliente (HTTPS): no hay que abrir puertos en la PC.
// Config: worker.json junto a este archivo o variables OFICINA_URL / OFICINA_TOKEN / OFICINA_WORKER_ROOTS / OFICINA_WORKER_DATA / OFICINA_CANTINA.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('./hostops');

const cfgFile = process.env.OFICINA_WORKER_CONFIG || path.join(__dirname, 'worker.json');
const file = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const URL_ = (process.env.OFICINA_URL || file.url || '').replace(/\/$/, '');
const TOKEN = process.env.OFICINA_TOKEN || file.token;
const ROOTS = process.env.OFICINA_WORKER_ROOTS ? process.env.OFICINA_WORKER_ROOTS.split(';') : (file.roots || [os.homedir()]);
const DATA = process.env.OFICINA_WORKER_DATA || file.dataDir || path.join(os.homedir(), '.oficina-worker');
const CANTINA = process.env.OFICINA_CANTINA ?? file.cantina ?? 'D:/cantina'; // carpeta fija de la Cantina ('' = sandbox por chat)
if (!URL_ || !TOKEN) { console.error('Falta url/token: crea worker.json con {"url": "https://…", "token": "…"} (el token se genera en Configuración → Máquinas)'); process.exit(1); }
fs.mkdirSync(path.join(DATA, 'sandbox'), { recursive: true });

const H = create({ dataDir: DATA, strict: true, roots: ROOTS, cantina: CANTINA });
const auth = { Authorization: 'Bearer ' + TOKEN };
const say = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(p, body) {
  const r = await fetch(`${URL_}/api/worker/${p}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
}
async function download(id) {
  const r = await fetch(`${URL_}/api/worker/attachments/${id}`, { headers: auth });
  if (!r.ok) throw new Error(`adjunto ${id}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// eventos de los procesos (salida, fin): cola en memoria con reintento, así no se pierden si se corta la red;
// seq creciente para que el servidor descarte los repetidos si reenviamos un lote ya procesado
// ponytail: cola solo en memoria; persistirla si hace falta recuperar eventos tras reiniciar el worker
const outbox = [];
let seq = 0;
(async function flush() {
  for (;;) {
    if (!outbox.length) { await sleep(150); continue; }
    const batch = outbox.slice(0, 500);
    try { await post('events', { events: batch }); outbox.splice(0, batch.length); }
    catch { await sleep(2000); }
  }
})();

async function handleCall({ id, op, args }) {
  try {
    let result;
    if (op === 'spawnRun') { result = H.spawnRun(args, ev => outbox.push({ runId: args.runId, seq: ++seq, ...ev })); say(`▶ run ${args.runId}: ${path.basename(args.exe)} en ${args.cwd}`); }
    else if (op === 'putFiles') result = await H.ops.putFiles(args, f => download(f.id));
    else if (Object.hasOwn(H.ops, op)) result = await H.ops[op](args);
    else throw new Error('Operación desconocida: ' + op);
    await post('reply', { id, ok: true, result });
  } catch (e) {
    await post('reply', { id, ok: false, error: e.message }).catch(() => {});
  }
}

async function connect() {
  const ctrl = new AbortController();
  let last = Date.now();
  const watchdog = setInterval(() => { if (Date.now() - last > 60000) ctrl.abort(); }, 5000); // el servidor manda ping cada 20 s
  try {
    await post('hello', H.ops.info());
    const r = await fetch(`${URL_}/api/worker/stream`, { headers: auth, signal: ctrl.signal });
    if (!r.ok) throw new Error(`stream: HTTP ${r.status}${r.status === 401 ? ' (token inválido o máquina eliminada)' : ''}`);
    say(`✔ conectado a ${URL_} · raíces: ${ROOTS.join(', ')}`);
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      last = Date.now();
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev === 'call' && data) handleCall(JSON.parse(data));
      }
    }
    throw new Error('el servidor cerró la conexión');
  } finally { clearInterval(watchdog); }
}

(async () => {
  say(`Agente de campo de la Oficina Virtual (${os.hostname()})`);
  let wait = 1000;
  for (;;) {
    const t0 = Date.now();
    try { await connect(); } catch (e) { say('✘ desconectado:', e.message); }
    wait = Date.now() - t0 > 30000 ? 1000 : Math.min(wait * 2, 30000);
    await sleep(wait);
  }
})();
