// Juntar dos empresas de Clientes que son la misma (por ejemplo, el prospecto
// que creó el importador de HubSpot y el cliente de SIAC con otro nombre).
// Todo pasa a la que se queda y la otra se borra. Funciones puras, sin base
// de datos, para probarlas con `node --test`.

import { parecidoNombre } from "./siac-liga.ts";

export interface EmpresaJuntar {
  id: string;
  nombre: string;
  razonSocial: string | null;
  /** Clientes de SIAC ligados. */
  clientes: number;
  negocios: number;
}

export type ValidarJuntar = { ok: true } | { ok: false; error: string };

/**
 * La que se borra tiene que ser un prospecto (sin clientes de SIAC): dos
 * clientes de SIAC no se juntan, porque cada razón social es un cliente aparte.
 */
export function validarJuntar(queda: EmpresaJuntar, seBorra: EmpresaJuntar): ValidarJuntar {
  if (queda.id === seBorra.id) return { ok: false, error: "Elige otra empresa: es la misma." };
  if (seBorra.clientes > 0) {
    return queda.clientes === 0
      ? { ok: false, error: `${seBorra.nombre} es cliente de SIAC: júntala al revés (que ${seBorra.nombre} se quede y ${queda.nombre} se borre).` }
      : { ok: false, error: `Las dos son clientes de SIAC. Cada razón social es un cliente aparte y no se juntan.` };
  }
  return { ok: true };
}

export interface Sugerencia {
  id: string;
  nombre: string;
  esCliente: boolean;
  negocios: number;
  /** Parecido del nombre, de 0 a 1. */
  parecido: number;
}

/** Desde qué parecido se sugiere una empresa. */
export const PARECIDO_MINIMO = 0.6;

/**
 * Para un prospecto, las empresas que se le parecen por nombre o razón social
 * (hasta 3): primero las más parecidas y, entre iguales, las que ya son clientes.
 */
export function sugerirEmpresas(prospecto: EmpresaJuntar, empresas: EmpresaJuntar[]): Sugerencia[] {
  const nombres = [prospecto.nombre, ...(prospecto.razonSocial ? [prospecto.razonSocial] : [])];
  return empresas
    .filter((e) => e.id !== prospecto.id)
    .map((e) => {
      const suyos = [e.nombre, ...(e.razonSocial ? [e.razonSocial] : [])];
      const parecido = Math.max(...nombres.flatMap((a) => suyos.map((b) => parecidoNombre(a, b))));
      return { id: e.id, nombre: e.nombre, esCliente: e.clientes > 0, negocios: e.negocios, parecido };
    })
    .filter((s) => s.parecido >= PARECIDO_MINIMO)
    .sort((a, b) => b.parecido - a.parecido || Number(b.esCliente) - Number(a.esCliente) || a.nombre.localeCompare(b.nombre))
    .slice(0, 3);
}

/**
 * Prospectos (sin clientes de SIAC) que se parecen a otra empresa, para la
 * pantalla «Empresas por revisar». Sin los que ya se marcaron como distintos.
 */
export function empresasPorRevisar(empresas: EmpresaJuntar[], revisadas: Set<string>): { empresa: EmpresaJuntar; sugerencias: Sugerencia[] }[] {
  return empresas
    .filter((e) => e.clientes === 0 && !revisadas.has(e.id))
    .map((empresa) => ({ empresa, sugerencias: sugerirEmpresas(empresa, empresas) }))
    .filter((x) => x.sugerencias.length > 0)
    .sort((a, b) => b.sugerencias[0].parecido - a.sugerencias[0].parecido || a.empresa.nombre.localeCompare(b.empresa.nombre));
}
