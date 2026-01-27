#!/usr/bin/env bun
import { Command } from "commander";
import { registerAllCommand } from "./commands/all.js";
import { registerRecordCommand } from "./commands/record.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSummarizeCommand } from "./commands/summarize.js";
import { registerTranscribeCommand } from "./commands/transcribe.js";

const program = new Command();

program
  .name("adas")
  .description("All Day Activity Summarizer - PC audio monitoring & summarization")
  .version("0.1.0");

registerSetupCommand(program);
registerRecordCommand(program);
registerTranscribeCommand(program);
registerSummarizeCommand(program);
registerServeCommand(program);
registerAllCommand(program);

program.parse();
