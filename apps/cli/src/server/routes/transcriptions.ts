import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

export function createTranscriptionsRouter(db: AdasDatabase) {
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");

    if (!date) {
      const all = db.select().from(schema.transcriptionSegments).all();
      return c.json(all);
    }

    const segments = db
      .select()
      .from(schema.transcriptionSegments)
      .where(eq(schema.transcriptionSegments.date, date))
      .all();

    return c.json(segments);
  });

  return router;
}
