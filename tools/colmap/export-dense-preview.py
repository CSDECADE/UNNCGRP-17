"""Convert an Aero-aligned COLMAP fused PLY (ENU metres) into an Aero preview."""
import argparse
import json
from pathlib import Path

import numpy as np
import pycolmap


def export_preview(ply, workspace, output, max_points):
    model = pycolmap.Reconstruction(workspace / "sparse")
    registered = model.num_reg_images()
    if registered == 0:
        raise ValueError("The aligned sparse model has no registered cameras")
    count = sum(path.is_file() for path in (workspace / "images").iterdir())
    if count < registered:
        raise ValueError("The workspace is missing registered images")
    dense = pycolmap.Reconstruction()
    dense.import_PLY(ply)
    total = dense.num_points3D()
    if total == 0:
        raise ValueError("The fused PLY contains no points")
    ids = list(dense.points3D.keys())
    if len(ids) > max_points:
        indices = np.random.default_rng(0).choice(len(ids), max_points, replace=False)
        ids = [ids[i] for i in sorted(indices)]
    points = []
    for point_id in ids:
        point = dense.points3D[point_id]
        east, north, up = point.xyz
        xyz = [round(float(east), 5), round(float(up), 5), round(float(-north), 5)]
        points.append([*xyz, *(int(c) for c in point.color)])
    data = {
        "format": "aero-dense-cloud", "version": 1, "coordinates": "aero-y-up-m",
        "source": ply.name, "registeredImages": registered, "totalImages": count,
        "sourcePointCount": total, "points": points,
    }
    encoded = json.dumps(data, allow_nan=False, separators=(",", ":")).encode()
    if len(encoded) > 12_000_000:
        raise ValueError("Preview exceeds the Aero import limit. Use a smaller --max-points.")
    with output.open("xb") as file:
        file.write(encoded)
    print(f"{len(points):,} preview points out of {total:,} fused points -> {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ply", type=Path)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-points", type=int, default=150_000)
    args = parser.parse_args()
    if not 1 <= args.max_points <= 200_000:
        parser.error("--max-points must be between 1 and 200000")
    export_preview(args.ply, args.workspace, args.output, args.max_points)
