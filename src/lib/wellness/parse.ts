// Tolerant reader for health exports (CSV or JSON rows) a student drops in: a bathroom scale app, Apple Health via an
// export app, Oura, Withings, Garmin. Columns are found by meaning, not by brand, because every export differs
// (formats were NOT verified against each vendor: see docs/research/2026-11-03-wearables.md). What we keep per day:
// weight in kg, sleep in hours, resting heart rate. Nothing else is read or stored.
export type WellnessDay = { date: string; weightKg?: number; sleepH?: number; restingHr?: number };
export type ParseResult = { days: WellnessDay[]; skipped: number; columns: { date: string | null; weight: string | null; sleep: string | null; rhr: string | null } };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

function isoDate(raw: string): string | null {
  const s = raw.trim();
  let m = DATE_RE.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = US_DATE_RE.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t) && s.length >= 8) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[^0-9.+-]/g, ""));
  return raw.trim() === "" || !Number.isFinite(n) ? null : n;
}

// Split one CSV line, with quotes.
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

type Col = { name: string; unit: "kg" | "lb" | "h" | "min" | "s" | null };

// Headers are matched on a spaced, lowercased copy ("weight_kg" → "weight kg", "sleepHours" → "sleep hours").
const plain = (h: string) => h.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function pick(headers: string[], tests: RegExp[], not: RegExp[] = []): Col | null {
  for (const re of tests) {
    const name = headers.find((h) => re.test(plain(h)) && !not.some((n) => n.test(plain(h))));
    if (name) {
      const h = plain(name);
      const unit = /\(?\blbs?\b\)?|pounds?/.test(h) ? "lb" : /\bkg\b|kilogram/.test(h) ? "kg" : /\bmin(ute)?s?\b/.test(h) ? "min" : /\bsec(ond)?s?\b|\(s\)/.test(h) ? "s" : /\bh(ou)?rs?\b|\(h\)/.test(h) ? "h" : null;
      return { name, unit };
    }
  }
  return null;
}

export function parseWellnessRows(rows: Record<string, unknown>[]): ParseResult {
  // Union of keys: JSON rows often carry different fields per entry (a weigh-in row, a sleep row).
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const date = pick(headers, [/^date$/i, /\bdate\b/i, /^day$/i, /\bday\b/i, /start/i, /timestamp/i]);
  const weight = pick(headers, [/\bweight\b/i, /\bbody ?mass\b/i], [/bmi|goal|target|lean|fat/i]);
  const sleep = pick(headers, [/total ?sleep/i, /time ?asleep/i, /\basleep\b/i, /sleep.*(duration|hours|time|h\b|min)/i, /^sleep$/i, /\bsleep\b/i], [/score|efficiency|latency|debt|onset|deep|rem|light|awake|hr|heart|respir/i]);
  const rhr = pick(headers, [/resting ?heart ?rate/i, /\brhr\b/i, /resting.*hr/i, /lowest.*heart/i], [/avg|average|max/i]);
  const byDay = new Map<string, WellnessDay>();
  let skipped = 0;
  for (const r of rows) {
    const d = date ? isoDate(String(r[date.name] ?? "")) : null;
    if (!d) { skipped++; continue; }
    const day = byDay.get(d) ?? { date: d };
    if (weight) {
      const w = num(r[weight.name]);
      if (w !== null && w > 0) {
        const kg = weight.unit === "lb" ? w * 0.45359237 : w;
        if (kg >= 25 && kg <= 350) day.weightKg = Math.round(kg * 10) / 10;
      }
    }
    if (sleep) {
      const v = num(r[sleep.name]);
      if (v !== null && v > 0) {
        const h = sleep.unit === "min" ? v / 60 : sleep.unit === "s" ? v / 3600 : v > 24 ? (v > 1440 ? v / 3600 : v / 60) : v;
        if (h > 0 && h <= 24) day.sleepH = Math.round(h * 10) / 10;
      }
    }
    if (rhr) {
      const v = num(r[rhr.name]);
      if (v !== null && v >= 30 && v <= 150) day.restingHr = Math.round(v);
    }
    if (day.weightKg === undefined && day.sleepH === undefined && day.restingHr === undefined) { skipped++; continue; }
    byDay.set(d, day);
  }
  return {
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    skipped,
    columns: { date: date?.name ?? null, weight: weight?.name ?? null, sleep: sleep?.name ?? null, rhr: rhr?.name ?? null },
  };
}

export function parseWellnessText(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as unknown;
      const arr = Array.isArray(j) ? j : typeof j === "object" && j !== null ? (Object.values(j).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [] : [];
      return parseWellnessRows(arr.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null));
    } catch {
      return { days: [], skipped: 0, columns: { date: null, weight: null, sleep: null, rhr: null } };
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { days: [], skipped: lines.length, columns: { date: null, weight: null, sleep: null, rhr: null } };
  const headers = splitCsv(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsv(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return parseWellnessRows(rows);
}
