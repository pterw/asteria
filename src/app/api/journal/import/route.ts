import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import { constellationPosition, isMoodKey, type MoodKey } from "@/lib/astral";
import { requireJournal } from "@/lib/journal";
import { ApiError, errorResponse } from "@/lib/api";
import { sanitizeText } from "@/lib/sanitize";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

interface ImportMomentPayload {
  title?: string;
  content?: string;
  mood?: string;
  intensity?: number;
  createdAt?: string;
  favorite?: boolean;
}

interface ImportFilePayload {
  application?: string;
  version?: number;
  moments?: ImportMomentPayload[];
}

export async function POST(request: Request) {
  try {
    const journalId = await requireJournal();

    // Rate limit imports: 5 imports per 10 minutes per journal
    const rateCheck = checkRateLimit(`import:${journalId}`, 5, 600_000);
    if (!rateCheck.allowed) {
      throw new ApiError(429, "Too many import requests. Please wait a few minutes before trying again.");
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(415, "Upload an Asteria JSON export file.");
    }

    const text = await request.text();
    if (text.length > 2 * 1024 * 1024) {
      throw new ApiError(413, "Import file is too large (max 2 MB).");
    }

    let parsed: ImportFilePayload;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(400, "The uploaded file is not valid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.moments)) {
      throw new ApiError(400, "The file must contain an array of Asteria moments.");
    }

    if (parsed.moments.length === 0) {
      return Response.json({ ok: true, imported: 0, message: "No moments to import." });
    }

    if (parsed.moments.length > 500) {
      throw new ApiError(413, "Maximum 500 moments can be imported at once.");
    }

    // Validate and sanitize each moment
    const validMoments: {
      title: string;
      content: string;
      mood: MoodKey;
      intensity: number;
      createdAt: Date;
      favorite: boolean;
    }[] = [];

    for (const raw of parsed.moments) {
      if (!raw || typeof raw !== "object") continue;

      const rawContent = typeof raw.content === "string" ? raw.content : "";
      const content = sanitizeText(rawContent);
      if (content.length < 2 || content.length > 420) continue;

      const rawTitle = typeof raw.title === "string" ? raw.title : "";
      const title = sanitizeText(rawTitle).slice(0, 80);

      const mood: MoodKey = (typeof raw.mood === "string" && isMoodKey(raw.mood))
        ? raw.mood
        : "serene";

      const intensity = typeof raw.intensity === "number" && Number.isInteger(raw.intensity) && raw.intensity >= 1 && raw.intensity <= 5
        ? raw.intensity
        : 3;

      let createdAt = new Date();
      if (typeof raw.createdAt === "string") {
        const d = new Date(raw.createdAt);
        if (Number.isFinite(d.getTime()) && d.getFullYear() >= 1900 && d.getTime() <= Date.now() + 86_400_000) {
          createdAt = d;
        }
      }

      const favorite = Boolean(raw.favorite);

      validMoments.push({ title, content, mood, intensity, createdAt, favorite });
    }

    if (validMoments.length === 0) {
      throw new ApiError(422, "None of the moments in this file were valid or usable.");
    }

    // Insert within a transaction with advisory locking to assign stable constellation coordinates
    const importedCount = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${journalId}))`);

      // Tally current counts per mood
      const moodCounts: Record<MoodKey, number> = {
        luminous: 0,
        tender: 0,
        serene: 0,
        electric: 0,
        verdant: 0,
        vesper: 0,
      };

      const existingRows = await tx
        .select({ mood: stars.mood, count: count() })
        .from(stars)
        .where(eq(stars.journalId, journalId))
        .groupBy(stars.mood);

      for (const row of existingRows) {
        if (isMoodKey(row.mood)) {
          moodCounts[row.mood] = Number(row.count);
        }
      }

      // Prepare batch insert rows with constellation positions
      const insertRows = validMoments.map(m => {
        const currentCount = moodCounts[m.mood]++;
        const pos = constellationPosition(m.mood, currentCount);
        return {
          journalId,
          title: m.title,
          content: m.content,
          mood: m.mood,
          intensity: m.intensity,
          favorite: m.favorite,
          x: pos.x,
          y: pos.y,
          isSample: false,
          createdAt: m.createdAt,
          updatedAt: new Date(),
        };
      });

      // Insert in chunks of 50
      for (let i = 0; i < insertRows.length; i += 50) {
        const chunk = insertRows.slice(i, i + 50);
        await tx.insert(stars).values(chunk);
      }

      return insertRows.length;
    });

    return Response.json({
      ok: true,
      imported: importedCount,
      totalRequested: parsed.moments.length,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
