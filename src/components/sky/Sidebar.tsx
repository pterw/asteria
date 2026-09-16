"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight, BookOpen, ChartColumn, ChevronLeft, ChevronsUpDown, Info, Moon, Orbit, Sparkles, Star } from "lucide-react";
import { MOOD_KEYS, MOODS, moodCounts, type MoodKey, type StarDto, type View } from "@/lib/astral";
import MoodDot from "@/components/ui/MoodDot";

export default function Sidebar({ view, mood, stars, open, onClose, onNavigate, onMood, onSettings, onHelp }: {
  view: View; mood: MoodKey | "all"; stars: StarDto[]; open: boolean; onClose: () => void;
  onNavigate: (view: View) => void; onMood: (mood: MoodKey) => void; onSettings: () => void; onHelp: () => void;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const counts = moodCounts(stars);
  useEffect(() => {
    if (!open) return;
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 760;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = "hidden";
      const focusables = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') || [])];
      focusables()[0]?.focus();
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (!isMobile || event.key !== "Tab") return;
      const focusables = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') || [])];
      const all = focusables(), first = all[0], last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (isMobile) {
        document.body.style.overflow = oldOverflow;
        previous?.focus();
      }
    };
  }, [open, onClose]);
  const items = [
    { view: "sky" as View, icon: Orbit, label: "Your sky", count: null },
    { view: "memories" as View, icon: BookOpen, label: "All moments", count: stars.length },
    { view: "reflections" as View, icon: ChartColumn, label: "Reflections", count: null },
    { view: "starred" as View, icon: Star, label: "Starred", count: stars.filter(s => s.favorite).length },
  ];
  return <>
    {open && <button className="mobile-backdrop" aria-label="Close navigation" onClick={onClose} tabIndex={-1} />}
    <aside className={`sidebar ${open ? "is-open" : ""}`} ref={sidebar} aria-label="Main navigation">
      <div className="sidebar-brand-row">
        <Link className="brand" href="/" aria-label="Asteria home"><Sparkles size={26} /><span>asteria</span></Link>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Collapse navigation" title="Collapse navigation"><ChevronLeft size={16} /></button>
      </div>
      <p className="brand-caption">A JOURNAL OF LITTLE THOUGHTS</p>
      <nav className="sidebar-nav" aria-label="Your journal">{items.map(item => <button key={item.view} className={`nav-item ${view === item.view && mood === "all" ? "active" : ""}`} onClick={() => onNavigate(item.view)} aria-current={view === item.view && mood === "all" ? "page" : undefined}>
        <item.icon size={16} /><span>{item.label}</span>{item.count !== null && <span className="nav-count">{item.count}</span>}
      </button>)}</nav>
      <p className="nav-caption">YOUR CONSTELLATIONS<button title="About feeling constellations" aria-label="About feeling constellations" onClick={() => { onClose(); onHelp(); }}><Info size={11} /></button></p>
      <nav className="sidebar-nav" aria-label="Feeling constellations">{MOOD_KEYS.map(m => <button key={m} className={`nav-item mood-nav ${mood === m ? "active" : ""}`} onClick={() => onMood(m)} aria-pressed={mood === m}>
        <MoodDot mood={m} /><span>{MOODS[m].constellation}</span><span className="nav-count">{counts[m]}</span>
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-quote"><p>Every sky begins<br />with a first light.</p><Link href="/">What Asteria is<ArrowUpRight size={11} /></Link></div>
        <button className="journal-identity" onClick={() => { onClose(); onSettings(); }} aria-label="Open your journal settings">
          <span className="identity-moon"><Moon size={15} /></span><span><strong>Your quiet corner</strong><small><i className="status-dot" />Your browser’s sky</small></span><ChevronsUpDown size={13} />
        </button>
      </div>
    </aside>
  </>;
}
