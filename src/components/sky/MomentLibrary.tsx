"use client";
import { useEffect, useState } from "react";
import { ArrowDown, BookOpen, Plus, Search, X } from "lucide-react";
import MomentCard from "./MomentCard";
import { MOOD_KEYS, MOODS, type MomentFilters, type MoodKey, type Period, type SortOrder, type StarDto } from "@/lib/astral";

export default function MomentLibrary({ stars, filters, onFilter, onClear, onOpen, onFavorite, onCapture, pending }: {
  stars: StarDto[]; filters: MomentFilters; onFilter: (update: Partial<MomentFilters>) => void; onClear: () => void;
  onOpen: (star: StarDto) => void; onFavorite: (star: StarDto) => void; onCapture: () => void; pending: Set<string>;
}) {
  const [limit, setLimit] = useState(24);
  useEffect(() => setLimit(24), [filters]);
  const filtered = !!(filters.query || filters.day || filters.mood !== "all" || filters.period !== "all");

  const title = filters.starred
    ? "Starred moments"
    : filters.mood !== "all"
    ? MOODS[filters.mood].label
    : "Moments";

  return (
    <section className="moment-library-section page-enter" aria-label={filters.starred ? "Your starred moments" : "Your moment library"}>
      <header className="library-header">
        <h1 className="library-title">{title}</h1>
      </header>

      <div className="library-toolbar">
        <div className="library-filters">
          <select className="filter-select" value={filters.mood} onChange={e => onFilter({ mood: e.target.value as MoodKey | "all" })} aria-label="Filter by feeling">
            <option value="all">All feelings</option>
            {MOOD_KEYS.map(m => (
              <option value={m} key={m}>{MOODS[m].label}</option>
            ))}
          </select>
          <select className="filter-select" value={filters.period} onChange={e => onFilter({ period: e.target.value as Period, day: "" })} aria-label="Filter by time">
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="week">Past 7 days</option>
          </select>
          <select className="filter-select" value={filters.sort} onChange={e => onFilter({ sort: e.target.value as SortOrder })} aria-label="Sort moments">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="brightest">Brightest first</option>
          </select>
          <span className="library-summary" aria-live="polite">
            <span className="summary-count">{stars.length} {stars.length === 1 ? "moment" : "moments"}</span>
            {filters.query && <span className="summary-query"> · matching “{filters.query}”</span>}
          </span>
          {filters.day && (
            <button className="active-filter" onClick={() => onFilter({ day: "" })} aria-label="Clear date filter">
              {new Date(`${filters.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}
              <X size={11} />
            </button>
          )}
          {filtered && (
            <button className="text-button clear-btn" onClick={onClear}>
              Clear filters<X size={11} />
            </button>
          )}
        </div>
        <div className="library-actions">
          <button className="capture-action-button" onClick={onCapture} aria-label="Capture a moment">
            <Plus size={14} />Capture a moment
          </button>
        </div>
      </div>

      {stars.length ? (
        <>
          <div className="moments-grid">
            {stars.slice(0, limit).map((star, idx) => (
              <MomentCard
                key={star.id}
                star={star}
                onOpen={onOpen}
                onFavorite={onFavorite}
                pending={pending.has(star.id)}
                featured={idx === 0 && !filtered && stars.length > 2}
              />
            ))}
          </div>
          {limit < stars.length && (
            <div className="mt-8 text-center">
              <button className="secondary-button" onClick={() => setLimit(l => l + 24)}>
                Show more moments<ArrowDown size={13} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          {filtered ? <Search size={27} /> : <BookOpen size={27} />}
          <h2>
            {filters.query
              ? `No moments matching “${filters.query}”`
              : filtered
              ? "No moments match your filters"
              : filters.starred
              ? "No starred moments yet"
              : "Your story has room to grow"}
          </h2>
          <p>
            {filters.query
              ? "Check your spelling or try clearing your filters to see other moments in your sky."
              : filtered
              ? "Try adjusting your feeling or time filters to see more of your moments."
              : filters.starred
              ? "Select the star on any moment to keep it close. You’ll find all your favorites here."
              : "One small thing, a few honest words. That’s all it takes to begin."}
          </p>
          <button className="secondary-button" onClick={filtered ? onClear : onCapture}>
            {filtered ? "Clear filters" : "Capture a moment"}
          </button>
        </div>
      )}
    </section>
  );
}
