// Juntar dos empresas de Clientes que son la misma: todo pasa a la que se
// queda y la otra se borra. Lo usan la liga con SIAC (lib/db/siac-liga.ts) y
// la pantalla «Empresas por revisar». Las reglas están en lib/clientes/juntar.ts.

import { sql, transaccion, type Tx } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { empresasPorRevisar, validarJuntar, type EmpresaJuntar, type Sugerencia } from "@/lib/clientes/juntar";

export class JuntarError extends Error {}

/**
 * Pasa todo de `de` a `a` y borra `de`: clientes de SIAC, contactos,
 * actividad, tareas, oportunidades, salud y negocios. Lo que choca (un segundo
 * contacto principal, otra oportunidad abierta del mismo tipo, la salud del
 * mismo día) se queda en `de` y se borra con ella. Los datos que le falten a
 * `a` (razón social, RFC, ejecutivo…) se toman de `de`. Regresa cuántas filas
 * se movieron de cada cosa.
 */
export async function juntarEmpresas(tx: Tx, a: string, de: string) {
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
  const [{ negocios }] = await tx`SELECT to_regclass('public.crm_negocios_credito') IS NOT NULL AS negocios`;
  if (negocios) contar("negocios", await tx`UPDATE crm_negocios_credito SET empresa_id = ${a} WHERE empresa_id = ${de} RETURNING id`);
  // El RFC es único por ambiente: se le quita a la que se borra antes de pasarlo.
  const [o] = await tx`SELECT rfc FROM crm_empresas WHERE id = ${de}`;
  await tx`UPDATE crm_empresas SET creada_desde_cliente = NULL, rfc = NULL WHERE id = ${de}`;
  await tx`
    UPDATE crm_empresas e SET
      razon_social = COALESCE(e.razon_social, o.razon_social),
      rfc = COALESCE(e.rfc, ${(o?.rfc as string) ?? null}),
      nombre_comercial = COALESCE(e.nombre_comercial, o.nombre_comercial),
      industria = COALESCE(e.industria, o.industria),
      scian_code = COALESCE(e.scian_code, o.scian_code),
      sitio_web = COALESCE(e.sitio_web, o.sitio_web),
      ejecutivo_email = COALESCE(e.ejecutivo_email, o.ejecutivo_email),
      notas = CASE WHEN o.notas IS NULL THEN e.notas WHEN e.notas IS NULL THEN o.notas ELSE e.notas || E'\n\n' || o.notas END,
      updated_at = now()
    FROM crm_empresas o
    WHERE e.id = ${a} AND o.id = ${de}
  `;
  await tx`DELETE FROM crm_empresas WHERE id = ${de}`;
  return movidos;
}

/** Todas las empresas del ambiente con sus clientes de SIAC y negocios (para validar y sugerir). */
async function empresasParaJuntar(): Promise<EmpresaJuntar[]> {
  const [{ negocios }] = await sql`SELECT to_regclass('public.crm_negocios_credito') IS NOT NULL AS negocios`;
  const filas = negocios
    ? await sql`
        SELECT e.id, e.nombre, e.razon_social,
               (SELECT count(*)::int FROM col_clients c WHERE c.empresa_id = e.id) AS clientes,
               (SELECT count(*)::int FROM crm_negocios_credito n WHERE n.empresa_id = e.id) AS negocios
        FROM crm_empresas e WHERE e.ambiente = ${ambienteActual()}
      `
    : await sql`
        SELECT e.id, e.nombre, e.razon_social, (SELECT count(*)::int FROM col_clients c WHERE c.empresa_id = e.id) AS clientes, 0 AS negocios
        FROM crm_empresas e WHERE e.ambiente = ${ambienteActual()}
      `;
  return filas.map((f) => ({
    id: f.id as string,
    nombre: f.nombre as string,
    razonSocial: (f.razon_social as string) ?? null,
    clientes: Number(f.clientes),
    negocios: Number(f.negocios),
  }));
}

/** Prospectos que ya se revisaron y son otra empresa (crm_settings «empresas_revisadas»). */
async function revisadas(): Promise<Set<string>> {
  const [r] = await sql`SELECT value FROM crm_settings WHERE key = 'empresas_revisadas'`;
  const ids = (r?.value as { ids?: unknown })?.ids;
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
}

export async function getEmpresasPorRevisar(): Promise<{ empresa: EmpresaJuntar; sugerencias: Sugerencia[] }[]> {
  const [empresas, vistas] = await Promise.all([empresasParaJuntar(), revisadas()]);
  return empresasPorRevisar(empresas, vistas);
}

/** Empresas para elegir con cuál juntar una (todas menos ella), por nombre. */
export async function opcionesParaJuntar(id: string): Promise<{ id: string; nombre: string; esCliente: boolean }[]> {
  return (await empresasParaJuntar())
    .filter((e) => e.id !== id)
    .map((e) => ({ id: e.id, nombre: e.nombre, esCliente: e.clientes > 0 }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Junta `seBorra` en `queda` (validarJuntar). Regresa lo que se movió. */
export async function juntarEmpresa(p: { queda: string; seBorra: string; actor: string }) {
  const ambiente = ambienteActual();
  const r = await transaccion(async (tx) => {
    const filas = await tx`
      SELECT e.id, e.nombre, e.razon_social, (SELECT count(*)::int FROM col_clients c WHERE c.empresa_id = e.id) AS clientes
      FROM crm_empresas e WHERE e.id IN (${p.queda}, ${p.seBorra}) AND e.ambiente = ${ambiente}
      ORDER BY e.id FOR UPDATE
    `;
    const de = (id: string) => {
      const f = filas.find((x) => x.id === id);
      if (!f) throw new JuntarError("Esa empresa ya no existe. Recarga la página.");
      return { id: f.id as string, nombre: f.nombre as string, razonSocial: (f.razon_social as string) ?? null, clientes: Number(f.clientes), negocios: 0 };
    };
    const queda = de(p.queda);
    const seBorra = de(p.seBorra);
    const v = validarJuntar(queda, seBorra);
    if (!v.ok) throw new JuntarError(v.error);
    const movidos = await juntarEmpresas(tx, queda.id, seBorra.id);
    return { queda: queda.nombre, seBorra: seBorra.nombre, movidos };
  });
  await logAudit({ actorEmail: p.actor, action: "juntar_empresas", entityType: "empresa", entityId: p.queda, metadata: { empresaBorrada: p.seBorra, nombreBorrada: r.seBorra, movidos: r.movidos } });
  return r;
}

/** Marca un prospecto como otra empresa: ya no sale en «Empresas por revisar». */
export async function marcarRevisada(p: { id: string; actor: string }) {
  const ids = await revisadas();
  if (ids.has(p.id)) return;
  ids.add(p.id);
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('empresas_revisadas', ${JSON.stringify({ ids: [...ids] })}::text::jsonb,
            'Prospectos que se revisaron en Clientes → Empresas por revisar y son una empresa distinta.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: "empresa_revisada", entityType: "empresa", entityId: p.id });
}
