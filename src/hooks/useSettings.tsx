import {
  createContext,
  FC,
  ReactNode,
  useEffect,
  useContext,
  useMemo,
  useRef,
} from 'react';
import { call } from '@decky/api';

import log from '../utils/log';

export const SettingsContext = createContext({});

type SettingsContextType = {
  set: (key: any, value: any, immediate?: boolean) => void;
  get: (key: any, fallback: any) => Promise<any>;
};

const WRITE_DELAY = 300;

export const SettingsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Writes are queued per key: one timer for every key would let a second
  // set() within the delay cancel the first one and lose that change.
  const pending = useRef<Map<any, any>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useMemo(() => async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const batch = Array.from(pending.current.entries());
    pending.current.clear();
    if (!batch.length) return;
    log('writing settings', batch);
    try {
      await Promise.all(batch.map(([key, value]) => call('set_setting', key, value)));
    } catch (err) {
      log('setting write failed', err);
    }
  }, []);

  const set = useMemo(() => (key, value, immediate = false) => {
    if (immediate) {
      // An immediate write must not leave a queued value behind.
      pending.current.delete(key);
      call('set_setting', key, value).catch((err) => log('setting write failed', key, err));
      return;
    }
    pending.current.set(key, value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, WRITE_DELAY);
  }, [flush]) as SettingsContextType['set'];

  const get: SettingsContextType['get'] = useMemo(() => async (key, fallback) => {
    return await call('get_setting', key, fallback);
  }, []);

  useEffect(() => () => {
    // Whatever the user changed last must not be lost when the menu closes.
    flush();
  }, [flush]);

  return (
    <SettingsContext.Provider value={{ set, get }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext) as SettingsContextType;

export default useSettings;
