"use client";
import { useState } from "react";
import { ArrowDownToLine, Braces, Loader2, Sparkles } from "lucide-react";

/** How the sky works, where it lives, and the two exits: export, or start fresh. */
export default function SkyNotes({ onClose, samples, timeZone, clock, onExport, onClearSamples }: {
  onClose: () => void; samples: number; timeZone: string; clock: string;
  onExport: (format: "markdown" | "json") => Promise<void>; onClearSamples: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function clear() {
    setBusy(true); setError(null);
    try { await onClearSamples(); setConfirm(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't clear the examples."); }
    finally { setBusy(false); }
  }
  return <div className="notes">
    <section>
      <h3>Reading the sky</h3>
      <ul className="guide">
        <li><b>Click a star</b> to read the moment behind it. Click empty sky to put it down.</li>
        <li><b>Click a constellation's name</b>, or a chip beneath the sky, to attend to one feeling. The rest of the sky dims but stays.</li>
        <li><b>Drag</b> to wander. Once the sky is focused, <b>scroll</b> to zoom; the buttons at the left edge do the same.</li>
        <li><b>The timeline</b> at the bottom winds your history back. Watch stars leave and threads un-form, then press play and grow it again.</li>
        <li><b>Moments</b> lists whatever the sky is showing; <b>Nights</b> is a calendar of the nights that have light.</li>
      </ul>
      <div className="shortcuts">
        {[["N", "Hang a star"], ["M", "Moments"], ["A", "Nights"], ["/", "Search"], ["[  ]", "Step through time"], ["Esc", "Close"]].map(([key, what]) =>
          <span key={key}><kbd>{key}</kbd>{what}</span>)}
      </div>
    </section>
    <section>
      <h3>Where this lives</h3>
      <p>Your moments sit in a database, separated from every other journal by a private cookie that only <em>this browser</em> holds. There is no account, no public page, nothing shared.</p>
      <p className="warn">Clearing cookies, a private window, or another device opens a different, empty sky. If the words matter, export them — that file is the backup.</p>
      <p className="mono">dates in <b>{timeZone.replaceAll("_", " ")}</b> · local time <b>{clock}</b></p>
    </section>
    <section>
      <h3>Keep a copy</h3>
      <p>Everything in your sky — words, dates, feelings, brightness — as one readable file.</p>
      <div className="row">
        <button className="ghost-button" onClick={() => void onExport("markdown")}><ArrowDownToLine size={14} />Markdown</button>
        <button className="ghost-button" onClick={() => void onExport("json")}><Braces size={14} />JSON</button>
      </div>
    </section>
    {samples > 0 && <section>
      <h3>The example moments</h3>
      <p>{samples} of these lights were written for you, to show the shape of the thing. Editing one makes it yours. Starting fresh removes only the untouched examples.</p>
      {confirm ? <div className="confirm">
        <span>Clear the {samples} untouched examples?</span>
        <button className="ghost-button" onClick={() => setConfirm(false)}>Keep them</button>
        <button className="primary-button" disabled={busy} onClick={clear}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Start fresh</button>
      </div> : <div className="row"><button className="ghost-button" onClick={() => setConfirm(true)}>Start a fresh sky</button></div>}
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="row end"><button className="ghost-button" onClick={onClose}>Done</button></div>
  </div>;
}
