import test from "node:test";
import assert from "node:assert/strict";
import { adapterFor, AndroidPlatform, DesktopPlatform, WebPlatform } from "../src/platform/PlatformAdapter";
import { detectPlatform } from "../src/platform/detect";

test("platform adapters expose their capabilities", () => {
  const web = adapterFor("web");
  const desktop = adapterFor("desktop");
  const android = adapterFor("android");

  assert.equal(web.kind, "web");
  assert.equal(web.capabilities.nativePersistence, false);
  assert.equal(web.capabilities.touchFirst, false);

  assert.ok(desktop instanceof DesktopPlatform);
  assert.equal(desktop.capabilities.nativeScreenshot, true);
  assert.equal(desktop.capabilities.imageInput, false);

  assert.ok(android instanceof AndroidPlatform);
  assert.equal(android.capabilities.nativePersistence, true);
  assert.equal(android.capabilities.imageInput, true);
  assert.equal(android.capabilities.touchFirst, true);

  assert.ok(web instanceof WebPlatform);
});

test("runtime injection selects the platform", () => {
  const globals = globalThis as Record<string, unknown>;
  const original = globals.__CHEMVIZ_PLATFORM__;
  try {
    globals.__CHEMVIZ_PLATFORM__ = "android";
    assert.equal(detectPlatform().kind, "android");
    globals.__CHEMVIZ_PLATFORM__ = "desktop";
    assert.equal(detectPlatform().kind, "desktop");
    globals.__CHEMVIZ_PLATFORM__ = "nonsense";
    assert.equal(detectPlatform().kind, "web");
  } finally {
    if (original === undefined) delete globals.__CHEMVIZ_PLATFORM__;
    else globals.__CHEMVIZ_PLATFORM__ = original;
  }
});

test("known bridge globals fall back to their platform", () => {
  const globals = globalThis as Record<string, unknown>;
  try {
    globals.ChemVizAndroid = {};
    assert.equal(detectPlatform().kind, "android");
    delete globals.ChemVizAndroid;

    globals.__CHEMVIZ_DESKTOP_BRIDGE__ = { version: 1, token: "t" };
    assert.equal(detectPlatform().kind, "desktop");
  } finally {
    delete globals.ChemVizAndroid;
    delete globals.__CHEMVIZ_DESKTOP_BRIDGE__;
  }
});
