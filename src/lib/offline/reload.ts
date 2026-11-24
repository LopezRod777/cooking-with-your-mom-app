import { getSnapshot } from "../store";

const RELOADED = "cwym:offline-reload";
const FIRST_WAIT_MS = 30_000;
const LONGEST_WAIT_MS = 10 * 60_000;

// Automatic reloads wait longer each time (30 s, 1 min, 2 min… 10 min) until the real app loads, so a network that only
// looks alive never loops. None while an edit does not fit on this device or two
// versions wait for a choice, and none without the mark.
export function reloadOnceInAWhile(): void {
  const { saveError, sync } = getSnapshot();
  if (saveError !== null || sync.conflict !== null) return; // something here waits for the person
  try {
    const { at = 0, n = 0 } = JSON.parse(sessionStorage.getItem(RELOADED) ?? "{}") as { at?: number; n?: number };
    if (Date.now() - at < Math.min(FIRST_WAIT_MS * 2 ** Math.max(0, n - 1), LONGEST_WAIT_MS)) return;
    sessionStorage.setItem(RELOADED, JSON.stringify({ at: Date.now(), n: n + 1 }));
  } catch {
    return;
  }
  window.location.reload();
}

export function appLoaded(): void {
  try {
    sessionStorage.removeItem(RELOADED);
  } catch {
    // Nothing to clear.
  }
}
