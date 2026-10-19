import postgres from "postgres";

/**
 * Conexión a la base de Credit Health (Supabase aparte, de finbra360/credit-health).
 * Se mantiene separada de la base del portal: el sitio público del diagnóstico solo
 * tiene acceso a sus propios datos. Mismas reglas que lib/db.ts (pooler en modo
 * transacción: sin sentencias preparadas ni pipelining).
 */

const g = globalThis as unknown as { __chSql?: postgres.Sql };

export function creditHealthConfigurado(): boolean {
  return !!process.env.CREDIT_HEALTH_DATABASE_URL;
}

export function chSql(): postgres.Sql {
  if (g.__chSql) return g.__chSql;
  const url = process.env.CREDIT_HEALTH_DATABASE_URL;
  if (!url) throw new Error("CREDIT_HEALTH_DATABASE_URL no está configurado");
  const client = postgres(url, {
    ssl: process.env.CREDIT_HEALTH_DATABASE_SSL === "disable" ? false : "require",
    max: 3,
    prepare: false,
    onnotice: () => {},
    ...({ max_pipeline: 0 } as object),
  });
  g.__chSql = client;
  return client;
}

/** Transacción en la base de Credit Health (mismo patrón que `transaccion` de lib/db.ts). */
export async function chTransaccion<T>(fn: (tx: postgres.Sql) => Promise<T>): Promise<T> {
  const tx = await chSql().reserve();
  try {
    await tx`BEGIN`;
    let resultado: T;
    try {
      resultado = await fn(tx);
    } catch (e) {
      await tx`ROLLBACK`.catch(() => {});
      throw e;
    }
    await tx`COMMIT`;
    return resultado;
  } finally {
    tx.release();
  }
}
