// Fingerprint of the inputs a reconstruction reads from a photo package: every photo's bytes, its
// position prior and the camera intrinsics. Photos themselves never go into the .aeproj; a stored point
// cloud keeps this fingerprint, so rebuilding from identical photos can reuse the stored result.
// tools/colmap/reconstruct-sparse.py computes the same digest; keep the two in sync.
//
// Canonical text (UTF-8, "\n" after every line), hashed with SHA-256:
//   aero-photo-set 1
//   camera <id> <model> <width> <height> <params with 6 decimals, comma separated>   (sorted by id)
//   frame <file> <camera> <photo sha256> <position x,y,z with 3 decimals>            (sorted by file)
export type PhotoSet = { digest: string; files: { file: string; sha256: string }[] };

type CaptureCamera = { id: number; model: string; width: number; height: number; params: number[] };
type CaptureFrame = { file: string; camera: number; position: number[] };

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Bytes(data: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
}
const fixed = (n: number, digits: number) => {
  const s = n.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

export function photoSetText(capture: { cameras: CaptureCamera[]; frames: CaptureFrame[] }, photos: Map<string, string>): string {
  const lines = ["aero-photo-set 1"];
  for (const c of [...capture.cameras].sort((a, b) => a.id - b.id))
    lines.push(`camera ${c.id} ${c.model} ${c.width} ${c.height} ${c.params.map((n) => fixed(n, 6)).join(",")}`);
  for (const f of [...capture.frames].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const sha = photos.get(f.file);
    if (!sha) throw new Error(`缺少照片 ${f.file}`);
    lines.push(`frame ${f.file} ${f.camera} ${sha} ${f.position.map((n) => fixed(n, 3)).join(",")}`);
  }
  return lines.join("\n") + "\n";
}

export async function photoSet(capture: { cameras: CaptureCamera[]; frames: CaptureFrame[] }, photos: Map<string, string>): Promise<PhotoSet> {
  const digest = await sha256Bytes(new TextEncoder().encode(photoSetText(capture, photos)));
  const files = [...capture.frames].map((f) => f.file).sort().map((file) => ({ file, sha256: photos.get(file)! }));
  return { digest, files };
}

const HEX64 = /^[0-9a-f]{64}$/;
/** Validate a stored or imported fingerprint; throws on malformed input. */
export function validatePhotoSet(input: unknown): PhotoSet {
  const invalid = () => new Error("照片指纹无效");
  const p = input as { digest?: unknown; files?: unknown };
  if (!p || typeof p !== "object" || typeof p.digest !== "string" || !HEX64.test(p.digest) ||
      !Array.isArray(p.files) || p.files.length < 1 || p.files.length > 20_000) throw invalid();
  const files = p.files.map((x) => {
    const f = x as { file?: unknown; sha256?: unknown };
    if (!f || typeof f.file !== "string" || f.file.length > 200 || typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) throw invalid();
    return { file: f.file, sha256: f.sha256 };
  });
  return { digest: p.digest, files };
}
