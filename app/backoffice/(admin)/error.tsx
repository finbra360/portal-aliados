"use client";

import { useEffect } from "react";

export default function BackofficeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="font-medium text-red-800">Algo salió mal en esta pantalla</p>
      <p className="text-sm text-red-700">
        Intenta de nuevo. Si sigue fallando{error.digest ? `, avisa con este código: ${error.digest}` : ", avisa al equipo de sistemas"}.
      </p>
      <button type="button" onClick={reset} className="mt-1 rounded-lg bg-finbra-purple px-5 py-2 text-sm font-semibold text-white">
        Reintentar
      </button>
    </div>
  );
}
