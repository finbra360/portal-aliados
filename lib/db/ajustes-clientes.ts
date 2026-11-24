// Ajustes de Clientes en crm_settings que se editan desde Clientes → Ajustes:
// salud del cliente, playbooks y ejecutivo por omisión. Cada cambio queda en
// audit_log con lo de antes y lo de después.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { getAjustesSalud } from "@/lib/db/salud";
import { getAjustesPlaybooks } from "@/lib/db/playbooks";
import { diferencias, valoresDe, type ClaveAjustes, type ValorAjustes } from "@/lib/clientes/ajustes";

export class AjustesError extends Error {}

const DESCRIPCION: Record<ClaveAjustes, string> = {
  salud: "Pesos y cortes de la salud del cliente (lib/clientes/salud.ts). Se editan en Clientes → Ajustes.",
  playbooks: "Tareas automáticas (lib/clientes/playbooks.ts). Se editan en Clientes → Ajustes.",
};

export async function getAjustesClientes() {
  const [salud, playbooks, [omision]] = await Promise.all([
    getAjustesSalud(),
    getAjustesPlaybooks(),
    sql`SELECT value->>'email' AS email, updated_by, updated_at FROM crm_settings WHERE key = 'ejecutivo_por_omision'`,
  ]);
  return {
    salud: valoresDe("salud", salud),
    playbooks: valoresDe("playbooks", playbooks),
    ejecutivoPorOmision: (omision?.email as string) ?? null,
  };
}

/** Guarda un grupo de ajustes ya validado (validarAjustes). Regresa cuántos valores cambiaron. */
export async function guardarAjustes(p: { clave: ClaveAjustes; valor: ValorAjustes; actor: string }): Promise<number> {
  const antes = (await getAjustesClientes())[p.clave];
  const cambios = diferencias(antes, p.valor);
  if (Object.keys(cambios).length === 0) return 0;
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES (${p.clave}, ${JSON.stringify(p.valor)}::text::jsonb, ${DESCRIPCION[p.clave]}, ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({ actorEmail: p.actor, action: "ajustes_clientes", entityType: "crm_settings", entityId: p.clave, metadata: { cambios } });
  return Object.keys(cambios).length;
}

/** Ejecutivo que queda en cada empresa nueva. null = sin asignar. */
export async function guardarEjecutivoPorOmision(p: { email: string | null; actor: string }): Promise<boolean> {
  const email = p.email?.trim().toLowerCase() || null;
  if (email) {
    const [u] = await sql`SELECT 1 FROM admin_users WHERE email = ${email} AND activo`;
    if (!u) throw new AjustesError("El ejecutivo tiene que ser un usuario activo del backoffice.");
  }
  const { ejecutivoPorOmision: antes } = await getAjustesClientes();
  if (antes === email) return false;
  await sql`
    INSERT INTO crm_settings (key, value, descripcion, updated_by, updated_at)
    VALUES ('ejecutivo_por_omision', ${JSON.stringify({ email })}::text::jsonb,
            'Correo del usuario del backoffice (admin_users) que queda como ejecutivo de cada empresa nueva. null = sin asignar.', ${p.actor}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  await logAudit({
    actorEmail: p.actor,
    action: "ajustes_clientes",
    entityType: "crm_settings",
    entityId: "ejecutivo_por_omision",
    metadata: { cambios: { email: { antes, despues: email } } },
  });
  return true;
}
