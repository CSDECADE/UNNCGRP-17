const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

function configured(name) {
  const value = process.env[name];
  return value && path.isAbsolute(value) ? value : null;
}

function capabilities() {
  const jobs = configured("AERO_CAPTURE_JOBS");
  return {
    plan: !!(jobs && configured("AERO_NUAV_EXE")),
    sparse: !!(jobs && configured("AERO_COLMAP_PYTHON")),
  };
}

async function runJob(executable, args) {
  try {
    await run(executable, args, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    console.error("Capture job failed:", error.stderr || error.message);
    if (error.killed) return { error: "计算超时。请缩小场景或减少照片后重试。" };
    if (error.code === "ENOENT" || error.code === "EACCES") {
      return { error: "本机计算程序无法启动，请检查安装路径和执行权限。" };
    }
    return { error: "计算未生成可用结果，请检查输入与航线设置。" };
  }
}

async function inJob(operation) {
  const root = configured("AERO_CAPTURE_JOBS");
  if (!root) throw new Error("No capture jobs directory configured");
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, "job-"));
  return operation(folder);
}

async function plan({ obj, start, coverage, demoLimits } = {}) {
  const executable = configured("AERO_NUAV_EXE");
  if (!executable || typeof obj !== "string" || Buffer.byteLength(obj) > 8_000_000 ||
      !Array.isArray(start) || start.length !== 3 ||
      !start.every((n) => Number.isFinite(n) && Math.abs(n) <= 10_000) ||
      !Number.isFinite(coverage) || coverage < 0.01 || coverage > 1) {
    return { error: "规划参数无效，或本机规划器未配置。" };
  }
  return inJob(async (job) => {
    const input = path.join(job, "proxy.obj");
    const output = path.join(job, "route.json");
    await fs.writeFile(input, obj);
    const error = await runJob(executable, [
      input, "--drones", "1", "--start1", start.join(","), "--goal1", start.join(","),
      "--coverage", String(coverage), "--output", output,
      ...(demoLimits === true ? ["--turn-radius", "0", "--climb-angle", "90"] : []),
    ]);
    return error ?? { text: await fs.readFile(output, "utf8") };
  });
}

async function reconstruct(folder) {
  const python = configured("AERO_COLMAP_PYTHON");
  if (!python || !folder) return { error: "请先生成照片包，并配置本机 COLMAP。" };
  return inJob(async (job) => {
    const output = path.join(job, "sparse");
    const script = path.join(__dirname, "../tools/colmap/reconstruct-sparse.py");
    const error = await runJob(python, [script, folder, output]);
    return error ?? { text: await fs.readFile(path.join(output, "aero-sparse-cloud.json"), "utf8") };
  });
}

module.exports = { capabilities, plan, reconstruct };
