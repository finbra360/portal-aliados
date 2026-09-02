"use client";

import { useTransition } from "react";
import type { OperationStatus } from "@/components/ui/StatusPill";

const STAGES: OperationStatus[] = [
  "recibida",
  "documentacion_pendiente",
  "en_analisis",
  "aprobada",
  "formalizacion",
  "fondeada",
  "rechazada",
];

export default function StageSelect({
  id,
  current,
  action,
}: {
  id: number;
  current: OperationStatus;
  action: (id: number, etapa: OperationStatus) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={current}
      disabled={isPending}
      onChange={(e) => startTransition(() => action(id, e.target.value as OperationStatus))}
      className="rounded-lg border border-black/10 px-2 py-1 text-xs disabled:opacity-50"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
