"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { rememberUser } from "@/lib/store";

// Whose week the no-signal screens may open: written when Clerk confirms someone, erased when Clerk, with signal, says
// nobody is signed in. Lives in the signed-in pages and at the door (sign-in, sign-up, waitlist), never in /offline.
export function RememberUser() {
  const { isLoaded, userId } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    if (userId) rememberUser(userId);
    else if (navigator.onLine) rememberUser(null);
  }, [isLoaded, userId]);
  return null;
}
