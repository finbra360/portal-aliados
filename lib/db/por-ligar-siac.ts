// «Por ligar con SIAC»: todos los negocios dispersados que todavía no tienen su
// crédito de SIAC, cada uno con sus sugerencias (las mismas reglas que la
// tarjeta de la ficha, lib/clientes/siac-liga.ts). Se ligan con
// ligarCreditoSiac, igual que desde la ficha. Los que se revisan y no tienen
// crédito («No tiene crédito en SIAC») se guardan en crm_settings
// «dispersados_sin_credito» y dejan de salir aquí, en Inicio y en el resumen.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { NegocioError } from "@/lib/db/negocios";
import { CLAVE_SIN_CREDITO, creditosLibres, nombresDelNegocio } from "@/lib/db/siac-liga";
import { ligasSeguras, nombreEnHubspot, sugerirCreditos, type Sugerencia } from "@/lib/clientes/siac-liga";

export interface RenglonPorLigar {
  id: string;
  empresa: string;
  /** Nombre del negocio en HubSpot, si se importó y es distinto al de la empresa. */
  nombreHubspot: string | null;
  /** Monto de referencia: el aprobado en comité, el de la oferta o el estimado. */
  monto: number | null;
  /** Cuándo pasó a Dispersado (YYYY-MM-DD, hora de México). */
  dispersadoEl: string;
  sugerencias: Sugerencia[];
}

export interface PorLigarSiac {
  renglones: RenglonPorLigar[];
  /** Los que se pueden ligar sin revisar uno por uno (ligasSeguras). */
  seguras: { id: string; creditId: string; historico: boolean }[];
}

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function sinCredito(): Promise<Set<string>> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = ${CLAVE_SIN_CREDITO}`;
  const ids = (r?.value as { ids?: unknown })?.ids;
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
}

/** null si la base todavía no liga negocios con SIAC (falta crm-schema.sql). */
export async function getPorLigarSiac(): Promise<PorLigarSiac | null> {
  const amb = ambienteActual();
  const [col] = await sql`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_negocios_credito' AND column_name = 'credit_id'
  `;
  if (!col) return null;

  const hayDecisiones = (await sql`SELECT to_regclass('public.crm_negocio_decisiones') IS NOT NULL AS hay`)[0].hay as boolean;
  const [negocios, creditos, fuera] = await Promise.all([
    sql`
      SELECT n.id, n.empresa_id, e.nombre AS empresa, e.razon_social, n.notas, n.monto_estimado, to_jsonb(n)->>'oferta_monto' AS oferta_monto,
             ${hayDecisiones
               ? sql`(SELECT d.monto FROM crm_negocio_decisiones d WHERE d.negocio_id = n.id AND d.decision = 'aprobado' ORDER BY d.decidido_at DESC, d.id DESC LIMIT 1)`
               : sql`NULL::numeric`} AS aprobado,
             to_char(COALESCE(
               (SELECT max(h.ocurrido_at) FROM crm_negocio_etapas h WHERE h.negocio_id = n.id AND h.a = 'dispersado'), n.etapa_desde
             ) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS dispersado_el
      FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
      WHERE n.ambiente = ${amb} AND n.etapa = 'dispersado' AND n.credit_id IS NULL AND to_jsonb(n)->>'credito_historico_id' IS NULL
    `,
    creditosLibres(),
    sinCredito(),
  ]);
  const renglones: RenglonPorLigar[] = negocios
    .filter((n) => !fuera.has(n.id as string))
    .map((n) => {
      const empresaId = n.empresa_id as string;
      const dispersadoEl = n.dispersado_el as string;
      const monto = numero(n.aprobado) ?? numero(n.oferta_monto) ?? numero(n.monto_estimado);
      const nombres = nombresDelNegocio(n.empresa as string, n.razon_social as string | null, n.notas as string | null);
      const hubspot = nombreEnHubspot(n.notas as string | null);
      return {
        id: n.id as string,
        empresa: n.empresa as string,
        nombreHubspot: hubspot && hubspot !== n.empresa ? hubspot : null,
        monto,
        dispersadoEl,
        // Igual que la ficha: sugerirCreditos decide por fecha y, lejos de ella, por nombre.
        sugerencias: sugerirCreditos({ empresaId, nombres, monto, dispersadoEl }, creditos),
      };
    })
    // Los más recientes primero.
    .sort((a, b) => b.dispersadoEl.localeCompare(a.dispersadoEl) || a.empresa.localeCompare(b.empresa));
  return { renglones, seguras: ligasSeguras(renglones) };
}

/** «No tiene crédito en SIAC»: el negocio deja de salir en Por ligar con SIAC, Inicio y el resumen. */
export async function marcarSinCredito(p: { id: string; actor: string }): Promise<void> {
  const [n] = await sql`
    SELECT etapa, COALESCE(to_jsonb(n)->>'credit_id', to_jsonb(n)->>'credito_historico_id') AS credit_id
    FROM crm_negocios_credito n WHERE id = ${p.id} AND ambiente = ${ambienteActual()}
  `;
  if (!n) throw new NegocioError("Ese negocio no existe.");
  if (n.etapa !== "dispersado") throw new NegocioError("Solo los negocios dispersados se ligan con SIAC.");
  if (n.credit_id) throw new NegocioError("Este negocio ya está ligado a un crédito de SIAC.");
  const ids = await sinCredito();
  if (ids.has(p.id)) return;
  ids.add(p.id);
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES (${CLAVE_SIN_CREDITO}, ${JSON.stringify({ ids: [...ids] })}::text::jsonb,
            'Negocios dispersados que se revisaron en Negocios → Por ligar con SIAC y no tienen crédito en SIAC.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: "negocio_sin_credito_siac", entityType: "negocio", entityId: p.id });
}
