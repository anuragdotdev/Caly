import type { TodoItem } from '../types';

/**
 * The hour at which a new "day" begins for the todo list.
 *
 * Completed tasks are cleared once the clock passes this hour, so the daily
 * list starts clean each morning while still allowing late-night work to
 * count towards the day that is ending.
 */
export const RESET_HOUR = 3;

/** The most recent 03:00 local boundary at or before `now`. */
export function lastResetBoundary(now: Date = new Date()): Date {
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), RESET_HOUR);
  if (now.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return boundary;
}

/** The next 03:00 local boundary strictly after `now`. */
export function nextResetBoundary(now: Date = new Date()): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), RESET_HOUR);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * True when a completed task was completed before the given boundary and
 * should therefore be cleared.
 *
 * A completed task with no `completedAt` (only possible from hand-edited or
 * imported data) counts as stale, since there is no evidence it belongs to
 * the current cycle.
 */
export function isStaleCompletion(task: TodoItem, boundary: Date): boolean {
  if (!task.completed) return false;
  if (!task.completedAt) return true;
  const completed = Date.parse(task.completedAt);
  if (Number.isNaN(completed)) return true;
  return completed < boundary.getTime();
}

/** The completed tasks that should be cleared at the given boundary. */
export function staleCompletions(
  tasks: TodoItem[],
  boundary: Date = lastResetBoundary(),
): TodoItem[] {
  return tasks.filter((task) => isStaleCompletion(task, boundary));
}
