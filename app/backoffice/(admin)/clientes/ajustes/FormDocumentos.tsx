"use client";

import { useActionState, useRef } from "react";
import { PRODUCTOS, type Producto } from "@/lib/clientes/negocios";
import type { ListasDocumentos } from "@/lib/clientes/comite";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { guardarDocumentosAction } from "./actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

/**
 * Documentos del expediente de cada producto, uno por renglón. Cambiar el
 * nombre de un documento lo vuelve uno nuevo (pendiente en todos los negocios).
 */
export function FormDocumentos({ listas, omision }: { listas: ListasDocumentos; omision: ListasDocumentos }) {
  const [r, accion, guardando] = useActionState(guardarDocumentosAction, null);
  const form = useRef<HTMLFormElement>(null);

  function llenarOmision() {
    for (const p of Object.keys(PRODUCTOS) as Producto[]) {
      const el = form.current?.elements.namedItem(`docs_${p}`) as HTMLTextAreaElement | null;
      if (el) el.value = omision[p].join("\n");
    }
  }

  return (
    <form ref={form} onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      {(Object.entries(PRODUCTOS) as [Producto, string][]).map(([p, nombre]) => (
        <div key={p} className="space-y-1">
          <label htmlFor={`docs_${p}`} className="block text-sm font-medium">{nombre}</label>
          <textarea
            id={`docs_${p}`}
            name={`docs_${p}`}
            rows={Math.min(14, listas[p].length + 1)}
            defaultValue={listas[p].join("\n")}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          />
        </div>
      ))}
      <p className="text-xs text-finbra-gray">
        Un documento por renglón. Si cambias el nombre de uno, cuenta como documento nuevo y queda pendiente en los negocios abiertos; los que quites dejan de pedirse.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : "Guardar documentos"}</button>
        <button type="button" onClick={llenarOmision} className="text-sm text-finbra-purple hover:underline">Volver a la lista de siempre</button>
        {r && (r.ok ? <p className="text-sm text-emerald-700" role="status">{r.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{r.error}</p>)}
      </div>
    </form>
  );
}
