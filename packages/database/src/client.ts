import type { PrincipalContext } from "@skrivebord/contracts";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

export type SkrivebordDatabase = NodePgDatabase<typeof schema>;

export type ScopedDatabaseContext = {
  client: PoolClient;
  db: SkrivebordDatabase;
  principal: PrincipalContext;
};

export function createDatabasePool(databaseUrl: string): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_REQUIRED");
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

export async function withPrincipalTransaction<T>(
  pool: Pool,
  principal: PrincipalContext,
  work: (context: ScopedDatabaseContext) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "select set_config('app.workspace_id', $1, true), set_config('app.principal_id', $2, true), set_config('app.principal_type', $3, true), set_config('app.request_id', $4, true), set_config('app.principal_source', $5, true)",
      [
        principal.workspaceId,
        principal.principalId,
        principal.principalType,
        principal.requestId,
        principal.source
      ]
    );

    const db = drizzle(client, { schema });
    const result = await work({
      client,
      db,
      principal
    });

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
