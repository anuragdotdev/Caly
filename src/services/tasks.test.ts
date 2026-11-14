import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../types';
import {
  RESET_HOUR,
  isStaleCompletion,
  lastResetBoundary,
  nextResetBoundary,
  staleCompletions,
} from './tasks';

function task(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't1',
    title: 'Task',
    completed: false,
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('lastResetBoundary', () => {
  it('is today at 03:00 once the hour has passed', () => {
    const boundary = lastResetBoundary(new Date(2026, 10, 14, 9, 30));
    expect(boundary.getFullYear()).toBe(2026);
    expect(boundary.getMonth()).toBe(10);
    expect(boundary.getDate()).toBe(14);
    expect(boundary.getHours()).toBe(RESET_HOUR);
  });

  it('is yesterday at 03:00 before the hour', () => {
    const boundary = lastResetBoundary(new Date(2026, 10, 14, 1, 30));
    expect(boundary.getDate()).toBe(13);
    expect(boundary.getHours()).toBe(RESET_HOUR);
  });

  it('is today at 03:00 exactly on the boundary', () => {
    const boundary = lastResetBoundary(new Date(2026, 10, 14, 3, 0, 0));
    expect(boundary.getDate()).toBe(14);
    expect(boundary.getHours()).toBe(RESET_HOUR);
  });

  it('crosses a month boundary', () => {
    const boundary = lastResetBoundary(new Date(2026, 0, 1, 2, 0));
    expect(boundary.getFullYear()).toBe(2025);
    expect(boundary.getMonth()).toBe(11);
    expect(boundary.getDate()).toBe(31);
  });

  it('crosses a year boundary', () => {
    const boundary = lastResetBoundary(new Date(2026, 0, 1, 2, 0));
    expect(boundary.getFullYear()).toBe(2025);
    expect(boundary.getMonth()).toBe(11);
    expect(boundary.getDate()).toBe(31);
  });

  it('uses the current day once the hour has passed', () => {
    const boundary = lastResetBoundary(new Date(2026, 0, 1, 4, 0));
    expect(boundary.getFullYear()).toBe(2026);
    expect(boundary.getMonth()).toBe(0);
    expect(boundary.getDate()).toBe(1);
  });
});

describe('nextResetBoundary', () => {
  it('is today at 03:00 when the hour has not passed', () => {
    const next = nextResetBoundary(new Date(2026, 10, 14, 1, 30));
    expect(next.getDate()).toBe(14);
    expect(next.getHours()).toBe(RESET_HOUR);
  });

  it('is tomorrow at 03:00 once the hour has passed', () => {
    const next = nextResetBoundary(new Date(2026, 10, 14, 9, 30));
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(RESET_HOUR);
  });

  it('is the next day when exactly on the boundary', () => {
    const next = nextResetBoundary(new Date(2026, 10, 14, 3, 0, 0));
    expect(next.getDate()).toBe(15);
  });

  it('crosses a year boundary', () => {
    const next = nextResetBoundary(new Date(2025, 11, 31, 10, 0));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it('is always in the future', () => {
    const now = new Date(2026, 10, 14, 9, 30);
    expect(nextResetBoundary(now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('isStaleCompletion', () => {
  // Boundaries and timestamps are built from local dates so the tests hold
  // in any timezone.
  const boundary = new Date(2026, 10, 14, 3, 0, 0);

  it('ignores unfinished tasks', () => {
    expect(isStaleCompletion(task({ completed: false }), boundary)).toBe(false);
  });

  it('keeps a task completed after the boundary', () => {
    const completed = task({
      completed: true,
      completedAt: new Date(2026, 10, 14, 4, 0).toISOString(),
    });
    expect(isStaleCompletion(completed, boundary)).toBe(false);
  });

  it('keeps a task completed after the boundary of an earlier day', () => {
    const completed = task({
      completed: true,
      completedAt: new Date(2026, 10, 14, 4, 0).toISOString(),
    });
    expect(isStaleCompletion(completed, new Date(2026, 10, 13, 3, 0, 0))).toBe(false);
  });

  it('clears a task completed before the boundary', () => {
    const completed = task({
      completed: true,
      completedAt: new Date(2026, 10, 13, 22, 0).toISOString(),
    });
    expect(isStaleCompletion(completed, boundary)).toBe(true);
  });

  it('treats a missing timestamp as stale', () => {
    expect(isStaleCompletion(task({ completed: true }), boundary)).toBe(true);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(
      isStaleCompletion(task({ completed: true, completedAt: 'not-a-date' }), boundary),
    ).toBe(true);
  });
});

describe('staleCompletions', () => {
  const boundary = new Date(2026, 10, 14, 3, 0, 0);

  it('selects only completed tasks from before the boundary', () => {
    const tasks = [
      task({ id: 'a', completed: false }),
      task({
        id: 'b',
        completed: true,
        completedAt: new Date(2026, 10, 13, 22, 0).toISOString(),
      }),
      task({
        id: 'c',
        completed: true,
        completedAt: new Date(2026, 10, 14, 4, 0).toISOString(),
      }),
    ];
    const stale = staleCompletions(tasks, boundary);
    expect(stale.map((t) => t.id)).toEqual(['b']);
  });

  it('returns nothing when there is nothing to clear', () => {
    expect(staleCompletions([task({ completed: false })], boundary)).toEqual([]);
  });
});
