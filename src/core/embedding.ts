/**
 * Embedding Providers — decoupled from vector storage.
 *
 * Providers:
 *   - OpenAIEmbeddingProvider  (text-embedding-3-small/large)
 *   - LocalEmbeddingProvider   (pi-session-manager local service)
 *   - MiniLMEmbeddingProvider  (ONNX all-MiniLM-L6-v2, direct or daemon)
 *
 * Zero Pi SDK dependency. Pure fetch + config.
 */

import { log } from "./logger.ts";
import { config } from "./config.ts";
import type { ApiKeyResolver, EmbeddingProvider } from "./types.ts";

// Re-export for convenience
export type { EmbeddingProvider };

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
    this.dim = model.includes("large") ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 8000),
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      throw new Error(`OpenAI embedding failed (${response.status}): ${err}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }
}

// ============================================================================
// Local Embedding Provider (pi-session-manager)
// ============================================================================

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 768;
  readonly model = "embeddinggemma-300m-qat-q8_0";
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 8000), normalize: true }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.text().catch(() => "unknown");
        throw new Error(`Local embedding failed (${response.status}): ${err}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: { embedding: number[]; dimensions: number };
        error?: string;
      };

      if (!data.success || !data.data?.embedding) {
        throw new Error(data.error || "No embedding returned");
      }

      return data.data.embedding;
    } catch (err) {
      clearTimeout(timeoutId);
      if ((err as Error).name === "AbortError") {
        throw new Error(`Local embedding timeout after ${this.timeoutMs}ms`);
      }
      throw err;
    }
  }
}

// ============================================================================
// MiniLM Embedding Provider (ONNX, lazy-loaded)
// ============================================================================

export class MiniLMEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 384;
  readonly model = "all-MiniLM-L6-v2";
  private provider: any = null;

  async init(): Promise<void> {
    if (this.provider) return;
    try {
      const { createMiniLMProvider } = await import("./embedding-minilm.ts");
      this.provider = await createMiniLMProvider({
        modelPath: config.vectorMemory?.minilm?.modelPath,
        maxSeqLength: config.vectorMemory?.minilm?.maxSeqLength ?? 512,
        batchSize: config.vectorMemory?.minilm?.batchSize ?? 1,
        useGPU: config.vectorMemory?.minilm?.useGPU ?? false,
      });
    } catch (err) {
      throw new Error(`MiniLM init failed: ${err}`);
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.provider) await this.init();
    return this.provider.embed(text);
  }
}

// ============================================================================
// Factory: create embedding provider from config
// ============================================================================

export async function createEmbeddingProvider(
  apiKeyResolver?: ApiKeyResolver,
): Promise<EmbeddingProvider | null> {
  const providerType = config.vectorMemory?.provider || "local";

  switch (providerType) {
    case "openai": {
      const apiKey = await resolveApiKey(apiKeyResolver);
      if (!apiKey) {
        log("embedding", "no OpenAI API key, embedding disabled");
        return null;
      }
      return new OpenAIEmbeddingProvider(apiKey, config.vectorMemory?.model);
    }

    case "local": {
      const baseUrl = config.vectorMemory?.baseUrl || "http://127.0.0.1:52131";
      return new LocalEmbeddingProvider(baseUrl);
    }

    case "minilm-direct": {
      const provider = new MiniLMEmbeddingProvider();
      await provider.init();
      return provider;
    }

    case "minilm-daemon": {
      // Daemon mode uses the same MiniLM provider but connects to shared process
      const provider = new MiniLMEmbeddingProvider();
      await provider.init();
      return provider;
    }

    default:
      log("embedding", `unknown provider: ${providerType}`);
      return null;
  }
}

// ============================================================================
// API Key Resolution
// ============================================================================

async function resolveApiKey(apiKeyResolver?: ApiKeyResolver): Promise<string | null> {
  // 1. Explicit config
  const cfgKey = config.vectorMemory?.apiKey;
  if (cfgKey) return cfgKey;

  // 2. Via injected resolver
  if (apiKeyResolver) {
    try {
      const key = await apiKeyResolver.resolve("openai");
      if (key) return key;
    } catch {}
  }

  // 3. Environment variable
  return process.env.OPENAI_API_KEY || null;
}
