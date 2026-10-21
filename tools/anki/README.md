# ANKI 20.9

`PROMPT.md` is the user's complete prompt, copied byte-for-byte (apart from surrounding whitespace) into `AK_PROMPT` in `index.html`. The existing prompt-copy test checks that they agree.

The site reads the full lecture, including its opening objectives, from the same file. Full page text is retained in IndexedDB with explicit `PAGE` / `END PAGE` boundaries. Stage 1 extracts the objectives verbatim and scores units; stage 2 and repair requests receive both that map and the full lecture. Unreadable or invented objectives block a new deck.

The main card cap comes from the synced review budget (defaults: 60 min, 20 sec, 2 lectures/day, retention .90). Retention >= .93 uses 15 instead of 10; an exam in fewer than seven days halves the cap and restricts main cards to Tier 1. The cap is an upper bound. Knots, forgotten points and quiz mistakes keep their separate extra-card allowance; a key already tested in the main deck gets no duplicate extra. Follow-up commands apply to the main deck.

New jobs include `objectives` (required correct-answer objective IDs), `cap` (main upper bound), `lecture`, and cards with `objectives`, resolved `objective` text, `tier`, and `weak`. The builder uses the fixed `MCQ 4-Option` model with the requested nine fields. It validates coverage, main count, tags, options and answer balance. Legacy jobs retain the previous model and validation behavior.

`marks[id].akx` is a synced deletion timestamp. It clears the site's ANKI marks and invalidates old deck caches, download references and in-flight work without changing lecture study progress. It does not control cards already imported into the Anki application. Published job artifacts continue to follow the existing 14-day retention policy.

New AI split requests contain at most seven pages. Page ranges must be contiguous, complete and no longer than seven pages per clip. Existing rated study clips keep their progress.

Run the checks from the repository root:

```sh
python3 tools/anki/test_job.py
python3 tools/anki/test_objectives.py
node tools/anki/test_objectives.js
npm install --prefix tools/runner
node tools/anki/test_browser.js
```

The browser checks use mocked Kimi data and block outbound requests. Set `CHROMIUM_PATH` when Chromium is not at `/usr/bin/chromium`.
