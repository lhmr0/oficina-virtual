// Sincroniza modelos y esfuerzos de los 4 agentes (Claude, Codex, Antigravity, CommandCode) en SQLite.
// Cero dependencias npm: usa node:sqlite, node:child_process, node:fs, node:path.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { create: createHostOps } = require('./hostops');

function resolveDbPath(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const candidates = [
    process.env.OFICINA_DATA && path.join(process.env.OFICINA_DATA, 'oficina.db'),
    path.join(__dirname, 'data', 'oficina.db'),
    path.join(__dirname, '..', 'data', 'oficina.db'),
    path.join(__dirname, '..', '..', 'data', 'oficina.db'),
    path.join(process.cwd(), 'data', 'oficina.db'),
    path.join(process.cwd(), '..', 'data', 'oficina.db'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[1] || candidates[0]; // fallback a data/oficina.db
}

async function collectAgentData() {
  const H = createHostOps({ dataDir: process.env.OFICINA_DATA || path.join(__dirname, 'data'), strict: false });
  const ccEntry = '%APPDATA%/npm/node_modules/command-code/dist/index.mjs';

  const specs = [
    { key: 'claude', name: 'Claude', adapter: 'claude', exe: 'claude', pre_args: [], fallbackModel: 'sonnet' },
    { key: 'codex', name: 'Codex', adapter: 'codex', exe: 'codex', pre_args: [], fallbackModel: 'gpt-6-luna' },
    { key: 'antigravity', name: 'Antigravity', adapter: 'agy', exe: 'agy', pre_args: [], fallbackModel: 'gemini-3.8-flash-high' },
    { key: 'commandcode', name: 'CommandCode', adapter: 'commandcode', exe: 'node', pre_args: [ccEntry], fallbackModel: 'deepseek/deepseek-v4-flash' },
  ];

  const results = {};
  for (const s of specs) {
    try {
      const models = await H.ops.detectModels({ adapter: s.adapter, exe: s.exe, pre_args: s.pre_args });
      const efforts = await H.ops.detectEfforts({ adapter: s.adapter, exe: s.exe, pre_args: s.pre_args });
      const modelEfforts = await H.ops.detectModelEfforts({ adapter: s.adapter, exe: s.exe, pre_args: s.pre_args });

      results[s.key] = {
        name: s.name,
        adapter: s.adapter,
        models: Array.isArray(models) && models.length ? [...new Set(models)] : [s.fallbackModel],
        efforts: Array.isArray(efforts) && efforts.length ? [...new Set(efforts)] : ['low', 'medium', 'high'],
        modelEfforts: modelEfforts || {},
        fallbackModel: s.fallbackModel,
      };
    } catch (err) {
      results[s.key] = {
        name: s.name,
        adapter: s.adapter,
        models: [s.fallbackModel],
        efforts: ['low', 'medium', 'high'],
        modelEfforts: {},
        fallbackModel: s.fallbackModel,
        error: err.message,
      };
    }
  }
  return results;
}

function syncAgentsToDb(dbPath, agentData) {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: `Base de datos no encontrada en: ${dbPath}` };
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000;');

  // Asegurar columnas
  const cols = db.prepare('pragma table_info(agents)').all().map(c => c.name);
  if (!cols.includes('model_efforts')) {
    db.exec("alter table agents add column model_efforts text default '{}'");
  }

  const updated = [];
  for (const [key, data] of Object.entries(agentData)) {
    const row = db.prepare('select id, models, efforts, model_efforts, default_model, default_effort from agents where key=?').get(key);
    if (!row) continue;

    let curModels = [];
    try { curModels = JSON.parse(row.models || '[]'); } catch {}
    let curEfforts = [];
    try { curEfforts = JSON.parse(row.efforts || '[]'); } catch {}
    let curModelEfforts = {};
    try { curModelEfforts = JSON.parse(row.model_efforts || '{}'); } catch {}

    const nextModels = [...new Set([...data.models, ...curModels])];
    const nextEfforts = [...new Set([...data.efforts, ...curEfforts])];
    const nextModelEfforts = { ...curModelEfforts, ...data.modelEfforts };

    let defModel = row.default_model;
    if (!defModel || !nextModels.includes(defModel)) {
      defModel = nextModels.includes(data.fallbackModel) ? data.fallbackModel : nextModels[0] || '';
    }

    let defEffort = row.default_effort;
    if (!defEffort || !nextEfforts.includes(defEffort)) {
      defEffort = nextEfforts.includes('medium') ? 'medium' : nextEfforts[0] || '';
    }

    db.prepare('update agents set models=?, efforts=?, model_efforts=?, default_model=?, default_effort=? where id=?')
      .run(JSON.stringify(nextModels), JSON.stringify(nextEfforts), JSON.stringify(nextModelEfforts), defModel, defEffort, row.id);

    updated.push({
      key,
      name: data.name,
      modelsCount: nextModels.length,
      efforts: nextEfforts,
      defaultModel: defModel,
      defaultEffort: defEffort,
    });
  }

  return { ok: true, dbPath, updated };
}

async function main(customDbPath) {
  const dbPath = resolveDbPath(customDbPath);
  console.log(`[Oficina Virtual] Detectando modelos y esfuerzos de los 4 agentes...`);
  const data = await collectAgentData();

  if (fs.existsSync(dbPath)) {
    console.log(`[Oficina Virtual] Actualizando base de datos en: ${dbPath}`);
    const res = syncAgentsToDb(dbPath, data);
    if (res.ok) {
      console.log(`\n✔ Base de datos actualizada con éxito:\n`);
      for (const u of res.updated) {
        console.log(`  ★ ${u.name.padEnd(14)} [${u.key}]`);
        console.log(`    Modelos (${u.modelsCount}): por defecto "${u.defaultModel}"`);
        console.log(`    Esfuerzos: [${u.efforts.join(', ')}] (por defecto "${u.defaultEffort}")\n`);
      }
    } else {
      console.error(`✘ Error al actualizar BD: ${res.error}`);
    }
  } else {
    console.log(`[Oficina Virtual] Archivo oficina.db no encontrado en rutas estándar.`);
    console.log(`Modelos y esfuerzos detectados para uso en memoria o configuración:\n`);
    for (const [k, d] of Object.entries(data)) {
      console.log(`  ★ ${d.name} (${k}): ${d.models.length} modelos, esfuerzos: [${d.efforts.join(', ')}]`);
    }
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(e => {
    console.error('Error fatal:', e);
    process.exit(1);
  });
}

module.exports = { collectAgentData, syncAgentsToDb, resolveDbPath };
