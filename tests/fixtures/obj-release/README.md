# Release-validation assets

Unmodified creator-authored OBJ files from [KayKit City Builder Bits 1.0](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0), revision `63976910ca04d16f0fc531b9c614244be8128713`, directory `addons/kaykit_city_builder_bits/Assets/obj/`. Creator: Kay Lousberg. Distributed under the included upstream CC0 license. These Blender-authored buildings complement controlled generated fixtures; they are not a surveyed building or BIM acceptance dataset.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `kaykit/building_A.obj` | 65003 | `2e06356de1b4e5ceeb53d51cb9af90090e1379bbbb794ca10e65d3a8d5af2f70` |
| `kaykit/building_H.obj` | 152172 | `4f4bc51e84e0c7292306fcc1e60415e7af6990fa5a8fd965e2b373d0287c2ba8` |
| `kaykit/LICENSE.txt` | 828 | `b076d86beec660e1550e00796ca24a8b70d7b2187d79954b2e29722b666dce93` |

Raw files are expected to be rejected by the current restricted OBJ profile. `conditionAuthoredObj` in `scripts/obj-release-fixtures.mjs` creates explicitly labeled diagnostic derivatives at test time: remove material references, disable smoothing metadata while retaining explicit corner normals, and triangulate quads on the 1–3 diagonal. It retains vertex, UV and normal data and does not repair or discard degenerate geometry. Derivative acceptance must never be reported as raw-file compatibility. No runtime importer changes accompany these tests.

The optional external Sibenik Cathedral sample by Marko Dabrovic is **not vendored**. Its archive metadata identifies a CC BY-NC license; it was used only for local noncommercial investigation. Source and rejection stages are recorded in the release report. The default tests and benchmark require no download.
