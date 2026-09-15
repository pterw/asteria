"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, type StarDto } from "@/lib/astral";
import { calendarDate } from "@/lib/time";

/** The almanac: which nights have light. Pick one and the sky attends to it. */
export default function Almanac({ stars, now, timeZone, day, onPick }: {
  stars: StarDto[]; now: Date; timeZone: string; day: string; onPick: (day: string) => void;
}) {
  const todayKey = dayKey(now, timeZone);
  const [offset, setOffset] = useState(0);
  const month = useMemo(() => { const t = calendarDate(todayKey); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1)); }, [offset, todayKey]);
  const nights = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stars) { const key = dayKey(new Date(s.createdAt), timeZone); map.set(key, (map.get(key) || 0) + 1); }
    return map;
  }, [stars, timeZone]);
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const padding = (month.getUTCDay() + 6) % 7;
  const prefix = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthNights = [...nights.keys()].filter(k => k.startsWith(prefix)).length;
  const label = (key: string) => calendarDate(key).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  return <div className="almanac">
    <div className="almanac-head">
      <h3>{month.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</h3>
      <div>
        <button className="icon-button" onClick={() => setOffset(o => o - 1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <button className="icon-button" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
    </div>
    <div className="almanac-grid">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span className="almanac-weekday" key={`w${i}`}>{d}</span>)}
      {Array.from({ length: padding }, (_, i) => <span key={`p${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const key = `${prefix}-${String(i + 1).padStart(2, "0")}`;
        const count = nights.get(key) || 0, future = key > todayKey;
        return <button key={key} disabled={future} data-almanac-day={count ? key : undefined}
          className={`${count ? "lit" : ""} ${key === todayKey ? "today" : ""} ${key === day ? "chosen" : ""}`}
          onClick={() => onPick(key === day ? "" : key)}
          aria-label={`${label(key)}${count ? `, ${count} moment${count > 1 ? "s" : ""}` : ", no moments"}`}
          title={count ? `${count} moment${count > 1 ? "s" : ""} — show them in the sky` : "No moments"}>
          {i + 1}{!!count && <i />}
        </button>;
      })}
    </div>
    <p className="almanac-foot"><b>{monthNights}</b> {monthNights === 1 ? "night" : "nights"} with light this month</p>
  </div>;
}
