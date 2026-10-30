import {
  PanelSection,
  PanelSectionRow,
  Navigation,
  Field,
  showModal,
  ModalRoot,
  DialogButton,
  DialogBody,
  DialogHeader,
  DialogBodyText,
  ToggleField,
  SliderField,
  TextField,
} from '@decky/ui';
import { call, FileSelectionType, openFilePicker } from '@decky/api';
import { useState, useEffect, VFC, useCallback, useRef } from 'react';

import t from '../../utils/i18n';
import TabSorter from '../TabSorter';
import useSettings, { SettingsProvider } from '../../hooks/useSettings';
import { addHomePatch, removeHomePatch } from '../../patches/homePatch';
import { addSquareLibraryPatch, removeSquareLibraryPatch } from '../../patches/squareLibraryPatch';
import { addCapsuleGlowPatch } from '../../patches/capsuleGlowPatch';
import { ASSET_TYPE, DIMENSIONS } from '../../constants';
import { appgridClasses } from '../../static-classes';
import { ALL_SOURCES, ExternalSource, SOURCE_NAMES, invalidateEnabledSources } from '../../utils/providers';
import { isConfidentMatch, pickBestMatch } from '../../utils/matchGame';
import { getSteamAppAssets, searchSteamApps } from '../../utils/steamAssets';
import getCurrentSteamUserId from '../../utils/getCurrentSteamUserId';
import log from '../../utils/log';

import GuideVideoField from './GuideVideoField';
import UpdateSection from './UpdateSection';

const HEALTH_NAMES: Record<string, string> = { sgdb: 'SteamGridDB', ...SOURCE_NAMES };

const tabSettingsDesc = t('MSG_ASSET_TAB_SETTINGS_DESC', 'Reorder or hide unused tabs, and set the default tab that opens when using "{ACTION_CHANGE_ARTWORK}"').replace('{ACTION_CHANGE_ARTWORK}', t('ACTION_CHANGE_ARTWORK', 'Change Artwork...'));
const squareGridSizes = DIMENSIONS.grid_p.options.filter((x) => {
  const [w,h] = x.value.split('x');
  return w === h;
}).map((x) => x.value);

// Set square/uniform featured game using logic written at 3am
const setPatches = (squares: boolean, uniformFeatured: boolean): void => {
  if (!uniformFeatured && !squares) {
    removeHomePatch();
  } else if (squares || uniformFeatured) {
    // Remove the home patch then patch it again
    removeHomePatch();
    addHomePatch(false, squares, uniformFeatured);
    if (squares) {
      addSquareLibraryPatch();
    }
  }
  if (!squares) {
    removeSquareLibraryPatch();
  }
};

const QuickAccessSettings: VFC = () => {
  const { get, set } = useSettings();
  const [useCount, setUseCount] = useState<number | null>(null);
  const [squares, setSquares] = useState<boolean>(false);
  const [uniformFeatured, setUniformFeatured] = useState<boolean>(false);
  const [motdToggle, setMotdToggle] = useState<boolean>(false);
  const [capsuleGlowAmount, setCapsuleGlowAmount] = useState(100);
  const [debugAppid] = useState('70');
  const [igdbClientId, setIgdbClientId] = useState('');
  const [igdbClientSecret, setIgdbClientSecret] = useState('');
  const [sourcesEnabled, setSourcesEnabled] = useState<Record<ExternalSource, boolean>>({
    steam: true,
    epic: true,
    gog: true,
    igdb: true,
    vndb: true,
  });
  const [health, setHealth] = useState<Record<string, { ok: boolean; ms: number; error: string }> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [importConfirm, setImportConfirm] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; applied: number; skipped: number; failed: number } | null>(null);
  const bulkCancel = useRef(false);

  const handleBulkApply = useCallback(async () => {
    setBulkConfirm(false);
    setBulkRunning(true);
    bulkCancel.current = false;
    const ownerId = getCurrentSteamUserId();
    const apps = ((window.appStore as any)?.allApps || []) as any[];
    const shortcuts = apps.filter((app) => {
      try {
        return typeof app?.BIsShortcut === 'function' ? app.BIsShortcut() : false;
      } catch {
        return false;
      }
    });
    const progress = { done: 0, total: shortcuts.length, applied: 0, skipped: 0, failed: 0 };
    setBulkProgress({ ...progress });

    const kinds: { kind: SGDBAssetType; type: number }[] = [
      { kind: 'grid_p', type: ASSET_TYPE.grid_p },
      { kind: 'grid_l', type: ASSET_TYPE.grid_l },
      { kind: 'hero', type: ASSET_TYPE.hero },
      { kind: 'logo', type: ASSET_TYPE.logo },
    ];

    for (const app of shortcuts) {
      if (bulkCancel.current) break;
      progress.done += 1;
      try {
        // Never touch a game that already has custom artwork.
        const state = await call<[number, string], Record<string, boolean>>('custom_artwork_state', app.appid, ownerId);
        if (state && Object.values(state).some(Boolean)) {
          progress.skipped += 1;
        } else {
          const best = pickBestMatch(app.display_name, await searchSteamApps(app.display_name));
          if (!best || !isConfidentMatch(app.display_name, best.name)) {
            progress.skipped += 1;
          } else {
            const assets = await getSteamAppAssets(best.appid);
            let appliedAny = false;
            for (const { kind, type } of kinds) {
              const asset = (assets?.assets as any)?.[kind];
              if (!asset?.url) continue;
              try {
                const data = await call<[string], string>('download_as_base64', asset.url);
                await (window as any).SteamClient.Apps.SetCustomArtworkForApp(app.appid, data, 'png', type);
                appliedAny = true;
              } catch (err) {
                log('bulk apply failed', kind, err);
              }
            }
            if (appliedAny) progress.applied += 1;
            else progress.skipped += 1;
          }
        }
      } catch (err) {
        log('bulk apply failed', app.display_name, err);
        progress.failed += 1;
      }
      setBulkProgress({ ...progress });
    }
    setBulkRunning(false);
  }, []);

  const handleHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    try {
      const result = await call<[], Record<string, { ok: boolean; ms: number; error: string }>>('source_health');
      setHealth(result || {});
    } catch (err: any) {
      setHealth({});
      setBackupMessage(err?.message || '');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const handleExportSettings = useCallback(async () => {
    try {
      const result = await call<[], { ok: boolean; path?: string; count?: number; error?: string }>('export_settings');
      setBackupMessage(result?.ok
        ? t('MSG_EXPORT_DONE', 'Saved {count} entries to {path}').replace('{count}', String(result.count)).replace('{path}', result.path || '')
        : t('MSG_EXPORT_FAILED', 'Export failed: {error}').replace('{error}', result?.error || ''));
    } catch (err: any) {
      setBackupMessage(t('MSG_EXPORT_FAILED', 'Export failed: {error}').replace('{error}', err?.message || ''));
    }
  }, []);

  const handleImportSettings = useCallback(async () => {
    setImportConfirm(false);
    try {
      const result = await call<[string], { ok: boolean; count?: number; error?: string }>('import_settings', '');
      setBackupMessage(result?.ok
        ? t('MSG_IMPORT_DONE', 'Restored {count} entries').replace('{count}', String(result.count))
        : t('MSG_IMPORT_FAILED', 'Import failed: {error}').replace('{error}', result?.error || ''));
    } catch (err: any) {
      setBackupMessage(t('MSG_IMPORT_FAILED', 'Import failed: {error}').replace('{error}', err?.message || ''));
    }
  }, []);

  const handleSourceToggle = useCallback((source: ExternalSource, value: boolean) => {
    const next = { ...sourcesEnabled, [source]: value };
    setSourcesEnabled(next);
    set('sources_enabled', next, true);
    // The cross-search caches the switches for a few seconds: drop that copy.
    invalidateEnabledSources();
  }, [set, sourcesEnabled]);

  const handleIgdbClientId = useCallback((value: string) => {
    setIgdbClientId(value);
    set('igdb_client_id', value);
  }, [set]);

  const handleIgdbClientSecret = useCallback((value: string) => {
    setIgdbClientSecret(value);
    set('igdb_client_secret', value);
  }, [set]);

  const handleMotdToggle = useCallback(async (val: boolean) => {
    set('motd_hidden_global', val, true);
    setMotdToggle(val);
  }, [set]);

  const handleSquareToggle = useCallback(async (checked: boolean) => {
    set('squares', checked, true);
    setSquares(checked);
    setPatches(checked, uniformFeatured);

    const currentFilters = await get('filters_grid_p', {});
    if (checked) {
      // only enable square
      currentFilters['dimensions'] = squareGridSizes;
    } else {
      // set to default
      currentFilters['dimensions'] = DIMENSIONS.grid_p.default;
    }
    set('filters_grid_p', currentFilters, true);
  }, [get, set, uniformFeatured]);

  const handleUniformFeaturedToggle = useCallback(async (checked: boolean) => {
    set('uniform_featured', checked, true);
    setUniformFeatured(checked);
    setPatches(squares, checked);
  }, [set, squares]);

  const handleCapsuleGlowChange = useCallback(async (val: number) => {
    set('capsule_glow_amount', val, true);
    addCapsuleGlowPatch(val);
    setCapsuleGlowAmount(val);
  }, [set]);

  const handleSetUseCount = useCallback(async (val: number) => {
    set('plugin_use_count', val, false);
    setUseCount(val);
  }, [set]);

  useEffect(() => {
    (async () => {
      setUseCount(await get('plugin_use_count', 0));
      setSquares(await get('squares', false));
      setUniformFeatured(await get('uniform_featured', false));
      setCapsuleGlowAmount(await get('capsule_glow_amount', 100));
      setMotdToggle(await get('motd_hidden_global', false));
      setIgdbClientId(await get('igdb_client_id', ''));
      setIgdbClientSecret(await get('igdb_client_secret', ''));
      const storedSources = await get('sources_enabled', null);
      if (storedSources && typeof storedSources === 'object') {
        setSourcesEnabled((prev) => {
          const next = { ...prev };
          for (const source of ALL_SOURCES) {
            if (typeof storedSources[source] === 'boolean') next[source] = storedSources[source];
          }
          return next;
        });
      }
    })();
  }, [get]);

  if (useCount === null) return null;

  return (
    <>
      {process.env.ROLLUP_ENV === 'development' && (
        <PanelSection title="Debug">
          <PanelSectionRow>
            <Field
              padding="none"
              childrenContainerWidth="max"
            >
              <DialogButton onClick={() => {
                Navigation.Navigate('/zoo');
                Navigation.CloseSideMenus();
              }}
              >
              Zoo
              </DialogButton>
              <DialogButton onClick={() => {
                Navigation.Navigate(`/steamgriddb/${debugAppid}/manage`);
                Navigation.CloseSideMenus();
              }}
              >
                {debugAppid}
              </DialogButton>
              <DialogButton onClick={() => {
                // for debugging reasons do not panic
                set('motd_last_fetched', 0, true);
                setTimeout(() => {
                  set('motd_cached', null, true);
                  setTimeout(() => {
                    set('motd_hidden', null, true);
                  }, 300);
                }, 300);
              }}
              >
              Reset MOTD
              </DialogButton>
              <SliderField
                label="plugin_use_count"
                notchCount={2}
                showValue
                notchTicksVisible={false}
                onChange={handleSetUseCount}
                value={useCount}
                editableValue
                min={0}
                max={1337}
                step={1}
                resetValue={0}
              />
              <DialogButton onClick={() => {
                openFilePicker(
                  FileSelectionType.FOLDER,
                  '/',
                  false,
                  true
                );
              }}
              >
              directory picker
              </DialogButton>
            </Field>
          </PanelSectionRow>
        </PanelSection>
      )}
      <UpdateSection pluginName="GameArtwork" />
      {(useCount <= 5) && ( // Hide tutorial if plugin has been used more than 5 times
        <PanelSection title={t('LABEL_USAGE_TITLE', 'Lost? Here\'s a Quick Guide')}>
          <PanelSectionRow>
            <GuideVideoField
              bottomSeparator="standard"
              highlightOnFocus
              focusable
              onActivate={() => {
                showModal(
                  <ModalRoot>
                    <DialogBody style={{ padding: '0 3.5em' }}>
                      <GuideVideoField />
                    </DialogBody>
                  </ModalRoot>
                );
              }}
            />
          </PanelSectionRow>
        </PanelSection>
      )}
      <PanelSection title={t('LABEL_SOURCES_TITLE', 'Artwork Sources')}>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', padding: '4px 0' }}>
            {t('LABEL_SOURCES_DESC', 'Which stores are searched for artwork next to SteamGridDB. Turn off a source to skip its requests.')}
          </div>
        </PanelSectionRow>
        {ALL_SOURCES.map((source) => (
          <PanelSectionRow key={source}>
            <ToggleField
              label={SOURCE_NAMES[source]}
              checked={sourcesEnabled[source]}
              onChange={(value) => handleSourceToggle(source, value)}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>
      <PanelSection title="IGDB">
        <PanelSectionRow>
          <Field
            label={t('LABEL_IGDB_CLIENT_ID', 'Twitch Client ID')}
            description={t('LABEL_IGDB_HINT', 'Optional: enables IGDB artwork for console and indie games. Create an app at dev.twitch.tv → Register Your Application.')}
            childrenLayout="below"
            bottomSeparator="none"
          >
            <TextField value={igdbClientId} onChange={(evt) => handleIgdbClientId(evt.target.value)} spellCheck={false} />
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label={t('LABEL_IGDB_CLIENT_SECRET', 'Twitch Client Secret')} childrenLayout="below">
            <TextField value={igdbClientSecret} onChange={(evt) => handleIgdbClientSecret(evt.target.value)} spellCheck={false} />
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t('Settings', 'Settings', true)}>
        <PanelSectionRow>
          <ToggleField
            label={t('LABEL_SQUARE_CAPSULES', 'Square Capsules')}
            description={t('LABEL_SQUARE_CAPSULES_DESC', 'Use square capsules instead of portrait ones. Square filters will be automatically selected.')}
            checked={squares}
            onChange={handleSquareToggle}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t('LABEL_UNIFORM_RECENT', 'Matching Recents Capsule')}
            description={t('LABEL_UNIFORM_RECENT_DESC', 'Make the most recently played game on the home screen match the rest of the capsules.')}
            checked={uniformFeatured}
            onChange={handleUniformFeaturedToggle}
          />
        </PanelSectionRow>
        {appgridClasses?.LibraryImageBackgroundGlow && (
          <PanelSectionRow>
            <SliderField
              label={t('LABEL_CAPSULE_GLOW', 'Capsule Glow')}
              description={t('LABEL_CAPSULE_GLOW_DESC', 'Adjust capsule glow intensity in the library.')}
              notchCount={2}
              notchLabels={[
                {
                  notchIndex: 0,
                  label: t('LABEL_CAPSULE_GLOW_OFF', 'None'),
                },
              ]}
              notchTicksVisible={false}
              onChange={handleCapsuleGlowChange}
              value={capsuleGlowAmount}
              min={0}
              max={100}
              step={1}
              resetValue={100}
            />
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <Field childrenLayout="below" description={tabSettingsDesc}>
            <DialogButton
              onClick={() => {
                showModal((
                  <ModalRoot>
                    <SettingsProvider>
                      <DialogHeader>
                        {t('LABEL_SETTINGS_ASSET_TABS', 'Asset Tab Settings')}
                      </DialogHeader>
                      <DialogBodyText>{tabSettingsDesc}</DialogBodyText>
                      <DialogBody>
                        <TabSorter />
                      </DialogBody>
                    </SettingsProvider>
                  </ModalRoot>
                ));
              }}
            >
              {t('LABEL_SETTINGS_ASSET_TABS', 'Asset Tab Settings')}
            </DialogButton>
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t('LABEL_SETTINGS_DISABLE_MOTD', 'Disable Announcements')}
            description={t('LABEL_SETTINGS_DISABLE_MOTD_DESC', 'Announcements are used sparingly to display important information or community events.')}
            checked={motdToggle}
            onChange={handleMotdToggle}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title={t('LABEL_BULK_TITLE', 'Bulk artwork for shortcuts')}>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', padding: '4px 0' }}>
            {t('LABEL_BULK_DESC', 'Fills capsule, wide capsule, hero and logo for non-Steam shortcuts without custom artwork, using the matching Steam app. Games without a confident match are skipped.')}
          </div>
        </PanelSectionRow>
        {bulkProgress ? (
          <PanelSectionRow>
            <div style={{ fontSize: '12px', padding: '4px 0' }}>
              {t('MSG_BULK_PROGRESS', '{done}/{total}: applied {applied}, skipped {skipped}, failed {failed}')
                .replace('{done}', String(bulkProgress.done))
                .replace('{total}', String(bulkProgress.total))
                .replace('{applied}', String(bulkProgress.applied))
                .replace('{skipped}', String(bulkProgress.skipped))
                .replace('{failed}', String(bulkProgress.failed))}
            </div>
          </PanelSectionRow>
        ) : null}
        {bulkRunning ? (
          <PanelSectionRow>
            <DialogButton onClick={() => { bulkCancel.current = true; }}>
              {t('ACTION_BULK_CANCEL', 'Stop')}
            </DialogButton>
          </PanelSectionRow>
        ) : bulkConfirm ? (
          <>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', padding: '4px 0' }}>
                {t('MSG_BULK_CONFIRM', 'Apply Steam artwork to every non-Steam shortcut without custom artwork? Library artwork will change.')}
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <DialogButton onClick={handleBulkApply}>{t('ACTION_BULK_CONFIRM', 'Apply')}</DialogButton>
              <DialogButton onClick={() => setBulkConfirm(false)}>{t('ACTION_CANCEL', 'Cancel')}</DialogButton>
            </PanelSectionRow>
          </>
        ) : (
          <PanelSectionRow>
            <DialogButton onClick={() => setBulkConfirm(true)}>
              {t('ACTION_BULK_APPLY', 'Fill shortcut artwork')}
            </DialogButton>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title={t('LABEL_HEALTH_TITLE', 'Source Status')}>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', padding: '4px 0' }}>
            {t('LABEL_HEALTH_DESC', 'Ping every artwork source and show which ones answer right now.')}
          </div>
        </PanelSectionRow>
        {health
          ? Object.entries(health).map(([source, value]) => (
            <PanelSectionRow key={source}>
              <div className="source-health-row">
                <span>{HEALTH_NAMES[source] || source}</span>
                <span className={value.ok ? 'ok' : 'fail'}>
                  {value.ok ? `${value.ms} ms` : (value.error || 'error')}
                </span>
              </div>
            </PanelSectionRow>
          ))
          : null}
        <PanelSectionRow>
          <DialogButton onClick={handleHealthCheck} disabled={healthLoading}>
            {healthLoading ? t('LABEL_HEALTH_CHECKING', 'Checking...') : t('ACTION_HEALTH_CHECK', 'Check sources')}
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t('LABEL_BACKUP_TITLE', 'Settings backup')}>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', padding: '4px 0' }}>
            {t('LABEL_BACKUP_DESC', 'Save per-game mappings and settings to ~/gameartwork-backup, or restore the latest backup.')}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton onClick={handleExportSettings}>
            {t('ACTION_EXPORT_SETTINGS', 'Save backup')}
          </DialogButton>
        </PanelSectionRow>
        {importConfirm ? (
          <>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', padding: '4px 0' }}>
                {t('MSG_IMPORT_CONFIRM', 'Restore the latest backup? Current per-game mappings and settings will be replaced.')}
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <DialogButton onClick={handleImportSettings}>{t('ACTION_IMPORT_CONFIRM', 'Restore')}</DialogButton>
              <DialogButton onClick={() => setImportConfirm(false)}>{t('ACTION_CANCEL', 'Cancel')}</DialogButton>
            </PanelSectionRow>
          </>
        ) : (
          <PanelSectionRow>
            <DialogButton onClick={() => setImportConfirm(true)}>
              {t('ACTION_IMPORT_SETTINGS', 'Restore backup')}
            </DialogButton>
          </PanelSectionRow>
        )}
        {backupMessage ? (
          <PanelSectionRow>
            <div style={{ fontSize: '12px', padding: '4px 0', opacity: 0.7 }}>{backupMessage}</div>
          </PanelSectionRow>
        ) : null}
      </PanelSection>
      {/* Uncomment this out should there be a need for experiments again. */}
      {/* <PanelSection title="Experiments">
        <div style={{ fontSize: '12px', padding: '12px 0px' }}>Features with little testing that may be too unstable for regular usage and might be removed later. (Requires restart)</div>

      </PanelSection> */}
    </>
  );
};

export default QuickAccessSettings;