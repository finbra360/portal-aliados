import postgres from "postgres";

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no está configurado");
  }
  return postgres(url, { ssl: "require", max: 5 });
}

// Reused across hot-reloads in dev so we don't exhaust the connection pool.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql = globalForDb.__sql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}
