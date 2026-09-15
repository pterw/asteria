import Landing from "@/components/landing/Landing";
import { JournalTimeProvider } from "@/components/sky/JournalTime";
import { getJournalStars } from "@/lib/journal";
export const dynamic = "force-dynamic";
export default async function Page() {
  const stars = await getJournalStars();
  return <JournalTimeProvider><Landing stars={stars} /></JournalTimeProvider>;
}
