// Operaciones que se ejecutan EN LA MÁQUINA donde viven los archivos (esta PC):
// git, carpetas, procesos de agentes, versiones. Las usa el servidor en modo local
// y el agente de campo (worker.js) cuando la oficina corre en el VPS.
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// cfg: { dataDir, strict, roots[] } — strict = agente de campo: solo CLIs conocidos y rutas bajo roots
function create(cfg) {
  const dataDir = cfg.dataDir;
  const strict = !!cfg.strict;
  const roots = (cfg.roots?.length ? cfg.roots : [os.homedir()]).map(r => canon(r));
  const runs = new Map(); // runId → proc

  // ---------- rutas ----------
  function canon(p) { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } }
  const expand = s => String(s).replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
  const under = (p, r) => p.toLowerCase() === r.toLowerCase() || p.toLowerCase().startsWith(r.toLowerCase().replace(/[\\/]$/, '') + path.sep);
  function checkPath(p) {
    if (!p || !path.isAbsolute(p)) throw new Error('La ruta debe ser absoluta');
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('La carpeta no existe');
    const r = canon(p);
    if (path.dirname(r) === r) throw new Error('No se permite la raíz de un disco');
    const bad = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, '/etc', '/usr', '/bin', '/proc'].filter(Boolean).map(x => path.resolve(x));
    if (bad.some(b => under(r, b))) throw new Error('No se permiten carpetas del sistema');
    if (strict && !under(r, dataDir) && !roots.some(x => under(r, x))) throw new Error('Carpeta fuera de las raíces permitidas del agente de campo');
    return r;
  }

  // ---------- git ----------
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
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
  const resolveExe = exe => { const e = expand(exe); return e === 'node' ? process.execPath : e; };

  // ---------- operaciones (todas serializables: entran y salen JSON) ----------
  const ops = {
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
    workdir: ({ sandbox, folder, task, exclude: ex = [] }) => {
      if (sandbox) { const d = path.join(dataDir, 'sandbox', sandbox); fs.mkdirSync(d, { recursive: true }); return { cwd: d, git: false }; }
      const base = checkPath(folder.path);
      const g = isGit(base);
      if (g) exclude(base, ['.oficina/', '.oficina-worktrees/', ...ex]);
      if (g && folder.use_worktrees && task && tryGit(base, 'rev-parse', 'HEAD')) {
        if (task.worktree_path && fs.existsSync(task.worktree_path)) return { cwd: task.worktree_path, git: true, wt: true };
        const branch = task.branch || `oficina/task-${task.id}-${slug(task.title)}`;
        const wt = path.join(base, '.oficina-worktrees', 'task-' + task.id);
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
      try { git(r, 'merge', '--no-ff', '-m', message, branch); }
      catch (e) { tryGit(r, 'merge', '--abort'); return { conflict: String(e.stderr || e.message) }; }
      if (worktree_path) tryGit(r, 'worktree', 'remove', '--force', worktree_path);
      tryGit(r, 'branch', '-d', branch);
      return { ok: true };
    },
    removeWorktree: ({ repo, path: p }) => { const r = checkPath(repo); if (!under(path.resolve(p), path.join(r, '.oficina-worktrees'))) throw new Error('Ruta inválida'); tryGit(r, 'worktree', 'remove', '--force', p); tryGit(r, 'worktree', 'prune'); return { ok: true }; },
    folderInfo: ({ path: p }) => {
      const exists = fs.existsSync(p);
      const g = exists && isGit(p);
      let free = null; try { const s = fs.statfsSync(p); free = s.bavail * s.bsize; } catch {}
      const worktrees = g ? (tryGit(p, 'worktree', 'list', '--porcelain') || '').split(/\r?\n/).filter(l => l.startsWith('worktree ') && l.includes('.oficina-worktrees')).map(l => path.normalize(l.slice(9))) : [];
      return { exists, is_git: g, branch: g ? tryGit(p, 'rev-parse', '--abbrev-ref', 'HEAD') : null, dirty: g ? (tryGit(p, 'status', '--porcelain') || '').split(/\r?\n/).filter(Boolean).length : null, worktrees, free_bytes: free };
    },
    listFiles: ({ sandbox }) => {
      const base = path.join(dataDir, 'sandbox', sandbox);
      const walk = d => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [{ name: path.relative(base, path.join(d, e.name)).replace(/\\/g, '/'), size: fs.statSync(path.join(d, e.name)).size }]);
      return walk(base).filter(f => !f.name.startsWith('.oficina/adjuntos/'));
    },
    readFileB64: ({ sandbox, name }) => {
      const base = path.join(dataDir, 'sandbox', sandbox);
      const f = path.resolve(base, name);
      if (!f.startsWith(base + path.sep) || !fs.existsSync(f)) throw new Error('Archivo no encontrado');
      if (fs.statSync(f).size > 25e6) throw new Error('Archivo demasiado grande (>25 MB)');
      return fs.readFileSync(f).toString('base64');
    },
    // adjuntos: files = [{id, name, size, url?|src?}] → .oficina/adjuntos/<name>; fetcher lo aporta quien llama
    probe: async ({ exe, pre_args = [] }) => {
      const r = await sh(resolveExe(exe), [...pre_args.map(expand), '--version']);
      const found = !(r.err && (r.err.code === 'ENOENT' || /not found|no se encuentra|Cannot find module/i.test(r.errOut)));
      return { found, version: found ? (r.out || r.errOut).split(/\r?\n/)[0].slice(0, 80) : null };
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
      if (adapter === 'codex') { try { const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8')); return (j.models || j.data || []).filter(m => m.visibility !== 'hide').map(m => m.slug || m.id); } catch { return []; } }
      if (adapter === 'agy') return (await run(['models'])).split(/\r?\n/).map(l => l.split('\t')[0].trim()).filter(l => /^[\w.-]+$/.test(l));
      if (adapter === 'commandcode') return (await run(['--list-models'])).split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(x => /^[\w.-]+\/[\w.-]+$/.test(x));
      if (adapter === 'claude') return ['sonnet', 'opus', 'haiku', 'fable', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'];
      return [];
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
  };

  // Escribe adjuntos en <cwd>/.oficina/adjuntos. get(file) → Buffer (lo da el servidor o el worker vía HTTP)
  ops.putFiles = async ({ cwd, files }, get) => {
    const dir = path.join(cwd, '.oficina', 'adjuntos');
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const f of files) {
      const name = path.basename(f.name).replace(/[<>:"|?*\x00-\x1f]/g, '_');
      const dest = path.join(dir, name);
      if (!(fs.existsSync(dest) && fs.statSync(dest).size === f.size)) fs.writeFileSync(dest, await get(f));
      out.push('.oficina/adjuntos/' + name);
    }
    return out;
  };

  // Lanza un agente. onEvent({t:'out',line}|{t:'err',text}|{t:'exit',code,error})
  function spawnRun({ runId, exe, args, cwd, env = {}, stdin, keepOpen }, onEvent) {
    const e = resolveExe(exe), a = args.map(expand);
    if (strict) {
      const base = path.basename(e).toLowerCase().replace(/\.(exe|cmd)$/, '');
      const ccEntry = e === process.execPath && /command-code[\\/]dist[\\/]index\.mjs$/i.test(a[0] || '');
      if (!(['claude', 'codex', 'agy'].includes(base) || ccEntry || process.env.OFICINA_WORKER_ALLOW_ANY)) throw new Error(`Ejecutable no permitido en el agente de campo: ${exe}`);
      checkPath(cwd);
    }
    const p = spawn(e, a, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    runs.set(runId, p);
    let buf = '', errored = null;
    p.on('error', err => { errored = `No se pudo iniciar ${exe}: ${err.message}`; });
    if (stdin != null) { p.stdin.write(stdin); if (!keepOpen) p.stdin.end(); } else p.stdin.end();
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line.trim()) onEvent({ t: 'out', line }); } });
    p.stderr.on('data', d => onEvent({ t: 'err', text: String(d) }));
    p.on('close', code => { if (buf.trim()) onEvent({ t: 'out', line: buf.trim() }); runs.delete(runId); onEvent({ t: 'exit', code, error: errored }); });
    return { pid: p.pid ?? null };
  }

  return { ops, spawnRun, canon, runs };
}

module.exports = { create };
