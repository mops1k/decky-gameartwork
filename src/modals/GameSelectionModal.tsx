import {
  DialogBody,
  ModalRoot,
  DialogControlsSection,
  Field,
  DialogButton,
  TextField,
  TextFieldProps,
  Focusable,
  IconsModule,
  Spinner,
  joinClassNames,
} from '@decky/ui';
import {
  FC,
  useMemo,
  useState,
  useEffect,
  useRef,
} from 'react';
import debounce from 'just-debounce';

import t from '../utils/i18n';
import { ExternalSource, ExternalTitle, SOURCE_NAMES, searchExternalTitles } from '../utils/providers';
import { scoreMatch } from '../utils/matchGame';
import SourceIcon from '../components/SourceIcon';

const SearchTextField: FC<TextFieldProps> = (props) => {
  const fieldRef = useRef<any>();
  const focusableRef = useRef<any>();

  const focusTextField = () => {
    const input = fieldRef.current?.m_elInput;
    input?.focus();
    input?.click();
  };

  // Activate <Focusable /> when pressing back on text box
  useEffect(() => {
    if (!fieldRef.current) return;
    const onCancel = (evt: GamepadEvent) => {
      evt.stopPropagation(); // stop bubbling or else modal will close
      focusableRef.current?.focus();
    };

    const input = fieldRef.current?.m_elInput;
    input.addEventListener('vgp_oncancel', onCancel);
    input.addEventListener('vgp_onok', onCancel);
    return () => {
      input.removeEventListener('vgp_oncancel', onCancel);
      input.removeEventListener('vgp_onok', onCancel);
    };
  }, [fieldRef]);

  return (
    <Field
      bottomSeparator="thick"
      icon={<IconsModule.Search />}
      label={t('LABEL_GAME_SEARCH_TITLE', 'Search for a Game...')}
      childrenLayout="below"
    >
      <Focusable ref={focusableRef} onActivate={focusTextField} noFocusRing>
        <TextField
        // @ts-ignore: ref hack to get underlying <input>
          ref={fieldRef}
          focusOnMount={false}
          spellcheck="false"
          {...props}
        />
      </Focusable>
    </Field>
  );
};

const GameSelectionModal: FC<{
  closeModal?: () => void,
  onSelect: (game: any) => void,
  onSelectExternal?: (name: string) => void,
  searchGames: (term: string) => Promise<any[]>,
  defaultTerm: string,
}> = ({ closeModal, onSelect, onSelectExternal, searchGames, defaultTerm }) => {
  const [value, setValue] = useState(defaultTerm);
  const [games, setGames] = useState<any[]>([]);
  const [externals, setExternals] = useState<ExternalTitle[]>([]);
  const [loading, setLoading] = useState(false);

  type PickerItem = {
    key: string;
    name: string;
    source: 'sgdb' | ExternalSource;
    game?: any;
    score: number;
  };

  // One list for every source: SGDB and the keyless stores are ranked by how
  // well the title matches, and each row carries a source chip on the right.
  const pickerItems = useMemo<PickerItem[]>(() => {
    const items: PickerItem[] = [];
    const seen = new Set<string>();
    const push = (item: PickerItem) => {
      const key = item.name.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    for (const game of games) {
      push({
        key: `sgdb:${game.id}`,
        name: game.name || '',
        source: 'sgdb',
        game,
        score: scoreMatch(value, game.name || ''),
      });
    }
    if (onSelectExternal) {
      for (const title of externals) {
        push({
          key: `${title.source}:${title.name}`,
          name: title.name,
          source: title.source,
          score: scoreMatch(value, title.name),
        });
      }
    }
    return items.sort((a, b) => b.score - a.score);
  }, [games, externals, value, onSelectExternal]);

  const handleItemSelect = (item: PickerItem) => {
    if (item.source === 'sgdb') {
      onSelect?.(item.game);
    } else {
      onSelectExternal?.(item.name);
    }
    closeModal?.();
  };

  const searchSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const handleSearch = useMemo(() => debounce(async (term) => {
    const requestId = ++searchSeq.current;
    const alive = () => mounted.current && searchSeq.current === requestId;
    if (!term) {
      // Clearing the field has to clear the results of the previous term.
      if (alive()) {
        setGames([]);
        setExternals([]);
        setLoading(false);
      }
      return;
    }
    const [resp, externalTitles] = await Promise.all([
      searchGames(term),
      onSelectExternal ? searchExternalTitles(term) : Promise.resolve([] as ExternalTitle[]),
    ]);
    // A slower answer for an older term must not replace the current list.
    if (!alive()) return;
    setGames(resp);
    const seen = new Set<string>();
    setExternals(externalTitles.filter((item) => {
      if (!item.name || seen.has(item.name.toLowerCase())) return false;
      seen.add(item.name.toLowerCase());
      return true;
    }));
    setLoading(false);
  }, 600), [searchGames, onSelectExternal]);

  useEffect(() => {
    setLoading(true);
    handleSearch(value);
  }, [handleSearch, value]);

  useEffect(() => () => {
    // The debounced search may still be queued when the modal closes.
    searchSeq.current += 1;
  }, []);

  return (
    <ModalRoot className="sgdb-modal sgdb-modal-gameselect" closeModal={closeModal}>
      <DialogBody>
        <DialogControlsSection>
          <SearchTextField
            value={value}
            onChange={(evt) => {
              setValue(evt.target.value);
            }}
          />
          {loading && (
            <div className="spinner">
              <Spinner />
            </div>
          )}
          {!loading && pickerItems.map((item) => (
            <Field
              key={item.key}
              bottomSeparator="none"
              icon={null}
              label={null}
              childrenLayout="below"
              inlineWrap="keep-inline"
              spacingBetweenLabelAndChild="none"
              childrenContainerWidth="max"
            >
              <DialogButton style={{ display: 'block', width: '100%' }} onClick={() => handleItemSelect(item)}>
                <span className="gameselect-row">
                  <span className="gameselect-name">{item.name}</span>
                  <span
                    className={joinClassNames('gameselect-chip', `source-${item.source}`)}
                    title={item.source === 'sgdb' ? 'SteamGridDB' : SOURCE_NAMES[item.source as ExternalSource]}
                  >
                    <SourceIcon source={item.source} />
                  </span>
                </span>
              </DialogButton>
            </Field>
          ))}
          {!loading && pickerItems.length === 0 && (
            <div className="gameselect-empty">{t('Search_NoResults', 'No Results Found.', true)}</div>
          )}
        </DialogControlsSection>
      </DialogBody>
    </ModalRoot>
  );
};

export default GameSelectionModal;
