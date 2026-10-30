import { call, toaster } from '@decky/api';
import { useCallback, useEffect, useRef, useState } from 'react';

import log from '../utils/log';

export interface PluginUpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string;
  size: number;
  notes: string;
  published_at: string;
  checked: number;
  error?: string;
}

/** InstallType.UPDATE in the Decky Loader frontend (browser.py PluginInstallType). */
export const DECKY_INSTALL_TYPE_UPDATE = 2;

export default function useUpdateChecker(pluginName: string) {
  const [info, setInfo] = useState<PluginUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const result = await call<[boolean], PluginUpdateInfo>('check_update', force);
      if (mounted.current) setInfo(result);
    } catch (err) {
      log('update check failed', err);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Backend caches the GitHub lookup for a few hours, so this is cheap.
    check(false);
  }, [check]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!info?.available || !info.url) return false;

    // Reuse the loader's own installer: it downloads the release zip, unpacks
    // it into /home/deck/homebrew/plugins and reloads the plugin. The loader
    // shows its standard confirmation dialog before doing anything.
    const loader = window.DeckyBackend;
    if (!loader?.call) {
      toaster.toast({
        title: pluginName,
        body: 'Decky Loader does not expose its installer. Download the release zip from GitHub instead.',
      });
      return false;
    }

    setInstalling(true);
    try {
      log('requesting loader install', info.url);
      await loader.call('utilities/install_plugin', info.url, pluginName, info.latest, '', DECKY_INSTALL_TYPE_UPDATE);
      return true;
    } catch (err) {
      log('loader install failed', err);
      toaster.toast({
        title: pluginName,
        body: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }, [info, pluginName]);

  return { info, checking, installing, check, install };
}
