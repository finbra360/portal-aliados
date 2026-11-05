// Lista de todos los clientes de cobranza: filtros, búsqueda y orden.
// Función pura, sin base de datos, para poder probarla con `node --test`.

import { chooseRecipient, type ContactLike } from "./contacts.ts";
import { estaEnMora } from "./rules.ts";
import { UMBRALES_SEMAFORO_DEFAULT, semaforo, type Semaforo, type UmbralesSemaforo } from "./preventivos.ts";

export interface ClientListRow {
  clientId: string;
  nombre: string;
  numeroCliente: string;
  creditosActivos: number;
  adeudo: number;
  vencido: number;
  maxAtraso: number;
  ultimoPago: string | null;
  pausaHasta: string | null;
  juridico: boolean;
  contactoCobranzaId: string | null;
  /** null = sin cuenta de pago: no recibe recordatorios. */
  cuentaPagoId: string | null;
  /**
   * Historial de SIAC, lo peor de sus créditos vigentes en la última foto
   * (NumeroVecesMora y Atrasomaximo). null si no tiene créditos en la foto.
   */
  historial: { vecesMora: number; atrasoMaximo: number } | null;
}

export type ClientFilter = "todos" | "mora" | "corriente" | "sin_whatsapp" | "sin_cuenta";
export type ClientOrder = "nombre" | "vencido" | "adeudo" | "atraso";

export interface ClientListItem extends ClientListRow {
  enMora: boolean;
  recordatorios: { telefono: string | null; nombre: string | null; origen: "equipo" | "siac" | null };
  /** Comportamiento de pago con el mismo semáforo de los preventivos; null sin historial. */
  semaforo: Semaforo | null;
}

export const FILTROS: { value: ClientFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "mora", label: "En mora" },
  { value: "corriente", label: "Sin mora" },
  { value: "sin_whatsapp", label: "Sin WhatsApp válido" },
  { value: "sin_cuenta", label: "Sin cuenta de pago" },
];

/** Nombre de la A a la Z; los montos y el atraso, el mayor primero. */
export const ORDENES: { value: ClientOrder; label: string }[] = [
  { value: "nombre", label: "Nombre (A–Z)" },
  { value: "vencido", label: "Mayor vencido" },
  { value: "adeudo", label: "Mayor adeudo" },
  { value: "atraso", label: "Más días de atraso" },
];

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
const COMPARAR: Record<ClientOrder, (a: ClientListItem, b: ClientListItem) => number> = {
  nombre: porNombre,
  vencido: (a, b) => b.vencido - a.vencido || b.adeudo - a.adeudo || porNombre(a, b),
  adeudo: (a, b) => b.adeudo - a.adeudo || porNombre(a, b),
  atraso: (a, b) => b.maxAtraso - a.maxAtraso || b.vencido - a.vencido || porNombre(a, b),
};

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Arma la lista. `contactos` trae todos los contactos de los clientes, con su
 * `clientId`; el destinatario de los recordatorios se calcula con la misma
 * regla que el perfil (chooseRecipient).
 */
export function buildClientList(
  rows: ClientListRow[],
  contactos: (ContactLike & { clientId: string; valor: string; nombre: string | null })[],
  umbral: number,
  opts: { filtro: ClientFilter; q: string; orden?: ClientOrder },
  umbralesSemaforo: UmbralesSemaforo = UMBRALES_SEMAFORO_DEFAULT,
): { items: ClientListItem[]; conteos: Record<ClientFilter, number>; total: number } {
  const porCliente = new Map<string, typeof contactos>();
  for (const k of contactos) porCliente.set(k.clientId, [...(porCliente.get(k.clientId) ?? []), k]);

  const todos: ClientListItem[] = rows.map((r) => {
    const suyos = porCliente.get(r.clientId) ?? [];
    const rec = chooseRecipient(suyos, r.contactoCobranzaId);
    const k = suyos.find((c) => c.id === rec.contactId);
    return {
      ...r,
      enMora: estaEnMora(r.vencido, r.maxAtraso, umbral),
      recordatorios: { telefono: k?.valor ?? null, nombre: k?.nombre ?? null, origen: rec.origen },
      semaforo: r.historial ? semaforo(r.historial, umbralesSemaforo) : null,
    };
  });

  const q = sinAcentos(opts.q.trim());
  const buscados = q
    ? todos.filter((c) => sinAcentos(c.nombre).includes(q) || c.numeroCliente.includes(q.replace(/\D/g, "") || q))
    : todos;

  const pasa: Record<ClientFilter, (c: ClientListItem) => boolean> = {
    todos: () => true,
    mora: (c) => c.enMora,
    corriente: (c) => !c.enMora && c.creditosActivos > 0,
    sin_whatsapp: (c) => !c.recordatorios.telefono && c.creditosActivos > 0,
    sin_cuenta: (c) => !c.cuentaPagoId && c.creditosActivos > 0,
  };
  const conteos = Object.fromEntries(FILTROS.map((f) => [f.value, buscados.filter(pasa[f.value]).length])) as Record<ClientFilter, number>;

  const items = buscados
    .filter(pasa[opts.filtro])
    .sort(COMPARAR[opts.orden ?? "nombre"]);
  return { items, conteos, total: todos.length };
}
