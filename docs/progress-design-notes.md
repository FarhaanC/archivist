# How Archivist shows progress while it reads your files

These are the rules the import progress card follows, and where each one comes
from. They were written before the card was built, so the card could be built
to them rather than justified afterwards.

## The rules

**1. Say nothing for a wait under a second. Use a moving-but-uncountable
indicator for 2–10 seconds. Use a real bar for anything longer.**
A bar that appears and vanishes is harder to read than no bar, and a bar for a
two-second wait only makes the app feel slower.
Sources: [Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/),
[Progress Indicators Make a Slow System Less Insufferable](https://www.nngroup.com/articles/progress-indicators/),
[Progress Indicators Ease the Wait](https://www.uxtigers.com/post/progress-indicators) (guidelines 1, 2 and 4).

**2. Prefer a bar that counts something real, and switch to one the moment you
can count.** An uncountable indicator says work is happening; it does not help
anyone decide whether to go and make tea.
Source: [Apple Human Interface Guidelines — Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
("When possible, use a determinate progress indicator", "When possible, switch
a progress bar from indeterminate to determinate").

**3. Count in the person's own units, not the machine's.** "5 of 16 done" and
"page 3 of 7" are things a person can picture. Internal stages are not.
Sources: NN/g's "Updating address 3 of 50" example in
[Progress Indicators](https://www.nngroup.com/articles/progress-indicators/);
UX Tigers guideline 7, "Count progress in user units".

**4. The bar never moves backwards.** Going back reads as something having
broken, even when it is arithmetically honest.
Source: UX Tigers guideline 5, "Never let the bar move backward".

**5. Keep something on the card changing. If nothing can change, say why in
one plain sentence.** A frozen bar is read as a crash.
Sources: UX Tigers guidelines 6 and 10; NN/g on the damage done by a bar that
stalls near the end.

**6. Round the time estimate hard, pad it, and revise it down far more often
than up.** Finishing early is a small gift; finishing late costs trust.
Sources: NN/g — "Don't try to be exact, as it will inevitably be inaccurate at
some point and the site's credibility will suffer… 'About 3 minutes remaining'
can be enough"; UX Tigers guideline 4 — estimates "rounded aggressively
('about 2 minutes,' never '1:47')", padded, "revise downward frequently…
revise upward rarely, in one visible correction".

**7. Show no estimate at all until there are real measurements behind one.**
Sources: [Why "1 Second Remaining" Takes So Long](https://comcomponent.com/en/blog/progress-bar-remaining-time/)
— "avoid forcing a countdown immediately after startup or a stage change. Wait
for useful observations, then present an estimate such as 'about a minute'."

*Where this departs from the brief:* that article prefers the words
"calculating time remaining" to a stale number. Archivist shows no line at
all instead. Its point is that a number you cannot stand behind is worse than
no number, and an empty line carries the same information as "calculating"
while adding one less thing to read — and the card already has an honest
sentence for those first seconds ("Getting the scan reader ready"). Both
satisfy the rule; this is the quieter of the two.

**8. With several files, show the overall state and the individual files
together.** One without the other leaves a person guessing.
Source: [File upload UI tips for designers](https://www.eleken.co/blog-posts/file-upload-ui)
— "For multiple files, showing both individual progress and an overall status
helps users understand what's done and what's still in motion."

**9. Count failures while the work runs; explain them when it finishes.** A
number during ("1 couldn't be read") keeps the count honest without pulling
attention away from the wait; the import report does the explaining.
Source: UX Tigers guideline 11, on narrating work and handing over interim
results.

**10. Accessibility.** The bar is `role="progressbar"` with
`aria-valuenow` / `aria-valuemin` / `aria-valuemax`, and `aria-valuenow` is
*omitted* while progress is uncountable. Its name comes from `aria-label`,
never from the changing text inside it. The estimate and headline sit in a
`role="status" aria-live="polite" aria-atomic="true"` region, and
announcements are throttled to about one every five seconds so a screen
reader is not talked over by its own progress updates.
Sources: [MDN — ARIA: progressbar role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role),
[W3C APG — Communicating Value and Limits for Range Widgets](https://www.w3.org/WAI/ARIA/apg/practices/range-related-properties/),
[MDN — ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions),
[WCAG technique ARIA22](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22),
and [The Complete Guide to ARIA Live Regions](https://www.a11y-collective.com/blog/aria-live/)
on keeping announcements short.

**11. Motion is a courtesy, not a requirement.** Width changes ease over about
300 ms; the "still alive" pulse and any shimmer are switched off entirely
under `prefers-reduced-motion: reduce`.

## What the card does, rule by rule

| Phase | What is shown | Rules |
| --- | --- | --- |
| Getting ready | No percentage, a moving bar with no value, and "Getting the scan reader ready — this happens once." | 1, 2, 7, 10 |
| Reading | Percentage, "Reading your files — 5 of 16 done", a line per file being read, a failure count, and a rounded estimate once one exists | 3, 4, 5, 6, 8, 9, 10 |
| Finishing | Bar full, "Finishing up" | 5 |
| Done | "Read 12 files (9 scans, 31 pages) in 48 seconds — about 4 seconds a page", then the report | 3, 9 |

The five estimate phrases, and nothing more precise than these: **"About N
minutes left"**, **"About a minute left"**, **"Under 30 seconds left"**,
**"Nearly done"**, and — below the threshold where an estimate is honest —
nothing at all.

## The standard timing test

`/#/timing` is a hidden page that imports the same set of made-up files every
time, so a number measured today can be compared with one measured next
month. It builds the files in the browser, imports them into a throwaway
store, records the timing, and deletes the store. Nothing touches the real
library.

The set, fixed:

| How many | What | Why it is in the set |
| --- | --- | --- |
| 6 | One-page scanned PDFs (text drawn onto a picture, no text inside) | The common case: a folder of scans |
| 1 | Six-page scanned PDF | Catches anything that only shows up across pages |
| 3 | Photos — one ordinary, one rotated, one 4000 pixels wide | Photos are drawn, turned upright and shrunk before reading |
| 1 | Blank page | Must be reported as unreadable, not silently added |
| 1 | Plain text file | The fast path, for contrast |

Twelve files, sixteen pages to read. Changing this set changes what the
number means, so it should be changed rarely, and the change noted here.
