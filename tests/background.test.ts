import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCENE_BACKGROUND, MAX_BACKGROUND_DATA_URL_LENGTH, MAX_BACKGROUND_EDGE, validateBackground } from "../src/core/background.ts";
import { emptyProject, exampleProject, importPlan, parseProject, validateProject } from "../src/core/project.ts";
import { ProjectValidationError } from "../src/core/feedback.ts";
import type { SceneBackground } from "../src/core/types.ts";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZF8AAAAASUVORK5CYII=";
const imageBackground = (): SceneBackground => ({
  mode: "image", color: "#A0b1c2", grid: false,
  image: { name: "校园.png", dataUrl: png, width: 1, height: 1 },
});
const invalid = (value: unknown) => assert.throws(() => validateBackground(value), ProjectValidationError);

test("旧v1项目保持兼容，不补入背景字段；默认场景保持原配色与网格", () => {
  assert.deepEqual(DEFAULT_SCENE_BACKGROUND, { mode: "color", color: "#1e1e1e", grid: true });
  for (const project of [emptyProject(), exampleProject()]) {
    const loaded = parseProject(JSON.stringify(project));
    assert.deepEqual(loaded, project);
    assert.equal(Object.hasOwn(loaded, "background"), false);
  }
});

test("颜色、图片与网格设置随项目保存重开，切为颜色可保留已导入图片", () => {
  for (const background of [DEFAULT_SCENE_BACKGROUND, imageBackground(), { ...imageBackground(), mode: "color" as const }]) {
    const project = { ...exampleProject(), background };
    const loaded = parseProject(JSON.stringify(project));
    assert.deepEqual(loaded, project);
    assert.notEqual(loaded.background, background);
    if (background.image) assert.notEqual(loaded.background?.image, background.image);
  }
});

test("应用算法方案保留项目背景，算法结果不能替换场景背景", () => {
  const project = { ...exampleProject(), background: imageBackground() };
  const before = JSON.stringify(project), viewpoints = structuredClone(project.viewpoints);
  viewpoints[0].position[1] = 33;
  const applied = importPlan(JSON.stringify({ version: 1, viewpoints, background: { mode: "remote" } }), project);
  assert.deepEqual(applied.background, project.background);
  assert.equal(applied.viewpoints[0].position[1], 33);
  assert.equal(applied.source, "导入的算法结果");
  assert.equal(JSON.stringify(project), before);
});

test("背景模式、六位颜色、网格开关和图片名称必须有效", () => {
  for (const value of [null, [], "#ffffff", {},
    { ...DEFAULT_SCENE_BACKGROUND, mode: "video" },
    { ...DEFAULT_SCENE_BACKGROUND, color: "red" },
    { ...DEFAULT_SCENE_BACKGROUND, color: "#fff" },
    { ...DEFAULT_SCENE_BACKGROUND, color: "#12345g" },
    { ...DEFAULT_SCENE_BACKGROUND, grid: 1 },
    { ...DEFAULT_SCENE_BACKGROUND, mode: "image" },
    { ...DEFAULT_SCENE_BACKGROUND, image: null },
  ]) invalid(value);
  for (const name of [null, "", "  ", "a".repeat(161)]) invalid({ ...imageBackground(), image: { ...imageBackground().image, name } });
  assert.throws(() => validateProject({ ...emptyProject(), background: null }), ProjectValidationError);
});

test("只允许内嵌PNG、JPEG、WebP，并核对声明格式与文件头", () => {
  // The validator inspects file signatures; decoding the complete image belongs
  // to the image-loading path. These short fixtures isolate format recognition.
  const header = (mime: string, bytes: number[]) => `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpegHeader = [0xff, 0xd8, 0xff, 0xe0];
  const webpHeader = [...Buffer.from("RIFF"), 0x04, 0, 0, 0, ...Buffer.from("WEBP")];
  for (const dataUrl of [header("png", pngHeader), header("jpeg", jpegHeader), header("webp", webpHeader)]) {
    assert.equal(validateBackground({ ...imageBackground(), image: { ...imageBackground().image, dataUrl } }).image?.dataUrl, dataUrl);
  }
  for (const dataUrl of [
    "https://example.com/image.png", "file:///tmp/image.png", "blob:https://example.com/image",
    "data:image/svg+xml;base64,PHN2Zy8+", "data:image/gif;base64,R0lGODlh", "data:text/plain;base64,aGVsbG8=",
    "data:image/png,%89PNG", header("jpg", jpegHeader),
    header("png", jpegHeader), header("jpeg", pngHeader), header("webp", pngHeader),
    header("png", [0x89, 0x50]), header("webp", [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")]),
  ]) invalid({ ...imageBackground(), image: { ...imageBackground().image, dataUrl } });
});

test("拒绝无效base64、异常尺寸和过长图片数据，包括颜色模式下保留的图片", () => {
  for (const payload of ["", "iVBORw0KGgo", "iVBORw0KGgo===", "iVBORw0KGgo!", "iVBO=w0KGgo=", "iVBORw0KGgp=", "iVBORw0KGgo=\n"])
    invalid({ ...imageBackground(), image: { ...imageBackground().image, dataUrl: `data:image/png;base64,${payload}` } });
  for (const edge of [0, -1, 1.5, NaN, Infinity, "100", MAX_BACKGROUND_EDGE + 1]) {
    for (const field of ["width", "height"])
      invalid({ ...imageBackground(), image: { ...imageBackground().image, [field]: edge } });
  }
  assert.equal(validateBackground({ ...imageBackground(), image: { ...imageBackground().image, width: MAX_BACKGROUND_EDGE, height: MAX_BACKGROUND_EDGE } }).image?.width, MAX_BACKGROUND_EDGE);
  const tooLarge = png + "A".repeat(MAX_BACKGROUND_DATA_URL_LENGTH - png.length + 1);
  for (const mode of ["color", "image"])
    invalid({ ...imageBackground(), mode, image: { ...imageBackground().image, dataUrl: tooLarge } });
});
