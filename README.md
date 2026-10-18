# Better Skyward (Skyward Glow)

A redesigned Skyward Family Access that runs on top of the real one. It reads
what Skyward already shows you and draws a new app over it:

- **Home**: greeting, average and GPA estimate, the class happening right now,
  classes under 80, and grades that changed since your last visit.
- **Grades**: a card per class with every term; click a class to see its
  assignments (read from Skyward's own assignment popup).
- **Schedule**: your day as a timeline, plus Skyward's schedule page.
- **Attendance**: tardies and absences with totals.
- **More**: every other page in Skyward's menu, redesigned.

It only talks to Skyward itself; nothing is sent anywhere else.

**Install page:** https://loganwestlake.github.io/betterskyward/

## Files

| File | What it is |
|---|---|
| `glow.js` | The script itself. This is what runs on Skyward. |
| `index.html` | The install page: copy button and bookmark button. |
| `test/mock-gradebook.html` | A fake Skyward gradebook with made-up grades, for testing. |
| `test/pages/` | Fake Attendance and Schedule pages the practice gradebook links to. |

## How to use it

1. Log in to Skyward and open **Gradebook**.
2. Either click your **✦ Skyward Glow** bookmark (set it up from the install
   page), or press **F12**, open **Console**, paste all of `glow.js`, and press
   **Enter**. Chrome may ask you to type `allow pasting` first.
3. Press **Esc** or click **Original** to go back to normal Skyward.

## If something looks wrong

Your Skyward may be laid out differently from what the script expects. Open
the page that looks wrong in the app, click the **flag** button (Report a
problem), click **Copy**, and share what it copied so the script can be
updated. The report includes your class names and grades, so only send it to
someone you trust.
