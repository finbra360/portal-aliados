"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/get-admin-session";
import { requierePermiso } from "@/lib/permisos";
import { codigoDeError } from "@/lib/collections/errors";
import { ORIGENES_NEGOCIO, validarNegocio, validarSolicitud, type OrigenNegocio } from "@/lib/clientes/negocios";
import { NegocioError, cambiarBroker, cambiarEtapa, crearNegocio, editarNegocio, guardarMensajeBroker, guardarSolicitud } from "@/lib/db/negocios";
import { validarAnalisis, validarDecision, validarDocumentos, validarLigaExpediente, validarOferta } from "@/lib/clientes/comite";
import { getProcesoNegocio, guardarAnalisis, guardarExpediente, guardarOferta, registrarDecision } from "@/lib/db/comite";
import { ligarCreditoSiac } from "@/lib/db/siac-liga";
import { marcarSinCredito } from "@/lib/db/por-ligar-siac";
import { importarCreditosHistoricos, type ResultadoHistoricos } from "@/lib/db/siac-historico";
import { validarCreditosHistoricos } from "@/lib/clientes/siac-historico";
import { importarDeHubspot, MAX_BYTES, vistaPreviaHubspot, type ResultadoImportacion, type VistaPrevia } from "@/lib/db/hubspot-import";
import { importarContactos, MAX_BYTES_CONTACTOS, vistaPreviaContactos, type ResultadoContactos, type VistaContactos } from "@/lib/db/hubspot-contactos";
import { PersonaError } from "@/lib/db/personas";
import { marcarRenovacionSinBroker } from "@/lib/db/brokers-sin-asignar";
import { enviarResumenSemanal } from "@/lib/db/resumen-semanal";

export type NegocioResult = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function refrescar() {
  revalidatePath("/backoffice/negocios", "layout");
  revalidatePath("/backoffice/clientes", "layout");
  // El portal del broker muestra sus solicitudes (los negocios con broker).
  revalidatePath("/operaciones", "layout");
}

/** Alta de un negocio (y de su empresa prospecto, si es nueva). Al terminar lleva a la ficha del negocio. */
export async function crearNegocioAction(_prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarNegocio(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  let id: string;
  try {
    id = await crearNegocio({ datos: v.datos, actor: admin.email });
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: crear negocio", e);
    return { ok: false, error: `No pudimos crear el negocio. Intenta de nuevo. (código ${c})` };
  }
  refrescar();
  redirect(`/backoffice/negocios/${id}`);
}

export async function cambiarEtapaAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  try {
    await cambiarEtapa({
      id,
      etapa: texto(fd, "etapa"),
      entrada: { motivo: texto(fd, "motivo"), recontactarEl: texto(fd, "recontactarEl"), motivoRechazo: texto(fd, "motivoRechazo") },
      actor: admin.email,
    });
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: cambiar etapa", e);
    return { ok: false, error: `No pudimos mover el negocio. Intenta de nuevo. (código ${c})` };
  }
  refrescar();
  return { ok: true, mensaje: "Etapa actualizada." };
}

/** Producto, monto, plazo, destino y garantía. */
export async function guardarSolicitudAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarSolicitud(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarSolicitud({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Solicitud guardada." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: guardar solicitud", e);
    return { ok: false, error: `No pudimos guardar la solicitud. Intenta de nuevo. (código ${c})` };
  }
}

/** Origen, responsable y notas. */
export async function editarNegocioAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const notas = texto(fd, "notas").trim() || null;
  if (notas && notas.length > 4000) return { ok: false, error: "Las notas son demasiado largas (máximo 4,000 caracteres)." };
  const origenTexto = texto(fd, "origen").trim();
  if (origenTexto && !(origenTexto in ORIGENES_NEGOCIO)) return { ok: false, error: "El origen no es válido." };
  // El campo de broker solo viene cuando el origen es «Broker»; vacío = sin asignar.
  const brokerTexto = fd.has("brokerId") ? texto(fd, "brokerId").trim() : undefined;
  if (brokerTexto && !/^[A-Za-z0-9_-]{1,40}$/.test(brokerTexto)) return { ok: false, error: "El broker no es válido." };
  try {
    const cambio = await editarNegocio({
      id,
      responsableEmail: texto(fd, "responsableEmail").trim().toLowerCase() || null,
      notas,
      origen: (origenTexto || undefined) as OrigenNegocio | undefined,
      brokerId: brokerTexto === undefined ? undefined : brokerTexto || null,
      actor: admin.email,
    });
    refrescar();
    return { ok: true, mensaje: cambio ? "Cambios guardados." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: editar negocio", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}

/** Cambia o quita el broker del negocio. */
export async function cambiarBrokerAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  try {
    const cambio = await cambiarBroker({ id, brokerId: texto(fd, "brokerId").trim() || null, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Broker actualizado." : "No había cambios." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: cambiar broker", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}

/**
 * «Brokers sin asignar»: asigna el broker a uno o varios negocios (el renglón
 * o «Asignar las sugeridas»). Cada uno se guarda por separado; si alguno
 * falla, los demás quedan.
 */
export async function asignarBrokersAction(pares: { id: string; brokerId: string }[]): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const validos =
    Array.isArray(pares) &&
    pares.length > 0 &&
    pares.length <= 500 &&
    pares.every((p) => typeof p?.id === "string" && /^[0-9a-f-]{36}$/i.test(p.id) && typeof p.brokerId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(p.brokerId));
  if (!validos) return { ok: false, error: "La selección no es válida." };
  let asignados = 0;
  const errores: string[] = [];
  for (const p of pares) {
    try {
      if (await cambiarBroker({ id: p.id, brokerId: p.brokerId, actor: admin.email })) asignados++;
    } catch (e) {
      if (e instanceof NegocioError) errores.push(e.message);
      else errores.push(`No pudimos guardar uno. (código ${codigoDeError("originación: asignar brokers", e)})`);
    }
  }
  if (asignados > 0) refrescar();
  if (errores.length > 0) {
    return { ok: false, error: `${asignados > 0 ? `Se asignaron ${asignados}; ` : ""}${errores.length} no se pudieron: ${[...new Set(errores)].join(" ")}` };
  }
  return { ok: true, mensaje: asignados === 1 ? "Broker asignado." : `Se asignaron ${asignados} brokers.` };
}

/** «No es de broker»: la renovación sale de «Brokers sin asignar». */
export async function renovacionSinBrokerAction(id: string): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "El negocio no es válido." };
  try {
    await marcarRenovacionSinBroker({ id, actor: admin.email });
    revalidatePath("/backoffice/negocios/brokers-sin-asignar");
    return { ok: true, mensaje: "Listo: esa renovación ya no sale aquí." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: renovación sin broker", e);
    return { ok: false, error: `No pudimos guardar. Intenta de nuevo. (código ${c})` };
  }
}

/** Manda ahora el resumen semanal de originación a Slack (aunque ya haya salido esa semana). */
export async function mandarResumenSemanalAction(): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "clientes.configurar");
  try {
    const r = await enviarResumenSemanal({ forzar: true, actor: admin.email });
    return r.enviado ? { ok: true, mensaje: "Listo: el resumen ya está en el canal de onboarding." } : { ok: false, error: r.motivo };
  } catch (e) {
    const c = codigoDeError("originación: resumen semanal", e);
    return { ok: false, error: `No se pudo mandar a Slack. Intenta de nuevo. (código ${c})` };
  }
}

/** Mensaje que el broker ve en su portal. */
export async function guardarMensajeBrokerAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const mensaje = texto(fd, "mensajeBroker").trim() || null;
  if (mensaje && mensaje.length > 1000) return { ok: false, error: "El mensaje es demasiado largo (máximo 1,000 caracteres)." };
  try {
    await guardarMensajeBroker({ id, mensaje, actor: admin.email });
    refrescar();
    revalidatePath("/operaciones", "layout");
    return { ok: true, mensaje: mensaje ? "Mensaje guardado: el broker ya lo ve en su portal." : "Mensaje borrado." };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: mensaje al broker", e);
    return { ok: false, error: `No pudimos guardar el mensaje. Intenta de nuevo. (código ${c})` };
  }
}

// ---------------------------------------------------------------- análisis, oferta, expediente y comité (fase O5)

function errorDe(e: unknown, donde: string, que: string): NegocioResult {
  if (e instanceof NegocioError) return { ok: false, error: e.message };
  const c = codigoDeError(`originación: ${donde}`, e);
  return { ok: false, error: `No pudimos guardar ${que}. Intenta de nuevo. (código ${c})` };
}

/** Resultado de buró, capacidad de pago y notas. Solo quien analiza crédito. */
export async function guardarAnalisisAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.analizar");
  const v = validarAnalisis(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarAnalisis({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Análisis guardado." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar análisis", "el análisis");
  }
}

/** Monto, tasa, plazo, comisión por apertura y respuesta del cliente. */
export async function guardarOfertaAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const v = validarOferta(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const cambio = await guardarOferta({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: cambio ? "Oferta guardada." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar oferta", "la oferta");
  }
}

/** Liga a la carpeta y estado de cada documento de la lista del producto. */
export async function guardarExpedienteAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const entrada = Object.fromEntries(fd.entries());
  const liga = validarLigaExpediente(entrada.expedienteUrl);
  if (!liga.ok) return { ok: false, error: liga.error };
  try {
    const proceso = await getProcesoNegocio(id);
    if (!proceso) return { ok: false, error: "Falta correr crm-schema.sql para capturar el expediente." };
    const docs = validarDocumentos(
      proceso.documentos.map((d) => d.nombre),
      entrada,
    );
    if (!docs.ok) return { ok: false, error: docs.error };
    const n = await guardarExpediente({ id, url: liga.datos, documentos: docs.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: n ? "Expediente guardado." : "No había cambios." };
  } catch (e) {
    return errorDe(e, "guardar expediente", "el expediente");
  }
}

/** Decisión del comité. Solo quien decide en comité. */
export async function registrarDecisionAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.decidir");
  const v = validarDecision(Object.fromEntries(fd.entries()));
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const a = await registrarDecision({ id, datos: v.datos, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: a === "formalizacion" ? "Aprobado: el negocio pasó a Formalización." : "Rechazado en comité: el negocio quedó cerrado." };
  } catch (e) {
    return errorDe(e, "decisión de comité", "la decisión");
  }
}

// ---------------------------------------------------------------- crédito de SIAC (fase O6)

/** Liga el negocio dispersado con su crédito de SIAC (una sugerencia o un número de crédito). */
export async function ligarCreditoSiacAction(id: string, _prev: NegocioResult | null, fd: FormData): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const creditId = texto(fd, "creditId").trim();
  const historicoId = texto(fd, "historicoId").trim();
  const noCredito = texto(fd, "noCredito").trim();
  const id36 = /^[0-9a-f-]{36}$/i;
  if ((creditId && !id36.test(creditId)) || (historicoId && !id36.test(historicoId))) return { ok: false, error: "Ese crédito no es válido. Recarga la página." };
  if (!creditId && !historicoId && !noCredito) return { ok: false, error: "Escribe el número de crédito de SIAC." };
  if (noCredito.length > 40) return { ok: false, error: "El número de crédito es demasiado largo." };
  try {
    const r = await ligarCreditoSiac({
      negocioId: id,
      ...(creditId ? { creditId } : historicoId ? { historicoId } : { noCredito }),
      actor: admin.email,
    });
    refrescar();
    return {
      ok: true,
      mensaje:
        r.accion === "juntar"
          ? `Ligado al crédito ${r.noCredito}. La empresa que había creado SIAC se juntó con esta.`
          : `Ligado al crédito ${r.noCredito}.`,
    };
  } catch (e) {
    return errorDe(e, "ligar con SIAC", "la liga con SIAC");
  }
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * «Por ligar con SIAC»: liga uno o varios negocios con el crédito elegido (el
 * renglón o «Ligar los seguros»). Cada uno se guarda por separado; si alguno
 * falla, los demás quedan.
 */
export async function ligarSiacEnLoteAction(pares: { id: string; creditId: string; historico?: boolean }[]): Promise<NegocioResult & { ligados?: string[] }> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  const validos =
    Array.isArray(pares) &&
    pares.length > 0 &&
    pares.length <= 500 &&
    pares.every(
      (p) => typeof p?.id === "string" && UUID.test(p.id) && typeof p.creditId === "string" && UUID.test(p.creditId) && (p.historico === undefined || typeof p.historico === "boolean"),
    );
  if (!validos) return { ok: false, error: "La selección no es válida." };
  const ligados: string[] = [];
  let juntadas = 0;
  const errores: string[] = [];
  for (const p of pares) {
    try {
      const r = await ligarCreditoSiac({ negocioId: p.id, ...(p.historico ? { historicoId: p.creditId } : { creditId: p.creditId }), actor: admin.email });
      ligados.push(p.id);
      if (r.accion === "juntar") juntadas++;
    } catch (e) {
      if (e instanceof NegocioError) errores.push(e.message);
      else errores.push(`No pudimos ligar uno. (código ${codigoDeError("originación: ligar con SIAC en lote", e)})`);
    }
  }
  if (ligados.length > 0) refrescar();
  const juntas = juntadas === 0 ? "" : juntadas === 1 ? " Una empresa que había creado SIAC se juntó con la del negocio." : ` ${juntadas} empresas que había creado SIAC se juntaron con las de sus negocios.`;
  if (errores.length > 0) {
    return { ok: false, ligados, error: `${ligados.length > 0 ? `Se ligaron ${ligados.length};${juntas} ` : ""}${errores.length} no se pudieron: ${[...new Set(errores)].join(" ")}` };
  }
  return { ok: true, ligados, mensaje: `${ligados.length === 1 ? "Negocio ligado a su crédito." : `Se ligaron ${ligados.length} negocios a su crédito.`}${juntas}` };
}

/** Sube los créditos del Excel «Estado de Clientes» de SIAC (ya leído en el navegador). */
export async function importarHistoricosAction(creditos: unknown): Promise<{ ok: true; r: ResultadoHistoricos } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "originacion.importar");
  const v = validarCreditosHistoricos(creditos);
  if (!v.ok) return v;
  try {
    const r = await importarCreditosHistoricos({ creditos: v.creditos, actor: admin.email });
    refrescar();
    return { ok: true, r };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: créditos históricos", e);
    return { ok: false, error: `No pudimos guardar los créditos. Intenta de nuevo. (código ${c})` };
  }
}

/** «No tiene crédito en SIAC»: el negocio sale de Por ligar con SIAC, de Inicio y del resumen. */
export async function sinCreditoSiacAction(id: string): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "El negocio no es válido." };
  try {
    await marcarSinCredito({ id, actor: admin.email });
    refrescar();
    return { ok: true, mensaje: "Listo: ese negocio ya no se pide ligar." };
  } catch (e) {
    return errorDe(e, "sin crédito en SIAC", "el cambio");
  }
}

// ---------------------------------------------------------------- importar de HubSpot (fase O7)

/** Vista previa del export de HubSpot (no escribe nada). */
export async function vistaPreviaHubspotAction(texto: string): Promise<VistaPrevia> {
  requierePermiso(await getAdminSession(), "originacion.importar");
  if (typeof texto !== "string" || !texto.trim()) return { ok: false, error: "Elige el archivo CSV que exportaste de HubSpot." };
  if (texto.length > MAX_BYTES) return { ok: false, error: "El archivo es demasiado grande. Exporta solo los negocios (sin actividades ni notas)." };
  try {
    return await vistaPreviaHubspot(texto);
  } catch (e) {
    const c = codigoDeError("originación: vista previa de HubSpot", e);
    return { ok: false, error: `No pudimos leer el archivo. Intenta de nuevo. (código ${c})` };
  }
}

/** Importa los negocios elegidos del export de HubSpot. */
export async function importarHubspotAction(texto: string, ids: string[]): Promise<{ ok: true; r: ResultadoImportacion } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "originacion.importar");
  if (typeof texto !== "string" || texto.length > MAX_BYTES) return { ok: false, error: "El archivo es demasiado grande." };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Marca al menos un negocio." };
  if (ids.length > 1000 || ids.some((x) => typeof x !== "string" || !/^\d{1,20}$/.test(x))) return { ok: false, error: "La selección no es válida. Vuelve a subir el archivo." };
  try {
    const r = await importarDeHubspot({ texto, ids, actor: admin.email });
    refrescar();
    return { ok: true, r };
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: importar de HubSpot", e);
    return { ok: false, error: `La importación se detuvo. Los negocios que alcanzaron a entrar ya están; vuelve a subir el archivo para seguir (no se duplican). (código ${c})` };
  }
}

/** Mover un negocio desde el tablero (arrastrando su tarjeta). Mismas reglas que en la ficha. */
export async function moverNegocioAction(id: string, etapa: string, motivo: string): Promise<NegocioResult> {
  const admin = requierePermiso(await getAdminSession(), "originacion.operar");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Ese negocio no es válido. Recarga la página." };
  try {
    await cambiarEtapa({ id, etapa, entrada: { motivo: (motivo ?? "").slice(0, 1000) }, actor: admin.email });
  } catch (e) {
    if (e instanceof NegocioError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: mover desde el tablero", e);
    return { ok: false, error: `No pudimos mover el negocio. Intenta de nuevo. (código ${c})` };
  }
  refrescar();
  return { ok: true, mensaje: "Etapa actualizada." };
}

// ---------------------------------------------------------------- contactos de HubSpot

/** Vista previa del export de contactos de HubSpot (no escribe nada). */
export async function vistaPreviaContactosAction(texto: string): Promise<VistaContactos> {
  requierePermiso(await getAdminSession(), "originacion.importar");
  if (typeof texto !== "string" || !texto.trim()) return { ok: false, error: "Elige el archivo CSV de contactos que exportaste de HubSpot." };
  if (texto.length > MAX_BYTES_CONTACTOS) return { ok: false, error: "El archivo es demasiado grande. Exporta solo los contactos, sin actividades." };
  try {
    return await vistaPreviaContactos(texto);
  } catch (e) {
    const c = codigoDeError("originación: vista previa de contactos", e);
    return { ok: false, error: `No pudimos leer el archivo. Intenta de nuevo. (código ${c})` };
  }
}

/** Importa los contactos elegidos del export de HubSpot. */
export async function importarContactosAction(texto: string, ids: string[]): Promise<{ ok: true; r: ResultadoContactos } | { ok: false; error: string }> {
  const admin = requierePermiso(await getAdminSession(), "originacion.importar");
  if (typeof texto !== "string" || texto.length > MAX_BYTES_CONTACTOS) return { ok: false, error: "El archivo es demasiado grande." };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Marca al menos un contacto." };
  if (ids.length > 1000 || ids.some((x) => typeof x !== "string" || !/^\d{1,20}$/.test(x))) return { ok: false, error: "La selección no es válida. Vuelve a subir el archivo." };
  try {
    const r = await importarContactos({ texto, ids, actor: admin.email });
    revalidatePath("/backoffice/clientes", "layout");
    return { ok: true, r };
  } catch (e) {
    if (e instanceof PersonaError) return { ok: false, error: e.message };
    const c = codigoDeError("originación: importar contactos", e);
    return { ok: false, error: `La importación se detuvo. Los contactos que alcanzaron a entrar ya están; vuelve a subir el archivo para seguir (no se duplican). (código ${c})` };
  }
}
