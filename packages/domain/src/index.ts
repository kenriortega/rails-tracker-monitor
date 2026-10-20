export type Coordinate = [longitude: number, latitude: number];
export type PositionQuality = "reported" | "estimated" | "stale" | "unknown";
export interface TrainPosition {
  coordinate: Coordinate | null;
  quality: PositionQuality;
  source: "TRUST" | "TD" | "demo";
  observedAt: string;
  receivedAt: string;
}
export interface Station { id: string; name: string; coordinate: Coordinate }
export interface DemoRoute { id: string; name: string; stations: Station[]; color: string }
export interface DemoTrain {
  id: string; headcode: string; operator: string; origin: string; destination: string;
  routeId: string; delay: number; initialProgress: number; durationSeconds: number;
  reverse: boolean; stale: boolean; category: "passenger" | "freight";
}
export const DEMO_START = Date.parse("2026-10-19T13:42:00Z");
export const DEMO_DURATION = 1800;

/** Date-scoped identity. A headcode alone is never a primary key. */
export function serviceKey(provider: string, serviceDate: string, runId: string): string {
  return JSON.stringify([provider, serviceDate, runId]);
}

export function distanceKm(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dlat = (b[1] - a[1]) * rad;
  const dlon = (b[0] - a[0]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** Distance-weighted interpolation on a fixture polyline, never a GPS observation. */
export function pointOnRoute(coordinates: Coordinate[], progress: number): Coordinate | null {
  if (!coordinates.length) return null;
  if (coordinates.length === 1) return [...coordinates[0]];
  const distances = coordinates.slice(1).map((point, i) => distanceKm(coordinates[i], point));
  const total = distances.reduce((sum, length) => sum + length, 0);
  if (!total) return [...coordinates[0]];
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < distances.length; i++) {
    if (remaining <= distances[i] && distances[i] > 0) {
      const fraction = remaining / distances[i];
      return [coordinates[i][0] + (coordinates[i + 1][0] - coordinates[i][0]) * fraction, coordinates[i][1] + (coordinates[i + 1][1] - coordinates[i][1]) * fraction];
    }
    remaining -= distances[i];
  }
  return [...coordinates[coordinates.length - 1]];
}

export function trainProgress(train: DemoTrain, seconds: number): number {
  return Math.min(1, train.initialProgress + Math.max(0, seconds) / train.durationSeconds);
}
export function trainCoordinate(train: DemoTrain, route: DemoRoute, seconds: number): Coordinate | null {
  const points = route.stations.map(station => station.coordinate);
  const progress = trainProgress(train, train.stale ? 0 : seconds);
  return pointOnRoute(points, train.reverse ? 1 - progress : progress);
}
export function delayLabel(delay: number): string { return delay > 0 ? `+${delay} min` : "En hora"; }
export function trainColor(train: DemoTrain): string { return train.stale ? "#8b99ad" : train.delay >= 10 ? "#ff8073" : train.delay > 0 ? "#f4c76a" : "#91edb4"; }

export { routes, trains } from "./fixtures";
export { londonOffsetMs, londonServiceDate, resolveLondonLocalEpoch, type LondonResolution, type ResolvedInstant } from "./time";
export type { LiveRun, Snapshot, Delta, Trail, TrailPoint } from "./wire";
export { FRESH_SECONDS, SERVE_SECONDS, freshness, type Freshness } from "./freshness";
export { headcodeFromTrainId } from "./identity";
export { operator, type Operator } from "./operators";
