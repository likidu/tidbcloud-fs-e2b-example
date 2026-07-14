import 'dotenv/config'
import { Template, defaultBuildLogger } from 'e2b'
import { TEMPLATE_NAME } from './lib'
import { template } from './template'

const result = await Template.build(template, TEMPLATE_NAME, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
})

console.log(`built template '${TEMPLATE_NAME}': ${result.templateId}`)
