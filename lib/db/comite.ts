// Análisis, oferta, expediente y comité de un negocio (fase O5): lectura para
// la ficha y guardado. Las reglas están en lib/clientes/comite.ts; lo que pide
// cada etapa, en faltantesPara (lib/clientes/negocios.ts). Antes de correr
// crm-schema.sql no hay columnas ni tablas de O5: la ficha no muestra estas
// tarjetas y guardar da un error claro.

import { sql, transaccion } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { cargarProceso, moverEnTx, NegocioError, tieneProceso } from "@/lib/db/negocios";
import {
  claveDocumento,
  documentosDelNegocio,
  listasDesdeAjuste,
  type DatosAnalisis,
  type DatosDecision,
  type DatosOferta,
  type DecisionComite,
  type DocumentoExpediente,
  type EstadoDocumento,
  type ListasDocumentos,
  type RespuestaOferta,
  type ResultadoBuro,
} from "@/lib/clientes/comite";
import type { DatosProceso, Producto } from "@/lib/clientes/negocios";

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export interface Decision {
  decision: DecisionComite;
  monto: number | null;
  tasaAnual: number | null;
  plazoMeses: number | null;
  condiciones: string | null;
  decididoPor: string;
  decididoNombre: string | null;
  decididoAt: string;
}

export interface ProcesoNegocio {
  analisis: DatosAnalisis & { analizadoPor: string | null; analizadoNombre: string | null; analizadoAt: string | null };
  oferta: DatosOferta;
  expedienteUrl: string | null;
  /** Lista del producto con su estado; vacía si el negocio todavía no tiene producto. */
  documentos: (DocumentoExpediente & { actualizadoNombre: string | null })[];
  /** De la más reciente a la más vieja. */
  decisiones: Decision[];
  /** Para faltantesPara. */
  requisitos: DatosProceso;
}

/** Listas de documentos por producto (crm_settings «expediente», o las de siempre). */
export async function getListasDocumentos(): Promise<ListasDocumentos> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = 'expediente'`;
  return listasDesdeAjuste(r?.value);
}

/** Todo lo de O5 de un negocio; null si la base todavía no tiene sus columnas. */
export async function getProcesoNegocio(id: string): Promise<ProcesoNegocio | null> {
  const [n] = await sql`SELECT to_jsonb(n) AS j FROM crm_negocios_credito n WHERE n.id = ${id} AND n.ambiente = ${ambienteActual()}`;
  const j = (n?.j ?? null) as Record<string, unknown> | null;
  if (!j || !tieneProceso(j)) return null;
  const [listas, marcados, decisiones, [analista], requisitos] = await Promise.all([
    getListasDocumentos(),
    sql`
      SELECT d.clave, d.estado, d.actualizado_por, d.actualizado_at, u.nombre
      FROM crm_negocio_documentos d LEFT JOIN admin_users u ON u.email = d.actualizado_por
      WHERE d.negocio_id = ${id}
    `,
    sql`
      SELECT d.*, u.nombre FROM crm_negocio_decisiones d LEFT JOIN admin_users u ON u.email = d.decidido_por
      WHERE d.negocio_id = ${id} ORDER BY d.decidido_at DESC, d.id DESC
    `,
    j.analizado_por ? sql`SELECT nombre FROM admin_users WHERE email = ${j.analizado_por as string}` : Promise.resolve([]),
    cargarProceso(sql, id, j),
  ]);
  const producto = j.producto as Producto | null;
  const nombres = new Map(marcados.map((m) => [m.clave as string, (m.nombre as string) ?? null]));
  const docs = documentosDelNegocio(
    producto ? listas[producto] : [],
    marcados.map((m) => ({
      clave: m.clave as string,
      estado: m.estado as EstadoDocumento,
      actualizadoPor: (m.actualizado_por as string) ?? null,
      actualizadoAt: iso(m.actualizado_at),
    })),
  );
  return {
    analisis: {
      buroResultado: (j.buro_resultado as ResultadoBuro) ?? null,
      capacidadPagoMensual: numero(j.capacidad_pago_mensual),
      notas: (j.analisis_notas as string) ?? null,
      analizadoPor: (j.analizado_por as string) ?? null,
      analizadoNombre: (analista?.nombre as string) ?? null,
      analizadoAt: iso(j.analizado_at),
    },
    oferta: {
      monto: numero(j.oferta_monto),
      tasaAnual: numero(j.oferta_tasa_anual),
      plazoMeses: numero(j.oferta_plazo_meses),
      comisionAperturaPct: numero(j.comision_apertura_pct),
      respuesta: (j.oferta_respuesta as RespuestaOferta) ?? null,
    },
    expedienteUrl: (j.expediente_url as string) ?? null,
    documentos: docs.map((d) => ({ ...d, actualizadoNombre: nombres.get(d.clave) ?? null })),
    decisiones: decisiones.map((d) => ({
      decision: d.decision as DecisionComite,
      monto: numero(d.monto),
      tasaAnual: numero(d.tasa_anual),
      plazoMeses: numero(d.plazo_meses),
      condiciones: (d.condiciones as string) ?? null,
      decididoPor: d.decidido_por as string,
      decididoNombre: (d.nombre as string) ?? null,
      decididoAt: (d.decidido_at as Date).toISOString(),
    })),
    requisitos: requisitos!,
  };
}

/** El negocio con sus columnas de O5, para guardar. Error claro si falta el SQL o ya está dispersado. */
async function negocioParaGuardar(id: string) {
  const [n] = await sql`SELECT etapa, to_jsonb(n) AS j FROM crm_negocios_credito n WHERE n.id = ${id} AND n.ambiente = ${ambienteActual()}`;
  if (!n) throw new NegocioError("Ese negocio no existe.");
  const j = n.j as Record<string, unknown>;
  if (!tieneProceso(j)) throw new NegocioError("Falta correr crm-schema.sql para capturar el análisis, la oferta y el comité.");
  if (n.etapa === "dispersado") throw new NegocioError("El negocio ya está dispersado; ya no cambia.");
  return { etapa: n.etapa as string, j };
}

/** Lo que cambió entre lo guardado y lo nuevo, para la auditoría. */
function cambiosDe(pares: [string, unknown, unknown][]) {
  return Object.fromEntries(pares.filter(([, a, b]) => a !== b).map(([k, a, b]) => [k, { antes: a, despues: b }]));
}

/** Resultado de buró, capacidad de pago y notas del análisis. Regresa si cambió algo. */
export async function guardarAnalisis(p: { id: string; datos: DatosAnalisis; actor: string }): Promise<boolean> {
  const { j } = await negocioParaGuardar(p.id);
  const d = p.datos;
  const cambios = cambiosDe([
    ["buro_resultado", j.buro_resultado ?? null, d.buroResultado],
    ["capacidad_pago_mensual", numero(j.capacidad_pago_mensual), d.capacidadPagoMensual],
    ["analisis_notas", j.analisis_notas ?? null, d.notas],
  ]);
  if (Object.keys(cambios).length === 0) return false;
  await sql`
    UPDATE crm_negocios_credito
    SET buro_resultado = ${d.buroResultado}, capacidad_pago_mensual = ${d.capacidadPagoMensual}, analisis_notas = ${d.notas},
        analizado_por = ${p.actor}, analizado_at = now(), updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  // Las notas pueden traer datos del buró: en la auditoría solo va que cambiaron.
  if (cambios.analisis_notas) cambios.analisis_notas = { antes: "…", despues: "…" };
  await logAudit({ actorEmail: p.actor, action: "analisis_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return true;
}

/** Monto, tasa, plazo, comisión por apertura y respuesta del cliente. Regresa si cambió algo. */
export async function guardarOferta(p: { id: string; datos: DatosOferta; actor: string }): Promise<boolean> {
  const { j } = await negocioParaGuardar(p.id);
  const d = p.datos;
  const cambios = cambiosDe([
    ["oferta_monto", numero(j.oferta_monto), d.monto],
    ["oferta_tasa_anual", numero(j.oferta_tasa_anual), d.tasaAnual],
    ["oferta_plazo_meses", numero(j.oferta_plazo_meses), d.plazoMeses],
    ["comision_apertura_pct", numero(j.comision_apertura_pct), d.comisionAperturaPct],
    ["oferta_respuesta", j.oferta_respuesta ?? null, d.respuesta],
  ]);
  if (Object.keys(cambios).length === 0) return false;
  if (cambios.comision_apertura_pct && j.colocacion_id) {
    throw new NegocioError("La colocación del broker ya está registrada: cambia su comisión en Brokers.");
  }
  await sql`
    UPDATE crm_negocios_credito
    SET oferta_monto = ${d.monto}, oferta_tasa_anual = ${d.tasaAnual}, oferta_plazo_meses = ${d.plazoMeses},
        comision_apertura_pct = ${d.comisionAperturaPct}, oferta_respuesta = ${d.respuesta}, updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "oferta_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return true;
}

/**
 * Liga a la carpeta y estado de los documentos (ya validados contra la lista
 * del producto). Solo escribe los que cambiaron. Regresa cuántas cosas cambiaron.
 */
export async function guardarExpediente(p: {
  id: string;
  url: string | null;
  documentos: { clave: string; nombre: string; estado: EstadoDocumento }[];
  actor: string;
}): Promise<number> {
  const { j } = await negocioParaGuardar(p.id);
  // La auditoría va después del COMMIT: logAudit usa otra conexión y, con la
  // transacción abierta, podría quedarse esperando una conexión libre.
  const { n, cambios } = await transaccion(async (tx) => {
    let n = 0;
    const cambios: Record<string, unknown> = {};
    if ((j.expediente_url ?? null) !== p.url) {
      await tx`UPDATE crm_negocios_credito SET expediente_url = ${p.url}, updated_by = ${p.actor}, updated_at = now() WHERE id = ${p.id}`;
      cambios.expediente_url = { antes: j.expediente_url ?? null, despues: p.url };
      n++;
    }
    const antes = new Map((await tx`SELECT clave, estado FROM crm_negocio_documentos WHERE negocio_id = ${p.id}`).map((r) => [r.clave as string, r.estado as string]));
    const docs: Record<string, { antes: string; despues: string }> = {};
    for (const d of p.documentos) {
      const previo = antes.get(d.clave) ?? "pendiente";
      if (previo === d.estado) continue;
      await tx`
        INSERT INTO crm_negocio_documentos (negocio_id, clave, nombre, estado, actualizado_por, actualizado_at)
        VALUES (${p.id}, ${d.clave}, ${d.nombre}, ${d.estado}, ${p.actor}, now())
        ON CONFLICT (negocio_id, clave) DO UPDATE SET nombre = EXCLUDED.nombre, estado = EXCLUDED.estado, actualizado_por = EXCLUDED.actualizado_por, actualizado_at = now()
      `;
      docs[d.clave] = { antes: previo, despues: d.estado };
      n++;
    }
    if (Object.keys(docs).length) cambios.documentos = docs;
    return { n, cambios };
  });
  if (n > 0) await logAudit({ actorEmail: p.actor, action: "expediente_negocio", entityType: "negocio", entityId: p.id, metadata: { cambios } });
  return n;
}

/**
 * Registra la decisión del comité. Solo con el negocio en Comité. Aprobado lo
 * pasa a Formalización; rechazado lo cierra como «Rechazado en comité». Si el
 * cambio de etapa no procede (le falta algo), no se guarda nada.
 */
export async function registrarDecision(p: { id: string; datos: DatosDecision; actor: string }): Promise<"formalizacion" | "rechazado"> {
  const d = p.datos;
  const r = await transaccion(async (tx) => {
    const [n] = await tx`SELECT etapa, to_jsonb(n) AS j FROM crm_negocios_credito n WHERE n.id = ${p.id} AND n.ambiente = ${ambienteActual()} FOR UPDATE`;
    if (!n) throw new NegocioError("Ese negocio no existe.");
    if (!tieneProceso(n.j as Record<string, unknown>)) throw new NegocioError("Falta correr crm-schema.sql para registrar la decisión del comité.");
    if (n.etapa !== "comite") throw new NegocioError("La decisión se registra con el negocio en Comité.");
    const [dec] = await tx`
      INSERT INTO crm_negocio_decisiones (negocio_id, decision, monto, tasa_anual, plazo_meses, condiciones, decidido_por)
      VALUES (${p.id}, ${d.decision}, ${d.monto}, ${d.tasaAnual}, ${d.plazoMeses}, ${d.condiciones}, ${p.actor})
      RETURNING id
    `;
    const fmt = (x: number) => x.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
    const movimiento =
      d.decision === "aprobado"
        ? await moverEnTx(tx, {
            id: p.id,
            etapa: "formalizacion",
            entrada: { motivo: `Aprobado en comité: ${fmt(d.monto!)} a ${d.plazoMeses} meses, tasa ${d.tasaAnual} %${d.condiciones ? `. Condiciones: ${d.condiciones}` : ""}`.slice(0, 1000) },
            actor: p.actor,
          })
        : await moverEnTx(tx, { id: p.id, etapa: "rechazado", entrada: { motivoRechazo: "comite", motivo: (d.condiciones ?? "").slice(0, 900) }, actor: p.actor, porComite: true });
    return { decisionId: String(dec.id), movimiento };
  });
  await logAudit({
    actorEmail: p.actor,
    action: "decision_comite",
    entityType: "negocio",
    entityId: p.id,
    metadata: { decisionId: r.decisionId, decision: d.decision, monto: d.monto, tasaAnual: d.tasaAnual, plazoMeses: d.plazoMeses, ...r.movimiento },
  });
  return r.movimiento.a as "formalizacion" | "rechazado";
}

/** Guarda las listas de documentos por producto (Clientes → Ajustes). Regresa si cambió algo. */
export async function guardarListasDocumentos(p: { listas: ListasDocumentos; actor: string }): Promise<boolean> {
  const antes = await getListasDocumentos();
  const cambios: Record<string, { agregados: string[]; quitados: string[] }> = {};
  for (const prod of Object.keys(p.listas) as Producto[]) {
    const a = new Set(antes[prod].map(claveDocumento));
    const b = new Set(p.listas[prod].map(claveDocumento));
    const agregados = p.listas[prod].filter((x) => !a.has(claveDocumento(x)));
    const quitados = antes[prod].filter((x) => !b.has(claveDocumento(x)));
    const mismoOrden = antes[prod].join("\n") === p.listas[prod].join("\n");
    if (agregados.length || quitados.length || !mismoOrden) cambios[prod] = { agregados, quitados };
  }
  if (Object.keys(cambios).length === 0) return false;
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('expediente', ${JSON.stringify(p.listas)}::text::jsonb,
            'Documentos del expediente por producto (lib/clientes/comite.ts). Se editan en Clientes → Ajustes.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: "ajustes_clientes", entityType: "crm_settings", entityId: "expediente", metadata: { cambios } });
  return true;
}

