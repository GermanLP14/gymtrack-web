import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { onRemoteChange } from '@/lib/sync';

/**
 * Loads data every time the screen gains focus (and whenever `load` changes),
 * so edits made on other screens show up when returning.
 * `load` must be memoized with `useCallback`.
 */
export function useFocusData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const v = ++version.current;
    try {
      const result = await load();
      if (v === version.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (v === version.current) setError(e as Error);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      // Also refresh when a sync brings in changes from another device.
      return onRemoteChange(() => void reload());
    }, [reload]),
  );

  return { data, error, reload };
}
