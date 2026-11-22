/**
 * Single source for settings field names, enum values and defaults.
 *
 * The same JSON is read by `vite.config.ts` (build-time injection) and
 * `desktop/bridge_server.py` (desktop persistence), so adding a UI setting
 * only requires editing `shared/settings.defaults.json` plus the TypeScript
 * type. `tests/settings-schema.test.ts` fails if the type-side constants drift
 * from the JSON.
 */
import schema from "../../../shared/settings.defaults.json";

export interface SettingsSchema {
  version: number;
  groups: string[];
  endpoint: {
    stringFields: string[];
    maxRetries: { default: number; min: number; max: number };
  };
  ui: {
    defaults: Record<string, string>;
    values: Record<string, string[]>;
  };
}

export const SETTINGS_SCHEMA = schema as SettingsSchema;
export const SETTINGS_GROUPS = SETTINGS_SCHEMA.groups;
export const ENDPOINT_STRING_FIELDS = SETTINGS_SCHEMA.endpoint.stringFields;
export const MAX_RETRIES = SETTINGS_SCHEMA.endpoint.maxRetries;
export const UI_DEFAULTS = SETTINGS_SCHEMA.ui.defaults;
export const UI_VALUES = SETTINGS_SCHEMA.ui.values;
