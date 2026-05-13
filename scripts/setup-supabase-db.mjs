import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error("Missing SUPABASE_DB_URL.");
  console.error("Usage: SUPABASE_DB_URL='postgresql://postgres:...' npm run setup:db");
  process.exit(1);
}

const schemaPath = path.join(process.cwd(), "supabase-schema.sql");
const schema = await fs.readFile(schemaPath, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query(schema);
  await client.query("notify pgrst, 'reload schema'");

  const result = await client.query(`
    select
      to_regclass('public.documents') as documents,
      to_regclass('public.items') as items,
      to_regclass('public.study_logs') as study_logs,
      to_regclass('public.study_counters') as study_counters,
      exists(select 1 from storage.buckets where id = 'documents') as documents_bucket,
      to_regprocedure('public.pick_next_item(uuid, integer)') as pick_next_item,
      to_regprocedure('public.increment_create_count(uuid)') as increment_create_count
  `);

  console.log("Supabase schema setup completed.");
  console.table(result.rows);
} finally {
  await client.end();
}
