import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const tests = existsSync("tests")
  ? readdirSync("tests").filter(file => /\.test\.(ts|cjs)$/.test(file))
  : [];
if (!tests.length) {
  console.log("加入测试与重构模块后可运行自动测试。");
} else {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...tests.map(file => "tests/" + file)], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
