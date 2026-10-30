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
import { FileSelectionType, openFilePicker } from '@decky/api';
import { useState, useEffect, VFC, useCallback } from 'react';

import t, { getCredits } from '../../utils/i18n';
import TabSorter from '../TabSorter';
import useSettings, { SettingsProvider } from '../../hooks/useSettings';
import { addHomePatch, removeHomePatch } from '../../patches/homePatch';
import { addSquareLibraryPatch, removeSquareLibraryPatch } from '../../patches/squareLibraryPatch';
import { addCapsuleGlowPatch } from '../../patches/capsuleGlowPatch';
import { DIMENSIONS } from '../../constants';
import { appgridClasses } from '../../static-classes';
import { ALL_SOURCES, ExternalSource, SOURCE_NAMES, invalidateEnabledSources } from '../../utils/providers';

import GuideVideoField from './GuideVideoField';
import UpdateSection from './UpdateSection';

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
      {/* Uncomment this out should there be a need for experiments again. */}
      {/* <PanelSection title="Experiments">
        <div style={{ fontSize: '12px', padding: '12px 0px' }}>Features with little testing that may be too unstable for regular usage and might be removed later. (Requires restart)</div>

      </PanelSection> */}
      {getCredits() && (
        <PanelSection title={t('LABEL_TRANSLATION_CREDIT_TITLE', 'English Translation')}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '.25em',
          }}
          >
            {getCredits().map((person: any) => <span key={person}>{person}</span>)}
          </div>
        </PanelSection>
      )}
    </>
  );
};

export default QuickAccessSettings;