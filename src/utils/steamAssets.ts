import { call } from '@decky/api';

import log from './log';

export type SteamApp = {
  appid: number;
  name: string;
  tiny_image?: string | null;
};

export type SteamAsset = {
  url: string | null;
  width: number;
  height: number;
};

export type SteamAppAssets = {
  appid: number;
  name: string;
  assets: Record<string, SteamAsset>;
};

export const searchSteamApps = async (term: string): Promise<SteamApp[]> => {
  try {
    return await call<[string, string?], SteamApp[]>('steam_search_apps', term);
  } catch (err) {
    log('steam search failed', err);
    return [];
  }
};

export const getSteamAppAssets = async (appid: number): Promise<SteamAppAssets | null> => {
  try {
    return await call<[number], SteamAppAssets | null>('steam_app_assets', appid);
  } catch (err) {
    log('steam assets failed', err);
    return null;
  }
};
