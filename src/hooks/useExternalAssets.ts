import { useEffect, useRef, useState } from 'react';

import {
  ExternalAsset,
  ExternalSourcesState,
  searchExternalSources,
} from '../utils/providers';

export type ExternalAssetsState = {
  assets: ExternalAsset[];
  loading: boolean;
  sources: ExternalSourcesState;
};

const EMPTY: ExternalAssetsState = { assets: [], loading: false, sources: {} };

/**
 * Cross-source search with per-source progress: tiles show up as soon as each
 * store answers instead of waiting for the slowest one.
 */
export const useExternalAssets = (term: string | undefined, fallbackTerm?: string): ExternalAssetsState => {
  const [state, setState] = useState<ExternalAssetsState>(EMPTY);
  const requestId = useRef(0);

  useEffect(() => {
    if (!term) {
      setState(EMPTY);
      return;
    }
    const id = ++requestId.current;
    const alive = () => requestId.current === id;
    let lastSources: ExternalSourcesState = {};
    setState({ ...EMPTY, loading: true });

    const progress = (assets: ExternalAsset[], sources: ExternalSourcesState, loading: boolean) => {
      lastSources = sources;
      if (alive()) setState({ assets, loading, sources: { ...sources } });
    };

    const run = async () => {
      const result = await searchExternalSources(term, (update) => {
        progress(update.assets, update.sources, true);
      });
      // A localized/renamed shortcut may not match any store: try the
      // SteamGridDB title as a second chance before giving up.
      if (!result.length && fallbackTerm && fallbackTerm.trim() && fallbackTerm.trim().toLowerCase() !== term.trim().toLowerCase()) {
        const fallback = await searchExternalSources(fallbackTerm, (update) => {
          progress(update.assets, update.sources, true);
        });
        progress(fallback || [], lastSources, false);
        return;
      }
      progress(result || [], lastSources, false);
    };

    run().catch(() => {
      if (alive()) setState({ ...EMPTY, loading: false });
    });
  }, [term, fallbackTerm]);

  return state;
};

export default useExternalAssets;
