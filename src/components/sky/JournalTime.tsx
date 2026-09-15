"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
const JournalTime = createContext("UTC");
/** Start with UTC on both server and first hydration, then adopt this browser's timezone. */
export function JournalTimeProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZone] = useState("UTC");
  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); }, []);
  return <JournalTime.Provider value={timeZone}>{children}</JournalTime.Provider>;
}
export function useJournalTime() { return useContext(JournalTime); }
