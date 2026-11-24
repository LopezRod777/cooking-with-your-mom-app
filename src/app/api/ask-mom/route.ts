import { readJsonCapped } from "../../../lib/http/readJsonCapped";
import { isAdminEmail, requireUser } from "@/lib/auth/requireUser";
import { z } from "zod";
import { quotaExceededResponse, reserveAiQuota } from "@/lib/ai/dailyQuota";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { anthropic, MODEL } from "@/lib/ai/client";
import { ASK_MOM_SYSTEM, allergyLines } from "@/lib/ai/prompts";
import { Recipe } from "@/lib/schemas";

export const maxDuration = 300;

// Protocol with the client (AskMom.tsx):
// - Provider error before any text: HTTP 502 JSON { error }, nothing streamed.
// - Success: HTTP 200, text/plain, header X-Mom-Status: ok.
// - Provider error after streaming started: the text is followed by MOM_ERROR_MARK and the stream ends.
export const MOM_ERROR = "Mama stepped away. Try again.";
export const MOM_ERROR_MARK = "\n[[mom-error]]";

const Body = z.object({
  recipe: Recipe,
  stepIndex: z.number().int().min(0),
  question: z.string().trim().min(1).max(400),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(10),
  allergies: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  dislikes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});

function recipeContext(recipe: z.infer<typeof Recipe>, stepIndex: number): string {
  const ingredients = recipe.ingredients.map((i) => `- ${i.display}`).join("\n");
  const steps = recipe.steps
    .map((s, i) => `${i === stepIndex ? ">> " : "   "}${i + 1}. ${s.text}`)
    .join("\n");
  const current = recipe.steps[stepIndex];
  return [
    `Recipe: ${recipe.title} (${recipe.cuisine}, serves ${recipe.servings}).`,
    `Ingredients:\n${ingredients}`,
    `Steps (the student is on step ${stepIndex + 1}, marked >>):\n${steps}`,
    current ? `Current step: ${current.text}` : "The student is not on a valid step.",
  ].join("\n\n");
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await readJsonCapped(req));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isAdminEmail(u.email) && !(await reserveAiQuota(u.userId, "ask-mom"))) return quotaExceededResponse();
  const { recipe, stepIndex, question, history, allergies = [], dislikes = [] } = parsed.data;
  const constraints = [
    allergies.length ? `Never suggest (allergies, absolute): ${allergyLines(allergies).join("; ")}.` : "",
    dislikes.length ? `Avoid if possible (dislikes): ${dislikes.join(", ")}.` : "",
  ].filter(Boolean);
  const encoder = new TextEncoder();

  // Wait for the first event before answering: a provider error that arrives this early
  // becomes a real HTTP 502 instead of prose with status 200.
  let llm: ReturnType<typeof anthropic.messages.stream>;
  let events: AsyncIterator<RawMessageStreamEvent>;
  let first: IteratorResult<RawMessageStreamEvent>;
  try {
    llm = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 400,
      output_config: { effort: "low" },
      system: [ASK_MOM_SYSTEM, recipeContext(recipe, stepIndex), ...constraints].join("\n\n"),
      messages: [...history, { role: "user", content: question }],
    });
    events = llm[Symbol.asyncIterator]();
    first = await events.next();
  } catch (err) {
    console.error("[ask-mom] request failed", err);
    return Response.json({ error: MOM_ERROR }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let next = first;
        while (!next.done) {
          const event = next.value;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
          next = await events.next();
        }
        await llm.finalMessage();
        controller.close();
      } catch (err) {
        console.error("[ask-mom] stream failed", err);
        controller.enqueue(encoder.encode(MOM_ERROR_MARK));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Mom-Status": "ok",
    },
  });
}
