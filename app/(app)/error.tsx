"use client";

import { useEffect } from "react";
import Card from "@/components/ui/Card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="font-medium">Algo salió mal</p>
      <p className="max-w-sm text-sm text-finbra-gray">
        Tuvimos un problema al cargar esta página. Intenta de nuevo — si sigue fallando, contacta a Finbra.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-lg bg-finbra-purple px-6 py-2 text-sm font-bold text-white"
      >
        Reintentar
      </button>
    </Card>
  );
}
