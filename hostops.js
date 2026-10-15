// Operaciones que se ejecutan EN LA MÁQUINA donde viven los archivos (esta PC):
// git, carpetas, procesos de agentes, versiones. Las usa el servidor en modo local
// y el agente de campo (worker.js) cuando la oficina corre en el VPS.
const { spawn, exec, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

// Claude CLI no tiene comando para listar modelos: IDs completos (sin alias sonnet/opus…, que duplicaban la lista). Actualizar al salir uno nuevo.
const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5'];

// cfg: { dataDir, strict, roots[], cantina } — strict = agente de campo: solo CLIs conocidos y rutas bajo roots (más la carpeta de la Cantina)
function create(cfg) {
  const dataDir = cfg.dataDir;
  const strict = !!cfg.strict;
  const roots = (cfg.roots?.length ? cfg.roots : [os.homedir()]).map(r => canon(r));
  const runs = new Map(); // runId → proc
  const cantinaDir = cfg.cantina ? path.resolve(cfg.cantina) : null; // carpeta fija de las consultas rápidas en esta máquina
  // cfg.deploy: { "<ruta repo>": { cmd, target } } (o solo el comando) — se configura en la máquina, el servidor no puede mandar comandos arbitrarios
  const deployCfg = r => { const v = Object.entries(cfg.deploy || {}).find(([p]) => canon(p).toLowerCase() === r.toLowerCase())?.[1]; return typeof v === 'string' ? { cmd: v } : v; };

  // ---------- rutas ----------
  function canon(p) { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } }
  const expand = s => String(s).replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
  // CommandCode: cada llamada al CLI dispara su chequeo de versión (npm view). Se guarda el resultado 1 día; solo se cachea si es válido.
  const ccFile = path.join(dataDir, 'cc-cache.json');
  const isCC = a => (a || []).some(x => /command-code[\\/]dist[\\/]index\.mjs$/i.test(expand(x)));
  async function yearly(key, fn, valid) {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(ccFile, 'utf8')); } catch {}
    if (c[key] && Date.now() - c[key].at < 86400e3) return c[key].v;
    const v = await fn();
    if (valid(v)) { c[key] = { at: Date.now(), v }; try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(ccFile, JSON.stringify(c)); } catch {} }
    return v;
  }
  const under = (p, r) => p.toLowerCase() === r.toLowerCase() || p.toLowerCase().startsWith(r.toLowerCase().replace(/[\\/]$/, '') + path.sep);
  const sandboxRoot = path.join(canon(dataDir), 'sandbox');
  const sameSandboxPath = (a, b) => {
    const x = path.resolve(a), y = path.resolve(b);
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  };
  const withinSandbox = (p, r) => {
    const rel = path.relative(r, p);
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
  };
  function sandboxBase(name, createIfMissing = false) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name)) throw new Error('Nombre de sandbox inválido');
    if (createIfMissing) fs.mkdirSync(sandboxRoot, { recursive: true });
    let rootStat;
    try { rootStat = fs.lstatSync(sandboxRoot); }
    catch (e) { if (e.code === 'ENOENT' && !createIfMissing) return null; throw e; }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Ruta sandbox inválida');
    const realRoot = fs.realpathSync.native(sandboxRoot);
    if (!sameSandboxPath(realRoot, sandboxRoot)) throw new Error('Ruta sandbox inválida');
    const base = path.join(realRoot, name);
    if (createIfMissing) {
      try { fs.mkdirSync(base); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    let baseStat;
    try { baseStat = fs.lstatSync(base); }
    catch (e) { if (e.code === 'ENOENT' && !createIfMissing) return null; throw e; }
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) throw new Error('Ruta sandbox inválida');
    const realBase = fs.realpathSync.native(base);
    if (!withinSandbox(realBase, realRoot) || !sameSandboxPath(realBase, base)) throw new Error('Ruta sandbox inválida');
    return realBase;
  }
  function sandboxParts(name) {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || path.win32.isAbsolute(name)) throw new Error('Ruta sandbox inválida');
    const normalized = name.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw new Error('Ruta sandbox inválida');
    return parts;
  }
  // Lee un archivo dentro de `base` (ya resuelto/real) verificando enlaces antes y después de abrir.
  function readEntryB64(base, name) {
    let f;
    try { f = sandboxEntry(base, name); }
    catch (e) { if (e.code === 'ENOENT') throw new Error('Archivo no encontrado'); throw e; }
    if (!f.stat.isFile()) throw new Error('Archivo no encontrado');
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(f.path, fs.constants.O_RDONLY | noFollow);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile()) throw new Error('Archivo no encontrado');
      // Revalidar tras abrir evita aceptar un enlace cambiado entre lstat y open.
      const current = sandboxEntry(base, name);
      if (!current.stat.isFile() || opened.dev !== current.stat.dev || opened.ino !== current.stat.ino) throw new Error('Ruta sandbox modificada durante la lectura');
      if (opened.size > 25e6) throw new Error('Archivo demasiado grande (>25 MB)');
      return fs.readFileSync(fd).toString('base64');
    } finally { fs.closeSync(fd); }
  }
  function sandboxEntry(base, name) {
    const parts = sandboxParts(name);
    const baseStat = fs.lstatSync(base);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) throw new Error('Ruta sandbox inválida');
    const baseReal = fs.realpathSync.native(base);
    if (!sameSandboxPath(baseReal, base)) throw new Error('Ruta sandbox inválida');
    let current = baseReal;
    let stat;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error('Enlace no permitido en sandbox');
      if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Ruta sandbox inválida');
      const real = fs.realpathSync.native(current);
      if (!withinSandbox(real, baseReal) || !sameSandboxPath(real, current)) throw new Error('Ruta sandbox inválida');
      current = real;
    }
    return { path: current, stat };
  }
  function checkPath(p) {
    if (!p || !path.isAbsolute(p)) throw new Error('La ruta debe ser absoluta');
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('La carpeta no existe');
    const r = canon(p);
    if (path.dirname(r) === r) throw new Error('No se permite la raíz de un disco');
    const bad = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, '/etc', '/usr', '/bin', '/proc'].filter(Boolean).map(x => path.resolve(x));
    if (bad.some(b => under(r, b))) throw new Error('No se permiten carpetas del sistema');
    if (strict && !under(r, dataDir) && !roots.some(x => under(r, x)) && !(cantinaDir && under(r, canon(cantinaDir)))) throw new Error('Carpeta fuera de las raíces permitidas del agente de campo');
    return r;
  }

  // ---------- git ----------
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
  // cambios sin commit de la carpeta: [{ st: 'M'|'D'|'??'…, file }]
  const changes = r => (tryGit(r, '-c', 'core.quotepath=false', 'status', '--porcelain') || '').split(/\r?\n/).filter(Boolean).slice(0, 500)
    .map(l => /^\s*(\S+)\s+(.*)$/.exec(l)).map(m => ({ st: m[1], file: m[2].replace(/^.* -> /, '').replace(/^"|"$/g, '') })); // git() recorta el espacio inicial
  const isGit = p => tryGit(p, 'rev-parse', '--is-inside-work-tree') === 'true';
  function exclude(repo, lines) {
    const f = path.resolve(repo, tryGit(repo, 'rev-parse', '--git-common-dir') || '.git', 'info', 'exclude');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const add = lines.filter(l => !cur.split(/\r?\n/).includes(l));
    if (add.length) fs.appendFileSync(f, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
  }
  function commit(cwd, msg) {
    if (!tryGit(cwd, 'status', '--porcelain')) return null;
    git(cwd, 'add', '-A');
    try { git(cwd, 'commit', '-q', '-m', msg); } catch { git(cwd, '-c', 'user.name=Oficina Virtual', '-c', 'user.email=oficina@localhost', 'commit', '-q', '-m', msg); }
    return git(cwd, 'rev-parse', '--short', 'HEAD');
  }
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const sh = (exe, args, timeout = 20000) => new Promise(res => execFile(exe, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 20e6 },
    (err, out, errOut) => res({ err, out: (out || '').trim(), errOut: (errOut || '').trim() })));
  // protobuf-JSON omite los ceros: remainingFraction ausente = cuota agotada
  const lsUserStatus = (port, token) => new Promise(res => {
    const body = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'es' } });
    const r = https.request({ host: '127.0.0.1', port, path: '/exa.language_server_pb.LanguageServerService/GetUserStatus', method: 'POST', rejectUnauthorized: false, timeout: 5000, // certificado autofirmado del propio language_server
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': token, 'Content-Length': Buffer.byteLength(body) } }, s => {
      let d = ''; s.on('data', c => d += c); s.on('end', () => { try { res(s.statusCode === 200 ? JSON.parse(d).userStatus : null); } catch { res(null); } });
    });
    r.on('error', () => res(null)); r.on('timeout', () => r.destroy()); r.end(body);
  });
  const resolveExe = exe => { const e = expand(exe); return e === 'node' ? process.execPath : e; };

  // ---------- operaciones (todas serializables: entran y salen JSON) ----------
  const ops = {
    // Captura de pantalla nativa de Windows en JPEG Base64
    pcScreen: async () => {
      if (process.platform !== 'win32') throw new Error('Control de pantalla solo disponible en Windows');
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
        '\x24b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
        '\x24bmp = New-Object System.Drawing.Bitmap(\x24b.Width, \x24b.Height);',
        '\x24g = [System.Drawing.Graphics]::FromImage(\x24bmp);',
        '\x24g.CopyFromScreen(\x24b.Location, [System.Drawing.Point]::Empty, \x24b.Size);',
        '\x24ms = New-Object System.IO.MemoryStream;',
        '\x24bmp.Save(\x24ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);',
        'Write-Output (\x24b.Width.ToString() + "x" + \x24b.Height.ToString() + "|" + [Convert]::ToBase64String(\x24ms.ToArray()))'
      ].join(' ');
      const r = await sh('powershell', ['-NoProfile', '-Command', ps], 25000);
      if (r.err || !r.out) throw new Error(r.errOut || r.err?.message || 'No se pudo capturar la pantalla');
      const sep = r.out.indexOf('|');
      const dims = sep > 0 ? r.out.slice(0, sep).split('x') : ['1920', '1080'];
      const b64 = sep > 0 ? r.out.slice(sep + 1).trim() : r.out.trim();
      return { width: +dims[0] || 1920, height: +dims[1] || 1080, jpegB64: b64, at: new Date().toISOString() };
    },
    // Clic remoto en coordenadas relativas (rx, ry de 0.0 a 1.0) + devuelve nueva captura
    pcClick: async ({ rx, ry, button = 'left', double = false }) => {
      if (process.platform !== 'win32') throw new Error('Solo disponible en Windows');
      const nx = Math.max(0, Math.min(1, Number(rx) || 0));
      const ny = Math.max(0, Math.min(1, Number(ry) || 0));
      const flags = button === 'right' ? '0x0008, 0x0010' : '0x0002, 0x0004';
      const clicks = double ? 2 : 1;
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '\x24sig = "[DllImport(`"user32.dll`")] public static extern bool SetCursorPos(int X, int Y); [DllImport(`"user32.dll`")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);";',
        '\x24u = Add-Type -MemberDefinition \x24sig -Name "WinMouse" -Namespace "Oficina" -PassThru;',
        '\x24b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
        '\x24x = [int](\x24b.Width * ' + nx.toFixed(4) + ');',
        '\x24y = [int](\x24b.Height * ' + ny.toFixed(4) + ');',
        '\x24u::SetCursorPos(\x24x, \x24y) | Out-Null;',
        'Start-Sleep -Milliseconds 60;',
        'for (\x24i=0; \x24i -lt ' + clicks + '; \x24i++) { \x24f = @(' + flags + '); \x24u::mouse_event(\x24f[0], 0, 0, 0, 0); Start-Sleep -Milliseconds 40; \x24u::mouse_event(\x24f[1], 0, 0, 0, 0); Start-Sleep -Milliseconds 70; }'
      ].join(' ');
      await sh('powershell', ['-NoProfile', '-Command', ps], 15000);
      await new Promise(r => setTimeout(r, 350));
      return ops.pcScreen();
    },
    // Enviar texto o teclas especiales a la ventana activa de Windows + devuelve nueva captura
    pcKey: async ({ text = '', key = '' }) => {
      if (process.platform !== 'win32') throw new Error('Solo disponible en Windows');
      const KEY_MAP = { enter: '{ENTER}', esc: '{ESC}', tab: '{TAB}', backspace: '{BS}', space: ' ', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', altf4: '%{F4}', win: '^{ESC}' };
      const seq = key && KEY_MAP[key] ? KEY_MAP[key] : String(text).replace(/[+^%~(){}[\]]/g, '{\x24&}');
      const b64Seq = Buffer.from(seq, 'utf8').toString('base64');
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '\x24str = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + b64Seq + '"));',
        '[System.Windows.Forms.SendKeys]::SendWait(\x24str);'
      ].join(' ');
      await sh('powershell', ['-NoProfile', '-Command', ps], 15000);
      await new Promise(r => setTimeout(r, 350));
      return ops.pcScreen();
    },
    // Acciones rapidas de 1 toque sobre la PC Windows
    pcQuick: async ({ action, cwd, value = '' }) => {
      const targetDir = cwd ? checkPath(cwd) : (roots[0] || os.homedir());
      if (action === 'vscode') {
        spawn('cmd.exe', ['/c', 'code', targetDir], { cwd: targetDir, windowsHide: true, detached: true, stdio: 'ignore' }).unref();
        return { ok: true, msg: 'VS Code abierto en ' + targetDir };
      }
      if (action === 'explorer') {
        spawn('explorer.exe', [targetDir], { cwd: targetDir, windowsHide: true, detached: true, stdio: 'ignore' }).unref();
        return { ok: true, msg: 'Explorador abierto en ' + targetDir };
      }
      if (action === 'lock') {
        await sh('rundll32.exe', ['user32.dll,LockWorkStation'], 5000);
        return { ok: true, msg: 'Sesion de Windows bloqueada' };
      }
      if (action === 'vol_up' || action === 'vol_down' || action === 'vol_mute') {
        const charCode = action === 'vol_up' ? 175 : action === 'vol_down' ? 174 : 173;
        const ps = '\x24w = New-Object -ComObject WScript.Shell; \x24w.SendKeys([char]' + charCode + ')';
        await sh('powershell', ['-NoProfile', '-Command', ps], 5000);
        return { ok: true, msg: 'Volumen ajustado (' + action + ')' };
      }
      if (action === 'clip_get') {
        const r = await sh('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], 8000);
        return { ok: true, clipboard: r.out || '(Portapapeles vacio)' };
      }
      if (action === 'clip_set') {
        const b64 = Buffer.from(String(value), 'utf8').toString('base64');
        const ps = 'Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + b64 + '")))';
        await sh('powershell', ['-NoProfile', '-Command', ps], 8000);
        return { ok: true, msg: 'Texto copiado al portapapeles de tu PC' };
      }
      if (action === 'open_url') {
        const u = String(value || '').trim();
        if (!/^https?:\/\//i.test(u)) throw new Error('URL invalida');
        spawn('cmd.exe', ['/c', 'start', '', u], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
        return { ok: true, msg: 'URL abierta en el navegador de la PC' };
      }
      throw new Error('Accion rapida desconocida: ' + action);
    },
    // Ejecucion directa de comandos en PowerShell
    pcShell: async ({ cwd, command }) => {
      const targetDir = cwd ? checkPath(cwd) : (roots[0] || os.homedir());
      const cmd = String(command || '').trim();
      if (!cmd) throw new Error('Comando vacio');
      return new Promise(res => {
        const shellExe = process.platform === 'win32' ? 'powershell.exe' : 'sh';
        const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];
        execFile(shellExe, shellArgs, { cwd: targetDir, timeout: 120000, windowsHide: true, encoding: 'utf8', maxBuffer: 10e6 }, (err, out, errOut) => {
          res({
            ok: !err,
            code: err?.code ?? 0,
            cwd: targetDir,
            output: ((out || '') + (errOut ? '\n[STDERR]\n' + errOut : '')).trim() || '(Comando ejecutado sin salida en consola)'
          });
        });
      });
    },
    info: () => ({ hostname: os.hostname(), platform: process.platform, node: process.version, user: os.userInfo().username, roots, strict, runs: [...runs.keys()] }),
    checkFolder: ({ path: p }) => { const r = checkPath(p); return { path: r, is_git: isGit(r) }; },
    listDir: ({ path: p }) => {
      if (!p) return { path: null, parent: null, dirs: roots.map(r => ({ name: r, path: r })) };
      const r = checkPath(p);
      const dirs = fs.readdirSync(r, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !['node_modules', '$RECYCLE.BIN'].includes(d.name))
        .map(d => ({ name: d.name, path: path.join(r, d.name) })).sort((a, b) => a.name.localeCompare(b.name));
      const parent = path.dirname(r);
      return { path: r, is_git: isGit(r), parent: parent !== r && (!strict || roots.some(x => under(parent, x))) ? parent : null, dirs: dirs.slice(0, 500) };
    },
    // prepara la carpeta de trabajo: sandbox, carpeta directa o worktree git por tarea
    workdir: ({ sandbox, cantina, folder, task, exclude: ex = [] }) => {
      if (cantina && cantinaDir) try { fs.mkdirSync(cantinaDir, { recursive: true }); return { cwd: canon(cantinaDir), git: false }; } catch {} // sin ese disco: sandbox del chat
      if (sandbox != null) { const d = sandboxBase(sandbox, true); return { cwd: d, git: false }; }
      const base = checkPath(folder.path);
      const g = isGit(base);
      if (g) exclude(base, ['.oficina/', '.oficina-worktrees/', ...ex]);
      if (g && folder.use_worktrees && task && tryGit(base, 'rev-parse', 'HEAD')) {
        if (task.worktree_path && fs.existsSync(task.worktree_path)) return { cwd: task.worktree_path, git: true, wt: true };
        // carpeta y rama únicas: puede haber restos de otra base de datos u otra oficina en el mismo repo
        let wt = path.join(base, '.oficina-worktrees', 'task-' + task.id), n = 1;
        while (fs.existsSync(wt)) wt = path.join(base, '.oficina-worktrees', `task-${task.id}-${++n}`);
        let branch = task.branch;
        if (!branch) { branch = `oficina/task-${task.id}-${slug(task.title)}`; for (let k = 2; tryGit(base, 'rev-parse', '--verify', branch); k++) branch = `oficina/task-${task.id}-${slug(task.title)}-${k}`; }
        const base_branch = task.base_branch || git(base, 'rev-parse', '--abbrev-ref', 'HEAD');
        if (tryGit(base, 'rev-parse', '--verify', branch)) git(base, 'worktree', 'add', wt, branch);
        else git(base, 'worktree', 'add', '-b', branch, wt);
        return { cwd: wt, git: true, wt: true, branch, worktree_path: wt, base_branch };
      }
      return { cwd: base, git: g, lock: true };
    },
    checkpoint: ({ cwd, message }) => { try { return commit(cwd, message); } catch { return null; } },
    gitInfo: ({ cwd, base }) => {
      if (!cwd || !fs.existsSync(cwd) || !isGit(cwd)) return { git: false };
      return { git: true, diffStat: base ? tryGit(cwd, 'diff', '--stat', `${base}...HEAD`) : tryGit(cwd, 'diff', '--stat'), log: base ? tryGit(cwd, 'log', '--oneline', `${base}..HEAD`) : null };
    },
    diff: ({ cwd, base }) => {
      if (!cwd || !fs.existsSync(cwd) || !isGit(cwd)) return { diff: '', log: '' };
      return { diff: (base ? tryGit(cwd, 'diff', `${base}...HEAD`) : tryGit(cwd, 'diff')) || '', log: base ? tryGit(cwd, 'log', '--oneline', `${base}..HEAD`) || '' : '' };
    },
    readText: ({ cwd, rel, max = 20000 }) => { const f = path.join(cwd, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-max) : null; },
    merge: ({ repo, branch, base_branch, message, worktree_path }) => {
      const r = checkPath(repo);
      const cur = git(r, 'rev-parse', '--abbrev-ref', 'HEAD');
      if (cur !== base_branch) return { error: `La carpeta base está en la rama ${cur}, no en ${base_branch}` };
      // git se negaría a fusionar para no pisar esos cambios: no es un conflicto entre ramas, falta un commit
      const dirty = new Set(changes(r).map(c => c.file));
      const hit = (tryGit(r, 'diff', '--name-only', `${base_branch}...${branch}`) || '').split(/\r?\n/).filter(f => dirty.has(f));
      if (hit.length) return { error: `La carpeta base tiene cambios sin commit en ${hit.join(', ')}. Haz commit (Repositorios → 🔍) y vuelve a fusionar.` };
      try { git(r, 'merge', '--no-ff', '-m', message, branch); }
      catch (e) { tryGit(r, 'merge', '--abort'); return { conflict: String(e.stderr || e.message) }; }
      if (worktree_path) tryGit(r, 'worktree', 'remove', '--force', worktree_path);
      tryGit(r, 'branch', '-d', branch);
      return { ok: true };
    },
    // estado del repo base + ramas de tareas: commits, archivos y si chocan con la base (merge-tree no toca la carpeta)
    repoStatus: ({ repo, fetch, branches = [] }) => {
      const r = checkPath(repo);
      if (fetch) tryGit(r, 'fetch', '--quiet');
      const head = git(r, 'rev-parse', '--abbrev-ref', 'HEAD');
      const up = tryGit(r, 'rev-parse', '--abbrev-ref', '@{u}');
      const [behind, ahead] = up ? (tryGit(r, 'rev-list', '--left-right', '--count', `${up}...HEAD`) || '0 0').split(/\s+/).map(Number) : [null, null];
      const lines = s => (s || '').split(/\r?\n/).filter(Boolean);
      return {
        head, upstream: up, ahead, behind, changes: changes(r), log: lines(tryGit(r, 'log', '--oneline', '-5')),
        deploy: deployCfg(r) ? { target: deployCfg(r).target || 'servidor', cmd: deployCfg(r).cmd } : null,
        branches: branches.map(b => {
          const base = b.base || head;
          if (!tryGit(r, 'rev-parse', '--verify', '--quiet', b.branch)) return { ...b, missing: true };
          const [bBehind, bAhead] = (tryGit(r, 'rev-list', '--left-right', '--count', `${base}...${b.branch}`) || '0 0').split(/\s+/).map(Number);
          let conflicts = [];
          try { execFileSync('git', ['-C', r, 'merge-tree', '--write-tree', '--name-only', '--no-messages', base, b.branch], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
          catch (e) { if (e.status === 1) conflicts = lines(String(e.stdout)).slice(1); }
          return { ...b, ahead: bAhead, behind: bBehind, files: lines(tryGit(r, 'diff', '--name-only', `${base}...${b.branch}`)), conflicts };
        }),
      };
    },
    // commit en la rama base solo de los archivos elegidos (el ruido de herramientas se queda fuera)
    commitFiles: ({ repo, files, message }) => {
      const r = checkPath(repo), known = new Set(changes(r).map(c => c.file));
      if (!files?.length || files.some(f => !known.has(f))) return { error: 'Archivos inválidos: vuelve a analizar' };
      git(r, 'add', '-A', '--', ...files);
      try { git(r, 'commit', '-q', '-m', message, '--', ...files); } catch { git(r, '-c', 'user.name=Oficina Virtual', '-c', 'user.email=oficina@localhost', 'commit', '-q', '-m', message, '--', ...files); }
      return { ok: true, head: git(r, 'log', '--oneline', '-1') };
    },
    // trae lo remoto (merge, nunca rebase ni force) y sube la rama base: nada de lo ya publicado se pierde
    push: ({ repo }) => {
      const r = checkPath(repo);
      if ((tryGit(r, 'status', '--porcelain') || '').trim()) return { error: 'La carpeta base tiene cambios sin commit' };
      if (tryGit(r, 'rev-parse', '--abbrev-ref', '@{u}')) {
        try { git(r, 'pull', '--no-rebase', '--no-edit'); }
        catch (e) { tryGit(r, 'merge', '--abort'); return { conflict: String(e.stderr || e.message) }; }
        git(r, 'push');
      } else git(r, 'push', '-u', 'origin', 'HEAD');
      return { ok: true, head: git(r, 'log', '--oneline', '-1') };
    },
    // despliega SIEMPRE desde la carpeta base (nunca desde un worktree): el comando vive en worker.json de esta máquina
    deploy: ({ repo }) => new Promise(res => {
      const r = checkPath(repo), cmd = deployCfg(r)?.cmd;
      if (!cmd) return res({ error: 'Sin comando de despliegue para esta carpeta ("deploy" en worker.json)' });
      exec(cmd, { cwd: r, timeout: 20 * 60000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
        (e, out, err) => res({ ok: !e, code: e?.code ?? 0, output: (String(out) + String(err)).slice(-8000) }));
    }),
    removeWorktree: ({ repo, path: p }) => { const r = checkPath(repo); if (!under(path.resolve(p), path.join(r, '.oficina-worktrees'))) throw new Error('Ruta inválida'); tryGit(r, 'worktree', 'remove', '--force', p); tryGit(r, 'worktree', 'prune'); return { ok: true }; },
    folderInfo: ({ path: p }) => {
      const exists = fs.existsSync(p);
      const g = exists && isGit(p);
      let free = null; try { const s = fs.statfsSync(p); free = s.bavail * s.bsize; } catch {}
      const worktrees = g ? (tryGit(p, 'worktree', 'list', '--porcelain') || '').split(/\r?\n/).filter(l => l.startsWith('worktree ') && l.includes('.oficina-worktrees')).map(l => path.normalize(l.slice(9))) : [];
      return { exists, is_git: g, branch: g ? tryGit(p, 'rev-parse', '--abbrev-ref', 'HEAD') : null, dirty: g ? (tryGit(p, 'status', '--porcelain') || '').split(/\r?\n/).filter(Boolean).length : null, worktrees, free_bytes: free };
    },
    listFiles: ({ sandbox }) => {
      const base = sandboxBase(sandbox);
      if (!base) return [];
      const walk = (prefix = '') => {
        const before = prefix ? sandboxEntry(base, prefix) : { path: base, stat: fs.lstatSync(base) };
        if (before.stat.isSymbolicLink() || !before.stat.isDirectory()) throw new Error('Ruta sandbox inválida');
        const entries = fs.readdirSync(before.path, { withFileTypes: true });
        const after = prefix ? sandboxEntry(base, prefix) : { path: base, stat: fs.lstatSync(base) };
        if (after.stat.isSymbolicLink() || !after.stat.isDirectory() || before.stat.dev !== after.stat.dev || before.stat.ino !== after.stat.ino)
          throw new Error('Ruta sandbox modificada durante el listado');
        return entries.flatMap(e => {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          let entry;
          try { entry = sandboxEntry(base, rel); } catch (err) {
            if (err.code === 'ENOENT' || /Enlace no permitido/.test(err.message)) return [];
            throw err;
          }
          if (entry.stat.isDirectory()) return walk(rel);
          return entry.stat.isFile() ? [{ name: rel, size: entry.stat.size }] : [];
        });
      };
      return walk().filter(f => !f.name.startsWith('.oficina/adjuntos/'));
    },
    readFileB64: ({ sandbox, name }) => {
      const base = sandboxBase(sandbox);
      if (!base) throw new Error('Archivo no encontrado');
      return readEntryB64(base, name);
    },
    // archivos nuevos que el agente dejó en una tarea con carpeta git: sin commitear (untracked) o agregados desde base_branch
    listNewFiles: ({ cwd, base }) => {
      if (!cwd || !fs.existsSync(cwd) || !isGit(cwd)) return [];
      let root;
      try { root = fs.realpathSync.native(cwd); } catch { return []; }
      const untracked = (tryGit(cwd, 'status', '--porcelain', '-uall') || '').split(/\r?\n/)
        .filter(l => l.startsWith('?? ')).map(l => l.slice(3));
      const added = base ? (tryGit(cwd, 'diff', '--name-status', `${base}...HEAD`) || '').split(/\r?\n/)
        .filter(l => l.startsWith('A\t')).map(l => l.slice(2)) : [];
      const names = [...new Set([...untracked, ...added])];
      return names.flatMap(rel => {
        try { const e = sandboxEntry(root, rel); return e.stat.isFile() ? [{ name: rel, size: e.stat.size }] : []; }
        catch { return []; }
      });
    },
    readNewFile: ({ cwd, name }) => {
      if (!cwd || !fs.existsSync(cwd)) throw new Error('Archivo no encontrado');
      let root;
      try { root = fs.realpathSync.native(cwd); } catch { throw new Error('Archivo no encontrado'); }
      return readEntryB64(root, name);
    },
    // entregables que el agente dejó en <cwd>/.oficina/entregables; `known` = sha256 ya recibidos (no se reenvían)
    // ponytail: solo el primer nivel de la carpeta, subcarpetas se ignoran
    takeOutputs: ({ cwd, known = [] }) => {
      let root;
      try { root = fs.realpathSync.native(cwd); } catch { return []; }
      const dir = path.join(root, '.oficina', 'entregables');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap(n => {
        try {
          const b64 = readEntryB64(root, '.oficina/entregables/' + n);
          const sha = crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 16);
          return known.includes(sha) ? [] : [{ name: n, sha, b64 }];
        } catch { return []; } // directorios, enlaces o >25 MB
      });
    },
    // adjuntos: files = [{id, name, size, url?|src?}] → .oficina/adjuntos/<name>; fetcher lo aporta quien llama
    probe: async ({ exe, pre_args = [] }) => {
      const go = async () => {
        const r = await sh(resolveExe(exe), [...pre_args.map(expand), '--version']);
        const found = !(r.err && (r.err.code === 'ENOENT' || /not found|no se encuentra|Cannot find module/i.test(r.errOut)));
        return { found, version: found ? (r.out || r.errOut).split(/\r?\n/)[0].slice(0, 80) : null };
      };
      return isCC(pre_args) ? yearly('probe', go, v => v.found && v.version) : go();
    },
    processes: async ({ pids }) => {
      if (!pids?.length || process.platform !== 'win32') return {};
      const r = await sh('tasklist', ['/V', '/FO', 'CSV', '/NH']);
      const m = {};
      for (const l of r.out.split(/\r?\n/)) { const c = l.match(/"([^"]*)"/g)?.map(x => x.slice(1, -1)); if (c && pids.includes(+c[1])) m[c[1]] = { mem: c[4], cpu_time: c[7] }; }
      return m;
    },
    detectModels: async ({ adapter, exe, pre_args = [] }) => {
      const run = async a => (await sh(resolveExe(exe), [...pre_args.map(expand), ...a], 60000)).out;
      if (adapter === 'codex') {
        try {
          const p = path.join(process.env.CODEX_HOME || os.homedir(), '.codex', 'models_cache.json');
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          const list = (j.models || j.data || []).filter(m => m.visibility !== 'hide').map(m => m.slug || m.id);
          if (list.length) return list;
        } catch {}
        try {
          const out = await run(['debug', 'models']);
          const j = JSON.parse(out);
          return (j.models || j.data || []).filter(m => m.visibility !== 'hide').map(m => m.slug || m.id);
        } catch { return []; }
      }
      if (adapter === 'agy') return (await run(['models'])).split(/\r?\n/).map(l => l.split('\t')[0].trim()).filter(l => /^[\w.-]+$/.test(l));
      if (adapter === 'commandcode') return yearly('models', async () => {
        try {
          const out = await run(['--list-models']);
          const ignore = new Set(['Available', 'Open', 'Stealth', 'Anthropic', 'OpenAI', 'Google', 'Sakana', 'Meta', 'xAI', 'Pass', 'Docs:', 'Decision']);
          const list = [];
          for (const raw of out.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('Pass') || line.startsWith('Docs:') || line.startsWith('cmdc') || line.startsWith('Available')) continue;
            const token = line.split(/\s+/)[0];
            if (ignore.has(token) || token.endsWith(':')) continue;
            if (/^[\w.-]+(\/[\w.-]+)?$/.test(token) && line.includes('  ')) list.push(token);
          }
          if (list.length) return list;
        } catch {}
        return (await run(['--list-models'])).split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(x => /^[\w.-]+\/[\w.-]+$/.test(x));
      }, l => Array.isArray(l) && l.length);
      if (adapter === 'claude') return CLAUDE_MODELS;
      return [];
    },
    detectEfforts: async ({ adapter, exe, pre_args = [] }) => {
      const run = async a => (await sh(resolveExe(exe), [...pre_args.map(expand), ...a], 60000)).out;
      if (adapter === 'codex') {
        try {
          const p = path.join(process.env.CODEX_HOME || os.homedir(), '.codex', 'models_cache.json');
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          const set = new Set();
          for (const m of (j.models || j.data || [])) {
            if (m.visibility === 'hide') continue;
            for (const r of (m.supported_reasoning_levels || [])) if (r.effort) set.add(r.effort);
          }
          if (set.size) return [...set];
        } catch {}
        try {
          const out = await run(['debug', 'models']);
          const j = JSON.parse(out);
          const set = new Set();
          for (const m of (j.models || j.data || [])) {
            if (m.visibility === 'hide') continue;
            for (const r of (m.supported_reasoning_levels || [])) if (r.effort) set.add(r.effort);
          }
          if (set.size) return [...set];
        } catch {}
        return ['low', 'medium', 'high', 'xhigh', 'max'];
      }
      if (adapter === 'claude') return ['low', 'medium', 'high', 'xhigh', 'max'];
      if (adapter === 'agy') return ['low', 'medium', 'high', 'max'];
      if (adapter === 'commandcode') return ['low', 'medium', 'high', 'max'];
      return [];
    },
    detectModelEfforts: async ({ adapter, exe, pre_args = [] }) => {
      const run = async a => (await sh(resolveExe(exe), [...pre_args.map(expand), ...a], 60000)).out;
      const res = {};
      if (adapter === 'codex') {
        let list = [];
        try {
          const p = path.join(process.env.CODEX_HOME || os.homedir(), '.codex', 'models_cache.json');
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          list = (j.models || j.data || []).filter(m => m.visibility !== 'hide');
        } catch {
          try {
            const out = await run(['debug', 'models']);
            const j = JSON.parse(out);
            list = (j.models || j.data || []).filter(m => m.visibility !== 'hide');
          } catch {}
        }
        for (const m of list) {
          const id = m.slug || m.id;
          const effs = (m.supported_reasoning_levels || []).map(r => r.effort).filter(Boolean);
          if (id) res[id] = effs.length ? effs : ['low', 'medium', 'high', 'xhigh', 'max'];
        }
        return res;
      }
      if (adapter === 'claude') {
        for (const m of CLAUDE_MODELS) res[m] = ['low', 'medium', 'high', 'xhigh', 'max'];
        return res;
      }
      if (adapter === 'agy') {
        let ms = [];
        try {
          ms = (await run(['models'])).split(/\r?\n/).map(l => l.split('\t')[0].trim()).filter(l => /^[\w.-]+$/.test(l));
        } catch {}
        if (!ms.length) ms = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-3.7-flash-high', 'gemini-3.7-flash-medium', 'gemini-3.7-flash-low', 'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low', 'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'];
        for (const m of ms) {
          if (m.endsWith('-high')) res[m] = ['high'];
          else if (m.endsWith('-medium')) res[m] = ['medium'];
          else if (m.endsWith('-low')) res[m] = ['low'];
          else res[m] = ['low', 'medium', 'high', 'max'];
        }
        return res;
      }
      if (adapter === 'commandcode') {
        const ms = await ops.detectModels({ adapter, exe, pre_args });
        for (const m of ms) res[m] = ['low', 'medium', 'high', 'max'];
        return res;
      }
      return res;
    },
    // `codex exec --json` no informa límites; el rollout de la sesión (~/.codex/sessions/…/rollout-*-<thread>.jsonl) sí:
    // cada token_count trae rate_limits { primary: 5 h, secondary: semanal }. Devuelve el último.
    codexLimits: ({ thread_id }) => {
      if (!/^[\w-]{8,}$/.test(thread_id || '')) return null;
      const dir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
      if (!fs.existsSync(dir)) return null;
      // ponytail: recorre todo sessions/ (cientos de archivos); indexar por fecha si crece a decenas de miles
      const f = fs.readdirSync(dir, { recursive: true }).map(String).find(p => p.endsWith(`-${thread_id}.jsonl`));
      if (!f) return null;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        try { const rl = JSON.parse(lines[i]).payload?.rate_limits; if (rl) return rl; } catch {}
      }
      return null;
    },
    // Antigravity: agy no informa su cuota; la app de escritorio sí, vía su language_server local (GetUserStatus).
    // El token CSRF se toma de la línea de comandos del proceso y solo se usa contra 127.0.0.1: no se guarda ni sale de la máquina.
    agyQuota: async () => {
      if (process.platform !== 'win32') return null; // ponytail: solo Windows (Get-CimInstance); en mac/linux sería `ps -o args`
      const ps = await sh('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], 15000);
      const ns = await sh('netstat', ['-ano', '-p', 'tcp'], 15000);
      for (const l of ps.out.split(/\r?\n/)) {
        const [pid, cl = ''] = l.split('\t'), token = cl.match(/--csrf_token[= ](\S+)/)?.[1];
        if (!token || !/antigravity/i.test(cl)) continue;
        const ports = new Set([...ns.out.matchAll(new RegExp(`127\\.0\\.0\\.1:(\\d+)\\s+\\S+\\s+LISTENING\\s+${pid}\\b`, 'g'))].map(m => m[1]));
        for (const port of ports) {
          const u = await lsUserStatus(port, token);
          if (u) return { plan: u.planStatus?.planInfo?.planName || null,
            models: (u.cascadeModelConfigData?.clientModelConfigs || []).filter(m => m.quotaInfo).map(m => ({ label: m.label, remaining: m.quotaInfo.remainingFraction ?? 0, resets: m.quotaInfo.resetTime || null })) };
        }
      }
      return null;
    },
    toast: ({ title, body, url }) => {
      if (process.platform !== 'win32') return false;
      const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
      const x = `<toast activationType="protocol" launch="${xml(url || '')}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body).slice(0, 300)}</text></binding></visual></toast>`;
      const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$d = New-Object Windows.Data.Xml.Dom.XmlDocument; $d.LoadXml([Console]::In.ReadToEnd())
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($d))`;
      const p = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      p.on('error', () => {}); p.stdin.end(x);
      return true;
    },
    // ---------- procesos de agentes ----------
    writeRun: ({ runId, data }) => { const p = runs.get(runId); if (!p || p.stdin.destroyed) return false; p.stdin.write(data); return true; },
    endRun: ({ runId }) => { runs.get(runId)?.stdin.end(); return true; },
    killRun: ({ runId }) => {
      const p = runs.get(runId); if (!p?.pid) return false;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      else p.kill('SIGKILL');
      return true;
    },
    findMarcacion: () => {
      if (process.env.OFICINA_MARCACION_PATH && fs.existsSync(process.env.OFICINA_MARCACION_PATH))
        return { path: canon(process.env.OFICINA_MARCACION_PATH), dir: path.dirname(canon(process.env.OFICINA_MARCACION_PATH)) };
      const home = os.homedir();
      const candDirs = [
        path.join(home, 'hmr0', 'marcacion-sicape'),
        path.join(home, 'marcacion-sicape'),
        path.resolve('marcacion-sicape'),
        path.resolve('..', 'marcacion-sicape'),
        path.resolve('..', '..', 'marcacion-sicape'),
        ...roots.map(r => path.join(r, 'marcacion-sicape')),
        ...roots.map(r => path.join(r, 'hmr0', 'marcacion-sicape')),
      ];
      for (const d of candDirs) {
        for (const name of ['marcar-ahora.bat', 'marcar_ahora.bat', 'marcar-ahora.sh', 'marcar_ahora.sh']) {
          const full = path.join(d, name);
          if (fs.existsSync(full)) return { path: canon(full), dir: canon(d) };
        }
      }
      for (const base of new Set([home, ...roots])) {
        try {
          for (const e of fs.readdirSync(base, { withFileTypes: true })) {
            if (e.isDirectory() && !e.name.startsWith('.')) {
              const sub = path.join(base, e.name, 'marcacion-sicape');
              for (const name of ['marcar-ahora.bat', 'marcar_ahora.bat']) {
                const full = path.join(sub, name);
                if (fs.existsSync(full)) return { path: canon(full), dir: canon(sub) };
              }
            }
          }
        } catch {}
      }
      return { path: null };
    },
  };

  // Escribe adjuntos en <cwd>/.oficina/adjuntos. get(file) → Buffer (lo da el servidor o el worker vía HTTP)
  ops.putFiles = async ({ cwd, files }, get) => {
    const dir = path.join(cwd, '.oficina', 'adjuntos');
    fs.mkdirSync(dir, { recursive: true });
    const refs = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const bytes = Buffer.from(await get(f));
      const rawName = String(f.name ?? 'adjunto').replace(/\\/g, '/').split('/').pop();
      let name = rawName.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '_');
      if (!name || name === '.' || name === '..') name = 'adjunto';
      const ext = path.posix.extname(name).slice(0, 48);
      const stem = ext ? name.slice(0, -path.posix.extname(name).length) : name;
      const identity = f.id == null || String(f.id) === ''
        ? crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20)
        : String(f.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
      const suffix = `__${identity || crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20)}`;
      const maxStem = Math.max(1, 180 - suffix.length - ext.length);
      name = `${stem.slice(0, maxStem)}${suffix}${ext}`;
      const dest = path.join(dir, name);
      fs.writeFileSync(dest, bytes);
      refs.push('.oficina/adjuntos/' + name);
    }
    return refs;
  };

  // Servicio de IA del servidor interno (deploy/ia): la llamada sale de esta máquina, que sí ve la red interna
  async function ia({ url, key }, route, body, ms, { type = 'application/octet-stream', raw = false } = {}) {
    const r = await fetch(String(url).replace(/\/$/, '') + route, { method: body == null ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': type }, body, signal: AbortSignal.timeout(ms) });
    if (raw && r.ok) return Buffer.from(await r.arrayBuffer());
    let j = null; try { j = JSON.parse(await r.text()); } catch {} // /convert antepone espacios mientras trabaja: JSON.parse los admite
    if (!r.ok || !j || j.error) throw new Error(j?.error || j?.detail || `servicio de IA: HTTP ${r.status}`);
    return j;
  }
  ops.transcribe = async ({ ia: cfg, audio }) => (await ia(cfg, '/transcribe', Buffer.from(audio, 'base64'), 120000)).text;
  ops.voices = ({ ia: cfg }) => ia(cfg, '/voices', null, 15000);
  // texto → voz (WAV en base64); la primera vez que se usa una voz el servicio descarga su modelo
  ops.speak = async ({ ia: cfg, text, voice, speed }) => (await ia(cfg, '/speak', JSON.stringify({ text, voice, speed }), 180000, { type: 'application/json', raw: true })).toString('base64');
  // adjuntos PDF/Office → <adjunto>.md al lado (texto limpio para el agente). Un resultado por ref: null si no aplica
  ops.convertDocs = async ({ ia: cfg, cwd, refs }) => {
    const out = [];
    for (const ref of refs) {
      if (!/^\.oficina\/adjuntos\/[^/\\]+\.(pdf|docx|xlsx|xls|pptx|html?)$/i.test(ref)) { out.push(null); continue; }
      try {
        const j = await ia(cfg, '/convert?name=' + encodeURIComponent(path.basename(ref)), fs.readFileSync(path.join(cwd, ref)), 1800000);
        fs.writeFileSync(path.join(cwd, ref + '.md'), j.md);
        out.push({ md: ref + '.md', pages: j.pages, ocr: j.ocr });
      } catch (e) { out.push({ error: e.message }); }
    }
    return out;
  };

  // Lanza un agente. onEvent({t:'out',line}|{t:'err',text}|{t:'exit',code,error})
  function spawnRun({ runId, exe, args = [], cwd, env = {}, stdin, keepOpen }, onEvent) {
    let e = resolveExe(exe), a = (args || []).map(expand);
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(e)) {
      a = ['/c', e, ...a];
      e = process.env.ComSpec || 'cmd.exe';
    }
    if (strict) {
      const base = path.basename(e).toLowerCase().replace(/\.(exe|cmd)$/, '');
      const ccEntry = e === process.execPath && /command-code[\\/]dist[\\/]index\.mjs$/i.test(a[0] || '');
      const isMarcacion = (base === 'cmd' || /marcar[-_]ahora/i.test(base)) && (a.some(x => /marcar[-_]ahora/i.test(x)) || /marcar[-_]ahora/i.test(e));
      if (!(['claude', 'codex', 'agy'].includes(base) || ccEntry || isMarcacion || process.env.OFICINA_WORKER_ALLOW_ANY)) throw new Error(`Ejecutable no permitido en el agente de campo: ${exe}`);
      if (isMarcacion) {
        try { checkPath(cwd); } catch (err) {
          if (!fs.existsSync(cwd) || (!fs.existsSync(path.join(cwd, 'marcar_ahora.bat')) && !fs.existsSync(path.join(cwd, 'marcar-ahora.bat')))) throw err;
        }
      } else {
        checkPath(cwd);
      }
    }
    const p = spawn(e, a, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    runs.set(runId, p);
    let buf = '', errored = null;
    p.on('error', err => { errored = `No se pudo iniciar ${exe}: ${err.message}`; });
    if (stdin != null) { p.stdin.write(stdin); if (!keepOpen) p.stdin.end(); } else p.stdin.end();
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line.trim()) onEvent({ t: 'out', line }); } });
    p.stderr.on('data', d => onEvent({ t: 'err', text: String(d) }));
    let done = false;
    const fin = code => { if (done) return; done = true; if (buf.trim()) onEvent({ t: 'out', line: buf.trim() }); runs.delete(runId); onEvent({ t: 'exit', code, error: errored }); };
    p.on('close', fin);
    // ponytail: si un proceso hijo huérfano (hooks/plugins del CLI) hereda stdout, 'close' nunca llega: tras salir, 3 s de gracia y cerramos
    p.on('exit', code => setTimeout(() => { if (!done) { p.stdout.destroy(); p.stderr.destroy(); fin(code); } }, 3000));
    return { pid: p.pid ?? null };
  }

  return { ops, spawnRun, canon, runs };
}

module.exports = { create, CLAUDE_MODELS };
