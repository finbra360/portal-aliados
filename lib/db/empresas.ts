// Empresas (crm_empresas): una por razón social. Ver lib/db/crm-schema.sql.
// Las cifras de crédito se leen de las tablas col_* que llena la sincronización
// con SIAC; aquí nunca se escriben.

import { sql, type Tx } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual, getUmbralesSemaforo } from "@/lib/db/collections";
import { getSetting } from "@/lib/collections/store";
import { UMBRAL_MORA_DEFAULT, fechaMexico } from "@/lib/collections/rules";
import { validarRfc } from "@/lib/clientes/rfc";
import {
  buildEmpresasLista,
  resumirEmpresa,
  type CreditoEmpresaRow,
  type EmpresaFilter,
  type EmpresaOrder,
  type EmpresaRow,
} from "@/lib/clientes/lista";

export class EmpresaError extends Error {}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapEmpresa(r: Record<string, unknown>): EmpresaRow {
  return {
    empresaId: r.id as string,
    nombre: r.nombre as string,
    razonSocial: (r.razon_social as string) ?? null,
    rfc: (r.rfc as string) ?? null,
    industria: (r.industria as string) ?? null,
    ejecutivoEmail: (r.ejecutivo_email as string) ?? null,
    ejecutivoNombre: (r.ejecutivo_nombre as string) ?? null,
    numerosCliente: (r.numeros as string[]) ?? [],
  };
}

function mapCredito(r: Record<string, unknown>): CreditoEmpresaRow {
  return {
    empresaId: r.empresa_id as string,
    creditId: r.id as string,
    noCredito: r.no_credito as string,
    enListado: r.en_listado as boolean,
    etapaManual: (r.etapa_manual as string) ?? null,
    montoCredito: num(r.monto_credito),
    fechaTermino: (r.fecha_termino as string) ?? null,
    adeudo: num(r.total_adeudo),
    vencido: num(r.total_vencido),
    atraso: num(r.antiguedad),
    proximoVencimiento: (r.proximo_vencimiento as string) ?? null,
    montoSiguiente: num(r.monto_siguiente_vencimiento),
    vecesMora: num(r.numero_veces_mora),
    atrasoMaximo: num(r.atraso_maximo),
  };
}

// Fragmento nuevo en cada consulta: un fragmento de postgres.js no se reutiliza.
const empresaSelect = () => sql`
  SELECT e.id, e.nombre, e.razon_social, e.rfc, e.industria, e.ejecutivo_email, a.nombre AS ejecutivo_nombre,
         coalesce(array_agg(c.numero_cliente ORDER BY c.numero_cliente) FILTER (WHERE c.id IS NOT NULL), '{}') AS numeros
  FROM crm_empresas e
  LEFT JOIN admin_users a ON a.email = e.ejecutivo_email
  LEFT JOIN col_clients c ON c.empresa_id = e.id
`;

/**
 * Todas las empresas del ambiente con los totales de la última foto completa
 * (la misma que usa la lista de Cobranza), para la lista de Clientes.
 */
export async function getEmpresasLista(fechaCorte: string | null, opts: { filtro: EmpresaFilter; q: string; orden: EmpresaOrder; yo: string }) {
  const ambiente = ambienteActual();
  const [empresas, creditos, umbral, umbralesSemaforo] = await Promise.all([
    sql`${empresaSelect()} WHERE e.ambiente = ${ambiente} GROUP BY e.id, a.nombre`,
    sql`
      SELECT c.empresa_id, cr.id, cr.no_credito, cr.en_listado, cr.etapa_manual, cr.monto_credito,
             to_char(cr.fecha_termino_contrato, 'YYYY-MM-DD') AS fecha_termino,
             s.total_adeudo, s.total_vencido, s.antiguedad, s.monto_siguiente_vencimiento, s.numero_veces_mora, s.atraso_maximo,
             to_char(s.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento
      FROM col_credits cr
      JOIN col_clients c ON c.id = cr.client_id
      LEFT JOIN col_credit_snapshots s ON s.credit_id = cr.id AND s.fecha_corte = ${fechaCorte}::date
      WHERE cr.ambiente = ${ambiente} AND c.empresa_id IS NOT NULL
    `,
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getUmbralesSemaforo(),
  ]);
  return buildEmpresasLista(empresas.map(mapEmpresa), creditos.map(mapCredito), umbral, fechaMexico(), opts, umbralesSemaforo);
}

export interface FichaCredito extends CreditoEmpresaRow {
  clientId: string;
  numeroCliente: string;
  tipoCredito: string | null;
  fechaMinistracion: string | null;
  vencimientos: number | null;
  cubiertos: number | null;
  vencidos: number | null;
  ultimoPago: string | null;
  promotor: string | null;
  /** Fecha de la foto de la que salen sus montos (la más reciente que tenga). */
  fechaCorte: string | null;
}

/** Ficha de la empresa: datos, clientes de SIAC ligados y todos sus créditos con su foto más reciente. */
export async function getEmpresa(id: string) {
  const ambiente = ambienteActual();
  const [e] = await sql`
    SELECT e.*, a.nombre AS ejecutivo_nombre,
           coalesce((SELECT array_agg(c.numero_cliente ORDER BY c.numero_cliente) FROM col_clients c WHERE c.empresa_id = e.id), '{}') AS numeros
    FROM crm_empresas e LEFT JOIN admin_users a ON a.email = e.ejecutivo_email
    WHERE e.id = ${id} AND e.ambiente = ${ambiente}
  `;
  if (!e) return null;

  const [clientes, creditos, umbral, umbralesSemaforo] = await Promise.all([
    sql`SELECT id, numero_cliente, nombre FROM col_clients WHERE empresa_id = ${id} ORDER BY numero_cliente`,
    sql`
      SELECT c.empresa_id, cr.id, cr.client_id, c.numero_cliente, cr.no_credito, cr.tipo_credito, cr.en_listado, cr.etapa_manual,
             cr.monto_credito, cr.vencimientos, cr.nombre_promotor,
             to_char(cr.fecha_ministracion, 'YYYY-MM-DD') AS fecha_ministracion,
             to_char(cr.fecha_termino_contrato, 'YYYY-MM-DD') AS fecha_termino,
             to_char(s.fecha_corte, 'YYYY-MM-DD') AS fecha_corte,
             s.total_adeudo, s.total_vencido, s.antiguedad, s.monto_siguiente_vencimiento, s.numero_veces_mora, s.atraso_maximo,
             s.vencimientos_cubiertos, s.vencimientos_vencidos,
             to_char(s.proximo_vencimiento, 'YYYY-MM-DD') AS proximo_vencimiento,
             to_char(s.fecha_ultimo_pago, 'YYYY-MM-DD') AS fecha_ultimo_pago
      FROM col_credits cr
      JOIN col_clients c ON c.id = cr.client_id
      LEFT JOIN LATERAL (
        SELECT * FROM col_credit_snapshots WHERE credit_id = cr.id ORDER BY fecha_corte DESC LIMIT 1
      ) s ON true
      WHERE c.empresa_id = ${id}
      ORDER BY cr.en_listado DESC, cr.fecha_termino_contrato NULLS LAST, cr.no_credito
    `,
    getSetting("umbral_mora", UMBRAL_MORA_DEFAULT),
    getUmbralesSemaforo(),
  ]);

  // Un crédito que ya salió del listado conserva su última foto: sus montos ya no cuentan.
  const fichaCreditos: FichaCredito[] = creditos.map((r) => {
    const base = mapCredito(r);
    const vigente = base.enListado;
    return {
      ...base,
      ...(vigente ? {} : { adeudo: null, vencido: null, atraso: null, proximoVencimiento: null, montoSiguiente: null }),
      clientId: r.client_id,
      numeroCliente: r.numero_cliente,
      tipoCredito: r.tipo_credito,
      fechaMinistracion: r.fecha_ministracion,
      vencimientos: num(r.vencimientos),
      cubiertos: num(r.vencimientos_cubiertos),
      vencidos: num(r.vencimientos_vencidos),
      ultimoPago: r.fecha_ultimo_pago,
      promotor: (r.nombre_promotor as string)?.trim() || null,
      fechaCorte: r.fecha_corte,
    };
  });

  return {
    empresa: {
      ...mapEmpresa(e),
      nombreComercial: (e.nombre_comercial as string) ?? null,
      scianCode: (e.scian_code as string) ?? null,
      sitioWeb: (e.sitio_web as string) ?? null,
      notas: (e.notas as string) ?? null,
      origen: e.origen as string,
      createdAt: (e.created_at as Date).toISOString(),
      updatedBy: (e.updated_by as string) ?? null,
      updatedAt: (e.updated_at as Date).toISOString(),
    },
    clientes: clientes.map((c) => ({ id: c.id as string, numeroCliente: c.numero_cliente as string, nombre: c.nombre as string })),
    creditos: fichaCreditos,
    resumen: resumirEmpresa(mapEmpresa(e), fichaCreditos, umbral, fechaMexico(), umbralesSemaforo),
  };
}

export type Ficha = NonNullable<Awaited<ReturnType<typeof getEmpresa>>>;

/** Usuarios activos del backoffice que pueden ser ejecutivos de una empresa. */
export async function listEjecutivos(): Promise<{ email: string; nombre: string }[]> {
  const rows = await sql`SELECT email, nombre FROM admin_users WHERE activo ORDER BY nombre`;
  return rows.map((r) => ({ email: r.email as string, nombre: r.nombre as string }));
}

export interface DatosEmpresa {
  nombre: string;
  razonSocial: string;
  rfc: string;
  nombreComercial: string;
  industria: string;
  sitioWeb: string;
  ejecutivoEmail: string;
  notas: string;
}

const CAMPOS: { campo: keyof DatosEmpresa; columna: string; max: number; etiqueta: string }[] = [
  { campo: "nombre", columna: "nombre", max: 200, etiqueta: "nombre" },
  { campo: "razonSocial", columna: "razon_social", max: 250, etiqueta: "razón social" },
  { campo: "rfc", columna: "rfc", max: 13, etiqueta: "RFC" },
  { campo: "nombreComercial", columna: "nombre_comercial", max: 200, etiqueta: "nombre comercial" },
  { campo: "industria", columna: "industria", max: 120, etiqueta: "industria" },
  { campo: "sitioWeb", columna: "sitio_web", max: 250, etiqueta: "sitio web" },
  { campo: "ejecutivoEmail", columna: "ejecutivo_email", max: 254, etiqueta: "ejecutivo" },
  { campo: "notas", columna: "notas", max: 4000, etiqueta: "notas" },
];

/**
 * Guarda los datos de la empresa. Valida RFC (forma y que no lo tenga otra
 * empresa) y que el ejecutivo sea un usuario activo. Registra en audit_log qué
 * campos cambiaron, con valor anterior y nuevo (las notas, solo que cambiaron).
 */
export async function actualizarEmpresa(p: { id: string; datos: DatosEmpresa; actor: string }): Promise<void> {
  const limpio = Object.fromEntries(CAMPOS.map(({ campo }) => [campo, p.datos[campo].trim() || null])) as Record<keyof DatosEmpresa, string | null>;
  // El RFC se normaliza primero (quita espacios y guiones); su forma la revisa validarRfc.
  const rfc = validarRfc(limpio.rfc);
  if (!rfc.ok) throw new EmpresaError(rfc.error);
  limpio.rfc = rfc.rfc;
  for (const { campo, max, etiqueta } of CAMPOS) {
    if ((limpio[campo]?.length ?? 0) > max) throw new EmpresaError(`El campo ${etiqueta} es demasiado largo (máximo ${max} caracteres).`);
  }
  if (!limpio.nombre) throw new EmpresaError("El nombre no puede quedar vacío.");
  if (limpio.ejecutivoEmail) limpio.ejecutivoEmail = limpio.ejecutivoEmail.toLowerCase();

  const ambiente = ambienteActual();
  const [antes] = await sql`SELECT * FROM crm_empresas WHERE id = ${p.id} AND ambiente = ${ambiente}`;
  if (!antes) throw new EmpresaError("Esa empresa no existe.");
  if (limpio.rfc) {
    const [otra] = await sql`SELECT nombre FROM crm_empresas WHERE ambiente = ${ambiente} AND rfc = ${limpio.rfc} AND id <> ${p.id}`;
    if (otra) throw new EmpresaError(`Ese RFC ya es de ${otra.nombre}.`);
  }
  if (limpio.ejecutivoEmail) {
    const [u] = await sql`SELECT 1 FROM admin_users WHERE email = ${limpio.ejecutivoEmail} AND activo`;
    if (!u) throw new EmpresaError("El ejecutivo tiene que ser un usuario activo del backoffice.");
  }

  const cambios: Record<string, { antes: string | null; despues: string | null } | true> = {};
  for (const { campo, columna } of CAMPOS) {
    const a = (antes[columna] as string | null) ?? null;
    if (a !== limpio[campo]) cambios[columna] = campo === "notas" ? true : { antes: a, despues: limpio[campo] };
  }
  if (Object.keys(cambios).length === 0) return;

  await sql`
    UPDATE crm_empresas SET
      nombre = ${limpio.nombre}, razon_social = ${limpio.razonSocial}, rfc = ${limpio.rfc},
      nombre_comercial = ${limpio.nombreComercial}, industria = ${limpio.industria}, sitio_web = ${limpio.sitioWeb},
      ejecutivo_email = ${limpio.ejecutivoEmail}, notas = ${limpio.notas},
      updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({ actorEmail: p.actor, action: "editar_empresa", entityType: "empresa", entityId: p.id, metadata: { cambios } });
}

/**
 * Crea la empresa de cada cliente de SIAC del ambiente que todavía no tiene una
 * y lo liga (col_clients.empresa_id). Corre dentro de la transacción de la foto
 * diaria, así que un cliente nuevo nunca queda sin empresa. Es idempotente:
 * `creada_desde_cliente` es única, y los clientes ya ligados no se tocan.
 *
 * Si crm-schema.sql todavía no se ha corrido en la base, no hace nada: la foto
 * diaria de cobranza no debe fallar por el módulo de clientes.
 *
 * Regresa cuántos clientes quedaron ligados a una empresa nueva.
 */
export async function vincularEmpresasNuevas(tx: Tx, ambiente: "pruebas" | "produccion"): Promise<number> {
  const [existe] = await tx`SELECT to_regclass('public.crm_empresas') IS NOT NULL AS ok`;
  if (!existe?.ok) return 0;

  await tx`
    INSERT INTO crm_empresas (ambiente, nombre, razon_social, origen, creada_desde_cliente, ejecutivo_email, created_by)
    SELECT c.ambiente, c.nombre, c.nombre, 'siac', c.id,
           (SELECT a.email FROM crm_settings s JOIN admin_users a ON a.email = s.value->>'email' AND a.activo WHERE s.key = 'ejecutivo_por_omision'),
           'sistema'
    FROM col_clients c
    WHERE c.ambiente = ${ambiente} AND c.empresa_id IS NULL
    ON CONFLICT (creada_desde_cliente) DO NOTHING
  `;
  const ligados = await tx`
    UPDATE col_clients c SET empresa_id = e.id
    FROM crm_empresas e
    WHERE e.creada_desde_cliente = c.id AND c.ambiente = ${ambiente} AND c.empresa_id IS NULL
    RETURNING c.id
  `;
  return ligados.length;
}
