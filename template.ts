import { Template } from 'e2b'
import type { TemplateBuilder } from 'e2b'

const TDC_INSTALL_URL =
  process.env.TDC_INSTALL_URL ||
  'https://github.com/tidbcloud/tdc/releases/latest/download/install.sh'

// Pre-release testing: set TDC_TARBALL_PATH to a local linux_amd64 release
// tarball (containing the `tdc` binary at its root) to bake it into the
// image instead of downloading from GitHub Releases.
const TDC_TARBALL_PATH = process.env.TDC_TARBALL_PATH

const base = Template()
  .fromImage('ubuntu:22.04')
  .aptInstall(['ca-certificates', 'curl', 'fuse3', 'procps', 'sudo'])
  .runCmd('id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user', { user: 'root' })
  .runCmd(
    'usermod -aG sudo user && printf "user ALL=(ALL) NOPASSWD:ALL\\n" >/etc/sudoers.d/99-e2b-user && chmod 0440 /etc/sudoers.d/99-e2b-user',
    { user: 'root' }
  )
  .runCmd('printf "user_allow_other\\n" >/etc/fuse.conf && chmod 0644 /etc/fuse.conf', { user: 'root' })

const withTdc: TemplateBuilder = TDC_TARBALL_PATH
  ? base
      .copy(TDC_TARBALL_PATH, '/tmp/tdc.tar.gz')
      .runCmd(
        'tar -xzf /tmp/tdc.tar.gz -C /usr/local/bin tdc && chmod 0755 /usr/local/bin/tdc && rm -f /tmp/tdc.tar.gz',
        { user: 'root' }
      )
  : base.runCmd(
      `curl -fsSL '${TDC_INSTALL_URL}' -o /tmp/tdc-install.sh && bash /tmp/tdc-install.sh --version latest --install-dir /usr/local/bin --yes && rm -f /tmp/tdc-install.sh`,
      { user: 'root' }
    )

export const template = withTdc
  .runCmd('tdc --version', { user: 'root' })
  .runCmd('fusermount3 --version', { user: 'root' })
  .runCmd('mkdir -p /home/user/workspace && chown -R user:user /home/user/workspace', { user: 'root' })
  .setUser('user')
  .setWorkdir('/home/user')
