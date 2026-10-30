import { FC } from 'react';
import { Focusable, FocusableProps, FooterLegendProps, joinClassNames } from '@decky/ui';

import t from '../../utils/i18n';
import Spinner from '../../../assets/spinner.svg';
import Chips from '../Chips';
import Chip from '../Chips/Chip';
import AdaptiveNavGlyph from '../AdaptiveNavGlyph';

import { LazyImage } from './LazyImage';

export interface AssetProps extends FooterLegendProps, Omit<FocusableProps, 'children'> {
  assetType: SGDBAssetType;
  width: number;
  height: number;
  src: string;
  author?: any;
  isAnimated: boolean;
  isDownloading?: boolean;
  onActivate?: FocusableProps['onActivate'];
  scrollContainer?: Element;
  notes?: string;
  sourceName?: string;
  /** Shown under the tile when the source has no author (store artwork). */
  caption?: string;
  nsfw?: boolean;
  humor?: boolean;
  epilepsy?: boolean;
  applied?: boolean;
  onImgError?: React.ReactEventHandler<HTMLImageElement>;
}

const Asset: FC<AssetProps> = ({
  assetType,
  width,
  height,
  src,
  author,
  isAnimated,
  onActivate,
  isDownloading = false,
  scrollContainer,
  notes = null,
  sourceName,
  caption,
  nsfw,
  humor,
  epilepsy,
  applied,
  onImgError,
  ...rest
}) => (
  <div className="asset-box-wrap">
    <Focusable
      onActivate={onActivate}
      className={joinClassNames('image-wrap', `type-${assetType}`)}
      style={{ paddingBottom: `${(width === height) ? 100 : (height / width * 100)}%` }}
      {...rest}
    >
      <div className={joinClassNames('dload-overlay', isDownloading ? 'downloading' : '')}><img src={Spinner} /></div>
      <Chips>
        {applied ? (
          <Chip color="#2f9e44">{t('LABEL_APPLIED', 'Applied')}</Chip>
        ) : null}
        {sourceName ? (
          <Chip color="#4e9ac6">{sourceName}</Chip>
        ) : null}
        {notes ? (
          <Chip color="#8a8a8a">
            <AdaptiveNavGlyph button={11} bAllowKeyboard /> {t('LABEL_NOTES', 'Notes')}
          </Chip>
        ) : null}
        {isAnimated ? (
          <Chip color="#e2a256">
            {t('LABEL_ANIMATED', 'Animated')}
          </Chip>
        ) : null}
        {nsfw ? (
          <Chip color="#e5344c">
            {t('LABEL_NSFW', 'Adult Content')}
          </Chip>
        ) : null}
        {humor ? (
          <Chip color="#eec314" colorText="#434343">
            {t('LABEL_HUMOR', 'Humor')}
          </Chip>
        ) : null}
        {epilepsy ? (
          <Chip color="#735f9f">
            {t('LABEL_EPILEPSY', 'Epilepsy')}
          </Chip>
        ) : null}
      </Chips>
      <LazyImage
        src={src}
        isVideo={isAnimated}
        scrollContainer={scrollContainer}
        wrapperProps={{
          className: 'thumb',
        }}
        marginOffset="100px"
        unloadWhenOutside
        blurBackground
        onError={onImgError}
      />
    </Focusable>
    {/* Every tile keeps the caption row, otherwise store artwork without an
        author makes the grid rows uneven. */}
    <div className="author">
      {author ? (
        <>
          <LazyImage src={author.avatar} alt="" />
          <span>{author.name}</span>
        </>
      ) : caption ? (
        <span>{caption}</span>
      ) : null}
    </div>
  </div>
);

export default Asset;