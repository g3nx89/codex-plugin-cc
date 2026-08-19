# Fork delta

This is a fork of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)
(Apache 2.0). Upstream's `LICENSE` and `NOTICE` are preserved unchanged.
No pull request upstream is planned: the delta below is maintained here.

**This file is the manifest.** A file that diverges from upstream and is not
listed here does not belong in the fork. At every upstream merge, this table is
the checklist.

## Rules this fork is held to

1. **Every divergence traces to a measured cost.** Not "would be useful" — a
   number, an incident, or a defect that actually happened.
2. **Additive beats modified.** New logic goes in new files; upstream files are
   touched only at the minimum point of attachment.
3. **No drive-by changes.** No restyling upstream code, no fixing parts we do
   not use, no speculative hardening.
4. **Everything is covered by the upstream suite**, extended — never bypassed.
   Each hunk is ablated separately; a hunk no test fails for is given a test or
   deleted.
5. **Upstream sync is on request**, not automatic:
   `git fetch upstream && git merge upstream/main`, rerun the suite, bump the
   `-runes.N` suffix.

## The delta

| File | Kind | Why | Evidence | Date |
|---|---|---|---|---|
| `plugins/codex/scripts/lib/runes-fingerprint.mjs` | **new** | Content-aware repository fingerprint for the no-change fast path. | 9 transitions, each a real skipped review before it was closed; 8 guards ablated separately, all load-bearing | 2026-08-18 |
| `plugins/codex/scripts/stop-review-gate-hook.mjs` | modified, 3 points | (a) full BLOCK body forwarded instead of the first line; (b) fast-path early return on an unchanged tree, fingerprinting the **workspace root**; (c) fingerprint recorded only on ALLOW. | (a) 3 of 4 findings hidden at one BLOCK and 5 of 6 at another, 2026-08-17; a manual `jq` recovery on every BLOCK. (b) ~904 gate runs in ~6h over five weeks, most under 10s on a tree already approved. (c) a blocked state must never be waved through. | 2026-08-18 |
| `tests/runes-fingerprint.test.mjs` | **new** | Fingerprint suite: content, stability, NUL-collision, mode, symlink identity, symlink raw bytes, and both fail-toward-review guards. | 9 tests | 2026-08-18 |
| `tests/runtime.test.mjs` | modified, additive | Five tests: multi-finding BLOCK forwarded; skip on unchanged tree; re-review after a block; re-review when unfingerprintable; untracked files outside the invocation directory still seen. Existing tests untouched. | 91 → 105 tests, all green | 2026-08-18 |
| `tests/fake-codex-fixture.mjs` | modified, additive | `adversarial-multi` scenario emitting a three-finding BLOCK. Upstream's single-line BLOCK made the truncation invisible to its own suite. | the pre-existing assertion passed with findings 2..N dropped | 2026-08-18 |
| `plugins/codex/scripts/lib/broker-lifecycle.mjs` | modified, 1 point | `teardownBrokerSession` terminated the broker only when the caller injected `killProcess`; it now defaults to `terminateProcessTree`. Coalesced with `??`, not a destructuring default — `ensureBrokerSession` passes `killProcess: null` explicitly on both internal paths, which a destructuring default would not have caught. | Field: 1,494 abandoned processes (746 brokers + 748 app-servers) in a single Ghostty tab, 15.8 GB, after teardown had already unlinked their pid files. Both hunks ablated separately, each load-bearing | 2026-08-19 |
| `tests/helpers.mjs` | modified, 2 points | `node --test` never runs SessionEnd, so every broker the suite spawned outlived it, and its temp workspaces were never removed. `makeTempDir` now registers each workspace and a process exit hook reaps brokers and removes the directories. | A full suite run went from +141 workspaces and one broker per spawn to 0 and 0, 108/108 green. /tmp is tmpfs, so 3,020 stale workspaces were ~202 MB of RAM | 2026-08-19 |
| `tests/broker-lifecycle.test.mjs` | **new** | Broker teardown suite: default termination on the production call shape, harness broker reaping, harness workspace removal. | 3 tests; each observes a real detached process or directory, not a mock | 2026-08-19 |
| `package.json`, `package-lock.json`, `.claude-plugin/marketplace.json`, `plugins/codex/.claude-plugin/plugin.json` | version only | `1.0.6-runes.N` marks the local level and invalidates the plugin cache on install. | — | 2026-08-18 |

The marketplace **name** is deliberately left as upstream's `openai-codex`, so
the derived plugin data directory (`codex-openai-codex`) is unchanged and the
gate's configuration and job history survive the switch. The fork is identified
by its `version`, not by a renamed marketplace. Consequence: this marketplace
replaces upstream's rather than coexisting with it.

## Known boundaries — deliberate, not oversights

- **The fingerprint record is keyed by session id in the system temp
  directory**, not by workspace. Two workspaces could share a record only via
  the `"nosession"` fallback *and* at an identical HEAD, diff and untracked set.
  Left as-is rather than hardened speculatively; revisit if it is ever measured.
- **The fast path only sees the repository.** A turn that changed nothing inside
  the working tree — editing files outside it, for instance — fingerprints as
  unchanged and is skipped. This is the intended trade: the gate reviews the
  previous turn's *code* changes. The fingerprint is taken from the workspace
  ROOT, so the whole repository is in scope regardless of where the session was
  launched: of the three git commands it runs, `git ls-files --others` is scoped
  to its working directory (5 files from the root, 0 from `app/`), while
  `rev-parse` and `diff HEAD` are repository-wide.
- **BLOCK detection remains first-line based.** Only the reason body was widened;
  a payload whose first line is not a verdict behaves exactly as upstream.

## Running the suite here

Claude Code exports `CLAUDE_PLUGIN_DATA` and `CODEX_COMPANION_SESSION_ID` into
its shells, and both leak into the suite: the first flips `resolveStateDir` to
the plugin data directory, the second makes `filterJobsForCurrentSession` drop
every fixture job. Four tests fail on a perfectly healthy checkout. Scrub them:

```sh
env -u CLAUDE_PLUGIN_DATA -u CODEX_COMPANION_SESSION_ID \
    -u CODEX_COMPANION_TRANSCRIPT_PATH npm test
```

CI is unaffected — no such harness there.
