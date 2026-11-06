// Resumen de la respuesta de un servicio de SIAC que todavía no conocemos
// (ConsultarVistaCredito, ConsultarClientes). Función pura, sin base de datos,
// para poder probarla con `node --test`.
//
// No supone un formato: busca la lista de registros más grande de la respuesta,
// enumera sus campos y reconoce por nombre los que importan para saber si sirve
// para traer a los ex clientes (número de crédito y de cliente, estatus, fechas
// y RFC). Solo cuenta; no regresa datos de ningún cliente.

export interface ResumenServicio {
  detalle: string | null;
  /** Registros en la lista principal de la respuesta. */
  registros: number;
  /** Campos de los registros (los anidados como "Seccion.Campo"), en orden de aparición. */
  campos: string[];
  campoCredito: string | null;
  campoCliente: string | null;
  campoRfc: string | null;
  /** Registros con RFC no vacío. */
  conRfc: number;
  campoEstatus: string | null;
  /** Valores del estatus y cuántos registros tienen cada uno (los 12 más comunes). */
  estatus: { valor: string; n: number }[];
  camposFecha: string[];
  /** Créditos que no están hoy en el listado de cobranza (null si no se reconoce el campo). */
  creditosFueraDelListado: number | null;
  /** Clientes que no tenemos (null si no se reconoce el campo). */
  clientesNuevos: number | null;
  /** Datos sueltos del sobre (paginación, totales…), sin Detalle. */
  sobre: Record<string, string | number | boolean>;
}

type Registro = Record<string, unknown>;

const esObjeto = (v: unknown): v is Registro => !!v && typeof v === "object" && !Array.isArray(v);
const hoja = (campo: string) => campo.split(".").pop()!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** La lista de objetos más grande dentro de la respuesta, en cualquier nivel. */
function listaPrincipal(v: unknown, mejor: Registro[] = []): Registro[] {
  if (Array.isArray(v)) {
    const objetos = v.filter(esObjeto);
    if (objetos.length > mejor.length) mejor = objetos;
    for (const x of v) mejor = listaPrincipal(x, mejor);
  } else if (esObjeto(v)) {
    for (const x of Object.values(v)) mejor = listaPrincipal(x, mejor);
  }
  return mejor;
}

/** Aplana un registro un nivel por cada objeto anidado: { A: { B: 1 } } → { "A.B": 1 }. Las listas internas se omiten. */
function aplanar(r: Registro, prefijo = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    const nombre = prefijo ? `${prefijo}.${k}` : k;
    if (esObjeto(v)) Object.assign(out, aplanar(v, nombre));
    else if (!Array.isArray(v)) out[nombre] = v;
  }
  return out;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const buscar = (campos: string[], patron: RegExp) => campos.find((c) => patron.test(hoja(c))) ?? null;

export function resumirRespuestaSiac(respuesta: unknown, conocidos: { creditosVigentes: Set<string>; clientes: Set<string> }): ResumenServicio {
  const registros = listaPrincipal(respuesta).map((r) => aplanar(r));
  const campos: string[] = [];
  for (const r of registros.slice(0, 50)) for (const k of Object.keys(r)) if (!campos.includes(k)) campos.push(k);

  const campoCredito = buscar(campos, /^(nocredito|nocontrol|numerocredito|numcredito|idcredito|credito|folio)$/);
  const campoCliente = buscar(campos, /^(numerocliente|idcliente|nocliente|numcliente|clienteid)$/);
  const campoRfc = buscar(campos, /^rfc/);
  const campoEstatus = buscar(campos, /(estatus|status|situacion|estadocredito|estadocartera)$/);
  const camposFecha = campos.filter((c) => /^fecha/.test(hoja(c)));

  const conteo = new Map<string, number>();
  if (campoEstatus) for (const r of registros) conteo.set(texto(r[campoEstatus]) || "(vacío)", (conteo.get(texto(r[campoEstatus]) || "(vacío)") ?? 0) + 1);

  const sinCeros = (s: string) => s.replace(/^0+(?=\d)/, "");
  const vigentes = new Set([...conocidos.creditosVigentes].map((c) => sinCeros(c.trim())));
  const clientes = new Set([...conocidos.clientes].map((c) => sinCeros(c.trim())));

  const sobre: Record<string, string | number | boolean> = {};
  if (esObjeto(respuesta)) {
    for (const [k, v] of Object.entries(respuesta)) {
      if (k !== "Detalle" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) sobre[k] = v;
    }
  }

  return {
    detalle: esObjeto(respuesta) && respuesta.Detalle !== undefined ? texto(respuesta.Detalle) : null,
    registros: registros.length,
    campos,
    campoCredito,
    campoCliente,
    campoRfc,
    conRfc: campoRfc ? registros.filter((r) => texto(r[campoRfc])).length : 0,
    campoEstatus,
    estatus: [...conteo.entries()].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n).slice(0, 12),
    camposFecha,
    creditosFueraDelListado: campoCredito ? registros.filter((r) => texto(r[campoCredito]) && !vigentes.has(sinCeros(texto(r[campoCredito])))).length : null,
    clientesNuevos: campoCliente
      ? new Set(registros.map((r) => sinCeros(texto(r[campoCliente]))).filter((c) => c && !clientes.has(c))).size
      : null,
    sobre,
  };
}
