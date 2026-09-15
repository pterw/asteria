"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Pencil, Star, X } from "lucide-react";
import MoodDot from "@/components/ui/MoodDot";
import { useJournalTime } from "./JournalTime";
import { formatNight, INTENSITY_LABELS, MOODS, starTitle, type StarDto } from "@/lib/astral";

export default function Reader({ star, index, total, pending, onBack, onClose, onEdit, onFavorite, onRelease, onNavigate }: {
  star: StarDto; index: number; total: number; pending: boolean;
  onBack: (() => void) | null; onClose: () => void; onEdit: () => void; onFavorite: () => void;
  onRelease: () => Promise<void>; onNavigate: (offset: number) => void;
}) {
  const timeZone = useJournalTime();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { setConfirm(false); setCopied(false); setError(null); }, [star.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight" && index >= 0 && index < total - 1) onNavigate(1);
      if (e.key === "ArrowLeft" && index > 0) onNavigate(-1);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [index, total, onNavigate]);
  async function release() {
    setBusy(true); setError(null);
    try { await onRelease(); } catch (e) { setError(e instanceof Error ? e.message : "Could not release it. The moment is still here."); }
    finally { setBusy(false); setConfirm(false); }
  }
  return <div className="reader" style={{ "--mood": MOODS[star.mood].hex } as React.CSSProperties} aria-label="Reading a moment">
    <header className="reader-head">
      {onBack ? <button className="icon-button" onClick={onBack} aria-label="Back to the ledger"><ArrowLeft size={15} /></button> : <span className="spacer" />}
      <button className="icon-button" onClick={onClose} aria-label="Close and return to the sky" title="Close (Esc)"><X size={15} /></button>
    </header>
    <div className="reader-body">
      <p className="reader-meta"><MoodDot mood={star.mood} /><span>{MOODS[star.mood].constellation}</span><i>·</i><time>{formatNight(star.createdAt, timeZone)}</time></p>
      <h2 className="reader-title">{starTitle(star)}</h2>
      <p className="reader-content">{star.content}</p>
      <p className="reader-brightness"><span>{INTENSITY_LABELS[star.intensity]}</span><em>{star.intensity}/5</em></p>
      {star.isSample && <p className="reader-note">An example moment. Edit it into your own, or release it.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <footer className="reader-foot">
      {confirm ? <div className="reader-confirm">
        <span>Release this star?</span>
        <button className="ghost-button" onClick={() => setConfirm(false)}>Keep</button>
        <button className="danger-button" disabled={busy} onClick={release}>{busy ? <Loader2 size={12} className="animate-spin" /> : null}Release</button>
      </div> : <>
        <div className="reader-actions">
          <button className={`chip ${star.favorite ? "on" : ""}`} onClick={onFavorite} disabled={pending} aria-pressed={star.favorite}><Star size={12} fill={star.favorite ? "currentColor" : "none"} />{star.favorite ? "Starred" : "Star"}</button>
          <button className="chip" onClick={onEdit}><Pencil size={11} />Edit</button>
          <button className="chip" aria-label={copied ? "Copied" : "Copy this moment"} onClick={async () => {
            try { await navigator.clipboard.writeText(`${starTitle(star)}\n\n${star.content}\n\n${formatNight(star.createdAt, timeZone)}`); setCopied(true); }
            catch { setError("Copying was blocked. Select the words instead, or export your journal."); }
          }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
          <button className="chip quiet" onClick={() => setConfirm(true)}>Release</button>
        </div>
        <p className="reader-nav">
          <button onClick={() => onNavigate(-1)} disabled={index <= 0} aria-label="Previous moment"><ArrowLeft size={12} /></button>
          <span>{index >= 0 ? `${index + 1} / ${total}` : "—"}</span>
          <button onClick={() => onNavigate(1)} disabled={index < 0 || index >= total - 1} aria-label="Next moment"><ArrowRight size={12} /></button>
        </p>
      </>}
    </footer>
  </div>;
}
