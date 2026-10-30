import { call } from '@decky/api';

import { getSteamAppAssets, searchSteamApps } from './steamAssets';
import { pickBestMatch } from './matchGame';
import log from './log';

export type ExternalSource = 'steam' | 'epic' | 'gog' | 'igdb' | 'vndb';

export const SOURCE_NAMES: Record<ExternalSource, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  igdb: 'IGDB',
  vndb: 'VNDB',
};

type ProviderImage = { url: string; width: number; height: number };

type ProviderGame = {
  id: string;
  name: string;
  images: Partial<Record<SGDBAssetType, ProviderImage>>;
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

const toAssets = (game: ProviderGame, source: ExternalSource): ExternalAsset[] =>
  Object.entries(game.images)
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

const searchEpic = async (term: string): Promise<ExternalAsset[]> => {
  const games = await call<[string], ProviderGame[]>('epic_search_games', term).catch((err) => {
    log('epic search failed', err);
    return [] as ProviderGame[];
  });
  const best = pickBestMatch(term, games as any);
  return best ? toAssets(best, 'epic') : [];
};

const searchIgdb = async (term: string): Promise<ExternalAsset[]> => {
  const games = await call<[string], ProviderGame[]>('igdb_search_games', term).catch((err) => {
    log('igdb search failed', err);
    return [] as ProviderGame[];
  });
  const best = pickBestMatch(term, games as any);
  return best ? toAssets(best, 'igdb') : [];
};

const searchGog = async (term: string): Promise<ExternalAsset[]> => {
  const games = await call<[string], ProviderGame[]>('gog_search_games', term).catch((err) => {
    log('gog search failed', err);
    return [] as ProviderGame[];
  });
  const best = pickBestMatch(term, games as any);
  return best ? toAssets(best, 'gog') : [];
};

const searchVndb = async (term: string): Promise<ExternalAsset[]> => {
  const games = await call<[string], ProviderGame[]>('vndb_search_games', term).catch((err) => {
    log('vndb search failed', err);
    return [] as ProviderGame[];
  });
  const best = pickBestMatch(term, games as any);
  return best ? toAssets(best, 'vndb') : [];
};

const cache = new Map<string, ExternalAsset[]>();
const titleCache = new Map<string, ExternalTitle[]>();

export type ExternalTitle = { source: ExternalSource; name: string };

/** Titles only (no artwork) for the game picker. */
export const searchExternalTitles = async (term: string): Promise<ExternalTitle[]> => {
  const query = (term || '').trim();
  if (!query) return [];
  const cacheKey = query.toLowerCase();
  const cached = titleCache.get(cacheKey);
  if (cached) return cached;

  const [steam, epic, gog, igdb, vndb] = await Promise.all([
    searchSteamApps(query).catch(() => []),
    call<[string], ProviderGame[]>('epic_search_games', query).catch(() => []),
    call<[string], ProviderGame[]>('gog_search_games', query).catch(() => []),
    call<[string], ProviderGame[]>('igdb_search_games', query).catch(() => []),
    call<[string], ProviderGame[]>('vndb_search_games', query).catch(() => []),
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
 * Cross-search every built-in source at once. No per-source settings:
 * the user just opens the plugin and sees artwork from all of them.
 */
export const searchExternalSources = async (term: string): Promise<ExternalAsset[]> => {
  const query = (term || '').trim();
  if (!query) return [];
  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const results = await Promise.allSettled([
    searchSteam(query),
    searchEpic(query),
    searchGog(query),
    searchIgdb(query),
    searchVndb(query),
  ]);
  const assets: ExternalAsset[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      assets.push(...result.value);
    } else {
      log('source search failed', result.reason);
    }
  }
  if (cache.size > 100) cache.clear();
  cache.set(cacheKey, assets);
  call('log_debug', `cross-search "${query}": ${assets.length} asset(s) from ${[...new Set(assets.map((a) => a.source))].join(', ') || 'none'}`).catch(() => undefined);
  return assets;
};
