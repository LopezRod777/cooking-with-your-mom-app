import {
  avoidReasonById,
  wineById,
  drinkStyleIds,
  grapeById,
  otherById,
  principleById,
  regionById,
  wineChoiceProblem,
  zeroProofById,
} from "./vocab";
import { PairingOutputSchema, type PairingOutput } from "./schema";

export const LOW_CONFIDENCE = 0.4;

export type ValidatePairingResult =
  | { ok: true; value: PairingOutput; lowConfidence: boolean }
  | { ok: false; reason: string };

/** Zod shape, then vocabulary membership, then coherence. `lowConfidence` is flagged, not rejected. */
export function validatePairing(raw: unknown): ValidatePairingResult {
  const parsed = PairingOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "(root)";
    return { ok: false, reason: `schema: ${where}: ${issue?.message ?? "invalid"}` };
  }
  const value = parsed.data;

  const [w1, w2] = value.wines;
  if (w1.styleId === w2.styleId) return { ok: false, reason: `duplicate wine styleId "${w1.styleId}"` };
  for (const w of value.wines) {
    const problem = wineChoiceProblem(w.styleId, w.grapeIds, w.regionIds, w.serveTempF);
    if (problem) return { ok: false, reason: problem };
    const badPrinciple = w.whyPrincipleIds.find((p) => !principleById.has(p));
    if (badPrinciple !== undefined) return { ok: false, reason: `unknown principle "${badPrinciple}"` };
  }

  const [other] = value.other;
  if (!otherById.has(other.styleId)) return { ok: false, reason: `unknown other styleId "${other.styleId}"` };
  const badOtherPrinciple = other.whyPrincipleIds.find((p) => !principleById.has(p));
  if (badOtherPrinciple !== undefined) return { ok: false, reason: `unknown principle "${badOtherPrinciple}"` };

  const [zp] = value.zeroProof;
  if (!zeroProofById.has(zp.styleId)) return { ok: false, reason: `unknown zeroProof styleId "${zp.styleId}"` };

  const [avoid] = value.avoid;
  if (!drinkStyleIds.has(avoid.styleId)) return { ok: false, reason: `unknown avoid styleId "${avoid.styleId}"` };
  if (!avoidReasonById.has(avoid.avoidReasonId)) {
    return { ok: false, reason: `unknown avoidReasonId "${avoid.avoidReasonId}"` };
  }

  return { ok: true, value, lowConfidence: value.confidence < LOW_CONFIDENCE };
}

/**
 * Ids the model used that are not in the vocabulary, as "field:value".
 * Works on any raw value, valid or not; used by the usefulness run to report invented ids.
 */
export function unknownIds(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const check = (field: string, value: unknown, known: (s: string) => boolean) => {
    const s = str(value);
    if (s !== null && !known(s)) out.push(`${field}:${s}`);
  };

  for (const w of list(r.wines)) {
    if (!w || typeof w !== "object") continue;
    const x = w as Record<string, unknown>;
    check("wines.styleId", x.styleId, (s) => wineById.has(s));
    for (const g of list(x.grapeIds)) check("grapeIds", g, (s) => grapeById.has(s));
    for (const g of list(x.regionIds)) check("regionIds", g, (s) => regionById.has(s));
    for (const p of list(x.whyPrincipleIds)) check("whyPrincipleIds", p, (s) => principleById.has(s));
  }
  for (const o of list(r.other)) {
    if (!o || typeof o !== "object") continue;
    const x = o as Record<string, unknown>;
    check("other.styleId", x.styleId, (s) => otherById.has(s));
    for (const p of list(x.whyPrincipleIds)) check("whyPrincipleIds", p, (s) => principleById.has(s));
  }
  for (const z of list(r.zeroProof)) {
    if (!z || typeof z !== "object") continue;
    check("zeroProof.styleId", (z as Record<string, unknown>).styleId, (s) => zeroProofById.has(s));
  }
  for (const a of list(r.avoid)) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    check("avoid.styleId", x.styleId, (s) => drinkStyleIds.has(s));
    check("avoid.avoidReasonId", x.avoidReasonId, (s) => avoidReasonById.has(s));
  }
  return out;
}
