# Bug: a brand-new file written through a tdc FUSE mount can intermittently vanish — the commit conflicts, gets one failed retry, and is silently dropped

**Date found:** 2026-07-17
**Found by:** Liya Du, while re-verifying `tidbcloud-fs-for-e2b` after the `tdc` public-repo config migration
**tdc version:** 0.1.2 (310c15ec55addf1bdbea3d25ca36854c680a4009, 2026-07-17T12:18:10Z, linux/amd64)
**drive9 companion version:** a53e497 (a53e497ac9a09141ba850fab03d7f1331c6b5c9e, build 2026-07-12T02:20:24Z) — [tidbcloud/tdc](https://github.com/tidbcloud/tdc) mounts now delegate to a separate `tdc-drive9` companion process from [mem9-ai/drive9](https://github.com/mem9-ai/drive9); `internal/fs/fuse_mount.go` in the `tdc` repo itself is not the code path exercised by `tdc fs mount-file-system`.
**Severity: data loss, silent at write time.** `cp`/`>` through the mount returns success; the loss only surfaces later, if at all — via `tdc fs drain-file-system`, a subsequent read, or never.

## Summary

Writing a file that has **never existed remotely** through a tdc FUSE mount can, intermittently (observed on roughly 1 in 3–4 attempts in this session, not reliably reproducible on demand), fail to land on the remote at all. The local `cp`/`close()` succeeds — there is no error at write time, unlike the previously-documented ESTALE bug. The failure only becomes visible later: `tdc fs drain-file-system` reports `commit_queue_conflicts=1` and exits non-zero, and the file is simply absent from `tdc fs ls`/`tdc fs cat` on the remote. For a short-lived environment like an E2B sandbox — mount, write, unmount, kill — there is no second chance to recover it: the only local record of the failed write lives in the sandbox's own filesystem, which is gone the moment the sandbox is killed.

This is the same underlying **commit-queue conflict** family as the write path in general (see Root-cause analysis), just observed here on a fresh path instead of an overwrite.

## Reproduction

Not deterministic — this took several attempts to catch directly. The clearest capture came from writing one new file and immediately draining:

```bash
tdc fs mount-file-system --mount-path ./mnt --remote-path /demo --ready-timeout 60s
cp staged.txt ./mnt/repro.txt      # returns 0 — no error
tdc fs drain-file-system --mount-path ./mnt
```

Observed output from `drain-file-system`:

```
tdc [ERROR]: component: drive9 mount
version: a53e497
git_hash: a53e497ac9a09141ba850fab03d7f1331c6b5c9e
git_branch: HEAD
build_time: 2026-07-12T02:20:24Z
go_version: go1.25.1
mount: drive9 mount drain: pending work remains after drain: dirty_handles=0 commit_queue_pending=0 commit_queue_in_flight=0 commit_queue_delayed=0 commit_queue_conflicts=1 uploader_queued=0 uploader_in_flight=0 uploader_cached=0
```

and from the data plane directly:

```
$ tdc fs ls --path /demo
{"path": "/demo", "entries": [ ... /demo/repro.txt is simply not present ... ]}
```

First observed as: this repo's own `pnpm test` smoke test — mount, write `smoke.txt`, read it back **through the same mount** (succeeds — the read-back is served from local write-back state, not the remote), unmount, kill the sandbox, then read `smoke.txt` from the host with no mount at all. The host read failed with `tdc [ERROR]: fs cat: not found`. A same-command retry immediately after passed cleanly.

## Symptom chain

1. `close()` on a newly-created file stages the write into drive9's local write-back/shadow store and enqueues a `CommitEntry` on the async `CommitQueue`. `close()` returns success as soon as the entry is queued — it does **not** wait for the remote commit.
2. The queue's background worker (`commitOne`, `pkg/fuse/commit_queue.go:1004`, `mem9-ai/drive9@a53e497`) attempts the upload. On success it's done; on a generic error it retries up to `maxRetries = 5` (`:1005`) with backoff.
3. If the upload instead returns `client.ErrConflict` (HTTP 409) — on **any** attempt, including the first — the retry loop is abandoned immediately and control passes to `tryAutoResolveConflict` (`:1744`), bypassing the remaining retry budget entirely (`:1103-1119`).
4. `tryAutoResolveConflict` `Stat`s the remote path. For a brand-new file this comes back not-found, which the code treats as "the conflict came from upload-session state ... or the file was deleted remotely" and retries the upload **exactly once** as a plain create (`:1802-1841`, comment at `:1802`).
5. If that single retry also errors — for any reason, including another 409 — it falls straight through to `onCommitTerminalFailure` (`:1841` failure path). No further retries.
6. The entry is marked `PendingConflict` in the local pending index and left there, "preserved for manual recovery" (`:583-584`) — recovery being a later mount against the **same `$HOME`**, which replays `PendingConflict`/pending entries on start (`internal/fs/fuse_mount_control.go:193-197`, `recoverPending`).
7. In this repo's usage, step 6's recovery never happens: each `createSandbox()` is a fresh E2B VM with its own `$HOME`, and `unmountAndKill()` destroys the sandbox immediately after unmounting. The `PendingConflict` entry, and the only copy of the written data, dies with it.

## Root-cause analysis (code walk, all refs `pkg/fuse/commit_queue.go` at `mem9-ai/drive9@a53e497` unless noted)

What I could **not** pin down: why the *initial* upload of a genuinely new path (no prior remote object, single writer, no layers involved) returns a 409 in the first place. That requires visibility into the tdc fs backend/data-plane's own locking or upload-session state, which is outside what's in either the `tdc` or `drive9` repos. Everything downstream of that first 409 is verified by direct code reading in `mem9-ai/drive9`:

- The write path used by `tdc fs mount-file-system` is drive9's own `Dat9FS` (`pkg/fuse/dat9fs.go`) plus `CommitQueue` (`pkg/fuse/commit_queue.go`) — confirmed by the `component: drive9 mount` header on every mount/drain error in this session. `tdc`'s own native Go FUSE implementation (`internal/fs/fuse_mount.go` in the `tidbcloud/tdc` repo — the file the previous ESTALE bug was root-caused against) is not on this path.
- **Conflicts get one shot; everything else gets five.** The retry loop's own comment at `commit_queue.go:1742` says auto-resolve "covers ~80% of agent conflict scenarios (whole-file overwrites) ... Max 1 retry to avoid write amplification." That trade-off is reasonable for a genuine overwrite conflict (where LWW or an idempotent-content check applies), but for the not-found branch — our case — the single retry is really "try the create one more time," with no distinction from a plain transient failure that would otherwise get 4 more attempts with backoff.
- **The failure mode is asymmetric with the success mode.** A successful write returns from `close()` before the remote commit is confirmed (write-back by design, for FUSE latency). A **failed** write also returns from `close()` with no indication anything is wrong — the failure surfaces only through a side channel (`drain-file-system`, or noticing the file is missing later). Callers that don't explicitly drain or verify have no way to know.
- **The recovery mechanism assumes a persistent `$HOME`.** `PendingConflict` entries are designed to be replayed on the next mount in the same profile/mount-cache directory (`fuse_mount_control.go:193-197`). That's a sound design for a long-lived developer machine. It provides no protection for a mount-write-unmount-destroy workflow against a fresh VM each time, which is exactly this repo's pattern (and, more broadly, a common pattern for ephemeral AI-agent sandboxes — the audience `tdc fs` explicitly targets).

## Suggested fix directions

1. **Give conflict auto-resolve the same retry budget as generic failures**, at least for the not-found/create-retry branch (`tryAutoResolveConflict`, `commit_queue.go:1802-1841`). If the underlying 409 is itself transient (e.g. an upload-session race, per the existing comment at `:1802`), one retry is a coin flip; several with backoff would very likely close this gap without materially changing the "terminal after N genuine conflicts" behavior for real overwrite conflicts.
2. **Make terminal failure loud, not just locally logged.** Right now a `PendingConflict` produces a `log.Printf` (`:584`) and a stat surfaced only through an explicit `drain-file-system` call. For a write path whose entire contract from the caller's point of view is "`close()` returning 0 means the write is safe," a terminal commit failure arguably deserves to be surfaced back through the FUSE layer on the *next* operation against that path (e.g. `EIO` on a subsequent `stat`/`open`), not only through an out-of-band CLI command the caller has to know to run.
3. **Document the ephemeral-`$HOME` risk explicitly.** If (1) isn't done, `tdc`/`drive9`'s docs for `mount-file-system` should call out that write durability is only fully guaranteed when the same mount-cache directory persists across sessions (i.e., not for the "ephemeral machine" token-only flow this project uses, and not for typical AI-sandbox usage generally) — and recommend that callers `drain-file-system` before unmounting if they need a hard guarantee the data landed.

## Workaround in the sample

None applied — this is a small-probability race with no reliable client-side avoidance found so far (an A/B test of ~16 writes in this session, half with a preceding `rm -f`, half without, showed no conflicts either way; the one clean reproduction came from an otherwise-ordinary single write). What `tidbcloud-fs-for-e2b` does instead is fail loud: `test.ts`'s smoke test reads the file back from the host with no mount at all after the sandbox is destroyed, so a lost write surfaces as a failing test rather than silent success. `demo.ts` has no equivalent check on `question.txt`/`answer.txt` today, so a real occurrence there would currently just look like Act 2 or the Act 3 mountless read hitting an unexplained missing file.

If this needs to be more robust before it's fixed upstream, the pragmatic mitigation is calling `tdc fs drain-file-system --mount-path <path>` after every write and before `unmountAndKill()`, and retrying the write once if drain reports `commit_queue_conflicts > 0` — not implemented here since it adds real latency to every sandbox lifecycle for a failure this rare, and this project treats the smoke test as the actual detector.

## Related but separate issue

The previously-documented overwrite ESTALE bug (`docs/bug-fuse-overwrite-estale.md`, removed in this same change) — an out-of-band `SETATTR{size=0}` from `open(O_TRUNC)` colliding with a stale open-handle flush — was re-tested against this same tdc/drive9 build and **no longer reproduces**: overwriting an existing remote file through a fresh mount session, with no `rm -f` workaround, now correctly updates content and bumps the revision. Reading `mem9-ai/drive9@a53e497`'s `pkg/fuse/dat9fs.go`, the out-of-band truncate path (`applyRemoteTruncate`, `:2664`) now explicitly adopts an owning open handle instead of writing the remote directly — `adoptOpenHandlePathTruncate` (`:1747`) for newly-created/uncommitted files and `adoptSingleCallerPathTruncate` (`:1700`) for the single-writer overwrite case, with `stagePathTruncateToZeroLocked` (`:3010`) as a deferred-write fallback when adoption doesn't apply — which is architecturally exactly the fix that bug's doc suggested. `tidbcloud-fs-for-e2b/lib.ts`'s `writeFileViaMount()` no longer unlinks the target before writing.
