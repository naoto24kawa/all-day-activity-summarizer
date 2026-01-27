import { serve } from "@hono/node-server";
import { createDatabase } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { loadConfig } from "../config.js";
import { createApp } from "../server/app.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the local API server")
    .option("-p, --port <port>", "Port number")
    .action((options: { port?: string }) => {
      const config = loadConfig();
      const port = options.port ? Number.parseInt(options.port, 10) : config.server.port;
      const db = createDatabase(config.dbPath);
      const app = createApp(db);

      consola.info(`Starting API server on http://localhost:${port}`);

      serve({
        fetch: app.fetch,
        port,
      });

      consola.success(`API server running on http://localhost:${port}`);
    });
}
