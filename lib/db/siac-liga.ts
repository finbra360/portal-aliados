// Liga de un negocio dispersado con su crédito de SIAC (fase O6). Las reglas
// (sugerencias y cuándo se juntan empresas) están en lib/clientes/siac-liga.ts.
// Al ligar, si la empresa del negocio es un prospecto y SIAC ya le creó otra
// empresa a su cliente, todo pasa a la del negocio y la de SIAC se borra.
// Antes de correr crm-schema.sql no existe credit_id: no se ofrece ligar.
//
// Los créditos salen de dos lados: el listado de cobranza (col_credits, los
// vigentes) y el Excel «Estado de Clientes» (crm_creditos_historicos, también
// los pagados; lib/db/siac-historico.ts). Un histórico que sigue en cobranza
// (credit_id) se ofrece como el de cobranza.

import { sql, transaccion, type Tx } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { NegocioError } from "@/lib/db/negocios";
import { juntarEmpresas } from "@/lib/db/juntar-empresas";
import { normalNoCredito } from "@/lib/clientes/siac-historico";
import { comoJuntar, nombreEnHubspot, sugerirCreditos, type CreditoSiac, type Sugerencia } from "@/lib/clientes/siac-liga";

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface CreditoLigado extends CreditoSiac {
  ligadoPor: string | null;
  ligadoNombre: string | null;
  ligadoAt: string | null;
}

export interface LigaSiac {
  ligado: CreditoLigado | null;
  /** Solo si el negocio está dispersado y todavía no tiene crédito. */
  sugerencias: Sugerencia[];
}

export const SELECT_CREDITO = () => sql`
  SELECT cr.id, cr.no_credito, cr.monto_credito, to_char(cr.fecha_ministracion, 'YYYY-MM-DD') AS ministracion,
         c.nombre AS cliente, c.numero_cliente, c.empresa_id
  FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
`;

/** Un crédito histórico, con la empresa de su cliente si el cliente está en cobranza. */
const SELECT_HISTORICO = () => sql`
  SELECT h.id, h.no_credito, h.monto AS monto_credito, to_char(h.fecha_otorgamiento, 'YYYY-MM-DD') AS ministracion,
         h.nombre AS cliente, h.numero_cliente, h.estado, h.credit_id,
         (SELECT c.empresa_id FROM col_clients c WHERE c.ambiente = h.ambiente AND c.numero_cliente = h.numero_cliente LIMIT 1) AS empresa_id
  FROM crm_creditos_historicos h
`;

export function mapCredito(r: Record<string, unknown>): CreditoSiac {
  return {
    creditId: r.id as string,
    noCredito: r.no_credito as string,
    cliente: r.cliente as string,
    numeroCliente: r.numero_cliente as string,
    empresaId: (r.empresa_id as string) ?? null,
    monto: numero(r.monto_credito),
    fechaMinistracion: (r.ministracion as string) ?? null,
  };
}

const mapHistorico = (r: Record<string, unknown>): CreditoSiac => ({ ...mapCredito(r), historico: true, estado: (r.estado as string) ?? null });

/** La base ya tiene la columna credit_id (fase O6). */
export const tieneLiga = (j: Record<string, unknown> | null | undefined) => !!j && "credit_id" in j;

/** Ya está la tabla de créditos históricos (falta correr crm-schema.sql si no). */
export async function hayHistoricos(): Promise<boolean> {
  return (await sql`SELECT to_regclass('public.crm_creditos_historicos') IS NOT NULL AS hay`)[0].hay as boolean;
}

/** El negocio ya está ligado a un crédito, de cobranza o histórico. */
export const estaLigado = (j: Record<string, unknown>) => !!j.credit_id || !!j.credito_historico_id;

/** El crédito ligado o, si no hay, las sugerencias. null si la base todavía no tiene la columna. */
export async function getLigaSiac(negocioId: string): Promise<LigaSiac | null> {
  const [n] = await sql`
    SELECT n.etapa, n.empresa_id, n.monto_estimado, to_jsonb(n) AS j, e.nombre, e.razon_social,
           to_char(COALESCE(
             (SELECT max(h.ocurrido_at) FROM crm_negocio_etapas h WHERE h.negocio_id = n.id AND h.a = 'dispersado'), n.etapa_desde
           ) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS dispersado_el
    FROM crm_negocios_credito n JOIN crm_empresas e ON e.id = n.empresa_id
    WHERE n.id = ${negocioId} AND n.ambiente = ${ambienteActual()}
  `;
  const j = (n?.j ?? null) as Record<string, unknown> | null;
  if (!n || !tieneLiga(j)) return null;

  if (estaLigado(j!)) {
    const [c] = j!.credit_id
      ? (await sql`${SELECT_CREDITO()} WHERE cr.id = ${j!.credit_id as string}`).map(mapCredito)
      : (await sql`${SELECT_HISTORICO()} WHERE h.id = ${j!.credito_historico_id as string}`).map(mapHistorico);
    const [u] = j!.ligado_siac_por ? await sql`SELECT nombre FROM admin_users WHERE email = ${j!.ligado_siac_por as string}` : [];
    return {
      ligado: c
        ? {
            ...c,
            ligadoPor: (j!.ligado_siac_por as string) ?? null,
            ligadoNombre: (u?.nombre as string) ?? null,
            ligadoAt: j!.ligado_siac_at ? new Date(j!.ligado_siac_at as string).toISOString() : null,
          }
        : null,
      sugerencias: [],
    };
  }
  if (n.etapa !== "dispersado") return { ligado: null, sugerencias: [] };

  const hayDecisiones = (await sql`SELECT to_regclass('public.crm_negocio_decisiones') IS NOT NULL AS hay`)[0].hay;
  const [aprobado] = hayDecisiones
    ? await sql`SELECT monto FROM crm_negocio_decisiones WHERE negocio_id = ${negocioId} AND decision = 'aprobado' ORDER BY decidido_at DESC, id DESC LIMIT 1`
    : [];
  const monto = numero(aprobado?.monto) ?? numero(j!.oferta_monto) ?? numero(n.monto_estimado);
  const dispersadoEl = n.dispersado_el as string;
  // Todos los créditos libres: sugerirCreditos decide por fecha y, lejos de ella, por nombre.
  const creditos = await creditosLibres();
  const nombres = nombresDelNegocio(n.nombre as string, n.razon_social as string | null, j!.notas as string | null);
  return {
    ligado: null,
    sugerencias: sugerirCreditos({ empresaId: n.empresa_id as string, nombres, monto, dispersadoEl }, creditos),
  };
}

/**
 * Créditos que todavía no están ligados a ningún negocio: los de cobranza y
 * los históricos que ya no están en cobranza.
 */
export async function creditosLibres(): Promise<CreditoSiac[]> {
  const amb = ambienteActual();
  const [cobranza, historicos] = await Promise.all([
    sql`
      ${SELECT_CREDITO()}
      WHERE cr.ambiente = ${amb} AND NOT EXISTS (SELECT 1 FROM crm_negocios_credito x WHERE x.credit_id = cr.id)
    `,
    hayHistoricos().then(async (hay) =>
      hay
        ? await sql`
            ${SELECT_HISTORICO()}
            WHERE h.ambiente = ${amb} AND h.credit_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM crm_negocios_credito x WHERE x.credito_historico_id = h.id)
          `
        : [],
    ),
  ]);
  return [...cobranza.map(mapCredito), ...historicos.map(mapHistorico)];
}

/** Con qué nombres buscar el crédito: el de la empresa, su razón social y el del negocio en HubSpot. */
export function nombresDelNegocio(nombre: string, razonSocial: string | null, notas: string | null): string[] {
  return [nombre, razonSocial, nombreEnHubspot(notas)].filter((x): x is string => !!x);
}

/**
 * El crédito a ligar: por id (de cobranza o histórico) o por número (primero
 * en cobranza y luego en los históricos). Un histórico que sigue en cobranza
 * se liga como el de cobranza. Todo con tx: otra conexión se traba con pool 1.
 */
type Encontrado = Record<string, unknown> & { historico: boolean };

async function buscarCredito(tx: Tx, ambiente: string, p: { creditId?: string; historicoId?: string; noCredito?: string }): Promise<Encontrado | null> {
  const deCobranza = async (por: { id: string } | { no: string }) => {
    const [c] =
      "id" in por
        ? await tx`
            SELECT cr.id, cr.no_credito, c.id AS client_id, c.nombre AS cliente, c.empresa_id
            FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
            WHERE cr.ambiente = ${ambiente} AND cr.id = ${por.id}
          `
        : await tx`
            SELECT cr.id, cr.no_credito, c.id AS client_id, c.nombre AS cliente, c.empresa_id
            FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
            WHERE cr.ambiente = ${ambiente} AND upper(regexp_replace(trim(cr.no_credito), '[[:space:]]+', ' ', 'g')) = ${por.no}
          `;
    return c ? ({ ...c, historico: false } as Encontrado) : null;
  };
  const historico = async (por: { id: string } | { no: string }) => {
    const [hay] = await tx`SELECT to_regclass('public.crm_creditos_historicos') IS NOT NULL AS hay`;
    if (!hay.hay) return null;
    const [h] = await tx`
      SELECT h.id, h.no_credito, h.nombre AS cliente, h.credit_id, c.id AS client_id, c.empresa_id
      FROM crm_creditos_historicos h
      LEFT JOIN LATERAL (SELECT x.id, x.empresa_id FROM col_clients x WHERE x.ambiente = h.ambiente AND x.numero_cliente = h.numero_cliente LIMIT 1) c ON true
      WHERE h.ambiente = ${ambiente} AND (h.id::text = ${"id" in por ? por.id : ""} OR h.no_credito = ${"no" in por ? por.no : ""})
    `;
    if (!h) return null;
    if (h.credit_id) return deCobranza({ id: h.credit_id as string });
    return { ...h, historico: true } as Encontrado;
  };
  if (p.creditId) return deCobranza({ id: p.creditId });
  if (p.historicoId) return historico({ id: p.historicoId });
  const no = normalNoCredito(p.noCredito ?? "");
  return (await deCobranza({ no })) ?? historico({ no });
}

/**
 * Liga el negocio (dispersado, sin crédito todavía) con un crédito de SIAC,
 * por id (una sugerencia, de cobranza o histórica) o por número de crédito.
 * Junta las empresas si toca (comoJuntar); un histórico cuyo cliente ya no
 * está en cobranza solo queda anotado. Todo en una transacción; la auditoría, después.
 */
export async function ligarCreditoSiac(p: { negocioId: string; creditId?: string; historicoId?: string; noCredito?: string; actor: string }) {
  const ambiente = ambienteActual();
  const r = await transaccion(async (tx) => {
    const [n] = await tx`
      SELECT n.etapa, n.empresa_id, to_jsonb(n) AS j FROM crm_negocios_credito n
      WHERE n.id = ${p.negocioId} AND n.ambiente = ${ambiente} FOR UPDATE
    `;
    if (!n) throw new NegocioError("Ese negocio no existe.");
    const j = n.j as Record<string, unknown>;
    if (!tieneLiga(j)) throw new NegocioError("Falta correr crm-schema.sql para ligar el negocio con SIAC.");
    if (n.etapa !== "dispersado") throw new NegocioError("Solo un negocio dispersado se liga con su crédito de SIAC.");
    if (estaLigado(j)) throw new NegocioError("Este negocio ya está ligado a un crédito de SIAC.");

    const c = await buscarCredito(tx, ambiente, p);
    if (!c) {
      throw new NegocioError(
        p.noCredito
          ? `No encontramos el crédito ${p.noCredito} en SIAC. Revisa el número; si es un crédito ya pagado, sube el Estado de Clientes de SIAC en Por ligar con SIAC.`
          : "Ese crédito no existe.",
      );
    }
    const [otro] = c.historico
      ? await tx`SELECT id FROM crm_negocios_credito WHERE credito_historico_id = ${c.id as string}`
      : await tx`SELECT id FROM crm_negocios_credito WHERE credit_id = ${c.id as string}`;
    if (otro) throw new NegocioError(`El crédito ${c.no_credito} ya está ligado a otro negocio.`);

    const empresaNegocio = n.empresa_id as string;
    let accion: "misma" | "juntar" | "asignar" | "anotar" = "asignar";
    let movidos: Record<string, number> = {};
    let empresaBorrada: string | null = null;
    const [en] = await tx`
      SELECT e.id, e.nombre, e.origen, (SELECT count(*)::int FROM col_clients x WHERE x.empresa_id = e.id) AS clientes
      FROM crm_empresas e WHERE e.id = ${empresaNegocio} FOR UPDATE
    `;
    if (c.empresa_id) {
      const [ec] = await tx`
        SELECT e.id, e.nombre, e.origen, (SELECT count(*)::int FROM col_clients x WHERE x.empresa_id = e.id) AS clientes
        FROM crm_empresas e WHERE e.id = ${c.empresa_id as string} FOR UPDATE
      `;
      const v = comoJuntar(
        { id: en.id, nombre: en.nombre, origen: en.origen, clientes: en.clientes },
        { id: ec.id, nombre: ec.nombre, origen: ec.origen, clientes: ec.clientes },
      );
      if (!v.ok) throw new NegocioError(v.error);
      accion = v.accion;
      if (accion === "juntar") {
        movidos = await juntarEmpresas(tx, empresaNegocio, ec.id as string);
        empresaBorrada = ec.id as string;
      }
    } else if (c.client_id) {
      // El cliente todavía no tiene empresa (la foto aún no la crea): queda con la del negocio.
      if (en.clientes > 0) throw new NegocioError(`${en.nombre} ya es cliente con otra razón social. Revisa que sea el crédito correcto.`);
      await tx`UPDATE col_clients SET empresa_id = ${empresaNegocio} WHERE id = ${c.client_id as string}`;
    } else {
      // Histórico de un cliente que ya no está en cobranza: no hay empresa que juntar.
      accion = "anotar";
    }
    if (c.historico) {
      await tx`
        UPDATE crm_negocios_credito SET credito_historico_id = ${c.id as string}, ligado_siac_por = ${p.actor}, ligado_siac_at = now(), updated_by = ${p.actor}, updated_at = now()
        WHERE id = ${p.negocioId}
      `;
    } else {
      await tx`
        UPDATE crm_negocios_credito SET credit_id = ${c.id as string}, ligado_siac_por = ${p.actor}, ligado_siac_at = now(), updated_by = ${p.actor}, updated_at = now()
        WHERE id = ${p.negocioId}
      `;
    }
    return { creditId: c.id as string, historico: c.historico, noCredito: c.no_credito as string, cliente: c.cliente as string, accion, empresaBorrada, movidos };
  });
  await logAudit({ actorEmail: p.actor, action: "ligar_siac_negocio", entityType: "negocio", entityId: p.negocioId, metadata: r });
  if (r.accion === "juntar") {
    await logAudit({
      actorEmail: p.actor,
      action: "juntar_empresas",
      entityType: "empresa",
      entityId: (await sql`SELECT empresa_id FROM crm_negocios_credito WHERE id = ${p.negocioId}`)[0].empresa_id as string,
      metadata: { empresaBorrada: r.empresaBorrada, cliente: r.cliente, movidos: r.movidos },
    });
  }
  return r;
}

/** crm_settings: negocios dispersados que se revisaron y no tienen crédito en SIAC. */
export const CLAVE_SIN_CREDITO = "dispersados_sin_credito";

/**
 * Negocios dispersados que todavía no se ligan a su crédito, sin contar los
 * marcados «No tiene crédito en SIAC»; null si la base no tiene la columna.
 * Con `dias`, solo los que se dispersaron en esos días (Inicio pide los de 90:
 * los más viejos, como los ganados que se trajeron de HubSpot, no se piden ahí).
 */
export async function dispersadosSinLigar(dias: number | null = 90): Promise<number | null> {
  const [col] = await sql`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_negocios_credito' AND column_name = 'credit_id'
  `;
  if (!col) return null;
  const [r] = await sql`
    SELECT count(*)::int AS n FROM crm_negocios_credito n
    WHERE n.ambiente = ${ambienteActual()} AND n.etapa = 'dispersado' AND n.credit_id IS NULL
      AND to_jsonb(n)->>'credito_historico_id' IS NULL
      AND (${dias}::int IS NULL OR n.etapa_desde > now() - make_interval(days => ${dias}::int))
      AND NOT COALESCE((SELECT value->'ids' FROM crm_settings WHERE key = ${CLAVE_SIN_CREDITO}) @> to_jsonb(n.id::text), false)
  `;
  return r.n as number;
}
