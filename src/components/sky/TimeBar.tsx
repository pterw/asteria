"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

/**
 * The sky's clock. Drag back through your history and the sky un-forms;
 * press play and it grows again, one star at a time. Playback speed adapts
 * so a whole journal replays in about a minute, however large it has grown.
 *
 * The thumb deliberately does not live in React state. Winding time back
 * redraws the whole sky, which costs more than a frame on a full journal, so a
 * controlled range input lagged the pointer and snapped back when the render
 * finally landed. The input owns its own value instead, commits upward at most
 * once per animation frame, and is repainted from props only when the reader
 * is not the one moving it.
 */
export default function TimeBar({ total, position, when, detail, onJump }: {
  total: number; position: number | null; when: string; detail: string; onJump: (pos: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const pos = position ?? total;
  const atNow = position === null || pos >= total;
  const refs = useRef({ pos, total, onJump });
  refs.current = { pos, total, onJump };

  const input = useRef<HTMLInputElement | null>(null);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  const queued = useRef<number | null>(null);

  // Colour the travelled part of the line. Cheap enough for every input event:
  // it touches one custom property and never wakes the tree behind the sky.
  const repaint = useCallback((value: number) => {
    const el = input.current;
    if (!el) return;
    const ratio = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 100;
    el.style.setProperty("--time-fill", `${ratio}%`);
  }, [total]);

  // Follow the journal's own clock — playback, "Back to now", the [ and ] keys —
  // but never mid-drag, or the thumb would be yanked back a frame.
  const follow = useCallback((value: number) => {
    const el = input.current;
    if (!el || dragging.current) return;
    const shown = String(value);
    if (el.value !== shown) el.value = shown;
    repaint(value);
  }, [repaint]);
  useEffect(() => { follow(pos); }, [follow, pos]);

  useEffect(() => {
    if (!playing) return;
    const interval = Math.max(260, Math.min(1400, 55000 / Math.max(1, total)));
    const id = window.setInterval(() => {
      const { pos, total, onJump } = refs.current;
      if (pos + 1 >= total) { onJump(null); setPlaying(false); } else onJump(pos + 1);
    }, interval);
    return () => window.clearInterval(id);
  }, [playing, total]);
  useEffect(() => { if (total === 0) setPlaying(false); }, [total]);

  const drain = useCallback(() => {
    const next = queued.current; queued.current = null;
    if (next === null) return;
    const { total, onJump } = refs.current;
    onJump(next >= total ? null : Math.max(0, next));
  }, []);
  const release = useCallback(() => {
    if (frame.current !== null) { window.cancelAnimationFrame(frame.current); frame.current = null; }
    dragging.current = false;
    drain();
  }, [drain]);
  useEffect(() => () => { if (frame.current !== null) window.cancelAnimationFrame(frame.current); }, []);
  // Range inputs normally keep pointer capture, but a release outside the
  // window would otherwise freeze the thumb for the rest of the session.
  useEffect(() => {
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); };
  }, [release]);

  if (total === 0) return null;
  const jump = (p: number) => onJump(p >= total ? null : Math.max(0, p));
  return <div className="timebar" role="group" aria-label="Timeline of your sky" data-at-now={atNow}>
    <div className="time-controls">
      <button className="icon-button" disabled={playing || pos <= 0} onClick={() => jump(pos - 1)} aria-label="Step back one star" title="Step back one star  [">
        <SkipBack size={15} />
      </button>
      <button className={`icon-button play ${playing ? "on" : ""}`}
        onClick={() => { if (playing) setPlaying(false); else { if (atNow) onJump(0); setPlaying(true); } }}
        aria-label={playing ? "Pause" : atNow ? "Replay how your sky formed" : "Play"}
        title={playing ? "Pause" : atNow ? "Replay how your sky formed" : "Play"}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button className="icon-button" disabled={playing || atNow} onClick={() => jump(pos + 1)} aria-label="Step forward one star" title="Step forward one star  ]">
        <SkipForward size={15} />
      </button>
    </div>
    <input ref={input} className="time-scrub" type="range" min={0} max={total} step={1} defaultValue={pos}
      onPointerDown={() => { dragging.current = true; }}
      onPointerUp={release}
      onPointerCancel={release}
      onBlur={release}
      onChange={event => {
        setPlaying(false);
        const value = Number(event.currentTarget.value);
        repaint(value);
        queued.current = value;
        if (frame.current === null) frame.current = window.requestAnimationFrame(() => { frame.current = null; drain(); });
      }}
      aria-label="Timeline position" aria-valuetext={`${when}. ${detail}`} />
    <p className="time-readout" data-testid="time-readout"><b>{when}</b>{detail && <span>{detail}</span>}</p>
    {!atNow && <button className="time-now" onClick={() => { setPlaying(false); onJump(null); }}>Back to now</button>}
  </div>;
}
