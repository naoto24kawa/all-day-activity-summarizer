import { setupFileLogger } from "@repo/core";
import consola from "consola";
import { createWorkerApp } from "./app.js";

setupFileLogger();

const PORT = Number(process.env.WORKER_PORT ?? "3100");

const app = createWorkerApp();

consola.info(`Worker server starting on port ${PORT}...`);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

consola.success(`Worker server running at http://localhost:${PORT}`);
