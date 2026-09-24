import { createDatabasePool } from "@skrivebord/database";
import type { Pool } from "pg";

declare global {
  var __skrivebordPool: Pool | undefined;
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_REQUIRED");
}

export const databasePool =
  globalThis.__skrivebordPool ??
  createDatabasePool(databaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalThis.__skrivebordPool = databasePool;
}
