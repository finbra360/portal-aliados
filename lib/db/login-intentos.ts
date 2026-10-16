// Registro y conteo de los intentos de login del portal (portal_login_intentos).
// Los límites en sí están en lib/login-limites.ts.

import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { LIMITES, type ConteoIntentos } from "@/lib/login-limites";

/** IP de quien llama, según los encabezados que pone Vercel. */
export function ipDe(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconocida";
}

/** Huella de la IP: se guarda esto, no la dirección. */
export function huellaDeIp(ip: string): string {
  return createHash("sha256").update(`${process.env.JWT_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

export async function contarIntentos(email: string, ipHash: string): Promise<ConteoIntentos> {
  const L = LIMITES;
  const [r] = await sql`
    SELECT
      count(*) FILTER (WHERE tipo = 'codigo' AND email = ${email} AND created_at > now() - make_interval(mins => ${L.codigoPorCorreo.minutos}::int))::int AS codigo_correo,
      count(*) FILTER (WHERE tipo = 'codigo' AND ip_hash = ${ipHash} AND created_at > now() - make_interval(mins => ${L.codigoPorIp.minutos}::int))::int AS codigo_ip,
      count(*) FILTER (WHERE tipo = 'verificar' AND NOT ok AND email = ${email} AND created_at > now() - make_interval(mins => ${L.fallosPorCorreo.minutos}::int))::int AS fallos_correo,
      count(*) FILTER (WHERE tipo = 'verificar' AND NOT ok AND ip_hash = ${ipHash} AND created_at > now() - make_interval(mins => ${L.fallosPorIp.minutos}::int))::int AS fallos_ip
    FROM portal_login_intentos
    WHERE created_at > now() - interval '1 hour' AND (email = ${email} OR ip_hash = ${ipHash})
  `;
  return {
    codigoCorreo: Number(r.codigo_correo),
    codigoIp: Number(r.codigo_ip),
    fallosCorreo: Number(r.fallos_correo),
    fallosIp: Number(r.fallos_ip),
  };
}

export async function registrarIntento(p: { tipo: "codigo" | "verificar"; email: string; ipHash: string; ok: boolean }): Promise<void> {
  await sql`INSERT INTO portal_login_intentos (tipo, email, ip_hash, ok) VALUES (${p.tipo}, ${p.email}, ${p.ipHash}, ${p.ok})`;
  // Limpieza barata: de vez en cuando se borra lo de más de un día.
  if (Math.random() < 0.05) await sql`DELETE FROM portal_login_intentos WHERE created_at < now() - interval '1 day'`;
}
