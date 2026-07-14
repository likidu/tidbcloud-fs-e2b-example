import {
  LLM_MODEL,
  MOUNT_PATH,
  REMOTE_PATH,
  createSandbox,
  ensureRemoteDir,
  hostTdc,
  llmClient,
  requireEnvs,
  run,
  unmountAndKill,
} from './lib'

requireEnvs([
  'E2B_API_KEY',
  'LLM_API_KEY',
  'TDC_REGION_CODE',
  'TDC_PUBLIC_KEY',
  'TDC_PRIVATE_KEY',
  'TDC_FS_RESOURCE_NAME',
  'TDC_FS_TENANT_ID',
  'TDC_FS_CLOUD_PROVIDER',
  'TDC_FS_REGION_CODE',
  'TDC_FS_API_KEY',
])

const llm = llmClient()

async function ask(label: string, prompt: string, maxTokens: number): Promise<string> {
  const r = await llm.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (r.choices[0]?.message?.content ?? '').trim()
  if (!text) throw new Error(`empty completion from ${LLM_MODEL} (${label})`)
  return text
}

ensureRemoteDir()

console.log('=== Act 1: Agent 1 writes a question to the shared filesystem ===')
const sbx1 = await createSandbox()
let question: string
try {
  question = await ask(
    'act-1 question',
    'Ask one interesting philosophical question. Just the question, nothing else.',
    1024
  )
  await sbx1.files.write(`${MOUNT_PATH}/question.txt`, question)
  console.log(`Agent 1 wrote: "${question}"`)
} finally {
  await unmountAndKill(sbx1)
}

console.log('\n=== Act 2: a brand-new sandbox mounts the same filesystem and answers ===')
const sbx2 = await createSandbox()
try {
  const question2 = (await run(sbx2, 'read-question', `cat ${MOUNT_PATH}/question.txt`)).trim()
  console.log(`Agent 2 read: "${question2}"`)
  const answer = await ask('act-2 answer', `Answer this question thoughtfully in 2-3 sentences: ${question2}`, 1024)
  await sbx2.files.write(`${MOUNT_PATH}/answer.txt`, answer)
  console.log(`Agent 2 wrote: "${answer}"`)
} finally {
  await unmountAndKill(sbx2)
}

console.log('\n=== Act 3: both sandboxes are dead — read everything with no mount at all ===')
hostTdc('ls', '--path', REMOTE_PATH)
hostTdc('cat', '--path', `${REMOTE_PATH}/answer.txt`)
const keyword = (question.match(/[A-Za-z]{5,}/g) ?? ['question'])[0]
hostTdc('grep', '--pattern', keyword, '--path', REMOTE_PATH)

console.log('\nThe filesystem outlived both sandboxes, and act 3 never mounted anything.')
