import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { dayKey, MOOD_KEYS, MOODS, type MoodKey } from "@/lib/astral";
import { requireJournal } from "@/lib/journal";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const journalId = await requireJournal();
    const url = new URL(request.url);
    const timeZone = url.searchParams.get("timeZone") || "UTC";

    // Validate timezone
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
    } catch {
      // Fallback to UTC if timezone string is invalid
    }

    const rows = await db
      .select({
        id: stars.id,
        mood: stars.mood,
        intensity: stars.intensity,
        favorite: stars.favorite,
        isSample: stars.isSample,
        createdAt: stars.createdAt,
      })
      .from(stars)
      .where(and(eq(stars.journalId, journalId), isNull(stars.deletedAt)))
      .orderBy(desc(stars.createdAt));

    const totalStars = rows.length;

    // Mood distribution
    const moodCounts: Record<MoodKey, number> = {
      luminous: 0,
      tender: 0,
      serene: 0,
      electric: 0,
      verdant: 0,
      vesper: 0,
    };

    const intensityCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let intensitySum = 0;
    let starredCount = 0;
    let sampleCount = 0;

    const uniqueDays = new Set<string>();
    const timeOfDayCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };

    for (const r of rows) {
      if (r.mood in moodCounts) {
        moodCounts[r.mood as MoodKey]++;
      }
      if (r.intensity >= 1 && r.intensity <= 5) {
        intensityCounts[r.intensity] = (intensityCounts[r.intensity] || 0) + 1;
        intensitySum += r.intensity;
      }
      if (r.favorite) starredCount++;
      if (r.isSample) sampleCount++;

      // Day tracking
      const dKey = dayKey(r.createdAt, timeZone);
      uniqueDays.add(dKey);

      // Time of day calculation based on requested timezone
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          hour12: false,
        }).formatToParts(r.createdAt);
        const hourPart = parts.find(p => p.type === "hour")?.value;
        const hour = hourPart ? parseInt(hourPart, 10) : r.createdAt.getUTCHours();

        if (hour >= 5 && hour < 12) timeOfDayCounts.morning++;
        else if (hour >= 12 && hour < 17) timeOfDayCounts.afternoon++;
        else if (hour >= 17 && hour < 21) timeOfDayCounts.evening++;
        else timeOfDayCounts.night++;
      } catch {
        const hour = r.createdAt.getUTCHours();
        if (hour >= 5 && hour < 12) timeOfDayCounts.morning++;
        else if (hour >= 12 && hour < 17) timeOfDayCounts.afternoon++;
        else if (hour >= 17 && hour < 21) timeOfDayCounts.evening++;
        else timeOfDayCounts.night++;
      }
    }

    // Calculate streaks
    const sortedDays = Array.from(uniqueDays).sort().reverse();
    let currentStreak = 0;
    let longestStreak = 0;
    let runningStreak = 0;

    if (sortedDays.length > 0) {
      const today = dayKey(new Date(), timeZone);
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = dayKey(yesterdayDate, timeZone);

      // Current streak check
      if (sortedDays[0] === today || sortedDays[0] === yesterday) {
        let checkDate = new Date(sortedDays[0] + "T12:00:00Z");
        for (let i = 0; i < sortedDays.length; i++) {
          const expectedKey = dayKey(checkDate, timeZone);
          if (sortedDays[i] === expectedKey) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
      }

      // Longest streak
      let prevDate: Date | null = null;
      for (const d of sortedDays.slice().reverse()) {
        const currDate = new Date(d + "T12:00:00Z");
        if (!prevDate) {
          runningStreak = 1;
        } else {
          const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86_400_000);
          if (diffDays === 1) {
            runningStreak++;
          } else if (diffDays > 1) {
            runningStreak = 1;
          }
        }
        if (runningStreak > longestStreak) longestStreak = runningStreak;
        prevDate = currDate;
      }
    }

    // Mood breakdown details
    const moodBreakdown = MOOD_KEYS.map(key => {
      const count = moodCounts[key];
      const percentage = totalStars > 0 ? Math.round((count / totalStars) * 100) : 0;
      return {
        key,
        label: MOODS[key].label,
        constellation: MOODS[key].constellation,
        hex: MOODS[key].hex,
        count,
        percentage,
      };
    });

    const activeConstellations = moodBreakdown.filter(m => m.count > 0).length;
    const dominantMood = moodBreakdown.slice().sort((a, b) => b.count - a.count)[0] || null;

    return Response.json({
      stars: totalStars,
      nights: uniqueDays.size,
      constellations: activeConstellations,
      starred: starredCount,
      samples: sampleCount,
      averageIntensity: totalStars > 0 ? Number((intensitySum / totalStars).toFixed(2)) : 0,
      intensityDistribution: intensityCounts,
      moodBreakdown,
      dominantMood,
      timeOfDay: timeOfDayCounts,
      streaks: {
        current: currentStreak,
        longest: longestStreak,
      },
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
