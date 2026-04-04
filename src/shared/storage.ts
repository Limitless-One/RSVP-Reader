import { DEFAULT_SETTINGS, STORAGE_SCHEMA_VERSION } from './constants';
import { idbDelete, idbGet, idbSet } from './idb';
import { DEFAULT_ENABLED_SITE_HOSTS, SUPPORTED_SITES } from './sites';
import type {
  Bookmark,
  ExportBundle,
  PersonalizationEvent,
  PersonalizationModel,
  Settings,
} from './types';

function normalizeSiteSettings(settings: Settings): Settings {
  const normalizeSite = (site: string) => site === 'ranibes' ? 'ranobes' : site;
  const normalizeSiteHost = (siteHost: string) => siteHost.replace(/^ranibes\./, 'ranobes.');
  const knownHosts = new Set(DEFAULT_ENABLED_SITE_HOSTS);

  const enabledSites = [...new Set(settings.enabledSites.map(normalizeSite))]
    .filter(siteId => SUPPORTED_SITES.some(site => site.id === siteId)) as Settings['enabledSites'];
  const enabledSiteHosts = [...new Set((settings.enabledSiteHosts ?? DEFAULT_ENABLED_SITE_HOSTS).map(normalizeSiteHost))]
    .filter(siteHost => knownHosts.has(siteHost));
  const sitesWithEnabledHosts = new Set(
    SUPPORTED_SITES
      .filter(site => site.id === 'generic' || site.variants.some(variant => enabledSiteHosts.includes(variant.id)))
      .map(site => site.id),
  );
  const normalizedEnabledSites = enabledSites
    .filter(siteId => siteId === 'generic' || sitesWithEnabledHosts.has(siteId)) as Settings['enabledSites'];
  const favoriteSites = [...new Set(settings.favoriteSites.map(normalizeSite))]
    .filter(siteId => normalizedEnabledSites.includes(siteId as Settings['favoriteSites'][number])) as Settings['favoriteSites'];

  return {
    ...settings,
    enabledSites: normalizedEnabledSites,
    enabledSiteHosts,
    favoriteSites,
  };
}

// ─── Keys ────────────────────────────────────────────────────────────────────

const SETTINGS_SYNC_KEY = 'rsvp_settings_sync';
const SETTINGS_LOCAL_KEY = 'rsvp_settings_local';
const BOOKMARK_PREFIX = 'bm_';
const STORAGE_META_KEY = 'rsvp_storage_meta';
const PERSONALIZATION_EVENTS_KEY = 'rsvp_personalization_events';
const PERSONALIZATION_MODEL_KEY = 'rsvp_personalization_model';

interface StorageMeta {
  version: number;
}

const LOCAL_ONLY_SETTINGS: Array<keyof Settings> = [
  'backgroundImage',
];

function splitSettings(settings: Settings): { sync: Partial<Settings>; local: Partial<Settings> } {
  const sync: Partial<Settings> = { ...settings };
  const local = {} as Partial<Settings>;
  for (const key of LOCAL_ONLY_SETTINGS) {
    Object.assign(local, { [key]: settings[key] });
    delete sync[key];
  }
  return { sync, local };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  await migrateStorage();
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_SYNC_KEY),
    chrome.storage.local.get(SETTINGS_LOCAL_KEY),
  ]);
  const storedSync = syncResult[SETTINGS_SYNC_KEY] as Partial<Settings> | undefined;
  const storedLocal = localResult[SETTINGS_LOCAL_KEY] as Partial<Settings> | undefined;
  const stored = { ...storedSync, ...storedLocal };
  // Deep-merge so new default keys are always present after extension updates
  return normalizeSiteSettings({
    ...DEFAULT_SETTINGS,
    ...stored,
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(stored?.shortcuts ?? {}),
    },
    punctuationPauses: {
      ...DEFAULT_SETTINGS.punctuationPauses,
      ...(stored?.punctuationPauses ?? {}),
    },
  });
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const merged: Settings = {
    ...current,
    ...patch,
    shortcuts: {
      ...current.shortcuts,
      ...(patch.shortcuts ?? {}),
    },
    punctuationPauses: {
      ...current.punctuationPauses,
      ...(patch.punctuationPauses ?? {}),
    },
  };
  const { sync, local } = splitSettings(normalizeSiteSettings(merged));
  await Promise.all([
    chrome.storage.sync.set({ [SETTINGS_SYNC_KEY]: sync }),
    chrome.storage.local.set({ [SETTINGS_LOCAL_KEY]: local }),
  ]);
}

export async function resetSettings(): Promise<void> {
  const { sync, local } = splitSettings(normalizeSiteSettings(DEFAULT_SETTINGS));
  await Promise.all([
    chrome.storage.sync.set({ [SETTINGS_SYNC_KEY]: sync }),
    chrome.storage.local.set({ [SETTINGS_LOCAL_KEY]: local }),
  ]);
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

function bookmarkKey(url: string): string {
  // Normalize: strip query params and hash so #comments don't create duplicates
  try {
    const u = new URL(url);
    return BOOKMARK_PREFIX + u.hostname + u.pathname;
  } catch {
    return BOOKMARK_PREFIX + url.slice(0, 200);
  }
}

export async function getBookmark(url: string): Promise<Bookmark | null> {
  const key = bookmarkKey(url);
  const result = await chrome.storage.local.get(key);
  return (result[key] as Bookmark | undefined) ?? null;
}

export async function saveBookmark(bookmark: Bookmark): Promise<void> {
  const key = bookmarkKey(bookmark.url);
  await chrome.storage.local.set({ [key]: bookmark });
}

export async function deleteBookmark(url: string): Promise<void> {
  const key = bookmarkKey(url);
  await chrome.storage.local.remove(key);
}

export async function getAllBookmarks(): Promise<Bookmark[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(BOOKMARK_PREFIX))
    .map(([, v]) => v as Bookmark)
    .sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Personalization ─────────────────────────────────────────────────────────

export async function getPersonalizationEvents(): Promise<PersonalizationEvent[]> {
  return (await idbGet<PersonalizationEvent[]>(PERSONALIZATION_EVENTS_KEY)) ?? [];
}

export async function savePersonalizationEvents(events: PersonalizationEvent[]): Promise<void> {
  await idbSet(PERSONALIZATION_EVENTS_KEY, events);
}

export async function getPersonalizationModel(): Promise<PersonalizationModel | null> {
  return await idbGet<PersonalizationModel>(PERSONALIZATION_MODEL_KEY);
}

export async function savePersonalizationModel(model: PersonalizationModel | null): Promise<void> {
  if (model) {
    await idbSet(PERSONALIZATION_MODEL_KEY, model);
    return;
  }
  await idbDelete(PERSONALIZATION_MODEL_KEY);
}

export async function resetPersonalization(): Promise<void> {
  await Promise.all([
    idbDelete(PERSONALIZATION_EVENTS_KEY),
    idbDelete(PERSONALIZATION_MODEL_KEY),
  ]);
}

// ─── Import / export ─────────────────────────────────────────────────────────

export async function exportBundle(): Promise<ExportBundle> {
  const [settings, bookmarks, events, model] = await Promise.all([
    getSettings(),
    getAllBookmarks(),
    getPersonalizationEvents(),
    getPersonalizationModel(),
  ]);
  return {
    version: 1,
    settings,
    bookmarks,
    personalization: { events, model },
  };
}

export async function importBundle(bundle: ExportBundle): Promise<void> {
  await saveSettings(bundle.settings);
  const existing = await chrome.storage.local.get(null);
  const bookmarkKeys = Object.keys(existing).filter(key => key.startsWith(BOOKMARK_PREFIX));
  await Promise.all([
    chrome.storage.local.remove(bookmarkKeys),
    savePersonalizationEvents(bundle.personalization.events),
    savePersonalizationModel(bundle.personalization.model),
  ]);
  await Promise.all(bundle.bookmarks.map(saveBookmark));
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrateStorage(): Promise<void> {
  const metaResult = await chrome.storage.local.get(STORAGE_META_KEY);
  const meta = metaResult[STORAGE_META_KEY] as StorageMeta | undefined;
  if (meta?.version === STORAGE_SCHEMA_VERSION) return;

  const legacySync = await chrome.storage.sync.get('rsvp_settings');
  const legacySettings = legacySync['rsvp_settings'] as Partial<Settings> | undefined;

  if (legacySettings) {
    const merged = normalizeSiteSettings({
      ...DEFAULT_SETTINGS,
      ...legacySettings,
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...(legacySettings.shortcuts ?? {}),
      },
      personalizationConsentGiven:
        legacySettings.personalizationConsentGiven ??
        (legacySettings as Partial<Record<'personalizationDataCollected', boolean>>).personalizationDataCollected ??
        DEFAULT_SETTINGS.personalizationConsentGiven,
    } satisfies Settings);
    const { sync, local } = splitSettings(merged);
    await Promise.all([
      chrome.storage.sync.set({ [SETTINGS_SYNC_KEY]: sync }),
      chrome.storage.local.set({ [SETTINGS_LOCAL_KEY]: local }),
      chrome.storage.sync.remove('rsvp_settings'),
    ]);
  }

  const allLocal = await chrome.storage.local.get(null);
  const bookmarkEntries = Object.entries(allLocal).filter(([key]) => key.startsWith(BOOKMARK_PREFIX));
  await Promise.all(
    bookmarkEntries.map(async ([key, value]) => {
      const bookmark = value as Partial<Bookmark>;
      if (bookmark.version === 2) return;
      await chrome.storage.local.set({
        [key]: {
          version: 2,
          url: bookmark.url ?? key.slice(BOOKMARK_PREFIX.length),
          chunkIndex: bookmark.chunkIndex ?? 0,
          wordIndex: bookmark.wordIndex ?? 0,
          totalChunks: bookmark.totalChunks ?? 0,
          totalWords: bookmark.totalWords ?? 0,
          chapterTitle: bookmark.chapterTitle ?? 'Untitled chapter',
          site: bookmark.site ?? 'unknown',
          timestamp: bookmark.timestamp ?? Date.now(),
        } satisfies Bookmark,
      });
    }),
  );

  await chrome.storage.local.set({
    [STORAGE_META_KEY]: { version: STORAGE_SCHEMA_VERSION } satisfies StorageMeta,
  });
}
