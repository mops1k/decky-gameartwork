import { call } from '@decky/api';

import { getSteamAppAssets, searchSteamApps } from './steamAssets';
import { pickBestMatch } from './matchGame';
import log from './log';

export type ExternalSource = 'steam' | 'epic' | 'gog' | 'igdb' | 'vndb';

/** Every built-in source, in the order their results are shown. */
export const ALL_SOURCES: ExternalSource[] = ['steam', 'epic', 'gog', 'igdb', 'vndb'];

export const SOURCE_NAMES: Record<ExternalSource, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  igdb: 'IGDB',
  vndb: 'VNDB',
};

export type SourceState = 'pending' | 'done' | 'error';
export type ExternalSourcesState = Partial<Record<ExternalSource, SourceState>>;

type ProviderImage = { url: string; width: number; height: number };

/** Additional artwork of one type (IGDB ships several screenshots and key arts). */
type ProviderExtra = { kind: SGDBAssetType; url: string; width?: number; height?: number };

type ProviderGame = {
  id: string;
  name: string;
  images: Partial<Record<SGDBAssetType, ProviderImage>>;
  extras?: ProviderExtra[];
};

export type ExternalAsset = {
  id: string;
  source: ExternalSource;
  sourceName: string;
  name: string;
  kind: SGDBAssetType;
  url: string;
  thumb: string;
  width: number;
  height: number;
};

const FALLBACK_SIZE: Record<string, [number, number]> = {
  grid_p: [600, 900],
  grid_l: [920, 430],
  hero: [1920, 620],
  icon: [32, 32],
  logo: [0, 0],
};

const toAssets = (game: ProviderGame, source: ExternalSource): ExternalAsset[] => {
  const primary = Object.entries(game.images)
    .filter(([, image]) => Boolean(image?.url))
    .map(([kind, image]) => {
      const typed = image as ProviderImage;
      const [fallbackWidth, fallbackHeight] = FALLBACK_SIZE[kind] || [600, 900];
      return {
        id: `${source}:${game.id}:${kind}`,
        source,
        sourceName: SOURCE_NAMES[source],
        name: game.name,
        kind: kind as SGDBAssetType,
        url: typed.url,
        thumb: typed.url,
        width: typed.width || fallbackWidth,
        height: typed.height || fallbackHeight,
      };
    });
  const extras = (game.extras || [])
    .filter((extra) => Boolean(extra?.url))
    .map((extra, index) => ({
      id: `${source}:${game.id}:${extra.kind}:extra${index}`,
      source,
      sourceName: SOURCE_NAMES[source],
      name: game.name,
      kind: extra.kind,
      url: extra.url,
      thumb: extra.url,
      width: extra.width || 1920,
      height: extra.height || 1080,
    }));
  return [...primary, ...extras];
};

const searchSteam = async (term: string): Promise<ExternalAsset[]> => {
  const apps = await searchSteamApps(term);
  const best = pickBestMatch(term, apps);
  if (!best) return [];
  const app: any = await getSteamAppAssets(best.appid);
  if (!app?.assets) return [];
  const images: ProviderGame['images'] = {};
  for (const [kind, image] of Object.entries(app.assets)) {
    const value = image as ProviderImage;
    if (value?.url) images[kind as SGDBAssetType] = value;
  }
  return toAssets({ id: String(best.appid), name: app.name || best.name, images }, 'steam');
};

const makeRemoteSearcher = (method: string, source: ExternalSource) => async (term: string): Promise<ExternalAsset[]> => {
  const games = await call<[string], ProviderGame[]>(method, term);
  const best = pickBestMatch(term, games as any);
  return best ? toAssets(best, source) : [];
};

const SEARCHERS: Record<ExternalSource, (term: string) => Promise<ExternalAsset[]>> = {
  steam: searchSteam,
  epic: makeRemoteSearcher('epic_search_games', 'epic'),
  gog: makeRemoteSearcher('gog_search_games', 'gog'),
  igdb: makeRemoteSearcher('igdb_search_games', 'igdb'),
  vndb: makeRemoteSearcher('vndb_search_games', 'vndb'),
};

const SOURCES_SETTING = 'sources_enabled';
const SOURCES_CACHE_TTL = 3000;
const RESULT_CACHE_TTL = 10 * 60 * 1000;

type EnabledSources = Record<ExternalSource, boolean>;

let enabledSourcesCache: { at: number; value: EnabledSources } | null = null;

/** Per-source switches from the Quick Access settings (all on by default). */
export const getEnabledSources = async (): Promise<EnabledSources> => {
  if (enabledSourcesCache && Date.now() - enabledSourcesCache.at < SOURCES_CACHE_TTL) {
    return enabledSourcesCache.value;
  }
  let stored: any = null;
  try {
    stored = await call<[string, any], any>('get_setting', SOURCES_SETTING, null);
  } catch (err) {
    log('read sources_enabled failed', err);
  }
  const value = {} as EnabledSources;
  for (const source of ALL_SOURCES) {
    value[source] = typeof stored?.[source] === 'boolean' ? stored[source] : true;
  }
  enabledSourcesCache = { at: Date.now(), value };
  return value;
};

/** Called after the settings toggle so the next search re-reads the switches. */
export const invalidateEnabledSources = () => {
  enabledSourcesCache = null;
  // The cross-search cache holds the tiles of the previous switch set: without
  // dropping it a just-disabled source keeps feeding the grid for up to ten
  // minutes.
  resultCache.clear();
  titleCache.clear();
};

export type ExternalSearchProgress = {
  assets: ExternalAsset[];
  sources: ExternalSourcesState;
  enabled: ExternalSource[];
};

const resultCache = new Map<string, { at: number; assets: ExternalAsset[]; enabled: ExternalSource[] }>();
const titleCache = new Map<string, ExternalTitle[]>();

export type ExternalTitle = { source: ExternalSource; name: string };

/** Titles only (no artwork) for the game picker. */
export const searchExternalTitles = async (term: string): Promise<ExternalTitle[]> => {
  const query = (term || '').trim();
  if (!query) return [];
  const cacheKey = query.toLowerCase();
  const cached = titleCache.get(cacheKey);
  if (cached) return cached;

  const enabled = await getEnabledSources();
  const [steam, epic, gog, igdb, vndb] = await Promise.all([
    enabled.steam ? searchSteamApps(query).catch(() => []) : [],
    enabled.epic ? call<[string], ProviderGame[]>('epic_search_games', query).catch(() => []) : [],
    enabled.gog ? call<[string], ProviderGame[]>('gog_search_games', query).catch(() => []) : [],
    enabled.igdb ? call<[string], ProviderGame[]>('igdb_search_games', query).catch(() => []) : [],
    enabled.vndb ? call<[string], ProviderGame[]>('vndb_search_games', query).catch(() => []) : [],
  ]);

  const titles: ExternalTitle[] = [
    ...(steam as any[]).map((app) => ({ source: 'steam' as ExternalSource, name: app.name })),
    ...(epic as ProviderGame[]).map((app) => ({ source: 'epic' as ExternalSource, name: app.name })),
    ...(gog as ProviderGame[]).map((app) => ({ source: 'gog' as ExternalSource, name: app.name })),
    ...(igdb as ProviderGame[]).map((app) => ({ source: 'igdb' as ExternalSource, name: app.name })),
    ...(vndb as ProviderGame[]).map((app) => ({ source: 'vndb' as ExternalSource, name: app.name })),
  ];
  if (titleCache.size > 100) titleCache.clear();
  titleCache.set(cacheKey, titles);
  return titles;
};

/**
 * Cross-search the enabled sources. Each source publishes its tiles the moment
 * it answers, so a slow store (GOG parses a full catalog response) does not
 * hold back the fast ones.
 */
const inFlight = new Map<string, Promise<ExternalAsset[]>>();

const LOCAL_CACHE_PREFIX = 'gameartwork:external:';
const LOCAL_CACHE_INDEX = 'gameartwork:external:index';
const LOCAL_CACHE_TTL = 24 * 60 * 60 * 1000;
// localStorage is ~5 MB for the whole client: keep the newest games only.
const LOCAL_CACHE_MAX = 30;

/** Drop the oldest entries so the cache cannot fill the client storage. */
const pruneLocalCache = (keepKey: string) => {
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_INDEX);
    const parsed = raw ? JSON.parse(raw) : [];
    const keys: string[] = Array.isArray(parsed) ? parsed.filter((key: unknown) => typeof key === 'string') : [];
    const ordered = keys.filter((key: string) => key !== keepKey);
    ordered.push(keepKey);
    for (const key of ordered.slice(0, Math.max(0, ordered.length - LOCAL_CACHE_MAX))) {
      window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(LOCAL_CACHE_INDEX, JSON.stringify(ordered.slice(-LOCAL_CACHE_MAX)));
  } catch {
    // Storage may be full or unavailable: the in-memory cache is enough.
  }
};

/** Results survive a Decky restart and a lost connection in localStorage. */
const readLocalCache = (key: string): ExternalAsset[] | null => {
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.assets)) return null;
    if (Date.now() - Number(parsed.at || 0) > LOCAL_CACHE_TTL) return null;
    return parsed.assets as ExternalAsset[];
  } catch {
    return null;
  }
};

const writeLocalCache = (key: string, assets: ExternalAsset[]) => {
  try {
    if (!assets.length) return;
    const storageKey = LOCAL_CACHE_PREFIX + key;
    window.localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), assets }));
    pruneLocalCache(storageKey);
  } catch {
    // localStorage may be unavailable or full: the in-memory cache still works
  }
};

/** One URL must not fill the grid twice (ay same image under two types). */
const dedupeByUrl = (assets: ExternalAsset[]): ExternalAsset[] => {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const url = asset.url.split('?')[0];
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
};

const sourcesFromAssets = (assets: ExternalAsset[]): ExternalSourcesState => {
  const sources: ExternalSourcesState = {};
  assets.forEach((asset) => { sources[asset.source] = 'done'; });
  return sources;
};

export const searchExternalSources = async (
  term: string,
  onProgress?: (progress: ExternalSearchProgress) => void
): Promise<ExternalAsset[]> => {
  const query = (term || '').trim();
  if (!query) return [];
  const cacheKey = query.toLowerCase();

  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL) {
    const sources: ExternalSourcesState = {};
    cached.enabled.forEach((source) => { sources[source] = 'done'; });
    onProgress?.({ assets: cached.assets, sources, enabled: cached.enabled });
    return cached.assets;
  }

  // No connection at all: serve the last known answer instead of nothing.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const local = readLocalCache(cacheKey);
    if (local) {
      const sources = sourcesFromAssets(local);
      onProgress?.({ assets: local, sources, enabled: ALL_SOURCES });
      return local;
    }
  }

  // Several asset tabs ask for the same game at once: share one request.
  const pending = inFlight.get(cacheKey);
  if (pending) {
    const assets = await pending.catch(() => [] as ExternalAsset[]);
    const enabledSwitches = await getEnabledSources();
    const sources: ExternalSourcesState = {};
    ALL_SOURCES.filter((source) => enabledSwitches[source]).forEach((source) => { sources[source] = 'done'; });
    onProgress?.({ assets, sources, enabled: ALL_SOURCES.filter((source) => enabledSwitches[source]) });
    return assets;
  }

  const run = async (): Promise<ExternalAsset[]> => {
    const enabledSwitches = await getEnabledSources();
    const enabled = ALL_SOURCES.filter((source) => enabledSwitches[source]);
    if (!enabled.length) return [];

    const collected: ExternalAsset[] = [];
    const sources: ExternalSourcesState = {};
    enabled.forEach((source) => { sources[source] = 'pending'; });
    onProgress?.({ assets: [], sources: { ...sources }, enabled });

    await Promise.all(enabled.map(async (source) => {
      try {
        const result = await SEARCHERS[source](query);
        collected.push(...result);
        sources[source] = 'done';
      } catch (err) {
        // One dead source must not hide the others.
        log(`source ${source} search failed`, err);
        sources[source] = 'error';
      }
      onProgress?.({ assets: dedupeByUrl([...collected]), sources: { ...sources }, enabled });
    }));

    const ordered = dedupeByUrl(ALL_SOURCES.flatMap((source) => collected.filter((asset) => asset.source === source)));
    if (!ordered.length) {
      // Every source failed or answered empty (offline captive portal, API
      // outage): fall back to the last successful cross-search.
      const local = readLocalCache(cacheKey);
      if (local) {
        const localSources = sourcesFromAssets(local);
        onProgress?.({ assets: local, sources: localSources, enabled });
        return local;
      }
    }
    if (ordered.length) {
      // An empty answer is not a result: caching it would keep the grid empty
      // for ten minutes after a single network blip.
      if (resultCache.size > 100) resultCache.clear();
      resultCache.set(cacheKey, { at: Date.now(), assets: ordered, enabled });
      writeLocalCache(cacheKey, ordered);
    }
    call('log_debug', `cross-search "${query}": ${ordered.length} asset(s) from ${[...new Set(ordered.map((a) => a.source))].join(', ') || 'none'}`).catch(() => undefined);
    return ordered;
  };

  const task = run();
  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
};

/**
 * Every asset one store has for a game: the batch apply source.
 * Uses the same result cache, so opening the details modal costs nothing.
 */
export const getSourceBundle = async (
  term: string,
  source: ExternalSource,
  name: string,
  /** The SteamGridDB title: the cross-search may have used it instead. */
  fallbackTerm?: string
): Promise<ExternalAsset[]> => {
  const collect = (assets: ExternalAsset[]) => assets.filter(
    (asset) => asset.source === source && asset.name === name
  );
  const found = collect(await searchExternalSources(term));
  if (found.length || !fallbackTerm) return found;
  const alternate = fallbackTerm.trim();
  if (!alternate || alternate.toLowerCase() === (term || '').trim().toLowerCase()) return found;
  return collect(await searchExternalSources(alternate));
};
