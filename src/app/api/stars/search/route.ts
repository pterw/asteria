import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, type SQL } from "drizzle-orm";
import { isMoodKey, type MoodKey } from "@/lib/astral";
import { requireJournal, toStar } from "@/lib/journal";
import { ApiError, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const journalId = await requireJournal();
    const url = new URL(request.url);
    const params = url.searchParams;

    const q = params.get("q")?.trim() || "";
    const mood = params.get("mood") || "all";
    const starred = params.get("starred");
    const intensityMin = params.get("intensity_min");
    const intensityMax = params.get("intensity_max");
    const since = params.get("since");
    const until = params.get("until");
    const sort = params.get("sort") || "newest";

    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(params.get("offset") || "0", 10) || 0);

    const conditions: SQL[] = [
      eq(stars.journalId, journalId),
      isNull(stars.deletedAt),
    ];

    if (q) {
      // Search both title and content
      const searchPattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
      conditions.push(or(ilike(stars.title, searchPattern), ilike(stars.content, searchPattern))!);
    }

    if (mood !== "all" && isMoodKey(mood)) {
      conditions.push(eq(stars.mood, mood as MoodKey));
    }

    if (starred === "true" || starred === "1") {
      conditions.push(eq(stars.favorite, true));
    }

    if (intensityMin) {
      const minVal = parseInt(intensityMin, 10);
      if (Number.isInteger(minVal) && minVal >= 1 && minVal <= 5) {
        conditions.push(gte(stars.intensity, minVal));
      }
    }

    if (intensityMax) {
      const maxVal = parseInt(intensityMax, 10);
      if (Number.isInteger(maxVal) && maxVal >= 1 && maxVal <= 5) {
        conditions.push(lte(stars.intensity, maxVal));
      }
    }

    if (since) {
      const sinceDate = new Date(since);
      if (Number.isFinite(sinceDate.getTime())) {
        conditions.push(gte(stars.createdAt, sinceDate));
      }
    }

    if (until) {
      const untilDate = new Date(until);
      if (Number.isFinite(untilDate.getTime())) {
        conditions.push(lte(stars.createdAt, untilDate));
      }
    }

    const whereClause = and(...conditions);

    // Get total matching count
    const [{ total }] = await db
      .select({ total: count() })
      .from(stars)
      .where(whereClause);

    // Determine sort ordering
    let orderExpression: SQL[];
    switch (sort) {
      case "oldest":
        orderExpression = [asc(stars.createdAt)];
        break;
      case "brightest":
        orderExpression = [desc(stars.intensity), desc(stars.createdAt)];
        break;
      case "dimmest":
        orderExpression = [asc(stars.intensity), desc(stars.createdAt)];
        break;
      case "newest":
      default:
        orderExpression = [desc(stars.createdAt)];
        break;
    }

    const rows = await db
      .select()
      .from(stars)
      .where(whereClause)
      .orderBy(...orderExpression)
      .limit(limit)
      .offset(offset);

    return Response.json({
      stars: rows.map(toStar),
      total: Number(total),
      limit,
      offset,
      query: { q, mood, starred: starred === "true" || starred === "1", sort },
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
