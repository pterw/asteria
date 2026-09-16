"use client";
import { useState } from "react";
import { ArrowDownToLine, Braces, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useJournalTime } from "./JournalTime";

export default function JournalSettings({ onClose, samples, onClearSamples, onExport }: {
  onClose: () => void; samples: number; onClearSamples: () => Promise<void>; onExport: (format: "markdown" | "json") => Promise<void>;
}) {
  const timeZone = useJournalTime();
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function clear() {
    setBusy(true); setError(null);
    try { await onClearSamples(); setConfirming(false); }
    catch (e) { setError(e instanceof Error ? e.message : "The example moments couldn't be cleared. Please try again."); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} busy={busy} title="Your quiet corner." description="A little about your journal, and how to keep it close.">
    <section className="setting-block"><h3><LockKeyhole size={15} />A sky linked to this browser</h3>
      <p>Your moments are stored in the database and separated from other journals using a private browser cookie. There’s no public profile or shared feed.</p><p>Dates follow your device’s timezone: <span className="text-[#bbc1ce]">{timeZone.replaceAll("_", " ")}</span>.</p>
      <p><strong className="text-[#bbc1ce] font-normal">Keep in mind:</strong> clearing cookies, using private browsing, or changing devices opens a different journal. This is not an account-based backup. Export your words to keep a copy you control.</p>
    </section>
    <section className="setting-block"><h3><ArrowDownToLine size={15} />Take your words with you</h3><p>Download all the moments currently in your sky, including their dates, feelings, brightness, and starred status. Exports never contain your private browser key.</p>
      <div className="setting-actions"><button className="secondary-button" onClick={() => void onExport("markdown")}><ArrowDownToLine size={13} />Download Markdown</button><button className="secondary-button" onClick={() => void onExport("json")}><Braces size={13} />Download JSON</button></div>
    </section>
    {samples > 0 && <section className="setting-block"><h3><Sparkles size={15} />Make this sky your own</h3><p>You’re exploring {samples} example moments. Start with a blank sky whenever you’re ready. Only examples are removed; anything you’ve written or edited stays.</p>
      {confirming ? <div className="confirm-release"><p>Clear the example moments?</p><button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Keep examples</button><button className="primary-button" disabled={busy} onClick={clear}>{busy && <Loader2 size={13} className="animate-spin" />}Start fresh</button></div> : <div className="setting-actions"><button className="secondary-button" onClick={() => setConfirming(true)}>Start a fresh sky<Sparkles size={13} /></button></div>}
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
