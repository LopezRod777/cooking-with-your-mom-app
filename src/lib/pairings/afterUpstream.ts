import { requirePairingsGate } from "./cookie";

// Gate re-check after a Kroger call. A session locked while Kroger answered gets its 403 instead of the answer.
// Returns null when the gate is still open.
export async function afterUpstream(): Promise<Response | null> {
  const after = await requirePairingsGate();
  if (!(after instanceof Response)) return null;
  after.headers.set("Cache-Control", "private, no-store");
  return after;
}
