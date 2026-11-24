// When this browser last looked at the table. Per device, in localStorage; the dot on the bubble compares against it.
export const SEEN_KEY = "cwym:community:seen";
export const SEEN_EVENT = "cwym:community-seen";

export function getSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markSeen(iso = new Date().toISOString()): void {
  try {
    localStorage.setItem(SEEN_KEY, iso);
  } catch {
    // storage blocked: the dot just stays until next time
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}
