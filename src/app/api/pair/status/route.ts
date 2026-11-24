import { requirePairingsGate } from "../../../../lib/pairings/cookie";

const NO_STORE = "private, no-store";

export async function GET() {
  const gate = await requirePairingsGate();
  const unlocked = !(gate instanceof Response);
  return Response.json({ unlocked }, { headers: { "Cache-Control": NO_STORE } });
}
