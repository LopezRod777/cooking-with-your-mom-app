// Reads a JSON body without ever holding more than maxBytes, so a huge body cannot grow memory or an AI prompt.
// null = too large, empty or not JSON; routes answer it like any invalid body.
export const AI_BODY_MAX_BYTES = 64 * 1024;

export async function readJsonCapped(req: Request, maxBytes = AI_BODY_MAX_BYTES): Promise<unknown> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return null;
  }
}
