import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

export const MOM_BREAK_MESSAGE = "Mama is taking a break. Try again in a bit.";

// Logs the real provider message server-side under a short request id. The client gets only the id, never the detail.
export function aiErrorResponse(err: unknown): Response {
  const requestId = randomBytes(4).toString("hex");
  if (err instanceof Anthropic.APIError) {
    console.error(`[ai] Anthropic API error ${err.status} requestId=${requestId}`, err.message);
  } else {
    console.error(`[ai] generation failed requestId=${requestId}`, err);
  }
  return Response.json({ error: MOM_BREAK_MESSAGE, requestId }, { status: 502 });
}
