import { describe, expect, it } from 'vitest';
import type { EventItem } from '../types';
import { dayPhase, getUpcomingEvents } from './calendar';

const TODAY = '2026-11-11';
const DEADLINE = '2026-12-31';

describe('dayPhase', () => {
  it('marks days before today as past', () => {
    expect(dayPhase('2026-11-10', TODAY, DEADLINE)).toBe('past');
    expect(dayPhase('2026-01-01', TODAY, DEADLINE)).toBe('past');
    expect(dayPhase('2025-12-31', TODAY, DEADLINE)).toBe('past');
  });

  it('marks today as today', () => {
    expect(dayPhase(TODAY, TODAY, DEADLINE)).toBe('today');
  });

  it('marks days between today and the deadline as active', () => {
    expect(dayPhase('2026-11-12', TODAY, DEADLINE)).toBe('active');
    expect(dayPhase('2026-12-01', TODAY, DEADLINE)).toBe('active');
    expect(dayPhase('2026-12-30', TODAY, DEADLINE)).toBe('active');
  });

  it('includes the deadline itself in the active window', () => {
    expect(dayPhase(DEADLINE, TODAY, DEADLINE)).toBe('active');
  });

  it('marks days after the deadline as beyond', () => {
    expect(dayPhase('2027-01-01', TODAY, DEADLINE)).toBe('beyond');
    expect(dayPhase('2027-06-15', TODAY, DEADLINE)).toBe('beyond');
  });

  it('keeps days struck through when the deadline is already in the past', () => {
    const pastDeadline = '2026-06-01';
    expect(dayPhase('2026-05-31', TODAY, pastDeadline)).toBe('past');
    expect(dayPhase('2026-06-01', TODAY, pastDeadline)).toBe('past');
    expect(dayPhase('2026-06-02', TODAY, pastDeadline)).toBe('past');
    expect(dayPhase('2026-11-11', TODAY, pastDeadline)).toBe('today');
    expect(dayPhase('2026-11-12', TODAY, pastDeadline)).toBe('beyond');
  });

  it('marks every day active when the deadline is today', () => {
    expect(dayPhase('2026-11-10', TODAY, TODAY)).toBe('past');
    expect(dayPhase(TODAY, TODAY, TODAY)).toBe('today');
    expect(dayPhase('2026-11-12', TODAY, TODAY)).toBe('beyond');
  });
});

describe('getUpcomingEvents', () => {
  const event = (id: string, date: string, createdAt = id): EventItem => ({
    id,
    title: id,
    date,
    type: 'personal',
    createdAt,
    updatedAt: createdAt,
  });

  it('shows only the nearest five events, including today, without changing the stored list', () => {
    const events = [
      event('later', '2026-11-18'),
      event('past', '2026-11-10'),
      event('sixth', '2026-11-16'),
      event('tie-later', TODAY, '2026-11-11T10:00:00Z'),
      event('fourth', '2026-11-14'),
      event('third', '2026-11-12'),
      event('tie-earlier', TODAY, '2026-11-11T09:00:00Z'),
      event('fifth', '2026-11-15'),
    ];

    expect(getUpcomingEvents(events, TODAY).map((item) => item.id)).toEqual([
      'tie-earlier', 'tie-later', 'third', 'fourth', 'fifth',
    ]);
    expect(events).toHaveLength(8);
    expect(events[0]?.id).toBe('later');
  });

  it('returns fewer than five when fewer are upcoming', () => {
    expect(getUpcomingEvents([event('past', '2026-11-10'), event('future', '2026-11-12')], TODAY)
      .map((item) => item.id)).toEqual(['future']);
    expect(getUpcomingEvents([], TODAY)).toEqual([]);
  });
});
