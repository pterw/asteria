"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Plus, Search, Star, X } from "lucide-react";
import MoodDot from "@/components/ui/MoodDot";
import { filtersActive, MOODS, shortNight, starTitle, type MomentFilters, type SortOrder, type StarDto } from "@/lib/astral";

/** The ledger lists exactly what the sky is showing: the same time, the same attention. */
export default function Ledger({ all, stars, filters, selectedId, pending, timeZone, asOf, onQuery, onPatch, onClear, onSelect, onFavorite, onCapture, inputRef }: {
  all: StarDto[]; stars: StarDto[]; filters: MomentFilters; selectedId: string | null; pending: Set<string>; timeZone: string;
  /** When the timeline is wound back, the date the sky is showing. */
  asOf: string | null;
  onQuery: (q: string) => void; onPatch: (patch: Partial<MomentFilters>) => void; onClear: () => void;
  onSelect: (star: StarDto) => void; onFavorite: (star: StarDto) => void; onCapture: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [limit, setLimit] = useState(40);
  useEffect(() => setLimit(40), [filters, asOf]);
  const active = filtersActive(filters);
  const shown = stars.slice(0, limit);
  return <div className="ledger" aria-label="Moments">
    <div className="ledger-search">
      <Search size={16} />
      <input ref={inputRef} value={filters.query} onChange={e => onQuery(e.target.value)} maxLength={200} placeholder="Search your sky…" aria-label="Search your moments" />
      {filters.query ? <button className="icon-button small" onClick={() => onQuery("")} aria-label="Clear search"><X size={14} /></button> : <kbd>⌘K</kbd>}
    </div>
    <div className="ledger-bar">
      <p>{stars.length === all.length ? `${all.length} ${all.length === 1 ? "moment" : "moments"}` : `${stars.length} of ${all.length} moments`}{asOf && <em> · as of {asOf}</em>}</p>
      <label className="ledger-sort">Sort<select value={filters.sort} onChange={e => onPatch({ sort: e.target.value as SortOrder })} aria-label="Sort moments">
        <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="brightest">Brightest</option>
      </select></label>
    </div>
    {active && <div className="ledger-chips">
      {filters.mood !== "all" && <button onClick={() => onPatch({ mood: "all" })}>{MOODS[filters.mood].constellation}<X size={12} /></button>}
      {filters.day && <button onClick={() => onPatch({ day: "" })}>{new Date(`${filters.day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}<X size={12} /></button>}
      {filters.starred && <button onClick={() => onPatch({ starred: false })}>Starred<X size={12} /></button>}
    </div>}
    {!all.length ? <div className="ledger-empty">
      <p>{asOf ? `Nothing yet, as of ${asOf}.` : "Nothing up here yet."}</p>
      <span>{asOf ? "Move the timeline forward to watch the first light arrive." : "The first star takes about ten seconds."}</span>
      {!asOf && <button className="primary-button" onClick={onCapture}><Plus size={15} />Hang the first star</button>}
    </div> : !stars.length ? <div className="ledger-empty">
      <p>Nothing matches that.</p><span>Your other lights are still up there.</span>
      <button className="ghost-button" onClick={onClear}><X size={13} />Clear the search</button>
    </div> : <ul className="ledger-list">
      {shown.map(star => <li key={star.id}>
        <button className={`ledger-row ${star.id === selectedId ? "active" : ""}`} onClick={() => onSelect(star)} data-star-id={star.id}
          aria-label={`Read ${starTitle(star)}`} aria-current={star.id === selectedId ? "true" : undefined}>
          <span className="ledger-row-top"><MoodDot mood={star.mood} /><b>{starTitle(star)}</b><time>{shortNight(star.createdAt, timeZone)}</time></span>
          <span className="ledger-row-body">{star.content}</span>
        </button>
        <button className={`row-star ${star.favorite ? "on" : ""}`} onClick={() => onFavorite(star)} disabled={pending.has(star.id)}
          aria-label={`${star.favorite ? "Unstar" : "Star"} ${starTitle(star)}`} aria-pressed={star.favorite} title={star.favorite ? "Remove star" : "Keep close"}><Star size={14} /></button>
      </li>)}
      {limit < stars.length && <li className="ledger-more"><button className="ghost-button" onClick={() => setLimit(l => l + 40)}>Show more<ChevronDown size={13} /></button></li>}
    </ul>}
  </div>;
}
