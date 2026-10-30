import { FC } from 'react';
import { Focusable, joinClassNames } from '@decky/ui';

import t from '../utils/i18n';
import { ALL_SOURCES, ExternalSource, SOURCE_NAMES, SourceState } from '../utils/providers';

export type SourceFilter = 'all' | 'sgdb' | ExternalSource;

const SourceFilterBar: FC<{
  value: SourceFilter;
  onChange: (value: SourceFilter) => void;
  sources: Partial<Record<ExternalSource, SourceState>>;
  counts: Partial<Record<SourceFilter, number>>;
}> = ({ value, onChange, sources, counts }) => {
  const entries: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: t('LABEL_SOURCE_ALL', 'All') },
    { key: 'sgdb', label: 'SteamGridDB' },
  ];
  for (const source of ALL_SOURCES) {
    // Only offer a source that is enabled and actually returned artwork.
    if (!sources[source] || !counts[source]) continue;
    entries.push({ key: source, label: SOURCE_NAMES[source] });
  }
  if (entries.length <= 2) {
    return null;
  }

  return (
    <Focusable flow-children="right" className="source-filter-bar">
      {entries.map((entry) => (
        <Focusable
          key={entry.key}
          onActivate={() => onChange(entry.key)}
          className={joinClassNames('source-filter-chip', entry.key === value ? 'active' : '')}
        >
          {entry.label}
          {typeof counts[entry.key] === 'number' ? <span className="count">{counts[entry.key]}</span> : null}
        </Focusable>
      ))}
    </Focusable>
  );
};

export default SourceFilterBar;
