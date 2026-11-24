"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { documentAccount, pinDocument, withAccount } from "@/lib/auth/account";
import { readLastUser } from "@/lib/store";
import { useAccount, useForeign } from "@/lib/useAppState";
import { Button } from "../ui/Button";

// Before any screen asks for anything. Once per document.
if (typeof window !== "undefined" && !("__cwymAccount" in window)) {
  Object.assign(window, { __cwymAccount: true });
  window.fetch = withAccount(window.fetch.bind(window), documentAccount, window.location.origin);
}

const RELOADED_KEY = "cwym:account-reload";

// Once per disagreement, not a loop: if the server and Clerk keep saying different people, a button stays instead.
function reloadOnce(pair: string) {
  try {
    if (window.sessionStorage.getItem(RELOADED_KEY) === pair) return;
    window.sessionStorage.setItem(RELOADED_KEY, pair);
  } catch {
    return; // no storage, no way to tell a loop: the button stays
  }
  window.location.reload();
}

function agreed() {
  try {
    window.sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Nothing was kept there.
  }
}

// One document, one account: the one the server rendered it for. When another takes the browser the whole page is loaded
// again, so nothing typed, read, queued or still on its way for one person outlives the change. Until it is known who is
// here, everything stays out of sight (dialogs too); the same person coming back finds it as it was.
export function AccountScope({ userId, children }: { userId: string; children: ReactNode }) {
  const account = useAccount();
  const foreign = useForeign();
  const [pinned] = useState(() => pinDocument(userId));
  const [seen, setSeen] = useState(false);
  if (!seen && account === pinned) setSeen(true);
  const other = userId !== pinned ? userId : foreign;
  const away = other !== null || (seen && account === null);

  useEffect(() => {
    if (other !== null) reloadOnce(`${pinned}>${other}`);
    else if (account === pinned) agreed();
  }, [other, pinned, account]);

  // Back to a page the browser had kept whole: the account may have changed, or signed out, while it was away.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && readLastUser() !== pinned) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [pinned]);

  useLayoutEffect(() => {
    if (!away) return;
    document.documentElement.setAttribute("data-account-away", "");
    return () => document.documentElement.removeAttribute("data-account-away");
  }, [away]);

  return (
    <>
      {children}
      {away &&
        createPortal(
          <div data-account-note="" role="status" className="grid justify-items-start gap-4 p-6 text-[18px]">
            <p>One moment…</p>
            <Button size="md" variant="ghost" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>,
          document.body,
        )}
    </>
  );
}
