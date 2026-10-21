#!/usr/bin/env bash
# Run inside the anki-jobs checkout after job.py. Never overwrite an input that arrived during this build.
set -euo pipefail
job_done_file=${1:?path to the completed job ID list is required}
touch "$job_done_file"
if [[ ! -d in || -L in ]]; then printf '%s\n' 'Invalid job input directory' >&2; exit 1; fi
git config user.name "anki-builder"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
for attempt in 1 2 3 4 5 6; do
  git fetch -q origin anki-jobs
  job_tip=$(git rev-parse FETCH_HEAD)
  while IFS= read -r -d '' job_path; do
    job_id=${job_path#in/}; job_id=${job_id%.json}
    [[ "$job_path" == "in/$job_id.json" && "$job_id" =~ ^[a-z0-9]{8,40}$ ]] || continue
    if [[ ! -e "$job_path" && ! -L "$job_path" ]] && ! grep -Fqx -- "$job_id" "$job_done_file"; then
      # A branch input is data, never a symlink or executable. Git contents are written to a temporary plain file.
      job_mode=$(git ls-tree "$job_tip" -- "$job_path")
      [[ "$job_mode" == 100644\ blob\ * ]] || continue
      git show "$job_tip:$job_path" > "$job_path.tmp"
      mv -- "$job_path.tmp" "$job_path"
    fi
  done < <(git ls-tree -r --name-only -z "$job_tip" -- in/)
  git add -A
  job_commit=$(git commit-tree "$(git write-tree)" -m "anki: decks")
  if git push -q --force-with-lease="anki-jobs:$job_tip" origin "$job_commit:refs/heads/anki-jobs"; then exit 0; fi
  sleep "$((attempt * ${ANKI_RETRY_DELAY:-2}))"
done
printf '%s\n' 'The job branch kept changing; nothing was force-overwritten' >&2
exit 1
