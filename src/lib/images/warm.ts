import type { WeekPlan } from "../schemas";
import { AiQuotaError } from "../ai/dailyQuota";
import { generateDishImage } from "./dish";

// Right after the plan is generated, start the dish photos on the server, tonight's dinner first, a few at a time,
// inside a time budget. Whatever finishes in time ships with the plan; the client queue picks up the rest. Cached
// photos (same dish seen before) come back in milliseconds.
export async function warmDishImages(plan: WeekPlan, opts: { budgetMs?: number; concurrency?: number; reserve?: () => Promise<boolean> } = {}): Promise<WeekPlan> {
  const budgetMs = opts.budgetMs ?? 28_000;
  const concurrency = opts.concurrency ?? 4;
  const deadline = Date.now() + budgetMs;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const day of plan.days) {
    // Dinner first within each day: it is the hero card.
    const meals = [...day.meals].sort((a, b) => (a.slot === "dinner" ? -1 : 0) - (b.slot === "dinner" ? -1 : 0));
    for (const m of meals) {
      const r = plan.recipes[m.recipeId];
      if (r && !r.imageUrl && !r.source?.image && !seen.has(r.id)) {
        seen.add(r.id);
        order.push(r.id);
      }
    }
  }
  const urls = new Map<string, string>();
  // One abort for the whole budget: at the deadline every Gemini call in flight is cancelled, nothing keeps
  // running behind the response (Codex review, 2026-11-03). The client queue picks those recipes up later.
  const budget = new AbortController();
  const stop = setTimeout(() => budget.abort(), budgetMs);
  let next = 0;
  let outOfQuota = false;
  async function worker(): Promise<void> {
    while (!outOfQuota && next < order.length && Date.now() < deadline) {
      const id = order[next++];
      try {
        const img = await generateDishImage(plan.recipes[id], budget.signal, opts.reserve);
        urls.set(id, img.url);
      } catch (err) {
        // Out of photo slots: stop warming. Aborted or failed: the client retries this one later.
        if (err instanceof AiQuotaError) outOfQuota = true;
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, order.length) }, worker));
  } finally {
    clearTimeout(stop);
  }
  if (urls.size === 0) return plan;
  const recipes = { ...plan.recipes };
  for (const [id, url] of urls) recipes[id] = { ...recipes[id], imageUrl: url };
  return { ...plan, recipes };
}
