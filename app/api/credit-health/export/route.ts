import { getAdminSession } from "@/lib/get-admin-session";
import { hasRole } from "@/lib/rbac";
import { CH_EXPORTAN, CH_VEN_CONTACTO } from "@/lib/credit-health/roles";
import {
  CLASIFICACION_LABELS,
  ELEGIBILIDAD_LABELS,
  ESTADO_CONTACTO_LABELS,
  INTENCION_LABELS,
  origenLabel,
  SECTORES,
  type Clasificacion,
  type EstadoContacto,
} from "@/lib/credit-health/catalogo";
import { descifrar, llaveCreditHealth } from "@/lib/credit-health/cifrado";
import { aCsv } from "@/lib/credit-health/csv";
import { creditHealthConfigurado } from "@/lib/credit-health/db";
import { parseFiltros } from "@/lib/credit-health/filtros";
import { auditarExportacion, prospectosParaExportar } from "@/lib/credit-health/prospectos";

export const runtime = "nodejs";

/** CSV de prospectos con los filtros del listado. Contacto solo con ?contacto=1 y el rol adecuado. */
export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!hasRole(session, CH_EXPORTAN)) return new Response("No autorizado", { status: 403 });
  if (!creditHealthConfigurado()) return new Response("Credit Health no está configurado", { status: 503 });

  const params = new URL(req.url).searchParams;
  const conContacto = params.get("contacto") === "1";
  if (conContacto && !hasRole(session, CH_VEN_CONTACTO)) return new Response("Tu rol no permite exportar datos de contacto", { status: 403 });

  const filas = await prospectosParaExportar(parseFiltros(params));
  const llave = conContacto ? llaveCreditHealth() : "";
  const encabezados = [
    "Folio",
    "Fecha",
    "Empresa",
    "Sector",
    "Estado",
    "Clasificación",
    "Elegibilidad",
    "Score",
    "Monto solicitado",
    "Plazo (meses)",
    "Monto preliminar",
    "Pago máximo sostenible",
    "Flujo disponible",
    "DSCR proyectado",
    "Garantía",
    "Intención",
    "Estado de contacto",
    "Asignado a",
    "Motivos de descarte",
    "Motivos de revisión",
    "Demo",
    "Origen",
    ...(conContacto ? ["Nombre", "Correo", "Teléfono", "Cargo"] : []),
  ];
  const datos = filas.map((l) => [
    l.folio,
    l.created_at,
    l.trade_name,
    (l.sector_code && SECTORES[l.sector_code]) || "",
    l.state,
    CLASIFICACION_LABELS[l.classification as Clasificacion] ?? l.classification,
    ELEGIBILIDAD_LABELS[l.eligibility_status] ?? l.eligibility_status,
    l.score,
    l.requested_amount,
    l.term_months,
    l.preliminary_amount,
    l.max_payment,
    l.cfads,
    l.dscr_projected === null ? "" : Number(l.dscr_projected).toFixed(2),
    l.collateral_type,
    INTENCION_LABELS[l.intent] ?? l.intent,
    ESTADO_CONTACTO_LABELS[l.contact_status as EstadoContacto] ?? l.contact_status,
    l.assigned_to,
    ((l.exclusion_reasons as string[]) ?? []).join(" | "),
    ((l.review_reasons as string[]) ?? []).join(" | "),
    l.is_demo ? "sí" : "no",
    origenLabel(l.source),
    ...(conContacto ? [descifrar(l.contact_name_enc, llave), descifrar(l.contact_email_enc, llave), descifrar(l.contact_phone_enc, llave), l.contact_role] : []),
  ]);

  await auditarExportacion(session, conContacto, filas.length);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  return new Response(aCsv(encabezados, datos), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="credit-health-prospectos-${hoy}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
