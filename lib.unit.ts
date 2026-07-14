import assert from 'node:assert/strict'
import { renderTdcProfile, requireEnvs } from './lib'

const env = {
  TDC_REGION_CODE: 'aws-us-east-1',
  TDC_PUBLIC_KEY: 'pub"lic',
  TDC_PRIVATE_KEY: 'priv\\ate',
  TDC_FS_RESOURCE_NAME: 'workspace',
  TDC_FS_TENANT_ID: 't-123',
  TDC_FS_CLOUD_PROVIDER: 'aws',
  TDC_FS_REGION_CODE: 'aws-us-east-1',
  TDC_FS_API_KEY: 'fsk_abc',
}

const { config, credentials } = renderTdcProfile(env)

assert.equal(
  config,
  `[default]
region_code = "aws-us-east-1"
fs_resource_name = "workspace"
fs_tenant_id = "t-123"
fs_cloud_provider = "aws"
fs_region_code = "aws-us-east-1"
`
)
// JSON string escaping is valid TOML basic-string escaping — quotes and
// backslashes in secrets must survive round-tripping.
assert.equal(
  credentials,
  `[default]
tdc_public_key = "pub\\"lic"
tdc_private_key = "priv\\\\ate"
fs_api_key = "fsk_abc"
`
)

assert.throws(() => requireEnvs(['NOPE_A', 'NOPE_B']), /NOPE_A.*NOPE_B|NOPE_A, NOPE_B/)
requireEnvs(['PATH']) // present everywhere; must not throw

console.log('lib.unit.ts: all assertions passed')
