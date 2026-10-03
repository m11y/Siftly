import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { resolveAnthropicClient } from './claude-cli-auth'
import { resolveOpenAIClient } from './openai-auth'
import { resolveMiniMaxClient } from './minimax-auth'
import { getProvider } from './settings'

/**
 * Output cap for every pipeline/search call. Reasoning models (e.g. DeepSeek,
 * thinking on by default) spend output tokens on thinking first, so the old
 * 700–4096 caps truncated the JSON answers. The Anthropic SDK rejects
 * non-streaming requests above ~21,333 tokens, so stay well under that.
 */
export const MAX_OUTPUT_TOKENS = 16384

/**
 * REASONING_EFFORT (e.g. low / high / max) is passed through as each protocol's
 * effort field; unset sends nothing and keeps the provider default. Values are
 * provider-defined (DeepSeek maps medium → high), so they are not validated here.
 */
function reasoningEffort(): string | undefined {
  return process.env.REASONING_EFFORT?.trim() || undefined
}

export interface AIContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string | AIContentBlock[]
}

export interface AIResponse {
  text: string
}

export interface AIClient {
  provider: 'anthropic' | 'openai' | 'minimax'
  createMessage(params: {
    model: string
    max_tokens: number
    messages: AIMessage[]
  }): Promise<AIResponse>
}

// Wrap Anthropic SDK
export class AnthropicAIClient implements AIClient {
  provider = 'anthropic' as const
  constructor(private sdk: Anthropic) {}

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const messages = params.messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content }
      }
      const blocks = m.content.map(b => {
        if (b.type === 'image' && b.source) {
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: b.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: b.source.data,
            },
          }
        }
        return { type: 'text' as const, text: b.text ?? '' }
      })
      return { role: m.role as 'user' | 'assistant', content: blocks }
    })

    const effort = reasoningEffort()
    const msg = await this.sdk.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
      ...(effort ? { output_config: { effort: effort as 'low' | 'medium' | 'high' | 'max' } } : {}),
    })

    const textBlock = msg.content.find(b => b.type === 'text')
    return { text: textBlock && 'text' in textBlock ? textBlock.text : '' }
  }
}

// Wrap OpenAI SDK — Responses API, which both OpenAI and OpenAI-compatible
// endpoints such as DeepSeek (OPENAI_BASE_URL) implement.
export class OpenAIAIClient implements AIClient {
  provider = 'openai' as const
  constructor(private sdk: OpenAI) {}

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const input: OpenAI.Responses.ResponseInputItem[] = params.messages.map((m): OpenAI.Responses.ResponseInputItem => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content }
      const parts: OpenAI.Responses.ResponseInputContent[] = m.content.map((b): OpenAI.Responses.ResponseInputContent => {
        if (b.type === 'image' && b.source) {
          return { type: 'input_image', detail: 'auto', image_url: `data:${b.source.media_type};base64,${b.source.data}` }
        }
        return { type: 'input_text', text: b.text ?? '' }
      })
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: parts } as OpenAI.Responses.ResponseInputItem
    })

    const effort = reasoningEffort()
    const response = await this.sdk.responses.create({
      model: params.model,
      max_output_tokens: params.max_tokens,
      input,
      ...(effort ? { reasoning: { effort: effort as OpenAI.ReasoningEffort } } : {}),
    })

    if (response.status === 'incomplete') {
      console.warn(`[ai] response incomplete: ${response.incomplete_details?.reason ?? 'unknown'} (model=${params.model})`)
    }
    return { text: response.output_text ?? '' }
  }
}

// Wrap MiniMax via OpenAI-compatible SDK (temperature clamped to (0, 1])
export class MiniMaxAIClient implements AIClient {
  provider = 'minimax' as const
  constructor(private sdk: OpenAI) {}

  async createMessage(params: { model: string; max_tokens: number; messages: AIMessage[] }): Promise<AIResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map((m): OpenAI.ChatCompletionMessageParam => {
      if (typeof m.content === 'string') {
        if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content }
        return { role: 'user' as const, content: m.content }
      }
      const parts: OpenAI.ChatCompletionContentPart[] = m.content.map(b => {
        if (b.type === 'image' && b.source) {
          return {
            type: 'image_url' as const,
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          }
        }
        return { type: 'text' as const, text: b.text ?? '' }
      })
      if (m.role === 'assistant') return { role: 'assistant' as const, content: parts.filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === 'text') }
      return { role: 'user' as const, content: parts }
    })

    const completion = await this.sdk.chat.completions.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
    })

    let text = completion.choices[0]?.message?.content ?? ''
    // Strip thinking tags that MiniMax M2.5+ may include
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    return { text }
  }
}

export async function resolveAIClient(options: {
  overrideKey?: string
  dbKey?: string
} = {}): Promise<AIClient> {
  const provider = await getProvider()

  if (provider === 'minimax') {
    const client = resolveMiniMaxClient(options)
    return new MiniMaxAIClient(client)
  }

  if (provider === 'openai') {
    const client = resolveOpenAIClient(options)
    return new OpenAIAIClient(client)
  }

  const client = resolveAnthropicClient(options)
  return new AnthropicAIClient(client)
}
