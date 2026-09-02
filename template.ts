import { Template } from 'e2b'

// Pin the template to a tested release. A floating /latest URL can leave an
// older binary in E2B's cached build layer after a new release is published.
const TI_VERSION = 'v0.2.3'
const TI_INSTALL_URL =
  process.env.TI_INSTALL_URL ||
  `https://github.com/tidbcloud/ti-cli/releases/download/${TI_VERSION}/install.sh`

// E2B's base image already provides the `user` account, passwordless sudo,
// and curl — same starting point as the Archil/E2B storage integration.
export const template = Template()
  .fromBaseImage()
  .aptInstall(['fuse3'])
  .runCmd('printf "user_allow_other\\n" >>/etc/fuse.conf', { user: 'root' })
  .runCmd(
    `curl -fsSL '${TI_INSTALL_URL}' -o /tmp/ti-install.sh && bash /tmp/ti-install.sh --version ${TI_VERSION} --install-dir /usr/local/bin --yes && rm -f /tmp/ti-install.sh`,
    { user: 'root' }
  )
  .runCmd('ti --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
