// WF6 — Qualification. Implementación de referencia de las exclusiones de ICP que
// corren en el nodo "Evaluar Hard Gates" de n8n. Vive aquí para que la regla sea
// legible y revisable fuera del editor de n8n; la fuente de verdad en ejecución
// sigue siendo el workflow.

/**
 * Pertenecer a la industria no es lo mismo que ser financiable.
 *
 * El motor descubre empresas por código SCIAN, así que todo lo que entra tiene
 * `industry_match = true` por construcción. Lo que estas reglas deciden es lo
 * otro: si además cabe en el segmento que Finbra puede fondear.
 *
 * El caso que las hizo necesarias: las divisiones de carga de las aerolíneas
 * están dadas de alta en DENUE como mensajería (492) o almacenamiento (493), no
 * como transporte aéreo (481). Para el INEGI, la bodega de AIR FRANCE CARGO *es*
 * un almacén. Por eso ningún filtro de SCIAN las puede atrapar — excluir el 481
 * no habría cambiado nada — y la única señal disponible es la identidad de la
 * empresa, que se lee del nombre comercial y de la razón social.
 */
export interface IcpIdentity {
  nombreComercial: string | null;
  razonSocial: string | null;
  /** SCIAN de 6 dígitos asignado por el INEGI al establecimiento. */
  scianCode: string | null;
}

export type MotivoExclusion =
  | "transporte_aereo"
  | "paqueteria_multinacional_o_franquicia"
  | "transporte_maritimo"
  | "transporte_ferroviario"
  | "entidad_publica"
  | "transporte_de_pasajeros";

/**
 * Nivel 1 — identidad corporativa. Una marca es una marca sin importar cómo quedó
 * clasificado el establecimiento: AEROMEXICO es una aerolínea aunque su bodega
 * esté dada de alta como paquetería, y una filial de DHL no es una PyME mexicana
 * aunque opere camiones. Aplica siempre.
 *
 * Se evalúa también contra la razón social, no solo el nombre comercial: en la
 * base hay una sucursal registrada como `ACA - LAS HAMACAS` cuya razón social es
 * `DHL EXPRESS MEXICO`. Por nombre comercial no se habría detectado nunca.
 */
const EXCLUSIONES_IDENTIDAD: ReadonlyArray<{ re: RegExp; motivo: MotivoExclusion }> = [
  { re: /(aerom[eé]xico|aeromexpress|air\s?france|\bklm\b|lufthansa|\biberia\b|american\s+airlines|united\s+airlines|delta\s+air|volaris|viva\s?aerob[uú]s)/i, motivo: "transporte_aereo" },
  { re: /(\bdhl\b|\bfedex\b|\bups\b|estafeta|redpack|paquetexpress|99\s?minutos)/i, motivo: "paqueteria_multinacional_o_franquicia" },
  { re: /(maersk|\bcosco\b|hapag|cma\s?cgm)/i, motivo: "transporte_maritimo" },
  { re: /(ferromex|ferrosur|kansas\s+city\s+southern)/i, motivo: "transporte_ferroviario" },
  { re: /(gobierno\s+(de|del|municipal|estatal)|ayuntamiento|secretar[ií]a\s+de|instituto\s+nacional|comisi[oó]n\s+federal|paraestatal|\bpemex\b|\bimss\b|\bissste\b|correos\s+de\s+m[eé]xico)/i, motivo: "entidad_publica" },
];

/**
 * Nivel 2 — descriptores de actividad. Palabras que describen un giro ajeno pero
 * que también aparecen dentro de nombres de empresas que sí son del ICP.
 *
 * El caso que obligó a separarlo: `ALOFRA TRUCKING`, razón social
 * `ELECTROMECANICA MARITIMA ALOFRA`, clasificada por el INEGI como 484129
 * autotransporte foráneo de carga general. "Marítima" está en el nombre legal,
 * no en la actividad. Cuando el SCIAN es 484x el propio INEGI ya dictaminó que
 * la actividad principal es carga terrestre, y ese dictamen pesa más que una
 * palabra en el nombre — así que ahí este nivel no aplica.
 */
const EXCLUSIONES_ACTIVIDAD: ReadonlyArray<{ re: RegExp; motivo: MotivoExclusion }> = [
  { re: /(aerol[ií]neas?|aeropuerto|transporte\s+a[eé]reo|carga\s+a[eé]rea)/i, motivo: "transporte_aereo" },
  { re: /(naviera|mar[ií]tim[ao]|transporte\s+fluvial)/i, motivo: "transporte_maritimo" },
  { re: /(ferrocarril|ferroviari[ao])/i, motivo: "transporte_ferroviario" },
  { re: /(autobuses?\b|\bpasajeros?\b|\btaxis?\b|transporte\s+urbano|transporte\s+p[uú]blico|transporte\s+tur[ií]stico)/i, motivo: "transporte_de_pasajeros" },
];

/** SCIAN 484 es autotransporte de carga: el camión es el negocio, y la garantía. */
export function esCargaTerrestre(scianCode: string | null): boolean {
  return Boolean(scianCode && scianCode.startsWith("484"));
}

export function evaluarExclusiones(identity: IcpIdentity): MotivoExclusion[] {
  const texto = `${identity.nombreComercial ?? ""} ${identity.razonSocial ?? ""}`.trim();
  const motivos: MotivoExclusion[] = [];

  for (const { re, motivo } of EXCLUSIONES_IDENTIDAD) {
    if (re.test(texto)) motivos.push(motivo);
  }
  if (!esCargaTerrestre(identity.scianCode)) {
    for (const { re, motivo } of EXCLUSIONES_ACTIVIDAD) {
      if (!motivos.includes(motivo) && re.test(texto)) motivos.push(motivo);
    }
  }
  return motivos;
}
