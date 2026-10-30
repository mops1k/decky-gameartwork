import {
  DialogBody,
  DialogButton,
  DialogHeader,
  Field,
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  showModal,
} from '@decky/ui';
import { FC } from 'react';
import { FaDownload, FaSyncAlt } from 'react-icons/fa';

import Markdown from '../Markdown';
import t from '../../utils/i18n';
import useUpdateChecker from '../../hooks/useUpdateChecker';

const formatSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

/**
 * Self-update entry point: the backend checks the GitHub release, the loader
 * installs it. Both happen without leaving Game Mode.
 */
const UpdateSection: FC<{ pluginName: string }> = ({ pluginName }) => {
  const { info, checking, installing, check, install } = useUpdateChecker(pluginName);

  if (!info) return null;

  const current = info.current || '?';
  const latest = info.latest || current;
  const size = formatSize(info.size);

  const showNotes = () => {
    showModal(
      <ModalRoot>
        <DialogHeader>
          {t('LABEL_UPDATE_WHATS_NEW', 'What\'s new in v{version}').replace('{version}', latest)}
        </DialogHeader>
        <DialogBody>
          <Markdown>{info.notes || t('MSG_UPDATE_NO_NOTES', 'This release has no notes.')}</Markdown>
        </DialogBody>
      </ModalRoot>
    );
  };

  const statusDescription = info.available
    ? [t('LABEL_UPDATE_INSTALLED', 'Installed v{version}').replace('{version}', current), size]
      .filter(Boolean)
      .join(' · ')
    : info.error
      ? info.error
      : t('LABEL_UPDATE_UP_TO_DATE', 'You are on the latest release.');

  const primaryAction = info.available
    ? (
      <DialogButton disabled={installing} onClick={install}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <FaDownload />
          {t('ACTION_UPDATE_INSTALL', 'Update to v{version}').replace('{version}', latest)}
        </span>
      </DialogButton>
    )
    : (
      <DialogButton disabled={checking} onClick={() => check(true)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <FaSyncAlt />
          {checking
            ? t('ACTION_UPDATE_CHECKING', 'Checking...')
            : t('ACTION_UPDATE_CHECK', 'Check for updates')}
        </span>
      </DialogButton>
    );

  return (
    <PanelSection title={t('LABEL_UPDATE_TITLE', 'Plugin Update')}>
      <PanelSectionRow>
        <Field
          label={t('LABEL_UPDATE_SECTION', 'GameArtwork v{version}').replace('{version}', current)}
          description={statusDescription}
          childrenLayout="below"
          bottomSeparator="none"
        >
          <div style={{ display: 'flex', gap: '0.5em' }}>
            {primaryAction}
            {info.available && info.notes && (
              <DialogButton onClick={showNotes}>
                {t('ACTION_UPDATE_WHATS_NEW', 'Release notes')}
              </DialogButton>
            )}
          </div>
        </Field>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default UpdateSection;
