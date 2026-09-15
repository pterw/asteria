import { getJournalStars } from "@/lib/journal";
import { errorResponse, ApiError } from "@/lib/api";
import { formatNight, MOODS, starTitle } from "@/lib/astral";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, format = params.get("format") || "json", timeZone = params.get("timeZone") || "UTC";
    if (!["json", "markdown"].includes(format)) throw new ApiError(400, "Choose JSON or Markdown.");
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); } catch { throw new ApiError(400, "Choose a valid timezone."); }
    const moments = await getJournalStars();
    const date = new Date().toISOString().slice(0, 10);
    const escape = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/[\\`*_#<>]/g, "\\$&");
    const body = format === "json" ? JSON.stringify({ application: "Asteria", version: 2, timeZone, exportedAt: new Date().toISOString(), moments }, null, 2) :
      `# Asteria — your little lights\n\nExported ${date} · ${moments.length} moments · ${timeZone}\n\n` + moments.map(s =>
        `## ${escape(starTitle(s))}\n\n${formatNight(s.createdAt, timeZone)} · ${MOODS[s.mood].label} · Brightness ${s.intensity}/5${s.favorite ? " · Starred" : ""}${s.isSample ? " · Example moment" : ""}\n\n${s.content.split("\n").map(line => `> ${line}`).join("\n")}\n\n---\n`
      ).join("\n");
    return new Response(body, { headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="asteria-${date}.${format === "json" ? "json" : "md"}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) { return errorResponse(error); }
}
