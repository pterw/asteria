"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

/**
 * The sky's clock. Drag back through your history and the sky un-forms;
 * press play and it grows again, one star at a time. Playback speed adapts
 * so a whole journal replays in about a minute, however large it has grown.
 */
export default function TimeBar({ total, position, when, detail, onJump }: {
  total: number; position: number | null; when: string; detail: string; onJump: (pos: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const pos = position ?? total;
  const atNow = position === null || pos >= total;
  const refs = useRef({ pos, total, onJump });
  refs.current = { pos, total, onJump };
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
    <input className="time-scrub" type="range" min={0} max={total} value={pos}
      onChange={e => { setPlaying(false); jump(Number(e.target.value)); }}
      aria-label="Timeline position" aria-valuetext={`${when}. ${detail}`} />
    <p className="time-readout" data-testid="time-readout"><b>{when}</b>{detail && <span>{detail}</span>}</p>
    {!atNow && <button className="time-now" onClick={() => { setPlaying(false); onJump(null); }}>Back to now</button>}
  </div>;
}
