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
const { chromium } = require('playwright');

const PORT = 8790;
const BASE = 'http://localhost:' + PORT + '/test/mock-gradebook.html';
const CODE = fs.readFileSync(path.join(__dirname, '..', 'glow.js'), 'utf8');
const VERSION = CODE.match(/const VERSION = '([\d.]+)'/)[1];

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  →  ' + JSON.stringify(detail)));
  if (!ok) failures++;
}

async function openApp(browser, url, viewport = { width: 1360, height: 900 }, time) {
  const page = await browser.newPage({ viewport });
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
    let { page, errors, q, click } = await openApp(browser, BASE);
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
    const cards = await q('.card h2');
    check('7 class cards', cards.length === 7, cards);
    check('teachers read', (await q('.card .teacher')).length === 7);
    check('sorted by period', cards[0] === 'English 1' && cards[6] === 'Geometry', cards);

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
    check('7 timeline slots', (await q('.slot')).length === 7);
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
    check('More shows version', (await q('.version-note'))[0] === 'Skyward Glow v' + VERSION);
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

    console.log('Countdowns (Mon Oct 19, 2026, 10:00 AM)');
    ({ page, errors, q, click } = await openApp(browser, BASE, undefined, new Date(2026, 9, 19, 10, 0, 0)));
    check('Q2 picked from the calendar', (await q('.hero .sub'))[0]?.includes('Q2'));
    // Seconds left on the quarter countdown, read back from the screen.
    const left = async () => {
      const [d, h, m, sec] = (await q('.qclock.current .cd')).map((t) => parseInt(t, 10));
      return ((d * 24 + h) * 60 + m) * 60 + sec;
    };
    const expected = (new Date(2026, 11, 18, 14, 10) - new Date(2026, 9, 19, 10, 0)) / 1000; // last bell is 2:10 PM
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
    check('class change re-renders the card', (await q('.now h3'))[0] === 'Today' && (await q('.now-big'))[0] === 'Biology 1', await q('.now'));
    check('no script errors', errors.length === 0, errors);
    await page.close();

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
