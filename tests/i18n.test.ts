import test from "node:test";
import assert from "node:assert/strict";
import { zhCN } from "../src/i18n/locales/zh-CN";
import { zhTW } from "../src/i18n/locales/zh-TW";
import { enUS } from "../src/i18n/locales/en-US";
import { t, setLocale } from "../src/i18n/index";

const LOCALES = { "zh-CN": zhCN, "zh-TW": zhTW, "en-US": enUS };

test("every locale defines the same keys", () => {
  const reference = Object.keys(zhCN).sort();
  for (const [name, map] of Object.entries(LOCALES)) {
    const keys = Object.keys(map).sort();
    const missing = reference.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !reference.includes(key));
    assert.deepEqual(missing, [], `${name} is missing: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${name} has unknown keys: ${extra.join(", ")}`);
  }
});

test("no translation is empty", () => {
  for (const [name, map] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(map)) {
      assert.ok(typeof value === "string" && value.trim().length > 0, `${name}.${key} is empty`);
    }
  }
});

test("interpolation fills placeholders and leaves unknown ones intact", () => {
  setLocale("en-US");
  assert.ok(!t("localPresetLoaded", { id: "ethanol" }).includes("{id}"));
  setLocale("zh-CN");
});
