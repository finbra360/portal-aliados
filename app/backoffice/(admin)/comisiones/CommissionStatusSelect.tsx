"use client";

import { useTransition } from "react";
import type { CommissionPaymentStatus } from "@/lib/db/commission-payments";

const STATUSES: CommissionPaymentStatus[] = ["generada", "aprobada", "pagada"];

export default function CommissionStatusSelect({
  current,
  onChange,
}: {
  current: CommissionPaymentStatus;
  onChange: (estatus: CommissionPaymentStatus) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={current}
      disabled={isPending}
      onChange={(e) => startTransition(() => onChange(e.target.value as CommissionPaymentStatus))}
      className="rounded-lg border border-black/10 px-2 py-1 text-xs disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
