/**
 * Headless verification driver using the Chrome DevTools Protocol.
 * Usage: node scripts/verify.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:4173';
const PORT = 9333;
const PROFILE = 'C:/Users/hp/AppData/Local/Temp/opencode/cdp-profile';

// A stale profile can serve a cached index.html pointing at a deleted bundle,
// so start from a clean profile every run.
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

process.on('exit', () => chrome.kill());

async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never became available');
}

const target = await waitForTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  }
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  }
});

await send('Page.navigate', { url: URL });
await sleep(2500);

// Helpers injected into the page.
const HELPERS = `
  window.__dl = {
    byText(scope, text) {
      return [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    },
    setInput(el, value) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    wait(ms) { return new Promise(r => setTimeout(r, ms)); },
  };
`;

const report = {};

try {
  await evaluate(HELPERS);

  report.header = await evaluate(`(() => ({
  brand: document.querySelector('h1')?.textContent,
  countdown: document.querySelector('[aria-live="polite"]')?.textContent,
}))()`);

  report.calendar = await evaluate(`(() => {
  const grids = [...document.querySelectorAll('section[aria-label]')].filter(s =>
    /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) /.test(s.getAttribute('aria-label') || '')
  );
  return {
    monthGrids: grids.length,
    monthLabels: grids.map(g => g.getAttribute('aria-label')),
    dayCells: document.querySelectorAll('button[data-date]').length,
    yearHeading: document.querySelector('h2')?.textContent ?? null,
  };
})()`);

// --- month / year navigation ---
report.navigation = await evaluate(`(async () => {
  const monthsNow = () => [...document.querySelectorAll('section[aria-label$="2026"], section[aria-label$="2027"]')]
    .filter(s => /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) /.test(s.getAttribute('aria-label') || ''))
    .map(s => s.getAttribute('aria-label'));

  const click = async (label) => {
    document.querySelector('button[aria-label="' + label + '"]').click();
    await window.__dl.wait(250);
  };

  const start = monthsNow();
  await click('Next month');
  const afterNextMonth = monthsNow();
  await click('Previous month');
  await click('Previous month');
  const afterPrevMonth = monthsNow();
  await click('Next year');
  const afterNextYear = monthsNow();
  await click('Previous year');
  const afterPrevYear = monthsNow();

  // Today button
  const todayBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Today');
  todayBtn.click();
  await window.__dl.wait(300);
  const afterToday = monthsNow();
  const todayCell = document.querySelector('button[aria-current="date"]');

  return {
    start,
    afterNextMonth,
    afterPrevMonth,
    afterNextYear,
    afterPrevYear,
    afterToday,
    todaySelected: todayCell?.dataset?.date ?? null,
  };
})()`);

report.dateStates = await evaluate(`(() => {
  const todayEl = document.querySelector('button[aria-current="date"]');
  const today = todayEl?.dataset.date;
  if (!today) return { error: 'no today cell' };

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const [y, m, d] = today.split('-').map(Number);
  const shift = (n) => fmt(new Date(y, m - 1, d + n));

  const read = (date) => {
    const el = document.querySelector('button[data-date="' + date + '"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      date,
      color: cs.color,
      bg: cs.backgroundColor,
      decoration: cs.textDecorationLine,
    };
  };

  return {
    today: {
      date: today,
      color: getComputedStyle(todayEl).color,
      bg: getComputedStyle(todayEl).backgroundColor,
    },
    past: read(shift(-1)),
    tomorrow: read(shift(1)),
    // A day belonging to the neighbouring month, shown dimmed.
    adjacent: read(fmt(new Date(y, m, 1))),
  };
})()`);

// --- deadline window: only days up to the deadline stay white ---
report.deadlineWindow = await evaluate(`(async () => {
  const today = document.querySelector('button[aria-current="date"]')?.dataset.date;
  const read = (date) => {
    const el = document.querySelector('button[data-date="' + date + '"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color, decoration: cs.textDecorationLine };
  };
  const WHITE = 'rgb(255, 255, 255)';
  const GREY = 'rgb(102, 102, 102)';

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  const daysInMonth = new Date(year, month, 0).getDate();
  const deadline = year + '-' + pad(month) + '-' + pad(daysInMonth);
  const shift = (n) => fmt(new Date(year, month - 1, day + n));
  // The first day strictly after the deadline.
  const afterDeadlineDate = fmt(new Date(year, month, 1));

  // Set the deadline through the Settings UI (the real user path).
  document.querySelector('button[aria-label="Open settings"]').click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="Settings"]');
  const original = modal.querySelector('#settings-target').value;
  window.__dl.setInput(modal.querySelector('#settings-target'), deadline);
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Save').click();
  await window.__dl.wait(600);

  const result = {
    today,
    deadline,
    original,
    pastDay: read(shift(-1)),
    inWindowDay: read(shift(1)),
    deadlineDay: read(deadline),
    afterDeadline: read(afterDeadlineDate),
  };

  // Restore the original target.
  document.querySelector('button[aria-label="Open settings"]').click();
  await window.__dl.wait(300);
  const modal2 = document.querySelector('[role="dialog"][aria-label="Settings"]');
  window.__dl.setInput(modal2.querySelector('#settings-target'), original);
  await window.__dl.wait(100);
  window.__dl.byText(modal2, 'Save').click();
  await window.__dl.wait(500);

  result.expectations = {
    pastIsGrey: result.pastDay?.color === GREY && result.pastDay?.decoration === 'line-through',
    inWindowIsWhite: result.inWindowDay?.color === WHITE,
    deadlineIsWhite: result.deadlineDay?.color === WHITE,
    afterDeadlineIsGrey: result.afterDeadline?.color === GREY && result.afterDeadline?.decoration === 'none',
  };
  return result;
})()`);

// --- click a date -> popover ---
report.popover = await evaluate(`(async () => {
  document.querySelector('button[data-date="2026-12-04"]').click();
  await window.__dl.wait(300);
  const dialog = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  return {
    opened: !!dialog,
    label: dialog?.getAttribute('aria-label') ?? null,
    emptyState: dialog?.textContent?.includes('No events on this date') ?? false,
  };
})()`);

// --- create an event via the modal ---
report.createEvent = await evaluate(`(async () => {
  const popover = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  window.__dl.byText(popover, 'Add event').click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="New Event"]');
  if (!modal) return { ok: false, reason: 'event modal did not open' };
  window.__dl.setInput(modal.querySelector('#event-title'), 'Headless Event');
  window.__dl.setInput(modal.querySelector('#event-date'), '2026-12-04');
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Add Event').click();
  await window.__dl.wait(500);
  const cell = document.querySelector('button[data-date="2026-12-04"]');
  const markerBackground = getComputedStyle(cell).backgroundColor;
  const hasMarker = markerBackground !== 'rgba(0, 0, 0, 0)';
  const upcoming = document.querySelector('#upcoming-events')?.textContent ?? '';
  return {
    ok: hasMarker && upcoming.includes('Headless Event'),
    hasMarker,
    markerBackground,
    upcomingMentionsEvent: upcoming.includes('Headless Event'),
    modalClosed: !document.querySelector('[role="dialog"][aria-label="New Event"]'),
  };
})()`);

// --- create a second event on the same date ---
report.secondEventSameDate = await evaluate(`(async () => {
  document.querySelector('button[data-date="2026-12-04"]').click();
  await window.__dl.wait(250);
  const popover = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  window.__dl.byText(popover, 'Add event').click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="New Event"]');
  window.__dl.setInput(modal.querySelector('#event-title'), 'Second Event');
  window.__dl.setInput(modal.querySelector('#event-date'), '2026-12-04');
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Add Event').click();
  await window.__dl.wait(500);
  document.querySelector('button[data-date="2026-12-04"]').click();
  await window.__dl.wait(250);
  const popover2 = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  return {
    count: popover2 ? popover2.querySelectorAll('li').length : 0,
    listsBoth:
      popover2?.textContent.includes('Headless Event') &&
      popover2?.textContent.includes('Second Event'),
  };
})()`);

// --- past event is excluded from Upcoming but visible in the calendar ---
report.pastEventHandling = await evaluate(`(async () => {
  // Pick a date that is in the past but still inside the visible window.
  const todayStr = document.querySelector('button[aria-current="date"]')?.dataset.date;
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const past = new Date(ty, tm - 1, td - 1);
  const pastDate = past.getFullYear() + '-' + pad(past.getMonth() + 1) + '-' + pad(past.getDate());

  document.querySelector('button[data-date="2026-12-04"]').click();
  await window.__dl.wait(200);
  const popover = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  // Edit the first event in the popover ("Headless Event") to a past date.
  const editBtn = popover.querySelector('button[aria-label^="Edit"]');
  const editedName = editBtn.getAttribute('aria-label').replace('Edit ', '');
  editBtn.click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="Edit Event"]');
  window.__dl.setInput(modal.querySelector('#event-date'), pastDate);
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Save').click();
  await window.__dl.wait(500);
  const upcoming = document.querySelector('#upcoming-events')?.textContent ?? '';
  const pastCell = document.querySelector('button[data-date="' + pastDate + '"]');
  return {
    editedName,
    removedFromUpcoming: !upcoming.includes(editedName),
    stillHasEventCell: pastCell
      ? getComputedStyle(pastCell).backgroundColor !== 'rgba(0, 0, 0, 0)'
      : false,
    pastCellStrikethrough: pastCell ? getComputedStyle(pastCell).textDecorationLine : null,
    remainingUpcoming: (upcoming.match(/DEC/g) || []).length,
  };
})()`);

// --- todo: create, complete, filter ---
report.todos = await evaluate(`(async () => {
  const todo = document.querySelector('#todo-list');
  window.__dl.byText(todo, 'Add task').click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="New Task"]');
  window.__dl.setInput(modal.querySelector('#task-title'), 'Headless Task');
  // A due date in the past, relative to today, so the task reads as overdue.
  const todayStr = document.querySelector('button[aria-current="date"]')?.dataset.date;
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const past = new Date(ty, tm - 1, td - 1);
  const dueDate = past.getFullYear() + '-' + pad(past.getMonth() + 1) + '-' + pad(past.getDate());
  window.__dl.setInput(modal.querySelector('#task-due'), dueDate);
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Add Task').click();
  await window.__dl.wait(500);

  const todoAfter = document.querySelector('#todo-list');
  const inToday = todoAfter.textContent.includes('Headless Task');
  const overdueLabel = /overdue/i.test(todoAfter.textContent);

  // switch to Pending
  const pendingTab = [...todoAfter.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pending');
  pendingTab.click();
  await window.__dl.wait(200);
  const inPending = document.querySelector('#todo-list').textContent.includes('Headless Task');

  // complete it
  const toggle = document.querySelector('#todo-list button[aria-label^="Mark"]');
  toggle.click();
  await window.__dl.wait(400);
  const completedTab = [...document.querySelectorAll('#todo-list button')].find(b => b.textContent.trim() === 'Completed');
  completedTab.click();
  await window.__dl.wait(300);
  const inCompleted = document.querySelector('#todo-list').textContent.includes('Headless Task');

  return { inToday, overdueLabel, inPending, inCompleted };
})()`);

// --- keyboard navigation in the calendar ---
report.keyboard = await evaluate(`(async () => {
  const todayCell = document.querySelector('button[aria-current="date"]');
  todayCell.focus();
  const startDate = todayCell.dataset.date;
  const press = (key) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(ev);
  };
  press('ArrowRight');
  await window.__dl.wait(250);
  const afterRight = document.activeElement?.dataset?.date ?? null;
  press('ArrowDown');
  await window.__dl.wait(250);
  const afterDown = document.activeElement?.dataset?.date ?? null;
  const popoverOpen = !!document.querySelector('[role="dialog"][aria-label^="Events on"]');

  // Walking past the last visible month must slide the window.
  const monthsNow = () => [...document.querySelectorAll('section[aria-label]')]
    .filter(s => /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) /.test(s.getAttribute('aria-label') || ''))
    .map(s => s.getAttribute('aria-label'));
  const windowBefore = monthsNow();
  const lastCell = [...document.querySelectorAll('button[data-date]')].pop();
  lastCell.focus();
  for (let i = 0; i < 8; i += 1) {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await window.__dl.wait(120);
  }
  const windowAfter = monthsNow();

  return {
    startDate,
    afterRight,
    afterDown,
    popoverOpenAfterArrows: popoverOpen,
    windowBefore,
    windowAfter,
    windowSlid: windowBefore.join() !== windowAfter.join(),
  };
})()`);

// --- settings: change week start, verify the calendar re-renders ---
report.settings = await evaluate(`(async () => {
  document.querySelector('button[aria-label="Open settings"]').click();
  await window.__dl.wait(300);
  const modal = document.querySelector('[role="dialog"][aria-label="Settings"]');
  const presence = {
    opened: !!modal,
    hasExport: modal.textContent.includes('Export JSON'),
    hasImport: modal.textContent.includes('Import JSON'),
    hasReset: modal.textContent.includes('Reset all data'),
    hasWeekStart: modal.textContent.includes('Week starts on'),
    hasTheme: modal.textContent.includes('Theme'),
  };
  const sunday = [...modal.querySelectorAll('[role="radio"]')].find(b => b.textContent.trim() === 'Sunday');
  sunday.click();
  await window.__dl.wait(100);
  window.__dl.byText(modal, 'Save').click();
  await window.__dl.wait(500);
  const headers = [...document.querySelectorAll('[role="columnheader"]')].slice(0, 7).map(h => h.textContent);
  return { ...presence, firstWeekdayRow: headers };
})()`);

// --- year navigation ---
report.yearNav = await evaluate(`(async () => {
  const monthsNow = () => [...document.querySelectorAll('section[aria-label]')]
    .filter(s => /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) /.test(s.getAttribute('aria-label') || ''))
    .map(s => s.getAttribute('aria-label'));

  const yearBefore = document.querySelector('h2')?.textContent;
  const monthsBefore = monthsNow();
  const todayBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Today');
  todayBtn.click();
  await window.__dl.wait(300);
  const yearToday = document.querySelector('h2')?.textContent;
  const monthsToday = monthsNow();
  return { yearBefore, monthsBefore, yearToday, monthsToday };
})()`);

// --- persistence: reload and confirm data survives ---
// NOTE: this runs against a plain web page where `chrome.storage` is absent,
// so the storage service falls back to its in-memory cache and data is
// expected to be lost on reload. Real persistence is covered by
// scripts/verify-extension.mjs, which runs inside the real extension.
const beforeReload = await evaluate(`(() => {
  const bottom = document.querySelector('main')?.textContent ?? '';
  return {
    hasEvent: bottom.includes('Second Event'),
    hasTask: bottom.includes('Headless Task'),
    storageAvailable: typeof chrome !== 'undefined' && !!chrome.storage,
  };
})()`);

await send('Page.navigate', { url: URL });
await sleep(2500);
await evaluate(HELPERS);

const afterReload = await evaluate(`(() => {
  const bottom = document.querySelector('main')?.textContent ?? '';
  return {
    hasEvent: bottom.includes('Second Event'),
    hasTask: bottom.includes('Headless Task'),
  };
})()`);

report.persistence = { beforeReload, afterReload };
} catch (error) {
  report.error = String(error?.message ?? error);
}

report.consoleErrors = consoleErrors;

console.log(JSON.stringify(report, null, 2));

ws.close();
chrome.kill();
process.exit(0);