import { Sparkles } from "lucide-react";
export default function Loading() {
  return (
    <main className="sky-root" aria-busy="true">
      <div className="boot-state">
        <Sparkles size={22} className="animate-pulse" />
        <p>Gathering your lights…</p>
      </div>
    </main>
  );
}
