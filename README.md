# Better Skyward (Skyward Glow)

A script that makes your Skyward Family Access gradebook look much better.
It reads the grades already on your Skyward Gradebook page and covers the
page with a clean dashboard. It doesn't send your grades anywhere.

**Install page:** https://loganwestlake.github.io/betterskyward/

## Files

| File | What it is |
|---|---|
| `glow.js` | The script itself. This is what runs on Skyward. |
| `index.html` | The install page: copy button and bookmark button. |
| `test/mock-gradebook.html` | A fake Skyward gradebook with made-up grades, for testing. |

## How to use it

1. Log in to Skyward and open **Gradebook**.
2. Either click your **✦ Skyward Glow** bookmark (set it up from the install
   page), or press **F12**, open **Console**, paste all of `glow.js`, and press
   **Enter**. Chrome may ask you to type `allow pasting` first.
3. Press **Esc** or click **Original** to go back to normal Skyward.

## If it says "no grades found"

Your Skyward page may be laid out differently from what the script expects.
Right-click one of your grades, choose **Inspect**, right-click the
highlighted `<tr>` row, choose **Copy → Copy outerHTML**, and share it so
the script can be updated.
