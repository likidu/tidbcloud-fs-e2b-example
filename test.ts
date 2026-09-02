import {
  MOUNT_PATH,
  REMOTE_PATH,
  createSandbox,
  ensureRemoteDir,
  hostTi,
  requireEnvs,
  run,
  unmountAndKill,
  writeFileViaMount,
} from './lib'

requireEnvs(['E2B_API_KEY', 'TI_REGION_CODE', 'TI_FS_TOKEN'])

const stamp = `ti fs smoke ${Date.now()}`

console.log('smoke: sandbox mount, write, read-back')
ensureRemoteDir()

// ensureRemoteDir swallows non-ENOENT failures (e.g. auth) — validate the
// token/region/data-plane from the host first so a dead token fails loudly
// here instead of as an opaque sandbox mount error.
console.log('smoke: host-side ti fs auth check (token, region, data plane)')
hostTi('ls', '--path', REMOTE_PATH)
const sbx = await createSandbox()
try {
  await writeFileViaMount(sbx, `${MOUNT_PATH}/smoke.txt`, stamp)
  const back = (await run(sbx, 'read-back', `cat ${MOUNT_PATH}/smoke.txt`)).trim()
  if (back !== stamp) {
    throw new Error(`read-back mismatch: wrote ${JSON.stringify(stamp)}, got ${JSON.stringify(back)}`)
  }
} finally {
  await unmountAndKill(sbx)
}

console.log('smoke: mountless read from host after sandbox death')
const remote = hostTi('cat', '--path', `${REMOTE_PATH}/smoke.txt`).trim()
if (remote !== stamp) {
  throw new Error(`mountless read mismatch: wrote ${JSON.stringify(stamp)}, got ${JSON.stringify(remote)}`)
}
hostTi('rm', '--path', `${REMOTE_PATH}/smoke.txt`)

console.log('SMOKE TEST PASSED')
