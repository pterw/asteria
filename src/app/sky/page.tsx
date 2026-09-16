import type { Metadata } from "next";
import "./astra.css";
import SkyApp from "@/components/sky/SkyApp";
import { JournalTimeProvider } from "@/components/sky/JournalTime";
import { getJournalStars } from "@/lib/journal";
import { readWorkspaceLocation } from "@/lib/navigation";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your sky", description: "Your memories as a night sky. Wind time back and watch it form." };
export default async function SkyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
  const location = readWorkspaceLocation(params);
  const stars = await getJournalStars();
  return <JournalTimeProvider><SkyApp initialStars={stars} now={new Date().toISOString()} initialView={location.view} initialFilters={location.filters} /></JournalTimeProvider>;
}
