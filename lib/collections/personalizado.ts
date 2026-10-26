// Resumen de una respuesta del Listado Cobranza Personalizado de SIAC, para
// revisar su formato antes de usarlo en la foto diaria. No supone la forma
// exacta del JSON: busca los créditos (objetos con NoCredito) a cualquier
// profundidad, porque SIAC solo documentó la respuesta en XML.

export interface ResumenPersonalizado {
  detalle: string | null;
  paginacion: { paginaActual: number | null; paginasTotales: number | null; registrosPagina: number | null; registrosTotales: number | null };
  creditos: number;
  conMontoSiguiente: number;
  /** Ruta de llaves hasta el primer crédito (p. ej. vListEntCredito[0].ListadoCobranzaPersonalizado...). */
  ruta: string | null;
  /** Llaves del primer crédito y de sus secciones, para ver qué trae. */
  secciones: Record<string, string[]>;
  muestra: { noCredito: string; proximoVencimiento: unknown; montoSiguienteVencimiento: unknown } | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** El crédito "completo" que contiene un objeto con NoCredito (sube hasta el nodo que agrupa las secciones). */
function buscarCreditos(nodo: unknown, ruta: string, salida: { credito: Record<string, unknown>; ruta: string }[]) {
  if (Array.isArray(nodo)) {
    nodo.forEach((x, i) => buscarCreditos(x, `${ruta}[${i}]`, salida));
    return;
  }
  if (!esObjeto(nodo)) return;
  // Un crédito: tiene una sección con NoCredito adentro (InformacionGeneral) o NoCredito directo.
  const seccionConNumero = Object.values(nodo).find((v) => esObjeto(v) && "NoCredito" in v);
  if ("NoCredito" in nodo || seccionConNumero) {
    salida.push({ credito: nodo, ruta });
    return;
  }
  for (const [k, v] of Object.entries(nodo)) buscarCreditos(v, ruta ? `${ruta}.${k}` : k, salida);
}

/** Primer valor de una llave a cualquier profundidad dentro de un crédito. */
function valor(obj: unknown, llave: string): unknown {
  if (!esObjeto(obj)) return undefined;
  if (llave in obj) return obj[llave];
  for (const v of Object.values(obj)) {
    const r = valor(v, llave);
    if (r !== undefined) return r;
  }
  return undefined;
}

export function resumirPersonalizado(respuesta: Record<string, unknown>, noCreditoMuestra: string): ResumenPersonalizado {
  const creditos: { credito: Record<string, unknown>; ruta: string }[] = [];
  buscarCreditos(respuesta, "", creditos);
  const primero = creditos[0]?.credito;
  const secciones: Record<string, string[]> = {};
  if (primero) {
    for (const [k, v] of Object.entries(primero)) secciones[k] = esObjeto(v) ? Object.keys(v) : Array.isArray(v) ? [`lista de ${v.length}`] : [typeof v];
  }
  const muestra = creditos.find((c) => String(valor(c.credito, "NoCredito")).trim() === noCreditoMuestra)?.credito;
  return {
    detalle: (respuesta.Detalle as string | undefined) ?? null,
    paginacion: {
      paginaActual: num(respuesta.PaginaActual),
      paginasTotales: num(respuesta.PaginasTotales),
      registrosPagina: num(respuesta.RegistrosPagina),
      registrosTotales: num(respuesta.RegistrosTotales),
    },
    creditos: creditos.length,
    conMontoSiguiente: creditos.filter((c) => valor(c.credito, "MontoSiguienteVencimiento") !== undefined).length,
    ruta: creditos[0]?.ruta ?? null,
    secciones,
    muestra: muestra
      ? { noCredito: noCreditoMuestra, proximoVencimiento: valor(muestra, "ProximoVencimiento"), montoSiguienteVencimiento: valor(muestra, "MontoSiguienteVencimiento") }
      : null,
  };
}
