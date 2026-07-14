import { Template } from 'e2b'

const TDC_INSTALL_URL =
  process.env.TDC_INSTALL_URL ||
  'https://github.com/tidbcloud/tdc/releases/latest/download/install.sh'

export const template = Template()
  .fromImage('ubuntu:22.04')
  .aptInstall(['ca-certificates', 'curl', 'fuse3', 'procps', 'sudo'])
  .runCmd('id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user', { user: 'root' })
  .runCmd(
    'usermod -aG sudo user && printf "user ALL=(ALL) NOPASSWD:ALL\\n" >/etc/sudoers.d/99-e2b-user && chmod 0440 /etc/sudoers.d/99-e2b-user',
    { user: 'root' }
  )
  .runCmd('printf "user_allow_other\\n" >/etc/fuse.conf && chmod 0644 /etc/fuse.conf', { user: 'root' })
  .runCmd(
    `curl -fsSL '${TDC_INSTALL_URL}' -o /tmp/tdc-install.sh && bash /tmp/tdc-install.sh --version latest --install-dir /usr/local/bin --yes && rm -f /tmp/tdc-install.sh`,
    { user: 'root' }
  )
  .runCmd('tdc --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
