"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatClabe, instruccionesDePago, type CuentaPago } from "@/lib/collections/payment-accounts";
import { formatFechaHora } from "@/lib/format";
import { asignarCuentaAction } from "./actions";

export default function CuentaPagoPanel({
  clientId,
  actual,
  cuentas,
  creditos,
}: {
  clientId: string;
  actual: { id: string; alias: string; banco: string; beneficiario: string; clabe: string; por: string | null; at: string | null } | null;
  cuentas: CuentaPago[];
  creditos: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (cuentas.length === 0 && !actual) {
    return (
      <p className="text-sm text-finbra-gray">
        Todavía no hay cuentas de pago dadas de alta.{" "}
        <Link href="/backoffice/cobranza/cuentas" className="font-medium text-finbra-purple hover:underline">
          Da de alta la primera
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="text-finbra-gray">Paga a</span>
        <select
          value={actual?.id ?? ""}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              setError(null);
              const r = await asignarCuentaAction(clientId, e.target.value);
              if (!r.ok) setError(r.error);
            })
          }
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">Sin cuenta</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.alias} · {c.banco} · termina en {c.clabe.slice(-4)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-red-700" role="alert">{error}</p>}

      {actual ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-finbra-gray">Banco</dt>
            <dd>{actual.banco}</dd>
            <dt className="text-finbra-gray">Beneficiario</dt>
            <dd>{actual.beneficiario}</dd>
            <dt className="text-finbra-gray">CLABE</dt>
            <dd className="font-mono">{formatClabe(actual.clabe)}</dd>
          </dl>
          <div className="rounded-lg bg-finbra-purple/5 p-3">
            <p className="mb-1 text-xs font-medium text-finbra-gray">Así aparece en el recordatorio</p>
            <p>{instruccionesDePago(actual, creditos)}</p>
          </div>
          {actual.por && (
            <p className="text-xs text-finbra-gray">
              Elegida por {actual.por}
              {actual.at && <> el {formatFechaHora(actual.at)}</>}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Sin cuenta de pago: este cliente no recibirá recordatorios hasta que se le asigne una.</p>
      )}
    </div>
  );
}
