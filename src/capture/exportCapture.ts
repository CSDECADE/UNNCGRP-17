// Simulated flight: render every viewpoint from the reference model and write an aero-capture
// photo package (desktop: a new folder; browser: a .zip download).
import { productName, version } from "../../package.json";
import { buildCapturePackage } from "../core/capture/format";
import { UserInputError } from "../core/feedback";
import type { ReconstructionSetup } from "../core/reconstruction";
import type { Project } from "../core/types";
import { writeZip, type ZipEntry } from "../core/aeproj/zip";
import { createCaptureRenderer } from "../scene/captureRenderer";

export type CaptureProgress = { done: number; total: number; stage: "prepare" | "render" | "finish" };
type Sink = { write(path: string, bytes: Uint8Array): Promise<void>; finish(): Promise<string>; abort(): Promise<void> };

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value, null, 2));

async function openSink(name: string): Promise<Sink | null> {
  const desktop = window.p15Desktop;
  if (desktop) {
    const begun = await desktop.captureBegin(name);
    if (!begun) return null;
    return {
      write: (path, bytes) => desktop.captureWrite(begun.token, path, bytes),
      finish: async () => {
        await desktop.captureEnd(begun.token, true);
        return begun.folderName;
      },
      abort: () => desktop.captureEnd(begun.token, false),
    };
  }
  // Browser build: everything is zipped in memory and downloaded at the end.
  const entries: ZipEntry[] = [];
  return {
    write: async (path, bytes) => {
      entries.push({ name: `${name}/${path}`, data: bytes });
    },
    finish: async () => {
      const zip = await writeZip(entries, { store: (n) => /\.(jpg|glb)$/.test(n) });
      const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.zip` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return `${name}.zip`;
    },
    abort: async () => {
      entries.length = 0;
    },
  };
}

/** Returns the folder / file name written, or null when the user cancelled the location dialog. */
export async function exportCapture(
  project: Project,
  setup: ReconstructionSetup,
  onProgress: (p: CaptureProgress) => void,
  signal: AbortSignal,
): Promise<string | null> {
  if (!setup.reference) throw new UserInputError("请先加载参考模型（代表真实建筑）。");
  if (!project.viewpoints.length) throw new UserInputError("当前没有拍摄点，请先生成或导入航线。");
  const { capture, groundTruth, colmap, frames } = buildCapturePackage(project, setup.capture, {
    createdAt: new Date().toISOString(),
    generator: { name: productName, version },
    attribution: setup.attribution,
    hasReferenceModel: true,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const sink = await openSink(`${project.name.replace(/[\\/:*?"<>|]/g, "-")}-capture-${stamp}`);
  if (!sink) return null;
  const { width, height, jpegQuality } = setup.capture;
  let renderer: Awaited<ReturnType<typeof createCaptureRenderer>> | null = null;
  try {
    onProgress({ done: 0, total: frames.length, stage: "prepare" });
    renderer = await createCaptureRenderer(setup.reference, setup.frame, width, height);
    for (const frame of frames) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const bytes = await renderer.shoot({ position: frame.viewpoint.position, target: frame.viewpoint.target, fov: frame.drone.fov }, jpegQuality);
      await sink.write(frame.file, bytes);
      onProgress({ done: frame.index + 1, total: frames.length, stage: "render" });
    }
    onProgress({ done: frames.length, total: frames.length, stage: "finish" });
    // Metadata last: a folder with capture.json is complete.
    await sink.write("ground_truth/poses.json", encode(groundTruth));
    await sink.write("ground_truth/colmap/cameras.txt", encode(colmap.camerasTxt));
    await sink.write("ground_truth/colmap/images.txt", encode(colmap.imagesTxt));
    await sink.write("ground_truth/colmap/points3D.txt", encode(colmap.points3DTxt));
    await sink.write("ground_truth/reference.glb", setup.reference.bytes);
    await sink.write(
      "ground_truth/reference_frame.json",
      encode({
        model: setup.reference.name,
        sha256: setup.reference.sha256,
        upAxis: setup.frame.upAxis,
        offset: setup.frame.offset,
        note: "model -> app: if upAxis is z, (x, y, z) -> (x, z, -y); then add offset. app -> ENU: E = x, N = -z, U = y.",
        attribution: setup.attribution,
      }),
    );
    await sink.write("capture.json", encode(capture));
    return await sink.finish();
  } catch (error) {
    await sink.abort().catch(() => {});
    throw error;
  } finally {
    renderer?.dispose();
  }
}
