// Checks data/pairing-vocab.json: ids, references, sources, digits-before-$, blurb length,
// brand words, health claims. Exit 1 on any failure.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VOCAB_PATH = resolve(ROOT, "data/pairing-vocab.json");
const MAX_BLURB = 160;

// Common wine, beer, spirit, cider and mixer brands. Matched as whole words, case-insensitive.
const BRANDS = [
  "Gallo", "Barefoot", "Yellow Tail", "Kendall-Jackson", "Sutter Home", "Cupcake", "Apothic",
  "Meiomi", "La Marca", "Cavit", "Mondavi", "Beringer", "Caymus", "Duckhorn", "Rombauer",
  "Cloudy Bay", "Veuve", "Moët", "Dom Pérignon", "Chandon", "Mumm", "Ruinart", "Martini",
  "Stella Artois", "Sapporo", "Asahi", "Kirin", "Tsingtao", "Modelo", "Corona", "Heineken",
  "Budweiser", "Bud Light", "Coors", "Miller", "Michelob", "Guinness", "Sierra Nevada",
  "Lagunitas", "Dogfish", "Samuel Adams", "Blue Moon", "Angry Orchard", "Strongbow", "Woodchuck",
  "Jameson", "Bushmills", "Tullamore", "Bulleit", "Maker's Mark", "Woodford Reserve", "Jim Beam",
  "Jack Daniel", "Wild Turkey", "Evan Williams", "Four Roses", "Buffalo Trace", "Glenfiddich",
  "Glenlivet", "Macallan", "Laphroaig", "Lagavulin", "Talisker", "Johnnie Walker", "Chivas",
  "Absolut", "Smirnoff", "Stolichnaya", "Ketel One", "Grey Goose", "Belvedere", "Tito's",
  "Bombay", "Tanqueray", "Beefeater", "Hendrick's", "Gordon's", "Seagram", "Crown Royal",
  "Canadian Club", "Bacardi", "Captain Morgan", "Malibu", "Havana Club", "Mount Gay", "Appleton",
  "Diplomatico", "Patrón", "Patron", "Don Julio", "Casamigos", "Cuervo", "Sauza", "Herradura",
  "Hennessy", "Rémy Martin", "Remy Martin", "Courvoisier", "Martell", "Jägermeister",
  "Jagermeister", "Fireball", "Southern Comfort", "Aperol", "Campari", "Cointreau",
  "Grand Marnier", "Kahlúa", "Kahlua", "Baileys", "Frangelico", "Disaronno", "Chartreuse",
  "Angostura", "Fernet-Branca", "Lillet", "Pernod", "Schweppes", "Fever-Tree", "Canada Dry",
  "Topo Chico", "Perrier", "San Pellegrino", "LaCroix", "Red Bull", "Coca-Cola", "Pepsi",
  "Monin", "Bols", "Chambord", "Midori", "Luxardo", "Cinzano", "Carpano", "Dolin", "Noilly Prat",
  "Paulaner", "Franziskaner", "Erdinger", "Hoegaarden", "Leffe", "Chimay", "Duvel", "Peroni",
  "Pacifico", "Dos Equis", "Tecate", "Yuengling", "Pabst", "Shiner", "Kronenbourg", "Carlsberg",
  "Grolsch", "Amstel", "Estrella", "Moretti", "Boddingtons", "Smithwick's", "Hite", "Singha",
];

// Health claims the copy must not make. Whole words, case-insensitive.
const HEALTH_WORDS = [
  "health", "healthy", "heart", "antioxidant", "antioxidants", "calorie", "calories", "diet",
  "detox", "cure", "cures", "weight loss", "hangover", "medicine", "medicinal",
];

const failures = [];
const fail = (msg) => failures.push(msg);

const raw = readFileSync(VOCAB_PATH, "utf8");
let vocab;
try {
  vocab = JSON.parse(raw);
} catch (err) {
  console.error(`FAIL: ${VOCAB_PATH} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const GROUPS = ["wines", "grapes", "regions", "others", "cocktails", "zeroProof", "principles", "avoidReasons", "sources"];
const COCKTAIL_BASES = ["vodka", "gin", "rum", "tequila", "mezcal", "whiskey", "brandy", "sake", "sparkling-wine", "red-wine", "white-wine", "beer"];
for (const g of GROUPS) {
  if (!Array.isArray(vocab[g])) fail(`group "${g}" is missing or not an array`);
}
if (failures.length) report();

const ids = (group) => new Set(vocab[group].map((item) => item.id));

// 1. ids unique per group, non-empty strings.
for (const g of GROUPS) {
  const seen = new Set();
  for (const item of vocab[g]) {
    if (typeof item.id !== "string" || item.id.trim() === "") fail(`${g}: item without a string id`);
    else if (seen.has(item.id)) fail(`${g}: duplicate id "${item.id}"`);
    else seen.add(item.id);
  }
}

const grapeIds = ids("grapes");
const regionIds = ids("regions");
const sourceIds = ids("sources");

// 2. references resolve.
for (const w of vocab.wines) {
  if (!["red", "white", "rose", "sparkling", "orange"].includes(w.color)) fail(`wine ${w.id}: bad color "${w.color}"`);
  if (!["light", "medium", "full"].includes(w.body)) fail(`wine ${w.id}: bad body "${w.body}"`);
  if (!["dry", "off-dry", "sweet"].includes(w.sweetness)) fail(`wine ${w.id}: bad sweetness "${w.sweetness}"`);
  if (!Array.isArray(w.grapes) || w.grapes.length === 0) fail(`wine ${w.id}: no grapes`);
  if (!Array.isArray(w.regions) || w.regions.length === 0) fail(`wine ${w.id}: no regions`);
  for (const g of w.grapes ?? []) if (!grapeIds.has(g)) fail(`wine ${w.id}: unknown grape "${g}"`);
  for (const r of w.regions ?? []) if (!regionIds.has(r)) fail(`wine ${w.id}: unknown region "${r}"`);
  const t = w.serveTempF;
  if (!Array.isArray(t) || t.length !== 2 || !(t[0] <= t[1])) fail(`wine ${w.id}: serveTempF must be [lo, hi] with lo <= hi`);
}
for (const o of vocab.others) {
  if (!["beer", "cider", "spirit", "cocktail", "sake"].includes(o.kind)) fail(`other ${o.id}: bad kind "${o.kind}"`);
  if (o.kind === "cocktail") {
    const r = o.recipe;
    if (!r || !Array.isArray(r.ingredients) || !Array.isArray(r.steps)) {
      fail(`cocktail ${o.id}: missing recipe`);
    } else {
      if (r.ingredients.length > 4) fail(`cocktail ${o.id}: more than 4 ingredients`);
      if (r.steps.length > 3) fail(`cocktail ${o.id}: more than 3 steps`);
    }
  }
}
for (const p of vocab.principles) {
  if (!Array.isArray(p.sourceIds) || p.sourceIds.length === 0) fail(`principle ${p.id}: no sourceIds`);
  for (const s of p.sourceIds ?? []) if (!sourceIds.has(s)) fail(`principle ${p.id}: unknown source "${s}"`);
}

// 3. sources: https URLs and an accessedAt date.
for (const s of vocab.sources) {
  let url;
  try {
    url = new URL(s.url);
  } catch {
    fail(`source ${s.id}: url is not a valid URL`);
    continue;
  }
  if (url.protocol !== "https:") fail(`source ${s.id}: url must be https`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt ?? "")) fail(`source ${s.id}: accessedAt must be YYYY-MM-DD`);
}

// 4. blurbs and one-sentence texts are short.
const shortTexts = [
  ...vocab.wines.map((w) => [`wine ${w.id}`, w.blurb]),
  ...vocab.others.map((o) => [`other ${o.id}`, o.blurb]),
  ...vocab.zeroProof.map((z) => [`zeroProof ${z.id}`, z.blurb]),
  ...vocab.principles.map((p) => [`principle ${p.id}`, p.text]),
  ...vocab.avoidReasons.map((a) => [`avoid ${a.id}`, a.text]),
];
for (const [label, text] of shortTexts) {
  if (typeof text !== "string" || text.trim() === "") fail(`${label}: empty text`);
  else if (text.length > MAX_BLURB) fail(`${label}: ${text.length} chars, limit ${MAX_BLURB}`);
}

// 5. digits followed by "$" anywhere in the file.
if (/\d\s*\$/.test(raw)) fail("digit followed by \"$\" found (prices are not allowed)");

// 5b. optional searchTerm on wines and other drinks: short non-empty text.
for (const item of [...vocab.wines, ...vocab.others]) {
  if (item.searchTerm === undefined) continue;
  if (typeof item.searchTerm !== "string" || item.searchTerm.trim() === "" || item.searchTerm.length > 40) {
    fail(`${item.id}: searchTerm must be a non-empty string up to 40 chars`);
  }
}

// 6. brand words and health claims.
const wordRe = (word) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
};
// Cocktail ids and names are classics ("Espresso Martini"); the brand scan skips them and checks their fields below.
const rawSansCocktailNames = JSON.stringify({ ...vocab, cocktails: vocab.cocktails.map((c) => ({ ...c, id: "", name: "" })) });
for (const brand of BRANDS) {
  if (wordRe(brand).test(rawSansCocktailNames)) fail(`brand word found: "${brand}"`);
}
for (const word of HEALTH_WORDS) {
  if (wordRe(word).test(raw)) fail(`health claim word found: "${word}"`);
}

// 7. cocktails: known base, mix/food length, no "$", no brand words (BRANDS list above).
for (const c of vocab.cocktails) {
  if (!COCKTAIL_BASES.includes(c.base)) fail(`cocktail ${c.id}: bad base "${c.base}"`);
  if (typeof c.mix !== "string" || c.mix.length > 110) fail(`cocktail ${c.id}: mix must be a string up to 110 chars`);
  if (typeof c.food !== "string" || c.food.length > 90) fail(`cocktail ${c.id}: food must be a string up to 90 chars`);
  if (!["rocks", "highball", "coupe", "flute", "wine", "mug", "pint"].includes(c.glass)) fail(`cocktail ${c.id}: bad glass "${c.glass}"`);
  if (!/^#[0-9a-f]{6}$/.test(c.tone ?? "")) fail(`cocktail ${c.id}: tone must be a 6-digit hex color`);
  const r = c.recipe;
  if (!r || !Array.isArray(r.ingredients) || !Array.isArray(r.steps)) fail(`cocktail ${c.id}: missing recipe`);
  else {
    if (r.ingredients.length < 2 || r.ingredients.length > 5) fail(`cocktail ${c.id}: 2 to 5 ingredients`);
    if (r.steps.length < 2 || r.steps.length > 3) fail(`cocktail ${c.id}: 2 to 3 steps`);
    for (const line of [...r.ingredients, ...r.steps]) if (typeof line !== "string" || line.length > 110) fail(`cocktail ${c.id}: recipe line too long "${line}"`);
  }
  for (const text of [c.mix, c.food, ...(r?.ingredients ?? []), ...(r?.steps ?? [])]) {
    if (typeof text !== "string") continue;
    if (text.includes("$")) fail(`cocktail ${c.id}: "$" found in "${text}"`);
    for (const brand of BRANDS) {
      if (wordRe(brand).test(text)) fail(`cocktail ${c.id}: brand word "${brand}" found in "${text}"`);
    }
  }
}

report();

function report() {
  if (failures.length) {
    console.error(`check-pairing-data: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const counts = GROUPS.map((g) => `${g}=${vocab[g].length}`).join(" ");
  console.log(`check-pairing-data: OK (${counts}; brands checked=${BRANDS.length})`);
  process.exit(0);
}
