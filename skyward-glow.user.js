// ==UserScript==
// @name         Better Skyward
// @namespace    https://loganwestlake.github.io/betterskyward/
// @version      2.4.0
// @description  Opens Better Skyward by itself after you sign in to Skyward Family Access.
// @match        https://skyward.iscorp.com/*
// @noframes
// @run-at       document-idle
// @grant        none
// @homepageURL  https://loganwestlake.github.io/betterskyward/
// @downloadURL  https://loganwestlake.github.io/betterskyward/skyward-glow.user.js
// @updateURL    https://loganwestlake.github.io/betterskyward/skyward-glow.user.js
// ==/UserScript==

/*
 * A userscript extension (Userscripts on iPhone, Tampermonkey or
 * Violentmonkey elsewhere) runs this on every Skyward page:
 *
 *   sign-in page  → notes that you're signing in and shows a small hint
 *   first page after signing in → opens the Gradebook for you
 *   Gradebook     → starts Better Skyward (unless you closed it this visit)
 *   any other page → shows a small "✦ Better Skyward" button to open it
 *
 * It always loads the newest glow.js, so it never needs updating.
 */
(function () {
  'use strict';

  const GLOW_URL = 'https://loganwestlake.github.io/betterskyward/glow.js';
  const FLOW_KEY = 'skywardGlow:flow';           // 'signing-in' between sign-in and the next page
  const DISMISSED_KEY = 'skywardGlow:dismissed'; // set by glow.js when you close it
  const HOST_ID = 'skyward-glow-host';

  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* private mode */ } }
  };

  const page = location.pathname.split('/').pop().toLowerCase();
  // Skyward's sign-in page is seplog01.w. Other pages can hold a password
  // box (changing your password), so a password box only counts on a page
  // without Skyward's menu.
  const isSignIn = /^seplog/.test(page) ||
    (!!document.querySelector('input[type="password"]') && !document.querySelector('#sf_navMenu, a[data-nav]'));
  const isGradebook = /gradebook/.test(page) || !!document.querySelector('a[id="showGradeInfo"], a[data-lit]');

  if (isSignIn) {
    session.set(FLOW_KEY, 'signing-in');
    hint('✦ Better Skyward will open after you sign in');
    return;
  }

  // Just signed in: a fresh visit, so forget any earlier "closed". If this
  // isn't the Gradebook, go there, where Glow can read everything.
  const justSignedIn = session.get(FLOW_KEY) === 'signing-in';
  session.del(FLOW_KEY);
  if (justSignedIn) {
    session.del(DISMISSED_KEY);
    if (!isGradebook) {
      const link = gradebookLink();
      if (link) { link.click(); return; }
      // No Gradebook link on this page: start here; Glow loads grades itself.
      return launch();
    }
  }

  if (isGradebook && session.get(DISMISSED_KEY) !== '1') launch();
  else pill();

  function gradebookLink() {
    const links = Array.from(document.querySelectorAll('a[data-nav], #sf_navMenu a, nav a, a'));
    return links.find((a) => /sfgradebook/i.test(a.getAttribute('data-nav') || '')) ||
      links.find((a) => /^\s*grade ?book\s*$/i.test(a.textContent || ''));
  }

  // Loads glow.js into the page itself (not the extension's sandbox): it
  // needs to work with Skyward's own forms and menus.
  function launch() {
    if (document.getElementById(HOST_ID)) return;
    session.del(DISMISSED_KEY);
    const s = document.createElement('script');
    s.src = GLOW_URL + '?t=' + Date.now();
    s.onerror = () => alert('Better Skyward could not load. Check your internet connection, then tap ✦ Better Skyward to try again.');
    document.documentElement.appendChild(s);
    pill();
  }

  // A small button to reopen Glow; hidden while Glow is on screen.
  function pill() {
    if (document.getElementById(HOST_ID + '-open')) return;
    const b = document.createElement('button');
    b.id = HOST_ID + '-open';
    b.type = 'button';
    b.textContent = '✦ Better Skyward';
    b.setAttribute('aria-label', 'Open Better Skyward');
    b.style.cssText = 'position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483645;' +
      'padding:12px 18px;border:0;border-radius:999px;font:600 15px -apple-system,system-ui,sans-serif;color:#0A0A0A;' +
      'background:linear-gradient(135deg,#F59E0B,#EA580C);box-shadow:0 8px 24px rgba(234,88,12,.45);cursor:pointer;';
    b.onclick = launch;
    document.body.appendChild(b);
    const sync = () => {
      const host = document.getElementById(HOST_ID);
      const back = document.getElementById(HOST_ID + '-back');
      b.style.display = (host && host.style.display !== 'none') || back ? 'none' : '';
    };
    sync();
    setInterval(sync, 1000); // Glow shows and hides itself by style; check once a second
  }

  function hint(text) {
    const d = document.createElement('div');
    d.id = HOST_ID + '-hint';
    d.textContent = text;
    d.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);' +
      'z-index:2147483645;max-width:calc(100% - 32px);padding:10px 16px;border-radius:999px;font:600 14px -apple-system,system-ui,sans-serif;' +
      'color:#0A0A0A;background:linear-gradient(135deg,#F59E0B,#EA580C);box-shadow:0 8px 24px rgba(234,88,12,.4);text-align:center;';
    document.body.appendChild(d);
  }
})();
