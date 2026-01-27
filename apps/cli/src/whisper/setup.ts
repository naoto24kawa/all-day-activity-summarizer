import { existsSync } from "node:fs";
import { join } from "node:path";
import consola from "consola";
import type { AdasConfig } from "../config.js";

function getWhisperBinaryPath(config: AdasConfig): string {
  return join(config.whisper.installDir, "build", "bin", "whisper-cli");
}

function getModelPath(config: AdasConfig): string {
  return join(config.whisper.installDir, "models", config.whisper.modelName);
}

export function isWhisperInstalled(config: AdasConfig): boolean {
  return existsSync(getWhisperBinaryPath(config)) && existsSync(getModelPath(config));
}

async function runCommand(cmd: string[], cwd?: string): Promise<void> {
  consola.debug(`Running: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${cmd.join(" ")}`);
  }
}

export async function setupWhisper(config: AdasConfig): Promise<void> {
  const installDir = config.whisper.installDir;

  // Clone whisper.cpp if not present
  if (!existsSync(installDir)) {
    consola.info("Cloning whisper.cpp...");
    await runCommand([
      "git",
      "clone",
      "--depth",
      "1",
      "https://github.com/ggerganov/whisper.cpp.git",
      installDir,
    ]);
  } else {
    consola.info("whisper.cpp directory exists, skipping clone");
  }

  // Build with cmake
  if (!existsSync(getWhisperBinaryPath(config))) {
    consola.info("Building whisper.cpp...");
    await runCommand(["cmake", "-B", "build", "-DCMAKE_BUILD_TYPE=Release"], installDir);
    await runCommand(["cmake", "--build", "build", "--config", "Release", "-j"], installDir);
  } else {
    consola.info("whisper.cpp binary exists, skipping build");
  }

  // Download model
  const modelPath = getModelPath(config);
  if (!existsSync(modelPath)) {
    consola.info(`Downloading model: ${config.whisper.modelName}...`);
    const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${config.whisper.modelName}`;
    await runCommand(["curl", "-L", "-o", modelPath, "--create-dirs", modelUrl]);
  } else {
    consola.info("Model file exists, skipping download");
  }

  consola.success("whisper.cpp setup complete!");
}

export { getWhisperBinaryPath, getModelPath };
