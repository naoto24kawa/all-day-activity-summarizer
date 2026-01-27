import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { setupWhisper } from "../whisper/setup.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Setup whisper.cpp (clone, build, download model)")
    .action(async () => {
      consola.info("Starting setup...");
      const config = loadConfig();
      await setupWhisper(config);
      consola.success("Setup complete! You can now use 'adas record' and 'adas transcribe'.");
    });
}
