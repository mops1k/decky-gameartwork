import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMock = vi.fn();
vi.mock('@decky/api', () => ({
  call: (...args: any[]) => callMock(...args),
}));

vi.mock('./steamAssets', () => ({
  searchSteamApps: vi.fn(async () => [{ appid: 1, name: 'Celeste' }]),
  getSteamAppAssets: vi.fn(async () => ({
    appid: 1,
    name: 'Celeste',
    assets: { grid_p: { url: 'https://cdn.example/celeste.png', width: 600, height: 900 } },
  })),
}));

const localStorageMock = (() => {
  let store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store = new Map(); },
    get length() { return store.size; },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
})();

(globalThis as any).window = { localStorage: localStorageMock };
const setOnline = (online: boolean) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: online },
    configurable: true,
    writable: true,
  });
};
setOnline(true);

// The fake store answers with the requested title, like a real exact match.
const epicGamesFor = (term: string) => [{
  id: '1',
  name: term,
  images: { grid_p: { url: `https://cdn.example/${encodeURIComponent(term)}.png`, width: 1200, height: 1600 } },
}];

let enabled: Record<string, boolean>;

const loadModule = async () => {
  vi.resetModules();
  return await import('./providers');
};

describe('providers cross-search', () => {
  beforeEach(() => {
    localStorageMock.clear();
    enabled = { steam: true, epic: true, gog: true, igdb: true, vndb: true };
    callMock.mockReset();
    callMock.mockImplementation(async (method: string, arg?: any) => {
      if (method === 'get_setting') return enabled;
      if (method === 'log_debug') return undefined;
      // A source returns one game only for Epic, the rest answer empty.
      if (method === 'epic_search_games') return epicGamesFor(String(arg));
      return [];
    });
  });

  it('asks only the enabled sources', async () => {
    enabled = { steam: false, epic: true, gog: false, igdb: false, vndb: false };
    const { searchExternalSources } = await loadModule();
    const assets = await searchExternalSources('celeste');
    expect(assets.map((asset) => asset.source)).toEqual(['epic']);
    const methods = callMock.mock.calls.map(([method]) => method);
    expect(methods).toContain('epic_search_games');
    expect(methods).not.toContain('vndb_search_games');
  });

  it('drops the cached tiles when the switches change', async () => {
    const providers = await loadModule();
    await providers.searchExternalSources('celeste');
    const firstEpicCalls = callMock.mock.calls.filter(([method]) => method === 'epic_search_games').length;

    // Cached: a second run costs no source request.
    await providers.searchExternalSources('celeste');
    expect(callMock.mock.calls.filter(([method]) => method === 'epic_search_games').length).toBe(firstEpicCalls);

    // After the settings toggle the cache must not answer any more.
    providers.invalidateEnabledSources();
    await providers.searchExternalSources('celeste');
    expect(callMock.mock.calls.filter(([method]) => method === 'epic_search_games').length)
      .toBeGreaterThan(firstEpicCalls);
  });

  it('does not cache an empty answer', async () => {
    callMock.mockImplementation(async (method: string) => {
      if (method === 'get_setting') return enabled;
      return [];
    });
    const providers = await loadModule();
    expect(await providers.searchExternalSources('nothing here')).toEqual([]);
    await providers.searchExternalSources('nothing here');
    const searches = callMock.mock.calls.filter(([method]) => method.endsWith('_search_games'));
    // Both runs hit the four remote sources: an empty answer is not a result
    // to keep (Steam goes through searchSteamApps, not through call()).
    expect(searches.length).toBe(8);
  });

  it('keeps the browser cache small', async () => {
    const providers = await loadModule();
    for (let index = 0; index < 40; index += 1) {
      await providers.searchExternalSources(`game ${index}`);
    }
    const index = JSON.parse(localStorageMock.getItem('gameartwork:external:index') || '[]');
    expect(index.length).toBeLessThanOrEqual(30);
    // The newest game survives, the oldest entries are gone.
    expect(localStorageMock.getItem('gameartwork:external:game 39')).toBeTruthy();
    expect(localStorageMock.getItem('gameartwork:external:game 0')).toBeNull();
  });

  it('serves the browser cache when the device is offline', async () => {
    const providers = await loadModule();
    await providers.searchExternalSources('celeste');
    // A fresh module has an empty in-memory cache: only localStorage is left.
    const offline = await loadModule();
    callMock.mockClear();
    setOnline(false);
    const assets = await offline.searchExternalSources('celeste');
    expect(assets.length).toBeGreaterThan(0);
    expect(callMock.mock.calls.filter(([method]) => method.endsWith('_search_games'))).toHaveLength(0);
    setOnline(true);
  });
});
