// Generate an aero-capture photo package without the UI, using headless Chrome.
// Runs the app's real exportCapture() in a page served by `npm run dev:web`.
//
//   node tools/capture-headless/capture.mjs config.json
//
// config.json (paths of the model are URLs under the dev server, e.g. put files in public/_local/):
// {
//   "app": "http://127.0.0.1:5173/",
//   "reference": "/_local/flat-roof.glb",
//   "frame": { "upAxis": "z", "offset": [-2.735, 2.25, 1.37] },
//   "bounds": { "min": [-18.3, 0, -25.8], "max": [18.3, 7.4, 25.8] },   // app coordinates, for the orbit
//   "orbit": { "rings": 3, "perRing": 24, "standoff": 12, "minHeight": 3, "topRing": true },
//   "fov": 58,                                                          // drone vertical field of view
//   "capture": { "width": 2048, "height": 1536 },                       // merged into DEFAULT_CAPTURE
//   "attribution": "Drone Building Scans — Matthew Guertin, 2026. CC BY 4.0.",
//   "out": "./captures",                                                // the .zip is downloaded here
//   "gpu": false                                                        // true: try the real GPU instead of SwiftShader
// }
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const config = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const out = path.resolve(config.out ?? "./captures");
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "aero-capture-"));
const port = 9300 + Math.floor(Math.random() * 500);
const gl = config.gpu ? ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const chrome = spawn(config.chrome ?? "google-chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", ...gl, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description).join(" ");
      if (text.startsWith("[capture]")) console.log(text);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      waiting.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const script = `(async () => {
  const cfg = ${JSON.stringify(config)};
  const { exportCapture } = await import("/src/capture/exportCapture.ts");
  const { meshAsset, defaultReconstruction } = await import("/src/core/reconstruction.ts");
  const { orbitShots, applyRoute, DEFAULT_ORBIT } = await import("/src/core/capture/orbit.ts");
  const { emptyProject } = await import("/src/core/project.ts");
  const probe = document.createElement("canvas").getContext("webgl2");
  const info = probe && probe.getExtension("WEBGL_debug_renderer_info");
  console.log("[capture] renderer:", probe ? probe.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : probe.RENDERER) : "no WebGL2");
  const bytes = new Uint8Array(await (await fetch(cfg.reference)).arrayBuffer());
  const base = defaultReconstruction();
  const setup = { ...base, reference: await meshAsset(cfg.reference.split("/").pop(), bytes), frame: cfg.frame,
    attribution: cfg.attribution ?? "", capture: { ...base.capture, ...(cfg.capture ?? {}) } };
  let project = applyRoute(emptyProject(), orbitShots(cfg.bounds, { ...DEFAULT_ORBIT, ...(cfg.orbit ?? {}) }));
  project = { ...project, name: cfg.name ?? "capture", drones: project.drones.map((d) => ({ ...d, fov: cfg.fov ?? d.fov })) };
  const t0 = performance.now();
  const result = await exportCapture(project, setup, (p) => p.stage === "render" && console.log("[capture]", p.done + "/" + p.total), new AbortController().signal);
  return { name: result.name, photos: result.photos.digest, frames: project.viewpoints.length, seconds: Math.round((performance.now() - t0) / 1000) };
})()`;

try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!version) throw new Error("Chrome did not start");
  const browser = client(version.webSocketDebuggerUrl);
  await browser.ready;
  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out });
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${config.app ?? "http://127.0.0.1:5173/"}`, { method: "PUT" }).then((r) => r.json());
  const page = client(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send("Runtime.enable");
  await sleep(3000);
  const res = await page.send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true, timeout: 6 * 3600 * 1000 });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? "capture failed");
  const result = res.result.result.value;
  const file = path.join(out, result.name);
  for (let i = 0; i < 120 && !(readdirSync(out).includes(result.name) && statSync(file).size > 0); i++) await sleep(1000);
  console.log(`done: ${file} (${result.frames} photos, ${result.seconds} s, photo fingerprint ${result.photos})`);
  page.close();
  browser.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
