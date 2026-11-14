import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.argv[2] ?? 'http://localhost:4173';
const PORT = 9390;

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/Users/hp/AppData/Local/Temp/opencode/probe-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());
await sleep(3000);

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const n = id++;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
const { result: attached } = await send('Target.attachToTarget', {
  targetId: created.targetId,
  flatten: true,
});
await send('Runtime.enable', {}, attached.sessionId);
await send('Page.enable', {}, attached.sessionId);
await send('Page.navigate', { url: URL }, attached.sessionId);
await sleep(3000);

const probe = await send(
  'Runtime.evaluate',
  {
    expression: `JSON.stringify({
      systemToday: (() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })(),
      h1: document.querySelector('h1')?.textContent,
      h2: document.querySelector('h2')?.textContent,
      todayCellCount: document.querySelectorAll('button[aria-current="date"]').length,
      sectionLabels: [...document.querySelectorAll('section[aria-label]')].map(s => s.getAttribute('aria-label')),
      dayCells: document.querySelectorAll('button[data-date]').length,
      firstCellDates: [...document.querySelectorAll('button[data-date]')].slice(0,3).map(b=>b.dataset.date),
      navButtons: [...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')).slice(0,10),
    }, null, 2)`,
    returnByValue: true,
  },
  attached.sessionId,
);

console.log(probe?.result?.result?.value ?? JSON.stringify(probe));
ws.close();
chrome.kill();
process.exit(0);
