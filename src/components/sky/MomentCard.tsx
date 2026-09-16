"use client";
import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import MoodDot from "@/components/ui/MoodDot";
import { useJournalTime } from "./JournalTime";
import { MOODS, shortNight, starTitle, type StarDto } from "@/lib/astral";

export function BrightnessDots({ intensity }: { intensity: number }) {
  return <span className="brightness-dots" aria-label={`Brightness ${intensity} of 5`}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i > intensity ? "off" : ""} />)}</span>;
}
export default function MomentCard({ star, onOpen, onFavorite, pending = false }: {
  star: StarDto; onOpen: (star: StarDto) => void; onFavorite: (star: StarDto) => void; pending?: boolean;
}) {
  const timeZone = useJournalTime();
  return <article className="moment-card" style={{ "--mood": MOODS[star.mood].hex } as CSSProperties}>
    <button className="moment-open" onClick={() => onOpen(star)} aria-label={`Read ${starTitle(star)}`}>
      <span className="moment-mood"><MoodDot mood={star.mood} />{MOODS[star.mood].label}</span>
      <span className="moment-title">{starTitle(star)}</span>
      <span className="moment-excerpt">{star.content}</span>
      <span className="moment-meta"><span>{shortNight(star.createdAt, timeZone)}{star.isSample && <span className="sample-label">Example</span>}</span><BrightnessDots intensity={star.intensity} /></span>
    </button>
    <button className={`moment-favorite ${star.favorite ? "is-favorite" : ""}`} onClick={() => onFavorite(star)}
      aria-label={`${star.favorite ? "Unstar" : "Star"} ${starTitle(star)}`} aria-pressed={star.favorite} disabled={pending} title={star.favorite ? "Remove from starred" : "Keep in starred"}><Star size={13} /></button>
  </article>;
}
