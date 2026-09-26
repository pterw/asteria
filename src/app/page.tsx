import Landing from "@/components/landing/Landing";
import Unavailable from "@/components/system/Unavailable";
import { JournalTimeProvider } from "@/components/sky/JournalTime";
import { loadSky } from "@/lib/sky-loader";

export const dynamic = "force-dynamic";

export default async function Page() {
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
      <Landing stars={sky.stars} />
    </JournalTimeProvider>
  );
}
