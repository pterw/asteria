"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Eclipse, Loader2, Pencil, Star } from "lucide-react";
import Modal from "@/components/ui/Modal";
import MoodDot from "@/components/ui/MoodDot";
import { BrightnessDots } from "./MomentCard";
import { useJournalTime } from "./JournalTime";
import { formatNight, INTENSITY_LABELS, MOODS, starTitle, type StarDto } from "@/lib/astral";

export default function StarCard({ star, onClose, onEdit, onFavorite, onRelease, onNavigate, index, total, pending }: {
  star: StarDto; onClose: () => void; onEdit: (star: StarDto) => void; onFavorite: (star: StarDto) => Promise<void>;
  onRelease: (star: StarDto) => Promise<void>; onNavigate: (offset: number) => void; index: number; total: number; pending: boolean;
}) {
  const timeZone = useJournalTime();
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setConfirming(false); setError(null); setCopied(false); }, [star.id]);
  async function release() {
    setBusy(true); setError(null);
    try { await onRelease(star); }
    catch (e) { setError(e instanceof Error ? e.message : "The moment couldn't be released. It is still in your sky."); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`${starTitle(star)}\n\n${star.content}\n\n${formatNight(star.createdAt, timeZone)}`); setCopied(true); }
    catch { setError("Your browser couldn't copy this moment. You can select the words and copy them, or export your journal."); }
  }
  return <Modal open onClose={onClose} busy={busy} title={starTitle(star)} description="A moment from your journal. Read, edit, star, or release it." hideTitle className="star-reader">
    <div style={{ "--mood": MOODS[star.mood].hex } as CSSProperties} onKeyDown={event => {
      if (busy) return;
      if (event.key === "ArrowRight" && index < total - 1) onNavigate(1);
      if (event.key === "ArrowLeft" && index > 0) onNavigate(-1);
    }}>
      <p className="moment-mood"><MoodDot mood={star.mood} />{MOODS[star.mood].label}{star.isSample && <span className="sample-label">Example moment</span>}</p>
      <p className="reader-date">{formatNight(star.createdAt, timeZone)}</p>
      <h2 className="reader-title">{starTitle(star)}</h2>
      <p className="reader-content">{star.content}</p>
      <div className="reader-brightness"><BrightnessDots intensity={star.intensity} /><span>{INTENSITY_LABELS[star.intensity]} · {MOODS[star.mood].constellation}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {confirming ? <div className="confirm-release">
        <p>Let this moment go? You can undo it.</p>
        <button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
        <button className="secondary-button danger-button" disabled={busy} onClick={release}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Eclipse size={13} />}Release</button>
      </div> : <div className="reader-actions">
        <button className={`secondary-button ${star.favorite ? "text-luminous" : ""}`} onClick={() => void onFavorite(star)} disabled={pending} aria-pressed={star.favorite}><Star size={13} fill={star.favorite ? "currentColor" : "none"} />{star.favorite ? "Starred" : "Star this"}</button>
        <button className="secondary-button" onClick={() => onEdit(star)}><Pencil size={12} />Edit</button>
        <button className="icon-button" onClick={copy} aria-label={copied ? "Moment copied" : "Copy moment"} title={copied ? "Copied" : "Copy moment"}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        <button className="release-button" onClick={() => setConfirming(true)}><Eclipse size={12} />Release</button>
      </div>}
      <div className="reader-navigation">
        <button onClick={() => onNavigate(-1)} disabled={index <= 0 || busy} aria-label="Read previous moment"><ArrowLeft size={12} />Previous</button>
        <span>{index >= 0 ? `${index + 1} of ${total} little lights` : "A little light in your sky"}</span>
        <button onClick={() => onNavigate(1)} disabled={index < 0 || index >= total - 1 || busy} aria-label="Read next moment">Next<ArrowRight size={12} /></button>
      </div>
    </div>
  </Modal>;
}
