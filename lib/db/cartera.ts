// Datos del Resumen de cartera de Clientes 360. Las cifras de saldo, vencido,
// PAR y cobrado salen de getCollectionsOverview (las mismas que el inicio de
// Cobranza); lo demás, de las tablas crm_* y de los créditos de SIAC.

import { sql } from "@/lib/db";
import { ambienteActual, getCollectionsOverview, getPhotoStatus } from "@/lib/db/collections";
import { getEmpresasLista } from "@/lib/db/empresas";
import { fechaMexico } from "@/lib/collections/rules";
import { getAjustesRenovacion } from "@/lib/db/renovaciones";
import {
  calidadDeDatos,
  coberturaContacto,
  distribucionSalud,
  embudoRenovacion,
  finesDePlazo,
  originacionPorMes,
  porEjecutivo,
  type EmpresaKpi,
} from "@/lib/clientes/cartera-kpis";
import type { EstadoOportunidad } from "@/lib/clientes/renovaciones";

export async function getResumenCartera() {
  const hoy = fechaMexico();
  const ambiente = ambienteActual();
  const status = await getPhotoStatus();
  const [overview, lista, creditos, [primera], [{ hayOportunidades }], tareas, usuarios, ajustes] = await Promise.all([
    status.fechaCorte ? getCollectionsOverview(status.fechaCorte) : Promise.resolve(null),
    getEmpresasLista(status.fechaCorte, { filtro: "todos", q: "", orden: "nombre", yo: "" }),
    sql`
      SELECT cr.en_listado, cr.monto_credito,
             to_char(cr.fecha_termino_contrato, 'YYYY-MM-DD') AS fecha_termino,
             to_char(cr.fecha_ministracion, 'YYYY-MM-DD') AS fecha_ministracion
      FROM col_credits cr WHERE cr.ambiente = ${ambiente}
    `,
    sql`SELECT to_char(min(fecha_corte), 'YYYY-MM-DD') AS fecha FROM col_sync_runs WHERE ambiente = ${ambiente} AND tipo = 'diaria' AND status = 'completado'`,
    sql`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS "hayOportunidades"`,
    // Abiertas y las cerradas en los últimos 30 días (para «hechas a tiempo»).
    sql`
      SELECT t.responsable_email, t.estado, to_char(t.vence_el, 'YYYY-MM-DD') AS vence_el,
             to_char((t.cerrada_at AT TIME ZONE 'America/Mexico_City')::date, 'YYYY-MM-DD') AS cerrada_el
      FROM crm_tareas t JOIN crm_empresas e ON e.id = t.empresa_id
      WHERE e.ambiente = ${ambiente} AND (t.estado = 'abierta' OR t.cerrada_at > now() - interval '31 days')
    `,
    sql`SELECT email, nombre FROM admin_users`,
    getAjustesRenovacion(),
  ]);
  const oportunidades = hayOportunidades
    ? await sql`
        SELECT o.estado, o.monto_referencia, to_char((o.created_at AT TIME ZONE 'America/Mexico_City')::date, 'YYYY-MM-DD') AS abierta_el
        FROM crm_oportunidades o JOIN crm_empresas e ON e.id = o.empresa_id WHERE e.ambiente = ${ambiente}
      `
    : [];

  const empresas: EmpresaKpi[] = lista.items.map((e) => {
    const r = lista.relacion.get(e.empresaId);
    return {
      empresaId: e.empresaId,
      creditosVigentes: e.creditosVigentes,
      enMora: e.enMora,
      rfc: e.rfc,
      ejecutivoEmail: e.ejecutivoEmail,
      ejecutivoNombre: e.ejecutivoNombre,
      tienePrincipal: r?.tienePrincipal ?? false,
      cuentaPago: r?.cuentaPago ?? false,
      whatsappValido: r?.whatsappValido ?? false,
      ultimoContacto: r?.ultimoContacto ?? null,
      salud: e.salud?.nivel ?? null,
    };
  });
  const creditosKpi = creditos.map((c) => ({
    enListado: c.en_listado as boolean,
    montoCredito: c.monto_credito === null ? null : Number(c.monto_credito),
    fechaTermino: (c.fecha_termino as string) ?? null,
    fechaMinistracion: (c.fecha_ministracion as string) ?? null,
  }));
  const activas = empresas.filter((e) => e.creditosVigentes > 0);

  return {
    hoy,
    status,
    overview,
    clientesActivos: activas.length,
    clientesEnMora: activas.filter((e) => e.enMora).length,
    exClientes: lista.items.filter((e) => e.etapa === "ex_cliente").length,
    finesDePlazo: finesDePlazo(creditosKpi, hoy, ajustes.ventanas),
    originacion: originacionPorMes(creditosKpi, (primera?.fecha as string) ?? null, hoy),
    primeraFoto: (primera?.fecha as string) ?? null,
    calidad: calidadDeDatos(empresas),
    salud: distribucionSalud(empresas),
    cobertura: coberturaContacto(empresas, hoy),
    embudo: hayOportunidades
      ? embudoRenovacion(
          oportunidades.map((o) => ({
            estado: o.estado as EstadoOportunidad,
            montoReferencia: o.monto_referencia === null ? null : Number(o.monto_referencia),
            abiertaEl: o.abierta_el as string,
          })),
        )
      : null,
    ejecutivos: porEjecutivo(
      empresas,
      tareas.map((t) => ({ responsableEmail: t.responsable_email ?? null, estado: t.estado, venceEl: t.vence_el, cerradaEl: t.cerrada_el ?? null })),
      new Map(usuarios.map((u) => [u.email as string, u.nombre as string])),
      hoy,
    ),
  };
}
