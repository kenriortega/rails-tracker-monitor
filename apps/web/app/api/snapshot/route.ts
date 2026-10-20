import type { Snapshot } from "@rails/domain";
import { latestVersion, liveRuns } from "@/lib/live-runs";

export async function GET() {
  const runs = await liveRuns(0);
  const snapshot: Snapshot = {version: latestVersion(runs, 0), generatedAt: new Date().toISOString(), runs};
  return Response.json(snapshot, {headers: {"cache-control": "no-store"}});
}
