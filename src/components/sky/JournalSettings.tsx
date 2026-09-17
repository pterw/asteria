"use client";

import { useRef, useState } from "react";
import { ArrowDownToLine, Braces, Check, Loader2, LockKeyhole, Sparkles, Upload } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useJournalTime } from "./JournalTime";

export default function JournalSettings({
  onClose,
  samples,
  onClearSamples,
  onExport,
  onRestore,
}: {
  onClose: () => void;
  samples: number;
  onClearSamples: () => Promise<void>;
  onExport: (format: "markdown" | "json") => Promise<void>;
  onRestore?: (count: number) => Promise<void>;
}) {
  const timeZone = useJournalTime();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await onClearSamples();
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The example moments couldn't be cleared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setRestoreSuccess(null);

    try {
      const text = await file.text();
      const response = await fetch("/api/journal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "The moments could not be imported.");
      }

      setRestoreSuccess(`Restored ${data.imported} ${data.imported === 1 ? "moment" : "moments"} into your sky.`);
      if (onRestore) {
        await onRestore(data.imported);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import moments. Please check the file.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title="Your quiet corner."
      description="A little about your journal, and how to keep it close."
    >
      <section className="setting-block">
        <h3><LockKeyhole size={15} />A sky linked to this browser</h3>
        <p>Your moments are stored in the database and separated from other journals using a private browser cookie. There’s no public profile or shared feed.</p>
        <p>Dates follow your device’s timezone: <span className="text-[#bbc1ce]">{timeZone.replaceAll("_", " ")}</span>.</p>
        <p><strong className="font-normal text-[#bbc1ce]">Keep in mind:</strong> clearing cookies, using private browsing, or changing devices opens a different journal. Export your words to keep a copy you control.</p>
      </section>

      <section className="setting-block">
        <h3><ArrowDownToLine size={15} />Take your words with you</h3>
        <p>Download all the moments currently in your sky, including their dates, feelings, brightness, and starred status. Exports never contain your private browser key.</p>
        <div className="setting-actions">
          <button className="secondary-button" onClick={() => void onExport("markdown")}>
            <ArrowDownToLine size={13} />Download Markdown
          </button>
          <button className="secondary-button" onClick={() => void onExport("json")}>
            <Braces size={13} />Download JSON
          </button>
        </div>
      </section>

      <section className="setting-block">
        <h3><Upload size={15} />Restore a journal</h3>
        <p>Restore moments from an Asteria JSON export file back into this sky. Existing moments remain untouched.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelect}
          className="sr-only"
          id="journal-file-import"
          disabled={busy}
        />
        <div className="setting-actions">
          <button
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Select Asteria JSON backup
          </button>
        </div>
        {restoreSuccess && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-[#94b89d]">
            <Check size={13} />
            {restoreSuccess}
          </p>
        )}
      </section>

      {samples > 0 && (
        <section className="setting-block">
          <h3><Sparkles size={15} />Make this sky your own</h3>
          <p>You’re exploring {samples} example moments. Start with a blank sky whenever you’re ready. Only examples are removed; anything you’ve written or edited stays.</p>
          {confirming ? (
            <div className="confirm-release">
              <p>Clear the example moments?</p>
              <button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Keep examples</button>
              <button className="primary-button" disabled={busy} onClick={clear}>
                {busy && <Loader2 size={13} className="animate-spin" />}Start fresh
              </button>
            </div>
          ) : (
            <div className="setting-actions">
              <button className="secondary-button" onClick={() => setConfirming(true)}>
                Start a fresh sky<Sparkles size={13} />
              </button>
            </div>
          )}
        </section>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
