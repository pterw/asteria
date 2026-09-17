import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = performance.now();
  try {
    await db.execute(sql`select 1`);
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const memory = process.memoryUsage();

    return Response.json({
      status: "healthy",
      database: {
        status: "connected",
        latencyMs,
      },
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Number((memory.rss / (1024 * 1024)).toFixed(1)),
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      status: "unhealthy",
      database: {
        status: "disconnected",
        error: error instanceof Error ? error.message : "Database unreachable",
      },
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
