import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { repoFingerprint } from "../plugins/codex/scripts/lib/runes-fingerprint.mjs";

function seedRepo() {
  const repo = makeTempDir();
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "base\n");
  run("git", ["add", "tracked.txt"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  return repo;
}

test("an untracked file appearing, and its content being re-edited, both change the fingerprint", () => {
  const repo = seedRepo();

  const clean = repoFingerprint(repo);
  assert.ok(clean, "a committed repo must produce a fingerprint");

  fs.writeFileSync(path.join(repo, "untracked.txt"), "v1");
  const added = repoFingerprint(repo);
  assert.notEqual(added, clean, "a new untracked file must change the fingerprint");

  fs.writeFileSync(path.join(repo, "untracked.txt"), "v2");
  const edited = repoFingerprint(repo);
  assert.notEqual(edited, added, "re-editing an untracked file must change the fingerprint");
});

test("a tracked file going dirty, and an already-dirty file being re-edited, both change the fingerprint", () => {
  const repo = seedRepo();
  const clean = repoFingerprint(repo);

  fs.writeFileSync(path.join(repo, "tracked.txt"), "dirty-1");
  const dirty = repoFingerprint(repo);
  assert.notEqual(dirty, clean, "a tracked file going dirty must change the fingerprint");

  fs.writeFileSync(path.join(repo, "tracked.txt"), "dirty-2");
  const reedited = repoFingerprint(repo);
  assert.notEqual(reedited, dirty, "re-editing an ALREADY-dirty file must change the fingerprint");
});

test("the fingerprint is stable when nothing changes", () => {
  const repo = seedRepo();
  fs.writeFileSync(path.join(repo, "untracked.txt"), "v1");

  const first = repoFingerprint(repo);
  const second = repoFingerprint(repo);
  assert.ok(first);
  assert.equal(second, first, "an unchanged tree must fingerprint identically");
});

test("one file containing a NUL is distinguished from two files that stream the same bytes", () => {
  const repo = seedRepo();

  fs.writeFileSync(path.join(repo, "a"), "b\0c");
  const oneFile = repoFingerprint(repo);

  fs.writeFileSync(path.join(repo, "a"), "");
  fs.writeFileSync(path.join(repo, "b"), "c");
  const twoFiles = repoFingerprint(repo);

  assert.ok(oneFile);
  assert.notEqual(
    twoFiles,
    oneFile,
    'a="b\\0c" must not collide with a="" plus b="c" — naive name+NUL+content concatenation streams both as 61 00 62 00 63'
  );
});

test("an untracked file's mode change is a change", () => {
  const repo = seedRepo();
  const file = path.join(repo, "script.sh");
  fs.writeFileSync(file, "#!/bin/sh\n");

  const before = repoFingerprint(repo);
  fs.chmodSync(file, 0o755);
  const after = repoFingerprint(repo);

  assert.ok(before);
  assert.notEqual(after, before, "chmod +x on an untracked file must change the fingerprint");
});

test("retargeting an untracked symlink between equal-content targets changes the fingerprint", () => {
  const repo = seedRepo();
  fs.writeFileSync(path.join(repo, "t1"), "same");
  fs.writeFileSync(path.join(repo, "t2"), "same");
  const link = path.join(repo, "slink");

  fs.symlinkSync("t1", link);
  const toT1 = repoFingerprint(repo);

  fs.unlinkSync(link);
  fs.symlinkSync("t2", link);
  const toT2 = repoFingerprint(repo);

  assert.ok(toT1);
  assert.notEqual(
    toT2,
    toT1,
    "stat/readFile dereference, so path, mode, size and content all match — the link needs its own identity"
  );
});

test("symlink targets that differ only in non-UTF-8 bytes are distinguished", () => {
  const repo = seedRepo();
  const link = path.join(repo, "slink");

  fs.symlinkSync(Buffer.from([0x78, 0x80]), link);
  const first = repoFingerprint(repo);

  fs.unlinkSync(link);
  fs.symlinkSync(Buffer.from([0x78, 0x81]), link);
  const second = repoFingerprint(repo);

  assert.ok(first);
  assert.notEqual(
    second,
    first,
    "a string decode collapses both invalid bytes to U+FFFD; git tells the blobs apart, so the target must be hashed as raw bytes"
  );
});

test("the fingerprint is null outside a git repository", () => {
  const notARepo = makeTempDir();
  fs.writeFileSync(path.join(notARepo, "file.txt"), "content");

  assert.equal(
    repoFingerprint(notARepo),
    null,
    "no git answer means no fingerprint, so the fast path falls through to a review"
  );
});

test("the fingerprint is null when untracked files exceed the cap", () => {
  const repo = seedRepo();
  for (let i = 0; i < 201; i += 1) {
    fs.writeFileSync(path.join(repo, `f${i}.txt`), String(i));
  }

  assert.equal(
    repoFingerprint(repo),
    null,
    "an unbounded scan is refused rather than hashed, so the fast path falls through to a review"
  );
});
