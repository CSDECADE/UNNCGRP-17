import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProject, makeDrone } from "../src/core/project.ts";
import type { Project, Vec3 } from "../src/core/types.ts";
import { analyzeRoutes } from "../src/features/analysis/route-analysis.ts";

function crossing(delayed: boolean): Project {
  const a = makeDrone(1), b = makeDrone(2);
  const point = (droneId: string, id: string, position: Vec3, time: number) => ({
    id, droneId, name: id, position, target: [0, 0, 0] as Vec3, time,
  });
  return { ...emptyProject(), drones: [a, b, makeDrone(3)], viewpoints: [
    point(a.id, "a1", [-5, 0, 0], 0), point(a.id, "a2", [5, 0, 0], 10),
    point(b.id, "b1", [0, 0, -5], delayed ? 10 : 0), point(b.id, "b2", [0, 0, 5], delayed ? 20 : 10),
  ] };
}

test("finds the closest approach inside a segment and excludes drones without a route", () => {
  const result = analyzeRoutes(crossing(false));
  assert.equal(result.totalDistance, 20);
  assert.deepEqual(result.routes.map((route) => route.count), [2, 2, 0]);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].distance, 0);
  assert.equal(result.pairs[0].time, 5);
});

test("identical spatial crossing does not imply a simultaneous approach", () => {
  const result = analyzeRoutes(crossing(true));
  assert.equal(result.pairs[0].distance, 5);
  assert.equal(result.pairs[0].time, 5);
});

test("uses the simulation time when timestamps are not available", () => {
  const project = crossing(false);
  project.viewpoints.forEach((point) => delete point.time);
  const result = analyzeRoutes(project);
  assert.equal(result.timed, false);
  assert.equal(result.pairs[0].time, 3);
});
