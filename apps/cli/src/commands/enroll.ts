import { existsSync } from "node:fs";
import { getScriptPath } from "@repo/core";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { getWhisperXPythonPath, isWhisperXInstalled } from "../whisper/setup.js";
import {
  loadRegisteredEmbeddings,
  loadUnknownSpeakers,
  saveRegisteredEmbeddings,
  saveUnknownSpeakers,
} from "../whisper/speaker-store.js";

async function extractEmbedding(audioPath: string): Promise<number[]> {
  const config = loadConfig();

  if (!isWhisperXInstalled()) {
    throw new Error("whisperX environment is not installed. Run 'adas setup' first.");
  }

  const pythonPath = getWhisperXPythonPath();
  const scriptPath = getScriptPath("enroll_speaker.py");

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const hfToken = config.whisper.hfToken ?? process.env.HF_TOKEN;
  if (hfToken) {
    env.HF_TOKEN = hfToken;
  }

  const proc = Bun.spawn([pythonPath, scriptPath, audioPath], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  await proc.exited;
  const exitCode = proc.exitCode;

  if (exitCode !== 0) {
    const stderrStream = proc.stderr;
    const stderr =
      stderrStream && typeof stderrStream !== "number"
        ? await new Response(stderrStream).text()
        : "";
    throw new Error(`Embedding extraction failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }

  const stdoutStream = proc.stdout;
  const stdout =
    stdoutStream && typeof stdoutStream !== "number" ? await new Response(stdoutStream).text() : "";

  const jsonStart = stdout.indexOf("{");
  const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
  const result = JSON.parse(jsonStr) as { embedding: number[] };
  return result.embedding;
}

export function registerEnrollCommand(program: Command): void {
  program
    .command("enroll")
    .description("Register speaker voice embedding for speaker identification")
    .option("--name <name>", "Speaker name to register")
    .option("--audio <path>", "Path to audio file for voice enrollment")
    .option("--list", "List registered speakers")
    .option("--remove <name>", "Remove a registered speaker")
    .option("--assign", "Assign names to unknown speakers")
    .action(
      async (options: {
        name?: string;
        audio?: string;
        list?: boolean;
        remove?: string;
        assign?: boolean;
      }) => {
        if (options.list) {
          const store = loadRegisteredEmbeddings();
          const names = Object.keys(store);
          if (names.length === 0) {
            consola.info("No speakers registered.");
          } else {
            consola.info(`Registered speakers (${names.length}):`);
            for (const name of names) {
              const dims = store[name]?.length;
              consola.info(`  - ${name} (${dims} dims)`);
            }
          }
          return;
        }

        if (options.remove) {
          const store = loadRegisteredEmbeddings();
          if (!(options.remove in store)) {
            consola.error(`Speaker "${options.remove}" is not registered.`);
            process.exit(1);
          }
          delete store[options.remove];
          saveRegisteredEmbeddings(store);
          consola.success(`Removed speaker: ${options.remove}`);
          return;
        }

        if (options.assign) {
          await assignUnknownSpeakers();
          return;
        }

        // Enroll mode
        if (!options.name || !options.audio) {
          consola.error("Both --name and --audio are required for enrollment.");
          consola.info("Usage: adas enroll --name <name> --audio <path>");
          process.exit(1);
        }

        if (!existsSync(options.audio)) {
          consola.error(`Audio file not found: ${options.audio}`);
          process.exit(1);
        }

        consola.start(`Extracting voice embedding for "${options.name}"...`);
        const embedding = await extractEmbedding(options.audio);
        consola.info(`Embedding extracted (${embedding.length} dimensions)`);

        const store = loadRegisteredEmbeddings();
        const isUpdate = options.name in store;
        store[options.name] = embedding;
        saveRegisteredEmbeddings(store);

        if (isUpdate) {
          consola.success(`Updated speaker embedding: ${options.name}`);
        } else {
          consola.success(`Registered new speaker: ${options.name}`);
        }
      },
    );
}

async function assignUnknownSpeakers(): Promise<void> {
  const unknownStore = loadUnknownSpeakers();
  const entries = Object.entries(unknownStore);

  if (entries.length === 0) {
    consola.info("No unknown speakers to assign.");
    return;
  }

  consola.info(`Unknown speakers (${entries.length}):\n`);

  const embeddingsStore = loadRegisteredEmbeddings();

  for (const [id, speaker] of entries) {
    consola.info(`--- ${id} ---`);
    consola.info(`  First seen: ${speaker.firstSeen}`);
    consola.info(`  Last seen:  ${speaker.lastSeen}`);
    consola.info(`  Occurrences: ${speaker.occurrenceCount}`);
    consola.info(`  Sample texts:`);
    for (const text of speaker.sampleTexts.slice(0, 5)) {
      consola.info(`    "${text}"`);
    }

    const name = await consola.prompt(`Assign name for ${id} (empty to skip):`, {
      type: "text",
    });

    if (typeof name === "symbol") {
      // User cancelled (Ctrl+C)
      consola.info("Assignment cancelled.");
      break;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      consola.info(`Skipped ${id}`);
      continue;
    }

    // 登録済み embedding に追加
    embeddingsStore[trimmedName] = speaker.embedding;
    // unknown から削除
    delete unknownStore[id];

    consola.success(`Assigned ${id} -> ${trimmedName}`);
  }

  saveRegisteredEmbeddings(embeddingsStore);
  saveUnknownSpeakers(unknownStore);
  consola.success("Assignment complete.");
}
