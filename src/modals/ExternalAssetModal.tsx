import { FC, useEffect, useMemo, useState } from 'react';
import {
  DialogButton,
  DialogButtonPrimary,
  joinClassNames,
  ModalRoot,
} from '@decky/ui';

import Asset from '../components/asset/Asset';
import t from '../utils/i18n';
import { SGDB_ASSET_TYPE_READABLE } from '../constants';
import { ExternalAsset, getSourceBundle } from '../utils/providers';

/**
 * Details for a tile that comes from a store instead of SteamGridDB. Apart from
 * applying the single asset it can apply every artwork of that store at once.
 */
const ExternalAssetModal: FC<{
  closeModal?: () => void;
  asset: ExternalAsset;
  assetType: SGDBAssetType;
  term: string;
  /** SteamGridDB title: the cross-search falls back to it for renamed games. */
  fallbackTerm?: string;
  onApply: (asset: ExternalAsset) => Promise<void>;
  onApplyBundle: (items: ExternalAsset[]) => Promise<void>;
  /** The store matched the wrong game: reopen the picker. */
  onPickGame?: () => void;
}> = ({ closeModal, asset, assetType, term, fallbackTerm, onApply, onApplyBundle, onPickGame }) => {
  const [bundle, setBundle] = useState<ExternalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let alive = true;
    getSourceBundle(term, asset.source, asset.name, fallbackTerm)
      .then((items) => {
        if (alive) setBundle(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [asset.name, asset.source, term, fallbackTerm]);

  const bundleKinds = useMemo(
    () => bundle.map((item) => SGDB_ASSET_TYPE_READABLE[item.kind]).join(', '),
    [bundle]
  );

  const applyLabel = t('ACTION_ASSET_APPLY', 'Apply {assetType}').replace('{assetType}', SGDB_ASSET_TYPE_READABLE[assetType]);

  const handleApply = async () => {
    setApplying(true);
    await onApply(asset);
    setApplying(false);
    closeModal?.();
  };

  const handleApplyBundle = async () => {
    setApplying(true);
    await onApplyBundle(bundle);
    setApplying(false);
    closeModal?.();
  };

  const handlePickGame = () => {
    closeModal?.();
    onPickGame?.();
  };

  return (
    <ModalRoot className="sgdb-modal sgdb-modal-details" closeModal={closeModal}>
      <div className={joinClassNames('sgdb-modal-details-wrapper', asset.width > asset.height ? 'wide' : '')}>
        <Asset
          src={asset.url}
          width={asset.width}
          height={asset.height}
          assetType={assetType}
          isAnimated={false}
          isDownloading={applying}
        />
        <div className="info">
          <DialogButtonPrimary onClick={handleApply}>
            {applyLabel}
          </DialogButtonPrimary>
          <span className="meta">
            {[
              asset.sourceName,
              asset.name,
              asset.width > 0 ? `${asset.width}×${asset.height}` : undefined,
            ].filter(Boolean).join(' • ')}
          </span>
          {loading ? (
            <span className="meta">{t('LABEL_SEARCHING', 'Searching...')}</span>
          ) : bundle.length > 1 ? (
            <>
              <DialogButton style={{ marginTop: '1em' }} onClick={handleApplyBundle}>
                {t('ACTION_APPLY_BUNDLE', 'Apply all from {source}').replace('{source}', asset.sourceName)}
              </DialogButton>
              <span className="meta">{bundleKinds}</span>
            </>
          ) : null}
          {onPickGame ? (
            <DialogButton style={{ marginTop: '1em' }} onClick={handlePickGame}>
              {t('ACTION_PICK_OTHER_GAME', 'Wrong game? Pick another...')}
            </DialogButton>
          ) : null}
        </div>
      </div>
    </ModalRoot>
  );
};

export default ExternalAssetModal;
