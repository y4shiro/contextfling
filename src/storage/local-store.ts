import {
  CONSENT_VERSION,
  type ConsentVersion,
  DEFAULT_SETTINGS,
  isConsentVersion,
  type Settings,
} from "../state/types.js";
import type { StorageAreaLike } from "./types.js";

export const SETTINGS_STORAGE_KEY = "contextfling.settings";

function sanitizeSettings(value: unknown): Settings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_SETTINGS;
  }
  const raw = value as Record<string, unknown>;
  return {
    consentVersion: isConsentVersion(raw.consentVersion)
      ? CONSENT_VERSION
      : null,
  };
}

/** storage.local には設定と consent version だけを保存する。 */
export class LocalSettingsStore {
  private readonly area: StorageAreaLike;

  public constructor(area: StorageAreaLike) {
    this.area = area;
  }

  public async get(): Promise<Settings> {
    const values = await this.area.get(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(values[SETTINGS_STORAGE_KEY]);
  }

  public async set(settings: Settings): Promise<void> {
    await this.area.set({ [SETTINGS_STORAGE_KEY]: sanitizeSettings(settings) });
  }

  public async setConsentVersion(
    consentVersion: ConsentVersion | null,
  ): Promise<Settings> {
    const settings = await this.get();
    const next: Settings = {
      ...settings,
      consentVersion:
        consentVersion === CONSENT_VERSION ? CONSENT_VERSION : null,
    };
    await this.set(next);
    return next;
  }

  public async clearConsent(): Promise<Settings> {
    return this.setConsentVersion(null);
  }
}

export function sanitizeStoredSettings(value: unknown): Settings {
  return sanitizeSettings(value);
}

export type SettingsStore = LocalSettingsStore;
