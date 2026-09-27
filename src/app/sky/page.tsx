import type { Metadata } from "next";
import "./astra.css";
import SkyApp from "@/components/sky/SkyApp";
import Unavailable from "@/components/system/Unavailable";
import { JournalTimeProvider } from "@/components/sky/JournalTime";
import { readWorkspaceLocation } from "@/lib/navigation";
import { loadSky } from "@/lib/sky-loader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your sky",
  description: "Your moments as a night sky. Wind time back and watch it form.",
};

/**
 * The observatory.
 *
 * The URL *is* the state: view, feeling, period, day and sort all live in the query string
 * (see `readWorkspaceLocation`), which is what makes a filtered view survivable across a
 * reload, shareable with a future self, and reachable with the back button.
 */
export default async function SkyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
  const location = readWorkspaceLocation(params);
  const sky = await loadSky();

  if (!sky.ok) {
    return (
      <JournalTimeProvider>
        <Unavailable reason={sky.reason} detail={sky.message} />
      </JournalTimeProvider>
    );
  }

  return (
    <JournalTimeProvider>
      <SkyApp
        initialStars={sky.stars}
        now={new Date().toISOString()}
        initialView={location.view}
        initialFilters={location.filters}
        firstRun={sky.isNew}
      />
    </JournalTimeProvider>
  );
}
