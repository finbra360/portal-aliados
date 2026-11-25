// «Brokers sin asignar»: negocios que llegaron de un broker (casi todos de
// HubSpot, que no guarda cuál) y todavía no tienen broker. Para cada uno se
// sugiere el broker con dos pistas: otro negocio de la misma empresa que ya
// tiene broker, o un crédito de la colocación capturada cuya referencia se
// parece al nombre de la empresa. Nunca se asigna solo: el equipo confirma.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { parecidoNombre } from "./siac-liga.ts";
import { PARECIDO_MINIMO } from "./juntar.ts";

export interface NegocioSinBroker {
  id: string;
  empresaId: string;
  empresa: string;
  razonSocial: string | null;
}

/** Un crédito de la colocación del broker (broker_colocaciones). */
export interface ColocacionConReferencia {
  brokerId: string;
  referencia: string;
  fecha: string;
}

/** Un negocio de la misma empresa que ya tiene broker. */
export interface BrokerDeEmpresa {
  empresaId: string;
  brokerId: string;
}

export interface Pista {
  brokerId: string;
  /** «empresa»: otro negocio de la empresa es de ese broker; «colocacion»: se parece a un crédito suyo. */
  fuente: "empresa" | "colocacion";
  /** La referencia de la colocación que coincidió (solo con fuente «colocacion»). */
  referencia: string | null;
  fecha: string | null;
  /** Parecido del nombre, de 0 a 1 (1 si es la misma empresa). */
  parecido: number;
}

/**
 * Pistas de broker para un negocio, la mejor primero y una por broker. Si
 * hay más de un broker con pista, el equipo elige (ninguna se marca segura).
 */
export function pistasDeBroker(n: NegocioSinBroker, colocaciones: ColocacionConReferencia[], deEmpresas: BrokerDeEmpresa[]): Pista[] {
  const mejor = new Map<string, Pista>();
  const guardar = (p: Pista) => {
    const antes = mejor.get(p.brokerId);
    // La misma empresa es la pista más fuerte; entre colocaciones, la más parecida y luego la más reciente.
    const gana =
      !antes ||
      (antes.fuente !== "empresa" &&
        (p.fuente === "empresa" || p.parecido > antes.parecido || (p.parecido === antes.parecido && (p.fecha ?? "") > (antes.fecha ?? ""))));
    if (gana) mejor.set(p.brokerId, p);
  };
  for (const d of deEmpresas) {
    if (d.empresaId === n.empresaId) guardar({ brokerId: d.brokerId, fuente: "empresa", referencia: null, fecha: null, parecido: 1 });
  }
  const nombres = [n.empresa, ...(n.razonSocial ? [n.razonSocial] : [])];
  for (const c of colocaciones) {
    const parecido = Math.max(...nombres.map((x) => parecidoNombre(x, c.referencia)));
    if (parecido >= PARECIDO_MINIMO) guardar({ brokerId: c.brokerId, fuente: "colocacion", referencia: c.referencia, fecha: c.fecha, parecido });
  }
  // Primero la misma empresa; luego la colocación más parecida y, entre iguales, la más reciente.
  return [...mejor.values()].sort(
    (a, b) =>
      Number(b.fuente === "empresa") - Number(a.fuente === "empresa") ||
      b.parecido - a.parecido ||
      (b.fecha ?? "").localeCompare(a.fecha ?? "") ||
      a.brokerId.localeCompare(b.brokerId),
  );
}

/**
 * Qué negocios sin broker salen en la lista: todos los de origen broker, y las
 * renovaciones solo si hay pista de un broker y nadie dijo «No es de broker»
 * (la mayoría de las renovaciones son de clientes directos).
 */
export function enLaLista(r: { renovacion: boolean; pistas: Pista[]; descartada: boolean }): boolean {
  return !r.renovacion || (r.pistas.length > 0 && !r.descartada);
}

/** La sugerencia que se puede confirmar en bloque: solo cuando apunta a un único broker. */
export function sugerenciaUnica(pistas: Pista[]): string | null {
  return pistas.length === 1 ? pistas[0].brokerId : null;
}
