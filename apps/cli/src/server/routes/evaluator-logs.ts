import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

export function createEvaluatorLogsRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");

    if (!date) {
      const all = db.select().from(schema.evaluatorLogs).all();
      return c.json(all);
    }

    const logs = db
      .select()
      .from(schema.evaluatorLogs)
      .where(eq(schema.evaluatorLogs.date, date))
      .all();

    return c.json(logs);
  });

  return router;
}
