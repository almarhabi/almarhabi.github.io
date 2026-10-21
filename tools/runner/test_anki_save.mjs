import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
function git(cwd, ...args) { const p = spawnSync("git", args, { cwd, encoding: "utf8" }); assert.equal(p.status, 0, p.stderr); return p.stdout.trim(); }

test("lease retry carries jobs arriving during push without resurrecting processed jobs or retaining history", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anki-git-test-")), remote = path.join(temp, "remote.git"), producer = path.join(temp, "producer"), builder = path.join(temp, "builder"), marker = path.join(temp, "arrived"), done = path.join(temp, "done.txt");
  try {
    git(temp, "init", "--bare", "--initial-branch=anki-jobs", remote); git(temp, "clone", remote, producer);
    git(producer, "config", "user.name", "test"); git(producer, "config", "user.email", "test@example.invalid");
    fs.mkdirSync(path.join(producer, "in")); fs.mkdirSync(path.join(producer, "out")); fs.writeFileSync(path.join(producer, "in", ".keep"), ""); fs.writeFileSync(path.join(producer, "out", ".keep"), ""); fs.writeFileSync(path.join(producer, "in", "oldjob12.json"), '{"cards":[]}');
    git(producer, "add", "-A"); git(producer, "commit", "-m", "initial"); git(producer, "push", "origin", "anki-jobs"); git(temp, "clone", remote, builder);
    fs.unlinkSync(path.join(builder, "in", "oldjob12.json")); fs.writeFileSync(path.join(builder, "out", "oldjob12.json"), '{"ok":true}'); fs.writeFileSync(done, "oldjob12\n");
    const hook = path.join(builder, ".git", "hooks", "pre-push");
    fs.writeFileSync(hook, `#!/usr/bin/env bash\nset -eu\nif [[ ! -e ${quote(marker)} ]]; then\n touch ${quote(marker)}\n printf '%s' '{"queued":true}' > ${quote(path.join(producer, "in", "newjob12.json"))}\n printf '%s' 'invalid filename' > ${quote(path.join(producer, "in", "bad name.json"))}\n ln -s ../../private ${quote(path.join(producer, "in", "symlink1.json"))}\n git -C ${quote(producer)} add -A\n git -C ${quote(producer)} commit -qm arrival\n git -C ${quote(producer)} push -q origin anki-jobs\nfi\n`); fs.chmodSync(hook, 0o755);
    const p = spawnSync("bash", [path.join(ROOT, ".github/scripts/save-anki.sh"), done], { cwd: builder, encoding: "utf8", env: { ...process.env, ANKI_RETRY_DELAY: "0" } }); assert.equal(p.status, 0, p.stderr);
    git(builder, "fetch", "origin", "anki-jobs");
    assert.equal(git(builder, "show", "FETCH_HEAD:in/newjob12.json"), '{"queued":true}'); assert.equal(git(builder, "show", "FETCH_HEAD:out/oldjob12.json"), '{"ok":true}');
    const files = git(builder, "ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n"); assert(!files.includes("in/oldjob12.json")); assert(!files.includes("in/bad name.json")); assert(!files.includes("in/symlink1.json")); assert.equal(git(builder, "rev-list", "--count", "FETCH_HEAD"), "1");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
