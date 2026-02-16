#!/usr/bin/env bun
import { Command } from "commander";
import { registerImprovePromptCommand } from "./commands/improve-prompt.js";
import { registerInterpretCommand } from "./commands/interpret.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerServersCommand } from "./commands/servers.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSSEServerCommand } from "./commands/sse-server.js";
import { registerSummarizeCommand } from "./commands/summarize.js";
import { registerTranscribeCommand } from "./commands/transcribe.js";
import { registerVocabCommand } from "./commands/vocab.js";
import { registerWorkerCommand } from "./commands/worker.js";

const program = new Command();

program
  .name("adas")
  .description("All Day Activity Summarizer - PC audio monitoring & summarization")
  .version("0.1.0");

registerSetupCommand(program);
registerTranscribeCommand(program);
registerSummarizeCommand(program);
registerServeCommand(program);
registerServersCommand(program);
registerSSEServerCommand(program);
registerWorkerCommand(program);
registerInterpretCommand(program);
registerImprovePromptCommand(program);
registerVocabCommand(program);
registerProviderCommand(program);

program.parse();
