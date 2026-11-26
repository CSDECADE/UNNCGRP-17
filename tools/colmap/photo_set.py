"""Fingerprint of an Aero photo package: photos, position priors and intrinsics.

Mirrors src/core/capture/photoSet.ts; keep the two in sync. A point cloud that carries this fingerprint
can be reused by Aero whenever the same photos are reconstructed again.

    python tools/colmap/photo_set.py <photo package folder or .zip>   # prints the JSON fingerprint
"""
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile


def _fixed(value, digits):
    text = f"{value:.{digits}f}"
    return text[1:] if text.startswith("-") and not text.strip("-0.") else text


def photo_set_text(metadata, photo_sha):
    lines = ["aero-photo-set 1"]
    for c in sorted(metadata["cameras"], key=lambda c: c["id"]):
        lines.append(f"camera {c['id']} {c['model']} {c['width']} {c['height']} " + ",".join(_fixed(n, 6) for n in c["params"]))
    for f in sorted(metadata["frames"], key=lambda f: f["file"]):
        lines.append(f"frame {f['file']} {f['camera']} {photo_sha[f['file']]} " + ",".join(_fixed(n, 3) for n in f["position"]))
    return "\n".join(lines) + "\n"


def photo_set(metadata, photo_sha):
    """photo_sha maps each frame's file (e.g. "images/0001.jpg") to the SHA-256 of its bytes."""
    digest = hashlib.sha256(photo_set_text(metadata, photo_sha).encode("utf-8")).hexdigest()
    files = [{"file": name, "sha256": photo_sha[name]} for name in sorted(f["file"] for f in metadata["frames"])]
    return {"digest": digest, "files": files}


def read_package(source):
    source = Path(source)
    if source.is_dir():
        metadata = json.loads((source / "capture.json").read_text(encoding="utf-8"))
        read = lambda name: (source / name).read_bytes()
        return metadata, {f["file"]: hashlib.sha256(read(f["file"])).hexdigest() for f in metadata["frames"]}
    with ZipFile(source) as archive:
        manifest = next(n for n in archive.namelist() if n == "capture.json" or n.endswith("/capture.json"))
        prefix = manifest.removesuffix("capture.json")
        metadata = json.loads(archive.read(manifest))
        return metadata, {f["file"]: hashlib.sha256(archive.read(prefix + f["file"])).hexdigest() for f in metadata["frames"]}


if __name__ == "__main__":
    print(json.dumps(photo_set(*read_package(sys.argv[1])), indent=2))
