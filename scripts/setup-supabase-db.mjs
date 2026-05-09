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

  const result = await client.query(`
    select
      to_regclass('public.documents') as documents,
      to_regclass('public.items') as items,
      to_regclass('public.study_logs') as study_logs
  `);

  console.log("Supabase schema setup completed.");
  console.table(result.rows);
} finally {
  await client.end();
}
