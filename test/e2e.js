// End-to-end check of Skyward Glow against the mock Skyward.
//
//   npm install        (once, installs Playwright)
//   npm test
//
// Starts test/server.js, runs glow.js on the practice gradebook in a real
// Chromium, and checks every view. Exits non-zero if anything fails.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const PORT = 8790;
const BASE = 'http://localhost:' + PORT + '/test/mock-gradebook.html';
const CODE = fs.readFileSync(path.join(__dirname, '..', 'glow.js'), 'utf8');
const VERSION = CODE.match(/const VERSION = '([\d.]+)'/)[1];
const USERSCRIPT = fs.readFileSync(path.join(__dirname, '..', 'skyward-glow.user.js'), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  →  ' + JSON.stringify(detail)));
  if (!ok) failures++;
}

async function openApp(browser, url, viewport = { width: 1360, height: 900 }, time, timezoneId) {
  const page = await browser.newPage({ viewport, timezoneId });
  if (time) await page.clock.install({ time });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Pretend a newer version is published so the update banner shows.
  await page.route('https://loganwestlake.github.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: "const VERSION = '99.0.0';" }));
  await page.goto(url);
  await page.evaluate(CODE);
  await page.waitForTimeout(800);
  const q = (sel) => page.evaluate((s) => {
    const root = document.getElementById('skyward-glow-host').shadowRoot;
    return [...root.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  }, sel);
  const click = (sel, n = 0) => page.locator('#skyward-glow-host ' + sel).nth(n).click();
  return { page, errors, q, click };
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT }) });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch();

  try {
    console.log('Normal Skyward (menu clicks work)');
    // A Monday morning, so the regular (non-SWARM) schedule applies.
    let { page, errors, q, click } = await openApp(browser, BASE, undefined, new Date('2026-10-19T09:00:00-04:00'), 'America/New_York');
    check('shows version ' + VERSION, (await q('.side .ver'))[0] === 'v' + VERSION, await q('.side .ver'));
    check('update banner for newer version', (await q('.update'))[0]?.includes('99.0.0'), await q('.update'));
    check('opens on Q2, not FIN', (await q('.hero .sub'))[0]?.includes('Q2'), await q('.hero .sub'));
    check('four stat tiles', (await q('.stat')).length === 4);
    const segs = await q('.glance .seg-btn');
    check('at-a-glance has Quarter 1-4', JSON.stringify(segs) === JSON.stringify(['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']), segs);
    await click('.glance .seg-btn[data-term="Q3"]');
    check('switching to Q3 updates the panel', (await q('.glance h3'))[0] === 'Q3 at a glance' && (await q('.glance .empty')).length === 1, await q('.glance'));
    check('switching also updates the stats', (await q('.hero .sub'))[0]?.includes('Q3'));
    await click('.glance .seg-btn[data-term="Q2"]');

    await click('.side [data-view=grades]');
    const tabs = await q('.tab');
    check('grades tabs in Skyward order with Q3 and Q4', JSON.stringify(tabs) === JSON.stringify(['Q1', 'Q2', 'SM1', 'Q3', 'Q4', 'FIN']), tabs);
    // Card titles start with a subject icon; compare the names after it.
    const cards = (await q('.card h2')).map((t) => t.replace(/^[^A-Za-z]+/, ''));
    check('cards show subject icons', (await q('.card h2 .subj')).length === 8);
    check('8 class cards (7 classes + SWARM)', cards.length === 8, cards);
    check('teachers read', (await q('.card .teacher')).length === 8);
    check('sorted by period', cards[0] === 'English 1' && cards[6] === 'Geometry' && cards[7] === 'Swarm', cards);

    await click('.card', 2);
    await waitFor(async () => (await q('.asg')).length > 0, 8000);
    const asg = await q('.asg-main b');
    check('assignments read from Skyward popup', asg.includes('Unit 2 Test') && asg.includes('Quiz 3'), asg);
    check('category rows not duplicated', (await q('.cat')).length === 2, await q('.cat'));
    check('missing work flagged', (await q('.asg')).some((t) => t.includes('Missing')));
    check('Skyward popup closed afterwards', await page.evaluate(() =>
      ![...document.querySelectorAll('.ui-dialog')].some((d) => d.getClientRects().length)));
    await page.keyboard.press('Escape');

    await click('.side [data-view=schedule]');
    const monday = await q('.slot .slot-card b');
    check('Monday: 7 classes plus lunch, no SWARM', monday.length === 8 && monday.includes('Lunch B') && !monday.includes('SWARM'), monday);
    check('Monday lunch fills the gap before 4B', (await q('.slot-lunch .slot-time'))[0] === '10:04 AM10:38 AM', await q('.slot-lunch .slot-time'));
    check('Skyward schedule page loaded (redirect catch)', await waitFor(async () => (await q('.table-card')).length > 0), await q('.view'));

    await click('.side [data-view=attendance]');
    check('attendance loaded with script-drawn grid', await waitFor(async () => (await q('.stat')).some((s) => s.startsWith('Tardy2'))), await q('.view'));
    check('period numbers not colored as grades', (await page.evaluate(() =>
      document.getElementById('skyward-glow-host').shadowRoot.querySelectorAll('td .num-cell').length)) === 0);

    const busy = () => page.evaluate(() => ({
      overlay: [...document.querySelectorAll('.blockOverlay')].some((e) => e.getClientRects().length),
      message: [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && /please wait/i.test(e.textContent) && e.getClientRects().length),
      cursor: document.body.style.cursor,
      busyClass: document.body.classList.contains('sf_busy')
    }));
    const b = await busy();
    check('Skyward "Please wait" cleared after background loads', !b.overlay && !b.message && b.cursor !== 'wait' && !b.busyClass, b);
    check('Skyward page itself still visible', await page.evaluate(() => document.getElementById('sf_navMenu').getClientRects().length > 0));

    await click('.side [data-view=more]');
    check('More lists menu pages', (await q('.tile')).length >= 4, await q('.tile'));
    check('More shows version', (await q('.version-note'))[0] === 'Better Skyward v' + VERSION);
    await click('.tile', 0);
    check('missing page shows a fallback', await waitFor(async () => (await q('.empty-state')).length > 0), await q('.view'));
    check('still on the gradebook (never navigated away)', page.url() === BASE, page.url());
    check('hidden frames cleaned up', (await page.evaluate(() => document.querySelectorAll('iframe').length)) === 0);

    await click('.side [data-view=more]');
    await click('.tile[data-page="Test Scores"]');
    check('page whose address carries the session loads', await waitFor(async () => (await q('.table-card')).some((t) => t.includes('FAST Math'))), await q('.view'));

    // Pressing Esc in a filled search box clears it instead of closing the app.
    await click('.side [data-view=grades]');
    await page.locator('#skyward-glow-host .search').fill('bio');
    await page.locator('#skyward-glow-host .search').press('Escape');
    check('Esc in search does not close the app', await page.evaluate(() => !!document.getElementById('skyward-glow-host')));

    // Switching terms quickly keeps each term's assignments separate.
    await page.locator('#skyward-glow-host .search').fill('');
    await click('.card', 0);
    await click('.drawer .chip[data-dterm="Q1"]');
    await waitFor(async () => (await q('.asg')).length > 0, 10000);
    check('quick term switch still loads assignments', (await q('.drawer-body h3'))[0] === 'Q1 assignments' && (await q('.asg')).length > 0, await q('.drawer-body'));
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    check('mobile tab bar visible', await page.locator('#skyward-glow-host .tabbar').isVisible());
    check('mobile shows version', (await q('.mtop .ver'))[0] === 'v' + VERSION);

    await page.keyboard.press('Escape');
    check('Esc closes the app', await page.evaluate(() => !document.getElementById('skyward-glow-host')));
    check('no script errors', errors.length === 0, errors);
    await page.close();

    console.log('Strict Skyward (menu ignores background clicks)');
    ({ page, errors, q, click } = await openApp(browser, BASE + '?strict=1'));
    await click('.side [data-view=attendance]');
    check('attendance loads by posting the session', await waitFor(async () => (await q('.stat')).some((s) => s.startsWith('Tardy2'))), await q('.view'));
    await click('.side [data-view=schedule]');
    check('schedule loads too', await waitFor(async () => (await q('.table-card')).length > 0), await q('.view'));
    await click('.side [data-act=report]');
    const report = await page.evaluate(() => document.getElementById('skyward-glow-host').shadowRoot.querySelector('.report textarea').value);
    check('report says which loader worked', /Attendance: direct worked/.test(report), report.split('\n').slice(0, 5));
    check('report has field names but no session values', report.includes('encses') && !report.includes('mock123'));
    check('report leaves out grid state fields', !report.includes('gridSortState'));
    check('still on the gradebook', page.url() === BASE + '?strict=1', page.url());
    check('no script errors', errors.length === 0, errors);
    await page.close();

    // Eastern time, so the Nov 1 daylight saving change falls inside Q2.
    console.log('Countdowns (Mon Oct 19, 2026, 10:00 AM Eastern)');
    ({ page, errors, q, click } = await openApp(browser, BASE, undefined, new Date('2026-10-19T10:00:00-04:00'), 'America/New_York'));
    check('Q2 picked from the calendar', (await q('.hero .sub'))[0]?.includes('Q2'));
    // Seconds left on the quarter countdown, read back from the screen.
    const left = async () => {
      const [d, h, m, sec] = (await q('.qclock.current .cd')).map((t) => parseInt(t, 10));
      return ((d * 24 + h) * 60 + m) * 60 + sec;
    };
    const expected = 60 * 86400 + 4 * 3600 + 10 * 60; // to Dec 18, 2:10 PM (last bell) by the calendar: 60 days 4:10
    const before = await left();
    check('Q2 counts down to Dec 18 after the last bell', Math.abs(before - expected) <= 5, { before, expected });
    check('Q2 progress shown', (await q('.qclock-sub'))[0]?.includes('% done'));
    await page.clock.runFor(3000);
    const after = await left();
    check('countdown ticks every second', before - after >= 2 && before - after <= 4, { before, after });
    check('current class shows time left', /^3:5\d left$/.test((await q('.now-live'))[0] || ''), await q('.now-live'));
    await click('.glance .seg-btn[data-term="Q1"]');
    check('Q1 shows as over', (await q('.qclock.past .qclock-sub'))[0]?.startsWith('Ended'), await q('.glance'));
    await click('.glance .seg-btn[data-term="Q3"]');
    check('Q3 shows when it starts', (await q('.qclock.future .qclock-label'))[0] === 'Q3 starts in', await q('.glance'));
    await page.clock.runFor(4 * 60 * 1000);
    check('class change re-renders the card into lunch', (await q('.now h3'))[0] === 'Right now' && (await q('.now-big'))[0] === 'Lunch B', await q('.now'));
    check('lunch counts down', /^33:\d\d left$/.test((await q('.now-live'))[0] || ''), await q('.now-live'));
    await page.clock.runFor(34 * 60 * 1000);
    check('card flips to "Right now" when the bell rings', (await q('.now h3'))[0] === 'Right now' && (await q('.now-big'))[0] === 'Biology 1', await q('.now'));
    check('no script errors', errors.length === 0, errors);
    await page.close();

    console.log('SWARM day (Tue Oct 20, 2026, 9:00 AM Eastern)');
    ({ page, errors, q, click } = await openApp(browser, BASE, undefined, new Date('2026-10-20T09:00:00-04:00'), 'America/New_York'));
    await page.evaluate(() => localStorage.removeItem('skywardGlow:bells'));
    await click('.side [data-view=schedule]');
    // B lunch (from "4B" in Skyward) gets Weeki Wachee's real SWARM-day times.
    const official = await page.evaluate(() => [...document.getElementById('skyward-glow-host').shadowRoot.querySelectorAll('.slot')]
      .map((li) => li.querySelector('.slot-time b').textContent + '-' + li.querySelector('.slot-time small').textContent + ' ' + li.querySelector('.slot-card b').textContent));
    check('official SWARM-day times for B lunch', JSON.stringify(official) === JSON.stringify([
      '7:19 AM-8:10 AM English 1', '8:14 AM-8:58 AM Pre-Advanced Placement World History and Geography', '9:02 AM-9:46 AM Forensic Science 1',
      '9:50 AM-10:28 AM SWARM', '10:28 AM-10:58 AM Lunch B', '10:58 AM-11:16 AM Biology 1', '11:20 AM-11:46 AM Biology 1',
      '11:50 AM-12:34 PM Leadership Skills Development', '12:38 PM-1:22 PM Spanish 1', '1:26 PM-2:10 PM Geometry']), official);
    check('labeled as the school\'s times', (await q('.sched-note'))[0]?.startsWith('Weeki Wachee'), await q('.sched-note'));
    check('every slot has a subject icon', (await q('.slot-icon')).length === 10 && (await q('.slot-icon'))[3] === '🐝' && (await q('.slot-icon'))[4] === '🍔', await q('.slot-icon'));
    check('a "now" line sits between 2nd and 3rd period at 9:00', await page.evaluate(() => {
      const li = document.getElementById('skyward-glow-host').shadowRoot.querySelector('.now-line');
      return !!li && li.nextElementSibling.textContent.includes('Forensic') && li.textContent.includes('9:00 AM');
    }));
    await click('.side [data-view=home]');
    check('home: Forensic Science is up next at 9:00', (await q('.now-big'))[0] === 'Forensic Science 1' && /starts in 1:5\d/.test((await q('.now-live'))[0] || ''), await q('.now'));

    // Other lunches have no official times yet, so they get the estimate.
    await page.evaluate(() => localStorage.setItem('skywardGlow:bells', JSON.stringify({ lunch: 'C' })));
    await page.evaluate(CODE); await page.evaluate(CODE); await page.waitForTimeout(600);
    await click('.side [data-view=schedule]');
    check('Tue/Thu tab picked on a Tuesday', (await q('.sched-bar .seg-btn.on'))[0] === 'Tue · Thu · SWARM', await q('.sched-bar'));
    const tue = await q('.slot .slot-card b');
    check('SWARM day has 7 classes, SWARM and lunch', tue.length === 9 && tue.includes('SWARM') && tue.includes('Lunch C'), tue);
    check('SWARM shows the Period 8 teacher', (await q('.slot-swarm .slot-card small'))[0] === 'Daniel Reyes', await q('.slot-swarm'));
    check('estimated times are labeled', (await q('.sched-note.warn')).length === 1);
    const times = await page.evaluate(() => [...document.getElementById('skyward-glow-host').shadowRoot.querySelectorAll('.slot-time')]
      .map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent]));
    check('SWARM day keeps the first and last bell', times[0][0] === '7:19 AM' && times[times.length - 1][1] === '2:10 PM', times);
    const toMin = (t) => { const [h, m] = t.split(/[: ]/); return (parseInt(h, 10) % 12 + (/PM/.test(t) ? 12 : 0)) * 60 + parseInt(m, 10); };
    check('SWARM day slots never overlap', times.every((t, i) => toMin(t[0]) < toMin(t[1]) && (i === 0 || toMin(times[i - 1][1]) <= toMin(t[0]))), times);
    await click('.side [data-view=home]');
    check('home card follows the SWARM-day times', (await q('.now-big'))[0] === 'SWARM', await q('.now'));
    await click('.side [data-view=schedule]');

    // Enter real times in the editor.
    await click('[data-act="edit-times"]');
    const rowNames = await q('.edit-name');
    const swarmRow = rowNames.indexOf('SWARM (Period 8)');
    check('editor lists every slot', rowNames.length === 9 && swarmRow > -1, rowNames);
    const inputs = (edge) => page.locator('#skyward-glow-host .t-in[data-edge="' + edge + '"]');
    await inputs('end').nth(swarmRow).fill('08:00');
    await inputs('start').nth(swarmRow).fill('09:00');
    await click('[data-act="save-times"]');
    check('backwards times are refused', (await q('.editor .sched-note.warn'))[0]?.includes('start time before'), await q('.editor'));
    // Moving SWARM after period 3's estimated start creates an overlap, which is refused.
    await inputs('start').nth(swarmRow).fill('09:20'); await inputs('end').nth(swarmRow).fill('09:50');
    await click('[data-act="save-times"]');
    check('overlapping times are refused', (await q('.editor .sched-note.warn'))[0]?.includes('overlap'), await q('.editor .sched-note.warn'));
    // The arrows reorder rows.
    const beforeMove = await q('.edit-name');
    await click('[data-move="' + swarmRow + '"][data-dir="-1"]');
    const afterMove = await q('.edit-name');
    check('arrow moves SWARM up one row', afterMove[swarmRow - 1] === 'SWARM (Period 8)' && afterMove[swarmRow] === beforeMove[swarmRow - 1], afterMove);
    check('typed times survive a move', (await inputs('start').nth(swarmRow - 1).inputValue()) === '09:20');
    await click('[data-act="cancel-times"]');
    await click('[data-act="edit-times"]');
    await click('[data-act="reset-times"]');
    check('reset brings back the estimate', (await q('.edit-name')).length === 9);
    await click('[data-act="cancel-times"]');

    // A full valid day saves and survives running the bookmark again.
    await page.evaluate(() => localStorage.setItem('skywardGlow:bells', JSON.stringify({ swarm: [
      { kind: 'class', period: '1', start: 439, end: 485 }, { kind: 'class', period: '2', start: 489, end: 535 },
      { kind: 'swarm', period: '8', start: 539, end: 569 }, { kind: 'class', period: '3', start: 573, end: 619 },
      { kind: 'lunch', start: 619, end: 653 }, { kind: 'class', period: '4', start: 653, end: 699 },
      { kind: 'class', period: '5', start: 703, end: 749 }, { kind: 'class', period: '6', start: 753, end: 799 },
      { kind: 'class', period: '7', start: 803, end: 850 }] })));
    await page.evaluate(CODE); await page.evaluate(CODE); await page.waitForTimeout(600);
    await click('.side [data-view=schedule]');
    check('saved times are used', (await q('.sched-note'))[0] === 'Using the times you entered.', await q('.sched-note'));
    check('saved SWARM time shown', (await q('.slot-swarm .slot-time'))[0] === '8:59 AM9:29 AM', await q('.slot-swarm .slot-time'));
    check('right now is SWARM at 9:00 Tuesday', await (async () => { await click('.side [data-view=home]'); return (await q('.now-big'))[0] === 'SWARM'; })(), await q('.now'));
    await click('.side [data-view=schedule]');
    await page.locator('#skyward-glow-host .lunch-select').selectOption('C');
    check('changing lunch relabels it', (await q('.slot .slot-card b')).includes('Lunch C'));
    await click('.sched-bar [data-sched="regular"]');
    check('can still view the Mon/Wed/Fri schedule', !(await q('.slot .slot-card b')).includes('SWARM'));
    check('no script errors', errors.length === 0, errors);
    await page.evaluate(() => localStorage.removeItem('skywardGlow:bells'));
    await page.close();

    console.log('Schedule edge cases');
    {
      // Typed times survive a redraw (here: switching theme mid-edit).
      ({ page, errors, q, click } = await openApp(browser, BASE, undefined, new Date('2026-10-20T09:00:00-04:00'), 'America/New_York'));
      await click('.side [data-view=schedule]');
      await click('[data-act="edit-times"]');
      const first = page.locator('#skyward-glow-host .t-in[data-edge="start"]').first();
      await first.fill('07:01');
      await click('.side [data-act=theme]');
      check('typed time survives a redraw', (await page.locator('#skyward-glow-host .t-in[data-edge="start"]').first().inputValue()) === '07:01');
      // Remove and add rows.
      const n = (await q('.edit-name')).length;
      await click('[data-remove="0"]');
      check('a row can be removed', (await q('.edit-name')).length === n - 1);
      await click('[data-add="class"][data-period="1"]');
      check('a removed period can be added back', (await q('.edit-name')).includes('Period 1') && (await q('.edit-name')).length === n);
      check('no script errors', errors.length === 0, errors);
      await page.close();

      // A damaged save can't stop the app from starting.
      ({ page, errors, q, click } = await openApp(browser, BASE, undefined, new Date('2026-10-20T09:00:00-04:00'), 'America/New_York'));
      await page.evaluate(() => localStorage.setItem('skywardGlow:bells', JSON.stringify({ regular: 'x', swarm: [null, { kind: 'class', start: 'a' }], lunch: 5 })));
      await page.evaluate(CODE); await page.evaluate(CODE); await page.waitForTimeout(600);
      check('app starts with damaged saved times', (await q('.stat')).length === 4, await q('.view'));
      check('falls back to the school times', await (async () => { await click('.side [data-view=schedule]'); return (await q('.sched-note'))[0]?.startsWith('Weeki Wachee'); })());
      check('no script errors', errors.length === 0, errors);
      await page.evaluate(() => localStorage.removeItem('skywardGlow:bells'));
      await page.close();

      // Two courses in the same period (semester classes) count once.
      ({ page, errors, q, click } = await openApp(browser, BASE + '?nodefault', undefined, new Date('2026-10-19T09:00:00-04:00'), 'America/New_York'));
      await page.evaluate(() => {
        document.getElementById('skyward-glow-host').remove();
        document.getElementById('left').insertAdjacentHTML('beforeend', '<tr><td scope="row" colspan="2"><div class="gb_classDesc"><span class="bld classDesc"><a>FORENSIC SCIENCE 2</a></span> <label class="bld">Period</label> 3 <span class="fXs">(9:14 AM - 10:04 AM)</span> <a>Sarah Santiago</a></div></td></tr>');
        document.getElementById('right').insertAdjacentHTML('beforeend', '<tr><td>&nbsp;</td></tr>');
      });
      await page.evaluate(CODE); await page.waitForTimeout(600);
      await click('.side [data-view=schedule]');
      const mon = await q('.slot .slot-card b');
      check('shared period shows once', mon.filter((t) => /Forensic/.test(t)).length === 1 && mon.length === 8, mon);
      await click('.sched-bar [data-sched="swarm"]');
      check('SWARM day unaffected', (await q('.slot .slot-card b')).length === 10);
      check('no script errors', errors.length === 0, errors);
      await page.close();

      // No class times in Skyward: the editor still lists every period.
      ({ page, errors, q, click } = await openApp(browser, BASE + '?nodefault', undefined, new Date('2026-10-19T09:00:00-04:00'), 'America/New_York'));
      await page.evaluate(() => {
        document.getElementById('skyward-glow-host').remove();
        document.querySelectorAll('.fXs').forEach((e) => e.remove());
        document.querySelectorAll('#left td').forEach((td) => { td.innerHTML = td.innerHTML.replace(/\([^)]*(AM|PM)[^)]*\)/g, ''); });
      });
      await page.evaluate(CODE); await page.waitForTimeout(600);
      await click('.side [data-view=schedule]');
      check('no times: explains how to add them', (await q('.empty'))[0]?.includes('Edit times'), await q('.view'));
      await click('[data-act="edit-times"]');
      const names = await q('.edit-name');
      check('no times: editor lists every period and lunch', names.length === 8 && names.includes('Lunch') && names.includes('Period 7'), names);
      await click('[data-act="save-times"]');
      await click('[data-remove="0"]');
      check('no times: removed period offered back', (await q('.editor-add button')).includes('+ Period 1'), await q('.editor-add'));
      check('no times: blank rows must be filled first', (await q('.editor .sched-note.warn'))[0]?.includes('needs a start time'), await q('.editor'));
      check('no script errors', errors.length === 0, errors);
      await page.close();
    }

    for (const [name, device] of [['iPhone', devices['iPhone 13']], ['Android', devices['Pixel 7']]]) {
      console.log(name + ' (Skyward desktop page, no phone viewport)');
      const ctx = await browser.newContext(Object.assign({}, device, { timezoneId: 'America/New_York' }));
      const p3 = await ctx.newPage();
      const errs = [];
      p3.on('pageerror', (e) => errs.push(e.message));
      await p3.route('https://loganwestlake.github.io/**', (r) => r.fulfill({ status: 200, body: "const VERSION = '0.0.1';" }));
      // The phone bookmark: grab it from the install page and run it on Skyward.
      await p3.goto('http://localhost:' + PORT + '/');
      check('install page shows ' + name + ' steps', await p3.evaluate((n) =>
        document.querySelector('[data-platform][aria-selected="true"]').dataset.platform === n, name === 'iPhone' ? 'ios' : 'android'));
      const loader = await p3.evaluate(() => loader);
      check('phone bookmark is short', loader.length < 700, loader.length);
      // Tapped from a page that isn't Skyward (like the start page), it opens Skyward's sign-in.
      await p3.route('https://skyward.iscorp.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Skyward sign-in</title><input type="password">' }));
      await p3.goto('http://127.0.0.1:' + PORT + '/test/pages/sfschedule001.html');
      await Promise.all([p3.waitForURL(/skyward\.iscorp\.com\/p12eduhernandocofl\/web\/seplog01\.w\?nopopup=true/, { timeout: 10000 }),
        p3.evaluate((code) => (0, eval)(code.replace(/^javascript:/, '')), loader)]);
      check('off Skyward, the bookmark opens your sign-in page', true);
      // Tapped on the sign-in page, it says to sign in first.
      await p3.goto('http://localhost:' + PORT + '/test/seplog01.html');
      await p3.evaluate((code) => (0, eval)(code.replace(/^javascript:/, '')), loader);
      await p3.waitForSelector('#skyward-glow-host-toast', { timeout: 10000 });
      check('on the sign-in page it says to sign in first', (await p3.textContent('#skyward-glow-host-toast')).includes('Sign in first') &&
        !(await p3.evaluate(() => document.getElementById('skyward-glow-host'))));
      await p3.goto(BASE);
      const before = await p3.evaluate(() => window.innerWidth);
      await p3.evaluate((code) => (0, eval)(code.replace(/^javascript:/, '')), loader);
      await p3.waitForFunction(() => document.getElementById('skyward-glow-host'), null, { timeout: 10000 });
      await p3.waitForTimeout(800);
      const after = await p3.evaluate(() => window.innerWidth);
      check('app fills the phone screen (' + before + 'px → ' + after + 'px)', after === device.viewport.width && before > after, { before, after });
      const tab = p3.locator('#skyward-glow-host .tabbar [data-view=schedule]');
      check('bottom tab bar shown', await tab.isVisible());
      await tab.tap();
      check('tapping a tab works', (await p3.evaluate(() => document.getElementById('skyward-glow-host').shadowRoot.querySelector('.page-head h1').textContent)) === 'Schedule');
      const sizes = await p3.evaluate(() => {
        const r = document.getElementById('skyward-glow-host').shadowRoot;
        return { icon: r.querySelector('.mtop .icon-btn').getBoundingClientRect().height, wide: r.querySelector('.main').scrollWidth <= window.innerWidth };
      });
      check('tap targets at least 44px', sizes.icon >= 44, sizes);
      check('no sideways scrolling', sizes.wide, sizes);
      await p3.locator('#skyward-glow-host .mtop [data-act=close]').tap();
      await p3.waitForTimeout(300);
      const back = await p3.evaluate(() => ({ width: window.innerWidth, overflow: document.body.style.overflow }));
      check('closing restores Skyward\'s own zoom', back.width === before && back.overflow === '', back);
      // And opening it again still fills the screen.
      await p3.evaluate((code) => (0, eval)(code.replace(/^javascript:/, '')), loader);
      await p3.waitForFunction(() => document.getElementById('skyward-glow-host'), null, { timeout: 10000 });
      await p3.waitForTimeout(500);
      check('reopening fills the screen again', (await p3.evaluate(() => window.innerWidth)) === device.viewport.width);
      check('no script errors', errs.length === 0, errs);
      await ctx.close();
    }

    // A userscript extension runs the script once each page has loaded, in
    // the top window only (@noframes). This context does the same.
    async function userscriptContext(device) {
      const ctx = await browser.newContext(Object.assign({}, device || { viewport: { width: 1360, height: 900 } }, { timezoneId: 'America/New_York' }));
      await ctx.addInitScript({ content: 'if (window.top === window) window.addEventListener("load", function () {\n' + USERSCRIPT + '\n});' });
      await ctx.route('https://loganwestlake.github.io/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CODE }));
      return ctx;
    }
    const hostOn = (pg) => pg.evaluate(() => !!document.getElementById('skyward-glow-host') && document.getElementById('skyward-glow-host').style.display !== 'none');
    const pillOn = (pg) => pg.evaluate(() => { const b = document.getElementById('skyward-glow-host-open'); return !!b && b.style.display !== 'none'; });

    for (const [name, device] of [['computer', null], ['iPhone', devices['iPhone 13']]]) {
      console.log('Auto-open after signing in (' + name + ')');
      const ctx = await userscriptContext(device);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto('http://localhost:' + PORT + '/test/seplog01.html');
      await pg.waitForSelector('#skyward-glow-host-hint');
      check('sign-in page shows the hint', (await pg.textContent('#skyward-glow-host-hint')).includes('after you sign in'));
      check('Glow does not open on the sign-in page', !(await hostOn(pg)));
      await pg.fill('#login', 'student');
      await pg.fill('#password', 'secret');
      await pg.click('#bSignIn');
      await pg.waitForURL(/mock-gradebook\.html/, { timeout: 15000 });
      check('after signing in it goes to the Gradebook', true);
      await pg.waitForFunction(() => document.getElementById('skyward-glow-host'), null, { timeout: 15000 });
      await pg.waitForTimeout(1200);
      const cards = await pg.evaluate(() => { const r = document.getElementById('skyward-glow-host').shadowRoot; return r.querySelectorAll('.stat').length; });
      check('Glow opens by itself with your grades', cards === 4, cards);
      check('only one app on the page', await pg.evaluate(() => document.querySelectorAll('#skyward-glow-host').length === 1));

      // Closing it sticks for this visit; the ✦ Glow button brings it back.
      const closeSel = device ? '#skyward-glow-host .mtop [data-act=close]' : '#skyward-glow-host .side [data-act=close]';
      await pg.locator(closeSel).click();
      await pg.waitForTimeout(1200);
      check('closing shows the ✦ Glow button', !(await hostOn(pg)) && await pillOn(pg));
      await pg.reload();
      await pg.waitForTimeout(2500);
      check('closed stays closed on reload', !(await hostOn(pg)) && await pillOn(pg));
      await pg.click('#skyward-glow-host-open');
      await pg.waitForFunction(() => document.getElementById('skyward-glow-host'), null, { timeout: 10000 });
      await pg.waitForTimeout(800);
      check('✦ Glow reopens it', await hostOn(pg) && !(await pillOn(pg)));

      // Visiting another Skyward page later doesn't redirect anywhere.
      await pg.goto('http://localhost:' + PORT + '/test/sfhome01.html');
      await pg.waitForTimeout(2000);
      // A change-password box isn't the sign-in page.
      await pg.goto('http://localhost:' + PORT + '/test/sfhome01.html?pw=1');
      await pg.waitForTimeout(1500);
      check('change-password box is not treated as sign-in', !(await pg.evaluate(() => document.getElementById('skyward-glow-host-hint'))) && await pillOn(pg));
      // Closed earlier, timed out, signed in again, landed on the Gradebook: opens.
      await pg.evaluate(() => sessionStorage.setItem('skywardGlow:dismissed', '1'));
      await pg.goto('http://localhost:' + PORT + '/test/seplog01.html');
      await pg.waitForSelector('#skyward-glow-host-hint');
      await pg.goto(BASE);
      await pg.waitForFunction(() => document.getElementById('skyward-glow-host'), null, { timeout: 10000 });
      check('signing in again resets "closed"', await hostOn(pg));
      await pg.goto('http://localhost:' + PORT + '/test/sfhome01.html');
      await pg.waitForTimeout(2000);
      check('later visits to Home stay on Home', /sfhome01\.html/.test(pg.url()) && !(await hostOn(pg)) && await pillOn(pg), pg.url());
      check('no script errors', errs.length === 0, errs);
      await ctx.close();
    }

    console.log('Install page on a computer');
    {
      const p4 = await browser.newPage();
      await p4.goto('http://localhost:' + PORT + '/');
      await p4.waitForFunction(() => document.getElementById('ver').textContent.startsWith('v'));
      check('computer steps shown', await p4.evaluate(() => document.querySelector('[data-for="computer"]').hidden === false && document.querySelector('[data-for="ios"]').hidden));
      check('install page shows ' + VERSION, (await p4.textContent('#ver')) === 'v' + VERSION);
      check('userscript version matches the app', (USERSCRIPT.match(/@version\s+([\d.]+)/) || [])[1] === VERSION);
      check('userscript only runs on Skyward, never in frames', /@match\s+https:\/\/skyward\.iscorp\.com\/\*/.test(USERSCRIPT) && /@noframes/.test(USERSCRIPT));
      const links = await p4.evaluate(() => ({
        install: [...document.querySelectorAll('a[href="skyward-glow.user.js"]')].length,
        skyward: [...document.querySelectorAll('a')].filter((a) => a.href === 'https://skyward.iscorp.com/p12eduhernandocofl/web/seplog01.w?nopopup=true').length
      }));
      check('install page needs no apps (no userscript steps)', links.install === 0, links);
      check('install page links your Skyward sign-in', links.skyward >= 1, links);
      check('brand is Better Skyward', (await p4.title()) === 'Better Skyward' && (await p4.textContent('h1')).startsWith('Better Skyward'));
      // The computer bookmark: off Skyward it opens the sign-in page.
      const drag = await p4.getAttribute('#bookmarklet', 'href');
      check('computer bookmark is labeled Better Skyward', (await p4.textContent('#bookmarklet')).startsWith('✦ Better Skyward'));
      check('computer bookmark sends you to Skyward when off Skyward', decodeURIComponent(drag).includes("location.href='https://skyward.iscorp.com/p12eduhernandocofl/web/seplog01.w?nopopup=true'"));
      const served = await p4.request.get('http://localhost:' + PORT + '/skyward-glow.user.js');
      check('userscript file is served', served.ok() && (await served.text()).includes('==UserScript=='));
      await p4.close();
    }

    console.log('Run again while starting up');
    {
      const p2 = await browser.newPage();
      const errs = [];
      p2.on('pageerror', (e) => errs.push(e.message));
      await p2.goto(BASE);
      // With the grades gone, startup waits on loading the Gradebook in the
      // background; the second run lands in that gap and turns the app off.
      await p2.evaluate(() => document.querySelectorAll('#showGradeInfo, .classDesc').forEach((e) => e.remove()));
      await p2.evaluate((code) => { (0, eval)(code); setTimeout(() => (0, eval)(code), 300); }, CODE);
      await p2.waitForTimeout(6000);
      check('app stays closed', await p2.evaluate(() => !document.getElementById('skyward-glow-host')));
      await p2.keyboard.press('Escape'); // a leaked listener from the first run would throw here
      check('no leftover Esc or timer errors', errs.length === 0, errs);
      await p2.close();
    }

    console.log('Two pages at once');
    for (const strict of [false, true]) {
      ({ page, errors, q, click } = await openApp(browser, BASE + (strict ? '?strict=1' : '')));
      await click('.side [data-view=schedule]');
      await click('.side [data-view=attendance]');
      check((strict ? 'strict: ' : '') + 'attendance loads while schedule is loading',
        await waitFor(async () => (await q('.stat')).some((s) => s.startsWith('Tardy2')), 25000), await q('.view'));
      await click('.side [data-view=schedule]');
      check((strict ? 'strict: ' : '') + 'schedule loaded too', await waitFor(async () => (await q('.table-card')).length > 0, 25000));
      check((strict ? 'strict: ' : '') + 'Skyward form methods restored', await page.evaluate(() =>
        HTMLFormElement.prototype.submit.toString().includes('[native code]') && window.open.toString().includes('[native code]')));
      check((strict ? 'strict: ' : '') + 'no script errors', errors.length === 0, errors);
      await page.close();
    }

    console.log('Running the bookmark again');
    ({ page, errors, q, click } = await openApp(browser, BASE));
    await page.evaluate(CODE); // off
    check('second run turns it off', await page.evaluate(() => !document.getElementById('skyward-glow-host')));
    await page.evaluate(CODE); // on again
    await page.waitForTimeout(800);
    await click('.side [data-view=grades]');
    await click('.card', 0);
    await page.keyboard.press('Escape');
    check('Esc closes only the class panel, not the app', await page.evaluate(() => !!document.getElementById('skyward-glow-host')));
    await click('.side [data-act=report]');
    await page.keyboard.press('Escape');
    check('Esc closes the report panel first', await page.evaluate(() =>
      !!document.getElementById('skyward-glow-host') && !document.getElementById('skyward-glow-host').shadowRoot.querySelector('.report')));
    check('no script errors', errors.length === 0, errors);
    await page.close();

    console.log('Logged out (session rejected)');
    ({ page, errors, q, click } = await openApp(browser, BASE + '?strict=1'));
    await page.evaluate(() => { document.querySelector('input[name=encses]').value = 'expired'; });
    await click('.side [data-view=attendance]');
    check('says Skyward wants a new login', await waitFor(async () => (await q('.empty-state')).some((t) => /log in again/i.test(t))), await q('.view'));
    check('no script errors', errors.length === 0, errors);
    await page.close();

    console.log('Not on the gradebook');
    ({ page, errors, q, click } = await openApp(browser, 'http://localhost:' + PORT + '/test/pages/sfschedule001.html'));
    await click('.side [data-view=grades]');
    check('explains how to get grades', (await q('.empty-state h3'))[0] === 'No grades found', await q('.view'));
    check('no script errors', errors.length === 0, errors);
    await page.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
