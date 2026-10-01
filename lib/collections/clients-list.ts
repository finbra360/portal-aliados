// Lista de todos los clientes de cobranza: filtros, búsqueda y orden.
// Función pura, sin base de datos, para poder probarla con `node --test`.

import { chooseRecipient, type ContactLike } from "./contacts.ts";

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
}

export type ClientFilter = "todos" | "mora" | "corriente" | "sin_whatsapp";

export interface ClientListItem extends ClientListRow {
  enMora: boolean;
  recordatorios: { telefono: string | null; nombre: string | null; origen: "equipo" | "siac" | null };
}

export const FILTROS: { value: ClientFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "mora", label: "En mora" },
  { value: "corriente", label: "Sin mora" },
  { value: "sin_whatsapp", label: "Sin WhatsApp válido" },
];

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
  opts: { filtro: ClientFilter; q: string },
): { items: ClientListItem[]; conteos: Record<ClientFilter, number>; total: number } {
  const porCliente = new Map<string, typeof contactos>();
  for (const k of contactos) porCliente.set(k.clientId, [...(porCliente.get(k.clientId) ?? []), k]);

  const todos: ClientListItem[] = rows.map((r) => {
    const suyos = porCliente.get(r.clientId) ?? [];
    const rec = chooseRecipient(suyos, r.contactoCobranzaId);
    const k = suyos.find((c) => c.id === rec.contactId);
    return {
      ...r,
      enMora: r.vencido >= umbral,
      recordatorios: { telefono: k?.valor ?? null, nombre: k?.nombre ?? null, origen: rec.origen },
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
  };
  const conteos = Object.fromEntries(FILTROS.map((f) => [f.value, buscados.filter(pasa[f.value]).length])) as Record<ClientFilter, number>;

  const items = buscados
    .filter(pasa[opts.filtro])
    .sort((a, b) => b.vencido - a.vencido || b.adeudo - a.adeudo || a.nombre.localeCompare(b.nombre));
  return { items, conteos, total: todos.length };
}
