import { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekStart } from '../../types';
import { addDays, toDateString } from '../../utils/dates';
import { MonthGrid } from './MonthGrid';

/** A single month shown in the calendar window. */
export interface VisibleMonth {
  year: number;
  /** 1-based month. */
  month: number;
}

interface YearlyCalendarProps {
  /** The three months currently on screen. */
  months: VisibleMonth[];
  weekStartsOn: WeekStart;
  today: string;
  /** The countdown target date; days up to and including it are highlighted. */
  deadline: string;
  selectedDate: string | null;
  eventDates: Set<string>;
  /** Shift the window by a number of months (positive = forwards). */
  onShiftMonths: (delta: number) => void;
  /** Jump the window by a number of years. */
  onShiftYears: (delta: number) => void;
  onSelectDate: (date: Date, anchor: HTMLElement) => void;
  /** Keyboard navigation moves the selection without opening the popover. */
  onFocusDate: (date: Date) => void;
  /** The "Today" action returns to the current month and selects today. */
  onToday: () => void;
}

export function YearlyCalendar({
  months,
  weekStartsOn,
  today,
  deadline,
  selectedDate,
  eventDates,
  onShiftMonths,
  onShiftYears,
  onSelectDate,
  onFocusDate,
  onToday,
}: YearlyCalendarProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  const primaryYear = months[0]?.year ?? Number(today.slice(0, 4));
  const lastMonth = months[months.length - 1];

  const yearLabel = useMemo(() => {
    const first = months[0];
    if (!first) return String(primaryYear);
    if (!lastMonth || lastMonth.year === first.year) return String(first.year);
    return `${first.year} – ${lastMonth.year}`;
  }, [months, lastMonth, primaryYear]);

  /**
   * Move focus to a neighbouring day. When the target falls outside the
   * visible window the window slides to include it.
   */
  const focusDate = (date: Date, dayDelta: number) => {
    const next = addDays(date, dayDelta);
    const nextStr = toDateString(next);
    const nextMonth = { year: next.getFullYear(), month: next.getMonth() + 1 };

    const first = months[0];
    const last = lastMonth;
    if (first && last) {
      const firstIndex = first.year * 12 + (first.month - 1);
      const lastIndex = last.year * 12 + (last.month - 1);
      const targetIndex = nextMonth.year * 12 + (nextMonth.month - 1);

      if (targetIndex > lastIndex) onShiftMonths(targetIndex - lastIndex);
      else if (targetIndex < firstIndex) onShiftMonths(targetIndex - firstIndex);
    }

    onFocusDate(next);
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`button[data-date="${nextStr}"]`)
        ?.focus();
    });
  };

  const stepperButton =
    'flex h-7 w-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text';

  return (
    <section aria-label="Calendar" className="min-w-0">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-text">
          {yearLabel}
        </h2>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onShiftMonths(-1)}
              aria-label="Previous month"
              className={stepperButton}
            >
              <ChevronLeft size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onShiftMonths(1)}
              aria-label="Next month"
              className={stepperButton}
            >
              <ChevronRight size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-0.5 text-text-3">
            <button
              type="button"
              onClick={() => onShiftYears(-1)}
              aria-label="Previous year"
              className={stepperButton}
            >
              <ChevronLeft size={11} strokeWidth={1.5} aria-hidden="true" />
              <ChevronLeft size={11} strokeWidth={1.5} aria-hidden="true" className="-ml-1.5" />
            </button>
            <button
              type="button"
              onClick={() => onShiftYears(1)}
              aria-label="Next year"
              className={stepperButton}
            >
              <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />
              <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" className="-ml-1.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onToday}
            className="rounded-md px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Today
          </button>
        </div>
      </div>

      <div ref={gridRef} className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((entry) => (
          <MonthGrid
            key={`${entry.year}-${entry.month}`}
            year={entry.year}
            month={entry.month}
            primaryYear={primaryYear}
            weekStartsOn={weekStartsOn}
            today={today}
            deadline={deadline}
            selectedDate={selectedDate}
            eventDates={eventDates}
            onSelectDate={onSelectDate}
            onNavigate={focusDate}
          />
        ))}
      </div>
    </section>
  );
}
