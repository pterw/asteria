"use client";
import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import MoodDot from "@/components/ui/MoodDot";
import { useJournalTime } from "./JournalTime";
import { MOODS, shortNight, starTitle, type StarDto } from "@/lib/astral";

export function BrightnessDots({ intensity }: { intensity: number }) {
  return <span className="brightness-dots" aria-label={`Brightness ${intensity} of 5`}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i > intensity ? "off" : ""} />)}</span>;
}
export default function MomentCard({ star, onOpen, onFavorite, pending = false, featured = false }: {
  star: StarDto; onOpen: (star: StarDto) => void; onFavorite: (star: StarDto) => void; pending?: boolean; featured?: boolean;
}) {
  const timeZone = useJournalTime();
  return (
    <article
      className={`moment-card ${star.favorite ? "is-favorite-card" : ""} ${featured ? "is-lead-card" : ""}`}
      style={{ "--mood": MOODS[star.mood].hex } as CSSProperties}
    >
      <header className="moment-card-header">
        <div className="moment-mode">
          <MoodDot mood={star.mood} />
          <span className="mood-label">{MOODS[star.mood].label}</span>
        </div>
        <button
          type="button"
          className={`moment-favorite ${star.favorite ? "is-favorite" : ""}`}
          onClick={() => onFavorite(star)}
          aria-label={`${star.favorite ? "Unstar" : "Star"} ${starTitle(star)}`}
          aria-pressed={star.favorite}
          disabled={pending}
          title={star.favorite ? "Unstar moment" : "Star moment"}
        >
          <Star size={15} className={star.favorite ? "fill-[var(--obs-gold)] text-[var(--obs-gold)]" : "text-[#8c94a6]"} />
        </button>
      </header>

      <h2 className="moment-title">
        <button
          type="button"
          className="moment-open-trigger"
          onClick={() => onOpen(star)}
          aria-label={`Read ${starTitle(star)}`}
        >
          {starTitle(star)}
        </button>
      </h2>

      <p className="moment-excerpt">{star.content}</p>

      <footer className="moment-meta">
        <time className="moment-date" dateTime={star.createdAt}>
          {shortNight(star.createdAt, timeZone)}
        </time>
        <BrightnessDots intensity={star.intensity} />
      </footer>
    </article>
  );
}
