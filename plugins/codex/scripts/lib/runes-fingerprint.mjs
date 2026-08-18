/* Fork delta (see FORK-DELTA.md): content-aware repository fingerprint for
   the stop gate's no-change fast path.

   The fingerprint must change whenever the previous turn changed anything
   a review would look at, and must be identical when it changed nothing.
   Every guard below closes a case that was a real skipped review.

   Fails toward reviewing: any git error, no HEAD, an unreadable file, an
   entry that is neither a regular file nor a symlink, or an untracked set
   too large to scan all return null, and a null fingerprint never
   matches, so the review runs. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

/* An untracked set this large is a checkout, a build output directory or a
   stray clone — not a turn's worth of edits. Refuse rather than scan. */
const UNTRACKED_SCAN_LIMIT = 200;

export function repoFingerprint(cwd) {
  const options = { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const head = spawnSync("git", ["rev-parse", "HEAD"], options);
  const diff = spawnSync("git", ["diff", "HEAD"], options);
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options);
  if (head.status !== 0 || diff.status !== 0 || untracked.status !== 0) {
    return null;
  }

  const files = untracked.stdout.split("\0").filter(Boolean).sort();
  if (files.length > UNTRACKED_SCAN_LIMIT) {
    return null;
  }

  const hash = crypto.createHash("sha256");
  hash.update(diff.stdout);

  for (const file of files) {
    let record;
    try {
      record = describeEntry(path.join(cwd, file), file);
    } catch {
      return null;
    }
    if (record === null) {
      return null;
    }
    hash.update(record);
  }

  return `${head.stdout.trim()}:${hash.digest("hex")}`;
}

/* One fixed-width, NUL-delimited record per entry, so two entries can never
   stream into each other: a git path cannot contain NUL, and mode, size and
   digest are all bounded. The digest is type-prefixed so a link and a file
   can never collide at equal hash input. */
function describeEntry(fullPath, relativePath) {
  const stats = fs.lstatSync(fullPath);

  let digest;
  if (stats.isSymbolicLink()) {
    /* Raw bytes: readlink's default string decode collapses invalid UTF-8
       into U+FFFD, merging distinct targets that git tells apart. lstat and
       readlink also keep the link's own identity, where stat and readFile
       would dereference to the target. */
    digest = `L:${crypto.createHash("sha256").update(fs.readlinkSync(fullPath, { encoding: "buffer" })).digest("hex")}`;
  } else if (stats.isFile()) {
    digest = `F:${crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex")}`;
  } else {
    return null;
  }

  const mode = (stats.mode & 0o7777).toString(8);
  return `${relativePath}\0${mode}\0${stats.size}\0${digest}\n`;
}
