import { createDatabase, schema } from "@repo/db";
import type { Command } from "commander";
import consola from "consola";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";

export function registerVocabCommand(program: Command): void {
  const vocab = program.command("vocab").description("Manage vocabulary for transcription hints");

  vocab
    .command("add <term>")
    .description("Add a term to vocabulary")
    .option("-r, --reading <reading>", "Reading (pronunciation)")
    .option("-c, --category <category>", "Category")
    .action(async (term: string, options: { reading?: string; category?: string }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      const existing = db
        .select()
        .from(schema.vocabulary)
        .where(eq(schema.vocabulary.term, term))
        .get();

      if (existing) {
        consola.warn(`Term "${term}" already exists (id: ${existing.id})`);
        return;
      }

      db.insert(schema.vocabulary)
        .values({
          term,
          reading: options.reading ?? null,
          category: options.category ?? null,
          source: "manual",
        })
        .run();

      consola.success(`Added: "${term}"`);
    });

  vocab
    .command("remove <term>")
    .description("Remove a term from vocabulary")
    .action(async (term: string) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      const existing = db
        .select()
        .from(schema.vocabulary)
        .where(eq(schema.vocabulary.term, term))
        .get();

      if (!existing) {
        consola.warn(`Term "${term}" not found`);
        return;
      }

      db.delete(schema.vocabulary).where(eq(schema.vocabulary.term, term)).run();
      consola.success(`Removed: "${term}"`);
    });

  vocab
    .command("list")
    .description("List all vocabulary terms")
    .option("-s, --search <pattern>", "Search pattern")
    .option("-c, --category <category>", "Filter by category")
    .action(async (options: { search?: string; category?: string }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      const query = db.select().from(schema.vocabulary);

      const allTerms = query.all();
      let filtered = allTerms;

      if (options.search) {
        const pattern = options.search.toLowerCase();
        filtered = filtered.filter(
          (v) =>
            v.term.toLowerCase().includes(pattern) ||
            (v.reading?.toLowerCase().includes(pattern) ?? false),
        );
      }

      if (options.category) {
        filtered = filtered.filter((v) => v.category === options.category);
      }

      if (filtered.length === 0) {
        consola.info("No vocabulary terms found");
        return;
      }

      consola.info(`Found ${filtered.length} term(s):\n`);
      for (const v of filtered) {
        const parts = [v.term];
        if (v.reading) parts.push(`(${v.reading})`);
        if (v.category) parts.push(`[${v.category}]`);
        parts.push(`- ${v.source}`);
        if (v.usageCount > 0) parts.push(`(used ${v.usageCount}x)`);
        console.log(`  ${parts.join(" ")}`);
      }
    });

  vocab
    .command("import <file>")
    .description("Import terms from a file (one term per line)")
    .option("-c, --category <category>", "Category for all imported terms")
    .action(async (file: string, options: { category?: string }) => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      const { readFileSync, existsSync } = await import("node:fs");

      if (!existsSync(file)) {
        consola.error(`File not found: ${file}`);
        return;
      }

      const content = readFileSync(file, "utf-8");
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));

      let added = 0;
      let skipped = 0;

      for (const line of lines) {
        // Format: term または term|reading
        const [term, reading] = line.split("|").map((s) => s.trim());
        if (!term) continue;

        const existing = db
          .select()
          .from(schema.vocabulary)
          .where(eq(schema.vocabulary.term, term))
          .get();

        if (existing) {
          skipped++;
          continue;
        }

        db.insert(schema.vocabulary)
          .values({
            term,
            reading: reading ?? null,
            category: options.category ?? null,
            source: "manual",
          })
          .run();
        added++;
      }

      consola.success(`Imported: ${added} added, ${skipped} skipped (already exists)`);
    });

  vocab
    .command("export")
    .description("Export vocabulary to stdout")
    .action(async () => {
      const config = loadConfig();
      const db = createDatabase(config.dbPath);

      const terms = db.select().from(schema.vocabulary).all();

      for (const v of terms) {
        if (v.reading) {
          console.log(`${v.term}|${v.reading}`);
        } else {
          console.log(v.term);
        }
      }
    });
}

/**
 * DB の vocabulary テーブルから initial_prompt 用の文字列を生成する。
 */
export function buildInitialPrompt(db: ReturnType<typeof createDatabase>): string | undefined {
  const terms = db.select().from(schema.vocabulary).all();

  if (terms.length === 0) return undefined;

  // 用語リストを initial_prompt 形式に変換
  // WhisperX は initial_prompt でコンテキストを渡せる
  const termList = terms.map((v) => v.term).join("、");

  return `以下は会話で使われる可能性のある用語です: ${termList}`;
}
