"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Loader2, Sparkle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import MoodDot from "@/components/ui/MoodDot";
import { dayKey, INTENSITY_LABELS, isMoodKey, MOOD_KEYS, MOODS, type MoodKey, type StarDto } from "@/lib/astral";
import { journalRequest } from "@/lib/client-api";

const DRAFT_KEY = "asteria.moment-draft.v3";
interface Draft { title: string; content: string; mood: MoodKey; intensity: number; date: string; restored?: boolean; }
function initialDraft(star?: StarDto | null, defaultDate?: string): Draft {
  const fallback: Draft = { title: "", content: "", mood: "luminous", intensity: 3, date: defaultDate || dayKey(new Date()) };
  if (star) return { title: star.title, content: star.content, mood: star.mood, intensity: star.intensity, date: dayKey(new Date(star.createdAt)) };
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (value && typeof value.title === "string" && typeof value.content === "string" && isMoodKey(value.mood)
      && Number.isInteger(value.intensity) && value.intensity >= 1 && value.intensity <= 5
      && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number.isFinite(new Date(`${value.date}T12:00:00Z`).getTime())) {
      const today = fallback.date;
      return { ...value, title: value.title.slice(0, 80), content: value.content.slice(0, 420), date: value.date > today ? today : value.date, restored: !!(value.content || value.title) };
    }
  } catch { /* private modes can deny storage; writing still works */ }
  return fallback;
}

export default function Composer({ onClose, onSaved, star, prompt, defaultDate }: {
  onClose: () => void; onSaved: (star: StarDto, edited: boolean) => void; star?: StarDto | null; prompt: string; defaultDate?: string;
}) {
  const [draft, setDraft] = useState(() => initialDraft(star, defaultDate));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [storageOk, setStorageOk] = useState(true);
  const saved = useRef(false), submitting = useRef(false);
  useEffect(() => {
    if (star || saved.current) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { setStorageOk(false); }
  }, [draft, star]);
  const update = (values: Partial<Draft>) => setDraft(d => ({ ...d, ...values }));
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current) return;
    if (draft.content.trim().length < 2) { setError("Two words at least. What exactly did you notice?"); return; }
    setBusy(true); setError(null); submitting.current = true;
    try {
      const createdAt = star && dayKey(new Date(star.createdAt)) === draft.date ? star.createdAt
        : draft.date === dayKey(new Date()) ? new Date().toISOString() : new Date(`${draft.date}T12:00:00`).toISOString();
      const data = await journalRequest<{ star: StarDto }>(star ? `/api/stars/${star.id}` : "/api/stars", {
        method: star ? "PATCH" : "POST",
        body: JSON.stringify({ title: draft.title.trim(), content: draft.content.trim(), mood: draft.mood, intensity: draft.intensity, createdAt }),
      });
      saved.current = true;
      if (!star) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* already saved */ } }
      onSaved(data.star, !!star);
    } catch (e) { setError(e instanceof Error ? e.message : "Not saved. Your words are still here."); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <Modal open onClose={onClose} busy={busy} className="composer" hideTitle
    title={star ? "Rewrite the moment" : "One moment, plainly"} description={star ? "The star keeps its place; only the words change." : "One moment, plainly written, is worth more than a page of intention."}>
    <form onSubmit={submit} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}>
      <h2 className="composer-title">{star ? "A moment, retold." : "What did you notice?"}</h2>
      <label className="sr-only" htmlFor="moment-title">Title</label>
      <input id="moment-title" className="title-input" placeholder="Name it, if you like" value={draft.title} onChange={e => update({ title: e.target.value })} maxLength={80} disabled={busy} />
      <label className="sr-only" htmlFor="moment-content">The moment</label>
      <textarea id="moment-content" className="content-input" placeholder={prompt} value={draft.content} onChange={e => update({ content: e.target.value })} maxLength={420} rows={4} disabled={busy} required minLength={2} autoFocus />
      <div className="composer-row">
        <label htmlFor="moment-date">Night of<input id="moment-date" type="date" min="1900-01-01" max={dayKey(new Date())} value={draft.date} onChange={e => { if (e.target.value) update({ date: e.target.value }); }} required disabled={busy} /></label>
        <span className={`count ${draft.content.length > 380 ? "near" : ""}`}>{draft.content.length}/420</span>
      </div>
      <fieldset className="feeling" disabled={busy}>
        <legend>The colour of it</legend>
        <div className="mood-options">{MOOD_KEYS.map(m => <button type="button" key={m} className={`mood-option ${draft.mood === m ? "on" : ""}`}
          style={{ "--mood": MOODS[m].hex } as CSSProperties} onClick={() => update({ mood: m })} aria-pressed={draft.mood === m}>
          <MoodDot mood={m} /><span>{MOODS[m].label}</span>
        </button>)}</div>
      </fieldset>
      <div className="burn" style={{ "--mood": MOODS[draft.mood].hex } as CSSProperties}>
        <p>{INTENSITY_LABELS[draft.intensity]} <span>— how brightly it burned</span></p>
        <div role="group" aria-label="Brightness">{[1, 2, 3, 4, 5].map(i => <button key={i} type="button" disabled={busy} onClick={() => update({ intensity: i })}
          className={`${i <= draft.intensity ? "lit" : ""} ${i === draft.intensity ? "on" : ""}`} aria-label={`${i} of 5`} aria-pressed={draft.intensity === i}><Sparkle size={17} /></button>)}</div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="composer-foot">
        <span className="draft-note"><Check size={11} />{star ? "Nothing changes until you save" : !storageOk ? "Drafts can't be kept in this browser" : draft.restored ? "Draft recovered" : draft.content || draft.title ? "Draft kept locally" : "⌘ / Ctrl + Enter"}</span>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : null}{star ? "Save changes" : "Hang this star"}</button>
      </div>
    </form>
  </Modal>;
}
