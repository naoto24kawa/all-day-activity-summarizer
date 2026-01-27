import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: join(homedir(), ".adas", "adas.db"),
  },
});
