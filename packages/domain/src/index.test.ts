import { test } from "node:test";
import assert from "node:assert/strict";
import { pointOnRoute, serviceKey, trainCoordinate, routes, trains } from "./index";
test("interpolation weights distance and clamps endpoints", () => {
  assert.deepEqual(pointOnRoute([[0, 0], [1, 0], [4, 0]], -1), [0, 0]);
  const halfway = pointOnRoute([[0, 0], [1, 0], [4, 0]], 0.5)!;
  assert.ok(Math.abs(halfway[0] - 2) < 0.0001);
  assert.deepEqual(pointOnRoute([[0, 0], [4, 0]], 3), [4, 0]);
});
test("empty / duplicate geometry is safe", () => {
  assert.equal(pointOnRoute([], 0.5), null);
  assert.deepEqual(pointOnRoute([[1, 1], [1, 1]], 0.5), [1, 1]);
});
test("run identities remain distinct across service days", () => {
  assert.notEqual(serviceKey("NR", "2026-10-19", "1A24"), serviceKey("NR", "2026-10-20", "1A24"));
});
test("stale positions stay frozen when the replay clock advances", () => {
  const train = trains.find(train => train.stale)!;
  const route = routes.find(route => route.id === train.routeId)!;
  assert.deepEqual(trainCoordinate(train, route, 0), trainCoordinate(train, route, 1800));
});
