"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useContext, useMemo, type ReactNode } from "react";

type Session = Pick<ReturnType<typeof useAuth>, "isLoaded" | "isSignedIn" | "userId" | "sessionId">;

const SessionContext = createContext<Session>({ isLoaded: false, isSignedIn: undefined, userId: undefined, sessionId: undefined } as Session);

// Clerk's session for components the no-signal screens also use: those have no ClerkProvider and see "not known".
export function SessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const value = useMemo(() => ({ isLoaded, isSignedIn, userId, sessionId }) as Session, [isLoaded, isSignedIn, userId, sessionId]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
