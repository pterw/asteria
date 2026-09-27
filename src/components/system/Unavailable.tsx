import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

/**
 * The screen a writer sees when the database is not answering.
 *
 * Every word here is chosen for the moment: nothing is lost, nothing needs doing, and the
 * writing they already did is still in the database. A product that shows a red error for a
 * database blip teaches its users that their journal is fragile.
 */
export default function Unavailable({ reason, detail }: { reason: "unavailable" | "uninitialised"; detail?: string }) {
  const uninitialised = reason === "uninitialised";
  return (
    <main className="unavailable-screen">
      <div className="unavailable-inner">
        <p className="unavailable-mark" aria-hidden="true">✦</p>
        <h1>{uninitialised ? "Almost ready." : "The sky is briefly clouded."}</h1>
        <p>
          {uninitialised
            ? "The database is reachable but its schema has not been applied yet. One command finishes the setup."
            : `Your journal is out of reach for a moment. Nothing was lost — your words are stored${SITE_NAME ? " in Asteria" : ""}, and this page will be here when the connection is back.`}
        </p>
        {uninitialised && <pre className="unavailable-command"><code>npm run db:migrate</code></pre>}
        {detail && !uninitialised && <p className="unavailable-detail">{detail}</p>}
        <div className="unavailable-actions">
          <Link className="primary-button" href="/sky">Try again</Link>
          <Link className="text-button" href="/about">What Asteria is</Link>
        </div>
        <p className="unavailable-footnote">
          Operators: <code>/api/health?deep=1</code> reports the database, the schema and the driver in use.
        </p>
      </div>
    </main>
  );
}
