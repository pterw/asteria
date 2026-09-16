"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarDays, Check, Loader2, Sparkle, Sparkles } from "lucide-react";
import Modal from "@/components/ui/Modal";
import MoodDot from "@/components/ui/MoodDot";
import { dayKey, INTENSITY_LABELS, isMoodKey, MOOD_KEYS, MOODS, type MoodKey, type StarDto } from "@/lib/astral";
import { journalRequest } from "@/lib/client-api";

const DRAFT_KEY = "asteria.moment-draft.v2";
interface Draft { title: string; content: string; mood: MoodKey; intensity: number; date: string; restored?: boolean; }
function initialDraft(star?: StarDto | null, defaultDate?: string): Draft {
  const fallback: Draft = { title: "", content: "", mood: "luminous", intensity: 3, date: defaultDate || dayKey(new Date()) };
  if (star) return { title: star.title, content: star.content, mood: star.mood, intensity: star.intensity, date: dayKey(new Date(star.createdAt)) };
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (value && typeof value.title === "string" && typeof value.content === "string" && isMoodKey(value.mood) && Number.isInteger(value.intensity) && value.intensity >= 1 && value.intensity <= 5 && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number.isFinite(new Date(value.date).getTime())) {
      return { ...value, title: value.title.slice(0, 80), content: value.content.slice(0, 420), date: value.date > fallback.date ? fallback.date : value.date, restored: !!(value.content || value.title) };
    }
  } catch { /* Browser storage can be unavailable in private browsing. Writing still works. */ }
  return fallback;
}
export default function Composer({ onClose, onSaved, star, prompt, defaultDate }: {
  onClose: () => void; onSaved: (star: StarDto, edited: boolean) => void; star?: StarDto | null; prompt: string; defaultDate?: string;
}) {
  const [draft, setDraft] = useState(() => initialDraft(star, defaultDate));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const saved = useRef(false), submitting = useRef(false);
  useEffect(() => {
    if (star || saved.current) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
    catch { setStorageOk(false); }
  }, [draft, star]);
  function update(values: Partial<Draft>) { setDraft(d => ({ ...d, ...values })); }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current) return;
    if (draft.content.trim().length < 2) { setError("A moment needs a few words. What would you like to keep?"); return; }
    setError(null); setBusy(true); submitting.current = true;
    try {
      const createdAt = star && dayKey(new Date(star.createdAt)) === draft.date ? star.createdAt : draft.date === dayKey(new Date()) ? new Date().toISOString() : new Date(`${draft.date}T12:00:00`).toISOString();
      const data = await journalRequest<{ star: StarDto }>(star ? `/api/stars/${star.id}` : "/api/stars", {
        method: star ? "PATCH" : "POST",
        body: JSON.stringify({ title: draft.title.trim(), content: draft.content.trim(), mood: draft.mood, intensity: draft.intensity, createdAt }),
      });
      saved.current = true;
      if (!star) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* Saving to Postgres already succeeded. */ } }
      onSaved(data.star, !!star);
    } catch (e) { setError(e instanceof Error ? e.message : "Your moment couldn't be saved. Your draft is still here."); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <Modal open onClose={onClose} busy={busy} className="composer" title={star ? "A moment, in your own words." : "A little thing, worth keeping."}
    description={star ? "Change the words. Keep the feeling. Your star will stay in its place." : "It doesn't have to be extraordinary. It just has to be yours."}>
    <form onSubmit={save} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(); } }}>
      <label className="field-label" htmlFor="moment-title">Give it a name<span>Optional</span></label>
      <input id="moment-title" className="journal-input" placeholder="A little sunlight on a Tuesday…" value={draft.title} onChange={event => update({ title: event.target.value })} maxLength={80} disabled={busy} />
      <label className="sr-only" htmlFor="moment-content">Your moment</label>
      <textarea id="moment-content" className="journal-input" placeholder={prompt} value={draft.content} onChange={event => update({ content: event.target.value })} maxLength={420} rows={3} disabled={busy} required minLength={2} />
      <div className="composer-meta">
        <label htmlFor="moment-date"><CalendarDays size={12} /><span className="sr-only">When it happened</span><input id="moment-date" type="date" min="1900-01-01" max={dayKey(new Date())} value={draft.date} onChange={event => { if (event.target.value) update({ date: event.target.value }); }} required disabled={busy} /></label>
        <span className={`character-count ${draft.content.length > 380 ? "near-limit" : ""}`}>{draft.content.length} / 420</span>
      </div>
      <fieldset disabled={busy}>
        <legend className="field-label">What color was the feeling?</legend>
        <div className="mood-options">{MOOD_KEYS.map(m => <button type="button" key={m} className={`mood-option ${draft.mood === m ? "active" : ""}`}
          onClick={() => update({ mood: m })} style={{ "--mood": MOODS[m].hex } as CSSProperties} aria-pressed={draft.mood === m}>
          <MoodDot mood={m} /><span><strong>{MOODS[m].label}</strong><small>{MOODS[m].blurb}</small></span>
        </button>)}</div>
      </fieldset>
      <div className="brightness-field" role="group" aria-label="Brightness of your moment">
        <p className="field-label">How brightly did it burn?<span>{INTENSITY_LABELS[draft.intensity]}</span></p>
        <div className="brightness-buttons" style={{ "--mood": MOODS[draft.mood].hex } as CSSProperties}>{[1, 2, 3, 4, 5].map(i => <button key={i} type="button" className={`${i <= draft.intensity ? "lit" : ""} ${i === draft.intensity ? "active" : ""}`}
          disabled={busy} onClick={() => update({ intensity: i })} aria-label={`${i} of 5: ${INTENSITY_LABELS[i]}`} aria-pressed={draft.intensity === i}><Sparkle size={21} /></button>)}</div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="composer-footer">
        <span className="draft-indicator"><Check size={12} />{star ? "Your original stays safe until you save" : !storageOk ? "Draft recovery unavailable" : draft.restored ? "Your draft, right where you left it" : draft.content || draft.title ? "Draft saved on this device" : "A quiet space. Just for you."}</span>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}{busy ? "Saving your light…" : star ? "Save changes" : "Add to my sky"}</button>
      </div>
      <p className="form-hint">⌘ / Ctrl + Enter to save</p>
    </form>
  </Modal>;
}
