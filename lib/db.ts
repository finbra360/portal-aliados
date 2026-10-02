import postgres from "postgres";

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no está configurado");
  }
  // DATABASE_SSL=disable solo para desarrollo contra un Postgres local sin TLS.
  return postgres(url, {
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    // DATABASE_URL apunta al pooler de Supabase en modo transacción (puerto 6543):
    // cada consulta puede caer en una conexión distinta de Postgres, así que una
    // sentencia preparada en una no existe en la otra (error 26000). postgres.js
    // recomienda desactivarlas con PgBouncer/Supavisor en modo transacción.
    prepare: false,
  });
}

// Reused across hot-reloads in dev so we don't exhaust the connection pool.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql = globalForDb.__sql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}
