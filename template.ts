import { Template } from 'e2b'

// v0.1.7 is the last release that installs the `tdc` binary — the repo's
// "latest" tag now ships the renamed `ti` CLI, which this code can't speak
// yet (the ti-migration PRs handle that).
const TDC_INSTALL_VERSION = process.env.TDC_INSTALL_VERSION || 'v0.1.7'
const TDC_INSTALL_URL =
  process.env.TDC_INSTALL_URL ||
  `https://github.com/tidbcloud/tdc/releases/download/${TDC_INSTALL_VERSION}/install.sh`

// E2B's base image already provides the `user` account, passwordless sudo,
// and curl — same starting point as the Archil/E2B storage integration.
export const template = Template()
  .fromBaseImage()
  .aptInstall(['fuse3'])
  .runCmd('printf "user_allow_other\\n" >>/etc/fuse.conf', { user: 'root' })
  .runCmd(
    `curl -fsSL '${TDC_INSTALL_URL}' -o /tmp/tdc-install.sh && bash /tmp/tdc-install.sh --version ${TDC_INSTALL_VERSION} --install-dir /usr/local/bin --yes && rm -f /tmp/tdc-install.sh`,
    { user: 'root' }
  )
  .runCmd('tdc --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
