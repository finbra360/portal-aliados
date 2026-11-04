// Carga masiva de contactos de cobranza (CSV o pegado desde Excel): reconocer
// columnas, encontrar al cliente y validar cada contacto. Función pura, sin
// base de datos, para poder probarla con `node --test`. Guarda
// lib/db/collection-clients.ts (importarContactos).

import { leerTabla } from "../brokers/importar.ts";
import { TIPOS_CONTACTO, validarContactoNuevo, type TipoContacto } from "./contacts.ts";

export const MAX_FILAS_CONTACTOS = 2000;

export interface ClienteParaImportar {
  id: string;
  numeroCliente: string;
  nombre: string;
}

export interface ContactoExistente {
  clientId: string;
  valor: string;
  telefonoWhatsapp: string | null;
}

export interface FilaContacto {
  /** Número de fila en el archivo (la 1 son los encabezados). Una fila con teléfono y correo da dos contactos. */
  fila: number;
  clientId: string | null;
  cliente: string | null;
  medio: "telefono" | "email" | null;
  valor: string;
  telefonoWhatsapp: string | null;
  nombre: string | null;
  tipoContacto: TipoContacto;
  usarParaRecordatorios: boolean;
  notas: string | null;
  estado: "nuevo" | "existe" | "error";
  /** Para "error": el motivo. */
  detalle: string | null;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Para comparar razones sociales: "S.A. de C.V." = "SA DE CV". */
const nombreComparable = (s: string) => sinAcentos(s).replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
const sinCeros = (s: string) => s.trim().replace(/^0+(?=\d)/, "");
const creditoComparable = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

const SINONIMOS = {
  numeroCliente: ["numero de cliente", "numero cliente", "no cliente", "no. cliente", "num cliente", "id cliente", "cliente id", "numero_cliente", "no. de cliente"],
  credito: ["credito", "no credito", "no. credito", "numero de credito", "numero credito", "no. de credito", "no_credito"],
  cliente: ["cliente", "nombre del cliente", "empresa", "razon social", "deudor"],
  nombre: ["nombre", "nombre del contacto", "nombre contacto", "contacto", "persona"],
  telefono: ["telefono", "celular", "whatsapp", "tel", "movil", "telefono celular", "numero de telefono"],
  correo: ["correo", "email", "e-mail", "mail", "correo electronico"],
  tipo: ["tipo", "tipo de contacto", "puesto", "cargo", "rol", "relacion"],
  recordatorios: ["recordatorios", "recibe recordatorios", "usar para recordatorios", "enviar recordatorios", "principal"],
  notas: ["notas", "nota", "comentarios", "comentario", "observaciones"],
} as const;

type Columna = keyof typeof SINONIMOS;

/** Qué columna es cada dato, por su encabezado. -1 si no viene. */
export function mapearColumnasContactos(encabezados: string[]): Record<Columna, number> | { error: string } {
  const h = encabezados.map(sinAcentos);
  const cols = Object.fromEntries(
    (Object.keys(SINONIMOS) as Columna[]).map((c) => [c, h.findIndex((x) => (SINONIMOS[c] as readonly string[]).includes(x))]),
  ) as Record<Columna, number>;
  if (cols.numeroCliente < 0 && cols.credito < 0 && cols.cliente < 0) {
    return { error: `Falta la columna que dice de qué cliente es cada contacto: "Número de cliente", "Crédito" o "Cliente". Llegó: ${encabezados.join(", ") || "(vacío)"}` };
  }
  if (cols.telefono < 0 && cols.correo < 0) {
    return { error: `Falta la columna "Teléfono" o "Correo". Llegó: ${encabezados.join(", ")}` };
  }
  return cols;
}

const TIPOS_TEXTO: Record<string, TipoContacto> = {
  "": "deudor", deudor: "deudor", "del deudor": "deudor", titular: "deudor",
  dueno: "dueno", duena: "dueno", representante: "dueno", "representante legal": "dueno", director: "dueno", "director general": "dueno",
  socio: "dueno", propietario: "dueno", apoderado: "dueno",
  pagos: "pagos", tesoreria: "pagos", tesorero: "pagos", tesorera: "pagos", "cuentas por pagar": "pagos", finanzas: "pagos",
  contabilidad: "contabilidad", contador: "contabilidad", contadora: "contabilidad",
  otro: "otro", otra: "otro",
  aval: "aval",
  referencia: "referencia",
};
for (const [k, t] of Object.entries(TIPOS_CONTACTO)) TIPOS_TEXTO[sinAcentos(t.label)] = k as TipoContacto;

export function tipoDesdeTexto(texto: string): TipoContacto | null {
  return TIPOS_TEXTO[sinAcentos(texto)] ?? null;
}

function siNo(texto: string): boolean | null {
  const t = sinAcentos(texto);
  if (["si", "x", "1", "true", "yes", "s"].includes(t)) return true;
  if (["", "no", "0", "false", "n"].includes(t)) return false;
  return null;
}

/**
 * Revisa el archivo completo contra los clientes y contactos que ya existen.
 * Nada se guarda aquí; los "nuevo" son los que se darían de alta.
 */
export function revisarContactos(
  texto: string,
  clientes: ClienteParaImportar[],
  creditos: { noCredito: string; clientId: string }[],
  existentes: ContactoExistente[],
): { filas: FilaContacto[] } | { error: string } {
  const tabla = leerTabla(texto);
  if (tabla.length < 2) return { error: "El archivo no trae contactos (además de los encabezados)" };
  const cols = mapearColumnasContactos(tabla[0]);
  if ("error" in cols) return cols;
  if (tabla.length - 1 > MAX_FILAS_CONTACTOS) return { error: `Máximo ${MAX_FILAS_CONTACTOS.toLocaleString("es-MX")} filas por carga` };

  const porId = new Map(clientes.map((c) => [c.id, c]));
  const porNumero = new Map(clientes.map((c) => [sinCeros(c.numeroCliente), c]));
  const porCredito = new Map(creditos.map((c) => [creditoComparable(c.noCredito), porId.get(c.clientId)]));
  const porNombre = new Map<string, ClienteParaImportar | "repetido">();
  for (const c of clientes) {
    const k = nombreComparable(c.nombre);
    porNombre.set(k, porNombre.has(k) ? "repetido" : c);
  }

  // Lo que ya existe y lo que va entrando en el archivo, por cliente: correo en minúsculas o WhatsApp normalizado.
  const llave = (clientId: string, valor: string, wa: string | null) => `${clientId}|${wa ?? valor.toLowerCase()}`;
  const yaExiste = new Set(existentes.flatMap((k) => [llave(k.clientId, k.valor, null), ...(k.telefonoWhatsapp ? [llave(k.clientId, "", k.telefonoWhatsapp)] : [])]));
  const enArchivo = new Map<string, number>();
  const recordatoriosEn = new Map<string, number>();

  const filas: FilaContacto[] = [];
  tabla.slice(1).forEach((r, i) => {
    const n = i + 2;
    const celda = (c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
    const nombre = celda(cols.nombre).replace(/\s+/g, " ") || null;
    const notas = celda(cols.notas) || null;
    const base = { fila: n, clientId: null, cliente: null, medio: null, valor: celda(cols.telefono) || celda(cols.correo), telefonoWhatsapp: null, nombre, tipoContacto: "deudor" as TipoContacto, usarParaRecordatorios: false, notas };
    const error = (detalle: string, extra: Partial<FilaContacto> = {}) => filas.push({ ...base, ...extra, estado: "error", detalle });

    // 1. El cliente: por número, crédito o razón social. Si vienen varios, tienen que coincidir.
    const candidatos: { por: string; cliente: ClienteParaImportar | undefined | "repetido" }[] = [];
    if (celda(cols.numeroCliente)) candidatos.push({ por: `número de cliente ${celda(cols.numeroCliente)}`, cliente: porNumero.get(sinCeros(celda(cols.numeroCliente))) });
    if (celda(cols.credito)) candidatos.push({ por: `crédito ${celda(cols.credito)}`, cliente: porCredito.get(creditoComparable(celda(cols.credito))) });
    if (celda(cols.cliente)) candidatos.push({ por: `cliente "${celda(cols.cliente)}"`, cliente: porNombre.get(nombreComparable(celda(cols.cliente))) });
    if (!candidatos.length) return error("Falta el número de cliente, el crédito o el nombre del cliente");
    const falla = candidatos.find((c) => !c.cliente || c.cliente === "repetido");
    if (falla) {
      return error(falla.cliente === "repetido" ? `Hay más de un cliente que se llama así; usa el número de cliente` : `No encontramos el ${falla.por} en SIAC`);
    }
    const cliente = candidatos[0].cliente as ClienteParaImportar;
    if (candidatos.some((c) => c.cliente !== cliente)) return error(`No coinciden: ${candidatos.map((c) => `${c.por} es de ${(c.cliente as ClienteParaImportar).nombre}`).join("; ")}`);
    const deCliente = { clientId: cliente.id, cliente: cliente.nombre };

    // 2. Tipo y si recibe recordatorios.
    const tipoContacto = tipoDesdeTexto(celda(cols.tipo));
    if (!tipoContacto) return error(`Tipo "${celda(cols.tipo)}" no válido. Usa: Dueño, Pagos, Contabilidad, Otro, Aval o Referencia (vacío = del deudor sin clasificar)`, deCliente);
    const recordatorios = siNo(celda(cols.recordatorios));
    if (recordatorios === null) return error(`En "Recordatorios" escribe Sí o No (llegó "${celda(cols.recordatorios)}")`, deCliente);
    const telefono = celda(cols.telefono);
    const correo = celda(cols.correo);
    if (!telefono && !correo) return error("Falta el teléfono o el correo", { ...deCliente, tipoContacto });
    if (recordatorios && !TIPOS_CONTACTO[tipoContacto].deudor) return error("Un aval o una referencia no puede recibir los recordatorios", { ...deCliente, tipoContacto });
    if (recordatorios && !telefono) return error("Para recibir los recordatorios necesita teléfono (van por WhatsApp)", { ...deCliente, tipoContacto });

    // 3. Un contacto por teléfono y otro por correo.
    for (const [medio, valor] of [["telefono", telefono], ["email", correo]] as const) {
      if (!valor) continue;
      const usar = recordatorios && medio === "telefono";
      const fila = { ...base, ...deCliente, medio, valor, tipoContacto, usarParaRecordatorios: usar };
      const v = validarContactoNuevo(medio, valor);
      if (!v.ok) {
        filas.push({ ...fila, estado: "error", detalle: v.error });
        continue;
      }
      const k = llave(cliente.id, v.valor, v.telefonoWhatsapp);
      const listo = { ...fila, valor: v.valor, telefonoWhatsapp: v.telefonoWhatsapp };
      if (yaExiste.has(k)) {
        filas.push({ ...listo, usarParaRecordatorios: false, estado: "existe", detalle: usar ? "Ya está registrado; para que reciba los recordatorios, elígelo en el perfil del cliente" : null });
        continue;
      }
      const previa = enArchivo.get(k);
      if (previa) {
        filas.push({ ...listo, estado: "error", detalle: `Repetido en el archivo (fila ${previa})` });
        continue;
      }
      if (usar) {
        const otra = recordatoriosEn.get(cliente.id);
        if (otra) {
          filas.push({ ...listo, estado: "error", detalle: `Solo un contacto por cliente recibe los recordatorios (ya va el de la fila ${otra})` });
          continue;
        }
        recordatoriosEn.set(cliente.id, n);
      }
      enArchivo.set(k, n);
      filas.push({ ...listo, estado: "nuevo", detalle: null });
    }
  });
  return { filas };
}
