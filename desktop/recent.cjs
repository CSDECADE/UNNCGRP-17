// Recent .aeproj documents, stored in the app's userData directory.
// The renderer only ever sees opaque ids; paths stay in the main process.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeFileAtomic } = require("./files.cjs");

const MAX_RECENT = 12;

function createRecentStore(directory) {
  const file = path.join(directory, "recent-projects.json");
  let cache = null;
  async function load() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      cache = Array.isArray(parsed)
        ? parsed.filter(
            (e) => e && typeof e.id === "string" && typeof e.path === "string" && path.isAbsolute(e.path)
              && typeof e.name === "string" && typeof e.openedAt === "number",
          ).slice(0, MAX_RECENT)
        : [];
    } catch {
      cache = [];
    }
    return cache;
  }
  async function save(list) {
    cache = list;
    try {
      await writeFileAtomic(file, JSON.stringify(list, null, 2));
    } catch (error) {
      console.error("recent-projects", error);
    }
  }
  return {
    async list() {
      const list = await load();
      return Promise.all(
        list.map(async (e) => {
          let missing = false;
          try {
            missing = !(await fs.stat(e.path)).isFile();
          } catch {
            missing = true;
          }
          return {
            id: e.id,
            name: e.name,
            fileName: path.basename(e.path),
            folder: path.dirname(e.path),
            openedAt: e.openedAt,
            missing,
          };
        }),
      );
    },
    async find(id) {
      return (await load()).find((e) => e.id === id) ?? null;
    },
    async touch(filename, name) {
      const list = await load();
      const previous = list.find((e) => e.path === filename);
      const entry = {
        id: previous?.id ?? randomUUID(),
        path: filename,
        name: String(name || path.basename(filename)).slice(0, 160),
        openedAt: Date.now(),
      };
      await save([entry, ...list.filter((e) => e.path !== filename)].slice(0, MAX_RECENT));
    },
    async remove(id) {
      await save((await load()).filter((e) => e.id !== id));
    },
  };
}
module.exports = { createRecentStore };
