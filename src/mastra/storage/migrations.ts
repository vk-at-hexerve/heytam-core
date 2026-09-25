import { Client } from 'pg';

const migrationSql = `
CREATE TABLE IF NOT EXISTS mastra_memory (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mastra_memory_tenant_thread
  ON mastra_memory (tenant_id, thread_id);
`;

export async function runMastraMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(migrationSql);
  } finally {
    await client.end();
  }
}

export async function checkMastraPersistence(connectionString: string): Promise<{ ok: boolean; tables: string[] }> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('mastra_memory');
    `);

    return {
      ok: result.rowCount > 0,
      tables: result.rows.map((row) => row.table_name),
    };
  } finally {
    await client.end();
  }
}
