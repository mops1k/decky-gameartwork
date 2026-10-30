import {
  useState,
  createContext,
  FC,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';
import { showModal } from '@decky/ui';
import { toaster } from '@decky/api';
import isEqual from 'react-fast-compare';
import debounce from 'just-debounce';

import useSettings from '../hooks/useSettings';
import { useSGDB } from '../hooks/useSGDB';
import FiltersModal from '../modals/FiltersModal';
import GameSelectionModal from '../modals/GameSelectionModal';
import MenuIcon from '../components/Icons/MenuIcon';
import log from '../utils/log';
import compareFilterWithDefaults from '../utils/compareFilterWithDefaults';
import { isConfidentMatch, pickBestMatch } from '../utils/matchGame';
import t from '../utils/i18n';
import { DIMENSIONS, MIMES, STYLES } from '../constants';

/** Widest set of filters: every style, dimension and mime the source knows. */
const getAllVariantsFilters = (assetType: SGDBAssetType, filters: any) => ({
  ...(filters || {}),
  styles: STYLES[assetType].options.map((option) => option.value),
  dimensions: DIMENSIONS[assetType].options.map((option) => option.value),
  mimes: MIMES[assetType].options.map((option) => option.value),
  animated: true,
  _static: true,
});

export type AssetSearchContextType = {
  loading: boolean;
  assets: any[];
  searchAndSetAssets: (assetType: SGDBAssetType, page: number, filters: any, onSuccess?: () => void) => Promise<void>;
  loadMore: (assetType: SGDBAssetType, onSuccess?: (res: any[]) => void) => Promise<void>;
  externalSgdbData: any;
  openFilters: (assetType: SGDBAssetType) => void;
  games: any[];
  selectedGame: any;
  isFilterActive: boolean;
  moreLoading: boolean;
  endReached: boolean;
  externalTerm: string | null;
}

export const SearchContext = createContext({});

let abortCont: AbortController | null = null;

export const AssetSearchContext: FC<{ children: ReactNode }> = ({ children }) => {
  const { set, get } = useSettings();
  const { appId, searchAssets, searchGames, getSgdbGame, appOverview } = useSGDB();
  const [assets, setAssets] = useState<Array<any>>([]);
  const [currentFilters, setCurrentFilters] = useState();
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState<any>();
  const [externalSgdbData, setExternalSgdbData] = useState<any>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [page, setPage] = useState(0);
  const [externalTerm, setExternalTerm] = useState<string | null>(null);

  const selectExternalName = useCallback((name: string) => {
    if (!name) {
      setExternalTerm(null);
      set(`external_name_${appId}`, false);
      return;
    }
    // A store title replaces the SGDB match: mixing artwork of two different
    // games in one grid would be confusing.
    setSelectedGame(undefined);
    set(`nonsteam_${appId}`, false);
    setExternalTerm(name);
    set(`external_name_${appId}`, name);
  }, [appId, set]);

  const showGameSelection = useCallback(() => {
    showModal(
      <GameSelectionModal
        defaultTerm={appOverview.display_name}
        searchGames={searchGames}
        onSelect={(game: any) => {
          setSelectedGame(game);
          set(`nonsteam_${appId}`, game);
          setExternalTerm(null);
          set(`external_name_${appId}`, false);
        }}
        onSelectExternal={selectExternalName}
      />
    );
  }, [appId, appOverview.display_name, searchGames, set, selectExternalName]);

  const searchAndSetAssets = useMemo(() => debounce(async (assetType, page, filters, onSuccess) => {
    // Shortcut without a matched SGDB game: nothing to request here, but the
    // cross-source section still has to be rendered.
    if (appOverview?.BIsModOrShortcut() && !selectedGame) {
      setAssets([]);
      onSuccess?.();
      return;
    }
    if (abortCont) abortCont?.abort();
    abortCont = new AbortController();

    try {
      setCurrentFilters(filters);
      setIsFilterActive(compareFilterWithDefaults(assetType, filters));
      let resp = await searchAssets(assetType, {
        gameId: selectedGame?.id,
        page,
        filters,
        signal: abortCont.signal,
      });

      // Nothing matched: retry once with every style/dimension/mime enabled
      // before telling the user the game has no artwork at all.
      if (page === 0 && resp.length === 0) {
        const relaxedFilters = getAllVariantsFilters(assetType, filters);
        const relaxed = await searchAssets(assetType, {
          gameId: selectedGame?.id,
          page,
          filters: relaxedFilters,
          signal: abortCont.signal,
        });
        if (relaxed.length > 0) {
          resp = relaxed;
          setCurrentFilters(relaxedFilters);
          setIsFilterActive(true);
          toaster.toast({
            title: appOverview?.display_name,
            body: t('MSG_FILTERS_RELAXED', 'No results with the current filters, showing all variants'),
            icon: <MenuIcon />,
          });
        }
      }

      log('search resp', assetType, resp);
      setAssets(resp);
      setEndReached(false);
      setPage(page + 1); // set to next page so correct page is requested when loadMore() is used
      onSuccess?.();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        log('Search Aborted');
      } else if (err?.status === 404) {
        showGameSelection();
      } else {
        toaster.toast({
          title: 'SteamGridDB API Error',
          body: err.message,
          icon: <MenuIcon fill="#f3171e" />,
        });
        if (selectedGame) {
          set(`nonsteam_${appId}`, false);
        }
      }
    }
  }, 500), [appId, appOverview, searchAssets, showGameSelection, selectedGame, set]) as AssetSearchContextType['searchAndSetAssets'];

  const loadMore = useMemo(() => debounce(async (assetType, onSuccess) => {
    if (appOverview?.BIsModOrShortcut() && !selectedGame) return;
    if (abortCont) abortCont?.abort();
    abortCont = new AbortController();

    if (assets.length === 0) return;

    try {
      setMoreLoading(true);
      const resp = await searchAssets(assetType, {
        page,
        gameId: selectedGame?.id,
        filters: currentFilters,
        signal: abortCont.signal,
      });
      log('search load more resp', resp);
      setAssets((assets) => [...assets, ...resp]);
      setMoreLoading(false);
      if (resp.length > 0) {
        setPage((x) => x + 1);
      }
      if (resp.length === 0) {
        setEndReached(true);
      }
      onSuccess?.(resp);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        log('Load more aborted');
      } else {
        toaster.toast({
          title: 'SteamGridDB API Error',
          body: err.message,
          icon: <MenuIcon fill="#f3171e" />,
        });
      }
    }
  }, 500), [appOverview, assets.length, currentFilters, page, searchAssets, selectedGame]);

  const handleFiltersSave = useCallback(async (assetType: SGDBAssetType, filters: any, game: any) => {
    const filtersChanged = !isEqual(filters, currentFilters);
    const gameChanged = game?.id !== selectedGame?.id;
    if (filtersChanged) {
      setLoading(true);
      searchAndSetAssets(assetType, 0, filters, () => {
        setLoading(false);
      });
      set(`filters_${assetType}`, filters, true);
      setCurrentFilters(filters);
    }
    if (gameChanged) {
      setSelectedGame(game ?? false);
      // save selected game to reuse for this shortcut
      set(`nonsteam_${appId}`, game ?? false);
      if (game) {
        setExternalTerm(null);
        set(`external_name_${appId}`, false);
      }
    }
    if (filtersChanged || gameChanged) {
      log('filtersChanged');
      setMoreLoading(false);
    }
    setIsFilterActive(compareFilterWithDefaults(assetType, filters));
  }, [currentFilters, selectedGame, searchAndSetAssets, set, appId]);

  const openFilters = useCallback(async (assetType: SGDBAssetType) => {
    log('Open Filters');
    const defaultFilters = await get(`filters_${assetType}`, null);
    showModal((
      <FiltersModal
        assetType={assetType}
        onSave={handleFiltersSave}
        defaultFilters={defaultFilters}
        defaultSelectedGame={selectedGame}
        defaultSearchTerm={selectedGame?.name || appOverview.display_name}
        isNonsteam={appOverview.BIsModOrShortcut()}
        searchGames={searchGames}
        onSelectExternal={selectExternalName}
        externalTerm={externalTerm}
      />
    ), window);
  }, [appOverview, get, handleFiltersSave, searchGames, selectedGame, selectExternalName, externalTerm]);

  useEffect(() => {
    if (!appOverview) return;
    (async () => {
      setLoading(true);
      const savedGame = await get(`nonsteam_${appId}`, false);
      const savedExternalTerm = await get(`external_name_${appId}`, null);
      if (savedExternalTerm) setExternalTerm(savedExternalTerm);

      // Older versions stored the first fuzzy hit even when it was a totally
      // different game; ignore such mappings and match again.
      const game = savedGame && savedGame.name && isConfidentMatch(appOverview.display_name, savedGame.name)
        ? savedGame
        : null;
      if (savedGame && !game) {
        set(`nonsteam_${appId}`, false);
      }
      if (game) {
        setSelectedGame(game);
      } else {
        if (appOverview.BIsModOrShortcut()) {
          const gameRes = await searchGames(appOverview.display_name);
          const bestMatch = pickBestMatch(appOverview.display_name, gameRes);
          if (bestMatch) {
            setSelectedGame(bestMatch);
            set(`nonsteam_${appId}`, bestMatch);
          } else {
            showGameSelection();
          }
        }
      }
      setLoading(false);
    })();
  }, [appOverview, appId, get, searchGames, set, showGameSelection]);

  useEffect(() => {
    if (!selectedGame) return;
    (async () => {
      const sgdbGame = await getSgdbGame(selectedGame);
      setExternalSgdbData(sgdbGame.external_platform_data);
    })();
  }, [getSgdbGame, selectedGame]);

  const value = useMemo(() => ({
    loading,
    assets,
    searchAndSetAssets,
    loadMore,
    selectedGame,
    externalSgdbData,
    openFilters,
    isFilterActive,
    moreLoading,
    endReached,
    externalTerm,
  }), [loading, assets, searchAndSetAssets, loadMore, selectedGame, externalSgdbData, openFilters, isFilterActive, moreLoading, endReached, externalTerm]);

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
};

export const useAssetSearch = () => useContext(SearchContext) as AssetSearchContextType;

export default useAssetSearch;
