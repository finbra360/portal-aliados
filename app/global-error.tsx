"use client";

import { useEffect } from "react";

// Último recurso: se muestra cuando falla el layout raíz, así que no puede depender
// de Tailwind, de componentes ni de nada más que haya podido fallar.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f7f7fb", color: "#000" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 380, background: "#fff", padding: 32, borderRadius: 12, textAlign: "center", border: "1px solid rgba(93,91,219,0.1)" }}>
            <h1 style={{ margin: "0 0 8px", fontSize: 22, color: "#5d5bdb" }}>Algo salió mal</h1>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#5d5d5d" }}>
              Tuvimos un problema al cargar el portal. Intenta de nuevo; si sigue fallando, contacta a Finbra.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ background: "#5d5bdb", color: "#fff", border: 0, borderRadius: 8, padding: "10px 24px", fontWeight: 700, cursor: "pointer" }}
            >
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
