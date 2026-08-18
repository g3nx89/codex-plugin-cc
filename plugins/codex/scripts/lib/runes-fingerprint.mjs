/* Fork delta (see FORK-DELTA.md): content-aware repository fingerprint for
   the stop gate's no-change fast path.

   Stub: always returns null, which the fast path reads as "cannot tell,
   run the review". Failing toward reviewing is the safe direction, so an
   unimplemented fingerprint costs time, never a skipped review. */

export function repoFingerprint(_cwd) {
  return null;
}
