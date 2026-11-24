// Datos de la relación con cada empresa que no vienen en la foto de SIAC:
// contacto principal, último contacto humano, cuenta de pago, WhatsApp válido,
// atrasos y promesas incumplidas recientes y desde cuándo es cliente. Los usan
// la salud del cliente (lib/clientes/salud.ts), «Mi cartera», el Resumen de
// cartera y los playbooks. Solo lee.

import { sql } from "@/lib/db";
import { tieneDestinatarioValido } from "@/lib/collections/store";
import { fechaMexico } from "@/lib/collections/rules";
import { AJUSTES_SALUD_DEFAULT, leerAjustesSalud, type AjustesSalud, type RelacionSalud } from "@/lib/clientes/salud";

/** Tipos de col_activities que son un contacto de una persona del equipo con el cliente. */
export const CONTACTO_COBRANZA = ["llamada", "visita", "correo", "whatsapp_enviado", "promesa_creada"];

export type RelacionEmpresa = RelacionSalud;

/** Ajuste `salud` de crm_settings; sin la fila, los valores por omisión. */
export async function getAjustesSalud(): Promise<AjustesSalud> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = 'salud'`;
  return leerAjustesSalud(r?.value);
}

/**
 * Relación de cada empresa. Las ventanas de atrasos y promesas salen de los
 * ajustes de salud (90 y 60 días por omisión).
 */
export async function relacionDeEmpresas(ids: string[], ajustes: AjustesSalud = AJUSTES_SALUD_DEFAULT): Promise<Map<string, RelacionEmpresa>> {
  if (!ids.length) return new Map();
  const hoy = fechaMexico();
  const rows = await sql`
    SELECT e.id,
           EXISTS (SELECT 1 FROM crm_personas p WHERE p.empresa_id = e.id AND p.es_principal AND p.vigente) AS tiene_principal,
           greatest(
             (SELECT max(a.ocurrido_at) FROM crm_actividades a WHERE a.empresa_id = e.id AND a.tipo <> 'nota' AND a.actor <> 'sistema'),
             (SELECT max(a.ocurrido_at) FROM col_activities a JOIN col_clients c ON c.id = a.client_id
               WHERE c.empresa_id = e.id AND a.actor <> 'sistema' AND a.tipo = ANY(${CONTACTO_COBRANZA}))
           ) AS ultimo_contacto,
           EXISTS (SELECT 1 FROM col_clients c WHERE c.empresa_id = e.id AND c.cuenta_pago_id IS NOT NULL) AS cuenta_pago,
           EXISTS (SELECT 1 FROM col_clients c WHERE c.empresa_id = e.id AND ${tieneDestinatarioValido()}) AS whatsapp,
           -- Días distintos en que alguno de sus créditos pasó de 0 a más días de atraso.
           (SELECT count(DISTINCT ev.fecha_evento) FROM col_credit_events ev
              JOIN col_credits cr ON cr.id = ev.credit_id JOIN col_clients c ON c.id = cr.client_id
             WHERE c.empresa_id = e.id AND ev.tipo = 'entrada_mora'
               AND ev.fecha_evento > ${hoy}::date - ${ajustes.ventanaAtrasosDias}::int) AS atrasos,
           (SELECT count(*) FROM col_promises p JOIN col_clients c ON c.id = p.client_id
             WHERE c.empresa_id = e.id AND p.estado = 'incumplida'
               AND coalesce((p.resuelta_at AT TIME ZONE 'America/Mexico_City')::date, p.fecha_compromiso) > ${hoy}::date - ${ajustes.ventanaPromesasDias}::int) AS promesas,
           (SELECT to_char(min(cr.fecha_ministracion), 'YYYY-MM-DD') FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
             WHERE c.empresa_id = e.id) AS cliente_desde
    FROM crm_empresas e WHERE e.id = ANY(${ids}::uuid[])
  `;
  return new Map(
    rows.map((r) => [
      r.id as string,
      {
        tienePrincipal: !!r.tiene_principal,
        ultimoContacto: r.ultimo_contacto ? (r.ultimo_contacto as Date).toISOString() : null,
        cuentaPago: !!r.cuenta_pago,
        whatsappValido: !!r.whatsapp,
        atrasosRecientes: Number(r.atrasos ?? 0),
        promesasIncumplidas: Number(r.promesas ?? 0),
        clienteDesde: (r.cliente_desde as string) ?? null,
      },
    ]),
  );
}
