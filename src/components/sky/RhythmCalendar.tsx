"use client";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Moon } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useJournalTime } from "./JournalTime";
import { dayKey, type StarDto } from "@/lib/astral";
import { calendarDate, shiftDay } from "@/lib/time";

export default function RhythmCalendar({ stars, now, onDay, compact = false }: { stars: StarDto[]; now: string; onDay: (day: string) => void; compact?: boolean }) {
  const timeZone = useJournalTime();
  const todayKey = dayKey(new Date(now), timeZone), today = calendarDate(todayKey);
  const [monthOffset, setMonthOffset] = useState(0), [calendarOpen, setCalendarOpen] = useState(false);
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthOffset, 1));
  const nights = useMemo(() => new Set(stars.map(s => dayKey(new Date(s.createdAt), timeZone))), [stars, timeZone]);
  const count = [...nights].filter(k => k.startsWith(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`)).length;
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const padding = (month.getUTCDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(todayKey, i - 6));
  function choose(key: string) { setCalendarOpen(false); onDay(key); }
  const formatDay = (key: string) => calendarDate(key).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const monthPanel = <section className="rhythm-panel" aria-label="Your journal calendar">
    {!compact && <h2 className="rhythm-title"><Moon size={13} />A rhythm of returning</h2>}
    <div className="calendar-header"><span>{month.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</span><div>
      <button className="icon-button" onClick={() => setMonthOffset(offset => offset - 1)} aria-label="Previous month"><ChevronLeft size={12} /></button>
      <button className="icon-button" onClick={() => setMonthOffset(offset => offset + 1)} disabled={monthOffset === 0} aria-label="Next month"><ChevronRight size={12} /></button>
    </div></div>
    <div className="calendar-grid">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span className="calendar-weekday" key={`day-${i}`}>{d}</span>)}
      {Array.from({ length: padding }, (_, i) => <span key={`pad-${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, has = nights.has(key), isToday = key === todayKey;
        return <button key={key} className={`calendar-day ${has ? "has-moment" : ""} ${isToday ? "today" : ""}`}
          disabled={key > todayKey} onClick={() => choose(key)} title={`${formatDay(key)}${has ? " · Moments to revisit" : " · No moments yet"}`}
          aria-label={`${formatDay(key)}${has ? ", has moments" : ", no moments"}`} aria-current={isToday ? "date" : undefined}>{i + 1}</button>;
      })}
    </div>
    <p className="calendar-footer"><span className="mood-dot" />{count} {count === 1 ? "day" : "days"} remembered this month</p>
  </section>;
  if (!compact) return monthPanel;
  return <>
    <section className="rhythm-panel compact" aria-label="Your weekly journal rhythm">
      <div className="week-heading"><h2 className="rhythm-title"><Moon size={13} />A rhythm of returning</h2><button className="icon-button" title="Open your calendar" aria-label="Open your calendar" onClick={() => setCalendarOpen(true)}><CalendarDays size={13} /></button></div>
      <p className="week-subtitle">A little presence, this past week.</p>
      <div className="week-strip">{week.map(key => { const has = nights.has(key); return <button className="week-day" key={key} onClick={() => choose(key)} aria-label={`Revisit ${formatDay(key)}`} title={has ? "A day to revisit" : "No moments yet"}>
        <span>{calendarDate(key).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }).slice(0, 1)}</span><i className={`${has ? "has-moment" : ""} ${key === todayKey ? "today" : ""}`}>{has ? <span /> : <small>·</small>}</i>
      </button>; })}</div>
      <p className="week-footer"><span className="mood-dot" />{week.filter(key => nights.has(key)).length} days, a little more remembered.</p>
    </section>
    <Modal open={calendarOpen} onClose={() => setCalendarOpen(false)} title="Your days, illuminated." description="Choose a day to find your way back to its moments." className="calendar-modal">{monthPanel}</Modal>
  </>;
}
