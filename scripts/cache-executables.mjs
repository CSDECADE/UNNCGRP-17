import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { realpathSync, openSync, readSync, closeSync, statSync, chmodSync } from "node:fs";
import path from "node:path";

// File-provider sync can remove mode bits again after the pre-build check.
// Repair only macOS binaries within this build's trusted tool cache at launch.
export function repairCachedToolsAtLaunch(cacheRoot) {
  if (process.platform !== "darwin") return () => {};
  const root = realpathSync(cacheRoot) + path.sep;
  const originals = { spawn: childProcess.spawn, execFile: childProcess.execFile };
  function repair(command) {
    if (typeof command !== "string" || !path.isAbsolute(command)) return;
    let file;
    try { file = realpathSync(command); } catch { return; }
    if (!file.startsWith(root)) return;
    const fd = openSync(file, "r"), magic = Buffer.alloc(4);
    try { readSync(fd, magic, 0, 4, 0); } finally { closeSync(fd); }
    if (["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(magic.toString("hex"))) {
      const mode = statSync(file).mode;
      if (!(mode & 0o100)) chmodSync(file, mode | 0o500);
    }
  }
  for (const method of ["spawn", "execFile"]) {
    childProcess[method] = function(command, ...args) {
      repair(command);
      return originals[method].call(this, command, ...args);
    };
  }
  syncBuiltinESMExports();
  return () => {
    Object.assign(childProcess, originals);
    syncBuiltinESMExports();
  };
}
