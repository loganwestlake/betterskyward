/*
 * Skyward Glow — a better-looking Skyward Family Access gradebook.
 *
 * How to use: log in to Skyward, open the Gradebook page, then paste this
 * whole file into the browser console (F12 → Console) and press Enter.
 * It reads the grades that are already on the page and draws a new
 * dashboard on top. Nothing is sent anywhere; it only reads the page.
 * Run it again (or press Esc / "Original") to get back to plain Skyward.
 */
(function () {
  'use strict';

  var HOST_ID = 'skyward-glow-host';
  var STORE_KEY = 'skywardGlow:lastSnapshot';
  var existing = document.getElementById(HOST_ID);
  if (existing) { existing.remove(); removeBackPill(); var ps = document.getElementById(HOST_ID + '-print'); if (ps) ps.remove(); document.documentElement.style.overflow = ''; return; }

  // ---------------------------------------------------------------- scrape

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function parseGrade(text) {
    var t = clean(text);
    var num = t.match(/-?\d+(\.\d+)?/);
    var letter = t.match(/\b([A-F][+-]?)\b/);
    return {
      raw: t,
      score: num ? parseFloat(num[0]) : null,
      letter: letter ? letter[1] : (num ? letterFor(parseFloat(num[0])) : null)
    };
  }

  function letterFor(n) {
    if (n == null) return null;
    if (n >= 90) return 'A';
    if (n >= 80) return 'B';
    if (n >= 70) return 'C';
    if (n >= 60) return 'D';
    return 'F';
  }

  function gradeLinks(root) {
    return Array.prototype.slice.call(root.querySelectorAll('a[id="showGradeInfo"], a[data-lit]'));
  }

  function rowIndex(tr) {
    var body = tr.parentElement;
    return Array.prototype.indexOf.call(body.children, tr);
  }

  // Skyward splits each grade grid into a frozen left table (class names)
  // and a scrolling right table (grades). Rows line up by position, so for
  // each grade row we look for the class description in the matching row
  // of any sibling table inside the same grid.
  function describeRow(tr, grid) {
    var info = classInfo(tr);
    if (info) return info;
    var idx = rowIndex(tr);
    var tables = grid.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].contains(tr)) continue;
      var bodies = tables[i].tBodies.length ? tables[i].tBodies : [tables[i]];
      for (var b = 0; b < bodies.length; b++) {
        var row = bodies[b].children[idx];
        if (row && row.tagName === 'TR') {
          info = classInfo(row);
          if (info) return info;
        }
      }
    }
    return null;
  }

  // The nearest ancestor of the grade table that also holds class names.
  function gridFor(tr) {
    var node = tr.closest('table').parentElement;
    while (node && node !== document.body && !node.querySelector('.classDesc, .gb_classDesc')) node = node.parentElement;
    return node || document.body;
  }

  function classInfo(row) {
    var desc = row.querySelector('.classDesc') || row.querySelector('.gb_classDesc, [class*="classDesc"]');
    if (!desc) return null;
    var cell = desc.closest('td, th') || desc.parentElement;
    var nameEl = desc.querySelector('a') || desc;
    var name = clean(nameEl.textContent);
    if (!name) return null;
    var text = clean(cell.textContent);
    var teacher = '';
    var links = cell.querySelectorAll('a');
    for (var i = links.length - 1; i >= 0; i--) {
      if (links[i] !== nameEl && clean(links[i].textContent)) { teacher = clean(links[i].textContent); break; }
    }
    var period = (text.match(/Period\s*([\w-]+)/i) || [])[1] || '';
    var time = (text.match(/\(([^)]*(?:AM|PM)[^)]*)\)/i) || [])[1] || '';
    return { name: titleCase(name), teacher: teacher, period: period, time: time };
  }

  function titleCase(s) {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
      .replace(/\b(Ap|Ib|Aice|Ese|Pe|Jrotc|Ii|Iii|Iv)\b/g, function (m) { return m.toUpperCase(); })
      .replace(/\bHon\b/g, 'Honors');
  }

  function scrape(doc) {
    var links = gradeLinks(doc);
    var courses = [];
    var byKey = {};
    var termOrder = [];

    links.forEach(function (a) {
      var tr = a.closest('tr');
      if (!tr) return;
      var info = describeRow(tr, gridFor(tr)) || { name: 'Class ' + (a.getAttribute('data-cni') || courses.length + 1), teacher: '', period: '', time: '' };
      var key = (a.getAttribute('data-cni') || '') + '|' + info.name + '|' + info.period;
      var course = byKey[key];
      if (!course) {
        course = byKey[key] = { key: key, name: info.name, teacher: info.teacher, period: info.period, time: info.time, grades: {}, links: {} };
        courses.push(course);
      }
      var term = clean(a.getAttribute('data-lit')) || termFromHeader(a) || 'Grade';
      if (termOrder.indexOf(term) === -1) termOrder.push(term);
      var g = parseGrade(a.textContent);
      if (g.raw) { course.grades[term] = g; course.links[term] = a; }
    });

    // Classes that are listed but have no grades yet.
    Array.prototype.forEach.call(doc.querySelectorAll('.classDesc'), function (desc) {
      var row = desc.closest('tr');
      var info = row && classInfo(row);
      if (!info) return;
      var known = courses.some(function (c) { return c.name === info.name && c.period === info.period; });
      if (!known) courses.push({ key: info.name + '|' + info.period, name: info.name, teacher: info.teacher, period: info.period, time: info.time, grades: {}, links: {} });
    });

    courses.sort(function (a, b) {
      var pa = parseInt(a.period, 10), pb = parseInt(b.period, 10);
      if (isNaN(pa) && isNaN(pb)) return a.name.localeCompare(b.name);
      if (isNaN(pa)) return 1;
      if (isNaN(pb)) return -1;
      return pa - pb;
    });

    return { courses: courses, terms: termOrder, student: studentName(doc) };
  }

  function termFromHeader(a) {
    var td = a.closest('td');
    var table = td && td.closest('table');
    if (!table || !table.tHead) return '';
    var ths = table.tHead.querySelectorAll('th');
    var th = ths[td.cellIndex];
    return th ? clean(th.textContent) : '';
  }

  function studentName(doc) {
    var el = doc.querySelector('#sf_StudentLabel, .sf_StudentLabel, #studentName, .studentName');
    if (el && clean(el.textContent)) return clean(el.textContent);
    var title = doc.querySelector('[id^="grid_stuGradesGrid"]');
    var header = title && title.closest('div') && title.closest('div').querySelector('h2, .sf_heading');
    return header ? clean(header.textContent) : '';
  }

  // ---------------------------------------------------------------- math

  var GPA_POINTS = { A: 4, B: 3, C: 2, D: 1, F: 0 };

  function termStats(courses, term) {
    var scores = [], points = [];
    courses.forEach(function (c) {
      var g = c.grades[term];
      if (!g) return;
      if (g.score != null) scores.push(g.score);
      if (g.letter) points.push(GPA_POINTS[g.letter.charAt(0)]);
    });
    var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : null;
    var gpa = points.length ? points.reduce(function (a, b) { return a + b; }, 0) / points.length : null;
    return { avg: avg, gpa: gpa, count: scores.length || points.length };
  }

  // Default to the right-most term that most classes have a grade for.
  function pickCurrentTerm(data) {
    var best = data.terms[0], bestCount = -1;
    data.terms.forEach(function (t) {
      var n = data.courses.filter(function (c) { return c.grades[t]; }).length;
      if (n >= bestCount && n >= data.courses.length / 2) { best = t; bestCount = n; }
    });
    if (bestCount === -1) {
      data.terms.forEach(function (t) {
        var n = data.courses.filter(function (c) { return c.grades[t]; }).length;
        if (n > bestCount) { best = t; bestCount = n; }
      });
    }
    return best;
  }

  function tone(g) {
    if (!g) return 'none';
    var l = g.letter ? g.letter.charAt(0) : letterFor(g.score);
    return ({ A: 'a', B: 'b', C: 'c', D: 'd', F: 'f' })[l] || 'none';
  }

  function loadSnapshot() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }

  function saveSnapshot(data) {
    var snap = {};
    data.courses.forEach(function (c) {
      snap[c.key] = {};
      Object.keys(c.grades).forEach(function (t) { snap[c.key][t] = c.grades[t].score; });
    });
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), grades: snap })); } catch (e) { /* storage blocked */ }
  }

  // ---------------------------------------------------------------- render

  var FLAME = '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#EA580C"/></linearGradient></defs>' +
    '<path d="M16 3c1 5 8 7.5 8 14.5a8 8 0 0 1-16 0c0-3.5 2.2-5.8 3.4-6.8 0 2.3 1.1 3.4 2.3 3.4 0-4.6 1.1-8 2.3-11.1z" fill="url(#sg)"/></svg>';


  var data = scrape(document);
  if (!data.courses.length) {
    alert('Skyward Glow: no grades found on this page.\n\nOpen Skyward Family Access → Gradebook first, wait for it to load, then run this again.');
    return;
  }

  var previous = loadSnapshot();
  saveSnapshot(data);

  var state = { term: pickCurrentTerm(data), query: '', sort: 'period', theme: 'dark' };
  try { state.theme = localStorage.getItem('skywardGlow:theme') || 'dark'; } catch (e) { /* storage blocked */ }

  var host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  var root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  document.documentElement.style.overflow = 'hidden';

  // Print only the dashboard, not the Skyward page underneath it.
  var printStyle = document.createElement('style');
  printStyle.id = HOST_ID + '-print';
  printStyle.textContent = '@media print{body>*:not(#' + HOST_ID + '){display:none!important}' +
    '#' + HOST_ID + '{position:static!important}}';
  document.head.appendChild(printStyle);

  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,500&display=swap';
  document.head.appendChild(font);

  root.innerHTML = '<style>' + CSS() + '</style><div class="app" data-theme="' + state.theme + '"></div>';
  var app = root.querySelector('.app');
  app.classList.add('intro');
  setTimeout(function () { app.classList.remove('intro'); }, 900);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n, digits) { return n == null ? '—' : n.toFixed(digits == null ? 1 : digits); }

  function delta(course, term) {
    if (!previous || !previous.grades[course.key]) return null;
    var before = previous.grades[course.key][term];
    var g = course.grades[term];
    if (before == null || !g || g.score == null) return null;
    var d = g.score - before;
    return Math.abs(d) < 0.05 ? null : d;
  }

  function ring(g) {
    var pct = g && g.score != null ? Math.max(0, Math.min(100, g.score)) : 0;
    var r = 30, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 72 72" aria-hidden="true">' +
      '<circle cx="36" cy="36" r="' + r + '" class="ring-track"/>' +
      '<circle cx="36" cy="36" r="' + r + '" class="ring-fill" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct / 100)) + '"/>' +
      '</svg>';
  }

  function sparkline(course) {
    var pts = data.terms.map(function (t) { return course.grades[t] ? course.grades[t].score : null; });
    var vals = pts.filter(function (v) { return v != null; });
    if (vals.length < 2) return '';
    var min = Math.min.apply(null, vals.concat([70])), max = Math.max.apply(null, vals.concat([100]));
    var w = 120, h = 28, step = w / (pts.length - 1 || 1);
    var d = '', started = false;
    pts.forEach(function (v, i) {
      if (v == null) return;
      var y = h - ((v - min) / (max - min || 1)) * h;
      d += (started ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + y.toFixed(1);
      started = true;
    });
    return '<svg class="spark" viewBox="-2 -2 ' + (w + 4) + ' ' + (h + 4) + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function sortedCourses() {
    var q = state.query.toLowerCase();
    var list = data.courses.filter(function (c) {
      return !q || (c.name + ' ' + c.teacher + ' period ' + c.period).toLowerCase().indexOf(q) !== -1;
    });
    if (state.sort === 'grade-low' || state.sort === 'grade-high') {
      var dir = state.sort === 'grade-low' ? 1 : -1;
      list = list.slice().sort(function (a, b) {
        var ga = a.grades[state.term], gb = b.grades[state.term];
        var sa = ga && ga.score != null ? ga.score : (dir === 1 ? 999 : -1);
        var sb = gb && gb.score != null ? gb.score : (dir === 1 ? 999 : -1);
        return (sa - sb) * dir;
      });
    }
    return list;
  }

  function render() {
    var stats = termStats(data.courses, state.term);
    var graded = data.courses.filter(function (c) { return c.grades[state.term] && c.grades[state.term].score != null; });
    var best = graded.slice().sort(function (a, b) { return b.grades[state.term].score - a.grades[state.term].score; })[0];
    var watch = graded.filter(function (c) { return c.grades[state.term].score < 80; }).length;
    var hour = new Date().getHours();
    var hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    var first = data.student ? data.student.split(/[\s,]+/).filter(Boolean)[data.student.indexOf(',') > -1 ? 1 : 0] : '';

    app.innerHTML =
      '<div class="glow"></div>' +
      '<header class="top">' +
        '<div class="brand"><span class="flame">' + FLAME + '</span><span>Skyward <em>Glow</em></span></div>' +
        '<div class="actions">' +
          '<button class="btn ghost" data-act="theme" title="Toggle light / dark">' + (state.theme === 'dark' ? '☀︎' : '☾') + '</button>' +
          '<button class="btn ghost" data-act="print" title="Print a report">Print</button>' +
          '<button class="btn" data-act="close" title="Back to plain Skyward (Esc)">Original</button>' +
        '</div>' +
      '</header>' +
      '<main>' +
        '<section class="hero">' +
          '<p class="eyebrow">' + esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p>' +
          '<h1>' + hello + (first ? ', <em>' + esc(titleCase(first)) + '</em>' : '') + '.</h1>' +
          '<p class="sub">Here\'s where you stand in <strong>' + esc(state.term) + '</strong>.</p>' +
        '</section>' +
        '<section class="stats">' +
          stat('Average', fmt(stats.avg), stats.avg != null ? letterFor(stats.avg) : '', 'tone-' + tone(stats.avg != null ? { score: stats.avg } : null)) +
          stat('Unweighted GPA', fmt(stats.gpa, 2), 'estimate', '') +
          stat('Top class', best ? fmt(best.grades[state.term].score, 0) : '—', best ? best.name : '', '') +
          stat('Below 80', String(watch), watch ? 'worth a look' : 'all clear', watch ? 'tone-c' : 'tone-a') +
        '</section>' +
        '<section class="toolbar">' +
          '<div class="tabs" role="tablist">' + data.terms.map(function (t) {
            return '<button role="tab" class="tab' + (t === state.term ? ' on' : '') + '" data-term="' + esc(t) + '">' + esc(t) + '</button>';
          }).join('') + '</div>' +
          '<div class="filters">' +
            '<input class="search" type="search" placeholder="Search classes or teachers" value="' + esc(state.query) + '">' +
            '<select class="sort">' +
              opt('period', 'By period') + opt('grade-low', 'Lowest first') + opt('grade-high', 'Highest first') +
            '</select>' +
          '</div>' +
        '</section>' +
        '<section class="grid">' + sortedCourses().map(card).join('') + '</section>' +
        '<footer class="foot">Read from this Skyward page only — nothing leaves your browser. ' +
          (previous ? 'Changes are compared to ' + esc(new Date(previous.at).toLocaleString()) + '. ' : '') +
          'GPA is an unweighted estimate. Click a grade to open Skyward\'s assignment details.</footer>' +
      '</main>';
  }

  function opt(v, label) { return '<option value="' + v + '"' + (state.sort === v ? ' selected' : '') + '>' + label + '</option>'; }

  function stat(label, value, note, cls) {
    return '<div class="stat ' + cls + '"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value) +
      '</span><span class="note">' + esc(note) + '</span></div>';
  }

  function card(c) {
    var g = c.grades[state.term];
    var d = delta(c, state.term);
    var t = tone(g);
    return '<article class="card tone-' + t + '">' +
      '<div class="card-top">' +
        '<div class="meta">' +
          (c.period ? '<span class="period">Period ' + esc(c.period) + (c.time ? ' · ' + esc(c.time) : '') + '</span>' : '') +
          '<h2>' + esc(c.name) + '</h2>' +
          (c.teacher ? '<p class="teacher">' + esc(c.teacher) + '</p>' : '') +
        '</div>' +
        '<button class="score" data-open="' + esc(c.key) + '" data-t="' + esc(state.term) + '"' + (g ? '' : ' disabled') + ' title="' + (g ? 'Open assignment details' : 'No grade yet') + '">' +
          ring(g) +
          '<span class="num">' + (g ? esc(g.score != null ? Math.round(g.score) : g.raw) : '—') + '</span>' +
          '<span class="let">' + (g && g.letter ? esc(g.letter) : '') + '</span>' +
        '</button>' +
      '</div>' +
      (d != null ? '<p class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ ') + d.toFixed(1) + ' since last check</p>' : '') +
      '<div class="terms">' + data.terms.map(function (term) {
        var tg = c.grades[term];
        return '<button class="chip tone-' + tone(tg) + (term === state.term ? ' on' : '') + '" data-open="' + esc(c.key) + '" data-t="' + esc(term) + '"' + (tg ? '' : ' disabled') + '>' +
          '<span>' + esc(term) + '</span><b>' + (tg ? esc(tg.score != null ? Math.round(tg.score) : tg.raw) : '·') + '</b></button>';
      }).join('') + '</div>' +
      sparkline(c) +
    '</article>';
  }

  // ---------------------------------------------------------------- events

  app.addEventListener('click', function (e) {
    var el = e.target.closest('button');
    if (!el || el.disabled) return;
    if (el.dataset.term) { state.term = el.dataset.term; render(); return; }
    if (el.dataset.open) { openDetails(el.dataset.open, el.dataset.t); return; }
    var act = el.dataset.act;
    if (act === 'close') close();
    if (act === 'print') window.print();
    if (act === 'theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      app.dataset.theme = state.theme;
      try { localStorage.setItem('skywardGlow:theme', state.theme); } catch (err) { /* storage blocked */ }
      render();
    }
  });

  app.addEventListener('input', function (e) {
    if (!e.target.classList.contains('search')) return;
    state.query = e.target.value;
    var pos = e.target.selectionStart;
    render();
    var box = root.querySelector('.search');
    box.focus();
    box.setSelectionRange(pos, pos);
  });

  app.addEventListener('change', function (e) {
    if (e.target.classList.contains('sort')) { state.sort = e.target.value; render(); }
  });

  function onKey(e) { if (e.key === 'Escape' && host.style.display !== 'none') close(); }
  document.addEventListener('keydown', onKey);

  function close() {
    host.remove();
    printStyle.remove();
    removeBackPill();
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.overflow = '';
  }

  // Skyward's own assignment popup is the most reliable way to see
  // details, so hide the dashboard, click the real grade link, and leave
  // a pill to come back.
  function openDetails(key, term) {
    var course = data.courses.filter(function (c) { return c.key === key; })[0];
    var link = course && course.links[term];
    if (!link || !document.contains(link)) return;
    host.style.display = 'none';
    document.documentElement.style.overflow = '';
    link.click();
    showBackPill();
  }

  function showBackPill() {
    removeBackPill();
    var pill = document.createElement('button');
    pill.id = HOST_ID + '-back';
    pill.textContent = '✦ Back to Glow';
    pill.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:12px 18px;border:0;border-radius:999px;' +
      'font:600 14px Inter,system-ui,sans-serif;color:#0A0A0A;background:linear-gradient(135deg,#F59E0B,#EA580C);' +
      'box-shadow:0 10px 30px rgba(234,88,12,.45);cursor:pointer;';
    pill.onclick = function () {
      removeBackPill();
      host.style.display = '';
      document.documentElement.style.overflow = 'hidden';
    };
    document.body.appendChild(pill);
  }

  function removeBackPill() {
    var p = document.getElementById(HOST_ID + '-back');
    if (p) p.remove();
  }

  render();

  // ---------------------------------------------------------------- style

  function CSS() {
    return [
      ':host{all:initial}',
      '*{box-sizing:border-box;margin:0}',
      '.app{--bg:#0A0A0A;--surface:#141414;--surface2:#1C1C1C;--line:#262626;--text:#EDEDED;--muted:#9A9A9A;--accent:#F59E0B;--accent2:#EA580C;',
        '--a:#34D399;--b:#60A5FA;--c:#FBBF24;--d:#FB923C;--f:#F87171;--none:#525252;',
        'position:absolute;inset:0;overflow:auto;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}',
      '.app[data-theme="light"]{--bg:#FAF7F2;--surface:#FFFFFF;--surface2:#F3EEE6;--line:#E7E0D5;--text:#1A1714;--muted:#6B645C;',
        '--a:#059669;--b:#2563EB;--c:#B45309;--d:#C2410C;--f:#DC2626;--none:#A8A29E}',
      '.glow{position:fixed;top:-30vh;left:50%;width:90vw;height:60vh;transform:translateX(-50%);pointer-events:none;',
        'background:radial-gradient(ellipse at center,rgba(245,158,11,.16),rgba(234,88,12,.06) 45%,transparent 70%);filter:blur(10px)}',
      '.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px clamp(16px,4vw,48px);',
        'background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}',
      '.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:16px}',
      '.brand em,h1 em{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-weight:500;',
        'background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}',
      '.flame{display:grid;place-items:center}',
      '.actions{display:flex;gap:8px}',
      '.btn{font:600 13px Inter,system-ui,sans-serif;padding:8px 14px;border-radius:10px;border:0;cursor:pointer;color:#0A0A0A;',
        'background:linear-gradient(135deg,var(--accent),var(--accent2));transition:transform .15s,box-shadow .15s}',
      '.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(234,88,12,.35)}',
      '.btn.ghost{background:var(--surface);color:var(--text);border:1px solid var(--line)}',
      '.btn.ghost:hover{box-shadow:none;border-color:var(--accent)}',
      'main{position:relative;max-width:1200px;margin:0 auto;padding:clamp(24px,5vw,56px) clamp(16px,4vw,48px) 48px}',
      '.eyebrow{color:var(--accent);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}',
      'h1{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:clamp(30px,5vw,52px);line-height:1.1;letter-spacing:-.02em;margin:10px 0 8px}',
      '.sub{color:var(--muted);font-size:16px}',
      '.sub strong{color:var(--text)}',
      '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:32px 0 28px}',
      '.stat{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.stat .label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}',
      '.stat .value{font-size:32px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}',
      '.stat .note{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.stat.tone-a .value{color:var(--a)}.stat.tone-b .value{color:var(--b)}.stat.tone-c .value{color:var(--c)}.stat.tone-d .value{color:var(--d)}.stat.tone-f .value{color:var(--f)}',
      '.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}',
      '.tabs{display:flex;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow-x:auto;max-width:100%}',
      '.tab{font:600 13px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:8px;border:0;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap}',
      '.tab:hover{color:var(--text)}',
      '.tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0A0A0A}',
      '.filters{display:flex;gap:8px;flex:1;justify-content:flex-end;min-width:240px}',
      '.search,.sort{font:500 14px Inter,system-ui,sans-serif;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 12px;outline:none}',
      '.search{flex:1;max-width:300px;min-width:0}',
      '.search:focus,.sort:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(245,158,11,.18)}',
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}',
      '.card{--tone:var(--none);position:relative;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px;',
        'display:flex;flex-direction:column;gap:14px;overflow:hidden;transition:transform .2s,border-color .2s}',
      '.intro .card{animation:rise .4s ease both}',
      '.card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:var(--tone);opacity:.9}',
      '.card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--tone) 50%,var(--line))}',
      '.tone-a{--tone:var(--a)}.tone-b{--tone:var(--b)}.tone-c{--tone:var(--c)}.tone-d{--tone:var(--d)}.tone-f{--tone:var(--f)}.tone-none{--tone:var(--none)}',
      '.card-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}',
      '.meta{min-width:0}',
      '.period{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
      'h2{font-size:17px;font-weight:700;letter-spacing:-.01em;margin:4px 0 2px;line-height:1.25}',
      '.teacher{color:var(--muted);font-size:13px}',
      '.score{position:relative;flex:none;width:72px;height:72px;border:0;background:none;padding:0;cursor:pointer;color:var(--text);display:grid;place-items:center}',
      '.score:disabled{cursor:default}',
      '.ring{position:absolute;inset:0;transform:rotate(-90deg)}',
      '.ring-track{fill:none;stroke:var(--surface2);stroke-width:6}',
      '.ring-fill{fill:none;stroke:var(--tone);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)}',
      '.num{position:relative;font-size:22px;font-weight:800;letter-spacing:-.03em;margin-top:-6px;font-variant-numeric:tabular-nums}',
      '.let{position:absolute;bottom:15px;font-size:11px;font-weight:700;color:var(--tone)}',
      '.score:not(:disabled):hover .ring-track{stroke:color-mix(in srgb,var(--tone) 25%,var(--surface2))}',
      '.delta{font-size:12px;font-weight:600;margin-top:-6px}.delta.up{color:var(--a)}.delta.down{color:var(--f)}',
      '.terms{display:flex;flex-wrap:wrap;gap:6px}',
      '.chip{font:500 12px Inter,system-ui,sans-serif;display:flex;gap:6px;align-items:center;padding:4px 9px;border-radius:999px;cursor:pointer;',
        'border:1px solid var(--line);background:var(--surface2);color:var(--muted)}',
      '.chip b{color:var(--tone);font-weight:700;font-variant-numeric:tabular-nums}',
      '.chip.on{border-color:var(--tone)}',
      '.chip:disabled{cursor:default;opacity:.55}',
      '.chip:not(:disabled):hover{border-color:var(--tone);color:var(--text)}',
      '.spark{width:100%;height:28px}',
      '.spark path{fill:none;stroke:var(--tone);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;opacity:.8}',
      '.foot{margin-top:36px;color:var(--muted);font-size:12px;text-align:center;max-width:640px;margin-left:auto;margin-right:auto}',
      '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.intro .card{animation:none}.ring-fill{transition:none}}',
      '@media (max-width:600px){.filters{min-width:100%}.search{max-width:none}.grid{grid-template-columns:1fr}}',
      '@media print{.top,.toolbar,.glow{display:none}.app{position:static;overflow:visible}.card{break-inside:avoid}}'
    ].join('');
  }
})();
