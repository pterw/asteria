"use client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/**
 * The writer's timezone.
 *
 * The server cannot know it and the browser knows it immediately, which is the classic shape
 * of a hydration mismatch. `useSyncExternalStore` is built for exactly this: the server
 * snapshot is UTC, the client snapshot is the real zone, and React swaps them after hydration
 * without a state update in an effect (which would have rendered the whole sky twice).
 */
const JournalTime = createContext("UTC");

const subscribe = () => () => {};
const readTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverTimeZone = () => "UTC";

export function JournalTimeProvider({ children }: { children: ReactNode }) {
  const timeZone = useSyncExternalStore(subscribe, readTimeZone, serverTimeZone);
  return <JournalTime.Provider value={timeZone}>{children}</JournalTime.Provider>;
}
export function useJournalTime() { return useContext(JournalTime); }
