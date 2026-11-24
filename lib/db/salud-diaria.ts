// Historia de la salud del cliente (crm_salud_diaria): se guarda una vez al día
// después de la foto de SIAC. Si la tabla todavía no existe (falta correr
// crm-schema.sql), nada de aquí falla: no se guarda y no hay tendencia.

import { sql, transaccion } from "@/lib/db";
import { getPhotoStatus } from "@/lib/db/collections";
import { getEmpresasLista } from "@/lib/db/empresas";
import { fechaMexico } from "@/lib/collections/rules";
import type { NivelSalud } from "@/lib/clientes/salud";

async function hayHistorial(): Promise<boolean> {
  const [r] = await sql`SELECT to_regclass('public.crm_salud_diaria') IS NOT NULL AS hay`;
  return !!r?.hay;
}

export type ResultadoSaludDiaria = { guardo: false; motivo: string } | { guardo: true; empresas: number };

/**
 * Guarda la salud de hoy de cada empresa con crédito vigente, con la foto de
 * hoy. Si ya había fila de hoy (el cron corre dos veces), la reemplaza.
 */
export async function guardarSaludDiaria(): Promise<ResultadoSaludDiaria> {
  const hoy = fechaMexico();
  const status = await getPhotoStatus();
  if (status.fechaCorte !== hoy) return { guardo: false, motivo: status.fechaCorte ? `La foto de SIAC no es de hoy (última: ${status.fechaCorte})` : "Todavía no hay foto de SIAC" };
  if (!(await hayHistorial())) return { guardo: false, motivo: "Falta la tabla crm_salud_diaria (correr crm-schema.sql)" };

  const lista = await getEmpresasLista(hoy, { filtro: "todos", q: "", orden: "nombre", yo: "" });
  const filas = lista.items.filter((e) => e.salud);
  await transaccion(async (tx) => {
    for (const e of filas) {
      const s = e.salud!;
      await tx`
        INSERT INTO crm_salud_diaria (empresa_id, fecha, puntos, nivel, razones)
        VALUES (${e.empresaId}, ${hoy}, ${s.puntos}, ${s.nivel}, ${JSON.stringify(s.razones)}::text::jsonb)
        ON CONFLICT (empresa_id, fecha) DO UPDATE SET puntos = EXCLUDED.puntos, nivel = EXCLUDED.nivel, razones = EXCLUDED.razones, created_at = now()
      `;
    }
  });
  return { guardo: true, empresas: filas.length };
}

/** El nivel guardado más reciente ANTES de hoy de cada empresa (para saber quién acaba de pasar a En riesgo). */
export async function nivelAnteriorDeSalud(hoy: string): Promise<Map<string, NivelSalud>> {
  if (!(await hayHistorial())) return new Map();
  const rows = await sql`
    SELECT DISTINCT ON (empresa_id) empresa_id, nivel
    FROM crm_salud_diaria WHERE fecha < ${hoy}::date
    ORDER BY empresa_id, fecha DESC
  `;
  return new Map(rows.map((r) => [r.empresa_id as string, r.nivel as NivelSalud]));
}

export interface PuntoSalud {
  fecha: string;
  puntos: number;
  nivel: NivelSalud;
}

/** Salud guardada de una empresa en los últimos `dias` días, de la más vieja a la más nueva. */
export async function getTendenciaSalud(empresaId: string, dias = 90): Promise<PuntoSalud[]> {
  if (!(await hayHistorial())) return [];
  const rows = await sql`
    SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, puntos, nivel
    FROM crm_salud_diaria
    WHERE empresa_id = ${empresaId} AND fecha > ${fechaMexico()}::date - ${dias}::int
    ORDER BY fecha
  `;
  return rows.map((r) => ({ fecha: r.fecha as string, puntos: Number(r.puntos), nivel: r.nivel as NivelSalud }));
}
