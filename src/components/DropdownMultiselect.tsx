import {
  showContextMenu,
  DialogButton,
  Menu,
  MenuItem,
  DialogCheckbox,
  DialogCheckboxProps,
  Marquee,
} from '@decky/ui';
import { FC, useState, useEffect, useCallback, ReactNode } from 'react';

import Chevron from '../components/Chevron';
import t from '../utils/i18n';

const DropdownMultiselectItem: FC<{
  value: any,
  onSelect: (checked: boolean, value: any) => void,
  checked: boolean
} & DialogCheckboxProps> = ({
  value,
  onSelect,
  checked: defaultChecked,
  ...rest
}) => {
  const [checked, setChecked] = useState(defaultChecked);

  useEffect(() => {
    onSelect?.(checked, value);
  }, [checked, onSelect, value]);

  return (
    <MenuItem
      bInteractableItem
      onClick={() => setChecked((x) => !x)}
    >
      <DialogCheckbox
        style={{ marginBottom: 0, padding: 0 }}
        className="decky_DropdownMultiselectItem_DialogCheckbox"
        bottomSeparator="none"
        {...rest}
        onClick={() => setChecked((x) => !x)}
        onChange={(checked) => setChecked(checked)}
        controlled
        checked={checked}
      />
    </MenuItem>
  );
};

const DropdownMultiselect: FC<{
  items: {
    label: string,
    value: any,
  }[],
  selected: any[],
  onSelect: (selected: any[]) => void,
  label: string
}> = ({
  label,
  items,
  selected,
  onSelect,
}) => {
  const [itemsSelected, setItemsSelected] = useState<any>(selected);

  // "Reset Filters" swaps the selected values from the outside: the menu has
  // to follow, otherwise its checkboxes keep the previous choice.
  useEffect(() => {
    setItemsSelected(selected);
  }, [selected]);

  const handleItemSelect = useCallback((checked: boolean, value: string | ReactNode) => {
    setItemsSelected((x: any) => (checked ?
      [...x.filter((y: any) => y !== value), value] :
      x.filter((y: any) => y !== value)
    ));
  }, []);

  useEffect(() => {
    onSelect(itemsSelected);
  }, [itemsSelected, onSelect]);

  return (
    <DialogButton
      style={{
        display: 'flex',
        alignItems: 'center',
        maxWidth: '100%',
      }}
      onClick={(evt) => {
        evt.preventDefault();
        showContextMenu(
          <Menu
            label={label}
            cancelText={t('Button_Back', 'Back', true)}
          >
            <style>
              {`
              /*
                Hacks:
                  Allow clicking through so cursor hits contextMenuItem instead
                  Inherit color from ".basiccontextmenu"
              */
              .decky_DropdownMultiselectItem_DialogCheckbox {
                pointer-events: none;
              }
              .decky_DropdownMultiselectItem_DialogCheckbox > .DialogToggle_Label {
                color: inherit;
              }
              `}
            </style>
            {items.map((x) => (
              <DropdownMultiselectItem
                key={x.value}
                label={x.label}
                value={x.value}
                checked={itemsSelected.includes(x.value)}
                onSelect={handleItemSelect}
              />
            ))}
          </Menu>,
          evt.currentTarget ?? window
        );
      }}
    >
      <Marquee>
        {
          selected.length > 0 ?
            // A stored filter may name a value this version no longer offers
            // (or a backup restored an old one): show the raw value instead of
            // crashing on items[-1].
            selected.map((x: any) => items.find((v) => v.value === x)?.label ?? x).join(', ') :
            '…'
        }
      </Marquee>
      <div style={{ flexGrow: 1, minWidth: '1ch' }} />
      <Chevron style={{ height: '1em', flex: '0 0 1em' }} direction="down" />
    </DialogButton>
  );
};

export default DropdownMultiselect;
