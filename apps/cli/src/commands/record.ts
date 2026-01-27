import type { Command } from "commander";
import consola from "consola";
import { AudioCapture, listPulseAudioSources } from "../audio/capture.js";
import { loadConfig } from "../config.js";

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .description("Start recording audio from PulseAudio source")
    .option("-s, --source <source>", "PulseAudio source name (default: auto-detect)")
    .option("--list-sources", "List available PulseAudio sources")
    .action(async (options: { source?: string; listSources?: boolean }) => {
      if (options.listSources) {
        const sources = await listPulseAudioSources();
        consola.info("Available PulseAudio sources:");
        for (const src of sources) {
          consola.log(`  - ${src}`);
        }
        return;
      }

      const config = loadConfig();

      const capture = new AudioCapture({
        source: options.source,
        config,
        onChunkComplete: (filePath) => {
          consola.info(`Chunk ready for transcription: ${filePath}`);
        },
      });

      // Graceful shutdown
      const shutdown = async () => {
        consola.info("Shutting down...");
        await capture.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      consola.info("Starting audio capture (Ctrl+C to stop)");
      await capture.start();
    });
}
