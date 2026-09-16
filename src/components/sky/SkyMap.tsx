"use client";
import { type ReactNode, type RefObject } from "react";
import { Expand, Focus, Minus, Move, Navigation, Plus, Sparkles } from "lucide-react";
import SkyCanvas, { type SkyCanvasHandle } from "./SkyCanvas";
import MoodDot from "@/components/ui/MoodDot";
import { MOOD_KEYS, MOODS, type MoodKey, type StarDto } from "@/lib/astral";

/**
 * The panel that holds the sky. The canvas inside is the observatory's own:
 * it understands time (horizon) and attention (highlight), so winding the
 * clock back un-forms constellations and choosing a feeling dims the rest.
 */
export default function SkyMap({ stars, horizon, selectedId, onSelect, mood, onMood, onCapture, onExpand, canvasRef, timeline }: {
  stars: StarDto[]; horizon: number | null; selectedId: string | null; onSelect: (id: string | null) => void;
  mood: MoodKey | "all"; onMood: (mood: MoodKey | "all") => void; onCapture: () => void;
  onExpand?: () => void; canvasRef: RefObject<SkyCanvasHandle | null>;
  /** The instrument's time axis. It docks inside the frame, under the canvas and above
   *  the feeling chips, so the two axes read as one control strip for the sky rather
   *  than the scrubber sitting further down the page than the sky it scrubs. */
  timeline?: ReactNode;
}) {
  const visible = stars.filter(s => mood === "all" || s.mood === mood);
  return <section className="sky-panel" aria-label="Your constellation map">
    <div className="sky-heading">
      <div>
        <div className="sky-heading-title"><h2>Your sky, so far</h2></div>
        <p>A constellation of the things that mattered.</p>
      </div>
      <div className="sky-actions">
        {onExpand && <button className="icon-button" onClick={onExpand} aria-label="Expand your sky" title="Expand your sky"><Expand size={15} /></button>}
      </div>
    </div>
    <div className="sky-viewport">
      <SkyCanvas ref={canvasRef} stars={stars} selectedId={selectedId} onSelect={onSelect} horizon={horizon}
        highlight={mood === "all" ? null : new Set(visible.map(s => s.id))} onFocusMood={onMood} />
      <div className="sky-coordinates" aria-hidden="true">THE OBSERVABLE YOU<br />RA 00h 42m · DEC +41°</div>
      <div className="sky-direction" aria-hidden="true"><span>N</span><Navigation size={24} /></div>
      <p className="map-hint"><Move size={10} /> Drag to wander · click a star to remember</p>
      <div className="map-tools" aria-label="Map controls">
        <button className="icon-button" onClick={() => canvasRef.current?.zoomBy(1.3)} title="Zoom in" aria-label="Zoom in"><Plus size={14} /></button>
        <button className="icon-button" onClick={() => canvasRef.current?.zoomBy(1 / 1.3)} title="Zoom out" aria-label="Zoom out"><Minus size={14} /></button>
        <button className="icon-button" onClick={() => canvasRef.current?.resetView()} title="Recenter sky" aria-label="Recenter sky"><Focus size={14} /></button>
      </div>
      {!visible.length && <div className="map-empty">
        <Sparkles size={22} /><h3>{stars.length ? "A feeling yet to find its light." : "Every sky starts with one light."}</h3>
        <p>{stars.length ? "No moments with this feeling yet. All of your other little lights are still here." : "Notice something small. Put it into words. Let the dark make room for it."}</p>
        <button className="text-button" onClick={stars.length ? () => onMood("all") : onCapture}>{stars.length ? "See all feelings" : "Capture your first moment"}<Plus size={13} /></button>
      </div>}
    </div>
    {timeline}
    <div className="sky-legend" aria-label="Filter constellation by feeling">
      <button className={mood === "all" ? "active" : ""} onClick={() => onMood("all")} aria-pressed={mood === "all"}>All feelings</button>
      {MOOD_KEYS.map(m => <button key={m} className={mood === m ? "active" : ""} onClick={() => onMood(mood === m ? "all" : m)} aria-pressed={mood === m} title={`${MOODS[m].label}: ${MOODS[m].blurb}`}><MoodDot mood={m} />{MOODS[m].label}</button>)}
    </div>
  </section>;
}
