"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, Check, CircleAlert, CircleHelp, Loader2, Locate, Minus, Plus, Sparkle, X } from "lucide-react";
import SkyCanvas, { type SkyCanvasHandle } from "./SkyCanvas";
import Ledger from "./Ledger";
import Reader from "./Reader";
import Almanac from "./Almanac";
import SkyNotes from "./SkyNotes";
import Composer from "./Composer";
import TimeBar from "./TimeBar";
import Modal from "@/components/ui/Modal";
import MoodDot from "@/components/ui/MoodDot";
import { useJournalTime } from "./JournalTime";
import {
  birthOrdered, census, dayKey, EMPTY_FILTERS, filterStars, filtersActive, MOOD_KEYS, MOODS, moodCounts,
  PROMPTS, type MomentFilters, type MoodKey, type StarDto,
} from "@/lib/astral";
import { journalRequest, patchStar } from "@/lib/client-api";
import { filtersHref, readFilters } from "@/lib/navigation";

type Toast = { id: number; message: string; error?: boolean; action?: { label: string; run: () => void | Promise<void> } };
const PHASES: [number, string][] = [[5, "the late hours"], [8, "first light"], [12, "morning"], [17, "afternoon"], [20, "golden hour"], [23, "evening"]];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function Observatory({ initialStars, initialFilters, serverNow }: {
  initialStars: StarDto[]; initialFilters: MomentFilters; serverNow: string;
}) {
  const timeZone = useJournalTime();
  const [stars, setStars] = useState(initialStars);
  const [filters, setFilters] = useState<MomentFilters>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [almanacOpen, setAlmanacOpen] = useState(false), [notesOpen, setNotesOpen] = useState(false);
  const [composer, setComposer] = useState<{ star?: StarDto; date?: string } | null>(null);
  const [promptIndex, setPromptIndex] = useState(() => Math.floor(Date.now() / 86_400_000) % PROMPTS.length);
  const [toast, setToast] = useState<Toast | null>(null), [toastBusy, setToastBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => new Date(serverNow));
  const [wide, setWide] = useState(true), [viewportH, setViewportH] = useState(900);

  const canvas = useRef<SkyCanvasHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const inFlight = useRef(new Set<string>()), revision = useRef(0), exporting = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 920px)");
    const sync = () => { setWide(mq.matches); setViewportH(window.innerHeight); }; sync();
    mq.addEventListener("change", sync); window.addEventListener("resize", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("resize", sync); };
  }, []);

  // One sky. Time decides what exists; attention decides what is lit; the ledger lists exactly that.
  const sorted = useMemo(() => birthOrdered(stars), [stars]);
  const total = sorted.length;
  const born = useMemo(() => (horizon === null ? sorted : sorted.slice(0, Math.min(horizon, total))), [sorted, horizon, total]);
  const counts = useMemo(() => moodCounts(born), [born]);
  const filtered = useMemo(() => filterStars(born, filters, now, timeZone), [born, filters, now, timeZone]);
  const active = filtersActive(filters);
  const highlight = useMemo(() => (active ? new Set(filtered.map(s => s.id)) : null), [active, filtered]);
  const selected = stars.find(s => s.id === selectedId) || null;
  const readerIndex = filtered.findIndex(s => s.id === selectedId);
  const samples = stars.filter(s => s.isSample).length;
  const skyCensus = useMemo(() => census(born, timeZone), [born, timeZone]);
  const asOf = horizon === null ? null : born.length
    ? new Date(born[born.length - 1].createdAt).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" })
    : "the beginning";
  const when = horizon === null ? "Now" : born.length ? asOf! : "Before the first star";
  const detail = born.length ? `${plural(skyCensus.stars, "star", "stars")} · ${plural(skyCensus.nights, "night", "nights")} · ${plural(skyCensus.constellations, "constellation", "constellations")}` : "";

  const dockOpen = !!selected || ledgerOpen;
  const rightInset = dockOpen && wide ? 420 : 0;
  const bottomInset = dockOpen && !wide ? Math.round(viewportH * 0.62) : 0;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now));
  const phase = PHASES.find(([limit]) => hour < limit)?.[1] ?? "night";
  const framing = `${rightInset}:${bottomInset}`;
  const clock = now.toLocaleTimeString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  const localDate = now.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" });

  const notify = useCallback((message: string, error = false, action?: Toast["action"]) => setToast({ id: Date.now(), message, error, action }), []);
  const applyFilters = useCallback((patch: Partial<MomentFilters>, push = false) => {
    setFilters(prev => { const next = { ...prev, ...patch }; window.history[push ? "pushState" : "replaceState"](null, "", filtersHref(next)); return next; });
  }, []);
  const moveTime = useCallback((pos: number | null) => {
    setHorizon(pos);
    if (pos !== null) setSelectedId(id => { const i = sorted.findIndex(s => s.id === id); return i >= pos ? null : id; });
  }, [sorted]);

  // Attention is a journey: the camera travels to what the sky is being asked to show.
  useEffect(() => {
    if (active) canvas.current?.frameStars(filtered);
    else canvas.current?.resetView();
  }, [active, filters.mood, filters.day, filters.starred, filters.query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) canvas.current?.frameStars(filtered); }, [framing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pop = () => setFilters(readFilters(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (document.hidden || inFlight.current.size) return;
      const version = revision.current;
      try { const data = await journalRequest<{ stars: StarDto[] }>("/api/stars"); if (live && version === revision.current) setStars(data.stars); }
      catch { /* background sync stays silent */ }
    };
    if ("BroadcastChannel" in window) { channel.current = new BroadcastChannel("asteria-journal"); channel.current.onmessage = () => void refresh(); }
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; channel.current?.close(); channel.current = null; document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (!toast || toast.action || toast.error) return;
    const id = window.setTimeout(() => setToast(c => (c?.id === toast.id ? null : c)), 5200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openComposer = useCallback((star?: StarDto, date?: string) => {
    setSelectedId(null); setAlmanacOpen(false); setNotesOpen(false); setComposer({ star, date });
  }, []);
  const toggleMood = useCallback((mood: MoodKey) => {
    setFilters(prev => { const next: MomentFilters = { ...prev, mood: prev.mood === mood ? "all" : mood, day: "", starred: false }; window.history.pushState(null, "", filtersHref(next)); return next; });
  }, []);
  const commitStar = useCallback((star: StarDto) => {
    revision.current++;
    setStars(prev => prev.some(s => s.id === star.id) ? prev.map(s => s.id === star.id ? star : s) : [star, ...prev]);
    channel.current?.postMessage("changed");
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (composer || almanacOpen || notesOpen || event.defaultPrevented) return;
      const el = event.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSelectedId(null); setLedgerOpen(true); window.setTimeout(() => searchRef.current?.focus(), 60); return; }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n") { event.preventDefault(); openComposer(); }
      else if (event.key === "m") { event.preventDefault(); setSelectedId(null); setLedgerOpen(o => !o); }
      else if (event.key === "a") { event.preventDefault(); setAlmanacOpen(true); }
      else if (event.key === "/") { event.preventDefault(); setSelectedId(null); setLedgerOpen(true); window.setTimeout(() => searchRef.current?.focus(), 60); }
      else if (event.key === "[") { event.preventDefault(); moveTime(Math.max(0, (horizon ?? total) - 1)); }
      else if (event.key === "]") { event.preventDefault(); if (horizon !== null) moveTime(horizon + 1 >= total ? null : horizon + 1); }
      else if (event.key === "Escape") { if (selected) setSelectedId(null); else if (ledgerOpen) setLedgerOpen(false); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [composer, almanacOpen, notesOpen, ledgerOpen, selected, horizon, total, openComposer, moveTime]);

  async function favorite(star: StarDto) {
    if (inFlight.current.has(star.id)) return;
    inFlight.current.add(star.id); setPending(new Set(inFlight.current));
    try { const data = await patchStar(star.id, { favorite: !star.favorite }); commitStar(data.star); }
    catch (e) { notify(e instanceof Error ? e.message : "Couldn't update that star.", true); }
    finally { inFlight.current.delete(star.id); setPending(new Set(inFlight.current)); }
  }
  async function release(star: StarDto) {
    await journalRequest(`/api/stars/${star.id}`, { method: "DELETE" });
    revision.current++; setStars(prev => prev.filter(s => s.id !== star.id)); setSelectedId(null);
    channel.current?.postMessage("changed");
    notify("Released.", false, { label: "Undo", run: async () => { const data = await patchStar(star.id, { restore: true }); commitStar(data.star); } });
  }
  function onSaved(star: StarDto, edited: boolean) {
    commitStar(star); setComposer(null);
    if (edited) { setSelectedId(star.id); notify("Saved."); return; }
    // A new light belongs to now, and should be seen: clear time and attention, then let it arrive.
    setHorizon(null);
    setFilters(prev => { const next: MomentFilters = { ...prev, mood: "all", day: "", starred: false, query: "" }; window.history.replaceState(null, "", filtersHref(next)); return next; });
    setSelectedId(null); setLedgerOpen(false);
    window.setTimeout(() => canvas.current?.birthStar(star), 140);
    window.setTimeout(() => setSelectedId(star.id), 1750);
    notify("Hung.");
  }
  async function clearSamples() {
    const data = await journalRequest<{ removed: string[] }>("/api/journal/samples", { method: "DELETE" });
    const ids = new Set(data.removed); revision.current++;
    setStars(prev => prev.filter(s => !ids.has(s.id))); setHorizon(null);
    channel.current?.postMessage("changed"); setNotesOpen(false);
    notify("The examples are gone. Your own lights remain.");
  }
  async function download(format: "markdown" | "json") {
    if (exporting.current) return;
    exporting.current = true;
    try {
      const response = await fetch(`/api/journal/export?format=${format}&timeZone=${encodeURIComponent(timeZone)}`);
      if (!response.ok) throw new Error((await response.json()).error || "Export failed.");
      const url = URL.createObjectURL(await response.blob()), a = document.createElement("a");
      a.href = url; a.download = `asteria-${dayKey(new Date())}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify("Downloaded.");
    } catch (e) { notify(e instanceof Error ? e.message : "Export failed. Try again.", true); }
    finally { exporting.current = false; }
  }
  async function runToast() {
    if (!toast?.action || toastBusy) return;
    setToastBusy(true);
    try { await toast.action.run(); } catch (e) { notify(e instanceof Error ? e.message : "Couldn't undo that.", true); }
    finally { setToastBusy(false); setToast(null); }
  }

  return <div className="sky-root" data-phase={phase} data-dock={dockOpen} style={{ "--horizon": phase === "first light" || phase === "golden hour" ? "rgba(190,130,90,.16)" : phase === "the late hours" || phase === "night" ? "rgba(40,60,110,.18)" : "rgba(90,110,150,.12)" } as React.CSSProperties}>
    <a href="#sky-dock" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:bg-[#dfc28d] focus:px-3 focus:py-2 focus:text-black">Skip to the list of moments</a>
    <SkyCanvas ref={canvas} stars={stars} selectedId={selectedId} highlight={highlight} horizon={horizon} inset={{ right: rightInset, bottom: bottomInset }}
      onSelect={id => { setSelectedId(id); if (id && !wide) setLedgerOpen(false); }} onFocusMood={toggleMood} />

    <header className="rail">
      <div className="rail-left">
        <Link className="wordmark" href="/" title="Asteria — the story"><Sparkle size={16} /><span>asteria</span></Link>
        <p className="clock" data-testid="rail-clock"><time>{localDate} · {clock}</time><span>{phase}</span></p>
      </div>
      <div className="rail-tools">
        <button className={`rail-button ${ledgerOpen && !selected ? "on" : ""}`} onClick={() => { setSelectedId(null); setLedgerOpen(o => !o); }} aria-pressed={ledgerOpen && !selected} aria-label="Moments" title="Moments — list and search  M"><BookOpen size={17} /><span>Moments</span></button>
        <button className="rail-button" onClick={() => setAlmanacOpen(true)} aria-label="Nights" title="Nights — a calendar of your sky  A"><CalendarDays size={17} /><span>Nights</span></button>
        <button className="rail-button" onClick={() => setNotesOpen(true)} aria-label="About this sky" title="About this sky"><CircleHelp size={17} /><span>About</span></button>
        <button className="primary-button" onClick={() => openComposer(undefined, filters.day || undefined)} aria-label="Hang a star" title="Hang a star  N"><Plus size={16} /><span>Hang a star</span></button>
      </div>
    </header>

    <div className="zoom" role="group" aria-label="Zoom">
      <button className="icon-button" onClick={() => canvas.current?.zoomBy(1.3)} aria-label="Zoom in" title="Zoom in  +"><Plus size={16} /></button>
      <button className="icon-button" onClick={() => canvas.current?.zoomBy(1 / 1.3)} aria-label="Zoom out" title="Zoom out  −"><Minus size={16} /></button>
      <button className="icon-button" onClick={() => canvas.current?.resetView()} aria-label="Recentre the sky" title="Recentre  0"><Locate size={16} /></button>
    </div>

    <div className="deck">
    <nav className="legend" aria-label="Constellations">
      <button className={`legend-chip ${!active ? "on" : ""}`} onClick={() => applyFilters({ mood: "all", day: "", starred: false, query: "" }, true)}
        aria-label="All stars" aria-pressed={!active} title="Every light at once"><span className="all-dot" />All stars<b>{born.length}</b></button>
      {MOOD_KEYS.map(m => <button key={m} className={`legend-chip ${filters.mood === m ? "on" : ""} ${filters.mood !== "all" && filters.mood !== m ? "quiet" : ""}`} onClick={() => toggleMood(m)}
        aria-pressed={filters.mood === m} aria-label={MOODS[m].constellation} style={{ "--mood": MOODS[m].hex } as React.CSSProperties} title={`${MOODS[m].label} · ${MOODS[m].blurb}`}>
        <MoodDot mood={m} />{MOODS[m].constellation}<b>{counts[m]}</b></button>)}
      {filtersActive({ ...filters, mood: "all" }) && <button className="legend-chip clear" onClick={() => applyFilters({ day: "", starred: false, query: "" }, true)}><X size={13} />Clear</button>}
    </nav>
    <TimeBar total={total} position={horizon} when={when} detail={detail} onJump={moveTime} />
    </div>

    <aside id="sky-dock" className="dock" data-open={dockOpen} aria-hidden={!dockOpen}>
      {selected ? <Reader star={selected} index={readerIndex} total={filtered.length} pending={pending.has(selected.id)}
        onBack={ledgerOpen ? () => setSelectedId(null) : null} onClose={() => setSelectedId(null)}
        onEdit={() => openComposer(selected)} onFavorite={() => void favorite(selected)} onRelease={() => release(selected)}
        onNavigate={offset => { const next = filtered[readerIndex + offset]; if (next) setSelectedId(next.id); }} />
        : <Ledger all={born} stars={filtered} filters={filters} selectedId={selectedId} pending={pending} timeZone={timeZone} asOf={asOf}
          onQuery={q => applyFilters({ query: q })} onPatch={patch => applyFilters(patch)} onClear={() => applyFilters(EMPTY_FILTERS, true)}
          onSelect={star => setSelectedId(star.id)} onFavorite={star => void favorite(star)} onCapture={() => openComposer()} inputRef={searchRef} />}
    </aside>

    {composer && <Composer key={composer.star?.id || "new"} onClose={() => setComposer(null)} onSaved={onSaved} star={composer.star} prompt={PROMPTS[promptIndex]} defaultDate={composer.date} />}
    <Modal open={almanacOpen} onClose={() => setAlmanacOpen(false)} title="Nights" description="The nights that have light. Pick one and the sky attends to it." className="almanac-modal">
      <Almanac stars={stars} now={now} timeZone={timeZone} day={filters.day} onPick={day => { setHorizon(null); applyFilters({ day, mood: "all", starred: false }, true); setAlmanacOpen(false); setSelectedId(null); setLedgerOpen(true); }} />
      <div className="almanac-prompt">
        <p>Nothing hung tonight yet?</p>
        <button className="ghost-button" onClick={() => { setAlmanacOpen(false); setPromptIndex(i => (i + 1) % PROMPTS.length); openComposer(); }}>{PROMPTS[(promptIndex + 1) % PROMPTS.length]}</button>
      </div>
    </Modal>
    <Modal open={notesOpen} onClose={() => setNotesOpen(false)} title="About this sky" description="How to read it, where it lives, and how to take it with you." className="notes-modal">
      <SkyNotes onClose={() => setNotesOpen(false)} samples={samples} timeZone={timeZone} clock={clock} onExport={download} onClearSamples={clearSamples} />
    </Modal>

    {toast && <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"} aria-live={toast.error ? "assertive" : "polite"}>
      {toast.error ? <CircleAlert size={15} /> : <Check size={15} />}
      <span>{toast.message}</span>
      {toast.action && <button onClick={() => void runToast()} disabled={toastBusy}>{toastBusy ? <Loader2 className="animate-spin" size={12} /> : null}{toast.action.label}</button>}
      <button className="icon-button small" onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button>
    </div>}
  </div>;
}
