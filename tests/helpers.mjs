import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import {
  clearBrokerSession,
  loadBrokerSession,
  teardownBrokerSession
} from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";

const tempWorkspaces = [];

// node --test never runs the SessionEnd hook, so brokers the runtime starts
// for a temp workspace would outlive the suite, and /tmp is tmpfs on Linux
// so abandoned workspaces are RAM. Reap both when the test process exits.
process.on("exit", () => {
  for (const workspace of tempWorkspaces) {
    const session = loadBrokerSession(workspace);
    if (session) {
      teardownBrokerSession(session);
      clearBrokerSession(workspace);
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

export function makeTempDir(prefix = "codex-plugin-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempWorkspaces.push(dir);
  return dir;
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    shell: options.shell ?? (process.platform === "win32" && !path.isAbsolute(command)),
    windowsHide: true
  });
}

export function initGitRepo(cwd) {
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Codex Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
}
