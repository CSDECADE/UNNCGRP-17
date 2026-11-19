import { test } from "node:test";
import assert from "node:assert/strict";
import { Color, Texture, Vector2 } from "three";
import { fitBackground } from "../src/scene/backgroundTexture.ts";

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

function mapped(texture: Texture, x: number, y: number) {
  return new Vector2(x, y).applyMatrix3(texture.matrix);
}

function assertCover(texture: Texture, image: Vector2, viewport: Vector2) {
  const start = mapped(texture, 0, 0), end = mapped(texture, 1, 1);
  const center = mapped(texture, 0.5, 0.5);
  close(center.x, 0.5);
  close(center.y, 0.5);
  assert.ok(start.x >= 0 && start.y >= 0 && end.x <= 1 && end.y <= 1);
  const visiblePixels = end.clone().sub(start).multiply(image);
  // A source-image pixel must have the same scale along both screen axes.
  close(visiblePixels.x / viewport.x, visiblePixels.y / viewport.y);
  assert.ok(Math.abs(end.x - start.x - 1) < 1e-10 || Math.abs(end.y - start.y - 1) < 1e-10);
}

test("横向背景居中裁去左右两边，图案保持比例并铺满画布", () => {
  const texture = new Texture({ width: 1600, height: 800 });
  fitBackground(texture, 1200, 1000);
  close(mapped(texture, 0, 0).x, 0.2);
  close(mapped(texture, 1, 1).x, 0.8);
  close(mapped(texture, 0, 0).y, 0);
  close(mapped(texture, 1, 1).y, 1);
  assertCover(texture, new Vector2(1600, 800), new Vector2(1200, 1000));
});

test("纵向背景居中裁去上下两边，图案保持比例并铺满画布", () => {
  const texture = new Texture({ width: 800, height: 1600 });
  fitBackground(texture, 1600, 900);
  close(mapped(texture, 0, 0).x, 0);
  close(mapped(texture, 1, 1).x, 1);
  close(mapped(texture, 0, 0).y, 23 / 64);
  close(mapped(texture, 1, 1).y, 41 / 64);
  assertCover(texture, new Vector2(800, 1600), new Vector2(1600, 900));
});

test("主窗口与16:9取景预览往返时独立裁切，并完整恢复主窗口比例", () => {
  const texture = new Texture({ width: 1600, height: 900 });
  const image = new Vector2(1600, 900), main = new Vector2(900, 1200), pip = new Vector2(240, 135);
  fitBackground(texture, main.x, main.y);
  const mainMatrix = texture.matrix.clone();
  assertCover(texture, image, main);
  for (let frame = 0; frame < 3; frame++) {
    fitBackground(texture, pip.x, pip.y);
    assertCover(texture, image, pip);
    assert.ok(mapped(texture, 0, 0).equals(new Vector2(0, 0)));
    assert.ok(mapped(texture, 1, 1).equals(new Vector2(1, 1)));
    fitBackground(texture, main.x, main.y);
    assert.deepEqual(texture.matrix.elements, mainMatrix.elements);
    assertCover(texture, image, main);
  }
  const resized = new Vector2(1500, 900);
  fitBackground(texture, resized.x, resized.y);
  assertCover(texture, image, resized);
  assert.notDeepEqual(texture.matrix.elements, mainMatrix.elements);
});

test("纯色和空背景不被图片裁切流程修改", () => {
  const color = new Color("#1e2f3a"), before = color.clone();
  fitBackground(color, 1200, 900);
  fitBackground(color, 240, 135);
  assert.ok(color.equals(before));
  assert.doesNotThrow(() => fitBackground(null, 1200, 900));
});

test("窗口尺寸暂为零或图片未加载时保留现有裁切状态", () => {
  const texture = new Texture({ width: 1600, height: 900 });
  fitBackground(texture, 900, 1200);
  const before = texture.matrix.clone();
  fitBackground(texture, 0, 1200);
  fitBackground(texture, 900, 0);
  assert.deepEqual(texture.matrix.elements, before.elements);
  const unloaded = new Texture(), initial = unloaded.matrix.clone();
  assert.doesNotThrow(() => fitBackground(unloaded, 900, 1200));
  assert.deepEqual(unloaded.matrix.elements, initial.elements);
});
