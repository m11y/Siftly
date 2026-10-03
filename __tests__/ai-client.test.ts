import { describe, it, expect, afterEach } from 'vitest'
import { AnthropicAIClient, OpenAIAIClient, MAX_OUTPUT_TOKENS } from '@/lib/ai-client'

const imageMessage = [{
  role: 'user' as const,
  content: [
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'AAAA' } },
    { type: 'text' as const, text: 'describe' },
  ],
}]

function fakeOpenAI(response: Record<string, unknown> = { status: 'completed', output_text: '{"ok":1}' }) {
  const calls: Record<string, unknown>[] = []
  return { calls, sdk: { responses: { create: async (p: Record<string, unknown>) => { calls.push(p); return response } } } }
}

function fakeAnthropic() {
  const calls: Record<string, unknown>[] = []
  return { calls, sdk: { messages: { create: async (p: Record<string, unknown>) => { calls.push(p); return { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'done' }] } } } } }
}

afterEach(() => { delete process.env.REASONING_EFFORT })

describe('OpenAIAIClient (Responses API)', () => {
  it('sends images as input_image data URLs and returns output_text', async () => {
    const { calls, sdk } = fakeOpenAI()
    const res = await new OpenAIAIClient(sdk as never).createMessage({ model: 'deepseek-flash', max_tokens: MAX_OUTPUT_TOKENS, messages: imageMessage })
    expect(res.text).toBe('{"ok":1}')
    expect(calls[0]).toMatchObject({
      model: 'deepseek-flash',
      max_output_tokens: 16384,
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        { type: 'input_text', text: 'describe' },
      ] }],
    })
    expect(calls[0]).not.toHaveProperty('reasoning')
  })

  it('passes REASONING_EFFORT as reasoning.effort', async () => {
    process.env.REASONING_EFFORT = 'low'
    const { calls, sdk } = fakeOpenAI()
    await new OpenAIAIClient(sdk as never).createMessage({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    expect(calls[0]).toMatchObject({ reasoning: { effort: 'low' }, input: [{ role: 'user', content: 'hi' }] })
  })
})

describe('AnthropicAIClient', () => {
  it('passes REASONING_EFFORT as output_config.effort and skips thinking blocks', async () => {
    process.env.REASONING_EFFORT = 'low'
    const { calls, sdk } = fakeAnthropic()
    const res = await new AnthropicAIClient(sdk as never).createMessage({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    expect(res.text).toBe('done')
    expect(calls[0]).toMatchObject({ output_config: { effort: 'low' } })
  })

  it('sends no effort when REASONING_EFFORT is unset', async () => {
    const { calls, sdk } = fakeAnthropic()
    await new AnthropicAIClient(sdk as never).createMessage({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    expect(calls[0]).not.toHaveProperty('output_config')
  })
})
