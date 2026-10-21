# Better Skyward

A redesigned Skyward Family Access that runs on top of the real one. It reads
what Skyward already shows you and draws a new app over it:

- **Home**: greeting, average and GPA estimate, the class happening right now,
  classes under 80, and grades that changed since your last visit.
- **Grades**: a card per class with every term; click a class to see its
  assignments (read from Skyward's own assignment popup).
- **Schedule**: your day as a timeline, plus Skyward's schedule page.
- **Attendance**: tardies and absences with totals.
- **More**: every other page in Skyward's menu, redesigned.

Your grades and info only ever travel between your browser and Skyward. The
one other request the app makes is reading the version number of the
published `glow.js` on GitHub, so it can tell you when an update is out.

**Install page:** https://loganwestlake.github.io/betterskyward/

## Files

| File | What it is |
|---|---|
| `glow.js` | The script itself. This is what runs on Skyward. |
| `index.html` | The install page: setup steps for each device. |
| `skyward-glow.user.js` | Optional userscript that opens Better Skyward after you sign in. |
| `test/mock-gradebook.html` | A fake Skyward gradebook with made-up grades, for testing. |
| `test/seplog01.html`, `test/sfhome01.html` | Practice sign-in and home pages for the userscript. |
| `test/pages/` | Fake Attendance and Schedule pages the practice gradebook links to. |
| `test/server.js` | A pretend Skyward server for local testing. |
| `test/e2e.js` | Automated test of every screen, in a real browser. |

## How to use it (no apps)

One bookmark does everything. Make it from the install page
(https://loganwestlake.github.io/betterskyward/), which shows the steps for
iPhone, Android or a computer.

1. Tap **Better Skyward** from anywhere: it opens the Skyward sign-in page.
2. Sign in.
3. Run **Better Skyward** again on the Skyward page. On a phone, tap the
   address bar, type **Better**, and tap the starred bookmark; that's what
   makes it run on the page you're on.

Run on the sign-in page, it just says to sign in first. The phone bookmark
loads the newest `glow.js` every time.

Why not embed Skyward in a page with a button on top? Browsers don't let one
site read or control another site shown inside it, and iPhone Safari blocks
Skyward's sign-in inside another site's frame. The code has to run on
Skyward's own page, which is what the bookmark does.

Optional: `skyward-glow.user.js` does the same automatically for people who
already use a userscript extension (such as Tampermonkey on a computer).

## Schedule, SWARM and lunch

- **Mon/Wed/Fri** use the class times Skyward lists. Lunch is the gap between
  two classes, and the lunch letter comes from the period (for example, `4B`
  means B lunch).
- **Tue/Thu** are SWARM days. SWARM is the **Period 8** class in Skyward. The
  times come from your saved times (**Schedule → Edit times**), then the
  official times in `OFFICIAL_SWARM` in `glow.js` (one list per lunch letter),
  then an estimate marked "estimated".
- Quarter dates for the countdown are in `QUARTERS` in `glow.js`.

## If something looks wrong

Your Skyward may be laid out differently from what the script expects. Open
the page that looks wrong in the app, click the **flag** button (Report a
problem), click **Copy**, and share what it copied so the script can be
updated. The report includes your class names and grades, so only send it to
someone you trust.

## Versions and updates

The version number is at the top of `glow.js` (`const VERSION = ...`). The
install page and the app (next to the logo, and at the bottom of **More**)
both show it. When the published version is newer than your bookmark, the app
shows an **Update** banner: delete the old bookmark and drag the new one from
the install page.

Bump `VERSION` with every change.

## Testing

```
npm install     # once, installs Playwright
npm test        # runs every screen against the pretend Skyward
npm run serve   # pretend Skyward at http://localhost:8790/test/mock-gradebook.html
```

Add `?strict=1` to the practice page URL to make its menu ignore background
clicks. Some real Skyward sites behave that way, and the app then has to load
pages by posting the session itself.
