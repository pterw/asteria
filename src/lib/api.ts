import { isMoodKey, type MoodKey } from "./astral";
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Journal request failed", error);
  return Response.json({ error: "Your journal is temporarily unavailable. Nothing was lost; please try again." }, { status: 503 });
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "Send a JSON request.");
  if (Number(request.headers.get("content-length") || 0) > 8192) throw new ApiError(413, "This moment is too large.");
  const text = await request.text();
  if (text.length > 8192) throw new ApiError(413, "This moment is too large.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError(400, "The request could not be read."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "Expected a moment object.");
  return value as Record<string, unknown>;
}
export interface MomentInput { title: string; content: string; mood: MoodKey; intensity: number; createdAt: Date; }
export function validateMoment(body: Record<string, unknown>, partial = false): Partial<MomentInput> {
  const result: Partial<MomentInput> = {};
  if (!partial || "title" in body) {
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length > 80)) throw new ApiError(422, "Keep the title within 80 characters.");
    result.title = typeof body.title === "string" ? body.title.trim() : "";
  }
  if (!partial || "content" in body) {
    if (typeof body.content !== "string" || body.content.trim().length < 2 || body.content.trim().length > 420) throw new ApiError(422, "A moment needs 2–420 characters.");
    result.content = body.content.trim();
  }
  if (!partial || "mood" in body) {
    if (!isMoodKey(body.mood)) throw new ApiError(422, "Choose one of the six feelings.");
    result.mood = body.mood;
  }
  if (!partial || "intensity" in body) {
    if (typeof body.intensity !== "number" || !Number.isInteger(body.intensity) || body.intensity < 1 || body.intensity > 5) throw new ApiError(422, "Brightness must be a whole number from 1 to 5.");
    result.intensity = body.intensity;
  }
  if (!partial || "createdAt" in body) {
    if (body.createdAt !== undefined && (typeof body.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(body.createdAt))) throw new ApiError(422, "Choose a valid date.");
    const date = body.createdAt === undefined ? new Date() : new Date(body.createdAt as string);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1900 || date.getTime() > Date.now() + 86_400_000) throw new ApiError(422, "Choose a date between 1900 and today.");
    if (typeof body.createdAt === "string") {
      const calendarDay = body.createdAt.slice(0, 10);
      const checked = new Date(`${calendarDay}T00:00:00Z`);
      if (!Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 10) !== calendarDay) throw new ApiError(422, "That calendar date doesn't exist.");
    }
    result.createdAt = date;
  }
  return result;
}
