"use client";

import { useTransition } from "react";
import type { LeadEstatusComercial } from "@/lib/db/leads";

const ESTATUSES: LeadEstatusComercial[] = [
  "nuevo",
  "en_revision_hitl",
  "contactado",
  "reunion_agendada",
  "oportunidad",
  "rechazado",
  "cliente",
  "descartado",
];

export default function EstatusSelect({
  id,
  current,
  action,
}: {
  id: string;
  current: LeadEstatusComercial;
  action: (id: string, estatus: LeadEstatusComercial) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={current}
      disabled={isPending}
      onChange={(e) => startTransition(() => action(id, e.target.value as LeadEstatusComercial))}
      className="rounded-lg border border-black/10 px-2 py-1 text-xs disabled:opacity-50"
    >
      {ESTATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
