import { useCallback, useState } from "react";

/**
 * Undo/redo for edit settings. `set(next)` changes the live value (e.g. while
 * dragging a slider); `set(next, true)` also records an undo step.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState(() => ({ past: [] as T[], committed: initial, present: initial, future: [] as T[] }));

  const set = useCallback((next: T | ((current: T) => T), commit = false) => {
    setState((s) => {
      const value = typeof next === "function" ? (next as (current: T) => T)(s.present) : next;
      if (!commit) return { ...s, present: value };
      if (Object.is(value, s.committed) || JSON.stringify(value) === JSON.stringify(s.committed)) {
        return { ...s, present: value, committed: value };
      }
      return { past: [...s.past, s.committed].slice(-60), committed: value, present: value, future: [] };
    });
  }, []);

  /** Records whatever the live value is now (call when a drag ends). */
  const commit = useCallback(() => {
    setState((s) => {
      if (JSON.stringify(s.present) === JSON.stringify(s.committed)) return s;
      return { past: [...s.past, s.committed].slice(-60), committed: s.present, present: s.present, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      // Uncommitted live change: undo goes back to the last committed value first.
      if (JSON.stringify(s.present) !== JSON.stringify(s.committed)) return { ...s, present: s.committed };
      if (!s.past.length) return s;
      const previous = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), committed: previous, present: previous, future: [s.committed, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return { past: [...s.past, s.committed], committed: next, present: next, future: rest };
    });
  }, []);

  const reset = useCallback((value: T) => {
    setState({ past: [], committed: value, present: value, future: [] });
  }, []);

  return {
    value: state.present,
    set,
    commit,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0 || JSON.stringify(state.present) !== JSON.stringify(state.committed),
    canRedo: state.future.length > 0,
  };
}
