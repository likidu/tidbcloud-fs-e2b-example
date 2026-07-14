# Bug: overwriting an existing file through a tdc FUSE mount fails with ESTALE and truncates the file to 0 bytes

**Date found:** 2026-07-14
**Found by:** Liya Du, while live-testing the `tidbcloud-fs-for-e2b` sample
**tdc version:** v0.1.0-1-gb9f49cc (local build; linux/amd64 binary from the release tarball inside the sandbox)
**Severity: data loss.** The failed write does not just error — it destroys the file's existing remote content.

## Summary

Writing to a path that **already exists on the remote** through a FUSE mount (`cp local.txt <mount>/file.txt`, shell `>` redirection, or any `open(O_TRUNC)`-based overwrite) fails on `close()` with `ESTALE` ("Stale file handle"), and the remote file is left **truncated to 0 bytes**. The original content is gone and the new content was never uploaded.

Creating a **new** file through the mount works. Deleting and recreating (`rm` + `cp`) works. Only in-place overwrite of an existing remote file fails.

## Reproduction

Environment where it was hit: E2B sandbox (Ubuntu, fuse3), mount created and written by the same non-root user. But nothing here is E2B-specific — any fresh mount session over a filesystem that already contains the target file should do:

```bash
# session 1: create the file through a mount (works)
tdc fs mount-file-system --mount-path ./mnt --remote-path /demo --ready-timeout 60s
echo "v1" > ./mnt/file.txt
tdc fs unmount-file-system --mount-path ./mnt

# session 2: fresh mount, overwrite the now-existing file
tdc fs mount-file-system --mount-path ./mnt --remote-path /demo --ready-timeout 60s
echo "v2" > ./mnt/file.txt        # or: cp other.txt ./mnt/file.txt
```

Observed in session 2:

```
cp: failed to close './mnt/file.txt': Stale file handle   (exit 1)
```

and afterwards, from the data plane directly:

```
$ tdc fs describe-file --path /demo/file.txt
size_bytes: 0        # v1 content destroyed, v2 never written
```

First observed as: `tidbcloud-fs-for-e2b` demo passes on the first run, fails on the second run (the first run's `question.txt` still exists on the remote), leaving `question.txt` at 0 bytes.

## Symptom chain

1. `open(path, O_WRONLY|O_TRUNC)` on an existing remote file succeeds.
2. Writes succeed (buffered in the handle).
3. `close()` → FUSE `FLUSH` → upload is **rejected as a write conflict** → `ESTALE` to userspace.
4. The remote file is nevertheless already truncated to 0 bytes — so the conflict-protection path that was supposed to prevent lost updates *caused* one.

## Root-cause analysis (code walk, all refs `internal/fs/fuse_mount.go` at b9f49cc)

Two independent code paths write to the same remote file within one `cp` invocation, and the second one trips the first one's conflict check:

**Path A — the out-of-band truncate.** On Linux, plain FUSE `open(O_TRUNC)` is not atomic: unless the filesystem advertises `FUSE_ATOMIC_O_TRUNC`, the kernel strips `O_TRUNC` from the `OPEN` request and issues a separate `SETATTR{size=0}`. When that `SETATTR` reaches the **node-level** handler without a file handle, it takes the remote branch at `Setattr` (`fuse_mount.go:1151-1173`), which:

- stats the remote → gets the current version, call it **R1** (`:1151`)
- reads the full existing content, resizes to 0 (`:1161-1168`)
- **immediately writes the truncated content to the remote** via `n.runtime.writeFile(...)` (`:1170`) → the remote file is now 0 bytes at revision **R2**

This is the only code path that writes the remote outside a handle flush — and it is where the destructive truncation persists.

**Path B — the handle flush.** The open handle was created by `Open` (`:845-898`) *before* Path A ran, so it captured `stat.version = R1` (`:880`, stored via `newRemoteFuseFile(..., stat.version)` at `:897`). The handle knows nothing about Path A's write. On `close()`:

- `Flush` → `flushLocked` (`:1538`) → `runtime.writeFileWithDirty` → `upload()` (`:332`)
- `upload()` first calls `checkWriteBase` (`:384-399`): stats the remote → sees **R2**, compares with the handle's base **R1** → `fuseObjectVersion.conflictsWith` (`fuse_version.go:37-45`) → true
- returns `errFuseWriteConflict` (`:29`), mapped to `ESTALE` by `fuseErrno` (`:1723-1725`)

So the mount **conflicts with its own truncate**: Path A bumped the revision; Path B's stale base version makes the real upload abort; the remote is left at Path A's 0-byte state.

**Why create-new works:** a nonexistent target goes through `Create`, the kernel sends no separate truncating `SETATTR` for an already-empty new file, and there is no pre-existing revision to conflict with.

**Why unlink-then-create works:** same reason — it converts the overwrite into a create.

**Supporting detail:** the handle-level `Setattr` (`:1504-1528`) is purely local (resize buffer, mark dirty, `forceWholeUpload`) — correct behavior. The bug requires the `SETATTR` to arrive at the *node* level (`f == nil` in `Setattr` at `:1072-1076`). Whether the kernel sets `FATTR_FH` on the truncate-on-open `SETATTR` may vary by kernel/config; the observed E2B behavior (Ubuntu sandbox kernel) clearly hit the node path. A one-line debug log in both branches would confirm on any target kernel.

## Suggested fix directions (any one fixes the error; the last is required regardless)

1. **Advertise atomic truncate.** If go-fuse can negotiate `FUSE_ATOMIC_O_TRUNC`, the kernel keeps `O_TRUNC` inside `OPEN`, and the existing `Open` code already handles it correctly (`dirty := writable && O_TRUNC`, empty buffer, no read — `:889-897`). Path A never runs. This is the smallest structural fix.
2. **Route node-level size changes through open handles.** The runtime already keeps an open-handle registry used by rename/unlink retargeting (`registerOpenHandle` / `retarget`, `:1580+`). A node `SETATTR{size}` for a path with a live handle should update that handle's buffer/dirty state instead of writing the remote out-of-band.
3. **Make node-level truncate defer, not write.** Even with no open handle, `SETATTR{size}` could stage the resize as a pending write (write-back store) rather than an immediate remote `WriteFile`.
4. **Never destroy remote content on a failed flush (required regardless of 1-3).** The lost-update protection currently loses the update *and* the original. Whatever else changes, the invariant should be: a flush that fails leaves the remote at its pre-open content. Today that invariant is broken by Path A persisting the truncation independently of the flush's success.

A regression test should: create a file on the remote, open it through a *fresh* mount session with `O_TRUNC`, write new content, close, and assert (a) close succeeds and (b) remote content equals the new content; plus a failure-injection variant asserting the remote never ends at 0 bytes.

Related spec: `docs/spec/done/0011-ext01-fuse-cache-and-open-handle-correctness.md` (open-handle semantics this interacts with).

## Workaround in the sample

`tidbcloud-fs-for-e2b/lib.ts` → `writeFileViaMount()` unlinks the target before copying the staged file in (`rm -f path && cp tmp path`). Remove the `rm -f` once this is fixed.

## Related but separate issue

The same sample also surfaced a missing `allow_other` mount option (E2B's envd, running as a different user, cannot access the mount at all). Different code path (`gofuse.MountOptions`, `:59-62`), tracked separately.
