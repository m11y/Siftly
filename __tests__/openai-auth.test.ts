import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('fs') })

describe('resolveOpenAIClient with a custom base URL', () => {
  it('never uses Codex credentials, even when no key is configured', async () => {
    vi.doMock('fs', async (orig) => ({
      ...(await orig<typeof import('fs')>()),
      readFileSync: () => JSON.stringify({ OPENAI_API_KEY: 'codex-key' }),
    }))
    vi.stubEnv('OPENAI_API_KEY', '')
    const { resolveOpenAIClient } = await import('@/lib/openai-auth')
    expect(resolveOpenAIClient({}).apiKey).toBe('codex-key') // default endpoint: Codex auth allowed
    const client = resolveOpenAIClient({ baseURL: 'https://api.deepseek.com' })
    expect(client.apiKey).toBe('proxy') // falls through to the keyless proxy client
    expect(resolveOpenAIClient({ baseURL: 'https://api.deepseek.com', dbKey: 'db-key' }).apiKey).toBe('db-key')
  })
})
