import { test } from "node:test";
import assert from "node:assert/strict";
import { fileErrorMessage, persistProject, projectForSave, UserInputError, ProjectValidationError } from "../src/core/feedback.ts";
import { exampleProject, importPlan, parseProject } from "../src/core/project.ts";

test("候选方案不可进入保存流程；应用或取消后可正常保存", () => {
  const original = exampleProject();
  const candidate = importPlan(JSON.stringify({ version: 1, viewpoints: [] }), original);
  let writes = 0;
  const save = (current: typeof original, preview: typeof candidate | null) => {
    const result = projectForSave(current, preview);
    writes++;
    return result;
  };
  assert.throws(() => save(candidate, candidate), UserInputError);
  assert.equal(writes, 0);
  assert.equal(original.viewpoints.length, 8);
  assert.equal(save(original, null), original);
  assert.equal(save(candidate, null), candidate);
});

test("未知异常和解析错误不会将文件路径、内部协议或文件片段带入提示", () => {
  const secret = "/private/example/hidden.json";
  for (const error of [new Error(`Error invoking remote method 'p15:open': ${secret}`), secret]) {
    const message = fileErrorMessage(error, "open");
    assert.doesNotMatch(message, /p15:|private|hidden/);
  }
  try { parseProject(`{"secret": "${secret}", broken}`); assert.fail("must reject"); }
  catch (error) {
    assert.ok(error instanceof UserInputError);
    assert.doesNotMatch(fileErrorMessage(error, "open"), /private|hidden|broken|SyntaxError/);
  }
  assert.match(fileErrorMessage(new Error("AERO_FILE_NO_SPACE"), "save"), /空间/);
  assert.match(fileErrorMessage(new Error("AERO_FILE_PERMISSION"), "save"), /权限/);
});

test("暂存失败明确返回失败状态，重试成功后恢复正常", () => {
  const project = exampleProject();
  let unavailable = true;
  let stored = "";
  const storage = { setItem: (_key: string, value: string) => {
    if (unavailable) throw new Error("QuotaExceededError");
    stored = value;
  } };
  assert.equal(persistProject(storage, "test", project), "error");
  assert.equal(stored, "");
  unavailable = false;
  assert.equal(persistProject(storage, "test", project), "saved");
  assert.deepEqual(parseProject(stored), project);
});

test("项目校验细节隐藏，方案导入保留与无人机匹配有关的可操作原因", () => {
  try { parseProject('{"version":1,"models":[]}'); assert.fail("must reject"); }
  catch (error) {
    assert.ok(error instanceof ProjectValidationError);
    assert.doesNotMatch(fileErrorMessage(error, "open"), /对象数量|列表格式|标识/);
  }
  const project = exampleProject();
  try {
    importPlan(JSON.stringify({version: 1, viewpoints: [{...project.viewpoints[0], droneId: "missing"}]}), project);
    assert.fail("must reject");
  } catch (error) {
    assert.match(fileErrorMessage(error, "import"), /当前场景不匹配/);
    assert.doesNotMatch(fileErrorMessage(error, "import"), /droneId|missing|引用/);
  }
});

test("浏览器项目解析也按 UTF-8 字节而非字符限制文件大小", () => {
  const text = JSON.stringify({ note: "楼".repeat(1_700_000) });
  assert.ok(text.length < 5_000_000);
  assert.throws(() => parseProject(text), /5 MB/);
});
