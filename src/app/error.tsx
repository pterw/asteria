"use client";
import { RefreshCw, Sparkles } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="sky-root">
      <div className="boot-state" role="alert">
        <Sparkles size={22} />
        <h1>Cloud over the observatory.</h1>
        <p>Your journal could not be reached just now. Nothing you saved has changed.</p>
        <button className="primary-button" onClick={reset}><RefreshCw size={13} />Try again</button>
      </div>
    </main>
  );
}
