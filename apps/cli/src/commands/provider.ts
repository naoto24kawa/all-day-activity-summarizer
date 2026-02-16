import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { select } from "@inquirer/prompts";
import type { Command } from "commander";
import consola from "consola";

type ProcessType =
  | "summarize"
  | "suggestTags"
  | "evaluate"
  | "interpret"
  | "checkCompletion"
  | "analyzeProfile"
  | "extractLearnings"
  | "taskExtract"
  | "slackPriority"
  | "generateReadings";

type ProviderType = "claude" | "gemini" | "lmstudio";

const PROCESS_TYPE_LABELS: Record<ProcessType, string> = {
  summarize: "要約 (Summarize)",
  suggestTags: "タグ提案 (Suggest Tags)",
  evaluate: "評価 (Evaluate)",
  interpret: "解釈 (Interpret)",
  checkCompletion: "完了検知 (Check Completion)",
  analyzeProfile: "プロフィール分析 (Analyze Profile)",
  extractLearnings: "学び抽出 (Extract Learnings)",
  taskExtract: "タスク抽出 (Task Extract)",
  slackPriority: "Slack 優先度 (Slack Priority)",
  generateReadings: "読み仮名生成 (Generate Readings)",
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
  gemini: "Gemini (高速・低コスト)",
  claude: "Claude (高品質)",
  lmstudio: "LM Studio (ローカル)",
};

interface AdasConfig {
  aiProvider?: {
    providers?: Partial<Record<ProcessType, ProviderType>>;
    gemini?: {
      model?: string;
    };
    enableFallback?: boolean;
  };
}

function getConfigPath(): string {
  return join(homedir(), ".adas", "config.json");
}

function loadConfig(): AdasConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as AdasConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: AdasConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

async function showCurrentConfig(): Promise<void> {
  const config = loadConfig();
  const providers = config.aiProvider?.providers ?? {};

  consola.box("現在の AI プロバイダー設定\n");

  for (const [processType, label] of Object.entries(PROCESS_TYPE_LABELS)) {
    const provider = providers[processType as ProcessType] ?? "gemini";
    const providerLabel = PROVIDER_LABELS[provider as ProviderType] ?? provider;
    consola.info(`${label}: ${providerLabel}`);
  }

  consola.info(
    `\nフォールバック: ${config.aiProvider?.enableFallback !== false ? "有効" : "無効"}`,
  );
}

async function interactiveSetup(): Promise<void> {
  const config = loadConfig();

  // 処理タイプを選択
  const processType = await select<ProcessType>({
    message: "設定する処理を選択してください:",
    choices: Object.entries(PROCESS_TYPE_LABELS).map(([value, name]) => ({
      value: value as ProcessType,
      name,
    })),
  });

  // 現在の設定を取得
  const currentProvider = config.aiProvider?.providers?.[processType] ?? "gemini";

  // プロバイダーを選択
  const provider = await select<ProviderType>({
    message: `${PROCESS_TYPE_LABELS[processType]} で使用するプロバイダーを選択してください:`,
    choices: Object.entries(PROVIDER_LABELS).map(([value, name]) => ({
      value: value as ProviderType,
      name: value === currentProvider ? `${name} (現在の設定)` : name,
    })),
  });

  // 設定を更新
  const newConfig: AdasConfig = {
    ...config,
    aiProvider: {
      ...config.aiProvider,
      providers: {
        ...config.aiProvider?.providers,
        [processType]: provider,
      },
    },
  };

  saveConfig(newConfig);
  consola.success(
    `${PROCESS_TYPE_LABELS[processType]} のプロバイダーを ${PROVIDER_LABELS[provider]} に設定しました`,
  );
}

async function setAllProviders(provider: ProviderType): Promise<void> {
  const config = loadConfig();

  const newProviders: Partial<Record<ProcessType, ProviderType>> = {};
  for (const processType of Object.keys(PROCESS_TYPE_LABELS) as ProcessType[]) {
    newProviders[processType] = provider;
  }

  const newConfig: AdasConfig = {
    ...config,
    aiProvider: {
      ...config.aiProvider,
      providers: newProviders,
    },
  };

  saveConfig(newConfig);
  consola.success(`全ての処理を ${PROVIDER_LABELS[provider]} に設定しました`);
}

export function registerProviderCommand(program: Command): void {
  const providerCmd = program.command("provider").description("AI プロバイダー設定の管理");

  providerCmd
    .command("show")
    .description("現在の設定を表示")
    .action(async () => {
      await showCurrentConfig();
    });

  providerCmd
    .command("setup")
    .description("インタラクティブに設定を変更")
    .action(async () => {
      await interactiveSetup();
    });

  providerCmd
    .command("set-all <provider>")
    .description("全ての処理を指定したプロバイダーに設定")
    .action(async (provider: string) => {
      if (!["claude", "gemini", "lmstudio"].includes(provider)) {
        consola.error("プロバイダーは claude, gemini, lmstudio のいずれかを指定してください");
        process.exit(1);
      }
      await setAllProviders(provider as ProviderType);
    });
}
