import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * useState whose value is loaded once from a persistence getter and written back
 * via a setter whenever it changes. Collapses the repeated
 *   const [x, setX] = useState(() => getX());
 *   useEffect(() => { persistX(x); }, [x]);
 * pattern into a single declaration.
 *
 * `load` runs once (state initializer). `persist` runs on every change, AND on
 * mount — writing the loaded value straight back is an idempotent no-op, matching
 * the behaviour of the hand-written effects this replaces. `persist` is expected
 * to be a stable module-level function; it's listed as a dep so a changed
 * identity re-persists the current value (harmless) rather than going stale.
 */
export function usePersistedState<T>(
  load: () => T,
  persist: (value: T) => void
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(load);
  useEffect(() => {
    persist(value);
  }, [value, persist]);
  return [value, setValue];
}
