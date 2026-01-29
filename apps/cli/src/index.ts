#!/usr/bin/env bun
import { Command } from "commander";
import { registerEnrollCommand } from "./commands/enroll.js";
import { registerImprovePromptCommand } from "./commands/improve-prompt.js";
import { registerInterpretCommand } from "./commands/interpret.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSummarizeCommand } from "./commands/summarize.js";
import { registerTranscribeCommand } from "./commands/transcribe.js";
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
registerEnrollCommand(program);
registerWorkerCommand(program);
registerInterpretCommand(program);
registerImprovePromptCommand(program);

program.parse();
