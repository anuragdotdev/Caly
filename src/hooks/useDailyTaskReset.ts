import { useEffect } from 'react';
import { nextResetBoundary } from '../services/tasks';

/**
 * Clears completed tasks once the clock passes 03:00 local time.
 *
 * The sweep runs on mount — which catches up when the tab is opened after
 * the boundary, or after the browser was closed overnight — and is scheduled
 * for the next boundary so a tab left open across the night resets itself.
 */
export function useDailyTaskReset(clearCompletedTasks: () => Promise<unknown>): void {
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const schedule = () => {
      const delay = nextResetBoundary().getTime() - Date.now();
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await clearCompletedTasks();
        if (!cancelled) schedule();
      }, delay);
    };

    void clearCompletedTasks();
    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [clearCompletedTasks]);
}
