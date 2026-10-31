import type { Settings } from "../shared.ts";
import { sqlite } from "./index.ts";

const SETTINGS_KEY = "global";

export const DEFAULT_SETTINGS: Settings = {
  ai: { enabled: false, type: "TONGYI", url: "", model: "", apiKey: "" },
  questionBank: { enabled: false, url: "", key: "" },
  tickSeconds: 5,
  maxAccountsConcurrency: 3,
};

export function getSettings(): Settings {
  const row = sqlite
    .prepare(`SELECT value_json FROM settings WHERE key = ?`)
    .get(SETTINGS_KEY) as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  const parsed = JSON.parse(row.value_json) as Partial<Settings>;
  return {
    ai: { ...DEFAULT_SETTINGS.ai, ...parsed.ai },
    questionBank: { ...DEFAULT_SETTINGS.questionBank, ...parsed.questionBank },
    tickSeconds: parsed.tickSeconds ?? DEFAULT_SETTINGS.tickSeconds,
    maxAccountsConcurrency: parsed.maxAccountsConcurrency ?? DEFAULT_SETTINGS.maxAccountsConcurrency,
  };
}

export function saveSettings(settings: Settings): void {
  sqlite
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(SETTINGS_KEY, JSON.stringify(settings));
}
