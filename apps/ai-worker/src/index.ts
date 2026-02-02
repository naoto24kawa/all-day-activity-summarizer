import { setupFileLogger } from "@repo/core";
import consola from "consola";
import { createWorkerApp } from "./app.js";

setupFileLogger("ai-worker");

const PORT = Number(process.env.AI_WORKER_PORT ?? process.env.WORKER_PORT ?? "3100");

const app = createWorkerApp();

consola.info(`AI Worker server starting on port ${PORT}...`);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

consola.success(`AI Worker server running at http://localhost:${PORT}`);
