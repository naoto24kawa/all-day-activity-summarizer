import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { setupWhisper, setupWhisperX } from "../whisper/setup.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Setup transcription engines (whisperX + whisper.cpp fallback)")
    .action(async () => {
      consola.info("Starting setup...");
      const config = loadConfig();

      // Setup whisperX (primary engine)
      try {
        await setupWhisperX();
      } catch (err) {
        consola.warn("whisperX setup failed, will use whisper.cpp as fallback:", err);
      }

      // Setup whisper.cpp (fallback)
      await setupWhisper(config);

      consola.success("Setup complete! You can now use 'adas record' and 'adas transcribe'.");
    });
}
