import { createDatabase } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { improvePrompt } from "../prompts/improver.js";

const VALID_TARGETS: PromptTarget[] = [
  "interpret",
  "evaluate",
  "summarize-hourly",
  "summarize-daily",
];

export function registerImprovePromptCommand(program: Command): void {
  program
    .command("improve-prompt")
    .description("Improve a system prompt based on accumulated feedback")
    .argument("<target>", `Target prompt: ${VALID_TARGETS.join(" | ")}`)
    .option("--dry-run", "Show improved prompt without writing to file")
    .action(async (target: string, options: { dryRun?: boolean }) => {
      if (!VALID_TARGETS.includes(target as PromptTarget)) {
        consola.error(`Invalid target: "${target}". Must be one of: ${VALID_TARGETS.join(", ")}`);
        process.exit(1);
      }

      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      await improvePrompt(target as PromptTarget, db, {
        dryRun: options.dryRun,
      });
    });
}
