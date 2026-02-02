/**
 * LLM Provider Abstraction Layer
 *
 * Claude と LM Studio を切り替え可能にする抽象化レイヤー。
 * 設定で provider を指定し、同じインターフェースで LLM を呼び出せる。
 */

import consola from "consola";
import { type RunClaudeOptions, runClaude } from "./claude-runner.js";

export type LLMProviderType = "claude" | "lmstudio";

export interface LLMProviderConfig {
  provider: LLMProviderType;
  lmstudio?: {
    url: string;
    model?: string;
    timeout?: number;
  };
  /** Claude のモデル指定 (haiku, sonnet, opus-4 など) */
  claudeModel?: string;
}

export interface GenerateOptions {
  /** Claude 使用時のモデル (haiku, sonnet, opus-4) */
  model?: string;
  /** システムプロンプト */
  systemPrompt?: string;
  /** システムプロンプトファイルを追加 */
  appendSystemPromptFile?: string;
  /** ツールを無効化 */
  disableTools?: boolean;
  /** 作業ディレクトリ */
  cwd?: string;
  /** LM Studio 用: 最大トークン数 */
  maxTokens?: number;
  /** LM Studio 用: Temperature */
  temperature?: number;
}

export interface LLMProvider {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  readonly name: string;
}

/**
 * Claude Provider - Claude CLI を使用
 */
class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const claudeOptions: RunClaudeOptions = {
      model: options?.model,
      systemPrompt: options?.systemPrompt,
      appendSystemPromptFile: options?.appendSystemPromptFile,
      disableTools: options?.disableTools,
      cwd: options?.cwd,
    };

    return runClaude(prompt, claudeOptions);
  }
}

/**
 * LM Studio Provider - OpenAI 互換 API を使用
 */
class LMStudioProvider implements LLMProvider {
  readonly name = "lmstudio";
  private url: string;
  private model: string;
  private timeout: number;

  constructor(config: { url: string; model?: string; timeout?: number }) {
    this.url = config.url;
    this.model = config.model || "";
    this.timeout = config.timeout || 300000;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const endpoint = `${this.url}/v1/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];

    // システムプロンプトがあれば追加
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    messages.push({ role: "user", content: prompt });

    const body = {
      model: this.model,
      messages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    };

    consola.info(`[lmstudio-provider] Calling LM Studio (model: ${this.model || "default"})...`);
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LM Studio API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content || "";
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      consola.success(`[lmstudio-provider] Done (${elapsed}s, ${content.length} chars)`);

      return content.trim();
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (error instanceof Error && error.name === "AbortError") {
        consola.error(`[lmstudio-provider] Timeout after ${elapsed}s`);
        throw new Error(`LM Studio request timed out after ${this.timeout}ms`);
      }
      consola.error(`[lmstudio-provider] Failed after ${elapsed}s:`, error);
      throw error;
    }
  }
}

/**
 * 設定に基づいて適切な LLM Provider を作成
 */
export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  if (config.provider === "lmstudio" && config.lmstudio) {
    return new LMStudioProvider(config.lmstudio);
  }
  return new ClaudeProvider();
}

/**
 * フォールバック付き LLM Provider
 * LM Studio が失敗した場合に Claude にフォールバック
 */
export function createLLMProviderWithFallback(config: LLMProviderConfig): LLMProvider {
  const primary = createLLMProvider(config);

  if (config.provider === "lmstudio") {
    const fallback = new ClaudeProvider();

    return {
      name: `${primary.name}->claude`,
      async generate(prompt: string, options?: GenerateOptions): Promise<string> {
        try {
          return await primary.generate(prompt, options);
        } catch (error) {
          consola.warn(
            `[llm-provider] ${primary.name} failed, falling back to Claude:`,
            error instanceof Error ? error.message : error,
          );
          // フォールバック時は Claude のモデルを使用
          return fallback.generate(prompt, { ...options, model: config.claudeModel });
        }
      },
    };
  }

  return primary;
}

// シングルトンインスタンス (後で設定から初期化)
let defaultProvider: LLMProvider | null = null;

export function setDefaultProvider(provider: LLMProvider): void {
  defaultProvider = provider;
}

export function getDefaultProvider(): LLMProvider {
  if (!defaultProvider) {
    // フォールバック: Claude を使用
    defaultProvider = new ClaudeProvider();
  }
  return defaultProvider;
}
