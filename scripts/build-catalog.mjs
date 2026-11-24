// Builds data/catalog.json and data/catalog-report.md from the USDA FoodData Central
// SR Legacy CSV bulk download. No dependencies; numbers come only from the dataset.
//
// Usage (from project root):
//   node scripts/build-catalog.mjs <datasetdir>
// where <datasetdir> is the unzipped folder that contains food.csv, food_nutrient.csv, etc.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = process.argv[2];
if (!DATASET) {
  console.error('usage: node scripts/build-catalog.mjs <datasetdir>');
  process.exit(1);
}

const SEED = join(ROOT, 'data', 'catalog-seed.csv');
const OUT_JSON = join(ROOT, 'data', 'catalog.json');
const OUT_REPORT = join(ROOT, 'data', 'catalog-report.md');

// USDA nutrient ids (verified against nutrient.csv of the SR Legacy bundle).
const NUTRIENT_IDS = { kcal: 1008, protein_g: 1003, carbs_g: 1005, fat_g: 1004, fiber_g: 1079 };
const NUTRIENT_ID_SET = new Set(Object.values(NUTRIENT_IDS));

// Fuzzy requires every hint token (stop words ignored) to appear in the description.
// 0.6 was tried first and accepted wrong foods ("Tomatoes, grape" -> "Grape leaves", "Onions, red" -> "Onions, raw").
const FUZZY_MIN_SCORE = 1;
const MAX_PORTIONS = 6;
const STOP = new Set(['and', 'or', 'with', 'of', 'the', 'a', 'in', 'from', 'to']);
const UNDETERMINED_UNIT_ID = '9999';
const OUT_OVERRIDES = join(ROOT, 'data', 'catalog-overrides.json');
const OUT_PACKAGE_OVERRIDES = join(ROOT, 'data', 'package-overrides.json');
const OUT_ALLERGENS = join(ROOT, 'data', 'allergens.json');
// Entries the SR Legacy bundle cannot provide (for example açaí: only drinks there). Each carries its own
// USDA source (Branded or Foundation fdcId) and is copied into the catalog as is.
const MANUAL = join(ROOT, 'data', 'catalog-manual.json');
// Allergen tags reviewed by hand per key (see data/allergens.json). Keep in sync with ALLERGEN_TAGS in src/lib/catalog.ts.
const ALLERGEN_TAG_IDS = new Set(['peanut', 'tree_nut', 'dairy', 'egg', 'shellfish', 'fish', 'soy', 'wheat_gluten', 'sesame']);
const UNIT_GRAMS = { lb: 453.592, oz: 28.3495, 'fl oz': 29.5735 }; // fl oz treats volume as water density
const EACH_PORTION = /^1 (large|medium|each|whole|clove|head|bunch|slice|muffin|tortilla|piece|stalk|container|link|stick)\b/i;

// Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, embedded commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function readRecords(path) {
  const rows = parseCsv(readFileSync(path, 'utf8')).filter((r) => !(r.length === 1 && r[0] === ''));
  const header = rows.shift();
  return rows.map((r) => {
    if (r.length !== header.length) throw new Error(`${path}: row with ${r.length} fields, expected ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h, r[i]]));
  });
}

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
const numericId = (s) => Number(s);

// Deterministic pick among several candidates: shortest description, then lowest fdc_id.
function pickCandidate(list) {
  return [...list].sort((a, b) =>
    a.description.length - b.description.length || numericId(a.fdc_id) - numericId(b.fdc_id))[0];
}

function matchHint(hint, foods) {
  const h = norm(hint);
  const exact = foods.filter((f) => norm(f.description) === h);
  if (exact.length) return { food: pickCandidate(exact), level: 'exact' };

  const prefix = foods.filter((f) => norm(f.description).startsWith(h));
  if (prefix.length) return { food: pickCandidate(prefix), level: 'prefix' };

  const hintTokens = new Set(tokens(hint));
  let best = null;
  for (const f of foods) {
    const descTokens = new Set(tokens(f.description));
    let shared = 0;
    for (const t of hintTokens) if (descTokens.has(t)) shared++;
    const score = hintTokens.size ? shared / hintTokens.size : 0;
    const better = !best || score > best.score ||
      (score === best.score && descTokens.size < best.size) ||
      (score === best.score && descTokens.size === best.size && numericId(f.fdc_id) < numericId(best.food.fdc_id));
    if (better) best = { food: f, score, size: descTokens.size };
  }
  if (best && best.score >= FUZZY_MIN_SCORE) return { food: best.food, level: 'fuzzy', score: best.score };
  return { food: null, level: 'not_found', score: best ? best.score : 0, bestRejected: best ? best.food : null };
}

function portionLabel(p, unitNameById) {
  const amount = (p.amount || '').trim();
  const desc = (p.portion_description || '').trim();
  const modifier = (p.modifier || '').trim();
  if (desc) return [amount, desc].filter(Boolean).join(' ');
  const unitName = p.measure_unit_id === UNDETERMINED_UNIT_ID ? '' : (unitNameById.get(p.measure_unit_id) || '');
  let label = [amount, unitName].filter(Boolean).join(' ');
  if (modifier) label += (unitName ? ', ' : ' ') + modifier;
  return label.trim();
}

const seedRows = readRecords(SEED);
const foods = readRecords(join(DATASET, 'food.csv'));
const measureUnits = readRecords(join(DATASET, 'measure_unit.csv'));
const nutrientRows = readRecords(join(DATASET, 'nutrient.csv'));
const portionRows = readRecords(join(DATASET, 'food_portion.csv'));
const unitNameById = new Map(measureUnits.map((u) => [u.id, u.name]));

// Sanity: nutrient ids used must exist in nutrient.csv with the expected name.
const nutrientNameById = new Map(nutrientRows.map((n) => [n.id, n.name]));
const expectedNames = {
  1008: 'Energy', 1003: 'Protein', 1005: 'Carbohydrate, by difference', 1004: 'Total lipid (fat)', 1079: 'Fiber, total dietary',
};
for (const [id, name] of Object.entries(expectedNames)) {
  if (nutrientNameById.get(id) !== name) throw new Error(`nutrient id ${id} is "${nutrientNameById.get(id)}", expected "${name}"`);
}

// Explicit overrides win over any matching. Each fdcId must exist in food.csv and each key in the seed.
const seedKeys = new Set(seedRows.map((r) => r.key));
const foodById = new Map(foods.map((f) => [f.fdc_id, f]));
const OVERRIDES = JSON.parse(readFileSync(OUT_OVERRIDES, 'utf8'));
for (const [key, o] of Object.entries(OVERRIDES)) {
  if (!seedKeys.has(key)) throw new Error(`override key not in seed: ${key}`);
  if (!foodById.has(String(o.fdcId))) throw new Error(`override fdcId not in food.csv: ${o.fdcId} (${key})`);
}

// Package overrides win over packageGrams() for the same key. Each key must be in the seed.
const PACKAGE_OVERRIDES = JSON.parse(readFileSync(OUT_PACKAGE_OVERRIDES, 'utf8'));
for (const key of Object.keys(PACKAGE_OVERRIDES)) {
  if (!seedKeys.has(key)) throw new Error(`package override key not in seed: ${key}`);
}

// Allergen tags: every seed key must have an entry (empty array when none), and every tag must be known.
const MANUAL_ENTRIES = JSON.parse(readFileSync(MANUAL, 'utf8'));
const manualKeys = new Set(MANUAL_ENTRIES.map((m) => m.key));
for (const m of MANUAL_ENTRIES) {
  if (seedKeys.has(m.key)) throw new Error(`manual key also in seed: ${m.key}`);
  if (!m.usda || typeof m.usda.fdcId !== 'number' || !m.usda.source) throw new Error(`manual entry needs a usda source: ${m.key}`);
  for (const f of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']) {
    if (typeof m.per100g?.[f] !== 'number') throw new Error(`manual entry ${m.key} lacks per100g.${f}`);
  }
}
const ALLERGENS = JSON.parse(readFileSync(OUT_ALLERGENS, 'utf8'));
for (const key of seedKeys) {
  if (!Array.isArray(ALLERGENS[key])) throw new Error(`allergens missing for key: ${key}`);
}
for (const [key, tags] of Object.entries(ALLERGENS)) {
  if (!seedKeys.has(key) && !manualKeys.has(key)) throw new Error(`allergens key not in seed: ${key}`);
  for (const t of tags) if (!ALLERGEN_TAG_IDS.has(t)) throw new Error(`unknown allergen tag "${t}" for ${key}`);
}

const matches = seedRows.map((seed) => {
  const o = OVERRIDES[seed.key];
  if (o) return { seed, food: foodById.get(String(o.fdcId)), level: 'override', proxyOf: o.proxyOf };
  return { seed, ...matchHint(seed.usda_search_hint, foods) };
});
const neededFdc = new Set(matches.filter((m) => m.food).map((m) => m.food.fdc_id));

// fdc_id -> nutrient_id -> amount (only for matched foods)
const nutrientsByFdc = new Map();
for (const r of readRecords(join(DATASET, 'food_nutrient.csv'))) {
  if (!neededFdc.has(r.fdc_id)) continue;
  const id = numericId(r.nutrient_id);
  if (!NUTRIENT_ID_SET.has(id)) continue;
  if (!nutrientsByFdc.has(r.fdc_id)) nutrientsByFdc.set(r.fdc_id, new Map());
  const m = nutrientsByFdc.get(r.fdc_id);
  if (!m.has(id)) m.set(id, Number(r.amount));
}

const portionsByFdc = new Map();
for (const p of portionRows) {
  if (!neededFdc.has(p.fdc_id)) continue;
  if (!portionsByFdc.has(p.fdc_id)) portionsByFdc.set(p.fdc_id, []);
  portionsByFdc.get(p.fdc_id).push(p);
}

function buildEntry({ seed, food }) {
  const entry = {
    key: seed.key,
    displayName: seed.display_name,
    aisle: seed.aisle,
    package: { size: Number(seed.package_size), unit: seed.package_unit },
    usda: null,
    per100g: null,
    portions: [],
    allergens: [...ALLERGENS[seed.key]],
  };
  if (!food) return entry;
  const n = nutrientsByFdc.get(food.fdc_id) || new Map();
  const val = (key) => (n.has(NUTRIENT_IDS[key]) ? n.get(NUTRIENT_IDS[key]) : null);
  entry.usda = { fdcId: numericId(food.fdc_id), description: food.description, source: 'sr_legacy' };
  entry.per100g = {
    kcal: val('kcal'),
    protein_g: val('protein_g'),
    carbs_g: val('carbs_g'),
    fat_g: val('fat_g'),
    fiber_g: val('fiber_g'),
  };
  entry.portions = (portionsByFdc.get(food.fdc_id) || [])
    .filter((p) => Number(p.gram_weight) > 0)
    .sort((a, b) => Number(a.seq_num) - Number(b.seq_num))
    .slice(0, MAX_PORTIONS)
    .map((p) => ({ label: portionLabel(p, unitNameById), grams: Number(p.gram_weight) }));
  return entry;
}

function packageGrams(seed, entry) {
  const size = Number(seed.package_size);
  if (seed.package_unit === 'each') {
    const p = entry.portions.find((x) => EACH_PORTION.test(x.label));
    return p ? Math.round(size * p.grams * 10) / 10 : null;
  }
  const f = UNIT_GRAMS[seed.package_unit];
  return f ? Math.round(size * f * 10) / 10 : null;
}

const catalog = matches
  .map((m) => {
    const e = buildEntry(m);
    e.packageGrams = packageGrams(m.seed, e);
    const pkg = PACKAGE_OVERRIDES[m.seed.key];
    if (pkg) {
      e.packageGrams = pkg.packageGrams;
      if (pkg.packageLabel) e.packageLabel = pkg.packageLabel;
      e.packageNote = pkg.note;
    }
    if (m.proxyOf) e.proxyOf = `USDA has no separate entry; using ${m.proxyOf}`;
    return e;
  })
  .concat(MANUAL_ENTRIES.map((m) => ({ ...m, allergens: [...(ALLERGENS[m.key] ?? m.allergens ?? [])] })))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
writeFileSync(OUT_JSON, JSON.stringify(catalog, null, 2) + '\n');

// Report
const datasetName = basename(resolve(DATASET));
const datasetDate = (datasetName.match(/(\d{4}-\d{2})/) || [])[1] || 'unknown';
const counts = { override: 0, exact: 0, prefix: 0, fuzzy: 0, not_found: 0 };
for (const m of matches) counts[m.level]++;
const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|');
const levelLabel = { override: 'override', exact: 'exact', prefix: 'prefix', fuzzy: 'fuzzy', not_found: 'NOT FOUND' };
const SPOT = ['chicken_breast', 'eggs', 'greek_yogurt', 'white_rice', 'broccoli'];

const lines = [];
lines.push('# Catalog build report');
lines.push('');
lines.push(`Dataset: \`${datasetName}\` (USDA FoodData Central SR Legacy, release date in file name: ${datasetDate}).`);
lines.push(`Seed rows: ${seedRows.length}; manual entries (data/catalog-manual.json, own USDA source): ${MANUAL_ENTRIES.length}. Generated by \`node scripts/build-catalog.mjs <datasetdir>\`.`);
lines.push('');
lines.push(`Match counts: override ${counts.override}, exact ${counts.exact}, prefix ${counts.prefix}, fuzzy ${counts.fuzzy}, NOT FOUND ${counts.not_found}.`);
lines.push('Overrides (data/catalog-overrides.json) are applied before any matching and are listed below.');
lines.push(`Matching order: exact (case-insensitive) → prefix (description starts with hint) → fuzzy (every hint token present in the description, stop words ignored). Ties: shortest description, then lowest fdc_id.`);
lines.push('');
lines.push('## Matches');
lines.push('');
lines.push('| key | matched USDA description | fdc_id | level |');
lines.push('|---|---|---|---|');
for (const m of matches) {
  lines.push(`| ${mdCell(m.seed.key)} | ${mdCell(m.food ? m.food.description : '—')} | ${m.food ? m.food.fdc_id : '—'} | ${levelLabel[m.level]} |`);
}
lines.push('');
lines.push('## Overrides (explicit, win over matching)');
lines.push('');
lines.push('| key | override fdc_id | USDA description | note |');
lines.push('|---|---|---|---|');
for (const m of matches.filter((x) => x.level === 'override')) {
  lines.push(`| ${mdCell(m.seed.key)} | ${m.food.fdc_id} | ${mdCell(m.food.description)} | ${m.proxyOf ? 'proxy: ' + mdCell(m.proxyOf) : ''} |`);
}
lines.push('');
lines.push('## Package overrides (data/package-overrides.json, win over packageGrams rule)');
lines.push('');
lines.push('| key | packageGrams | packageLabel | note |');
lines.push('|---|---|---|---|');
for (const c of catalog.filter((x) => x.packageNote !== undefined)) {
  lines.push(`| ${mdCell(c.key)} | ${c.packageGrams ?? 'null'} | ${mdCell(c.packageLabel ?? '')} | ${mdCell(c.packageNote)} |`);
}
lines.push('');
lines.push('## For human review (fuzzy and NOT FOUND)');
lines.push('');
const review = matches.filter((m) => m.level === 'fuzzy' || m.level === 'not_found');
if (!review.length) lines.push('None.');
for (const m of review) {
  if (m.level === 'fuzzy') {
    lines.push(`- **${m.seed.key}** fuzzy (score ${m.score.toFixed(2)}): hint "${m.seed.usda_search_hint}" → "${m.food.description}" (fdc ${m.food.fdc_id}). Accepted; verify.`);
  } else {
    const best = m.bestRejected ? `best rejected candidate "${m.bestRejected.description}" (fdc ${m.bestRejected.fdc_id}, score ${m.score.toFixed(2)})` : 'no candidate';
    lines.push(`- **${m.seed.key}** NOT FOUND: hint "${m.seed.usda_search_hint}"; ${best}. Left as \`usda: null\`.`);
  }
}
lines.push('');
lines.push('## Spot-check values (per 100 g, from the dataset)');
lines.push('');
lines.push('Check each one on https://fdc.nal.usda.gov/food-details/<fdc_id>/nutrients.');
lines.push('');
lines.push('| key | fdc_id | kcal | protein_g | carbs_g | fat_g | fiber_g |');
lines.push('|---|---|---|---|---|---|---|');
for (const key of SPOT) {
  const e = catalog.find((c) => c.key === key);
  if (!e || !e.usda) { lines.push(`| ${key} | — | not matched | | | | |`); continue; }
  const p = e.per100g;
  lines.push(`| ${key} | ${e.usda.fdcId} | ${p.kcal} | ${p.protein_g} | ${p.carbs_g} | ${p.fat_g} | ${p.fiber_g} |`);
}
lines.push('');
const missingNutrient = catalog.filter((c) => c.per100g && Object.values(c.per100g).some((v) => v === null));
lines.push(`Matched rows with at least one nutrient missing in the dataset (kept as null): ${missingNutrient.length}${missingNutrient.length ? ' — ' + missingNutrient.map((c) => c.key).join(', ') : ''}.`);
lines.push('');
writeFileSync(OUT_REPORT, lines.join('\n'));

console.log(`catalog.json: ${catalog.length} rows`);
console.log(`override ${counts.override} | exact ${counts.exact} | prefix ${counts.prefix} | fuzzy ${counts.fuzzy} | NOT FOUND ${counts.not_found}`);
const eachItems = catalog.filter((c) => c.package.unit === 'each');
const eachNull = eachItems.filter((c) => c.packageGrams === null).map((c) => c.key);
console.log(`each items: ${eachItems.length}, packageGrams null: ${eachNull.length}${eachNull.length ? ' -> ' + eachNull.join(', ') : ''}`);
