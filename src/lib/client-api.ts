import type { StarDto } from "./astral";
export async function journalRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } }); }
  catch { throw new Error("You're offline. Your words are safe here — try again when you're connected."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "That change couldn't be saved. Please try again.");
  return data as T;
}
export async function patchStar(id: string, changes: Record<string, unknown>) {
  return journalRequest<{ star: StarDto }>(`/api/stars/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
}
