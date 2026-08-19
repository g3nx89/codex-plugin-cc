import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

import { teardownBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";

function spawnDetachedSleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child;
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

test("teardownBrokerSession terminates the broker when the caller passes no killProcess", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-broker-teardown-"));
  const pidFile = path.join(sessionDir, "broker.pid");
  const child = spawnDetachedSleeper();
  fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");

  try {
    // Precondition: the stand-in broker is actually running before teardown.
    assert.doesNotThrow(() => process.kill(child.pid, 0), "stand-in broker failed to start");

    // The shape ensureBrokerSession uses on its stale-session and startup-timeout paths.
    teardownBrokerSession({ pidFile, sessionDir, pid: child.pid, killProcess: null });

    assert.equal(
      await waitForExit(child),
      true,
      "teardown removed the bookkeeping but left the broker process running"
    );
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test("the test harness terminates brokers recorded for its temp dirs when the process exits", async () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-broker-stateroot-"));
  const child = spawnDetachedSleeper();

  const helpersUrl = new URL("./helpers.mjs", import.meta.url).href;
  const lifecycleUrl = new URL("../plugins/codex/scripts/lib/broker-lifecycle.mjs", import.meta.url).href;
  const source = [
    `import { makeTempDir } from ${JSON.stringify(helpersUrl)};`,
    `import { saveBrokerSession } from ${JSON.stringify(lifecycleUrl)};`,
    `const dir = makeTempDir();`,
    `saveBrokerSession(dir, { endpoint: null, pidFile: null, logFile: null, sessionDir: null, pid: ${child.pid} });`
  ].join("\n");

  try {
    assert.doesNotThrow(() => process.kill(child.pid, 0), "stand-in broker failed to start");

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_DATA: stateRoot }
    });
    assert.equal(result.status, 0, `harness child failed: ${result.stderr}`);

    assert.equal(
      await waitForExit(child),
      true,
      "the harness exited leaving the broker it recorded still running"
    );
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("the test harness removes the temp workspaces it handed out when the process exits", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-broker-stateroot-"));
  const helpersUrl = new URL("./helpers.mjs", import.meta.url).href;
  const source = [
    `import fs from "node:fs";`,
    `import { makeTempDir } from ${JSON.stringify(helpersUrl)};`,
    `const dir = makeTempDir();`,
    `process.stdout.write(`,
    "  `${dir}|${fs.existsSync(dir)}`",
    `);`
  ].join("\n");

  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_DATA: stateRoot }
    });
    assert.equal(result.status, 0, `harness child failed: ${result.stderr}`);

    const [dir, existedInChild] = result.stdout.trim().split("|");
    // Precondition: the workspace really existed while the harness was alive.
    assert.equal(existedInChild, "true", "makeTempDir did not create the workspace");

    assert.equal(fs.existsSync(dir), false, "the harness left its temp workspace behind");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
