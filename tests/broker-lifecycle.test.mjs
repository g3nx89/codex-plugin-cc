import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

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
