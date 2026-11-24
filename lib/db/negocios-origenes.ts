// Crear un negocio desde donde nacen los prospectos (fase O3): un lead del
// motor de prospección, un prospecto de Credit Health o una oportunidad del
// radar de renovación. Cada negocio guarda su origen (origen_ref), así que
// pedirlo dos veces regresa el mismo negocio.

import { sql } from "@/lib/db";
import type { AdminSessionPayload } from "@/lib/admin-auth";
import { updateLeadEstatusComercial } from "@/lib/db/leads";
import { crearNegocio, hayNegocios, NegocioError } from "@/lib/db/negocios";
import { leerTelefono, negocioDesdeCreditHealth, negocioDesdeLead, type DatosContacto } from "@/lib/clientes/negocios";
import { validarRfc } from "@/lib/clientes/rfc";
import { cambiarEstadoContacto, obtenerProspecto, revelarContacto } from "@/lib/credit-health/prospectos";
import { CLASIFICACION_LABELS, DESTINO_LABELS } from "@/lib/credit-health/catalogo";

export const refLead = (id: string) => `lead:${id}`;
export const refCreditHealth = (id: string) => `credit_health:${id}`;
export const refOportunidad = (id: string) => `oportunidad:${id}`;

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Negocio ya creado para cada origen (ref → id del negocio). */
export async function negociosPorOrigen(refs: string[]): Promise<Map<string, string>> {
  if (!refs.length || !(await hayNegocios())) return new Map();
  const [c] = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_negocios_credito' AND column_name = 'origen_ref'`;
  if (!c) return new Map();
  const rows = await sql`SELECT origen_ref, id FROM crm_negocios_credito WHERE origen_ref = ANY(${refs})`;
  return new Map(rows.map((r) => [r.origen_ref as string, r.id as string]));
}

/** Persona de contacto a partir de nombre, teléfono y correo sueltos; null si no hay con qué. */
function contacto(nombre: string | null, puesto: string | null, telefono: string | null, correo: string | null, empresa: string): DatosContacto | null {
  const tel = leerTelefono(telefono ?? "");
  const mail = (correo ?? "").trim().toLowerCase();
  const t = tel === "invalido" ? null : tel;
  const m = CORREO.test(mail) ? mail : null;
  const n = (nombre ?? "").trim();
  if (!n && !t && !m) return null;
  return { nombre: (n || `Contacto de ${empresa}`).slice(0, 150), puesto: (puesto ?? "").trim().slice(0, 120) || null, telefono: t, correo: m };
}

/**
 * Negocio desde un lead: crea la empresa prospecto (o reusa la que tenga el
 * mismo nombre), con el decisor principal como contacto, y deja el lead como
 * «oportunidad».
 */
export async function crearNegocioDesdeLead(leadId: string, actor: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new NegocioError("Ese lead no es válido.");
  const [l] = await sql`SELECT * FROM lead_companies WHERE id = ${leadId}`;
  if (!l) throw new NegocioError("Ese lead no existe.");
  const [k] = await sql`
    SELECT nombre, cargo, email, telefono FROM lead_contacts
    WHERE company_id = ${leadId} AND estatus = 'activo'
    ORDER BY es_decisor_principal DESC, confidence DESC NULLS LAST, created_at LIMIT 1
  `;
  const nombre = (l.nombre_comercial as string).trim().slice(0, 200);
  const { solicitud, notas } = negocioDesdeLead({
    empleadosEstimado: l.empleados_estimado != null ? Number(l.empleados_estimado) : null,
    ventasEstimadoMxn: l.ventas_estimado_mxn != null ? Number(l.ventas_estimado_mxn) : null,
    antiguedadAnios: l.antiguedad_anios_estimado != null ? Number(l.antiguedad_anios_estimado) : null,
    tieneGarantiaVehicular: !!l.tiene_garantia_vehicular,
    tieneGarantiaInmobiliaria: !!l.tiene_garantia_inmobiliaria,
    totalScore: l.total_score != null ? Number(l.total_score) : null,
    categoria: (l.categoria as string) ?? null,
  });
  const id = await crearNegocio({
    datos: {
      empresa: { nueva: { nombre, razonSocial: ((l.razon_social as string) ?? "").trim() || null, rfc: null } },
      contacto: contacto(k?.nombre ?? null, k?.cargo ?? null, k?.telefono ?? l.telefono_principal ?? null, k?.email ?? l.correo_corporativo ?? null, nombre),
      tipo: "nuevo",
      origen: "leads",
      montoEstimado: null,
      responsableEmail: null,
      notas,
      brokerId: null,
    },
    solicitud,
    origenRef: refLead(leadId),
    reusarEmpresa: true,
    actor,
  });
  if (!["oportunidad", "cliente"].includes(l.estatus_comercial as string)) {
    await updateLeadEstatusComercial({ id: leadId, estatus: "oportunidad", actorEmail: actor });
  }
  return id;
}

/**
 * Negocio desde un prospecto de Credit Health. Solo si el prospecto aceptó
 * compartir sus datos con Finbra (consentimiento share_with_finbra). Lee su
 * contacto y RFC (queda auditado en Credit Health), reusa la empresa si ya
 * existe ese RFC y deja el prospecto como «convertido».
 */
export async function crearNegocioDesdeCreditHealth(chId: string, admin: AdminSessionPayload): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(chId)) throw new NegocioError("Ese prospecto no es válido.");
  const [ya] = (await negociosPorOrigen([refCreditHealth(chId)])).values();
  if (ya) return ya;
  const r = await obtenerProspecto(chId);
  if (!r) throw new NegocioError("Ese prospecto no existe.");
  const { prospecto: p, consentimientos } = r;
  if (p.isDemo) throw new NegocioError("Es un prospecto de demostración; no se crean negocios con él.");
  const compartir = [...consentimientos].reverse().find((c) => c.tipo === "share_with_finbra");
  if (!compartir?.otorgado) throw new NegocioError("El prospecto no aceptó compartir sus datos con Finbra; no se puede crear el negocio.");

  const c = await revelarContacto(p, admin);
  const rfc = validarRfc(c.rfc);
  const nombre = (p.tradeName ?? "").trim() || `Prospecto ${p.folio}`;
  const { solicitud, notas } = negocioDesdeCreditHealth({
    folio: p.folio,
    requestedAmount: p.requestedAmount,
    termMonths: p.termMonths,
    purpose: p.purpose,
    purposeLabel: p.purpose ? (DESTINO_LABELS[p.purpose] ?? null) : null,
    collateralType: p.collateralType,
    clasificacion: CLASIFICACION_LABELS[p.classification] ?? null,
    preliminaryAmount: p.preliminaryAmount,
    dscrProjected: p.dscrProjected,
  });
  const id = await crearNegocio({
    datos: {
      empresa: { nueva: { nombre: nombre.slice(0, 200), razonSocial: null, rfc: rfc.ok ? rfc.rfc : null } },
      contacto: contacto(c.nombre, p.contactRole, c.telefono, c.correo, nombre),
      tipo: "nuevo",
      origen: "credit_health",
      montoEstimado: null,
      responsableEmail: null,
      notas,
      brokerId: null,
    },
    solicitud,
    origenRef: refCreditHealth(chId),
    reusarEmpresa: true,
    actor: admin.email,
  });
  if (p.contactStatus !== "convertido") await cambiarEstadoContacto(chId, "convertido", "Negocio creado en el backoffice (Originación).", admin);
  return id;
}

/**
 * Negocio de renovación desde una oportunidad del radar (al pasarla a
 * «Interesado»). Lleva el monto de referencia y el responsable de la
 * oportunidad. Si ya existe, no hace nada.
 */
export async function crearNegocioDeRenovacion(oportunidadId: string, actor: string): Promise<string | null> {
  if (!(await hayNegocios())) return null;
  const [o] = await sql`
    SELECT o.empresa_id, o.monto_referencia, to_char(o.fecha_termino, 'YYYY-MM-DD') AS fecha_termino, cr.no_credito,
           CASE WHEN a.activo THEN o.responsable_email END AS responsable_email
    FROM crm_oportunidades o
    LEFT JOIN col_credits cr ON cr.id = o.credit_id
    LEFT JOIN admin_users a ON a.email = o.responsable_email
    WHERE o.id = ${oportunidadId}
  `;
  if (!o) return null;
  const notas = `Viene del radar de renovación${o.no_credito ? `: el crédito ${o.no_credito} termina el ${o.fecha_termino}` : ""}. El monto es el del crédito que termina, como referencia.`;
  return crearNegocio({
    datos: {
      empresa: { id: o.empresa_id as string },
      contacto: null,
      tipo: "renovacion",
      origen: "renovacion",
      montoEstimado: o.monto_referencia === null ? null : Number(o.monto_referencia),
      responsableEmail: (o.responsable_email as string) ?? null,
      notas,
      brokerId: null,
    },
    origenRef: refOportunidad(oportunidadId),
    actor,
  });
}
