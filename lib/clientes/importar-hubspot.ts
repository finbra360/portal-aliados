// Importación del historial de negocios ganados de HubSpot a Clientes 360.
// Funciones puras, sin base de datos, para poder probarlas con `node --test`.
//
// El archivo lo revisa una persona antes de importarlo: HubSpot tiene negocios
// sin empresa asociada y asociaciones equivocadas, así que la columna «Empresa»
// (no la asociación de HubSpot) es la que agrupa. Cada grupo se liga a una
// empresa que ya existe, en este orden:
//   1. el número de cliente de SIAC que se haya escrito en el archivo;
//   2. el ID de la empresa en HubSpot, si ya se importó antes;
//   3. el nombre, sin acentos ni forma legal (S.A. de C.V., S.A.P.I., SOFOM…);
// y si ninguno coincide, se crea una empresa nueva con origen «hubspot».

import { leerTabla } from "../brokers/importar.ts";

export interface FilaNegocio {
  fila: number;
  incluir: boolean;
  dealId: string;
  negocio: string;
  fechaCierre: string | null;
  monto: number | null;
  etapa: string | null;
  pipeline: "nuevo" | "renovacion";
  producto: string | null;
  empresa: string;
  hubspotEmpresaId: string | null;
  industria: string | null;
  sitioWeb: string | null;
  numeroClienteSiac: string | null;
}

export interface EmpresaExistente {
  empresaId: string;
  nombre: string;
  razonSocial: string | null;
  hubspotCompanyId: string | null;
  numerosCliente: string[];
}

export type Destino =
  | { tipo: "existente"; empresaId: string; nombre: string; motivo: "numero_cliente" | "hubspot" | "nombre" }
  | { tipo: "nueva" }
  | { tipo: "error"; error: string };

export interface PlanEmpresa {
  clave: string;
  nombre: string;
  hubspotEmpresaId: string | null;
  industria: string | null;
  sitioWeb: string | null;
  negocios: FilaNegocio[];
  monto: number;
  primerCierre: string | null;
  ultimoCierre: string | null;
  destino: Destino;
}

const COLUMNAS = {
  incluir: ["incluir"],
  dealId: ["id negocio hubspot", "id negocio", "deal id"],
  negocio: ["negocio", "nombre del negocio"],
  fechaCierre: ["fecha de cierre", "fecha cierre"],
  monto: ["monto"],
  etapa: ["etapa"],
  pipeline: ["pipeline"],
  producto: ["producto"],
  empresa: ["empresa"],
  hubspotEmpresaId: ["id empresa hubspot", "id empresa"],
  industria: ["industria"],
  sitioWeb: ["sitio web", "dominio"],
  numeroClienteSiac: ["numero de cliente siac", "numero cliente siac", "numero de cliente"],
} as const;
type Columna = keyof typeof COLUMNAS;
const OBLIGATORIAS: Columna[] = ["dealId", "negocio", "empresa"];

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const encabezado = (s: string) => sinAcentos(s).toLowerCase().replace(/\s+/g, " ").trim();

/** Formas legales y palabras de relleno que no distinguen a una empresa de otra. */
const RELLENO = new Set(["s", "a", "sa", "sapi", "de", "cv", "rl", "srl", "r", "l", "c", "v", "sc", "ac", "sofom", "enr", "e", "n", "p", "i", "y"]);

/**
 * Nombre para comparar empresas: minúsculas, sin acentos, sin puntuación ni
 * forma legal. "QUIMICOS EJEMPLO S. DE R.L. DE C.V." y "Químicos Ejemplo" dan lo mismo.
 */
export function normalizarNombreEmpresa(nombre: string): string {
  return sinAcentos(nombre)
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[.,]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(" ")
    .filter((t) => t && !RELLENO.has(t))
    .join(" ");
}

function numero(texto: string): number | null | "error" {
  const t = texto.replace(/[$\s]/g, "").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : "error";
}

function fecha(texto: string): string | null | "error" {
  const t = texto.trim();
  if (!t) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? t : "error";
}

/** Lee el CSV (o las celdas pegadas de Sheets) y valida cada fila. */
export function leerNegocios(texto: string): { filas: FilaNegocio[]; errores: { fila: number; error: string }[] } | { error: string } {
  const tabla = leerTabla(texto).filter((f) => f.some((c) => c.trim()));
  if (tabla.length < 2) return { error: "El archivo no tiene filas: debe traer la fila de encabezados y al menos un negocio." };
  const enc = tabla[0].map(encabezado);
  const idx = Object.fromEntries(
    (Object.keys(COLUMNAS) as Columna[]).map((k) => [k, enc.findIndex((e) => (COLUMNAS[k] as readonly string[]).includes(e))]),
  ) as Record<Columna, number>;
  const faltan = OBLIGATORIAS.filter((k) => idx[k] < 0);
  if (faltan.length) return { error: `Faltan columnas: ${faltan.map((k) => COLUMNAS[k][0]).join(", ")}.` };

  const filas: FilaNegocio[] = [];
  const errores: { fila: number; error: string }[] = [];
  const vistos = new Set<string>();
  tabla.slice(1).forEach((f, i) => {
    const fila = i + 2;
    const v = (k: Columna) => (idx[k] >= 0 ? (f[idx[k]] ?? "").trim() : "");
    const dealId = v("dealId");
    const empresa = v("empresa");
    const negocio = v("negocio");
    const incluirTexto = encabezado(v("incluir"));
    const incluir = !["no", "n", "0", "false"].includes(incluirTexto);
    if (!incluir) return;
    if (!/^\d{1,20}$/.test(dealId)) return errores.push({ fila, error: "El ID del negocio de HubSpot debe ser un número." });
    if (vistos.has(dealId)) return errores.push({ fila, error: `El negocio ${dealId} viene repetido.` });
    if (!negocio) return errores.push({ fila, error: "Falta el nombre del negocio." });
    if (!normalizarNombreEmpresa(empresa)) return errores.push({ fila, error: "Falta la empresa." });
    const monto = numero(v("monto"));
    if (monto === "error") return errores.push({ fila, error: `Monto inválido: «${v("monto")}».` });
    const fechaCierre = fecha(v("fechaCierre"));
    if (fechaCierre === "error") return errores.push({ fila, error: `Fecha inválida: «${v("fechaCierre")}». Usa AAAA-MM-DD.` });
    const hubspotEmpresaId = v("hubspotEmpresaId");
    if (hubspotEmpresaId && !/^\d{1,20}$/.test(hubspotEmpresaId)) return errores.push({ fila, error: "El ID de la empresa en HubSpot debe ser un número." });
    const numeroCliente = v("numeroClienteSiac").replace(/\D/g, "");
    vistos.add(dealId);
    filas.push({
      fila,
      incluir,
      dealId,
      negocio,
      fechaCierre,
      monto,
      etapa: v("etapa") || null,
      pipeline: encabezado(v("pipeline")).startsWith("renov") ? "renovacion" : "nuevo",
      producto: v("producto") || null,
      empresa,
      hubspotEmpresaId: hubspotEmpresaId || null,
      industria: v("industria") || null,
      sitioWeb: v("sitioWeb") || null,
      numeroClienteSiac: numeroCliente || null,
    });
  });
  return { filas, errores };
}

/** Agrupa los negocios por empresa y decide a qué empresa existente va cada grupo (o si es nueva). */
export function planearImportacion(filas: FilaNegocio[], existentes: EmpresaExistente[]): PlanEmpresa[] {
  const grupos = new Map<string, FilaNegocio[]>();
  for (const f of filas) {
    const clave = normalizarNombreEmpresa(f.empresa);
    grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }

  const porNumero = new Map<string, EmpresaExistente>();
  const porHubspot = new Map<string, EmpresaExistente>();
  const porNombre = new Map<string, EmpresaExistente[]>();
  for (const e of existentes) {
    for (const n of e.numerosCliente) porNumero.set(n.replace(/\D/g, "").replace(/^0+/, ""), e);
    if (e.hubspotCompanyId) porHubspot.set(e.hubspotCompanyId, e);
    for (const nombre of new Set([e.nombre, e.razonSocial].filter(Boolean).map((n) => normalizarNombreEmpresa(n!)))) {
      porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), e]);
    }
  }

  const primero = <T>(xs: (T | null)[]) => xs.find((x) => x !== null) ?? null;
  return [...grupos.entries()]
    .map(([clave, negocios]): PlanEmpresa => {
      const fechas = negocios.map((n) => n.fechaCierre).filter((x): x is string => !!x).sort();
      const numeros = [...new Set(negocios.map((n) => n.numeroClienteSiac).filter((x): x is string => !!x))];
      const hubspotIds = [...new Set(negocios.map((n) => n.hubspotEmpresaId).filter((x): x is string => !!x))];
      const hubspotEmpresaId = hubspotIds.length === 1 ? hubspotIds[0] : null;

      let destino: Destino;
      if (numeros.length > 1) {
        destino = { tipo: "error", error: `Los negocios de esta empresa traen números de cliente distintos (${numeros.join(", ")}).` };
      } else if (numeros.length === 1) {
        const e = porNumero.get(numeros[0].replace(/^0+/, ""));
        destino = e ? { tipo: "existente", empresaId: e.empresaId, nombre: e.nombre, motivo: "numero_cliente" } : { tipo: "error", error: `No hay un cliente de SIAC con el número ${numeros[0]}.` };
      } else if (hubspotEmpresaId && porHubspot.has(hubspotEmpresaId)) {
        const e = porHubspot.get(hubspotEmpresaId)!;
        destino = { tipo: "existente", empresaId: e.empresaId, nombre: e.nombre, motivo: "hubspot" };
      } else {
        const candidatos = porNombre.get(clave) ?? [];
        destino =
          candidatos.length === 1
            ? { tipo: "existente", empresaId: candidatos[0].empresaId, nombre: candidatos[0].nombre, motivo: "nombre" }
            : candidatos.length > 1
              ? { tipo: "error", error: `El nombre coincide con ${candidatos.length} empresas (${candidatos.map((c) => c.nombre).join(", ")}). Escribe el número de cliente de SIAC.` }
              : { tipo: "nueva" };
      }

      return {
        clave,
        nombre: negocios[0].empresa.trim(),
        hubspotEmpresaId,
        industria: primero(negocios.map((n) => n.industria)),
        sitioWeb: primero(negocios.map((n) => n.sitioWeb)),
        negocios: [...negocios].sort((a, b) => (b.fechaCierre ?? "").localeCompare(a.fechaCierre ?? "")),
        monto: Math.round(negocios.reduce((s, n) => s + (n.monto ?? 0), 0) * 100) / 100,
        primerCierre: fechas[0] ?? null,
        ultimoCierre: fechas[fechas.length - 1] ?? null,
        destino,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}
