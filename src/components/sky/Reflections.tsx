"use client";
import { useMemo, useState } from "react";
import { ArrowDownToLine, BookOpen, CalendarDays, Sparkles } from "lucide-react";
import MoodDot from "@/components/ui/MoodDot";
import { useJournalTime } from "./JournalTime";
import { calendarDate } from "@/lib/time";
import { computeStats, dayKey, EMPTY_FILTERS, filterStars, MOOD_KEYS, MOODS, moodCounts, type MoodKey, type Period, type StarDto } from "@/lib/astral";

export default function Reflections({ stars, now, onMood, onDay, onExport }: {
  stars: StarDto[]; now: string; onMood: (mood: MoodKey) => void; onDay: (day: string) => void; onExport: () => void;
}) {
  const [period, setPeriod] = useState<Period>("all");
  const timeZone = useJournalTime();
  const instant = useMemo(() => new Date(now), [now]);
  const date = useMemo(() => calendarDate(dayKey(instant, timeZone)), [instant, timeZone]);
  const subset = useMemo(() => filterStars(stars, { ...EMPTY_FILTERS, period }, instant, timeZone), [stars, period, instant, timeZone]);
  const counts = moodCounts(subset), stats = computeStats(subset, instant, timeZone);
  const ranked = [...MOOD_KEYS].sort((a, b) => counts[b] - counts[a]), dominant = ranked[0];
  const tied = counts[ranked[0]] === counts[ranked[1]];
  const nights = new Map<string, number>();
  stars.forEach(s => { const key = dayKey(new Date(s.createdAt), timeZone); nights.set(key, (nights.get(key) || 0) + 1); });
  const start = new Date(date); start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 77);
  const days = Array.from({ length: 84 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d; });
  const circumference = 2 * Math.PI * 52;
  let accumulated = 0;
  return <section className="page-enter" aria-label="Journal reflections">
    <div className="library-toolbar"><p className="toolbar-note">Not a score. A small look back.</p><select className="filter-select" value={period} onChange={e => setPeriod(e.target.value as Period)} aria-label="Reflection period"><option value="all">All time</option><option value="month">This month</option><option value="week">Past 7 days</option></select></div>
    <div className="reflection-stats">
      <div className="reflection-stat"><p className="eyebrow"><Sparkles size={15} />Little lights kept</p><strong>{stats.stars}</strong><p>Moments you made room for.</p></div>
      <div className="reflection-stat"><p className="eyebrow"><CalendarDays size={15} />Days remembered</p><strong>{stats.nights}</strong><p>Ordinary days, held a little closer.</p></div>
      <div className="reflection-stat"><p className="eyebrow"><BookOpen size={15} />Feelings collected</p><strong>{MOOD_KEYS.filter(m => counts[m]).length}<span className="text-lg text-[#626c80]"> / 6</span></strong><p>Every shade belongs in your sky.</p></div>
    </div>
    <div className="reflection-grid">
      <section className="reflection-panel">
        <h2>The colors of your days</h2><p>The feelings you chose for these moments.</p>
        <div className="mood-distribution">
          <div className="mood-ring"><svg viewBox="0 0 130 130" role="img" aria-label={`Feeling distribution across ${subset.length} moments`}>
            <circle cx="65" cy="65" r="52" stroke="#252936" strokeWidth="8" fill="none" />
            {MOOD_KEYS.map(m => {
              const fraction = subset.length ? counts[m] / subset.length : 0;
              const offset = -accumulated * circumference; accumulated += fraction;
              return fraction ? <circle key={m} cx="65" cy="65" r="52" stroke={MOODS[m].hex} strokeWidth="8" strokeLinecap="round" fill="none" strokeDasharray={`${Math.max(0, fraction * circumference - 5)} ${circumference}`} strokeDashoffset={offset} /> : null;
            })}
          </svg><div><strong>{subset.length}</strong><small>little lights</small></div></div>
          <ul>{MOOD_KEYS.map(m => <li key={m}><button onClick={() => onMood(m)} aria-label={`Explore ${MOODS[m].label.toLowerCase()} moments`}><MoodDot mood={m} />{MOODS[m].label}<span>{counts[m]} · {subset.length ? Math.round(counts[m] / subset.length * 100) : 0}%</span></button></li>)}</ul>
        </div>
        <div className="reflection-caption">{subset.length ? tied ? "A sky with room for every feeling." : <>A little more <span style={{ color: MOODS[dominant].hex }}>{MOODS[dominant].label.toLowerCase()}</span>, a little more you.</> : "The color will come. There's no hurry."}</div>
      </section>
      <section className="reflection-panel">
        <h2>Showing up, softly</h2><p>The last 12 weeks. Every little square is a day.</p>
        <div className="heatmap" aria-label="Journal activity over the last twelve weeks">{days.map(d => {
          const key = dayKey(d, "UTC"), count = nights.get(key) || 0, future = key > dayKey(date, "UTC");
          return <button key={key} className={count ? "recorded" : ""} disabled={future} onClick={() => onDay(key)} title={`${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}: ${count} moments`}
            aria-label={`${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}, ${count} moments`} style={count > 1 ? { background: "#e4c68f" } : undefined} />;
        })}</div>
        <div className="heatmap-legend"><span>{start.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })} — {date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</span><span><i />A day remembered</span></div>
        <div className="reflection-caption">The spaces in between are part of the story, too.</div>
      </section>
    </div>
    <section className="export-strip"><ArrowDownToLine size={23} /><div><h3>Your words. Yours to keep.</h3><p>Take your journal with you, as a simple, readable Markdown file.</p></div><button className="secondary-button" onClick={onExport}>Export my journal<ArrowDownToLine size={12} /></button></section>
  </section>;
}
