// Liga de un negocio dispersado con su crédito de SIAC (fase O6). Las reglas
// (sugerencias y cuándo se juntan empresas) están en lib/clientes/siac-liga.ts.
// Al ligar, si la empresa del negocio es un prospecto y SIAC ya le creó otra
// empresa a su cliente, todo pasa a la del negocio y la de SIAC se borra.
// Antes de correr crm-schema.sql no existe credit_id: no se ofrece ligar.

import { sql, transaccion, type Tx } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { NegocioError } from "@/lib/db/negocios";
import { comoJuntar, sugerirCreditos, VENTANA_DIAS, type CreditoSiac, type Sugerencia } from "@/lib/clientes/siac-liga";

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

const SELECT_CREDITO = () => sql`
  SELECT cr.id, cr.no_credito, cr.monto_credito, to_char(cr.fecha_ministracion, 'YYYY-MM-DD') AS ministracion,
         c.nombre AS cliente, c.numero_cliente, c.empresa_id
  FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
`;

function mapCredito(r: Record<string, unknown>): CreditoSiac {
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

/** La base ya tiene la columna credit_id (fase O6). */
export const tieneLiga = (j: Record<string, unknown> | null | undefined) => !!j && "credit_id" in j;

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

  if (j!.credit_id) {
    const [c] = await sql`
      ${SELECT_CREDITO()}
      WHERE cr.id = ${j!.credit_id as string}
    `;
    const [u] = j!.ligado_siac_por ? await sql`SELECT nombre FROM admin_users WHERE email = ${j!.ligado_siac_por as string}` : [];
    return {
      ligado: c
        ? {
            ...mapCredito(c),
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
  const creditos = await sql`
    ${SELECT_CREDITO()}
    WHERE cr.ambiente = ${ambienteActual()}
      AND NOT EXISTS (SELECT 1 FROM crm_negocios_credito x WHERE x.credit_id = cr.id)
      AND (c.empresa_id = ${n.empresa_id as string}
           OR cr.fecha_ministracion BETWEEN ${dispersadoEl}::date - ${VENTANA_DIAS}::int AND ${dispersadoEl}::date + ${VENTANA_DIAS}::int)
    ORDER BY cr.fecha_ministracion DESC NULLS LAST
    LIMIT 500
  `;
  const nombres = [n.nombre as string, ...(n.razon_social ? [n.razon_social as string] : [])];
  return {
    ligado: null,
    sugerencias: sugerirCreditos({ empresaId: n.empresa_id as string, nombres, monto, dispersadoEl }, creditos.map(mapCredito)),
  };
}

/**
 * Pasa todo de la empresa que creó SIAC (`de`) a la del negocio (`a`) y borra
 * la de SIAC. Lo que choca (un segundo contacto principal, otra oportunidad
 * abierta del mismo tipo, la salud del mismo día) se queda en la de SIAC y se
 * borra con ella. Los datos que le falten a la del negocio se toman de la otra.
 */
async function juntarEmpresas(tx: Tx, a: string, de: string) {
  const movidos: Record<string, number> = {};
  const contar = (k: string, filas: { length: number }) => {
    if (filas.length) movidos[k] = filas.length;
  };
  contar("clientes", await tx`UPDATE col_clients SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  const [{ principal }] = await tx`SELECT EXISTS (SELECT 1 FROM crm_personas WHERE empresa_id = ${a} AND es_principal AND vigente) AS principal`;
  if (principal) await tx`UPDATE crm_personas SET es_principal = false WHERE empresa_id = ${de} AND es_principal`;
  contar("personas", await tx`UPDATE crm_personas SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  contar("actividades", await tx`UPDATE crm_actividades SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  contar("tareas", await tx`UPDATE crm_tareas SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  const [{ oportunidades }] = await tx`SELECT to_regclass('public.crm_oportunidades') IS NOT NULL AS oportunidades`;
  if (oportunidades) {
    contar(
      "oportunidades",
      await tx`
        UPDATE crm_oportunidades o SET empresa_id = ${a}
        WHERE o.empresa_id = ${de}
          AND NOT (o.estado IN ('abierta', 'en_contacto', 'interesado') AND EXISTS (
            SELECT 1 FROM crm_oportunidades x WHERE x.empresa_id = ${a} AND x.tipo = o.tipo AND x.estado IN ('abierta', 'en_contacto', 'interesado')
          ))
        RETURNING o.id
      `,
    );
  }
  const [{ salud }] = await tx`SELECT to_regclass('public.crm_salud_diaria') IS NOT NULL AS salud`;
  if (salud) {
    await tx`
      UPDATE crm_salud_diaria s SET empresa_id = ${a}
      WHERE s.empresa_id = ${de} AND NOT EXISTS (SELECT 1 FROM crm_salud_diaria x WHERE x.empresa_id = ${a} AND x.fecha = s.fecha)
    `;
  }
  contar("negocios", await tx`UPDATE crm_negocios_credito SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  await tx`
    UPDATE crm_empresas e SET
      razon_social = COALESCE(e.razon_social, o.razon_social),
      nombre_comercial = COALESCE(e.nombre_comercial, o.nombre_comercial),
      industria = COALESCE(e.industria, o.industria),
      scian_code = COALESCE(e.scian_code, o.scian_code),
      sitio_web = COALESCE(e.sitio_web, o.sitio_web),
      ejecutivo_email = COALESCE(e.ejecutivo_email, o.ejecutivo_email),
      updated_at = now()
    FROM crm_empresas o
    WHERE e.id = ${a} AND o.id = ${de}
  `;
  await tx`UPDATE crm_empresas SET creada_desde_cliente = NULL WHERE id = ${de}`;
  await tx`DELETE FROM crm_empresas WHERE id = ${de}`;
  return movidos;
}

/**
 * Liga el negocio (dispersado, sin crédito todavía) con un crédito de SIAC,
 * por id (una sugerencia) o por número de crédito. Junta las empresas si toca
 * (comoJuntar). Todo en una transacción; la auditoría, después.
 */
export async function ligarCreditoSiac(p: { negocioId: string; creditId?: string; noCredito?: string; actor: string }) {
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
    if (j.credit_id) throw new NegocioError("Este negocio ya está ligado a un crédito de SIAC.");

    const [c] = p.creditId
      ? await tx`
          SELECT cr.id, cr.no_credito, c.id AS client_id, c.nombre AS cliente, c.empresa_id
          FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
          WHERE cr.id = ${p.creditId} AND cr.ambiente = ${ambiente}
        `
      : await tx`
          SELECT cr.id, cr.no_credito, c.id AS client_id, c.nombre AS cliente, c.empresa_id
          FROM col_credits cr JOIN col_clients c ON c.id = cr.client_id
          WHERE upper(trim(cr.no_credito)) = upper(trim(${p.noCredito ?? ""})) AND cr.ambiente = ${ambiente}
        `;
    if (!c) throw new NegocioError(p.creditId ? "Ese crédito no existe." : `No encontramos el crédito ${p.noCredito} en SIAC. Revisa el número; aparece hasta la foto del día siguiente a la dispersión.`);
    const [otro] = await tx`SELECT id FROM crm_negocios_credito WHERE credit_id = ${c.id}`;
    if (otro) throw new NegocioError(`El crédito ${c.no_credito} ya está ligado a otro negocio.`);

    const empresaNegocio = n.empresa_id as string;
    let accion: "misma" | "juntar" | "asignar" = "asignar";
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
    } else {
      // El cliente todavía no tiene empresa (la foto aún no la crea): queda con la del negocio.
      if (en.clientes > 0) throw new NegocioError(`${en.nombre} ya es cliente con otra razón social. Revisa que sea el crédito correcto.`);
      await tx`UPDATE col_clients SET empresa_id = ${empresaNegocio} WHERE id = ${c.client_id as string}`;
    }
    await tx`
      UPDATE crm_negocios_credito SET credit_id = ${c.id as string}, ligado_siac_por = ${p.actor}, ligado_siac_at = now(), updated_by = ${p.actor}, updated_at = now()
      WHERE id = ${p.negocioId}
    `;
    return { creditId: c.id as string, noCredito: c.no_credito as string, cliente: c.cliente as string, accion, empresaBorrada, movidos };
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

/** Negocios dispersados que todavía no se ligan a su crédito; null si la base no tiene la columna. */
export async function dispersadosSinLigar(): Promise<number | null> {
  const [col] = await sql`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_negocios_credito' AND column_name = 'credit_id'
  `;
  if (!col) return null;
  const [r] = await sql`SELECT count(*)::int AS n FROM crm_negocios_credito WHERE ambiente = ${ambienteActual()} AND etapa = 'dispersado' AND credit_id IS NULL`;
  return r.n as number;
}
