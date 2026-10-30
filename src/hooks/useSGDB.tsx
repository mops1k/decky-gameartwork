import {
  useState,
  createContext,
  FC,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { call, fetchNoCors, toaster } from '@decky/api';

import MenuIcon from '../components/Icons/MenuIcon';
import getAppOverview from '../utils/getAppOverview';
import log from '../utils/log';
import { ASSET_TYPE, MIMES, STYLES, DIMENSIONS } from '../constants';
import getAppDetails from '../utils/getAppDetails';
import showRestartConfirm from '../utils/showRestartConfirm';
import getCurrentSteamUserId from '../utils/getCurrentSteamUserId';
import getCustomLogoPosition from '../utils/getCustomLogoPosition';

/*
  special key only for use with this decky plugin
  attempting to use this in your own projects will
  cause you to be automatically banned and blacklisted
*/
export const SGDB_API_KEY = '6465636b796c6f616465723432303639';

// Direct SGDB API accepts only personal keys. The plugin key works through the
// mirror, which also makes the API reachable from regions where the domain is
// blocked. A personal key from the plugin settings takes priority.
export const SGDB_API_DIRECT = 'https://www.steamgriddb.com/api/v2';
export const SGDB_API_PROXY = 'https://deckyloader.ru/sgdb-api';
// kept for the Motd component and third-party patches
export const SGDB_API_BASE = SGDB_API_PROXY;

const SGDB_CDN_PREFIX = 'https://cdn2.steamgriddb.com/';
const SGDB_CDN_PROXY = 'https://deckyloader.ru/sgdb-cdn/';

const patchSgdbCdn = <T,>(value: T): T => {
  if (typeof value === 'string') {
    return (value.startsWith(SGDB_CDN_PREFIX)
      ? SGDB_CDN_PROXY + value.slice(SGDB_CDN_PREFIX.length)
      : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => patchSgdbCdn(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      result[key] = patchSgdbCdn(item);
    }
    return result as unknown as T;
  }
  return value;
};

type SgdbEndpoint = { base: string; key: string };
let endpointsPromise: Promise<SgdbEndpoint[]> | null = null;

const getSgdbEndpoints = (): Promise<SgdbEndpoint[]> => {
  if (!endpointsPromise) {
    endpointsPromise = call<[string, string], string>('get_setting', 'sgdb_api_key', '')
      .then((customKey: string) => {
        const key = (customKey || '').trim();
        return key
          ? [{ base: SGDB_API_DIRECT, key }, { base: SGDB_API_PROXY, key: SGDB_API_KEY }]
          : [{ base: SGDB_API_PROXY, key: SGDB_API_KEY }];
      })
      .catch(() => [{ base: SGDB_API_PROXY, key: SGDB_API_KEY }]);
  }
  return endpointsPromise;
};

export type SGDBContextType = {
  appId: number | null;
  setAppId: React.Dispatch<React.SetStateAction<number | null>>;
  appOverview: AppStoreAppOverview;
  searchAssets: (assetType: SGDBAssetType, options: {gameId?: number | null, filters?: any, page?: number, signal?: AbortSignal}) => Promise<Array<any>>;
  searchGames: (term: string) => Promise<Array<any>>;
  getSgdbGame: (sgdbGame: any) => Promise<any>;
  changeAsset: (data: string, assetType: SGDBAssetType | eAssetType) => Promise<void>;
  changeAssetFromUrl: (location: string, assetType: SGDBAssetType | eAssetType, path?: boolean) => Promise<void>;
  clearAsset: (assetType: SGDBAssetType | eAssetType) => Promise<void>;
}

const getAmbiguousAssetType = (assetType: SGDBAssetType | eAssetType) => typeof assetType === 'number' ? assetType : ASSET_TYPE[assetType];

const getApiParams = (assetType: SGDBAssetType, filters: any, page: number) => {
  let adult = 'false';
  let humor = 'any';
  let epilepsy = 'any';
  let oneoftag = '';

  if (filters?.untagged === true) {
    if (filters?.humor === false) {
      humor = 'false';
    }

    if (filters?.adult === false) {
      adult = 'false';
    }

    if (filters?.adult === true) {
      adult = 'any';
    }

    if (filters?.epilepsy === false) {
      epilepsy = 'false';
    }
  } else {
    const selectedTags = [];
    if (filters?.humor === true) {
      humor = 'any';
      selectedTags.push('humor');
    }

    if (filters?.adult === true) {
      adult = 'any';
      selectedTags.push('nsfw');
    }

    if (filters?.epilepsy === true) {
      epilepsy = 'any';
      selectedTags.push('epilepsy');
    }

    oneoftag = selectedTags.join(',');
  }

  return new URLSearchParams({
    page: page.toString(),
    styles:  filters?.styles ?? STYLES[assetType].default.join(','),
    dimensions: filters?.dimensions ?? DIMENSIONS[assetType].default.join(','),
    mimes: filters?.mimes ?? MIMES[assetType].default.join(','),
    nsfw: adult,
    humor,
    epilepsy,
    oneoftag,
    types: [filters?._static && 'static', filters?.animated && 'animated'].filter(Boolean).join(','),
  }).toString();
};

export const SGDBContext = createContext({});

export const SGDBProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [appId, setAppId] = useState<number>(0);
  const [appOverview, setAppOverview] = useState<AppStoreAppOverview | null>(null);

  const clearAsset: SGDBContextType['clearAsset'] = useCallback(async (assetType) => {
    assetType = getAmbiguousAssetType(assetType);
    if (assetType === ASSET_TYPE.icon) {
      if (appOverview?.BIsShortcut()) {
        const res = await call<[
          appid: number | null,
          owner_id: string,
          path: string | null,
        ], string>('set_shortcut_icon',
          appId,
          getCurrentSteamUserId(),
          null // null removes the icon
        );
        if (res !== 'icon_is_same_path') showRestartConfirm();
      } else {
        if (appOverview?.icon_hash) {
          // Redownload the icon from Steam
          await call<[
            appid: number | null,
            url: string,
            icon_hash: string,
          ]>('set_steam_icon_from_url',
            appId,
            window.appStore.GetIconURLForApp(appOverview),
            appOverview.icon_hash
          );
        }
      }
    } else {
      await SteamClient.Apps.ClearCustomArtworkForApp(appId, assetType);
      // ClearCustomArtworkForApp() resolves instantly instead of after clearing, so we need to wait a bit.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, [appId, appOverview]);

  const changeAsset: SGDBContextType['changeAsset'] = useCallback(async (data, assetType) => {
    assetType = getAmbiguousAssetType(assetType);
    try {
      await clearAsset(assetType);
      await SteamClient.Apps.SetCustomArtworkForApp(appId, data, 'png', assetType);

      // force create a position json if no custom position is set yet
      // fixes blank logos on shortcuts
      if (assetType === ASSET_TYPE.logo && appOverview?.BIsShortcut()) {
        const logoPos = await getCustomLogoPosition(appId); // Loads from json
        if (!logoPos) {
          await window.appDetailsStore.SaveCustomLogoPosition(appOverview, { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 50 });
        }
      }
    } catch (error) {
      log(error);
    }
  }, [appId, appOverview, clearAsset]);

  const apiRequest = useCallback(async (url: string, signal?: AbortSignal): Promise<any[]> => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const endpoints = await getSgdbEndpoints();
    let lastError: any;

    for (const endpoint of endpoints) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const res = await fetchNoCors(`${endpoint.base}${url}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${endpoint.key}`,
          },
        });
        log(res);

        if (!res.ok) {
          // 4xx (except rate limit) means the endpoint itself is fine, retrying
          // through the mirror will not help.
          if (res.status < 500 && res.status !== 429) {
            const apiErr: any = new Error('SGDB API request failed');
            apiErr.status = res.status;
            throw apiErr;
          }
          throw new Error('SGDB API request failed');
        }

        const assetRes = await res.json();
        if (!assetRes.success) {
          const apiErr: any = new Error((assetRes.errors || []).join(', '));
          apiErr.status = res.status;
          throw apiErr;
        }
        return patchSgdbCdn(assetRes.data);
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        lastError = err;
        log('sgdb endpoint failed', endpoint.base, err?.message);
      }
    }

    throw lastError ?? new Error('SGDB API request failed');
  }, []);

  const getImageAsB64 = useCallback(async (location: string, path = false) : Promise<string | null> => {
    log('downloading', location);
    try {
      return await call<[path: string], string>(path ? 'read_file_as_base64' : 'download_as_base64', location);
    } catch (error) {
      return null;
    }
  }, []);

  const changeAssetFromUrl: SGDBContextType['changeAssetFromUrl'] = useCallback(async (url, assetType, path = false) => {
    assetType = getAmbiguousAssetType(assetType);
    if (assetType === ASSET_TYPE.icon) {
      if (appOverview?.BIsShortcut()) {
        const res = await call<[
          appid: number | null,
          owner_id: string,
          path: string | null,
        ], string | boolean>(path ? 'set_shortcut_icon_from_path' : 'set_shortcut_icon_from_url',
          appId,
          getCurrentSteamUserId(),
          url
        );

        log('set_shortcut_icon result', res);
        if (res === 'icon_is_same_path') {
          // If the path is already the same as the current icon, we can force an icon re-read by setting the name to itself
          SteamClient.Apps.SetShortcutName(appOverview.appid, appOverview.display_name);
        } else if (res === true) {
          // shortcuts.vdf was modified, can't figure out how to make Steam re-read it so just ask user to reboot
          showRestartConfirm();
        }
      } else {
        // Change default Steam icon by poisoning the cache like Boop does it
        if (!appOverview?.icon_hash) {
          throw new Error('Could not find the current icon hash for this app');
        }

        const res = await call<[
          appid: number | null,
          location: string,
          icon_hash: string,
        ], string | boolean>(path ? 'set_steam_icon_from_path' : 'set_steam_icon_from_url',
          appId,
          url,
          appOverview.icon_hash
        );
        log('set_steam_icon result', res);
      }
    } else {
      const data = await getImageAsB64(url, path);
      if (!data) {
        throw new Error('Failed to retrieve asset');
      }
      await changeAsset(data, assetType);
    }
  }, [appId, appOverview, changeAsset, getImageAsB64]);

  const searchGames = useCallback(async (term: string) => {
    try {
      // encodeURIComponent twice to preserve some symbols
      // api is equpped to handle various types of inputs so this is fine
      const res = await apiRequest(`/search/autocomplete/${encodeURIComponent(encodeURIComponent(term))}`);
      log('search games', res);
      return res;
    } catch (err: any) {
      toaster.toast({
        title: 'SteamGridDB API Error',
        body: err.message,
        icon: <MenuIcon fill="#f3171e" />,
      });
      return [];
    }
  }, [apiRequest]);

  const searchAssets: SGDBContextType['searchAssets'] = useCallback(async (assetType, { gameId, filters = null, page = 0, signal }) => {
    let type = '';
    switch (assetType) {
    case 'grid_p':
    case 'grid_l':
      type = 'grids';
      break;
    case 'hero':
      type = 'heroes';
      break;
    case 'icon':
      type = 'icons';
      break;
    case 'logo':
      type = 'logos';
      break;
    }

    const qs = getApiParams(assetType, filters, page);
    log('asset search', gameId, qs);
    return await apiRequest(`/${type}/${gameId ? 'game' : 'steam'}/${gameId ?? appId}?${qs}`, signal);
  }, [apiRequest, appId]);

  const getSgdbGame = useCallback(async (game: any) => {
    try {
      const gameRes = await apiRequest(`/games/id/${game.id}?platformdata=steam`);
      log('sgdb game', gameRes);
      return gameRes;
    } catch (err: any) {
      toaster.toast({
        title: 'SteamGridDB API Error',
        body: err.message,
        icon: <MenuIcon fill="#f3171e" />,
      });
      return [];
    }
  }, [apiRequest]);

  useEffect(() => {
    if (appId) {
      (async () => {
        // Get details before overview or some games will be null.
        await getAppDetails(appId);
        const overview = await getAppOverview(appId);
        log('overview', overview);
        setAppOverview(overview);
      })();
    }
  }, [appId]);

  const value = useMemo(() => ({
    appId,
    appOverview,
    setAppId,
    searchAssets,
    searchGames,
    getSgdbGame,
    changeAsset,
    changeAssetFromUrl,
    clearAsset,
  }), [appId, appOverview, searchAssets, searchGames, getSgdbGame, changeAsset, changeAssetFromUrl, clearAsset]);

  return (
    <SGDBContext.Provider value={value}>
      {children}
    </SGDBContext.Provider>
  );
};

export const useSGDB = () => useContext(SGDBContext) as SGDBContextType;

export default useSGDB;
