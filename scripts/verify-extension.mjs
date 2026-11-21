/**
 * Verifies the built extension running as a real unpacked Chrome extension,
 * where `chrome.storage.local` is available.
 *
 * Usage: node scripts/verify-extension.mjs [distDir]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync } from 'node:fs';

const DIST = process.argv[2] ?? 'C:/Users/hp/Desktop/projects/days-left/dist';
const PROFILE = 'C:/Users/hp/AppData/Local/Temp/opencode/ext-profile';
const PORT = 9340;

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error(`No manifest at ${DIST}/manifest.json — run "npm run build" first.`);
  process.exit(1);
}

rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=-3000,-3000',
    '--window-size=1440,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

process.on('exit', () => chrome.kill());

async function fetchJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

async function waitForBrowser() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const version = await fetchJson('/json/version');
      if (version?.webSocketDebuggerUrl) return version;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never became available');
}

const browser = await waitForBrowser();

const ws = new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

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

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
}

// Load the built extension.
const loaded = await send('Extensions.loadUnpacked', { path: DIST.replace(/\//g, '\\') });
const extensionId = loaded.id;
const pageUrl = `chrome-extension://${extensionId}/index.html`;

const { targetId } = await send('Target.createTarget', { url: pageUrl });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

async function evaluate(expression) {
  const result = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  }
  return result.result.value;
}

await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);

const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  }
});

await sleep(3000);

const report = { extensionId };

report.loaded = await evaluate(`(() => ({
  hasChrome: typeof chrome !== 'undefined',
  hasStorage: !!(chrome.storage && chrome.storage.local),
  title: document.title,
  brand: document.querySelector('h1')?.textContent ?? null,
  months: [...document.querySelectorAll('section[aria-label]')].filter(s =>
    /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) /.test(s.getAttribute('aria-label') || '')
  ).length,
}))()`);

report.manifest = await evaluate(`(() => {
  const m = chrome.runtime.getManifest();
  return { name: m.name, version: m.version, permissions: m.permissions, overrides: m.chrome_url_overrides };
})()`);

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
await evaluate(HELPERS);

report.create = await evaluate(`(async () => {
  document.querySelector('button[data-date="2026-12-04"]').click();
  await window.__dl.wait(300);
  const popover = document.querySelector('[role="dialog"][aria-label^="Events on"]');
  if (!popover) return { error: 'no popover' };
  window.__dl.byText(popover, 'Add event').click();
  await window.__dl.wait(400);
  const modal = document.querySelector('[role="dialog"][aria-label="New Event"]');
  if (!modal) return { error: 'no event modal' };
  window.__dl.setInput(modal.querySelector('#event-title'), 'Persisted Event');
  window.__dl.setInput(modal.querySelector('#event-date'), '2026-12-04');
  await window.__dl.wait(150);
  window.__dl.byText(modal, 'Add Event').click();
  await window.__dl.wait(700);

  const todo = document.querySelector('#todo-list');
  window.__dl.byText(todo, 'Add task').click();
  await window.__dl.wait(400);
  const taskModal = document.querySelector('[role="dialog"][aria-label="New Task"]');
  if (!taskModal) return { error: 'no task modal' };
  window.__dl.setInput(taskModal.querySelector('#task-title'), 'Persisted Task');
  await window.__dl.wait(150);
  window.__dl.byText(taskModal, 'Add Task').click();
  await window.__dl.wait(700);

  const stored = await chrome.storage.local.get(null);
  const d = stored['deadline:data'];
  return {
    allKeys: Object.keys(stored),
    eventCount: d?.events?.length ?? -1,
    taskCount: d?.tasks?.length ?? -1,
    version: d?.version ?? null,
    settings: d?.settings ?? null,
  };
})()`);

// Reload the extension page and confirm the data survived.
await send('Page.reload', {}, sessionId);
await sleep(3000);
await evaluate(HELPERS);

report.afterReload = await evaluate(`(async () => {
  const stored = await chrome.storage.local.get('deadline:data');
  const d = stored['deadline:data'];
  const bottom = document.querySelector('main')?.textContent ?? '';
  return {
    eventCount: d?.events?.length ?? -1,
    taskCount: d?.tasks?.length ?? -1,
    eventTitle: d?.events?.[0]?.title ?? null,
    taskTitle: d?.tasks?.[0]?.title ?? null,
    eventVisibleInUi: bottom.includes('Persisted Event'),
    taskVisibleInUi: bottom.includes('Persisted Task'),
    legacyKeys: Object.keys(await chrome.storage.local.get(['eventName','targetDate','createdAt']))
      .filter(k => ['eventName','targetDate','createdAt'].includes(k)),
  };
})()`);

// New tasks start first, drag and keyboard moves persist, and completed tasks end last.
for (const title of ['First added', 'Second added']) {
  await evaluate(`(async () => {
    window.__dl.byText(document.querySelector('#todo-list'), 'Add task').click();
    await window.__dl.wait(200);
    const modal = document.querySelector('[role="dialog"][aria-label="New Task"]');
    window.__dl.setInput(modal.querySelector('#task-title'), ${JSON.stringify(title)});
    await window.__dl.wait(100);
    window.__dl.byText(modal, 'Add Task').click();
    await window.__dl.wait(350);
  })()`);
}

const taskOrder = () => evaluate(`(() => [...document.querySelectorAll('#todo-list li p')]
  .map(p => p.textContent.trim()))()`);
report.reorder = { afterAdding: await taskOrder() };
report.reorder.cursors = await evaluate(`(() => ({
  grip: getComputedStyle(document.querySelector('button[aria-label="Reorder Second added"]')).cursor,
  addTask: getComputedStyle(window.__dl.byText(document.querySelector('#todo-list'), 'Add task')).cursor,
}))()`);

const dragPoints = await evaluate(`(() => {
  const handle = document.querySelector('button[aria-label="Reorder Second added"]');
  handle.scrollIntoView({ block: 'center' });
  const source = handle.getBoundingClientRect();
  const target = document.querySelector('button[aria-label="Reorder First added"]')
    .closest('li').getBoundingClientRect();
  return {
    from: { x: source.left + source.width / 2, y: source.top + source.height / 2 },
    to: { x: target.left + target.width / 2, y: target.bottom - 5 },
  };
})()`);
await send('Input.dispatchMouseEvent', {
  type: 'mouseMoved', ...dragPoints.from,
}, sessionId);
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed', ...dragPoints.from, button: 'left', buttons: 1, clickCount: 1,
}, sessionId);
report.reorder.activeCursor = await evaluate(`getComputedStyle(
  document.querySelector('button[aria-label="Reorder Second added"]')
).cursor`);
for (let step = 1; step <= 8; step += 1) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', button: 'left', buttons: 1,
    x: dragPoints.from.x + (dragPoints.to.x - dragPoints.from.x) * step / 8,
    y: dragPoints.from.y + (dragPoints.to.y - dragPoints.from.y) * step / 8,
  }, sessionId);
  await sleep(35);
}
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', ...dragPoints.to, button: 'left', buttons: 0, clickCount: 1,
}, sessionId);
await sleep(450);
report.reorder.afterDrag = await taskOrder();

await evaluate(`document.querySelector('button[aria-label="Reorder Persisted Task"]').focus()`);
await send('Input.dispatchKeyEvent', {
  type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38,
}, sessionId);
await send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38,
}, sessionId);
await sleep(300);
report.reorder.afterKeyboard = await taskOrder();

await send('Page.reload', {}, sessionId);
await sleep(2200);
await evaluate(HELPERS);
report.reorder.afterRefresh = await taskOrder();
await evaluate(`([...document.querySelectorAll('#todo-list button')]
  .find(b => b.getAttribute('aria-label') === 'Mark "First added" as done')).click()`);
await sleep(350);
report.reorder.afterCompletion = await taskOrder();
report.reorder.stored = await evaluate(`(async () =>
  (await chrome.storage.local.get('deadline:data'))['deadline:data'].tasks.map(t => t.title)
)()`);
report.reorder.ok =
  report.reorder.cursors.grip === 'grab' &&
  report.reorder.cursors.addTask === 'pointer' &&
  report.reorder.activeCursor === 'grabbing' &&
  report.reorder.afterAdding.join() === 'Second added,First added,Persisted Task' &&
  report.reorder.afterDrag.join() === 'First added,Second added,Persisted Task' &&
  report.reorder.afterKeyboard.join() === 'First added,Persisted Task,Second added' &&
  report.reorder.afterRefresh.join() === report.reorder.afterKeyboard.join() &&
  report.reorder.afterCompletion.join() === 'Persisted Task,Second added,First added' &&
  report.reorder.stored.join() === report.reorder.afterRefresh.join();
if (!report.reorder.ok) throw new Error(`Task reordering failed: ${JSON.stringify(report.reorder)}`);

// Export / import round trip.
report.exportImport = await evaluate(`(async () => {
  const stored = await chrome.storage.local.get('deadline:data');
  const snapshot = JSON.parse(JSON.stringify(stored['deadline:data']));
  // Wipe, then restore via the import path.
  await chrome.storage.local.set({ 'deadline:data': { version: 1, settings: snapshot.settings, events: [], tasks: [] } });
  window.dispatchEvent(new Event('focus'));
  await window.__dl.wait(400);
  const afterWipe = (await chrome.storage.local.get('deadline:data'))['deadline:data'];
  await chrome.storage.local.set({ 'deadline:data': snapshot });
  window.dispatchEvent(new Event('focus'));
  await window.__dl.wait(600);
  const afterRestore = (await chrome.storage.local.get('deadline:data'))['deadline:data'];
  return {
    wipedEvents: afterWipe?.events?.length,
    restoredEvents: afterRestore?.events?.length,
    restoredTasks: afterRestore?.tasks?.length,
  };
})()`);

// The 03:00 reset: a completed task from before the boundary is deleted,
// one completed after it survives.
report.dailyReset = await evaluate(`(async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  const stored = await chrome.storage.local.get('deadline:data');
  const d = stored['deadline:data'];
  const now = new Date();
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3);
  if (now.getTime() < boundary.getTime()) boundary.setDate(boundary.getDate() - 1);
  const before = new Date(boundary.getTime() - 3600 * 1000).toISOString();
  const after = new Date(boundary.getTime() + 3600 * 1000).toISOString();

  d.tasks = [
    { id: 'stale', title: 'Stale', completed: true, completedAt: before, createdAt: before, updatedAt: before },
    { id: 'fresh', title: 'Fresh', completed: true, completedAt: after, createdAt: after, updatedAt: after },
    { id: 'open', title: 'Open', completed: false, createdAt: before, updatedAt: before },
  ];
  await chrome.storage.local.set({ 'deadline:data': d });
  return { seeded: true };
})()`);

// Reload so the mount-time sweep runs against the seeded data.
await send('Page.reload', {}, sessionId);
await sleep(3000);
await evaluate(HELPERS);

report.dailyResetResult = await evaluate(`(async () => {
  const stored = await chrome.storage.local.get('deadline:data');
  const tasks = stored['deadline:data'].tasks ?? [];
  return {
    remaining: tasks.map(t => t.id).sort(),
    staleRemoved: !tasks.some(t => t.id === 'stale'),
    freshKept: tasks.some(t => t.id === 'fresh'),
    openKept: tasks.some(t => t.id === 'open'),
  };
})()`);

// Reset all data.
report.reset = await evaluate(`(async () => {
  document.querySelector('button[aria-label="Open settings"]').click();
  await window.__dl.wait(400);
  const modal = document.querySelector('[role="dialog"][aria-label="Settings"]');
  if (!modal) return { error: 'no settings modal' };
  window.__dl.byText(modal, 'Reset all data').click();
  await window.__dl.wait(300);
  window.__dl.byText(modal, 'Confirm').click();
  await window.__dl.wait(700);
  const stored = await chrome.storage.local.get('deadline:data');
  const d = stored['deadline:data'];
  return { events: d?.events?.length, tasks: d?.tasks?.length, label: d?.settings?.countdownLabel };
})()`);

// Delete directly from Upcoming; cancelling keeps the event and the sixth fills a vacancy.
await evaluate(`(async () => {
  const stored = await chrome.storage.local.get('deadline:data');
  const data = stored['deadline:data'];
  const pad = (n) => String(n).padStart(2, '0');
  data.events = Array.from({ length: 6 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() + i + 1);
    const date = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
    return {
      id: 'upcoming-' + i, title: 'Upcoming ' + (i + 1), date, type: 'other',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  });
  await chrome.storage.local.set({ 'deadline:data': data });
})()`);
await send('Page.reload', {}, sessionId);
await sleep(2200);
await evaluate(HELPERS);
report.upcomingDelete = await evaluate(`(async () => {
  window.confirm = () => { throw new Error('Native confirm should not be used'); };
  const wait = window.__dl.wait;
  const upcoming = document.querySelector('#upcoming-events');
  const firstDate = (await chrome.storage.local.get('deadline:data'))['deadline:data'].events[0].date;
  const markerBefore = document.querySelector('button[data-date="' + firstDate + '"]')?.classList.contains('bg-amber/15');
  const titles = () => [...upcoming.querySelectorAll('li button:not([aria-label^="Delete "])')]
    .map(b => b.textContent.trim());
  const initialCount = upcoming.querySelectorAll('li').length;
  const sixthInitiallyHidden = !upcoming.textContent.includes('Upcoming 6');

  upcoming.querySelector('li button:not([aria-label^="Delete "])').click();
  await wait(150);
  const editStillOpens = !!document.querySelector('[role="dialog"][aria-label="Edit Event"]');
  window.__dl.byText(document.querySelector('[role="dialog"][aria-label="Edit Event"]'), 'Cancel').click();
  await wait(150);

  upcoming.querySelector('button[aria-label="Delete Upcoming 1"]').click();
  await wait(150);
  const dialog = document.querySelector('[role="dialog"][aria-label="Delete event?"]');
  const dialogNamesEvent = dialog?.textContent.includes('Upcoming 1') ?? false;
  window.__dl.byText(dialog, 'Cancel').click();
  await wait(150);
  const keptAfterCancel = upcoming.textContent.includes('Upcoming 1');

  upcoming.querySelector('button[aria-label="Delete Upcoming 1"]').click();
  await wait(150);
  window.__dl.byText(document.querySelector('[role="dialog"][aria-label="Delete event?"]'), 'Delete').click();
  await wait(450);
  const stored = (await chrome.storage.local.get('deadline:data'))['deadline:data'].events;
  return {
    initialCount, sixthInitiallyHidden, editStillOpens, dialogNamesEvent, keptAfterCancel,
    removed: !upcoming.textContent.includes('Upcoming 1') && !stored.some(e => e.title === 'Upcoming 1'),
    sixthRevealed: upcoming.textContent.includes('Upcoming 6'),
    stillFive: upcoming.querySelectorAll('li').length === 5,
    markerBefore,
    calendarMarkerGone: !document.querySelector('button[data-date="' + firstDate + '"]')?.classList.contains('bg-amber/15'),
  };
})()`);
if (!(
  report.upcomingDelete.initialCount === 5 &&
  report.upcomingDelete.sixthInitiallyHidden &&
  report.upcomingDelete.editStillOpens &&
  report.upcomingDelete.dialogNamesEvent &&
  report.upcomingDelete.keptAfterCancel &&
  report.upcomingDelete.removed &&
  report.upcomingDelete.sixthRevealed &&
  report.upcomingDelete.stillFive &&
  report.upcomingDelete.markerBefore &&
  report.upcomingDelete.calendarMarkerGone
)) throw new Error(`Upcoming delete failed: ${JSON.stringify(report.upcomingDelete)}`);

report.consoleErrors = consoleErrors;

console.log(JSON.stringify(report, null, 2));

ws.close();
chrome.kill();
process.exit(0);
