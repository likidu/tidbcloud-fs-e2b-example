import type OpenAI from 'openai'
import pc from 'picocolors'
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
  writeFileViaMount,
} from './lib'

requireEnvs(['E2B_API_KEY', 'LLM_API_KEY', 'TI_REGION_CODE', 'TI_FS_FILE_SYSTEM_NAME', 'TI_FS_TOKEN'])

const llm = llmClient()

async function ask(label: string, prompt: string, maxTokens: number): Promise<string> {
  const r = await llm.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    // GLM-5.2 defaults to extended thinking, which burns the whole max_tokens
    // budget on hidden reasoning_content and returns an empty visible answer.
    thinking: { type: 'disabled' },
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  const text = (r.choices[0]?.message?.content ?? '').trim()
  if (!text) throw new Error(`empty completion from ${LLM_MODEL} (${label})`)
  return text
}

ensureRemoteDir()

console.log(pc.bold('=== Act 1: Agent 1 writes a question to the shared filesystem ==='))
const sbx1 = await createSandbox()
let question: string
try {
  question = await ask(
    'act-1 question',
    'Ask one interesting philosophical question. Just the question, nothing else.',
    1024
  )
  await writeFileViaMount(sbx1, `${MOUNT_PATH}/question.txt`, question)
  console.log(pc.bold(pc.green(`Agent 1 wrote: "${question}"`)))
} finally {
  await unmountAndKill(sbx1)
}

console.log(pc.bold('\n=== Act 2: a brand-new sandbox mounts the same filesystem and answers ==='))
const sbx2 = await createSandbox()
try {
  const question2 = (await run(sbx2, 'read-question', `cat ${MOUNT_PATH}/question.txt`)).trim()
  console.log(pc.bold(pc.green(`Agent 2 read: "${question2}"`)))
  const answer = await ask('act-2 answer', `Answer this question thoughtfully in 2-3 sentences: ${question2}`, 1024)
  await writeFileViaMount(sbx2, `${MOUNT_PATH}/answer.txt`, answer)
  console.log(pc.bold(pc.green(`Agent 2 wrote: "${answer}"`)))
} finally {
  await unmountAndKill(sbx2)
}

console.log(pc.bold('\n=== Act 3: both sandboxes are dead — read everything with no mount at all ==='))
hostTdc('ls', '--path', REMOTE_PATH)
hostTdc('cat', '--path', `${REMOTE_PATH}/answer.txt`)
const keyword = (question.match(/[A-Za-z]{5,}/g) ?? ['question'])[0]
hostTdc('grep', '--pattern', keyword, '--path', REMOTE_PATH)

console.log('\nThe filesystem outlived both sandboxes, and act 3 never mounted anything.')
