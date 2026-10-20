# anki-jobs

Working branch for the study site's ANKI builder (see `.github/workflows/anki.yml` and `tools/anki/` on `main`).

- `in/<id>.json`: cards the site sent (removed after the build)
- `out/<id>.apkg`: the built deck
- `out/<id>.json`: build status the site reads

Outputs are deleted after 14 days. GitHub Pages does not use this branch.
