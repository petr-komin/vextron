import type { AiConfig } from '../../../shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  temperature?: number
  maxTokens?: number
  /** If true, request JSON mode (response_format: { type: "json_object" }) */
  jsonMode?: boolean
}

export interface AiProviderAdapter {
  /**
   * Send a chat completion request and return the assistant's response text.
   */
  chatCompletion(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>

  /**
   * Generate embeddings for an array of text inputs.
   * Returns an array of float vectors (one per input text).
   * @param texts Array of text strings to embed
   * @param model Embedding model to use (overrides default chat model)
   */
  embed(texts: string[], model: string): Promise<number[][]>
}

// ─── OpenAI-compatible adapter ───────────────────────────────────────────────
// Works for Together.ai, OpenAI, and any provider with a /v1/chat/completions endpoint.

class OpenAiCompatibleAdapter implements AiProviderAdapter {
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor(config: AiConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.together.xyz/v1').replace(/\/+$/, '')
    this.apiKey = config.apiKey || ''
    this.model = config.model
  }

  async chatCompletion(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1024
    }

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`AI provider error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
    }

    if (!data.choices?.[0]?.message?.content) {
      throw new Error('AI provider returned empty response')
    }

    return data.choices[0].message.content
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`

    const body = {
      model,
      input: texts
    }

    // Retry once on transient errors (502, 503, 429)
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        console.log(`[AI] Embedding retry attempt ${attempt + 1}...`)
        await new Promise((r) => setTimeout(r, 2000)) // wait 2s before retry
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const status = response.status
        const errorText = await response.text().catch(() => 'unknown error')

        // Parse the error message from JSON if possible
        let errorMessage = errorText
        try {
          const parsed = JSON.parse(errorText)
          if (parsed.error?.message) errorMessage = parsed.error.message
        } catch { /* use raw text */ }

        // Retry on transient errors
        if (status === 502 || status === 503 || status === 429) {
          lastError = new Error(`Embedding service temporarily unavailable (${status}: ${errorMessage}). Retrying...`)
          continue
        }

        throw new Error(`AI embedding error (${status}): ${errorMessage}`)
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>
      }

      if (!data.data?.length) {
        throw new Error('AI provider returned empty embedding response')
      }

      // Sort by index to match input order, then extract embeddings
      return data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding)
    }

    // Both attempts failed
    throw lastError ?? new Error('Embedding request failed after retries')
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an AI provider adapter from config.
 * Together.ai, OpenAI, and any OpenAI-compatible API all use the same adapter —
 * just with different baseUrl values.
 */
export function createProvider(config: AiConfig): AiProviderAdapter {
  switch (config.provider) {
    case 'together':
    case 'openai':
      return new OpenAiCompatibleAdapter(config)
    case 'anthropic':
      // Future: Anthropic uses a different API format
      throw new Error('Anthropic provider is not yet implemented')
    case 'ollama':
      // Ollama is OpenAI-compatible at /v1/chat/completions
      return new OpenAiCompatibleAdapter({
        ...config,
        baseUrl: config.baseUrl || 'http://localhost:11434/v1'
      })
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`)
  }
}
