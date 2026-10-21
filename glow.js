/*
 * Better Skyward — a better-looking Skyward Family Access.
 *
 * How to use: log in to Skyward (the Gradebook page works best), then run
 * this script from a bookmark or paste it into the browser console
 * (F12 → Console). It reads what Skyward already shows you and draws a new
 * app on top: Home, Grades, Schedule, Attendance and the rest of Skyward's
 * menu. Your data only goes between the browser and Skyward; the one
 * other request reads the published version number to offer updates.
 * Run it again (or press Esc / "Original") to get back to plain Skyward.
 */
(async function () {
  'use strict';

  // Bump on every change. The install page and the app both show it, and
  // the app compares it with the published copy to offer updates.
  const VERSION = '2.4.0';
  const UPDATE_URL = 'https://loganwestlake.github.io/betterskyward/glow.js';
  const INSTALL_URL = 'https://loganwestlake.github.io/betterskyward/';

  const HOST_ID = 'skyward-glow-host';
  const SNAP_KEY = 'skywardGlow:lastSnapshot';
  const THEME_KEY = 'skywardGlow:theme';

  // Running it again turns it off. Use the earlier run's own teardown so its
  // listeners go away too.
  if (document.getElementById(HOST_ID)) {
    if (typeof window.__skywardGlowTeardown === 'function') window.__skywardGlowTeardown(); else teardown();
    return;
  }

  // The browser's own page-changing methods, saved once so overlapping
  // background loads can never leave Skyward stuck with our stand-ins.
  const NATIVE = window.__skywardGlowNatives = window.__skywardGlowNatives || {
    submit: HTMLFormElement.prototype.submit,
    requestSubmit: HTMLFormElement.prototype.requestSubmit,
    open: window.open
  };

  // ================================================================ utils

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, digits = 1) => (n == null || isNaN(n) ? '—' : n.toFixed(digits));
  const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; } // storage can be blocked; everything still works without it
  }

  function letterFor(n) {
    if (n == null) return null;
    return n >= 90 ? 'A' : n >= 80 ? 'B' : n >= 70 ? 'C' : n >= 60 ? 'D' : 'F';
  }

  function parseGrade(text) {
    const t = clean(text);
    const num = t.match(/-?\d+(\.\d+)?/);
    const letter = t.match(/\b([A-F][+-]?)\b/);
    return {
      raw: t,
      score: num ? parseFloat(num[0]) : null,
      letter: letter ? letter[1] : (num ? letterFor(parseFloat(num[0])) : null)
    };
  }

  function titleCase(s) {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\b(Ap|Ib|Aice|Ese|Pe|Jrotc|Ii|Iii|Iv)\b/g, (m) => m.toUpperCase())
      .replace(/\bHon\b/g, 'Honors');
  }

  function isVisible(el) {
    return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ICON = ICONS();

  // On the sign-in page there's nothing to show yet.
  if (isSignInPage()) { signInToast(); return; }

  function isSignInPage() {
    const pw = document.querySelector('input[type="password"]');
    return !!pw && isVisible(pw) && !document.querySelector('#sf_navMenu, a[data-nav], a[id="showGradeInfo"], a[data-lit]');
  }

  function signInToast() {
    const old = document.getElementById(HOST_ID + '-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = HOST_ID + '-toast';
    t.setAttribute('role', 'status');
    t.textContent = '✦ Sign in first, then run Better Skyward again.';
    t.style.cssText = 'position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483647;' +
      'max-width:calc(100% - 32px);padding:12px 18px;border-radius:14px;font:600 15px -apple-system,system-ui,sans-serif;color:#0A0A0A;' +
      'background:linear-gradient(135deg,#F59E0B,#EA580C);box-shadow:0 10px 30px rgba(234,88,12,.45);text-align:center;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ============================================================ gradebook

  function gradeLinks(root) {
    return $$(root, 'a[id="showGradeInfo"], a[data-lit]');
  }

  // The nearest ancestor of the grade table that also holds class names.
  function gridFor(tr) {
    const body = tr.ownerDocument.body;
    let node = tr.closest('table').parentElement;
    while (node && node !== body && !node.querySelector('.classDesc, .gb_classDesc')) node = node.parentElement;
    return node || body;
  }

  // Skyward splits each grade grid into a frozen left table (class names)
  // and a scrolling right table (grades). Rows line up by position, so for
  // each grade row we look for the class description in the matching row
  // of any sibling table inside the same grid.
  function describeRow(tr, grid) {
    let info = classInfo(tr);
    if (info) return info;
    const idx = Array.prototype.indexOf.call(tr.parentElement.children, tr);
    for (const table of $$(grid, 'table')) {
      if (table.contains(tr)) continue;
      const bodies = table.tBodies.length ? Array.from(table.tBodies) : [table];
      for (const body of bodies) {
        const row = body.children[idx];
        if (row && row.tagName === 'TR' && (info = classInfo(row))) return info;
      }
    }
    return null;
  }

  function classInfo(row) {
    const desc = row.querySelector('.classDesc') || row.querySelector('.gb_classDesc, [class*="classDesc"]');
    if (!desc) return null;
    const cell = desc.closest('td, th') || desc.parentElement;
    const nameEl = desc.querySelector('a') || desc;
    const name = clean(nameEl.textContent);
    if (!name) return null;
    // Period, time and teacher usually sit in the same cell as the class
    // name, but some districts spread them across the row.
    let period = '', time = '', teacher = '';
    for (const scope of [cell, row]) {
      const text = clean(scope.textContent);
      period = period || (text.match(/Period\s*([\w-]+)/i) || [])[1] || '';
      time = time || (text.match(/\(([^)]*(?:AM|PM)[^)]*)\)/i) || [])[1] || '';
      teacher = teacher || teacherLink(scope, nameEl) ||
        (text.match(/(?:AM|PM)\s*\)\s*([A-Za-z][A-Za-z.'’ -]*[A-Za-z])/) || [])[1] || '';
    }
    return { name: titleCase(name), teacher, period, time };
  }

  function teacherLink(scope, nameEl) {
    const links = $$(scope, 'a');
    for (let i = links.length - 1; i >= 0; i--) {
      const t = clean(links[i].textContent);
      if (links[i] !== nameEl && !links[i].contains(nameEl) && t && !/\d/.test(t)) return t;
    }
    return '';
  }

  function termFromHeader(a) {
    const td = a.closest('td');
    const table = td && td.closest('table');
    if (!table || !table.tHead) return '';
    const th = table.tHead.querySelectorAll('th')[td.cellIndex];
    return th ? clean(th.textContent) : '';
  }

  function studentName(doc) {
    const el = doc.querySelector('#sf_StudentLabel, .sf_StudentLabel, #studentName, .studentName');
    return el ? clean(el.textContent) : '';
  }

  function scrapeGrades(doc) {
    const courses = [];
    const byKey = {};
    const terms = [];

    for (const a of gradeLinks(doc)) {
      const tr = a.closest('tr');
      if (!tr) continue;
      const info = describeRow(tr, gridFor(tr)) ||
        { name: 'Class ' + (a.getAttribute('data-cni') || courses.length + 1), teacher: '', period: '', time: '' };
      const key = (a.getAttribute('data-cni') || '') + '|' + info.name + '|' + info.period;
      let course = byKey[key];
      if (!course) {
        course = byKey[key] = Object.assign({ key, grades: {}, links: {} }, info);
        courses.push(course);
      }
      const term = clean(a.getAttribute('data-lit')) || termFromHeader(a) || 'Grade';
      if (!terms.includes(term)) terms.push(term);
      const g = parseGrade(a.textContent);
      if (g.raw) { course.grades[term] = g; course.links[term] = a; }
    }

    // Classes that are listed but have no grades yet.
    for (const desc of $$(doc, '.classDesc')) {
      const row = desc.closest('tr');
      const info = row && classInfo(row);
      if (info && !courses.some((c) => c.name === info.name && c.period === info.period)) {
        courses.push(Object.assign({ key: info.name + '|' + info.period, grades: {}, links: {} }, info));
      }
    }

    courses.sort((a, b) => {
      const pa = parseInt(a.period, 10), pb = parseInt(b.period, 10);
      if (isNaN(pa) && isNaN(pb)) return a.name.localeCompare(b.name);
      if (isNaN(pa)) return 1;
      if (isNaN(pb)) return -1;
      return pa - pb || a.period.localeCompare(b.period);
    });

    return { courses, terms: orderTerms(doc, terms), student: studentName(doc), live: doc === document };
  }

  // Term columns in Skyward's own order, including quarters with no grades
  // yet, so Q3 and Q4 can be picked before they start.
  function orderTerms(doc, graded) {
    const isQuarter = (t) => /^Q\d$/i.test(t);
    const first = gradeLinks(doc)[0];
    const tr = first && first.closest('tr');
    let order = [];
    if (tr) {
      for (const th of $$(gridFor(tr), 'th')) {
        const t = clean(th.textContent);
        if ((graded.includes(t) || isQuarter(t)) && !order.includes(t)) order.push(t);
      }
    }
    if (!graded.every((t) => order.includes(t))) order = graded.slice();
    if (order.some(isQuarter)) {
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
        if (order.includes(q)) continue;
        const fin = order.findIndex((t) => /^(FIN|FINAL|YR)/i.test(t));
        order.splice(fin === -1 ? order.length : fin, 0, q);
      }
    }
    return order;
  }

  // ======================================================= generic tables

  // Pulls every data table out of a Skyward page as {title, head, rows}.
  // Skyward often draws one grid as several tables (a frozen column, a
  // separate header), so tables in the same grid with matching row counts
  // are stitched back together.
  function extractTables(root) {
    const leaf = $$(root, 'table').filter((t) => !t.querySelector('table'));
    const parsed = leaf.map((t) => {
      const rows = Array.from(t.rows).map((r) => ({
        cells: Array.from(r.cells).map((c) => clean(c.textContent)),
        th: Array.from(r.cells).every((c) => c.tagName === 'TH'),
        inHead: !!r.closest('thead')
      }));
      let head = [];
      while (rows.length && (rows[0].inHead || rows[0].th)) head = rows.shift().cells;
      const body = rows.map((r) => r.cells).filter((cells) => cells.some(Boolean));
      const grid = t.closest('[id^="grid_"]');
      return { table: t, grid: grid && grid.id.replace(/_(lockedtable|gradeGrid|header|body).*$/i, ''), head, rows: body };
    });

    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const prev = out[out.length - 1];
      if (prev && p.grid && prev.grid === p.grid) {
        if (!prev.rows.length && !p.head.length) { prev.rows = p.rows; continue; }
        if (prev.rows.length && prev.rows.length === p.rows.length) {
          prev.head = prev.head.concat(p.head.length ? p.head : p.rows[0].map(() => ''));
          prev.rows = prev.rows.map((r, j) => r.concat(p.rows[j]));
          continue;
        }
      }
      out.push(Object.assign({}, p, { title: tableTitle(p.table) }));
    }
    return out.filter((t) => t.rows.length && Math.max(t.head.length, ...t.rows.map((r) => r.length)) >= 2);
  }

  function tableTitle(table) {
    if (table.caption) return clean(table.caption.textContent);
    let node = table;
    for (let hops = 0; node && hops < 6; hops++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-4]$/.test(sib.tagName) || /title|heading|header/i.test(sib.className)) {
          const t = clean(sib.textContent);
          if (t && t.length < 80) return t;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  // ===================================================== skyward pages

  // Everything in Skyward's own menu, so the app can offer all of it. When
  // a label appears more than once (Skyward has hidden duplicate menus),
  // keep the visible copy that carries a page name.
  function findNav() {
    const byKey = {};
    const out = [];
    const sel = 'a[data-nav], #sf_navMenu a, .sf_navMenu a, nav a, [id*="navMenu"] a, [class*="navMenu"] a, [id*="sideMenu"] a';
    for (const a of $$(document, sel)) {
      const label = clean(a.textContent);
      const key = label.toLowerCase();
      if (!label || label.length > 32) continue;
      if (/log ?out|sign ?out|exit|help|switch|my account|login history/i.test(label)) continue;
      const score = (isVisible(a) ? 2 : 0) + (navTarget(a) ? 1 : 0);
      if (byKey[key]) {
        if (score > byKey[key].score) Object.assign(byKey[key], { el: a, score });
        continue;
      }
      byKey[key] = { label, el: a, score };
      out.push(byKey[key]);
    }
    return out;
  }

  // The Skyward page a menu link points at, e.g. "sfattendance001.w".
  function navTarget(a) {
    const href = a.getAttribute('href') || '';
    if (href && !/^\s*(javascript:|#)/i.test(href)) return href;
    const named = a.getAttribute('data-nav') || a.getAttribute('data-url') || a.getAttribute('data-href');
    if (named) return named;
    const m = (href + ' ' + (a.getAttribute('onclick') || '')).match(/[\w-]+\.w\b/);
    return m ? m[0] : '';
  }

  // Skyward keeps the login session in hidden fields on every page and
  // posts them along when it switches pages. Grid and filter state is
  // left out so the next page starts fresh. Only names go into reports.
  function sessionFields() {
    const out = [];
    const seen = {};
    for (const input of $$(document, 'input[type="hidden"][name]')) {
      const name = input.name;
      if (seen[name] || input.value.length > 1000 || /grid|sort|filter|search|viewstate/i.test(name)) continue;
      seen[name] = true;
      out.push([name, input.value]);
    }
    return out;
  }

  // How the last successful page load worked, so the next one starts there.
  let preferredLoader = null;
  const loaderLog = [];

  // Loads a Skyward page in the background and returns { doc, dispose }.
  // Tries, in order: catching Skyward's own navigation when its menu link
  // is clicked, and posting the session fields straight to the page. Each
  // result loads in a hidden frame so Skyward's own scripts can fill in
  // grids they draw after the page loads.
  // One load at a time: each one temporarily takes over form submits.
  let pageQueue = Promise.resolve();
  function loadSkywardPage(link) {
    const run = pageQueue.then(() => loadSkywardPageNow(link));
    pageQueue = run.catch(() => {});
    return run;
  }

  async function loadSkywardPageNow(link) {
    // Skyward sometimes redraws its menu; use the current copy of the link.
    if (!link.isConnected) {
      const fresh = findNav().find((n) => n.label === clean(link.textContent));
      if (fresh) link = fresh.el;
    }
    const target = navTarget(link);
    const attempts = [
      ['click', async () => {
        // A real link would just navigate, and only the Navigation API can
        // cancel that. Without it, don't risk leaving the page.
        const href = link.getAttribute('href') || '';
        if (href && !/^\s*(javascript:|#)/i.test(href) && !window.navigation) throw new Error('skipped: browser can\'t catch plain links');
        const req = await catchNavigation(link);
        return loadInFrame(req.url, req.fields, req.method);
      }],
      ['direct', async () => {
        if (!target) throw new Error('menu link has no page name');
        return loadInFrame(new URL(target, location.href).href, sessionFields(), 'POST');
      }],
      // Last resort: download the page without running its scripts. Grids
      // Skyward draws with script will be missing, but plain tables show.
      ['download', async () => {
        if (!target) throw new Error('menu link has no page name');
        const res = await fetch(new URL(target, location.href).href, {
          method: 'POST', credentials: 'include', body: new URLSearchParams(sessionFields())
        });
        if (!res.ok) throw new Error('Skyward answered ' + res.status);
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        if (doc.querySelector('input[type="password"]')) throw new Error('Skyward asked to log in again');
        if (!looksLikeSkyward(doc)) throw new Error('got a page that isn\'t Skyward');
        return { doc, dispose() {} };
      }]
    ];
    const first = attempts.findIndex((a) => a[0] === preferredLoader);
    if (first > 0) attempts.unshift(attempts.splice(first, 1)[0]);

    const errors = [];
    for (const [name, attempt] of attempts) {
      try {
        const page = await attempt();
        preferredLoader = name;
        loaderLog.push(clean(link.textContent) + ': ' + name + ' worked');
        return page;
      } catch (e) {
        errors.push(name + ': ' + e.message);
      }
    }
    loaderLog.push(clean(link.textContent) + ': ' + errors.join('; '));
    throw new Error('Skyward wouldn\'t open this page in the background (' + errors.join('; ') + ').');
  }

  // Clicks a Skyward menu link and catches the page change it starts,
  // whether that's a form post, a new window, or a plain redirect, then
  // cancels it so the app stays put.
  function catchNavigation(link) {
    return new Promise((resolve, reject) => {
      const proto = HTMLFormElement.prototype;
      const navApi = window.navigation;
      let done = false;

      const snap = busySnapshot();
      function finish(err, req) {
        if (done) return;
        done = true;
        clearBusy(snap);
        setTimeout(() => clearBusy(snap), 600); // some busy screens appear after a short delay
        proto.submit = NATIVE.submit;
        if (NATIVE.requestSubmit) proto.requestSubmit = NATIVE.requestSubmit;
        window.open = NATIVE.open;
        document.removeEventListener('submit', onSubmit, true);
        if (navApi) navApi.removeEventListener('navigate', onNavigate);
        if (err) { catchLateNavigation(snap); reject(err); } else resolve(req);
      }
      function fromForm(form) {
        const method = (form.getAttribute('method') || 'get').toUpperCase();
        const url = new URL(form.getAttribute('action') || location.href, location.href).href;
        finish(null, { url, method, fields: Array.from(new FormData(form)) });
      }
      function onSubmit(e) { e.preventDefault(); e.stopImmediatePropagation(); fromForm(e.target); }
      function onNavigate(e) {
        if (!e.cancelable || e.hashChange || e.downloadRequest) return;
        e.preventDefault();
        finish(null, {
          url: e.destination.url,
          method: e.formData ? 'POST' : 'GET',
          fields: e.formData ? Array.from(e.formData) : []
        });
      }

      proto.submit = function () { fromForm(this); };
      if (NATIVE.requestSubmit) proto.requestSubmit = function () { fromForm(this); };
      window.open = function (u) { finish(null, { url: new URL(u, location.href).href, method: 'GET', fields: [] }); return null; };
      document.addEventListener('submit', onSubmit, true);
      if (navApi) navApi.addEventListener('navigate', onNavigate);

      try {
        for (const type of ['mousedown', 'mouseup']) link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        link.click();
      } catch (err) { finish(err); }
      setTimeout(() => finish(new Error('clicking the menu did nothing')), 2500);
    });
  }

  // When Skyward starts changing pages it shows "Please wait" and a busy
  // cursor. We cancel that page change, so Skyward never clears them.
  // Note what was showing before our click and undo anything new after.
  const BUSY_SEL = '.blockUI, .blockOverlay, .blockMsg, .ui-widget-overlay, [class*="busy" i], [id*="busy" i], ' +
    '[class*="wait" i], [id*="wait" i], [class*="loading" i], [id*="loading" i], [class*="spinner" i]';

  function waitMessages() {
    return $$(document.body, '*').filter((el) => el.id !== HOST_ID && el.children.length <= 3 &&
      /^\s*(please wait|loading|processing)/i.test(el.textContent) && el.textContent.length < 80 && isVisible(el));
  }

  function busySnapshot() {
    return {
      els: new Set($$(document, BUSY_SEL).filter(isVisible)),
      msgs: new Set(waitMessages()),
      htmlCls: Array.from(document.documentElement.classList),
      bodyCls: Array.from(document.body.classList),
      htmlCursor: document.documentElement.style.cursor,
      bodyCursor: document.body.style.cursor
    };
  }

  function clearBusy(snap) {
    // Only ever hide small floating boxes: never the page itself, anything
    // holding the app, or anything with more than a short message in it.
    const hide = (el) => {
      if (el === document.body || el === document.documentElement || el.contains(host)) return;
      if (clean(el.textContent).length > 120) return;
      el.style.setProperty('display', 'none', 'important');
    };
    try {
      if (window.jQuery && window.jQuery.unblockUI && ![...snap.els].some((e) => e.matches('.blockUI'))) window.jQuery.unblockUI({ fadeOut: 0 });
    } catch (e) { /* not jQuery BlockUI */ }
    for (const el of $$(document, BUSY_SEL)) if (!snap.els.has(el) && isVisible(el)) hide(el);
    for (const el of waitMessages()) if (!snap.msgs.has(el)) hide(overlayRoot(el));
    for (const [node, before] of [[document.documentElement, snap.htmlCls], [document.body, snap.bodyCls]]) {
      for (const cls of Array.from(node.classList)) if (!before.includes(cls) && /busy|wait|blockui/i.test(cls)) node.classList.remove(cls);
    }
    document.documentElement.style.cursor = snap.htmlCursor;
    document.body.style.cursor = snap.bodyCursor;
  }

  // The floating box around a message, so the whole overlay goes. Stops at
  // anything holding more than a short message, so page layout containers
  // are never hidden.
  function overlayRoot(el) {
    let top = el;
    for (let n = el.parentElement; n && n !== document.body && clean(n.textContent).length <= 120; n = n.parentElement) {
      if (/fixed|absolute/.test(getComputedStyle(n).position)) top = n;
    }
    return top;
  }

  // If Skyward reacts to the click only after we gave up (slow network),
  // its page change would replace the app. Keep cancelling page changes
  // for a few more seconds while the app is on screen.
  function catchLateNavigation(snap) {
    const until = Date.now() + 10000;
    const appShowing = () => Date.now() < until && host.isConnected && host.style.display !== 'none';
    const cancel = (e) => { e.preventDefault(); setTimeout(() => clearBusy(snap), 0); };
    const onNavigate = (e) => { if (appShowing() && e.cancelable && !e.hashChange) cancel(e); };
    const onSubmit = (e) => { if (appShowing()) cancel(e); };
    if (window.navigation) window.navigation.addEventListener('navigate', onNavigate);
    document.addEventListener('submit', onSubmit, true);
    setTimeout(() => {
      if (window.navigation) window.navigation.removeEventListener('navigate', onNavigate);
      document.removeEventListener('submit', onSubmit, true);
    }, 10000);
  }

  // Posts (or gets) a Skyward page into a hidden, sandboxed frame. The
  // sandbox stops the page from taking over the window; same-origin access
  // lets the app read what Skyward drew.
  function loadInFrame(url, fields, method) {
    return new Promise((resolve, reject) => {
      const name = 'skyward-glow-frame-' + Math.random().toString(36).slice(2);
      const frame = document.createElement('iframe');
      frame.name = name;
      frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none;';
      const dispose = () => frame.remove();
      let timer = setTimeout(() => { dispose(); reject(new Error('page took too long')); }, 20000);

      frame.addEventListener('load', async function onLoad() {
        let doc = null;
        try { doc = frame.contentDocument; } catch (e) { doc = null; }
        if (doc && doc.URL === 'about:blank') return; // the blank page loads first
        if (!doc || !doc.body) {
          // Skyward (or the browser) refused to show the page in a frame.
          frame.removeEventListener('load', onLoad);
          clearTimeout(timer);
          dispose();
          return reject(new Error('Skyward blocks loading its pages in a frame'));
        }
        frame.removeEventListener('load', onLoad);
        clearTimeout(timer);
        if (doc.querySelector('input[type="password"]')) { dispose(); return reject(new Error('Skyward asked to log in again')); }
        if (!looksLikeSkyward(doc)) { dispose(); return reject(new Error('got a page that isn\'t Skyward (' + clean(doc.title || doc.body.textContent).slice(0, 60) + ')')); }
        await settleTables(doc);
        resolve({ doc, dispose });
      });
      document.body.appendChild(frame);

      if (method === 'GET') {
        // A GET form would drop the URL's own query string, so load it directly.
        const u = new URL(url, location.href);
        for (const [k, v] of fields) if (typeof v === 'string') u.searchParams.set(k, v);
        frame.src = u.href;
        return;
      }
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = url;
      form.target = name;
      form.style.display = 'none';
      for (const [k, v] of fields) {
        if (typeof v !== 'string') continue; // file fields never matter here
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      NATIVE.submit.call(form);
      form.remove();
    });
  }

  function looksLikeSkyward(doc) {
    return !!doc.querySelector('[id^="sf_"], [class*="sf_"], a[data-nav], [id^="grid_"]') || /skyward/i.test(doc.title);
  }

  // Skyward draws many grids with script after the page loads. Wait until
  // the number of table cells stops changing (or a few seconds pass).
  async function settleTables(doc) {
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const n = doc.querySelectorAll('td').length;
      if (n > 0 && n === last) return;
      last = n;
      await wait(250);
    }
  }

  // =================================================== assignment details

  // Clicking a grade makes Skyward open its own popup with the
  // assignments. We click it behind the app, read the popup, close it, and
  // show the assignments in our own panel.
  async function fetchAssignments(link) {
    const sel = '.ui-dialog, [role="dialog"], .sf_DialogWrap, [id*="gradeInfo" i], [id*="dialog" i]';
    const before = new Set($$(document, sel).filter(isVisible));
    const snap = busySnapshot();
    link.click();
    for (let i = 0; i < 40; i++) {
      await wait(150);
      const dlg = $$(document, sel).find((d) => isVisible(d) && !before.has(d) && d.querySelector('table td'));
      if (!dlg || /loading/i.test(clean(dlg.textContent).slice(0, 40))) continue;
      await wait(150);
      const titleEl = dlg.querySelector('.ui-dialog-title, .sf_DialogTitle, h1, h2, h3');
      const result = { title: titleEl ? clean(titleEl.textContent) : '', tables: extractTables(dlg) };
      // The popup's own title bar isn't a table heading.
      result.tables.forEach((t) => { if (result.title && t.title.startsWith(result.title)) t.title = ''; });
      const close = dlg.querySelector('.ui-dialog-titlebar-close, .sf_DialogClose, [title="Close" i], [aria-label="Close" i], button.close, a.close');
      if (close) close.click(); else dlg.style.display = 'none';
      $$(document, '.ui-widget-overlay').forEach((o) => { o.style.display = 'none'; });
      clearBusy(snap);
      return result;
    }
    clearBusy(snap);
    return null;
  }

  // ================================================================= math

  const GPA_POINTS = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  function termStats(courses, term) {
    const scores = [], points = [];
    for (const c of courses) {
      const g = c.grades[term];
      if (!g) continue;
      if (g.score != null) scores.push(g.score);
      if (g.letter) points.push(GPA_POINTS[g.letter.charAt(0)]);
    }
    return { avg: avg(scores), gpa: avg(points), count: scores.length || points.length };
  }

  // Skyward's own highlight comes first since it's right for any district;
  // the Hernando calendar is next. Skyward highlights the current grading
  // period, so look for the one
  // column whose cells are styled differently from the rest. Otherwise use
  // the latest quarter-style term (Q2, PR3, T1...) most classes have, and
  // only then a semester or final column.
  function pickCurrentTerm(data) {
    const lit = highlightedTerm(data);
    if (lit) return lit;
    const dated = datedQuarter();
    if (dated && data.terms.includes(dated)) return dated;
    const count = (t) => data.courses.filter((c) => c.grades[t]).length;
    const quarters = data.terms.filter((t) => /^(Q|T|PR|P|MP)\s*\d/i.test(t));
    for (let i = quarters.length - 1; i >= 0; i--) {
      if (count(quarters[i]) >= data.courses.length / 2) return quarters[i];
    }
    let best = data.terms[0], bestCount = -1;
    for (const t of data.terms) if (count(t) >= bestCount) { best = t; bestCount = count(t); }
    return best;
  }

  function highlightedTerm(data) {
    if (!data.live) return null;
    const looks = {}, counts = {}, marked = new Set();
    for (const c of data.courses) {
      for (const t of Object.keys(c.links)) {
        const a = c.links[t], td = a.closest('td') || a;
        if (/current|highlight/i.test(td.className + ' ' + a.className)) marked.add(t);
        const cs = getComputedStyle(td);
        const look = cs.backgroundColor + '|' + getComputedStyle(a).fontWeight + '|' + cs.borderColor;
        (looks[t] = looks[t] || []).push(look);
        counts[look] = (counts[look] || 0) + 1;
      }
    }
    if (marked.size === 1) return [...marked][0];
    const common = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const odd = Object.keys(looks).filter((t) => looks[t].every((l) => l !== common && l === looks[t][0]));
    return odd.length === 1 ? odd[0] : null;
  }

  function tone(g) {
    if (!g) return 'none';
    const l = g.letter ? g.letter.charAt(0) : letterFor(g.score);
    return ({ A: 'a', B: 'b', C: 'c', D: 'd', F: 'f' })[l] || 'none';
  }
  const toneOf = (score) => (score == null ? 'none' : tone({ score }));

  // ============================================================= schedule

  function toMinutes(s) {
    const m = (s || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + parseInt(m[2], 10);
  }

  // ----------------------------------------------------------- day plans
  //
  // A school day is a list of slots: classes, lunch and SWARM. Mondays,
  // Wednesdays and Fridays use the class times Skyward lists. Tuesdays and
  // Thursdays add SWARM (the Period 8 class in Skyward), so every period
  // shifts. Those times come from, in order: the student's own saved
  // times, the school's official times for their lunch, or an estimate.

  const SWARM_PERIOD = '8';
  const SWARM_DAYS = [2, 4]; // Tuesday, Thursday
  const SWARM_LENGTH = 30;
  const PASSING = 4;
  const BELLS_KEY = 'skywardGlow:bells';

  // Official Weeki Wachee SWARM-day times, one list per lunch, once known:
  // { B: [{ kind: 'class', period: '1', start: '7:19', end: '8:10' }, ...] }
  const OFFICIAL_SWARM = {};

  const periodNum = (p) => (String(p).match(/\d+/) || [''])[0];
  const hm = (mins) => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  const fromHm = (s) => {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };

  // Skyward writes the lunch into the period, like "4B" for 4th period with
  // B lunch.
  function detectLunch(courses) {
    for (const c of courses) {
      const m = String(c.period).match(/^(\d+)\s*([A-Z])$/i);
      if (m) return { period: m[1], letter: m[2].toUpperCase() };
    }
    return null;
  }

  // Saved times, keeping only well-formed rows so a damaged save can never
  // stop the app from starting.
  function savedBells() {
    const raw = store(BELLS_KEY);
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.lunch === 'string' && /^[A-Z]$/.test(raw.lunch)) out.lunch = raw.lunch;
    for (const type of ['regular', 'swarm']) {
      if (!Array.isArray(raw[type])) continue;
      const rows = raw[type].filter((r) => r && typeof r === 'object' && ['class', 'lunch', 'swarm'].includes(r.kind) &&
        Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
      if (rows.length) out[type] = rows.map((r) => ({ kind: r.kind, period: String(r.period || ''), start: r.start, end: r.end }));
    }
    return out;
  }

  function lunchLetter() {
    const saved = savedBells().lunch;
    return saved || (lunch ? lunch.letter : '');
  }

  // Turns stored rows ({kind, period, start, end} in minutes) into slots
  // that point at the student's courses.
  function toSlots(rows) {
    return rows.map((r) => {
      const slot = Object.assign({}, r);
      if (r.kind === 'class') {
        // Two semester courses can share a period; show the one graded now.
        const inPeriod = data.courses.filter((c) => periodNum(c.period) === r.period && r.period !== SWARM_PERIOD);
        slot.course = inPeriod.find((c) => c.grades[state.term]) || inPeriod[0] || null;
      }
      if (r.kind === 'swarm') slot.course = data.courses.find((c) => periodNum(c.period) === SWARM_PERIOD) || null;
      return slot;
    }).sort((a, b) => a.start - b.start);
  }

  // Monday/Wednesday/Friday as Skyward lists it, with lunch filling the
  // long gap between two classes.
  function skywardDay() {
    const rows = data.courses.map((c) => {
      const parts = (c.time || '').split(/\s*-\s*/);
      return { kind: 'class', period: periodNum(c.period), start: toMinutes(parts[0]), end: toMinutes(parts[1]) };
    }).filter((r, i, all) => r.start != null && r.end != null && r.period !== SWARM_PERIOD &&
      all.findIndex((o) => o.period === r.period && o.start != null) === i) // one row per period
      .sort((a, b) => a.start - b.start);
    const out = [];
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      if (prev && r.start - prev.end >= 20) out.push({ kind: 'lunch', start: prev.end, end: r.start });
      out.push(r);
    });
    return out;
  }

  // A best guess at a SWARM day: same first and last bell, SWARM after
  // 2nd period, lunch the same length, classes shortened evenly.
  function estimateSwarm(regular) {
    const classes = regular.filter((r) => r.kind === 'class');
    if (classes.length < 2) return [];
    const lunchRow = regular.find((r) => r.kind === 'lunch');
    const order = [];
    regular.forEach((r) => {
      order.push(Object.assign({}, r));
      if (r.kind === 'class' && order.filter((o) => o.kind === 'class').length === 2) order.push({ kind: 'swarm', period: SWARM_PERIOD });
    });
    const span = regular[regular.length - 1].end - regular[0].start;
    const lunchLen = lunchRow ? lunchRow.end - lunchRow.start : 0;
    let passings = 0;
    for (let i = 1; i < order.length; i++) if (order[i].kind !== 'lunch' && order[i - 1].kind !== 'lunch') passings++;
    const len = Math.floor((span - SWARM_LENGTH - lunchLen - passings * PASSING) / classes.length);
    let t = regular[0].start;
    order.forEach((r, i) => {
      if (i > 0 && r.kind !== 'lunch' && order[i - 1].kind !== 'lunch') t += PASSING;
      r.start = t;
      t += r.kind === 'lunch' ? lunchLen : r.kind === 'swarm' ? SWARM_LENGTH : len;
      r.end = t;
    });
    order[order.length - 1].end = regular[regular.length - 1].end; // leftover minutes go to the last class
    return order;
  }

  function officialSwarm() {
    const rows = OFFICIAL_SWARM[lunchLetter()];
    return rows ? rows.map((r) => Object.assign({}, r, { start: fromHm(r.start), end: fromHm(r.end) })) : null;
  }

  // Rows for a day type plus where they came from.
  function dayRows(type) {
    const saved = savedBells()[type];
    if (saved && saved.length) return { rows: saved, source: 'yours' };
    if (type === 'regular') return { rows: skywardDay(), source: 'skyward' };
    const official = officialSwarm();
    if (official) return { rows: official, source: 'school' };
    return { rows: estimateSwarm(skywardDay()), source: 'estimated' };
  }

  const dayType = (date) => (SWARM_DAYS.includes(date.getDay()) ? 'swarm' : 'regular');
  const isSchoolDay = (date) => date.getDay() > 0 && date.getDay() < 6;

  function slotsFor(date) {
    return isSchoolDay(date) ? toSlots(dayRows(dayType(date)).rows) : [];
  }

  function slotTitle(slot) {
    if (slot.kind === 'lunch') return 'Lunch' + (lunchLetter() ? ' ' + lunchLetter() : '');
    if (slot.kind === 'swarm') return 'SWARM';
    return slot.course ? slot.course.name : 'Period ' + slot.period;
  }

  function slotSub(slot) {
    if (slot.kind === 'lunch') return '';
    const c = slot.course;
    if (slot.kind === 'swarm') return c ? [c.name !== 'Swarm' && c.name !== 'SWARM' ? c.name : '', c.teacher].filter(Boolean).join(' · ') : 'Period ' + SWARM_PERIOD;
    return c ? c.teacher : '';
  }

  function nextSchoolDay(from) {
    const d = new Date(from);
    do { d.setDate(d.getDate() + 1); } while (!isSchoolDay(d));
    return d;
  }

  function nowStatus() {
    const d = new Date();
    if (!data.courses.length) return null;
    const slots = slotsFor(d);
    if (!slots.length) {
      if (isSchoolDay(d)) return null;
      const next = nextSchoolDay(d);
      const first = slotsFor(next)[0];
      return first ? { kind: 'weekend', day: next, first } : null;
    }
    const mins = d.getHours() * 60 + d.getMinutes();
    const cur = slots.find((s) => mins >= s.start && mins < s.end);
    if (cur) return { kind: 'now', bell: cur };
    const next = slots.find((s) => s.start > mins);
    if (next) return { kind: 'next', bell: next };
    return { kind: 'done', last: slots[slots.length - 1] };
  }

  const clock = (mins) => {
    const h = Math.floor(mins / 60), m = mins % 60;
    return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
  };

  // ======================================================== quarter dates

  // Hernando County Schools 2026-27 grading periods. End dates are from the
  // district calendar; start dates are the first school day after the
  // previous quarter or break and only drive the progress bar. Other years
  // or districts fall outside these dates and simply get no countdown.
  const QUARTERS = {
    Q1: ['2026-08-11', '2026-10-09'],
    Q2: ['2026-10-12', '2026-12-18'],
    Q3: ['2027-01-05', '2027-03-12'],
    Q4: ['2027-03-22', '2027-05-28']
  };

  function quarterDates(term) {
    const q = QUARTERS[String(term).toUpperCase()];
    if (!q) return null;
    const [sy, sm, sd] = q[0].split('-').map(Number);
    const [ey, em, ed] = q[1].split('-').map(Number);
    const slots = slotsFor(new Date(ey, em - 1, ed));
    const lastBell = slots.length ? slots[slots.length - 1].end : 16 * 60;
    return {
      start: new Date(sy, sm - 1, sd, 0, 0),
      end: new Date(ey, em - 1, ed, Math.floor(lastBell / 60), lastBell % 60)
    };
  }

  // The quarter today falls in, if the dates above cover today.
  function datedQuarter() {
    const now = Date.now();
    return Object.keys(QUARTERS).find((q) => {
      const d = quarterDates(q);
      return now >= d.start.getTime() && now <= d.end.getTime();
    }) || null;
  }

  const shortDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  // Live countdowns: any element with data-until gets refreshed every second.
  function countdown(until, style) {
    return '<span class="tick ' + style + '" data-until="' + until + '">' + countdownText(until, style) + '</span>';
  }

  // Counts calendar days and wall-clock time separately, so a daylight
  // saving change in between doesn't shift the hours.
  function countdownParts(until) {
    const now = new Date(), end = new Date(until);
    if (end <= now) return [0, 0, 0, 0];
    let days = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    let secs = (end.getHours() * 3600 + end.getMinutes() * 60 + end.getSeconds()) -
      (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
    if (secs < 0) { days -= 1; secs += 86400; }
    return [days, Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60];
  }

  function countdownText(until, style) {
    const [d, h, m, sec] = countdownParts(until);
    const two = (n) => String(n).padStart(2, '0');
    if (style === 'short') return (h ? h + ':' + two(m) : m) + ':' + two(sec);
    return [[d, 'days'], [two(h), 'hrs'], [two(m), 'min'], [two(sec), 'sec']]
      .map(([n, unit]) => '<span class="cd"><b>' + n + '</b><small>' + unit + '</small></span>').join('');
  }

  function tick() {
    if (!host.isConnected) return clearInterval(host.__ticker);
    let ended = false;
    for (const el of root.querySelectorAll('.tick')) {
      const until = Number(el.dataset.until);
      if (until <= Date.now()) ended = true;
      el.innerHTML = countdownText(until, el.classList.contains('short') ? 'short' : 'long');
    }
    if (ended && (state.view === 'home' || state.view === 'schedule')) renderViewOnly();
  }

  // ============================================================ snapshot

  function saveSnapshot(data) {
    const grades = {};
    for (const c of data.courses) {
      grades[c.key] = {};
      for (const t of Object.keys(c.grades)) grades[c.key][t] = c.grades[t].score;
    }
    store(SNAP_KEY, { at: Date.now(), grades });
  }

  // ================================================================ boot

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  applyMobileViewport();

  if (!document.getElementById(HOST_ID + '-font')) {
    const font = document.createElement('link');
    font.id = HOST_ID + '-font';
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,500&display=swap';
    document.head.appendChild(font);
  }

  // Print only the app, not the Skyward page underneath it.
  const printStyle = document.createElement('style');
  printStyle.id = HOST_ID + '-print';
  printStyle.textContent = '@media print{body>*:not(#' + HOST_ID + '){display:none!important}#' + HOST_ID + '{position:static!important}}';
  document.head.appendChild(printStyle);

  const state = {
    view: 'home',
    term: null,
    query: '',
    sort: 'period',
    theme: store(THEME_KEY) || 'dark',
    drawer: null,       // { key, term }
    update: null,       // newer published version, if any
    schedDay: null,     // 'regular' or 'swarm' on the Schedule screen; null = today's
    editing: false,     // the bell-time editor is open
    editRows: null,
    editError: '',
    pages: {},          // label -> { status, tables, error }
    assignments: {}     // key|term -> { status, result }
  };

  root.innerHTML = '<style>' + CSS() + '</style><div class="app" data-theme="' + state.theme + '"></div>';
  const app = root.querySelector('.app');
  app.innerHTML = '<div class="boot"><span class="flame big">' + ICON.flame + '</span><p>Reading Skyward…</p></div>';

  const nav = findNav();
  const navFor = (re) => nav.find((n) => re.test(n.label));

  let data = scrapeGrades(document);
  if (!data.courses.length) {
    const gb = navFor(/grade ?book/i);
    if (gb) {
      try {
        const page = await loadSkywardPage(gb.el);
        data = scrapeGrades(page.doc);
        page.dispose();
      } catch (e) { /* stays empty; Grades shows how to fix it */ }
    }
  }
  // Running the bookmark again while that loaded turns the app off.
  if (!host.isConnected) return;
  const previous = store(SNAP_KEY);
  if (data.courses.length) saveSnapshot(data);
  const lunch = detectLunch(data.courses);
  state.term = data.terms.length ? pickCurrentTerm(data) : null;

  const VIEWS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'grades', label: 'Grades', icon: 'grades' },
    { id: 'schedule', label: 'Schedule', icon: 'clock' },
    { id: 'attendance', label: 'Attendance', icon: 'check' },
    { id: 'more', label: 'More', icon: 'grid' }
  ];
  const attendanceNav = navFor(/attendance/i);
  const scheduleNav = navFor(/schedule/i);
  const moreNav = nav.filter((n) => !/grade ?book|attendance|^home$/i.test(n.label));

  // ============================================================== render

  function render() {
    app.dataset.theme = state.theme;
    const student = data.student ? displayName(data.student) : '';
    app.innerHTML =
      '<div class="ambient"></div>' +
      '<aside class="side">' +
        '<div class="brand"><span class="flame">' + ICON.flame + '</span><span>Better <em>Skyward</em></span><span class="ver">v' + VERSION + '</span></div>' +
        '<nav class="nav">' + VIEWS.map(navButton).join('') + '</nav>' +
        '<div class="side-foot">' +
          (student ? '<div class="who"><span class="avatar">' + esc(student.charAt(0)) + '</span><span><b>' + esc(student) + '</b><small>Family Access</small></span></div>' : '') +
          '<div class="side-actions">' +
            iconButton('theme', state.theme === 'dark' ? 'sun' : 'moon', 'Light / dark') +
            iconButton('report', 'flag', 'Report a problem') +
            iconButton('print', 'print', 'Print') +
          '</div>' +
          '<button class="btn ghost wide" data-act="close" title="Back to plain Skyward (Esc)">' + ICON.exit + ' Original Skyward</button>' +
        '</div>' +
      '</aside>' +
      '<header class="mtop"><div class="brand"><span class="flame">' + ICON.flame + '</span><span>Better <em>Skyward</em></span><span class="ver">v' + VERSION + '</span></div>' +
        '<div class="mtop-actions">' + iconButton('theme', state.theme === 'dark' ? 'sun' : 'moon', 'Light / dark') +
        iconButton('report', 'flag', 'Report a problem') + iconButton('close', 'exit', 'Original Skyward') + '</div></header>' +
      '<main class="main">' + updateBanner() + '<div class="view">' + renderView() + '</div></main>' +
      '<nav class="tabbar">' + VIEWS.map(navButton).join('') + '</nav>' +
      (state.drawer ? renderDrawer() : '');
    afterRender();
  }

  function updateBanner() {
    if (!state.update) return '';
    return '<div class="update"><span>' + ICON.flame + '<b>Version ' + esc(state.update) + ' is out.</b> You have ' + VERSION +
      '. Get the new bookmark from the install page.</span><a class="btn" href="' + INSTALL_URL + '" target="_blank" rel="noopener">Update</a></div>';
  }

  // Asks the published copy for its version number. Sends nothing about
  // you; if it fails (offline, blocked) the app just carries on.
  async function checkForUpdate() {
    try {
      const res = await fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
      const m = (await res.text()).match(/const VERSION = '([\d.]+)'/);
      if (m && newer(m[1], VERSION)) { state.update = m[1]; render(); }
    } catch (e) { /* no update check today */ }
  }

  function newer(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  function displayName(raw) {
    const parts = raw.split(',');
    const first = parts.length > 1 ? clean(parts[1]).split(' ')[0] : clean(raw).split(' ')[0];
    return titleCase(first);
  }

  function navButton(v) {
    const on = state.view === v.id || (v.id === 'more' && state.view.startsWith('page:'));
    return '<button class="nav-item' + (on ? ' on' : '') + '" data-view="' + v.id + '">' + ICON[v.icon] + '<span>' + v.label + '</span></button>';
  }

  function iconButton(act, icon, title) {
    return '<button class="icon-btn" data-act="' + act + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + ICON[icon] + '</button>';
  }

  function renderView() {
    if (state.view === 'home') return homeView();
    if (state.view === 'grades') return gradesView();
    if (state.view === 'schedule') return scheduleView();
    if (state.view === 'attendance') return pageView(attendanceNav, 'Attendance', 'Absences, tardies and check-ins from Skyward.');
    if (state.view === 'more') return moreView();
    if (state.view.startsWith('page:')) {
      const label = state.view.slice(5);
      return pageView(nav.find((n) => n.label === label), label, '');
    }
    return '';
  }

  // ---------------------------------------------------------------- home

  function homeView() {
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = data.student ? displayName(data.student) : '';
    const s = state.term ? termStats(data.courses, state.term) : { avg: null, gpa: null };
    const graded = data.courses.filter((c) => c.grades[state.term] && c.grades[state.term].score != null);
    const attention = graded.filter((c) => c.grades[state.term].score < 80)
      .sort((a, b) => a.grades[state.term].score - b.grades[state.term].score);
    const changes = recentChanges();
    const status = nowStatus();

    return '<section class="hero">' +
        '<p class="eyebrow">' + esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p>' +
        '<h1>' + hello + (name ? ', <em>' + esc(name) + '</em>' : '') + '.</h1>' +
        (state.term ? '<p class="sub">Here\'s where you stand in <strong>' + esc(state.term) + '</strong>.</p>' : '<p class="sub">Open your Skyward Gradebook to see your grades here.</p>') +
      '</section>' +
      (data.courses.length ? statsRow(s, graded, attention) : '') +
      '<section class="home-grid">' +
        nowCard(status) +
        '<div class="panel"><div class="panel-head"><h3>Needs attention</h3><button class="link" data-view="grades">All grades →</button></div>' +
          (attention.length ? '<ul class="rows">' + attention.map((c) => courseRow(c)).join('') + '</ul>'
            : '<p class="empty">' + (graded.length ? 'Every class is at 80 or above. Nice work.' : 'No grades yet for this term.') + '</p>') +
        '</div>' +
        '<div class="panel"><div class="panel-head"><h3>What changed</h3>' +
          (previous ? '<small>since ' + esc(new Date(previous.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</small>' : '') + '</div>' +
          (changes.length ? '<ul class="rows">' + changes.map(changeRow).join('') + '</ul>'
            : '<p class="empty">' + (previous ? 'No grade changes since your last visit.' : 'Changes will show up here next time you open Better Skyward.') + '</p>') +
        '</div>' +
        (data.courses.length ? glancePanel(graded) : '') +
      '</section>';
  }

  function statsRow(s, graded, attention) {
    const best = graded.slice().sort((a, b) => b.grades[state.term].score - a.grades[state.term].score)[0];
    return '<section class="stats">' +
      stat('Average', fmt(s.avg), s.avg != null ? letterFor(s.avg) + ' overall' : '', 'tone-' + toneOf(s.avg)) +
      stat('GPA', fmt(s.gpa, 2), 'unweighted estimate', '') +
      stat('Top class', best ? fmt(best.grades[state.term].score, 0) : '—', best ? best.name : '', best ? 'tone-' + tone(best.grades[state.term]) : '') +
      stat('Below 80', String(attention.length), attention.length ? 'worth a look' : 'all clear', attention.length ? 'tone-c' : 'tone-a') +
      '</section>';
  }

  function stat(label, value, note, cls) {
    return '<div class="stat ' + cls + '"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value) +
      '</span><span class="note">' + esc(note) + '</span></div>';
  }

  function nowCard(status) {
    if (!status) return '';
    let big = '', small = '', live = '', slot = null;
    const at = (mins, day) => { const t = day ? new Date(day) : new Date(); t.setHours(Math.floor(mins / 60), mins % 60, 0, 0); return t.getTime(); };
    if (status.kind === 'now') {
      slot = status.bell; big = slotTitle(slot); small = 'Happening now · ends ' + clock(slot.end);
      live = '<p class="now-live">' + countdown(at(slot.end), 'short') + ' <small>left</small></p>';
    }
    if (status.kind === 'next') {
      slot = status.bell; big = slotTitle(slot); small = 'Up next · starts ' + clock(slot.start);
      live = '<p class="now-live next"><small>starts in</small> ' + countdown(at(slot.start), 'short') + '</p>';
    }
    if (status.kind === 'done') { big = 'School\'s out'; small = 'Your last class ended at ' + clock(status.last.end) + '.'; }
    if (status.kind === 'weekend') {
      big = 'It\'s the weekend';
      small = 'First bell ' + status.day.toLocaleDateString(undefined, { weekday: 'long' }) + ' at ' + clock(status.first.start) + '.';
    }
    const course = slot && slot.course;
    const g = slot && slot.kind === 'class' && course && course.grades[state.term];
    const meta = slot ? [slot.kind === 'class' && course && course.period ? 'Period ' + course.period : '', slotSub(slot)].filter(Boolean).join(' · ') : '';
    return '<div class="panel now tone-' + (slot && slot.kind !== 'class' ? 'b' : tone(g)) + '">' +
      '<div class="panel-head"><h3>' + (status.kind === 'now' ? '<span class="pulse"></span>Right now' : 'Today') + '</h3><button class="link" data-view="schedule">Schedule →</button></div>' +
      '<p class="now-big">' + esc(big) + '</p>' + live + '<p class="now-small">' + esc(small) + '</p>' +
      (meta || g ? '<p class="now-meta">' + esc(meta) + (g ? ' · <b>' + esc(g.raw) + '</b>' : '') + '</p>' : '') +
      '</div>';
  }

  function courseRow(c) {
    const g = c.grades[state.term];
    return '<li><button class="row tone-' + tone(g) + '" data-course="' + esc(c.key) + '">' +
      '<span class="dot"></span><span class="row-main"><b>' + esc(c.name) + '</b><small>' + esc(c.teacher || ('Period ' + c.period)) + '</small></span>' +
      '<span class="row-score">' + (g ? esc(g.score != null ? Math.round(g.score) : g.raw) : '—') + '</span></button></li>';
  }

  function recentChanges() {
    if (!previous) return [];
    const out = [];
    for (const c of data.courses) {
      const before = previous.grades[c.key];
      if (!before) continue;
      for (const t of data.terms) {
        const g = c.grades[t];
        if (g && g.score != null && before[t] != null && Math.abs(g.score - before[t]) >= 0.05) out.push({ c, t, from: before[t], to: g.score });
      }
    }
    return out.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, 6);
  }

  function changeRow(ch) {
    const up = ch.to > ch.from;
    return '<li><button class="row tone-' + toneOf(ch.to) + '" data-course="' + esc(ch.c.key) + '" data-t="' + esc(ch.t) + '">' +
      '<span class="dot"></span><span class="row-main"><b>' + esc(ch.c.name) + '</b><small>' + esc(ch.t) + ' · ' + fmt(ch.from, 0) + ' → ' + fmt(ch.to, 0) + '</small></span>' +
      '<span class="delta ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(ch.to - ch.from).toFixed(1) + '</span></button></li>';
  }

  function glancePanel(graded) {
    const quarters = data.terms.filter((t) => /^Q\d$/i.test(t));
    const picker = quarters.length
      ? '<div class="seg" role="tablist">' + quarters.map((q) =>
          '<button role="tab" class="seg-btn' + (q === state.term ? ' on' : '') + '" data-term="' + esc(q) + '">' + esc(q.replace(/^Q/i, 'Quarter ')) + '</button>').join('') + '</div>'
      : '';
    return '<div class="panel span2 glance"><div class="panel-head"><h3>' + esc(state.term) + ' at a glance</h3>' + picker + '</div>' +
      quarterClock(state.term) +
      (graded.length ? overviewBars(graded) : '<p class="empty">No grades in ' + esc(state.term) + ' yet.</p>') + '</div>';
  }

  function quarterClock(term) {
    const q = quarterDates(term);
    if (!q || datedQuarter() === null && Date.now() > quarterDates('Q4').end.getTime() + 60 * 86400000) return '';
    const now = Date.now();
    const days = (ms) => Math.round(ms / 86400000);
    if (now < q.start.getTime()) {
      return '<div class="qclock future"><p class="qclock-label">' + esc(term) + ' starts in</p>' + countdown(q.start.getTime(), 'long') +
        '<p class="qclock-sub">Starts around ' + esc(shortDate(q.start)) + ' · ends ' + esc(shortDate(q.end)) + '</p></div>';
    }
    if (now > q.end.getTime()) {
      const ago = days(now - q.end.getTime());
      return '<div class="qclock past"><p class="qclock-label">' + esc(term) + ' is over</p>' +
        '<p class="qclock-sub">Ended ' + esc(shortDate(q.end)) + (ago ? ' · ' + ago + (ago === 1 ? ' day' : ' days') + ' ago' : ' · today') + '</p></div>';
    }
    const total = q.end - q.start, done = now - q.start;
    const pct = Math.min(100, Math.max(0, (done / total) * 100));
    return '<div class="qclock current"><p class="qclock-label">Time left in ' + esc(term) + '</p>' + countdown(q.end.getTime(), 'long') +
      '<div class="qbar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
      '<p class="qclock-sub">' + Math.round(pct) + '% done · ends ' + esc(shortDate(q.end)) + ' after the last bell</p></div>';
  }

  function overviewBars(graded) {
    return '<div class="bars">' + graded.map((c) => {
        const v = Math.max(0, Math.min(100, c.grades[state.term].score));
        return '<button class="bar tone-' + tone(c.grades[state.term]) + '" data-course="' + esc(c.key) + '" title="' + esc(c.name + ': ' + c.grades[state.term].raw) + '">' +
          '<span class="bar-label">' + esc(c.name) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + v + '%"></span></span>' +
          '<span class="bar-val">' + Math.round(c.grades[state.term].score) + '</span></button>';
      }).join('') + '</div>';
  }

  // -------------------------------------------------------------- grades

  function gradesView() {
    if (!data.courses.length) {
      return header('Grades', '') + '<div class="panel empty-state"><h3>No grades found</h3>' +
        '<p>Open <b>Gradebook</b> in Skyward, wait for it to load, then run Better Skyward again.</p>' +
        '<p>Already on the Gradebook and still seeing this? Click the flag button and send the report.</p></div>';
    }
    const s = termStats(data.courses, state.term);
    return header('Grades', 'Click a class to see its assignments.') +
      '<section class="toolbar">' +
        '<div class="tabs" role="tablist">' + data.terms.map((t) =>
          '<button role="tab" class="tab' + (t === state.term ? ' on' : '') + '" data-term="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
        '<div class="filters">' +
          '<input class="search" type="search" placeholder="Search classes or teachers" value="' + esc(state.query) + '">' +
          '<select class="sort">' + opt('period', 'By period') + opt('grade-low', 'Lowest first') + opt('grade-high', 'Highest first') + '</select>' +
        '</div>' +
      '</section>' +
      '<p class="term-summary">' + esc(state.term) + ' average <b class="tone-text-' + toneOf(s.avg) + '">' + fmt(s.avg) + '</b> · GPA <b>' + fmt(s.gpa, 2) + '</b> <span>(unweighted estimate)</span></p>' +
      '<section class="grid">' + gradeCards() + '</section>';
  }

  function header(title, sub) {
    return '<section class="page-head"><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</section>';
  }

  function opt(v, label) { return '<option value="' + v + '"' + (state.sort === v ? ' selected' : '') + '>' + label + '</option>'; }

  function gradeCards() {
    const q = state.query.toLowerCase();
    let list = data.courses.filter((c) => !q || (c.name + ' ' + c.teacher + ' period ' + c.period).toLowerCase().includes(q));
    if (state.sort !== 'period') {
      const dir = state.sort === 'grade-low' ? 1 : -1;
      const val = (c) => (c.grades[state.term] && c.grades[state.term].score != null ? c.grades[state.term].score : dir * 999);
      list = list.slice().sort((a, b) => (val(a) - val(b)) * dir);
    }
    if (!list.length) return '<p class="empty">No classes match “' + esc(state.query) + '”.</p>';
    return list.map(card).join('');
  }

  function card(c) {
    const g = c.grades[state.term];
    const before = previous && previous.grades[c.key] && previous.grades[c.key][state.term];
    const d = g && g.score != null && before != null && Math.abs(g.score - before) >= 0.05 ? g.score - before : null;
    return '<article class="card tone-' + tone(g) + '" data-course="' + esc(c.key) + '" tabindex="0">' +
      '<div class="card-top">' +
        '<div class="meta">' +
          (c.period ? '<span class="period">Period ' + esc(c.period) + (c.time ? ' · ' + esc(c.time) : '') + '</span>' : '') +
          '<h2>' + esc(c.name) + '</h2>' +
          (c.teacher ? '<p class="teacher">' + esc(c.teacher) + '</p>' : '') +
        '</div>' +
        '<div class="score">' + ring(g, 72) +
          '<span class="num">' + (g ? esc(g.score != null ? Math.round(g.score) : g.raw) : '—') + '</span>' +
          '<span class="let">' + (g && g.letter ? esc(g.letter) : '') + '</span></div>' +
      '</div>' +
      (d != null ? '<p class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ ') + Math.abs(d).toFixed(1) + ' since last check</p>' : '') +
      '<div class="terms">' + data.terms.map((t) => {
        const tg = c.grades[t];
        return '<span class="chip tone-' + tone(tg) + (t === state.term ? ' on' : '') + '"><span>' + esc(t) + '</span><b>' +
          (tg ? esc(tg.score != null ? Math.round(tg.score) : tg.raw) : '·') + '</b></span>';
      }).join('') + '</div>' +
      sparkline(c) +
    '</article>';
  }

  function ring(g, size) {
    const pct = g && g.score != null ? Math.max(0, Math.min(100, g.score)) : 0;
    const r = size / 2 - 6, circ = 2 * Math.PI * r, mid = size / 2;
    return '<svg class="ring" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" class="ring-track"/>' +
      '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" class="ring-fill" stroke-dasharray="' + circ + '" stroke-dashoffset="' + (circ * (1 - pct / 100)) + '"/></svg>';
  }

  function sparkline(c) {
    const pts = data.terms.map((t) => (c.grades[t] ? c.grades[t].score : null));
    const vals = pts.filter((v) => v != null);
    if (vals.length < 2) return '';
    const min = Math.min(...vals, 70), max = Math.max(...vals, 100);
    const w = 120, h = 28, step = w / (pts.length - 1 || 1);
    let d = '', started = false;
    pts.forEach((v, i) => {
      if (v == null) return;
      d += (started ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + (h - ((v - min) / (max - min || 1)) * h).toFixed(1);
      started = true;
    });
    return '<svg class="spark" viewBox="-2 -2 ' + (w + 4) + ' ' + (h + 4) + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  // -------------------------------------------------------------- drawer

  function renderDrawer() {
    const c = data.courses.find((x) => x.key === state.drawer.key);
    if (!c) return '';
    const term = state.drawer.term;
    const g = c.grades[term];
    const a = state.assignments[c.key + '|' + term];
    let body;
    if (!g) body = '<p class="empty">No grade posted for ' + esc(term) + ' yet.</p>';
    else if (!c.links[term] || !data.live) body = '<p class="empty">Assignment details are only available when Better Skyward is started on the Gradebook page.</p>';
    else if (!a || a.status === 'loading') body = '<div class="loading"><span class="spinner"></span>Loading assignments from Skyward…</div>';
    else if (a.status === 'ok') body = assignmentsHtml(a.result);
    else body = '<p class="empty">Couldn\'t read the assignment list here.</p>';

    return '<div class="scrim" data-act="drawer-close"></div>' +
      '<aside class="drawer tone-' + tone(g) + '" role="dialog" aria-label="' + esc(c.name) + '">' +
        '<div class="drawer-head">' +
          '<div><span class="period">' + esc([c.period && 'Period ' + c.period, c.time].filter(Boolean).join(' · ')) + '</span>' +
          '<h2>' + esc(c.name) + '</h2><p class="teacher">' + esc(c.teacher) + '</p></div>' +
          '<button class="icon-btn" data-act="drawer-close" aria-label="Close">' + ICON.x + '</button>' +
        '</div>' +
        '<div class="drawer-score"><div class="score big">' + ring(g, 112) + '<span class="num">' + (g ? esc(g.score != null ? Math.round(g.score) : g.raw) : '—') +
          '</span><span class="let">' + (g && g.letter ? esc(g.letter) : '') + '</span></div>' +
          '<div class="terms">' + data.terms.map((t) => {
            const tg = c.grades[t];
            return '<button class="chip tone-' + tone(tg) + (t === term ? ' on' : '') + '" data-dterm="' + esc(t) + '"><span>' + esc(t) + '</span><b>' +
              (tg ? esc(tg.score != null ? Math.round(tg.score) : tg.raw) : '·') + '</b></button>';
          }).join('') + '</div></div>' +
        '<div class="drawer-body"><h3>' + esc(term) + ' assignments</h3>' + body + '</div>' +
        (c.links[term] && data.live ? '<div class="drawer-foot"><button class="btn ghost wide" data-act="skyward-details">' + ICON.exit + ' Open this in Skyward</button></div>' : '') +
      '</aside>';
  }

  function assignmentsHtml(result) {
    if (!result.tables.length) return '<p class="empty">No assignments listed.</p>';
    return result.tables.map((t) => {
      const head = t.head.map((h) => h.toLowerCase());
      const col = (re) => head.findIndex((h) => re.test(h));
      const nameCol = col(/assign|description|name/);
      if (nameCol === -1) return tableHtml(t);
      const dueCol = col(/due|date/);
      const scoreCol = col(/score|points|pts|grade|mark/);
      return (t.title ? '<h4>' + esc(t.title) + '</h4>' : '') + '<ul class="assignments">' + t.rows.map((r) => {
        if (r.filter(Boolean).length === 1 || r.length < Math.min(3, t.head.length)) {
          return '<li class="cat">' + esc(r.filter(Boolean).join(' · ')) + '</li>';
        }
        const score = scoreCol > -1 ? r[scoreCol] : r.slice(nameCol + 1).find((x) => /\d/.test(x)) || '';
        const pct = scorePercent(score, r);
        const missing = /missing|\*|incomplete/i.test(r.join(' '));
        return '<li class="asg tone-' + (missing ? 'f' : toneOf(pct)) + '">' +
          '<span class="asg-main"><b>' + esc(r[nameCol] || r.find(Boolean)) + '</b><small>' + esc(dueCol > -1 ? r[dueCol] : '') + (missing ? ' · Missing' : '') + '</small></span>' +
          '<span class="asg-score">' + esc(score || '—') + (pct != null ? '<small>' + Math.round(pct) + '%</small>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }).join('');
  }

  function scorePercent(score, row) {
    const m = (score || '').match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i);
    if (m && parseFloat(m[2]) > 0) return (parseFloat(m[1]) / parseFloat(m[2])) * 100;
    const pctCell = row.find((x) => /^\d+(\.\d+)?\s*%$/.test(x));
    if (pctCell) return parseFloat(pctCell);
    return null;
  }

  async function openDrawer(key, term) {
    const c = data.courses.find((x) => x.key === key);
    if (!c) return;
    state.drawer = { key, term: term || state.term };
    render();
    loadAssignments(c, state.drawer.term);
  }

  // Skyward shows one popup at a time, so lookups wait their turn.
  let assignmentQueue = Promise.resolve();

  async function loadAssignments(c, term) {
    const id = c.key + '|' + term;
    const link = c.links[term];
    if (!link || !data.live || state.assignments[id]) return;
    state.assignments[id] = { status: 'loading' };
    let result = null;
    const run = assignmentQueue.then(() => fetchAssignments(link));
    assignmentQueue = run.catch(() => {});
    try { result = await run; } catch (e) { result = null; }
    state.assignments[id] = result ? { status: 'ok', result } : { status: 'error' };
    if (state.drawer && state.drawer.key === c.key && state.drawer.term === term) render();
  }

  // ------------------------------------------------------------ schedule

  function scheduleView() {
    const today = new Date();
    const todayType = isSchoolDay(today) ? dayType(today) : dayType(nextSchoolDay(today));
    const type = state.schedDay || todayType;
    const { rows, source } = dayRows(type);
    const slots = toSlots(rows);
    const live = isSchoolDay(today) && type === dayType(today);
    const mins = today.getHours() * 60 + today.getMinutes();
    const letter = lunchLetter();

    let html = header('Schedule', 'Your day, period by period. Tuesdays and Thursdays include SWARM.');
    html += '<section class="sched-bar">' +
      '<div class="seg" role="tablist">' +
        '<button role="tab" class="seg-btn' + (type === 'regular' ? ' on' : '') + '" data-sched="regular">Mon · Wed · Fri</button>' +
        '<button role="tab" class="seg-btn' + (type === 'swarm' ? ' on' : '') + '" data-sched="swarm">Tue · Thu · SWARM</button>' +
      '</div>' +
      '<label class="lunch-pick">Lunch <select class="lunch-select">' +
        ['', 'A', 'B', 'C', 'D'].map((l) => '<option value="' + l + '"' + (l === (savedBells().lunch || '') ? ' selected' : '') + '>' +
          (l || 'Auto' + (lunch ? ' (' + lunch.letter + ')' : '')) + '</option>').join('') +
      '</select></label>' +
      (state.editing ? '' : '<button class="btn ghost small" data-act="edit-times">Edit times</button>') +
    '</section>';

    if (state.editing) return html + editorHtml(type);

    const notes = {
      yours: 'Using the times you entered.',
      skyward: 'Times from Skyward. Lunch is the gap between classes.',
      school: 'Official SWARM-day times for lunch ' + letter + '.',
      estimated: 'These SWARM-day times are an estimate. Tap Edit times and enter your school\'s real schedule so the countdowns are right.'
    };
    html += '<p class="sched-note' + (source === 'estimated' ? ' warn' : '') + '">' + esc(notes[source]) + '</p>';

    if (!slots.length) {
      return html + '<p class="empty">' + (data.courses.length ? 'No class times yet. Tap Edit times to add them.' : 'Open your Skyward Gradebook to load your classes.') + '</p>';
    }
    html += '<ol class="timeline">' + slots.map((sl) => {
      const g = sl.kind === 'class' && sl.course && sl.course.grades[state.term];
      const cur = live && mins >= sl.start && mins < sl.end;
      const past = live && mins >= sl.end;
      const pct = cur ? Math.round(((mins - sl.start) / (sl.end - sl.start)) * 100) : 0;
      const label = sl.kind === 'lunch' ? 'Lunch' : sl.kind === 'swarm' ? 'Period ' + SWARM_PERIOD + ' · SWARM' : 'Period ' + (sl.course ? sl.course.period : sl.period);
      return '<li class="slot slot-' + sl.kind + ' tone-' + (sl.kind === 'class' ? tone(g) : 'b') + (cur ? ' current' : '') + (past ? ' past' : '') + '">' +
        '<div class="slot-time"><b>' + clock(sl.start) + '</b><small>' + clock(sl.end) + '</small></div>' +
        '<button class="slot-card"' + (sl.course ? ' data-course="' + esc(sl.course.key) + '"' : ' disabled') + '>' +
          '<span class="period">' + esc(label) + (cur ? ' · now' : '') + '</span>' +
          '<b>' + esc(slotTitle(sl)) + '</b>' + (slotSub(sl) ? '<small>' + esc(slotSub(sl)) + '</small>' : '') +
          (cur ? '<span class="progress"><span style="width:' + pct + '%"></span></span>' : '') +
          (g ? '<span class="slot-grade">' + esc(g.raw) + '</span>' : '') +
        '</button></li>';
    }).join('') + '</ol>';
    if (scheduleNav) html += '<div class="section-gap"></div>' + pageBlock(scheduleNav, 'Full schedule from Skyward');
    return html;
  }

  // The time editor: one row per slot, reorderable, with native time
  // pickers (they're the friendliest on phones).
  function editorHtml(type) {
    if (!state.editRows) {
      const rows = dayRows(type).rows.map((r) => Object.assign({}, r));
      state.editRows = rows.length ? rows : blankRows(type);
    }
    const rows = state.editRows;
    const name = (r) => r.kind === 'lunch' ? 'Lunch' : r.kind === 'swarm' ? 'SWARM (Period ' + SWARM_PERIOD + ')' : 'Period ' + r.period;
    return '<div class="panel editor">' +
      '<h3>' + (type === 'swarm' ? 'Tuesday & Thursday (SWARM) times' : 'Monday, Wednesday & Friday times') + '</h3>' +
      '<p class="sched-note">Enter the start and end of each period for your lunch. Use the arrows to change the order.</p>' +
      (state.editError ? '<p class="sched-note warn">' + esc(state.editError) + '</p>' : '') +
      '<ol class="edit-rows">' + rows.map((r, i) =>
        '<li class="edit-row"><span class="edit-name">' + esc(name(r)) + '</span>' +
        '<input type="time" class="t-in" data-i="' + i + '" data-edge="start" value="' + (r.start != null ? hm(r.start) : '') + '" aria-label="' + esc(name(r)) + ' start">' +
        '<span class="dash">–</span>' +
        '<input type="time" class="t-in" data-i="' + i + '" data-edge="end" value="' + (r.end != null ? hm(r.end) : '') + '" aria-label="' + esc(name(r)) + ' end">' +
        '<span class="edit-move"><button class="icon-btn mini" data-move="' + i + '" data-dir="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="icon-btn mini" data-move="' + i + '" data-dir="1" aria-label="Move down"' + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="icon-btn mini" data-remove="' + i + '" aria-label="Remove ' + esc(name(r)) + '">×</button></span></li>').join('') +
      '</ol>' +
      '<div class="editor-add">' +
        (rows.some((r) => r.kind === 'lunch') ? '' : '<button class="btn ghost small" data-add="lunch">+ Lunch</button>') +
        (type === 'swarm' && !rows.some((r) => r.kind === 'swarm') ? '<button class="btn ghost small" data-add="swarm">+ SWARM</button>' : '') +
        missingPeriods(rows).map((p) => '<button class="btn ghost small" data-add="class" data-period="' + esc(p) + '">+ Period ' + esc(p) + '</button>').join('') +
      '</div>' +
      '<div class="editor-actions">' +
        '<button class="btn" data-act="save-times">Save</button>' +
        '<button class="btn ghost" data-act="reset-times">' + (type === 'swarm' ? 'Reset to estimate' : 'Reset to Skyward') + '</button>' +
        '<button class="btn ghost" data-act="cancel-times">Cancel</button>' +
      '</div></div>';
  }

  // Every class period Skyward lists (not SWARM), in order.
  function coursePeriods() {
    return [...new Set(data.courses.map((c) => periodNum(c.period)).filter((p) => p && p !== SWARM_PERIOD))]
      .sort((a, b) => Number(a) - Number(b));
  }

  const missingPeriods = (rows) => coursePeriods().filter((p) => !rows.some((r) => r.kind === 'class' && r.period === p));

  // An empty editor still lists every period so times can be typed in.
  function blankRows(type) {
    const rows = coursePeriods().map((p) => ({ kind: 'class', period: p, start: null, end: null }));
    if (type === 'swarm') rows.splice(Math.min(2, rows.length), 0, { kind: 'swarm', period: SWARM_PERIOD, start: null, end: null });
    const lunchAfter = lunch ? rows.findIndex((r) => r.period === lunch.period) : -1;
    rows.splice(lunchAfter === -1 ? rows.length : lunchAfter, 0, { kind: 'lunch', period: '', start: null, end: null });
    return rows;
  }

  // Copies whatever is typed in the time boxes back into the edit rows.
  function syncEditRows() {
    for (const input of root.querySelectorAll('.t-in')) {
      const r = state.editRows[Number(input.dataset.i)];
      if (r) r[input.dataset.edge] = fromHm(input.value);
    }
  }

  function saveTimes() {
    syncEditRows();
    const rows = state.editRows;
    const bad = rows.find((r) => r.start == null || r.end == null || r.end <= r.start);
    if (bad) {
      state.editError = (bad.kind === 'class' ? 'Period ' + bad.period : bad.kind === 'lunch' ? 'Lunch' : 'SWARM') + ' needs a start time before its end time.';
      return renderViewOnly();
    }
    const sorted = rows.slice().sort((a, b) => a.start - b.start);
    const overlap = sorted.find((r, i) => i > 0 && r.start < sorted[i - 1].end);
    if (overlap) {
      state.editError = 'Two periods overlap around ' + clock(overlap.start) + '. Check the times.';
      return renderViewOnly();
    }
    const saved = savedBells();
    saved[state.schedDay || currentSchedType()] = sorted;
    store(BELLS_KEY, saved);
    closeEditor();
  }

  function currentSchedType() {
    const today = new Date();
    return isSchoolDay(today) ? dayType(today) : dayType(nextSchoolDay(today));
  }

  function closeEditor() {
    state.editing = false;
    state.editRows = null;
    state.editError = '';
    renderViewOnly();
  }

  // ------------------------------------------------------- skyward pages

  function moreView() {
    let html = header('More', 'Everything else in your Skyward menu, redesigned.');
    const foot = '<p class="version-note">Better Skyward v' + VERSION + '</p>';
    if (!moreNav.length) return html + '<p class="empty">Couldn\'t find Skyward\'s menu on this page.</p>' + foot;
    return html + '<section class="tiles">' + moreNav.map((n) =>
      '<button class="tile" data-page="' + esc(n.label) + '"><span class="tile-icon">' + ICON[iconFor(n.label)] + '</span><b>' + esc(n.label) + '</b>' + ICON.arrow + '</button>').join('') +
      '</section>' + foot;
  }

  function iconFor(label) {
    if (/calendar/i.test(label)) return 'calendar';
    if (/schedule/i.test(label)) return 'clock';
    if (/food|lunch|meal/i.test(label)) return 'food';
    if (/fee|pay|money/i.test(label)) return 'money';
    if (/test|score|history|portfolio|report/i.test(label)) return 'grades';
    if (/info|student|health|contact/i.test(label)) return 'user';
    if (/message|mail|skylert|notif/i.test(label)) return 'mail';
    return 'doc';
  }

  function pageView(entry, title, sub) {
    let html = header(title, sub);
    if (state.view.startsWith('page:')) html = '<button class="link back" data-view="more">← More</button>' + html;
    if (!entry) return html + '<p class="empty">This Skyward doesn\'t have a “' + esc(title) + '” page in its menu.</p>';
    return html + pageBlock(entry, '');
  }

  function pageBlock(entry, title) {
    const p = state.pages[entry.label];
    if (!p) { setTimeout(() => loadPage(entry), 0); }
    let body;
    if (!p || p.status === 'loading') body = '<div class="loading"><span class="spinner"></span>Loading ' + esc(entry.label) + ' from Skyward…</div>';
    else if (p.status === 'error') {
      body = '<div class="panel empty-state"><h3>Couldn\'t load this page here</h3><p>' + esc(p.error) + '</p>' +
        '<button class="btn" data-skyward="' + esc(entry.label) + '">Open it in Skyward</button></div>';
    } else if (!p.tables.length) {
      body = '<div class="panel empty-state"><h3>Nothing to show</h3><p>Skyward\'s ' + esc(entry.label) + ' page has no tables to redesign' +
        (p.text ? ':</p><p class="quote">' + esc(p.text) + '</p>' : '.</p>') +
        '<button class="btn ghost" data-skyward="' + esc(entry.label) + '">Open it in Skyward</button></div>';
    } else {
      body = (/attendance/i.test(entry.label) ? attendanceSummary(p.tables) : '') +
        p.tables.map(tableHtml).join('') +
        '<p class="foot-note"><button class="link" data-skyward="' + esc(entry.label) + '">Open the original in Skyward →</button></p>';
    }
    return (title ? '<h3 class="block-title">' + esc(title) + '</h3>' : '') + body;
  }

  async function loadPage(entry) {
    if (state.pages[entry.label]) return;
    state.pages[entry.label] = { status: 'loading' };
    try {
      const page = await loadSkywardPage(entry.el);
      const main = (page.doc.querySelector('#sf_ContentArea, .sf_ContentArea, #contentArea, main, #content') || page.doc.body).cloneNode(true);
      page.dispose();
      $$(main, 'script, style, noscript').forEach((n) => n.remove());
      state.pages[entry.label] = {
        status: 'ok',
        tables: extractTables(main),
        text: clean(main.textContent).slice(0, 400),
        html: main.innerHTML
      };
    } catch (e) {
      state.pages[entry.label] = { status: 'error', error: e.message };
    }
    const v = state.view;
    if (v === 'attendance' || v === 'schedule' || v === 'page:' + entry.label) renderViewOnly();
  }

  function attendanceSummary(tables) {
    const counts = {};
    let total = 0;
    for (const t of tables) {
      const i = t.head.findIndex((h) => /attendance|type|reason|code|description/i.test(h));
      if (i === -1) continue;
      for (const r of t.rows) {
        const v = clean(r[i]);
        if (!v) continue;
        counts[v] = (counts[v] || 0) + 1;
        total++;
      }
    }
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4);
    if (!keys.length) return '';
    return '<section class="stats">' + stat('Entries', String(total), 'this year', '') +
      keys.map((k) => stat(k, String(counts[k]), counts[k] === 1 ? 'time' : 'times', attendanceTone(k))).join('') +
      '</section>';
  }

  // Same colors as the table pills: excused is fine, tardy is a warning,
  // unexcused or plain absences are red.
  function attendanceTone(v) {
    if (/^(excused|present|school related)/i.test(v)) return 'tone-b';
    if (/tard|late/i.test(v)) return 'tone-c';
    if (/absen|unexcused|truan/i.test(v)) return 'tone-f';
    return '';
  }

  function tableHtml(t) {
    const width = Math.max(t.head.length, ...t.rows.map((r) => r.length));
    const head = t.head.length ? t.head : [];
    return '<div class="table-card">' + (t.title ? '<h3>' + esc(t.title) + '</h3>' : '') +
      '<div class="table-scroll"><table>' +
      (head.some(Boolean) ? '<thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>' : '') +
      '<tbody>' + t.rows.map((r) => {
        if (r.length === 1 && width > 2) return '<tr class="group"><td colspan="' + width + '">' + esc(r[0]) + '</td></tr>';
        return '<tr>' + r.map((cell, i) => '<td>' + cellHtml(cell, head[i]) + '</td>').join('') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function cellHtml(v, heading) {
    if (/^(tardy|late|absent|unexcused|truant|excused|present|school related)/i.test(v)) return '<span class="pill ' + attendanceTone(v) + '">' + esc(v) + '</span>';
    if (/grade|score|percent|avg|mark/i.test(heading || '') && /^\d+(\.\d+)?$/.test(v) && parseFloat(v) <= 100) return '<span class="num-cell tone-text-' + toneOf(parseFloat(v)) + '">' + esc(v) + '</span>';
    return esc(v);
  }

  // ============================================================== events

  function renderViewOnly() {
    const view = root.querySelector('.view');
    if (!view) return render();
    view.innerHTML = renderView();
    afterRender();
  }

  function afterRender() {
    root.querySelectorAll('.nav-item').forEach((b) => {
      const v = b.dataset.view;
      b.classList.toggle('on', state.view === v || (v === 'more' && state.view.startsWith('page:')));
    });
  }

  function go(view) {
    state.view = view;
    state.drawer = null;
    state.editing = false;
    state.editRows = null;
    state.editError = '';
    render();
    const main = root.querySelector('.main');
    if (main) main.scrollTop = 0;
  }

  app.addEventListener('click', (e) => {
    const el = e.target.closest('button, [data-course], [data-act]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.view) return go(ds.view);
    if (ds.page) return go('page:' + ds.page);
    if (ds.term) { state.term = ds.term; return renderViewOnly(); }
    if (ds.dterm) {
      state.drawer.term = ds.dterm;
      render();
      return loadAssignments(data.courses.find((c) => c.key === state.drawer.key), ds.dterm);
    }
    if (ds.course) return openDrawer(ds.course, ds.t);
    if (ds.skyward) return openInSkyward(nav.find((n) => n.label === ds.skyward).el);
    if (ds.sched) {
      state.schedDay = ds.sched;
      state.editing = false;
      state.editRows = null;
      return renderViewOnly();
    }
    if (ds.remove) {
      syncEditRows();
      state.editRows.splice(Number(ds.remove), 1);
      return renderViewOnly();
    }
    if (ds.add) {
      syncEditRows();
      state.editRows.push({ kind: ds.add, period: ds.add === 'swarm' ? SWARM_PERIOD : (ds.period || ''), start: null, end: null });
      return renderViewOnly();
    }
    if (ds.move) {
      syncEditRows();
      const i = Number(ds.move), j = i + Number(ds.dir);
      const rows = state.editRows;
      if (j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]];
      return renderViewOnly();
    }
    switch (ds.act) {
      case 'edit-times':
        state.schedDay = state.schedDay || currentSchedType();
        state.editing = true;
        return renderViewOnly();
      case 'save-times': return saveTimes();
      case 'cancel-times': return closeEditor();
      case 'reset-times': {
        const saved = savedBells();
        delete saved[state.schedDay || currentSchedType()];
        store(BELLS_KEY, saved);
        state.editRows = null;
        state.editError = '';
        return renderViewOnly();
      }
      case 'close': return teardown();
      case 'print': return window.print();
      case 'report': return report();
      case 'drawer-close': state.drawer = null; return render();
      case 'skyward-details': {
        const c = data.courses.find((x) => x.key === state.drawer.key);
        return openInSkyward(c.links[state.drawer.term]);
      }
      case 'theme':
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        store(THEME_KEY, state.theme);
        return render();
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.course) openDrawer(e.target.dataset.course);
  });

  app.addEventListener('input', (e) => {
    // Save each typed time right away, so a redraw (theme, lunch, update
    // banner) never wipes it.
    if (e.target.classList.contains('t-in') && state.editRows) {
      const r = state.editRows[Number(e.target.dataset.i)];
      if (r) r[e.target.dataset.edge] = fromHm(e.target.value);
      return;
    }
    if (!e.target.classList.contains('search')) return;
    state.query = e.target.value;
    const grid = root.querySelector('.grid');
    if (grid) grid.innerHTML = gradeCards();
  });

  app.addEventListener('change', (e) => {
    if (e.target.classList.contains('sort')) { state.sort = e.target.value; renderViewOnly(); }
    if (e.target.classList.contains('lunch-select')) {
      const saved = savedBells();
      if (e.target.value) saved.lunch = e.target.value; else delete saved.lunch;
      store(BELLS_KEY, saved);
      renderViewOnly();
    }
  });

  function onKey(e) {
    if (e.key !== 'Escape' || !host.isConnected || host.style.display === 'none') return;
    const from = e.composedPath()[0];
    if (from && /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName) && from.value) return; // clear the field first
    const panel = root.querySelector('.report');
    if (panel) panel.remove();
    else if (state.drawer) { state.drawer = null; render(); }
    else teardown();
  }
  document.addEventListener('keydown', onKey);
  window.__skywardGlowTeardown = teardown;

  // Hide the app and use the real Skyward link, with a pill to come back.
  function openInSkyward(el) {
    if (!el || !document.contains(el)) return;
    host.style.display = 'none';
    document.documentElement.style.overflow = '';
    restoreViewport();
    showBackPill();
    el.click();
  }

  function showBackPill() {
    removeBackPill();
    const pill = document.createElement('button');
    pill.id = HOST_ID + '-back';
    pill.textContent = '✦ Back to Better Skyward';
    pill.style.cssText = 'position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:2147483647;padding:12px 18px;border:0;border-radius:999px;' +
      'font:600 14px Inter,system-ui,sans-serif;color:#0A0A0A;background:linear-gradient(135deg,#F59E0B,#EA580C);' +
      'box-shadow:0 10px 30px rgba(234,88,12,.45);cursor:pointer;';
    pill.onclick = () => {
      removeBackPill();
      host.style.display = '';
      document.documentElement.style.overflow = 'hidden';
      applyMobileViewport();
    };
    document.body.appendChild(pill);
  }

  function removeBackPill() {
    const p = document.getElementById(HOST_ID + '-back');
    if (p) p.remove();
  }

  // Skyward's desktop pages don't tell phones to use the screen width, so
  // they render zoomed out. While the app is open, ask for the real width;
  // put Skyward's own setting back when the app closes.
  function isPhone() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ||
      (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  }

  function applyMobileViewport() {
    if (!isPhone()) return;
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.setAttribute('data-glow-added', '');
      document.head.appendChild(meta);
    } else if (!meta.hasAttribute('data-glow-added') && !meta.hasAttribute('data-glow-original')) {
      meta.setAttribute('data-glow-original', meta.getAttribute('content') || '');
    }
    meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover, shrink-to-fit=no');
    // Skyward's wide tables would otherwise make the phone zoom out to fit them.
    if (!document.body.hasAttribute('data-glow-overflow')) document.body.setAttribute('data-glow-overflow', document.body.style.overflow || '');
    document.body.style.overflow = 'hidden';
  }

  function restoreViewport() {
    if (document.body.hasAttribute('data-glow-overflow')) {
      document.body.style.overflow = document.body.getAttribute('data-glow-overflow');
      document.body.removeAttribute('data-glow-overflow');
    }
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    // Browsers keep the last viewport if the tag is just removed, so put
    // back the default desktop width (980px) that Skyward had without one.
    if (meta.hasAttribute('data-glow-added')) meta.setAttribute('content', 'width=980');
    else if (meta.hasAttribute('data-glow-original')) {
      meta.setAttribute('content', meta.getAttribute('data-glow-original'));
      meta.removeAttribute('data-glow-original');
    }
  }

  function teardown() {
    restoreViewport();
    // Tells the auto-open userscript not to reopen Glow until asked.
    try { sessionStorage.setItem('skywardGlow:dismissed', '1'); } catch (e) { /* private mode */ }
    const h = document.getElementById(HOST_ID);
    if (h) {
      clearInterval(h.__ticker);
      h.remove();
    }
    const ps = document.getElementById(HOST_ID + '-print');
    if (ps) ps.remove();
    removeBackPill();
    document.documentElement.style.overflow = '';
    if (typeof onKey === 'function') document.removeEventListener('keydown', onKey);
    if (window.__skywardGlowTeardown === teardown) delete window.__skywardGlowTeardown;
  }

  // Copies what the app read plus the relevant Skyward HTML (styles and
  // scripts stripped), so a district with a different layout can be fixed.
  function report() {
    const first = gradeLinks(document)[0];
    let html = '';
    if (state.view.startsWith('page:') || state.view === 'attendance') {
      const label = state.view === 'attendance' ? attendanceNav && attendanceNav.label : state.view.slice(5);
      html = (state.pages[label] && state.pages[label].html) || '';
    } else if (first && first.closest('tr')) {
      const grid = gridFor(first.closest('tr')).cloneNode(true);
      $$(grid, 'script, style').forEach((n) => n.remove());
      $$(grid, '[style]').forEach((n) => n.removeAttribute('style'));
      html = grid.outerHTML;
    }
    const diag = [
      'Version: ' + VERSION + ' · ' + navigator.userAgent.replace(/^.*?(Chrome|Firefox|Safari|Edg)\/([\d]+).*$/, '$1 $2') +
        ' · navigation API: ' + ('navigation' in window ? 'yes' : 'no'),
      'Page: ' + location.pathname.split('/').pop(),
      'Page loads: ' + (loaderLog.join(' | ') || 'none yet'),
      'Menu links: ' + nav.map((n) => n.label + ' [' + n.el.tagName.toLowerCase() + (navTarget(n.el) ? ' → ' + navTarget(n.el) : '') +
        (isVisible(n.el) ? '' : ', hidden') + ']').join(', '),
      'Hidden field names: ' + sessionFields().map((f) => f[0]).join(', '),
      'Schedule: lunch ' + (lunchLetter() || 'unknown') + (lunch ? ' (Skyward says ' + lunch.period + lunch.letter + ')' : '') +
        ' · Mon/Wed/Fri ' + dayRows('regular').source + ' · Tue/Thu ' + dayRows('swarm').source +
        ' · Period ' + SWARM_PERIOD + ': ' + ((data.courses.find((c) => periodNum(c.period) === SWARM_PERIOD) || {}).name || 'not in Skyward'),
      'Forms: ' + $$(document, 'form').map((f) => (f.id || f.name || 'form') + ' ' + (f.getAttribute('method') || 'get') + ' ' +
        (f.getAttribute('action') || '').split('?')[0] + ' (' + f.elements.length + ' fields)').join(', '),
      'First menu link: ' + (nav[0] ? nav[0].el.outerHTML.replace(/\s+/g, ' ').slice(0, 400) : '-')
    ].join('\n');
    const text = 'Better Skyward report\n' + diag + '\nView: ' + state.view + '\nTerms: ' + data.terms.join(', ') + '\nPicked: ' + state.term +
      '\nMenu: ' + nav.map((n) => n.label).join(', ') + '\n' +
      data.courses.map((c) => c.name + ' | period ' + c.period + ' | ' + c.teacher + ' | ' +
        data.terms.map((t) => t + '=' + (c.grades[t] ? c.grades[t].raw : '-')).join(' ')).join('\n') +
      '\n\n' + html.replace(/\s+/g, ' ').slice(0, 60000);

    const panel = document.createElement('div');
    panel.className = 'report';
    panel.innerHTML = '<div class="report-box"><h2>Report a problem</h2>' +
      '<p>This is what Better Skyward read from this page. Copy it and send it to whoever is fixing the script.</p>' +
      '<textarea readonly></textarea><div class="report-actions"><button class="btn" data-r="copy">Copy</button>' +
      '<button class="btn ghost" data-r="close">Close</button></div></div>';
    const box = panel.querySelector('textarea');
    box.value = text;
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = e.target.dataset && e.target.dataset.r;
      if (r === 'close' || e.target === panel) panel.remove();
      if (r === 'copy') {
        box.select();
        const done = () => { e.target.textContent = 'Copied!'; };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { document.execCommand('copy'); done(); });
        else { document.execCommand('copy'); done(); }
      }
    });
    app.appendChild(panel);
  }

  render();
  checkForUpdate();
  host.__ticker = setInterval(tick, 1000);

  // =============================================================== icons

  function ICONS() {
    let flameCount = 0;
    const i = (d) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    return {
      // A getter so every flame gets its own gradient id; a shared id
      // breaks when the first copy sits in a hidden sidebar.
      get flame() {
        const id = 'sg' + (flameCount++);
        return '<svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#FBBF24"/><stop offset="1" stop-color="#EA580C"/></linearGradient></defs>' +
          '<path d="M16 3c1 5 8 7.5 8 14.5a8 8 0 0 1-16 0c0-3.5 2.2-5.8 3.4-6.8 0 2.3 1.1 3.4 2.3 3.4 0-4.6 1.1-8 2.3-11.1z" fill="url(#' + id + ')"/></svg>';
      },
      home: i('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
      grades: i('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
      clock: i('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
      check: i('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M9 15l2 2 4-4"/>'),
      calendar: i('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>'),
      grid: i('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
      sun: i('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
      moon: i('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
      flag: i('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>'),
      print: i('<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/>'),
      exit: i('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h12"/>'),
      x: i('<path d="M18 6 6 18M6 6l12 12"/>'),
      arrow: i('<path d="M5 12h14M13 6l6 6-6 6"/>'),
      food: i('<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 2c-2 2-3 5-3 8h3v12"/>'),
      money: i('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
      user: i('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
      mail: i('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
      doc: i('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>')
    };
  }

  // ================================================================= css

  function CSS() {
    return `
:host{all:initial}
*{box-sizing:border-box;margin:0}
button{font:inherit;color:inherit;touch-action:manipulation}
.app{
  --bg:#09090B;--surface:#131316;--surface2:#1B1B1F;--line:#26262B;--text:#F2F2F3;--muted:#9C9CA4;
  --accent:#F59E0B;--accent2:#EA580C;--glow:rgba(245,158,11,.14);
  --a:#34D399;--b:#60A5FA;--c:#FBBF24;--d:#FB923C;--f:#F87171;--none:#52525B;
  --shadow:0 1px 0 rgba(255,255,255,.04) inset,0 10px 30px -12px rgba(0,0,0,.6);
  position:absolute;inset:0;display:grid;grid-template-columns:260px 1fr;background:var(--bg);color:var(--text);cursor:default;
  -webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-tap-highlight-color:transparent;
  font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.app[data-theme="light"]{
  --bg:#FAF8F5;--surface:#FFFFFF;--surface2:#F3EFE9;--line:#E8E2D9;--text:#1C1917;--muted:#6F6861;--glow:rgba(245,158,11,.18);
  --a:#059669;--b:#2563EB;--c:#B45309;--d:#C2410C;--f:#DC2626;--none:#A8A29E;
  --shadow:0 1px 2px rgba(28,25,23,.04),0 8px 24px -12px rgba(28,25,23,.12)}
.ambient{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.ambient::before,.ambient::after{content:"";position:absolute;border-radius:50%;filter:blur(80px)}
.ambient::before{width:60vw;height:50vh;top:-25vh;right:-10vw;background:var(--glow)}
.ambient::after{width:40vw;height:40vh;bottom:-25vh;left:10vw;background:rgba(234,88,12,.07)}
.boot{grid-column:1/-1;display:grid;place-items:center;align-content:center;gap:14px;color:var(--muted);font-weight:500}
.flame{display:grid;place-items:center}
.flame.big svg{width:56px;height:56px;animation:flicker 1.4s ease-in-out infinite}
@keyframes flicker{50%{transform:scale(1.08) rotate(-3deg);opacity:.8}}

/* version + update */
.ver{font:600 10px Inter,system-ui,sans-serif;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:2px 7px;margin-left:2px;letter-spacing:.02em}
.update{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px clamp(16px,4vw,48px) 0;padding:12px 16px;border-radius:14px;
  background:color-mix(in srgb,var(--accent) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));font-size:14px}
.update span{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.update .btn{text-decoration:none;flex:none}
.version-note{color:var(--muted);font-size:12px;margin-top:24px;text-align:center}

/* sidebar */
.side{position:relative;z-index:2;display:flex;flex-direction:column;gap:22px;padding:22px 16px;border-right:1px solid var(--line);
  background:color-mix(in srgb,var(--surface) 70%,transparent);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;padding:0 8px}
.brand em,h1 em{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-weight:500;
  background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.nav{display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border:0;border-radius:12px;background:none;color:var(--muted);
  font-weight:600;font-size:14px;cursor:pointer;text-align:left;transition:background .15s,color .15s}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.on{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,transparent),color-mix(in srgb,var(--accent2) 10%,transparent));color:var(--text);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent)}
.nav-item.on svg{color:var(--accent)}
.side-foot{margin-top:auto;display:flex;flex-direction:column;gap:12px}
.who{display:flex;align-items:center;gap:10px;padding:10px;border-radius:14px;background:var(--surface2)}
.who b{display:block;font-size:14px}.who small{color:var(--muted);font-size:12px}
.avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#0A0A0A;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.side-actions{display:flex;gap:6px}
.icon-btn{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;transition:all .15s}
.icon-btn:hover{color:var(--text);border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:600 14px Inter,system-ui,sans-serif;padding:10px 16px;border-radius:12px;border:0;cursor:pointer;color:#0A0A0A;
  background:linear-gradient(135deg,var(--accent),var(--accent2));transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px -6px rgba(234,88,12,.5)}
.btn.ghost{background:var(--surface);color:var(--text);border:1px solid var(--line)}
.btn.ghost:hover{box-shadow:none;border-color:var(--accent)}
.btn.wide{width:100%}
.btn svg{width:16px;height:16px}
.link{border:0;background:none;color:var(--accent);font-weight:600;font-size:13px;cursor:pointer;padding:0}
.link:hover{text-decoration:underline}
.back{margin-bottom:10px}

/* main */
.main{position:relative;z-index:1;overflow:auto;scroll-behavior:smooth}
.view{max-width:1180px;margin:0 auto;padding:clamp(24px,4vw,52px) clamp(16px,4vw,48px) 64px;animation:fade .35s ease both}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.mtop,.tabbar{display:none}
.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:clamp(32px,5vw,54px);line-height:1.08;letter-spacing:-.02em;margin:10px 0 8px}
.page-head h1{margin-top:0}
.sub{color:var(--muted);font-size:16px}.sub strong{color:var(--text)}
.page-head{margin-bottom:24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:30px 0 22px}
.stat{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:2px;min-width:0;box-shadow:var(--shadow);overflow:hidden}
.stat::after{content:"";position:absolute;inset:auto -30% -60% auto;width:120px;height:120px;border-radius:50%;background:var(--tone,transparent);opacity:.08;filter:blur(10px)}
.stat .label{color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.stat .value{font-size:34px;font-weight:800;letter-spacing:-.035em;font-variant-numeric:tabular-nums;color:var(--tone,var(--text))}
.stat .note{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tone-a{--tone:var(--a)}.tone-b{--tone:var(--b)}.tone-c{--tone:var(--c)}.tone-d{--tone:var(--d)}.tone-f{--tone:var(--f)}.tone-none{--tone:var(--none)}
.tone-text-a{color:var(--a)}.tone-text-b{color:var(--b)}.tone-text-c{color:var(--c)}.tone-text-d{color:var(--d)}.tone-text-f{color:var(--f)}

/* home */
.home-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:var(--shadow);min-width:0}
.span2{grid-column:span 3}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.panel-head h3{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}
.panel-head small{color:var(--muted);font-size:12px}
.now{position:relative;overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--tone) 14%,var(--surface)),var(--surface) 60%)}
.now-big{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
.now-small{color:var(--muted);margin-top:6px;font-size:14px}
.now-meta{margin-top:14px;font-size:13px;color:var(--muted)}.now-meta b{color:var(--tone)}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--a);box-shadow:0 0 0 0 var(--a);animation:pulse 1.8s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
.rows{list-style:none;padding:0;display:flex;flex-direction:column;gap:4px}
.row{width:100%;display:flex;align-items:center;gap:12px;padding:10px;border:0;border-radius:12px;background:none;cursor:pointer;text-align:left}
.row:hover{background:var(--surface2)}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--tone)}
.row-main{flex:1;min-width:0;display:flex;flex-direction:column}
.row-main b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-main small{color:var(--muted);font-size:12px}
.row-score{font-weight:800;font-size:18px;color:var(--tone);font-variant-numeric:tabular-nums}
.empty{color:var(--muted);font-size:14px;padding:6px 0}
.delta{font-size:12px;font-weight:700;white-space:nowrap}.delta.up{color:var(--a)}.delta.down{color:var(--f)}
.bars{display:flex;flex-direction:column;gap:8px}
.bar{display:grid;grid-template-columns:minmax(0,220px) 1fr 40px;align-items:center;gap:14px;border:0;background:none;padding:4px 0;cursor:pointer;text-align:left}
.bar-label{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar:hover .bar-label{color:var(--text)}
.bar-track{height:10px;border-radius:99px;background:var(--surface2);overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--tone) 55%,transparent),var(--tone));animation:grow .9s cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{width:0}}
.bar-val{font-weight:800;text-align:right;color:var(--tone);font-variant-numeric:tabular-nums}

/* quarter countdown */
.glance .panel-head{flex-wrap:wrap}
.seg{display:flex;gap:3px;padding:3px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;overflow-x:auto;max-width:100%}
.seg-btn{font:600 12px Inter,system-ui,sans-serif;padding:6px 12px;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer;white-space:nowrap}
.seg-btn:hover{color:var(--text)}
.seg-btn.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0A0A0A}
.qclock{margin:4px 0 22px;padding:18px 20px;border-radius:16px;border:1px solid var(--line);
  background:radial-gradient(500px 140px at 0 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent),var(--surface2)}
.qclock-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:8px}
.qclock-sub{color:var(--muted);font-size:13px;margin-top:10px}
.qclock.past .qclock-label{color:var(--muted)}
.tick.long{display:flex;gap:10px;flex-wrap:wrap}
.cd{display:flex;flex-direction:column;align-items:center;min-width:72px;padding:10px 12px;border-radius:14px;background:var(--surface);border:1px solid var(--line)}
.cd b{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums}
.cd small{color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.cd:first-child b{background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.qbar{height:8px;border-radius:99px;background:var(--surface);margin-top:14px;overflow:hidden}
.qbar span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.now-live{font-size:30px;font-weight:800;letter-spacing:-.03em;margin-top:8px;font-variant-numeric:tabular-nums;color:var(--tone)}
.now-live small{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:0}
.now-live.next{color:var(--text)}

/* grades */
.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.tabs{display:flex;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow-x:auto;max-width:100%}
.tab{font:600 13px Inter,system-ui,sans-serif;padding:8px 14px;border-radius:10px;border:0;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap}
.tab:hover{color:var(--text)}
.tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0A0A0A}
.filters{display:flex;gap:8px;flex:1;justify-content:flex-end;min-width:240px}
.search,.sort{font:500 14px Inter,system-ui,sans-serif;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:9px 12px;outline:none}
.search{flex:1;max-width:300px;min-width:0}
.search:focus,.sort:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 20%,transparent)}
.term-summary{color:var(--muted);font-size:14px;margin-bottom:18px}.term-summary b{color:var(--text)}.term-summary span{font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{--tone:var(--none);position:relative;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:14px;
  overflow:hidden;cursor:pointer;box-shadow:var(--shadow);transition:transform .2s,border-color .2s;animation:rise .45s ease both;outline:none}
.card:nth-child(2){animation-delay:.03s}.card:nth-child(3){animation-delay:.06s}.card:nth-child(4){animation-delay:.09s}.card:nth-child(5){animation-delay:.12s}.card:nth-child(n+6){animation-delay:.15s}
.card::before{content:"";position:absolute;inset:0;background:radial-gradient(400px 120px at 100% 0,color-mix(in srgb,var(--tone) 12%,transparent),transparent);pointer-events:none}
.card:hover,.card:focus-visible{transform:translateY(-3px);border-color:color-mix(in srgb,var(--tone) 55%,var(--line))}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.card-top{position:relative;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.meta{min-width:0}
.period{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
h2{font-size:17px;font-weight:700;letter-spacing:-.01em;margin:4px 0 2px;line-height:1.25}
.teacher{color:var(--muted);font-size:13px}
.score{position:relative;flex:none;width:72px;height:72px;display:grid;place-items:center}
.score.big{width:112px;height:112px}
.ring{position:absolute;inset:0;transform:rotate(-90deg)}
.ring-track{fill:none;stroke:var(--surface2);stroke-width:6}
.ring-fill{fill:none;stroke:var(--tone);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px color-mix(in srgb,var(--tone) 50%,transparent))}
.num{position:relative;font-size:22px;font-weight:800;letter-spacing:-.03em;margin-top:-6px;font-variant-numeric:tabular-nums}
.big .num{font-size:36px;margin-top:-10px}
.let{position:absolute;bottom:15px;font-size:11px;font-weight:800;color:var(--tone)}
.big .let{bottom:24px;font-size:13px}
.card .delta{position:relative;margin-top:-6px}
.terms{position:relative;display:flex;flex-wrap:wrap;gap:6px}
.chip{font:500 12px Inter,system-ui,sans-serif;display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface2);color:var(--muted)}
button.chip{cursor:pointer}
.chip b{color:var(--tone);font-weight:800;font-variant-numeric:tabular-nums}
.chip.on{border-color:var(--tone);color:var(--text)}
.spark{position:relative;width:100%;height:28px}
.spark path{fill:none;stroke:var(--tone);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;opacity:.85}

/* drawer */
.scrim{position:absolute;inset:0;z-index:8;background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:fadein .2s ease both}
@keyframes fadein{from{opacity:0}}
.drawer{position:absolute;top:0;right:0;bottom:0;z-index:9;width:min(520px,100%);display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--line);
  box-shadow:-30px 0 60px -20px rgba(0,0,0,.5);animation:slide .3s cubic-bezier(.2,.8,.2,1) both}
@keyframes slide{from{transform:translateX(40px);opacity:0}}
.drawer-head{display:flex;justify-content:space-between;gap:12px;padding:22px 22px 0}
.drawer-head h2{font-size:22px}
.drawer-score{display:flex;align-items:center;gap:18px;padding:18px 22px;border-bottom:1px solid var(--line)}
.drawer-body{flex:1;overflow:auto;padding:18px 22px}
.drawer-body h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}
.drawer-body h4{font-size:14px;margin:16px 0 8px}
.drawer-foot{padding:14px 22px;border-top:1px solid var(--line)}
.assignments{list-style:none;padding:0;display:flex;flex-direction:column;gap:6px}
.asg{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--tone)}
.asg-main{flex:1;min-width:0;display:flex;flex-direction:column}
.asg-main b{font-size:14px;font-weight:600}
.asg-main small{color:var(--muted);font-size:12px}
.asg-score{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;display:flex;flex-direction:column}
.asg-score small{color:var(--tone);font-size:12px}
.cat{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);padding:12px 2px 4px}
.loading{display:flex;align-items:center;gap:12px;color:var(--muted);padding:20px 0}
.spinner{width:18px;height:18px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* schedule */
.timeline{list-style:none;padding:0;display:flex;flex-direction:column;gap:10px;position:relative}
.slot{display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:stretch}
.slot-time{display:flex;flex-direction:column;align-items:flex-end;padding-top:14px;font-variant-numeric:tabular-nums}
.slot-time b{font-size:14px}.slot-time small{color:var(--muted);font-size:12px}
.slot-card{position:relative;display:flex;flex-direction:column;gap:2px;padding:14px 18px;padding-right:90px;border-radius:16px;border:1px solid var(--line);background:var(--surface);cursor:pointer;text-align:left;
  box-shadow:var(--shadow);border-left:4px solid var(--tone);transition:transform .15s}
.slot-card:hover{transform:translateX(3px)}
.slot-card b{font-size:16px}.slot-card small{color:var(--muted);font-size:13px}
.slot.current .slot-card{background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 16%,var(--surface)),var(--surface));border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}
.slot.current .period{color:var(--accent)}
.slot.past{opacity:.55}
.slot-grade{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-weight:800;font-size:20px;color:var(--tone)}
.progress{height:4px;border-radius:99px;background:var(--surface2);margin-top:10px;overflow:hidden}
.progress span{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.section-gap{height:36px}
.block-title{font-size:18px;margin-bottom:14px}

/* schedule controls + editor */
.sched-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.sched-bar .seg{width:auto}
.lunch-pick{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted)}
.lunch-select{font:600 14px Inter,system-ui,sans-serif;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:7px 10px}
.btn.small{padding:8px 12px;font-size:13px}
.sched-note{color:var(--muted);font-size:13px;margin:0 0 14px}
.sched-note.warn{color:var(--c);background:color-mix(in srgb,var(--c) 10%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);border-radius:12px;padding:10px 12px}
.slot-lunch .slot-card,.slot-swarm .slot-card{border-left-color:var(--b)}
.slot-lunch .slot-card{background:repeating-linear-gradient(135deg,var(--surface),var(--surface) 10px,var(--surface2) 10px,var(--surface2) 20px)}
.slot-card:disabled{cursor:default}
.editor h3{font-size:16px;margin-bottom:6px}
.edit-rows{list-style:none;padding:0;display:flex;flex-direction:column;gap:8px;margin:6px 0 16px}
.edit-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto auto;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface2)}
.edit-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-in{font:600 14px Inter,system-ui,sans-serif;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:6px 8px;color-scheme:light dark;min-width:0}
.dash{color:var(--muted)}
.edit-move{display:flex;gap:4px}
.icon-btn.mini{width:30px;height:30px;font-size:14px}
.icon-btn:disabled{opacity:.35;cursor:default}
.editor-actions{display:flex;flex-wrap:wrap;gap:8px}
.editor-add{display:flex;flex-wrap:wrap;gap:8px;margin:-6px 0 16px}
.editor-add:empty{display:none}
@media (max-width:560px){
  .edit-row{grid-template-columns:1fr 1fr;grid-template-areas:"name move" "start end"}
  .edit-move{justify-self:end}
  .edit-name{grid-area:name}.edit-move{grid-area:move}.dash{display:none}
  .edit-row .t-in[data-edge="start"]{grid-area:start}.edit-row .t-in[data-edge="end"]{grid-area:end}
  .sched-bar .seg{width:100%}
}

/* skyward pages */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.tile{display:flex;align-items:center;gap:14px;padding:18px;border-radius:18px;border:1px solid var(--line);background:var(--surface);cursor:pointer;text-align:left;box-shadow:var(--shadow);transition:all .15s}
.tile b{flex:1;font-size:15px}
.tile>svg{color:var(--muted);transition:transform .15s}
.tile:hover{border-color:var(--accent)}.tile:hover>svg{transform:translateX(3px);color:var(--accent)}
.tile-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.table-card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);margin-bottom:14px;overflow:hidden}
.table-card h3{font-size:15px;padding:16px 18px 0}
.table-scroll{overflow:auto;max-height:70vh}
table{width:100%;border-collapse:collapse;font-size:14px}
th{position:sticky;top:0;background:var(--surface);text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:14px 18px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 18px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--surface2)}
tr.group td{font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent);font-size:13px}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;color:var(--tone);background:color-mix(in srgb,var(--tone) 14%,transparent)}
.num-cell{font-weight:700;font-variant-numeric:tabular-nums}
.empty-state{text-align:center;padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:10px}
.empty-state p{color:var(--muted);max-width:440px}
.quote{font-size:13px;font-style:italic}
.foot-note{text-align:center;margin-top:10px}

/* report */
.report{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)}
.report-box{width:min(640px,100%);background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:22px;display:flex;flex-direction:column;gap:12px}
.report-box p{color:var(--muted);font-size:14px}
.report-box textarea{width:100%;height:220px;resize:vertical;font:12px ui-monospace,monospace;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
.report-actions{display:flex;gap:8px;justify-content:flex-end}

/* mobile */
@media (max-width:900px){
  .app{grid-template-columns:1fr;grid-template-rows:auto 1fr auto}
  .side{display:none}
  .mtop{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);
    background:color-mix(in srgb,var(--surface) 80%,transparent);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);position:relative;z-index:3}
  .mtop .brand{padding:0}
  .mtop-actions{display:flex;gap:6px}
  .tabbar{display:flex;justify-content:space-around;padding:6px 6px calc(6px + env(safe-area-inset-bottom));border-top:1px solid var(--line);
    background:color-mix(in srgb,var(--surface) 88%,transparent);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);position:relative;z-index:3}
  .tabbar .nav-item{flex-direction:column;gap:3px;font-size:11px;padding:6px 4px;flex:1;align-items:center}
  .tabbar .nav-item.on{background:none;box-shadow:none;color:var(--accent)}
  .home-grid{grid-template-columns:1fr}
  .span2{grid-column:auto}
  .bar{grid-template-columns:minmax(0,120px) 1fr 34px}
  .cd{min-width:0;flex:1;padding:8px 6px}.cd b{font-size:24px}
  .seg{width:100%}.seg-btn{flex:1;padding:7px 2px;font-size:11.5px}
  .filters{min-width:100%}.search{max-width:none}
  .grid{grid-template-columns:1fr}
  .slot{grid-template-columns:64px 1fr;gap:10px}
}
/* phones and tablets */
.main{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
@media (max-width:900px){
  .mtop{padding-top:calc(12px + env(safe-area-inset-top));padding-left:calc(16px + env(safe-area-inset-left));padding-right:calc(16px + env(safe-area-inset-right))}
  .icon-btn{width:44px;height:44px}
  .icon-btn.mini{width:36px;height:36px}
  .tabbar .nav-item{min-height:52px}
  .drawer{width:100%;border-left:0;padding-top:env(safe-area-inset-top)}
  .drawer-foot{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
  .view{padding-left:calc(16px + env(safe-area-inset-left));padding-right:calc(16px + env(safe-area-inset-right))}
}
/* iOS zooms into any text box under 16px when it's tapped. */
@media (pointer:coarse){.search,.sort,.lunch-select,.t-in,textarea{font-size:16px!important}}
/* Hover lifts only where there's a mouse; on touch they stick after a tap. */
@media (hover:none){.card:hover,.slot-card:hover,.btn:hover{transform:none}.tile:hover>svg{transform:none}}

@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{.side,.mtop,.tabbar,.toolbar,.ambient,.scrim,.drawer{display:none}.app{position:static;display:block;overflow:visible}.main{overflow:visible}.card{break-inside:avoid;animation:none}}
`;
  }
})();
