// Catálogo de cuentas de pago de Finbra y la cuenta a la que paga cada cliente.
// Cambiar la cuenta de un cliente deja una entrada en su timeline; todo cambio
// queda en audit_log.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { formatClabe, validarCuenta, type CuentaPago } from "@/lib/collections/payment-accounts";
import type { Tx } from "@/lib/collections/store";

export class PaymentAccountError extends Error {}

export interface CuentaConUso extends CuentaPago {
  clientes: number;
  createdBy: string;
  updatedBy: string | null;
}

const mapCuenta = (r: Record<string, unknown>): CuentaPago => ({
  id: r.id as string,
  alias: r.alias as string,
  banco: r.banco as string,
  beneficiario: r.beneficiario as string,
  clabe: r.clabe as string,
  activa: Boolean(r.activa),
});

/** Catálogo completo con cuántos clientes del ambiente pagan a cada cuenta. */
export async function listCuentas(): Promise<{ cuentas: CuentaConUso[]; clientesSinCuenta: number }> {
  const ambiente = ambienteActual();
  const [cuentas, [sin]] = await Promise.all([
    sql`
      SELECT a.*, (SELECT count(*)::int FROM col_clients c WHERE c.cuenta_pago_id = a.id AND c.ambiente = ${ambiente}) AS clientes
      FROM col_payment_accounts a
      ORDER BY a.activa DESC, a.alias
    `,
    sql`
      SELECT count(*)::int AS n FROM col_clients c
      WHERE c.ambiente = ${ambiente} AND c.cuenta_pago_id IS NULL
        AND EXISTS (SELECT 1 FROM col_credits cr WHERE cr.client_id = c.id AND cr.en_listado)
    `,
  ]);
  return {
    cuentas: cuentas.map((r) => ({ ...mapCuenta(r), clientes: r.clientes, createdBy: r.created_by, updatedBy: r.updated_by ?? null })),
    clientesSinCuenta: sin.n,
  };
}

export async function listCuentasActivas(): Promise<CuentaPago[]> {
  const rows = await sql`SELECT * FROM col_payment_accounts WHERE activa ORDER BY alias`;
  return rows.map(mapCuenta);
}

export async function crearCuenta(p: { alias: string; banco: string; beneficiario: string; clabe: string; actor: string }) {
  const v = validarCuenta(p);
  if (!v.ok) throw new PaymentAccountError(v.error);
  const [existe] = await sql`SELECT alias FROM col_payment_accounts WHERE clabe = ${v.clabe}`;
  if (existe) throw new PaymentAccountError(`Esa CLABE ya está dada de alta como "${existe.alias}"`);
  const [row] = await sql`
    INSERT INTO col_payment_accounts (alias, banco, beneficiario, clabe, created_by)
    VALUES (${v.alias}, ${v.banco}, ${v.beneficiario}, ${v.clabe}, ${p.actor})
    RETURNING id
  `;
  await logAudit({
    actorEmail: p.actor,
    action: "cobranza_cuenta_alta",
    entityType: "col_payment_account",
    entityId: row.id,
    metadata: { alias: v.alias, banco: v.banco, clabe: v.clabe },
  });
  return row.id as string;
}

/** Edita alias, banco y beneficiario. La CLABE no se edita: otra CLABE es otra cuenta. */
export async function editarCuenta(p: { id: string; alias: string; banco: string; beneficiario: string; actor: string }) {
  const v = validarCuenta({ alias: p.alias, banco: p.banco, beneficiario: p.beneficiario });
  if (!v.ok) throw new PaymentAccountError(v.error);
  const [antes] = await sql`SELECT alias, banco, beneficiario FROM col_payment_accounts WHERE id = ${p.id}`;
  if (!antes) throw new PaymentAccountError("No encontramos esa cuenta");
  await sql`
    UPDATE col_payment_accounts SET alias = ${v.alias}, banco = ${v.banco}, beneficiario = ${v.beneficiario},
           updated_by = ${p.actor}, updated_at = now()
    WHERE id = ${p.id}
  `;
  await logAudit({
    actorEmail: p.actor,
    action: "cobranza_cuenta_edicion",
    entityType: "col_payment_account",
    entityId: p.id,
    metadata: { antes, despues: { alias: v.alias, banco: v.banco, beneficiario: v.beneficiario } },
  });
}

/** No se puede desactivar una cuenta a la que todavía pagan clientes. */
export async function setCuentaActiva(p: { id: string; activa: boolean; actor: string }) {
  if (!p.activa) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM col_clients WHERE cuenta_pago_id = ${p.id}`;
    if (n > 0) {
      throw new PaymentAccountError(`${n === 1 ? "Un cliente paga" : `${n} clientes pagan`} a esta cuenta. Asígnales otra antes de desactivarla.`);
    }
  }
  const r = await sql`UPDATE col_payment_accounts SET activa = ${p.activa}, updated_by = ${p.actor}, updated_at = now() WHERE id = ${p.id}`;
  if (r.count === 0) throw new PaymentAccountError("No encontramos esa cuenta");
  await logAudit({ actorEmail: p.actor, action: p.activa ? "cobranza_cuenta_activada" : "cobranza_cuenta_desactivada", entityType: "col_payment_account", entityId: p.id });
}

async function cambiarCuentaTx(tx: Tx, clientId: string, cuenta: CuentaPago | null, anterior: string | null, actor: string) {
  await tx`UPDATE col_clients SET cuenta_pago_id = ${cuenta?.id ?? null}, cuenta_pago_por = ${actor}, cuenta_pago_at = now() WHERE id = ${clientId}`;
  const descripcion = cuenta
    ? `Paga a ${cuenta.alias} (${cuenta.banco}, CLABE ${formatClabe(cuenta.clabe)})`
    : "Se quitó la cuenta de pago: no recibirá recordatorios hasta que se le asigne una";
  await tx`
    INSERT INTO col_activities (client_id, tipo, descripcion, metadata, actor)
    VALUES (${clientId}, 'cambio_cuenta_pago', ${descripcion}, ${JSON.stringify({ cuentaAnterior: anterior, cuentaNueva: cuenta?.id ?? null })}::jsonb, ${actor})
  `;
  if (cuenta) {
    await tx`
      UPDATE col_alerts SET estado = 'atendida', atendida_por = ${actor}, atendida_at = now()
      WHERE client_id = ${clientId} AND tipo = 'sin_cuenta_pago' AND estado = 'abierta'
    `;
  }
}

async function cuentaActiva(tx: Tx, id: string): Promise<CuentaPago> {
  const [r] = await tx`SELECT * FROM col_payment_accounts WHERE id = ${id}`;
  if (!r) throw new PaymentAccountError("No encontramos esa cuenta");
  if (!r.activa) throw new PaymentAccountError("Esa cuenta está desactivada");
  return mapCuenta(r);
}

/** Elige la cuenta a la que paga un cliente (o la quita, con `cuentaId` null). */
export async function asignarCuenta(p: { clientId: string; cuentaId: string | null; actor: string }) {
  await sql.begin(async (tx) => {
    const [c] = await tx`SELECT id, cuenta_pago_id FROM col_clients WHERE id = ${p.clientId} AND ambiente = ${ambienteActual()} FOR UPDATE`;
    if (!c) throw new PaymentAccountError("No encontramos ese cliente");
    if (c.cuenta_pago_id === p.cuentaId) return;
    const cuenta = p.cuentaId ? await cuentaActiva(tx, p.cuentaId) : null;
    await cambiarCuentaTx(tx, p.clientId, cuenta, c.cuenta_pago_id, p.actor);
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_cuenta_cliente", entityType: "col_client", entityId: p.clientId, metadata: { cuentaId: p.cuentaId } });
}

/** Asigna una cuenta a todos los clientes activos que todavía no tienen. Regresa cuántos fueron. */
export async function asignarCuentaASinCuenta(p: { cuentaId: string; actor: string }): Promise<number> {
  let n = 0;
  await sql.begin(async (tx) => {
    const cuenta = await cuentaActiva(tx, p.cuentaId);
    const clientes = await tx`
      SELECT c.id FROM col_clients c
      WHERE c.ambiente = ${ambienteActual()} AND c.cuenta_pago_id IS NULL
        AND EXISTS (SELECT 1 FROM col_credits cr WHERE cr.client_id = c.id AND cr.en_listado)
      FOR UPDATE
    `;
    for (const c of clientes) await cambiarCuentaTx(tx, c.id, cuenta, null, p.actor);
    n = clientes.length;
  });
  await logAudit({ actorEmail: p.actor, action: "cobranza_cuenta_asignacion_masiva", entityType: "col_payment_account", entityId: p.cuentaId, metadata: { clientes: n } });
  return n;
}
