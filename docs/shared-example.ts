import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { Sandbox } from 'e2b'

// Two sandboxes mount the same archil disk.
// Agent 1 writes a question; Agent 2 spins up in a fresh sandbox, reads it, and writes an answer.

const client = new Anthropic()
const MOUNT_PATH = '/home/user/archil'

async function createSandbox() {
  const sbx = await Sandbox.create(process.env.E2B_TEMPLATE_ID!)
  await sbx.commands.run(`sudo mkdir -p ${MOUNT_PATH}`)
  await sbx.commands.run(
    `sudo ARCHIL_MOUNT_TOKEN=${process.env.ARCHIL_MOUNT_TOKEN} archil mount ${process.env.ARCHIL_DISK} ${MOUNT_PATH} --region ${process.env.ARCHIL_REGION}`
  )
  await sbx.commands.run(`sudo chown user:user ${MOUNT_PATH}`)
  return sbx
}

async function writeFile(sbx: Sandbox, path: string, content: string) {
  const b64 = Buffer.from(content).toString('base64')
  await sbx.commands.run(`echo ${b64} | base64 -d | sudo tee ${path} > /dev/null`)
}

async function readFile(sbx: Sandbox, path: string) {
  const { stdout } = await sbx.commands.run(`cat ${path}`)
  return stdout.trim()
}

// Agent 1: generate a question and write it to the shared disk
console.log('Starting Agent 1...')
const sbx1 = await createSandbox()
console.log(`Agent 1: sandbox ${sbx1.sandboxId}`)

const q = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Ask one interesting philosophical question. Just the question, nothing else.' }],
})
const question = (q.content[0] as Anthropic.TextBlock).text.trim()
await writeFile(sbx1, `${MOUNT_PATH}/question.txt`, question)
console.log(`Agent 1 wrote: "${question}"`)
await sbx1.commands.run(`sudo archil unmount ${MOUNT_PATH}`)
await sbx1.kill()

// Agent 2: fresh sandbox, same disk — reads the question and writes an answer
console.log('\nStarting Agent 2...')
const sbx2 = await createSandbox()
console.log(`Agent 2: sandbox ${sbx2.sandboxId}`)

const question2 = await readFile(sbx2, `${MOUNT_PATH}/question.txt`)
console.log(`Agent 2 read: "${question2}"`)

const a = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 512,
  messages: [{ role: 'user', content: `Answer this question thoughtfully in 2-3 sentences: ${question2}` }],
})
const answer = (a.content[0] as Anthropic.TextBlock).text.trim()
await writeFile(sbx2, `${MOUNT_PATH}/answer.txt`, answer)
console.log(`Agent 2 wrote: "${answer}"`)
await sbx2.commands.run(`sudo archil unmount ${MOUNT_PATH}`)
await sbx2.kill()
