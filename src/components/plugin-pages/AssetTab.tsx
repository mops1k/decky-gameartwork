import { Focusable, joinClassNames, showModal } from '@decky/ui';
import { call, toaster } from '@decky/api';
import {
  useState, FC, useRef, useEffect, useMemo, useCallback,
} from 'react';

import { useSGDB } from '../../hooks/useSGDB';
import Asset from '../asset/Asset';
import t from '../../utils/i18n';
import Toolbar, { ToolbarRefType } from '../qam-contents/Toolbar';
import MenuIcon from '../Icons/MenuIcon';
import DetailsModal from '../../modals/DetailsModal';
import { SGDB_ASSET_TYPE_READABLE } from '../../constants';
import useAssetSearch from '../../hooks/useAssetSearch';
import useSettings from '../../hooks/useSettings';
import useExternalAssets from '../../hooks/useExternalAssets';
import ResultsStateBar from '../ResultsStateBar';
import LogoPositionerModal from '../../modals/LogoPositionerModal';
import OfficialAssetsModal from '../../modals/OfficialAssetsModal';
import Motd from '../Motd';
import ExternalAssetModal from '../../modals/ExternalAssetModal';
import SourceFilterBar, { SourceFilter } from '../SourceFilterBar';
import { ExternalAsset } from '../../utils/providers';
import getCurrentSteamUserId from '../../utils/getCurrentSteamUserId';
import log from '../../utils/log';

const ASSET_TYPES: SGDBAssetType[] = ['grid_p', 'grid_l', 'hero', 'logo', 'icon'];

const AssetTab: FC<{ assetType: SGDBAssetType }> = ({ assetType }) => {
  const { get, set } = useSettings();
  const {
    loading: searchLoading,
    assets,
    searchAndSetAssets,
    loadMore,
    openFilters,
    isFilterActive,
    selectedGame,
    externalSgdbData,
    endReached,
    externalTerm,
    showGameSelection,
  } = useAssetSearch();
  const { appId, appOverview, changeAssetFromUrl } = useSGDB();
  const [downloadingId, setDownloadingId] = useState<string | number | null>(null);
  const [sizingStyles, setSizingStyles] = useState<any>(undefined);
  const [tabLoading, setTabLoading] = useState(true);
  const [scrollContainerHeight, setScrollContainerHeight] = useState<string>();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [appliedArt, setAppliedArt] = useState<Record<string, string>>({});
  const [customArt, setCustomArt] = useState<Record<string, boolean>>({});
  const loading = useMemo(() => !(!searchLoading && !tabLoading), [searchLoading, tabLoading]);

  // Cross-search every built-in source by the game title, transparently.
  // The shortcut name is what the user actually sees in the library; a wrong
  // SGDB mapping must not redirect the cross-search.
  const searchTerm = externalTerm || appOverview?.display_name;
  const fallbackTerm = selectedGame?.name;
  const { assets: externalAssets, loading: externalLoading, sources: externalSources } = useExternalAssets(searchTerm, fallbackTerm);
  const visibleExternalAssets = useMemo(
    () => externalAssets.filter((asset) => asset.kind === assetType),
    [externalAssets, assetType]
  );

  // Steam exposes no API to read the current artwork, so the plugin remembers
  // what it applied and checks that Steam still keeps a custom file for it.
  const appliedRef = useRef<Record<string, string>>({});
  const markApplied = useCallback((type: SGDBAssetType, url: string) => {
    // A bundle applies several types in a row: keep the map outside of the
    // render state so every type is stored, not only the last one.
    const next = { ...appliedRef.current, [type]: url };
    appliedRef.current = next;
    setAppliedArt(next);
    setCustomArt((prev) => ({ ...prev, [type]: true }));
    // Debounced by the settings provider: only the last value hits the disk.
    set(`applied_art_${appId}`, next);
  }, [appId, set]);

  const isApplied = useCallback((type: SGDBAssetType, url: string) => Boolean(
    url && appliedArt[type] === url && customArt[type]
  ), [appliedArt, customArt]);

  useEffect(() => {
    if (!appId) return;
    (async () => {
      const saved = await get(`applied_art_${appId}`, null);
      if (saved && typeof saved === 'object') {
        appliedRef.current = saved;
        setAppliedArt(saved);
      }
      try {
        const state = await call<[number, string], Record<string, boolean>>(
          'custom_artwork_state', appId, getCurrentSteamUserId()
        );
        setCustomArt(state || {});
      } catch (err) {
        log('custom_artwork_state failed', err);
      }
    })();
  }, [appId, get]);

  // A source filter that stays selected while switching tabs hides everything.
  useEffect(() => {
    setSourceFilter('all');
  }, [assetType]);

  const sourceScopedExternal = useMemo(
    () => (sourceFilter === 'all' || sourceFilter === 'sgdb'
      ? visibleExternalAssets
      : visibleExternalAssets.filter((asset) => asset.source === sourceFilter)),
    [visibleExternalAssets, sourceFilter]
  );
  const sourceScopedSgdb = useMemo(
    () => (sourceFilter === 'all' || sourceFilter === 'sgdb' ? assets : []),
    [assets, sourceFilter]
  );
  const sourceCounts = useMemo(() => {
    const counts: Partial<Record<SourceFilter, number>> = {
      all: assets.length + visibleExternalAssets.length,
      sgdb: assets.length,
    };
    for (const asset of visibleExternalAssets) {
      counts[asset.source] = (counts[asset.source] || 0) + 1;
    }
    return counts;
  }, [assets.length, visibleExternalAssets]);

  const applyBundle = useCallback(async (items: ExternalAsset[]) => {
    const applied: SGDBAssetType[] = [];
    for (const kind of ASSET_TYPES) {
      const item = items.find((candidate) => candidate.kind === kind);
      if (!item) continue;
      try {
        await changeAssetFromUrl(item.url, kind);
        markApplied(kind, item.url);
        applied.push(kind);
      } catch (err: any) {
        log('bundle apply failed', kind, err);
      }
    }
    if (applied.length) {
      toaster.toast({
        title: appOverview?.display_name,
        body: t('MSG_BUNDLE_APPLIED', 'Applied: {list}').replace(
          '{list}', applied.map((kind) => SGDB_ASSET_TYPE_READABLE[kind]).join(', ')
        ),
        icon: <MenuIcon />,
        duration: 2500,
      });
    } else {
      toaster.toast({
        title: t('MSG_ASSET_APPLY_ERROR', 'There was a problem applying this asset.'),
        body: t('MSG_BUNDLE_EMPTY', 'This source has no other artwork for the game.'),
        icon: <MenuIcon fill="#f3171e" />,
      });
    }
  }, [appOverview?.display_name, changeAssetFromUrl, markApplied]);

  const toolbarRef = useRef<ToolbarRefType>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const intersectRef = useRef<HTMLDivElement>(null);

  const handleFilterClick = () => openFilters(assetType);
  const handleLogoPosClick = () => showModal(<LogoPositionerModal appId={appOverview.appid} />, window);
  const handleOfficialAssetsClick = () => {
    showModal((
      <OfficialAssetsModal
        onAssetChange={async (url) => {
          try {
            await changeAssetFromUrl(url, assetType);
            markApplied(assetType, url);
            toaster.toast({
              title: appOverview?.display_name,
              body: t('MSG_ASSET_APPLY_SUCCESS', '{assetType} has been successfully applied!').replace('{assetType}', SGDB_ASSET_TYPE_READABLE[assetType]),
              icon: <MenuIcon />,
              duration: 1500,
            });
          } catch (err: any) {
            toaster.toast({
              title: t('MSG_ASSET_APPLY_ERROR', 'There was a problem applying this asset.'),
              body: err.message,
              icon: <MenuIcon fill="#f3171e" />,
            });
          }
        }}
        assetType={assetType}
        data={externalSgdbData}
      />
    ), window);
  };

  const setAsset = async (assetId: string | number, url: string) => {
    if (!downloadingId) {
      try {
        setDownloadingId(assetId);
        await changeAssetFromUrl(url, assetType);
        markApplied(assetType, url);
        toaster.toast({
          title: appOverview?.display_name,
          body: t('MSG_ASSET_APPLY_SUCCESS', '{assetType} has been successfully applied!').replace('{assetType}', SGDB_ASSET_TYPE_READABLE[assetType]),
          icon: <MenuIcon />,
          duration: 1500,
        });
      } catch (err: any) {
        toaster.toast({
          title: t('MSG_ASSET_APPLY_ERROR', 'There was a problem applying this asset.'),
          body: err.message,
          icon: <MenuIcon fill="#f3171e" />,
        });
      } finally {
        setDownloadingId(null);
      }
    }
  };

  const openDetails = (asset: any, external = false) => {
    if (external) {
      showModal((
        <ExternalAssetModal
          asset={asset as ExternalAsset}
          assetType={assetType}
          term={searchTerm || appOverview?.display_name || ''}
          onApply={async (item) => await setAsset(item.id, item.url)}
          onApplyBundle={applyBundle}
          onPickGame={showGameSelection}
        />
      ), window);
      return;
    }
    showModal((
      <DetailsModal
        asset={asset}
        assetType={assetType}
        onAssetChange={async () => await setAsset(asset.id, asset.url)}
      />
    ), window);
  };

  useEffect(() => {
    (async () => {
      setTabLoading(true);
      const filters = await get(`filters_${assetType}`, null);
      await searchAndSetAssets(assetType, 0, filters, () => {
        setTabLoading(false);
      });
    })();
  }, [searchAndSetAssets, assetType, get]);

  useEffect(() => {
    if (!intersectRef.current || loading || endReached) return;

    const observer = new IntersectionObserver(([entry], observer) => {
      if (entry.isIntersecting) {
        loadMore(assetType, (res) => {
          // End reached
          if (res.length === 0) {
            observer.disconnect();
          }
        });
      }
    }, { threshold: 0, root: mainContentRef.current?.parentElement?.parentElement });
    observer.observe(intersectRef.current);

    // Hack to work around CSS themes that don't adjust padding of tabbed content when changing the size of the footer.
    if (mainContentRef.current?.parentElement?.parentElement) {
      const pb = window.getComputedStyle(mainContentRef.current.parentElement.parentElement).getPropertyValue('padding-bottom');
      setScrollContainerHeight(pb);
    }
    return () => {
      observer.disconnect();
    };
  }, [assetType, endReached, loadMore, loading]);

  if (!appOverview) return null;

  return (
    <div className="tabcontents-wrap">
      <div className={joinClassNames('spinnyboi', !loading ? 'loaded' : '')}>
        {/* cant use <SteamSpinner /> cause it has some extra elements that break the layout */}
        <img alt="Loading..." src="/images/steam_spinner.png" />
      </div>

      <Toolbar
        ref={toolbarRef}
        assetType={assetType}
        onFilterClick={handleFilterClick}
        onLogoPosClick={handleLogoPosClick}
        onOfficialAssetsClick={handleOfficialAssetsClick}
        onSizeChange={(size) => setSizingStyles(size)}
        disabled={tabLoading}
        noFocusRing={searchLoading || tabLoading}
      />

      <Motd disabled={tabLoading} noFocusRing={searchLoading || tabLoading} />

      <ResultsStateBar
        loading={loading}
        selectedGame={selectedGame}
        isFiltered={isFilterActive}
        onClick={handleFilterClick}
      />

      <SourceFilterBar
        value={sourceFilter}
        onChange={setSourceFilter}
        sources={externalSources}
        counts={sourceCounts}
      />

      <Focusable
        ref={mainContentRef}
        id="images-container"
        style={sizingStyles}
      >
        {!tabLoading && (
          <>
            {sourceScopedSgdb.map((asset: any) => (
              <Asset
                key={asset.id}
                scrollContainer={mainContentRef.current?.parentElement?.parentElement as Element}
                author={asset.author}
                notes={asset.notes}
                src={asset.thumb}
                width={asset.width}
                height={asset.height}
                humor={asset.humor}
                epilepsy={asset.epilepsy}
                nsfw={asset.nsfw}
                assetType={assetType}
                isAnimated={asset.thumb.includes('.webm')}
                isDownloading={downloadingId === asset.id}
                applied={isApplied(assetType, asset.url)}
                onActivate={() => setAsset(asset.id, asset.url)}
                onOKActionDescription={t('ACTION_ASSET_APPLY', 'Apply {assetType}').replace('{assetType}', SGDB_ASSET_TYPE_READABLE[assetType])}
                onSecondaryActionDescription={t('ACTION_OPEN_FILTER', 'Filter')} // activate filter bar from anywhere
                onSecondaryButton={handleFilterClick}
                onMenuActionDescription={t('ACTION_OPEN_DETAILS', 'Details')}
                onMenuButton={() => openDetails(asset)}
                onContextMenu={(evt) => {
                  evt.preventDefault();
                  openDetails(asset);
                }}
              />
            ))}
            {sourceScopedExternal.map((asset) => (
              <Asset
                key={asset.id}
                scrollContainer={mainContentRef.current?.parentElement?.parentElement as Element}
                sourceName={asset.sourceName}
                caption={asset.name}
                src={asset.thumb}
                width={asset.width}
                height={asset.height}
                assetType={assetType}
                isAnimated={false}
                isDownloading={downloadingId === asset.id}
                applied={isApplied(assetType, asset.url)}
                onActivate={() => setAsset(asset.id, asset.url)}
                onOKActionDescription={t('ACTION_ASSET_APPLY', 'Apply {assetType}').replace('{assetType}', SGDB_ASSET_TYPE_READABLE[assetType])}
                onMenuActionDescription={t('ACTION_OPEN_DETAILS', 'Details')}
                onMenuButton={() => openDetails(asset, true)}
                onContextMenu={(evt) => {
                  evt.preventDefault();
                  openDetails(asset, true);
                }}
              />
            ))}
            {/* Load more if spinner in view */}
            <div ref={intersectRef} style={{ gridColumn: '1 / -1', height: '5px', marginBottom: scrollContainerHeight }} />
            {externalLoading && sourceFilter !== 'sgdb' && (
              <div className="source-loading" style={{ gridColumn: '1 / -1' }}>
                {t('MSG_LOADING_SOURCES', 'Loading sources...')}
              </div>
            )}
            {sourceScopedSgdb.length === 0 && sourceScopedExternal.length === 0 && !externalLoading && (
              <div style={{ gridColumn: '1 / -1', justifySelf: 'center' }}>{t('Search_NoResults', 'No Results Found.', true)}</div>
            )}
          </>
        )}
      </Focusable>
    </div>
  );
};

export default AssetTab;
