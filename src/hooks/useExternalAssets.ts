import { useEffect, useState } from 'react';

import { ExternalAsset, searchExternalSources } from '../utils/providers';

export type ExternalAssetsState = {
  assets: ExternalAsset[];
  loading: boolean;
};

export const useExternalAssets = (term: string | undefined, fallbackTerm?: string): ExternalAssetsState => {
  const [assets, setAssets] = useState<ExternalAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!term) {
      setAssets([]);
      return;
    }
    let alive = true;
    setLoading(true);
    searchExternalSources(term)
      .then(async (result) => {
        // A localized/renamed shortcut may not match any store: try the
        // SteamGridDB title as a second chance before giving up.
        if (!result.length && fallbackTerm && fallbackTerm.trim() && fallbackTerm.trim().toLowerCase() !== term.trim().toLowerCase()) {
          return await searchExternalSources(fallbackTerm);
        }
        return result;
      })
      .then((result) => {
        if (alive) setAssets(result || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [term, fallbackTerm]);

  return { assets, loading };
};

export default useExternalAssets;
