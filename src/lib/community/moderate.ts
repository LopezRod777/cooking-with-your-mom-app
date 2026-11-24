import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "../ai/client";
import { blockedWord, maskContact } from "./words";

// Every public text (post, comment, table name) goes through the same path before anyone sees it:
//   1. blocked word → "block" (never saved);
//   2. contact details → masked, then "review";
//   3. classifier (Claude Haiku) → ok | review | block with a category;
//   4. classifier missing, failing or over the daily budget → "review" (hidden until the admin looks). Never
//      published unchecked.
export type Verdict = { decision: "ok" | "review" | "block"; category: Category; text: string; note?: string };
export const CATEGORIES = ["none", "hate", "harassment", "sexual", "self_harm", "contact", "spam", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const MOD_MODEL = "claude-haiku-5-5";
export const DAILY_BUDGET = 2000;

const Out = z.object({
  decision: z.enum(["ok", "review", "block"]),
  category: z.enum(CATEGORIES),
  why: z.string(),
});

const SYSTEM = `You moderate short messages on a small, friendly cooking community for college students ("the table"). People share how their week of cooking went, ask for tips, cheer each other on. Any language, mostly English and Spanish.

Decide for the message:
- "block": hate or slurs, harassment or threats toward anyone, sexual content, encouraging self-harm or disordered eating (extreme restriction, purging, "pro-ana" talk), grooming, doxxing someone else.
- "review": the author may be in danger (self-harm, suicidal thoughts, an eating disorder they describe about themselves), spam or selling, trying to move people off-site, borderline rudeness, anything you are unsure about.
- "ok": everything else, including frank talk about food, weight goals in a healthy range, mild slang.

Category is the main reason. "why" is one short sentence for the moderator.`;

export type Classifier = (text: string) => Promise<{ decision: Verdict["decision"]; category: Category; why: string }>;

// No thinking and room to answer: Haiku 5.5 otherwise spends the budget on a thinking block, the JSON comes back
// cut off, parse() throws and every post or photo falls to "review" (2026-11-04).
export async function defaultClassifier(text: string): Promise<{ decision: Verdict["decision"]; category: Category; why: string }> {
  const res = await anthropic.messages.parse({
    model: MOD_MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Message:\n"""\n${text.slice(0, 2000)}\n"""` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("moderation: no parsed output");
  return parsed;
}

// `spend` reserves one classifier call from the day's budget; false = budget spent.
export async function moderateText(
  raw: string,
  deps: { classify?: Classifier; spend?: () => Promise<boolean>; enabled?: boolean } = {},
): Promise<Verdict> {
  const bad = blockedWord(raw);
  if (bad) return { decision: "block", category: "harassment", text: raw, note: `blocked word: ${bad}` };
  const { text, masked } = maskContact(raw);
  const enabled = deps.enabled ?? Boolean(process.env.ANTHROPIC_API_KEY);
  if (!enabled) return { decision: "review", category: masked ? "contact" : "none", text, note: "classifier off" };
  const canSpend = deps.spend ? await deps.spend() : true;
  if (!canSpend) return { decision: "review", category: masked ? "contact" : "none", text, note: "daily budget spent" };
  try {
    const c = await (deps.classify ?? defaultClassifier)(text);
    if (c.decision === "block") return { decision: "block", category: c.category, text, note: c.why };
    if (masked) return { decision: "review", category: "contact", text, note: c.why };
    return { decision: c.decision, category: c.category, text, note: c.why };
  } catch (err) {
    return { decision: "review", category: masked ? "contact" : "none", text, note: `classifier failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Photos. Same rule as text: nothing is published unchecked. The classifier sees the JPEG only (no EXIF, no
// name); a missing, failing or over-budget classifier leaves the photo in "review".
export type ImageCategory = "none" | "nudity" | "sexual" | "violence" | "minor" | "personal_data" | "hate" | "other";
type ImageDecision = { decision: "ok" | "review" | "block"; category: ImageCategory; why: string };

const IMAGE_CATEGORIES: [ImageCategory, ...ImageCategory[]] = ["none", "nudity", "sexual", "violence", "minor", "personal_data", "hate", "other"];

const ImageOut = z.object({
  decision: z.enum(["ok", "review", "block"]),
  category: z.enum(IMAGE_CATEGORIES),
  why: z.string(),
});

const IMAGE_SYSTEM = `You moderate photos posted to a small, friendly cooking community for college students ("the table"). Members share food they cook, their kitchen, their plate, groceries and pets.

Decide for the photo:
- "block": nudity or sexual content, graphic violence or gore, hate symbols, someone being humiliated or mocked.
- "review": a person who looks under 18 or whose age is unclear (category "minor"); screenshots, documents, IDs, license plates, addresses or anything else showing personal data (category "personal_data"); anything not about food, kitchens, plates or pets that you are unsure about.
- "ok": food, kitchens, plates, groceries, pets, adults cooking.

Category is the main reason. "why" is one short sentence for the moderator.`;

export async function defaultImageClassifier(b64: string): Promise<ImageDecision> {
  const res = await anthropic.messages.parse({
    model: MOD_MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system: IMAGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: "Moderate this photo." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ImageOut) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("moderation: no parsed output");
  return parsed;
}

export async function moderateImage(
  jpeg: Buffer,
  deps: { classify?: (b64: string) => Promise<ImageDecision>; spend?: () => Promise<boolean>; enabled?: boolean } = {},
): Promise<{ decision: "ok" | "review" | "block"; category: ImageCategory; note?: string }> {
  const enabled = deps.enabled ?? Boolean(process.env.ANTHROPIC_API_KEY);
  if (!enabled) return { decision: "review", category: "none", note: "classifier off" };
  const canSpend = deps.spend ? await deps.spend() : true;
  if (!canSpend) return { decision: "review", category: "none", note: "daily budget spent" };
  try {
    const c = await (deps.classify ?? defaultImageClassifier)(jpeg.toString("base64"));
    let decision = c.decision;
    // The model may be lenient on these: they never pass as "ok" on its word alone.
    if (decision === "ok" && (c.category === "minor" || c.category === "personal_data" || c.category === "nudity" || c.category === "sexual")) {
      decision = "review";
    }
    return { decision, category: c.category, note: c.why };
  } catch (err) {
    return { decision: "review", category: "none", note: `classifier failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Final verdict for a post with text and photo: block if any blocks, review if any reviews, else ok.
export function combineVerdicts(
  a: { decision: "ok" | "review" | "block" },
  b: { decision: "ok" | "review" | "block" } | null,
): "ok" | "review" | "block" {
  const ds = b ? [a.decision, b.decision] : [a.decision];
  if (ds.includes("block")) return "block";
  if (ds.includes("review")) return "review";
  return "ok";
}
