import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RETRIES,
  SETTINGS_GROUPS,
  SETTINGS_SCHEMA,
  UI_DEFAULTS,
  UI_VALUES,
} from "../src/ai/settings/defaults";
import { DEFAULT_UI_SETTINGS, normalizeUISettings } from "../src/ai/config";

test("shared schema is the source of the UI defaults", () => {
  assert.deepEqual(DEFAULT_UI_SETTINGS, UI_DEFAULTS);
  assert.deepEqual(Object.keys(DEFAULT_UI_SETTINGS).sort(), Object.keys(UI_VALUES).sort());
});

test("every UI default is an allowed enum value", () => {
  for (const [key, value] of Object.entries(UI_DEFAULTS)) {
    assert.ok(UI_VALUES[key]?.includes(value), `${key}=${value} is not in ${UI_VALUES[key]}`);
  }
});

test("UI normalization accepts every allowed value", () => {
  for (const [key, values] of Object.entries(UI_VALUES)) {
    for (const value of values) {
      const normalized = normalizeUISettings({ [key]: value });
      assert.equal(normalized[key as keyof typeof normalized], value);
    }
  }
});

test("UI normalization rejects values outside the shared enum", () => {
  const normalized = normalizeUISettings({
    locale: "fr-FR",
    displayMode: "wireframe",
    labelDisplayMode: "sometimes",
    conformerSearchQuality: "ultra",
  });
  assert.deepEqual(normalized, DEFAULT_UI_SETTINGS);
});

test("endpoint groups and retry bounds come from the shared schema", () => {
  assert.deepEqual(SETTINGS_GROUPS, ["text", "image"]);
  assert.deepEqual(SETTINGS_SCHEMA.endpoint.stringFields, ["api", "model", "requestUrl", "systemPrompt"]);
  assert.ok(MAX_RETRIES.min <= MAX_RETRIES.default && MAX_RETRIES.default <= MAX_RETRIES.max);
});
