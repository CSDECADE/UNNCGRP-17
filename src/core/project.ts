import type {
  Drone,
  Model,
  ModelKind,
  Project,
  Vec3,
  Viewpoint,
} from "./types.ts";
import { ProjectValidationError, UserInputError } from "./feedback.ts";
import { validateBackground } from "./background.ts";
export const uid = () => crypto.randomUUID();
export const droneColors = ["#55c4c0", "#f2a35a", "#a78bfa", "#ec8aa6"];
export function makeModel(kind: ModelKind, n: number): Model {
  return {
    id: uid(),
    kind,
    name: `${{ box: "长方体", cylinder: "圆柱塔", building: "教学楼" }[kind]} ${n}`,
    position: [0, 0, 0],
    rotation: 0,
    size:
      kind === "building"
        ? [24, 18, 14]
        : kind === "cylinder"
          ? [8, 20, 8]
          : [12, 10, 12],
    color: "#bdc5d2",
    visible: true,
    locked: false,
  };
}
export function makeDrone(n: number): Drone {
  return {
    id: uid(),
    name: `无人机 ${String(n).padStart(2, "0")}`,
    position: [-24, 14, 22],
    rotation: 0,
    color: droneColors[(n - 1) % droneColors.length],
    fov: 60,
    visible: true,
  };
}
export function emptyProject(): Project {
  return {
    version: 1,
    name: "未命名项目",
    models: [],
    drones: [],
    viewpoints: [],
    source: "用户手动编排",
  };
}
export function exampleProject(): Project {
  const a = makeDrone(1),
    b = makeDrone(2);
  a.position = [-27, 15, 24];
  b.position = [30, 22, -22];
  const building = makeModel("building", 1);
  building.name = "教学楼 A";
  const tower = makeModel("cylinder", 1);
  tower.name = "观测塔";
  tower.position = [27, 0, -12];
  tower.size = [7, 24, 7];
  const annex = makeModel("box", 1);
  annex.name = "实验楼";
  annex.position = [-25, 0, -16];
  annex.size = [13, 9, 12];
  annex.color = "#8998ac";
  const routes: Vec3[][] = [
    [
      [-27, 15, 24],
      [-6, 18, 30],
      [22, 20, 25],
      [30, 22, 8],
    ],
    [
      [30, 22, -22],
      [8, 24, -30],
      [-20, 22, -28],
      [-32, 18, -6],
    ],
  ];
  return {
    version: 1,
    name: "校园航拍 · 方案 01",
    models: [building, tower, annex],
    drones: [a, b],
    source: "内置示例",
    viewpoints: [a, b].flatMap((d, i) =>
      routes[i].map((position, j) => ({
        id: uid(),
        droneId: d.id,
        name: `拍摄点 ${j + 1}`,
        position,
        target: [0, 10, 0],
      })),
    ),
  };
}
const fail = (msg: string): never => {
  throw new ProjectValidationError(msg);
};
const finite = (n: unknown, min = -10000, max = 10000): number =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max
    ? n
    : fail("数值超出支持范围");
const str = (s: unknown): string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 160
    ? s
    : fail("名称或标识无效");
const vec = (v: unknown, positive = false): Vec3 =>
  Array.isArray(v) && v.length === 3
    ? (v.map((n) => finite(n, positive ? 0.1 : -10000)) as Vec3)
    : fail("三维坐标无效");
const color = (c: unknown) =>
  typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : fail("颜色格式无效");
const bool = (x: unknown) =>
  typeof x === "boolean" ? x : fail("显隐或锁定设置无效");
const record = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : fail("对象格式无效");
const array = (x: unknown, limit: number): unknown[] =>
  Array.isArray(x) && x.length <= limit ? x : fail("对象数量或列表格式无效");
export function validateProject(input: unknown): Project {
  const p = record(input);
  if (p.version !== 1) fail("不支持此项目版本");
  const models: Model[] = array(p.models, 500).map((x) => {
    const m = record(x);
    if (!["box", "cylinder", "building"].includes(String(m.kind)))
      fail("未知内置模型");
    return {
      id: str(m.id),
      name: str(m.name),
      kind: m.kind as ModelKind,
      position: vec(m.position),
      rotation: finite(m.rotation),
      size: vec(m.size, true),
      color: color(m.color),
      visible: bool(m.visible),
      locked: bool(m.locked),
    };
  });
  const drones: Drone[] = array(p.drones, 50).map((x) => {
    const d = record(x);
    return {
      id: str(d.id),
      name: str(d.name),
      position: vec(d.position),
      rotation: finite(d.rotation),
      color: color(d.color),
      fov: finite(d.fov, 10, 120),
      visible: bool(d.visible),
    };
  });
  const viewpoints: Viewpoint[] = array(p.viewpoints, 2000).map((x) => {
    const v = record(x);
    const out: Viewpoint = {
      id: str(v.id),
      name: str(v.name),
      droneId: str(v.droneId),
      position: vec(v.position),
      target: vec(v.target),
    };
    if (v.time !== undefined) out.time = finite(v.time, 0, 86400);
    return out;
  });
  const ids = [...models, ...drones, ...viewpoints].map((o) => o.id);
  if (new Set(ids).size !== ids.length) fail("对象标识重复");
  if (viewpoints.some((v) => !drones.some((d) => d.id === v.droneId)))
    fail("拍摄点引用了不存在的无人机");
  for (const d of drones) {
    const route = viewpoints.filter((v) => v.droneId === d.id),
      timed = route.filter((v) => v.time !== undefined);
    if (timed.length && timed.length !== route.length)
      fail("同一航线的时间信息必须完整");
    if (timed.some((v, i) => i > 0 && v.time! <= timed[i - 1].time!))
      fail("航线时间必须严格递增");
  }
  const source = ["内置示例", "用户手动编排", "导入的算法结果"].includes(
    String(p.source),
  )
    ? (p.source as Project["source"])
    : fail("方案来源无效");
  const project: Project = { version: 1, name: str(p.name), models, drones, viewpoints, source };
  if (p.background !== undefined) project.background = validateBackground(p.background);
  return project;
}
export function parseProject(text: string): Project {
  return validateProject(parseFile(text));
}
function parseFile(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > 5_000_000)
    throw new UserInputError("文件超过 5 MB，请选择较小的文件。");
  try { return JSON.parse(text); }
  catch { throw new UserInputError("文件内容无法识别，请选择完整的 JSON 文件。"); }
}
export function routeFor(p: Project, id: string) {
  return p.viewpoints.filter((v) => v.droneId === id);
}
export function timing(p: Project) {
  const timed =
    p.viewpoints.length > 0 && p.viewpoints.every((v) => v.time !== undefined);
  return {
    timed,
    duration: timed
      ? Math.max(1, ...p.viewpoints.map((v) => v.time!))
      : Math.max(
          10,
          ...p.drones.map((d) => Math.max(1, routeFor(p, d.id).length - 1) * 6),
        ),
  };
}
export function poseAt(
  p: Project,
  drone: Drone,
  progress: number,
): { position: Vec3; target: Vec3 } {
  const route = routeFor(p, drone.id);
  if (!route.length) return { position: drone.position, target: [0, 0, 0] };
  const { timed, duration } = timing(p),
    cursor = Math.max(0, Math.min(1, progress)) * duration;
  const times = route.map((v, i) => (timed ? v.time! : i * 6));
  if (cursor <= times[0])
    return { position: route[0].position, target: route[0].target };
  const next = times.findIndex((t) => t > cursor);
  if (next < 0)
    return { position: route.at(-1)!.position, target: route.at(-1)!.target };
  const t = (cursor - times[next - 1]) / (times[next] - times[next - 1]);
  const mix = (a: Vec3, b: Vec3): Vec3 =>
    a.map((n, i) => n + (b[i] - n) * t) as Vec3;
  return {
    position: mix(route[next - 1].position, route[next].position),
    target: mix(route[next - 1].target, route[next].target),
  };
}
export function removeObject(p: Project, type: string, id: string): Project {
  if (type === "model")
    return { ...p, models: p.models.filter((m) => m.id !== id) };
  if (type === "drone")
    return {
      ...p,
      drones: p.drones.filter((d) => d.id !== id),
      viewpoints: p.viewpoints.filter((v) => v.droneId !== id),
    };
  return { ...p, viewpoints: p.viewpoints.filter((v) => v.id !== id) };
}
export function clearTiming(p: Project): Project {
  return {
    ...p,
    source: "用户手动编排",
    viewpoints: p.viewpoints.map(({ time: _, ...v }) => v),
  };
}
export function importPlan(text: string, p: Project): Project {
  const result = record(parseFile(text));
  if (result.version !== 1) fail("不支持此方案版本");
  return validateProject({
    ...p,
    viewpoints: result.viewpoints,
    source: "导入的算法结果",
  });
}
export function reorderPoint(p: Project, id: string, delta: number): Project {
  const v = p.viewpoints.find((v) => v.id === id);
  if (!v) return p;
  const route = routeFor(p, v.droneId),
    idx = route.findIndex((v) => v.id === id),
    next = idx + delta;
  if (next < 0 || next >= route.length) return p;
  route.splice(next, 0, route.splice(idx, 1)[0]);
  let i = 0;
  return clearTiming({
    ...p,
    viewpoints: p.viewpoints.map((x) =>
      x.droneId === v.droneId ? route[i++] : x,
    ),
  });
}
