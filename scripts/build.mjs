import path from "node:path";
import { fileURLToPath } from "node:url";
import "./prepare-build.mjs";
import { repairCachedToolsAtLaunch } from "./cache-executables.mjs";

// Keep the permission repair adjacent to esbuild's actual launch: NAS sync
// can reset its mode after the pre-build check and before Vite loads config.
const restore = repairCachedToolsAtLaunch(fileURLToPath(new URL("../node_modules", import.meta.url)));
try {
  const { build } = await import("vite");
  await build({ root: path.resolve(fileURLToPath(new URL("..", import.meta.url))) });
} finally {
  restore();
}
