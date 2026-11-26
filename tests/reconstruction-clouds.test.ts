import assert from "node:assert/strict";
import { test } from "node:test";
import { packSession, unpackSession } from "../src/core/aeproj/package.ts";
import { readZip } from "../src/core/aeproj/zip.ts";
import { decodeCloudPoints, cloudMeta, encodeCloudPoints, parseCloudFile, parseSparseCloud } from "../src/core/capture/sparseCloud.ts";
import { photoSet, photoSetText } from "../src/core/capture/photoSet.ts";
import { startHistory, type Session } from "../src/core/history.ts";
import { exampleProject } from "../src/core/project.ts";
import { cloudForPhotos, defaultReconstruction, type ReconstructionSetup } from "../src/core/reconstruction.ts";

const generator = { name: "test", version: "0" };
const LIMITS = { maxEntries: 1e5, maxEntryBytes: 1e9, maxTotalBytes: 1e10 };

function cloudJson(kind: "sparse" | "dense", n: number, extra: Record<string, unknown> = {}) {
  const points = Array.from({ length: n }, (_, i) => [i * 0.25 - 3, (i % 7) * 0.5, -i * 0.125, i % 256, (i * 7) % 256, (i * 13) % 256]);
  return JSON.stringify({
    format: kind === "dense" ? "aero-dense-cloud" : "aero-sparse-cloud", version: 1, coordinates: "aero-y-up-m",
    registeredImages: 60, totalImages: 64, ...(kind === "dense" ? { sourcePointCount: n * 4 } : {}), points, ...extra,
  });
}
const capture = {
  cameras: [{ id: 1, model: "PINHOLE", width: 1280, height: 960, params: [1065.123456, 1065.123456, 640, 480] }],
  frames: [
    { file: "images/0002.jpg", camera: 1, position: [1.5, -2.25, 10] },
    { file: "images/0001.jpg", camera: 1, position: [0, 0.001, -0] },
  ],
};
const shas = new Map([["images/0001.jpg", "a".repeat(64)], ["images/0002.jpg", "b".repeat(64)]]);

test("binary point data round-trips exactly, 15 bytes per point", () => {
  const cloud = parseSparseCloud(cloudJson("dense", 1000));
  const bytes = encodeCloudPoints(cloud);
  assert.equal(bytes.byteLength, 12 + 1000 * 15);
  assert.deepEqual(decodeCloudPoints(bytes, cloudMeta(cloud)), cloud);
});

test("corrupt point data is rejected", () => {
  const cloud = parseSparseCloud(cloudJson("sparse", 10));
  const bytes = encodeCloudPoints(cloud);
  assert.throws(() => decodeCloudPoints(bytes.subarray(0, bytes.length - 1), cloudMeta(cloud)));
  const bad = bytes.slice();
  bad[0] = 0;
  assert.throws(() => decodeCloudPoints(bad, cloudMeta(cloud)));
});

test("photo fingerprint is canonical and changes with photos, priors or intrinsics", async () => {
  assert.equal(photoSetText(capture, shas), [
    "aero-photo-set 1",
    "camera 1 PINHOLE 1280 960 1065.123456,1065.123456,640.000000,480.000000",
    `frame images/0001.jpg 1 ${"a".repeat(64)} 0.000,0.001,0.000`,
    `frame images/0002.jpg 1 ${"b".repeat(64)} 1.500,-2.250,10.000`,
    "",
  ].join("\n"));
  const base = await photoSet(capture, shas);
  assert.deepEqual(base.files.map((f) => f.file), ["images/0001.jpg", "images/0002.jpg"]);
  assert.equal((await photoSet(structuredClone(capture), new Map(shas))).digest, base.digest);
  const otherPhoto = new Map(shas).set("images/0002.jpg", "c".repeat(64));
  assert.notEqual((await photoSet(capture, otherPhoto)).digest, base.digest);
  const moved = structuredClone(capture);
  moved.frames[0].position[2] = 10.001;
  assert.notEqual((await photoSet(moved, shas)).digest, base.digest);
  const zoomed = structuredClone(capture);
  zoomed.cameras[0].params[0] = 1000;
  assert.notEqual((await photoSet(zoomed, shas)).digest, base.digest);
});

test("cloud files may carry the fingerprint written by tools/colmap", async () => {
  const photos = await photoSet(capture, shas);
  assert.deepEqual(parseCloudFile(cloudJson("sparse", 5, { photos })).photos, photos);
  assert.equal(parseCloudFile(cloudJson("sparse", 5)).photos, undefined);
  assert.throws(() => parseCloudFile(cloudJson("sparse", 5, { photos: { digest: "x", files: [] } })));
});

async function sessionWithClouds(): Promise<Session> {
  const photos = await photoSet(capture, shas);
  const r: ReconstructionSetup = {
    ...defaultReconstruction(),
    clouds: {
      sparse: { cloud: parseSparseCloud(cloudJson("sparse", 500)), photos, createdAt: 1000 },
      dense: { cloud: parseSparseCloud(cloudJson("dense", 2000)), createdAt: 2000 },
    },
  };
  return { history: startHistory(exampleProject(), "打开项目", 0), checkpoints: [], reconstruction: r };
}

test("point clouds are saved in .aeproj as binary assets, photos only as a fingerprint", async () => {
  const s = await sessionWithClouds();
  const bytes = await packSession(s, { generator, now: new Date(0) });
  const files = await readZip(bytes, LIMITS);
  const clouds = [...files.keys()].filter((k) => k.endsWith(".cloud"));
  assert.equal(clouds.length, 2);
  assert.ok(![...files.keys()].some((k) => k.endsWith(".jpg")));
  const json = JSON.parse(new TextDecoder().decode(files.get("reconstruction.json")));
  assert.equal(json.clouds.sparse.photos.digest, s.reconstruction!.clouds!.sparse!.photos!.digest);
  assert.equal(json.clouds.sparse.points, 500);
  assert.match(json.clouds.dense.data.asset, /^assets\/[0-9a-f]{64}\.cloud$/);
  const { session } = await unpackSession(bytes);
  assert.deepEqual(session.reconstruction!.clouds, s.reconstruction!.clouds);
});

test("packages without clouds still open", async () => {
  const s: Session = { history: startHistory(exampleProject(), "打开项目", 0), checkpoints: [], reconstruction: defaultReconstruction() };
  const { session } = await unpackSession(await packSession(s, { generator, now: new Date(0) }));
  assert.equal(session.reconstruction!.clouds, undefined);
});

test("a stored cloud is reused only for the same photos", async () => {
  const s = await sessionWithClouds();
  const r = s.reconstruction!;
  const same = await photoSet(structuredClone(capture), new Map(shas));
  assert.equal(cloudForPhotos(r, "sparse", same), r.clouds!.sparse);
  assert.equal(cloudForPhotos(r, "dense", same), undefined, "no fingerprint, no reuse");
  const other = await photoSet(capture, new Map(shas).set("images/0001.jpg", "d".repeat(64)));
  assert.equal(cloudForPhotos(r, "sparse", other), undefined);
  assert.equal(cloudForPhotos(undefined, "sparse", same), undefined);
});
