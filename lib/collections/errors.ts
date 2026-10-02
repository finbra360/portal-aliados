/**
 * Registra en el log del servidor un error al cargar una pantalla de cobranza y
 * regresa un código corto para mostrarlo en pantalla (el SQLSTATE de Postgres
 * o el nombre del error). Solo se registran el código y el mensaje: nunca la
 * consulta ni sus parámetros, que pueden traer datos de clientes.
 */
export function codigoDeError(contexto: string, e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const nombre = e instanceof Error ? e.name : "Error";
  const mensaje = e instanceof Error ? e.message : String(e);
  const codigo = typeof code === "string" && code ? code : nombre;
  console.error(`Cobranza (${contexto}): [${codigo}] ${mensaje}`);
  return codigo;
}
