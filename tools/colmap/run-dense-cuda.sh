#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: sh tools/colmap/run-dense-cuda.sh /path/to/COLMAP-workspace" >&2
  exit 2
fi
workspace=$1
for config in patch-match.cfg fusion.cfg; do
  if [ ! -s "$workspace/stereo/$config" ]; then
    echo "Missing COLMAP workspace configuration: $config" >&2
    exit 2
  fi
done
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi -L >/dev/null 2>&1; then
  echo "CUDA unavailable: no accessible NVIDIA GPU. Dense reconstruction was not run." >&2
  exit 1
fi
if ! command -v colmap >/dev/null; then
  echo "Install a CUDA-enabled COLMAP CLI and add it to PATH." >&2
  exit 1
fi
if [ -e "$workspace/fused.ply" ]; then
  echo "fused.ply already exists. Move it aside before running again." >&2
  exit 1
fi
colmap patch_match_stereo --workspace_path "$workspace" --workspace_format COLMAP \
  --PatchMatchStereo.geom_consistency true
colmap stereo_fusion --workspace_path "$workspace" --workspace_format COLMAP \
  --input_type geometric --output_path "$workspace/fused.ply"
test -s "$workspace/fused.ply"
