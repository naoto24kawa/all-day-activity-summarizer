import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import consola from "consola";
import type { AdasConfig } from "../config.js";

const WHISPERX_VENV_DIR = join(homedir(), ".adas", "whisperx-venv");

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

export function getWhisperXVenvDir(): string {
  return WHISPERX_VENV_DIR;
}

export function getWhisperXPythonPath(): string {
  return join(WHISPERX_VENV_DIR, "bin", "python3");
}

export function isWhisperXInstalled(): boolean {
  if (!existsSync(getWhisperXPythonPath())) return false;
  // Verify whisperx module is actually importable
  try {
    const proc = Bun.spawnSync([getWhisperXPythonPath(), "-c", "import whisperx"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function findPythonForVenv(): string {
  // whisperX requires Python <3.14, prefer 3.12
  const candidates = [
    "/opt/homebrew/opt/python@3.12/bin/python3.12",
    "/opt/homebrew/opt/python@3.13/bin/python3.13",
    "/opt/homebrew/opt/python@3.11/bin/python3.11",
    "python3.12",
    "python3.13",
    "python3.11",
    "python3",
  ];
  for (const cmd of candidates) {
    if (existsSync(cmd)) return cmd;
  }
  return "python3";
}

export async function setupWhisperX(): Promise<void> {
  if (isWhisperXInstalled()) {
    consola.info("whisperX venv already exists, skipping setup");
    return;
  }

  consola.info("Setting up whisperX virtual environment...");

  const python = findPythonForVenv();
  consola.info(`Using Python: ${python}`);

  // Create venv
  await runCommand([python, "-m", "venv", WHISPERX_VENV_DIR]);

  const pip = join(WHISPERX_VENV_DIR, "bin", "pip");

  // Install whisperx and dependencies
  consola.info("Installing whisperX (this may take a while)...");
  await runCommand([pip, "install", "whisperx", "torch", "torchaudio"]);

  consola.success("whisperX setup complete!");
}

export { getWhisperBinaryPath, getModelPath };
