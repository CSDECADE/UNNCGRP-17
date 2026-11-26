"""Reconstruct a single-camera Aero photo package with PyCOLMAP on the CPU."""
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
from contextlib import contextmanager
from shutil import copyfile

import numpy as np
import pycolmap as colmap

from photo_set import photo_set


@contextmanager
def capture_input(source):
    if source.is_dir():
        yield json.loads((source / "capture.json").read_text()), lambda name, dst: copyfile(source / name, dst)
        return
    with ZipFile(source) as capture:
        manifests = [name for name in capture.namelist() if name == "capture.json" or name.endswith("/capture.json")]
        if len(manifests) != 1:
            raise ValueError("Expected one capture.json")
        manifest = manifests[0]
        prefix = manifest.removesuffix("capture.json")
        yield json.loads(capture.read(manifest)), lambda name, dst: dst.write_bytes(capture.read(prefix + name))


def load_capture(source, output):
    images = output / "images"
    images.mkdir()
    with capture_input(source) as (metadata, copy_photo):
        if metadata["format"] != "aero-capture" or metadata["version"] != 1:
            raise ValueError("Unsupported Aero photo package")
        cameras = metadata["cameras"]
        if len(cameras) != 1 or cameras[0]["model"] != "PINHOLE":
            raise ValueError("Expected one PINHOLE camera")
        camera = cameras[0]
        priors = {}
        photo_sha = {}
        for frame in metadata["frames"]:
            file = PurePosixPath(frame["file"])
            if (file.parts != ("images", file.name) or file.suffix.lower() != ".jpg"
                    or file.name in priors or frame["camera"] != camera["id"]):
                raise ValueError("Invalid photo entry")
            priors[file.name] = frame["position"]
            copy_photo(str(file), images / file.name)
            photo_sha[str(file)] = hashlib.sha256((images / file.name).read_bytes()).hexdigest()
    if len(priors) < 4 or not np.isfinite(np.asarray(list(priors.values()), dtype=float)).all():
        raise ValueError("Expected at least four photos with finite position priors")
    return images, camera, priors, photo_set(metadata, photo_sha)


def reconstruct(archive, output):
    output.mkdir(parents=True)
    images, camera, priors, photos = load_capture(archive, output)
    database = output / "features.db"
    sparse = output / "sparse"
    sparse.mkdir()
    reader = colmap.ImageReaderOptions(
        camera_model="PINHOLE",
        camera_params=",".join(str(n) for n in camera["params"]),
    )
    extraction = colmap.FeatureExtractionOptions(num_threads=4)
    extraction.sift.estimate_affine_shape = True
    extraction.sift.domain_size_pooling = True
    extraction.sift.peak_threshold = 0.003
    colmap.extract_features(database, images, camera_mode=colmap.CameraMode.SINGLE,
                            reader_options=reader, extraction_options=extraction, device=colmap.Device.cpu)
    colmap.match_exhaustive(database, matching_options=colmap.FeatureMatchingOptions(guided_matching=True, num_threads=4),
                            device=colmap.Device.cpu)
    options = colmap.IncrementalPipelineOptions()
    options.ba_refine_focal_length = False
    options.ba_refine_principal_point = False
    options.ba_refine_extra_params = False
    options.num_threads = 4
    options.mapper.init_min_num_inliers = 30
    options.mapper.init_min_tri_angle = 6
    options.mapper.abs_pose_min_num_inliers = 10
    options.mapper.abs_pose_refine_focal_length = False
    options.mapper.abs_pose_refine_extra_params = False
    options.triangulation.ignore_two_view_tracks = False
    models = colmap.incremental_mapping(database, images, sparse, options)
    if not models:
        raise RuntimeError("COLMAP did not reconstruct a model")
    model = max(models.values(), key=lambda r: (r.num_reg_images(), r.num_points3D()))
    names = [model.images[i].name for i in model.reg_image_ids()]
    if len(names) < 4 or model.num_points3D() == 0:
        raise RuntimeError("Too few registered images or no sparse points")
    location = np.asarray([priors[name] for name in names], dtype=float)
    # The inputs are noisy capture.json priors. Synthetic ground truth is never read.
    alignment = colmap.align_reconstruction_to_locations(
        model, names, location, 4, colmap.RANSACOptions(max_error=6.0, min_inlier_ratio=0.5),
    )
    if alignment is None or not math.isfinite(alignment.scale) or alignment.scale <= 0:
        raise RuntimeError("Could not align the reconstruction to the position priors")
    model.transform(alignment)
    registered = {model.images[i].name: model.images[i].projection_center() for i in model.reg_image_ids()}
    errors = [np.linalg.norm(registered[name] - priors[name]) for name in names]
    points = []
    for point in model.points3D.values():
        e, n, u = point.xyz
        rgb = [int(c) for c in point.color]
        points.append([round(float(e), 6), round(float(u), 6), round(float(-n), 6), *rgb])
    aligned = output / "sparse-enu"
    aligned.mkdir()
    model.write(aligned)
    model.export_PLY(output / "sparse-enu.ply")
    result = {
        "format": "aero-sparse-cloud", "version": 1, "coordinates": "aero-y-up-m",
        "source": archive.name,
        "registeredImages": len(names), "totalImages": len(priors),
        "meanReprojectionErrorPx": model.compute_mean_reprojection_error(),
        "priorRmseM": float(np.sqrt(np.mean(np.square(errors)))),
        # Lets Aero reuse this cloud when the same photos are reconstructed again.
        "photos": photos,
        "points": points,
    }
    result_file = output / "aero-sparse-cloud.json"
    result_file.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({k: (v["digest"] if k == "photos" else v) for k, v in result.items() if k != "points"}, indent=2))
    print(f"{len(points)} sparse points -> {result_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path, help="A new directory for the reconstruction")
    args = parser.parse_args()
    reconstruct(args.archive, args.output)
