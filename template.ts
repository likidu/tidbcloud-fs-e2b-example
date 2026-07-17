import { Template } from 'e2b'

const TDC_INSTALL_URL =
  process.env.TDC_INSTALL_URL ||
  'https://github.com/tidbcloud/tdc/releases/latest/download/install.sh'

// E2B's base image already provides the `user` account, passwordless sudo,
// and curl — same starting point as the Archil/E2B storage integration.
export const template = Template()
  .fromBaseImage()
  .aptInstall(['fuse3'])
  .runCmd('printf "user_allow_other\\n" >>/etc/fuse.conf', { user: 'root' })
  .runCmd(
    `curl -fsSL '${TDC_INSTALL_URL}' -o /tmp/tdc-install.sh && bash /tmp/tdc-install.sh --version latest --install-dir /usr/local/bin --yes && rm -f /tmp/tdc-install.sh`,
    { user: 'root' }
  )
  .runCmd('tdc --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
