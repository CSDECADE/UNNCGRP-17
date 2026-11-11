import { readdir, open, chmod, stat } from "node:fs/promises";
import path from "node:path";
// Only packaged Mach-O files are executable. NAS sync can remove these mode bits.
export async function restoreMacExecutables(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await restoreMacExecutables(file);
    else if (entry.isFile()) {
      const handle = await open(file, "r");
      const magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      if (["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(magic.toString("hex")))
        await chmod(file, (await stat(file)).mode | 0o500);
    }
  }
}
