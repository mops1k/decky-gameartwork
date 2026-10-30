import { VFC } from 'react';
import { SiEpicgames, SiIgdb, SiSteam } from 'react-icons/si';

import { ExternalSource } from '../utils/providers';

import GogIcon from './Icons/GogIcon';

const SgdbGlyph: VFC<{ size?: string }> = ({ size = '1em' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={size} height={size} fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1" />
    <rect x="9" y="1" width="6" height="6" rx="1" />
    <rect x="1" y="9" width="6" height="6" rx="1" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
);

const VndbGlyph: VFC<{ size?: string }> = ({ size = '1em' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={size} height={size}>
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <text x="8" y="11.4" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">V</text>
  </svg>
);

const SourceIcon: VFC<{ source: ExternalSource | 'sgdb'; size?: string }> = ({ source, size }) => {
  switch (source) {
  case 'steam':
    return <SiSteam size={size} />;
  case 'epic':
    return <SiEpicgames size={size} />;
  case 'gog':
    return <GogIcon />;
  case 'igdb':
    return <SiIgdb size={size} />;
  case 'vndb':
    return <VndbGlyph size={size} />;
  default:
    return <SgdbGlyph size={size} />;
  }
};

export default SourceIcon;
