import type { TodoItem } from '../types';

/** Move one task relative to another without disturbing the other tasks. */
export function reorderTasks(
  tasks: TodoItem[],
  sourceId: string,
  targetId: string,
  placement: 'before' | 'after',
): TodoItem[] {
  const source = tasks.find((task) => task.id === sourceId);
  const target = tasks.find((task) => task.id === targetId);
  if (!source || !target || sourceId === targetId || source.completed !== target.completed) {
    return tasks;
  }

  const next = tasks.filter((task) => task.id !== sourceId);
  const targetIndex = next.findIndex((task) => task.id === targetId);
  next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
  return next;
}

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
