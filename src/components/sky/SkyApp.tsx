"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, CircleAlert, Loader2, LockKeyhole, Moon, Orbit, PanelLeft, Plus, Search, Sparkle, Sparkles, Waypoints, X } from "lucide-react";
import dynamic from "next/dynamic";
import Sidebar from "./Sidebar";
import SkyMap from "./SkyMap";
import RhythmCalendar from "./RhythmCalendar";
import MomentCard from "./MomentCard";
import MomentLibrary from "./MomentLibrary";
import TimeBar from "./TimeBar";
import { useJournalTime } from "./JournalTime";
import Modal from "@/components/ui/Modal";
import { type SkyCanvasHandle } from "./SkyCanvas";
import { birthOrdered, census, computeStats, dayKey, EMPTY_FILTERS, filterStars, MOOD_KEYS, MOODS, moodCounts, PROMPTS, type MomentFilters, type MoodKey, type StarDto, type View } from "@/lib/astral";
import { journalRequest, patchStar } from "@/lib/client-api";
import { readWorkspaceLocation, workspaceHref } from "@/lib/navigation";

// Code splitting: dynamically import heavy modals and sub-views to reduce initial bundle
const Reflections = dynamic(() => import("./Reflections"), { ssr: false });
const Composer = dynamic(() => import("./Composer"), { ssr: false });
const StarCard = dynamic(() => import("./StarCard"), { ssr: false });
const JournalSettings = dynamic(() => import("./JournalSettings"), { ssr: false });
const KeyboardShortcutsModal = dynamic(() => import("@/components/ui/KeyboardShortcutsModal"), { ssr: false });

type Toast = { id: number; message: string; error?: boolean; action?: { label: string; run: () => void | Promise<void> } };
const TITLES: Record<View, string> = { sky: "Your sky", memories: "All moments", reflections: "Reflections", starred: "Starred moments" };

export default function SkyApp({ initialStars, now: initialNow, initialView = "sky", initialFilters = EMPTY_FILTERS }: {
  initialStars: StarDto[]; now: string; initialView?: View; initialFilters?: MomentFilters;
}) {
  const timeZone = useJournalTime();
  const [now, setNow] = useState(initialNow);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date().toISOString()), 60_000); return () => window.clearInterval(timer); }, []);
  const [stars, setStars] = useState(initialStars), [view, setView] = useState<View>(initialView);
  const [filters, setFilters] = useState<MomentFilters>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number | null>(null);
  const [composer, setComposer] = useState<{ star?: StarDto; date?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [expanded, setExpanded] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0), [toast, setToast] = useState<Toast | null>(null), [toastBusy, setToastBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>()), revision = useRef(0), exporting = useRef(false);
  const canvasRef = useRef<SkyCanvasHandle | null>(null), expandedCanvas = useRef<SkyCanvasHandle | null>(null), searchRef = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const date = useMemo(() => new Date(now), [now]);
  // Time decides what exists: the horizon is how many stars, in birth order, are born.
  const sorted = useMemo(() => birthOrdered(stars), [stars]);
  const total = sorted.length;
  const born = useMemo(() => (horizon === null ? sorted : sorted.slice(0, Math.min(horizon, total))), [sorted, horizon, total]);
  const skyCensus = useMemo(() => census(born, timeZone), [born, timeZone]);
  const asOf = horizon === null ? null : born.length
    ? new Date(born[born.length - 1].createdAt).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" })
    : "the beginning";
  const when = horizon === null ? "Now" : born.length ? asOf! : "Before the first star";
  const detail = born.length
    ? `${skyCensus.stars} ${skyCensus.stars === 1 ? "star" : "stars"} · ${skyCensus.nights} ${skyCensus.nights === 1 ? "night" : "nights"} · ${skyCensus.constellations} ${skyCensus.constellations === 1 ? "constellation" : "constellations"}`
    : "";
  const moveTime = useCallback((pos: number | null) => {
    setHorizon(pos);
    if (pos !== null) setSelectedId(id => { const i = sorted.findIndex(s => s.id === id); return i >= pos ? null : id; });
  }, [sorted]);

  const stats = useMemo(() => computeStats(born, date, timeZone), [born, date, timeZone]);
  const counts = useMemo(() => moodCounts(born), [born]);
  const filtered = useMemo(() => filterStars(born, filters, date, timeZone), [born, filters, date, timeZone]);
  const selected = born.find(s => s.id === selectedId) || null;
  const readerIndex = filtered.findIndex(s => s.id === selectedId);
  const samples = stars.filter(s => s.isSample).length;
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const notify = useCallback((message: string, error = false, action?: Toast["action"]) => setToast({ id: Date.now(), message, error, action }), []);

  const navigate = useCallback((nextView: View, patch: Partial<MomentFilters> = {}) => {
    const next = { ...EMPTY_FILTERS, ...patch, starred: nextView === "starred" };
    setView(nextView); setFilters(next); setSelectedId(null); setSidebarOpen(false);
    window.history.pushState(null, "", workspaceHref(nextView, next));
  }, []);
  const updateFilter = useCallback((patch: Partial<MomentFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); window.history.replaceState(null, "", workspaceHref(view, next));
  }, [filters, view]);
  const openComposer = useCallback((star?: StarDto, chosenDate?: string) => {
    // The invitation used to be a card in the rail. It now arrives with the composer instead,
    // turning to the next prompt each time you sit down to write something new.
    if (!star) setPromptIndex(index => (index + 1) % PROMPTS.length);
    setSelectedId(null); setExpanded(false); setSidebarOpen(false); setComposer({ star, date: chosenDate });
  }, []);
  const openStar = useCallback((star: StarDto) => { setExpanded(false); setSelectedId(star.id); }, []);
  const selectFromMap = useCallback((id: string | null) => { if (id) { setExpanded(false); setSelectedId(id); } }, []);
  const commitStar = useCallback((star: StarDto) => {
    revision.current++;
    setStars(previous => previous.some(s => s.id === star.id) ? previous.map(s => s.id === star.id ? star : s) : [star, ...previous]);
    channel.current?.postMessage("changed");
  }, []);

  // Keep browser back/forward meaningful without a server round trip for every filter.
  useEffect(() => {
    const pop = () => { const location = readWorkspaceLocation(new URLSearchParams(window.location.search)); setView(location.view); setFilters(location.filters); setSelectedId(null); };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, []);
  // Synchronise other tabs without broadcasting private journal contents.
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (document.hidden || inFlight.current.size) return;
      const version = revision.current;
      try {
        const data = await journalRequest<{ stars: StarDto[] }>("/api/stars");
        if (live && version === revision.current) setStars(data.stars);
      } catch { /* Explicit user actions surface errors; background refresh doesn't interrupt writing. */ }
    };
    if ("BroadcastChannel" in window) { channel.current = new BroadcastChannel("asteria-journal"); channel.current.onmessage = () => void refresh(); }
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; channel.current?.close(); channel.current = null; document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const isMobile = typeof window !== "undefined" && window.innerWidth <= 760;
      if (composer || selected || helpOpen || settingsOpen || expanded || (isMobile && sidebarOpen) || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); openComposer(); }
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === "g") navigate("sky");
      if (event.key.toLowerCase() === "j") navigate("memories");
      if (event.key === "?") setHelpOpen(true);
      if (view === "sky") {
        if (event.key === "[") {
          event.preventDefault();
          const currentPos = horizon ?? total;
          if (currentPos > 0) moveTime(currentPos - 1);
        }
        if (event.key === "]") {
          event.preventDefault();
          const currentPos = horizon ?? total;
          if (currentPos < total) moveTime(currentPos + 1 >= total ? null : currentPos + 1);
        }
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [composer, selected, helpOpen, settingsOpen, expanded, sidebarOpen, openComposer, navigate, view, horizon, total, moveTime]);
  useEffect(() => {
    if (!toast || toast.action || toast.error) return;
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function favorite(star: StarDto) {
    if (inFlight.current.has(star.id)) return;
    inFlight.current.add(star.id); setPending(new Set(inFlight.current));
    try {
      const data = await patchStar(star.id, { favorite: !star.favorite }); commitStar(data.star);
      notify(star.favorite ? "Removed from starred. Still shining in your sky." : "A little light, kept close.");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update this moment.", true); }
    finally { inFlight.current.delete(star.id); setPending(new Set(inFlight.current)); }
  }
  async function release(star: StarDto) {
    await journalRequest(`/api/stars/${star.id}`, { method: "DELETE" });
    revision.current++; setStars(previous => previous.filter(s => s.id !== star.id)); setSelectedId(null); channel.current?.postMessage("changed");
    notify("A little light, gently released.", false, { label: "Undo", run: async () => {
      const data = await patchStar(star.id, { restore: true }); commitStar(data.star); notify("Right back where it belongs.");
    } });
  }
  function saved(star: StarDto, edited: boolean) {
    commitStar(star); setComposer(null);
    if (edited) { setSelectedId(star.id); notify("Same little light. A few new words."); }
    else {
      navigate("sky");
      window.setTimeout(() => canvasRef.current?.birthStar(star), 180);
      notify("A new light in your sky.", false, { label: "Read it", run: () => setSelectedId(star.id) });
    }
  }
  async function clearSamples() {
    const data = await journalRequest<{ removed: string[] }>("/api/journal/samples", { method: "DELETE" });
    const ids = new Set(data.removed); revision.current++; setStars(previous => previous.filter(s => !ids.has(s.id))); channel.current?.postMessage("changed");
    notify("A fresh sky. Your own words are still here.");
  }
  async function handleRestore(count: number) {
    revision.current++;
    try {
      const data = await journalRequest<{ stars: StarDto[] }>("/api/stars");
      setStars(data.stars);
      channel.current?.postMessage("changed");
      notify(`Restored ${count} ${count === 1 ? "moment" : "moments"} into your sky.`);
    } catch {
      notify("Moments were saved, but refreshing your sky took too long. Reload whenever you are ready.");
    }
  }
  async function download(format: "markdown" | "json") {
    if (exporting.current) return;
    exporting.current = true;
    try {
      const response = await fetch(`/api/journal/export?format=${format}&timeZone=${encodeURIComponent(timeZone)}`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "The export couldn't be prepared."); }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `asteria-${dayKey(new Date())}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify("Your journal, ready to keep. Check your downloads.");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't download your journal. Please try again.", true); }
    finally { exporting.current = false; }
  }
  async function runToastAction() {
    if (!toast?.action || toastBusy) return;
    setToastBusy(true);
    try { await toast.action.run(); }
    catch (error) { notify(error instanceof Error ? error.message : "That change couldn't be completed. Please try again.", true); }
    finally { setToastBusy(false); }
  }
  function search(query: string) {
    const nextView = view === "starred" ? "starred" : "memories", next = { ...filters, query };
    setView(nextView); setFilters(next); window.history.replaceState(null, "", workspaceHref(nextView, next));
  }
  const exploreMood = (mood: MoodKey) => navigate("memories", { mood });
  const exploreDay = (day: string) => navigate("memories", { day });

  const activeBreadcrumb = useMemo(() => {
    if (view === "sky") return "Sky map";
    if (view === "starred") return "Starred moments";
    if (view === "reflections") return "Reflections";
    if (filters.mood !== "all") return `${MOODS[filters.mood].label} · ${MOODS[filters.mood].constellation}`;
    if (filters.period === "week") return "Past 7 days";
    if (filters.period === "month") return "This month";
    if (filters.day) return new Date(`${filters.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
    return "All moments";
  }, [view, filters]);

  return <div className="observatory">
    <a href="#journal-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[120] focus:bg-[#dfc28d] focus:p-3 focus:text-black">Skip to your journal</a>
    <Sidebar view={view} mood={filters.mood} stars={born} open={sidebarOpen} onClose={closeSidebar} onNavigate={navigate} onMood={exploreMood} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} />
    <div className={`workspace ${sidebarOpen ? "has-sidebar" : ""}`}>
      <header className="topbar">
        <div className="menu-toggle-wrap">
          <button
            type="button"
            className={`icon-button menu-toggle ${sidebarOpen ? "is-active" : ""}`}
            onClick={() => setSidebarOpen(open => !open)}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={sidebarOpen}
            aria-describedby="drawer-toggle-tip"
          >
            <PanelLeft size={18} />
          </button>
          <span id="drawer-toggle-tip" role="tooltip" className="drawer-tooltip">
            Toggle constellations drawer
          </span>
        </div>
        <div className="breadcrumb">
          <button type="button" className="breadcrumb-root text-button" onClick={() => navigate("sky")} aria-label="Return to observatory sky map">
            <Orbit size={13} />
            <span>Observatory</span>
          </button>
          <ChevronRight size={10} className="breadcrumb-separator" />
          <b className="breadcrumb-current">{activeBreadcrumb}</b>
        </div>
        <div className="topbar-right">
          <label className="global-search" title="Search moments across your journal (Press ⌘K or /)"><Search size={14} /><input ref={searchRef} value={filters.query} onChange={event => search(event.target.value)} placeholder="Search journal text…" maxLength={200} aria-label="Search your moments" /><kbd title="Press ⌘K or Ctrl+K to search">⌘ K</kbd></label>
          <span className="toolbar-divider" />
          <button className="icon-button topbar-help" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts and sky guide" title="Keyboard shortcuts & sky guide (?)"><CircleHelp size={16} /></button>
          <button className="identity-moon" onClick={() => setSettingsOpen(true)} aria-label="Your journal settings" title="Journal settings & quiet corner"><Moon size={14} /></button>
        </div>
      </header>
      <main className="workspace-body" id="journal-main">
        {view === "reflections" && (
          <div className="welcome page-enter">
            <div>
              <h1>The shape of your days.</h1>
              <p>Not everything needs to be measured. Some things are simply worth noticing.</p>
            </div>
            <div className="welcome-actions"><button className="primary-button" onClick={() => openComposer(undefined, filters.day || undefined)} aria-label="Capture a moment"><Plus size={14} />Capture a moment</button></div>
          </div>
        )}

        {view === "sky" ? <div className="page-enter">
          <div className="overview-row sky-overview-row">
            <div className="overview-stats">
              <div><Sparkle size={13} /><strong>{stats.stars}</strong>little lights</div>
              <div><Moon size={13} /><strong>{stats.nights}</strong>days remembered</div>
              <div><Waypoints size={13} /><strong>{MOOD_KEYS.filter(m => counts[m] > 0).length}</strong>constellations</div>
              <span className="overview-date welcome-date">{date.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" })}</span>
            </div>
            <div className="overview-actions">
              <div className="view-toggle" aria-label="Journal view"><button className="active" aria-pressed="true"><Orbit size={12} />Sky map</button><button onClick={() => navigate("memories")} aria-pressed="false"><BookOpen size={12} />Journal</button></div>
              <button className="primary-button" onClick={() => openComposer(undefined, filters.day || undefined)} aria-label="Capture a moment"><Plus size={14} />Capture a moment</button>
            </div>
          </div>
          <div className="sky-layout">
            <SkyMap stars={born} horizon={horizon} selectedId={selectedId} onSelect={selectFromMap} mood={filters.mood} onMood={mood => updateFilter({ mood })} onCapture={() => openComposer()} onExpand={() => setExpanded(true)} canvasRef={canvasRef} timeline={<TimeBar total={total} position={horizon} when={when} detail={detail} onJump={moveTime} />} />
            <aside className="side-rail" aria-label="Your rhythm">
              <RhythmCalendar stars={stars} now={now} onDay={exploreDay} compact />
            </aside>
          </div>
          <section className="recent-section">
            <div className="section-heading"><h2>Recently caught<span>{filtered.length ? String(filtered.length).padStart(2, "0") : ""}</span></h2><button className="text-button" onClick={() => navigate("memories", { mood: filters.mood })}>All moments<ArrowRight size={12} /></button></div>
            {filtered.length ? <div className="moments-grid">{filtered.slice(0, 3).map(star => <MomentCard key={star.id} star={star} onOpen={openStar} onFavorite={favorite} pending={pending.has(star.id)} />)}</div> : <div className="empty-state"><Sparkles size={23} /><h2>The next little thing is yours.</h2><p>Capture a moment and it will find its place here, and in your sky.</p><button className="secondary-button" onClick={() => openComposer()}>Capture a moment<Plus size={13} /></button></div>}
          </section>
          {samples > 0 && <div className="sample-notice"><Sparkles size={13} /><span>A few example moments to light the way. Your own story starts whenever you’re ready.</span><button className="text-button" onClick={() => setSettingsOpen(true)}>Make it yours<ArrowRight size={12} /></button></div>}
        </div> : view === "reflections" ? <Reflections stars={stars} now={now} onMood={exploreMood} onDay={exploreDay} onExport={() => void download("markdown")} /> :
          <MomentLibrary stars={filtered} filters={filters} onFilter={updateFilter} onClear={() => navigate(view)} onOpen={openStar} onFavorite={favorite} onCapture={() => openComposer(undefined, filters.day || undefined)} pending={pending} />}

        <footer className="observatory-footer"><p><LockKeyhole size={9} />Your words. Your own little universe.</p><em>There is a little light in every day.</em></footer>
      </main>
    </div>

    {composer && <Composer key={composer.star?.id || "new"} onClose={() => setComposer(null)} onSaved={saved} star={composer.star} prompt={PROMPTS[promptIndex]} defaultDate={composer.date} />}
    {selected && <StarCard star={selected} onClose={() => setSelectedId(null)} onEdit={star => openComposer(star)} onFavorite={favorite} onRelease={release} onNavigate={offset => { const next = filtered[readerIndex + offset]; if (next) setSelectedId(next.id); }} index={readerIndex} total={filtered.length} pending={pending.has(selected.id)} />}
    {settingsOpen && <JournalSettings onClose={() => setSettingsOpen(false)} samples={samples} onClearSamples={clearSamples} onExport={download} onRestore={handleRestore} />}
    <Modal open={expanded} onClose={() => setExpanded(false)} title="Your sky, a little closer" description="Drag to explore, use arrow keys to browse stars, or choose a feeling. Click a star to read its moment." hideTitle className="sky-fullscreen">
      <SkyMap stars={born} horizon={horizon} selectedId={selectedId} onSelect={selectFromMap} mood={filters.mood} onMood={mood => updateFilter({ mood })} onCapture={() => openComposer()} canvasRef={expandedCanvas} />
    </Modal>
    {helpOpen && <KeyboardShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />}
    {toast && <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"} aria-live={toast.error ? "assertive" : "polite"}>
      {toast.error ? <CircleAlert size={15} /> : <Check size={15} />}<span>{toast.message}</span>
      {toast.action && <button className="text-button" onClick={() => void runToastAction()} disabled={toastBusy}>{toastBusy ? <Loader2 className="animate-spin" size={12} /> : null}{toast.action.label}</button>}
      <button className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={13} /></button>
    </div>}
  </div>;
}
