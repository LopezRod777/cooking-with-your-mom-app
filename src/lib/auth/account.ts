// Whose data a tab believes it holds, said on every API call. The cookie belongs to the whole browser: when another tab
// signs somebody else in, this one must not read or write as them.
export const ACCOUNT_HEADER = "x-cwym-user";

export function otherAccount(headers: Headers, userId: string): Response | null {
  const claimed = headers.get(ACCOUNT_HEADER);
  return claimed && claimed !== userId ? Response.json({ error: "other_account" }, { status: 403 }) : null;
}

// The account this document was rendered for. Set once and never changed: a call that started with one person's data
// keeps saying so even if somebody else is signed in by the time it leaves.
let pinned: string | null = null;

export function pinDocument(userId: string): string {
  if (typeof window === "undefined") return userId; // the server renders for many: nothing is kept there
  pinned ??= userId;
  return pinned;
}

export const documentAccount = () => pinned;

// Wraps fetch so our own /api calls carry the account; everything else goes through untouched.
export function withAccount(real: typeof fetch, account: () => string | null, origin: string): typeof fetch {
  return (input, init) => {
    const id = account();
    if (id === null) return real(input, init);
    const asked = input instanceof Request ? input : null;
    const url = new URL(asked ? asked.url : String(input), origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return real(input, init);
    const headers = new Headers(init?.headers ?? asked?.headers);
    if (!headers.has(ACCOUNT_HEADER)) headers.set(ACCOUNT_HEADER, id);
    return real(input, { ...init, headers });
  };
}
