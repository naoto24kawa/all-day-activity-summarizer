import { setupFileLogger } from "@repo/core";
import consola from "consola";
import { createLocalWorkerApp } from "./app.js";

setupFileLogger("local-worker");

const PORT = Number(process.env.LOCAL_WORKER_PORT ?? "3200");

const app = createLocalWorkerApp();

consola.info(`Local Worker server starting on port ${PORT}...`);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

consola.success(`Local Worker server running at http://localhost:${PORT}`);
