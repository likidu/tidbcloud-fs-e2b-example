import 'dotenv/config'
import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

const alias = process.env.E2B_TEMPLATE_NAME || 'tidbcloud-fs-workspace-dev'

const result = await Template.build(template, {
  alias,
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
})

console.log(`built template '${alias}': ${result.templateId}`)
