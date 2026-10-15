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
    // Tampoco encadenar consultas en una misma conexión ("pipelining"): con
    // varias consultas simultáneas, el pooler se queda esperando a la mitad y la
    // función nunca termina (pasó con el reporte diario). Con 0, cada conexión
    // manda una consulta a la vez; la concurrencia queda en `max` conexiones.
    // postgres.js 3.4 lo acepta (src/index.js) pero no viene en sus tipos.
    ...({ max_pipeline: 0 } as object),
  });
}

// Reused across hot-reloads in dev so we don't exhaust the connection pool.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql = globalForDb.__sql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}
