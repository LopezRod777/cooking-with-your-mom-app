"use client";

import type { ReactNode } from "react";
import { forgetLocalCache } from "@/lib/store";

// Around a Clerk sign-out button at the door: this device keeps nothing of the account.
export function ForgetOnSignOut({ children }: { children: ReactNode }) {
  return (
    <span className="contents" onClickCapture={() => forgetLocalCache()}>
      {children}
    </span>
  );
}
