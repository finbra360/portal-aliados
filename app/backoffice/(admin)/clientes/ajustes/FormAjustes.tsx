"use client";

import { useActionState, useRef } from "react";
import type { CampoAjuste, ClaveAjustes, ValorAjustes } from "@/lib/clientes/ajustes";
import { guardarAjustesAction, guardarEjecutivoPorOmisionAction } from "./actions";

const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";

function Resultado({ r }: { r: { ok: true; mensaje: string } | { ok: false; error: string } | null }) {
  if (!r) return null;
  return r.ok ? (
    <p className="text-sm text-emerald-700" role="status">
      {r.mensaje}
    </p>
  ) : (
    <p className="text-sm text-red-700" role="alert">
      {r.error}
    </p>
  );
}

/**
 * Formulario de un grupo de ajustes (salud o playbooks), agrupado por tema. Cada
 * campo muestra su valor por omisión; «Volver a los de omisión» solo llena el
 * formulario: hay que guardar para que aplique.
 */
export function FormAjustes({ clave, campos, valores, omision }: { clave: ClaveAjustes; campos: CampoAjuste[]; valores: ValorAjustes; omision: ValorAjustes }) {
  const [r, accion, guardando] = useActionState(guardarAjustesAction.bind(null, clave), null);
  const form = useRef<HTMLFormElement>(null);
  const grupos = [...new Set(campos.map((c) => c.grupo))];
  // Tras un error, React limpia el formulario a sus valores iniciales: se usan
  // los que capturó el usuario para que no los pierda.
  const capturado = r && !r.ok ? r.entrada : undefined;

  function llenarOmision() {
    for (const c of campos) {
      const el = form.current?.elements.namedItem(c.clave) as HTMLInputElement | null;
      if (!el) continue;
      if (c.tipo === "si_no") el.checked = omision[c.clave] as boolean;
      else el.value = String(omision[c.clave]);
    }
  }

  return (
    <form ref={form} action={accion} className="space-y-6">
      {grupos.map((g) => (
        <fieldset key={g} className="space-y-3">
          <legend className="mb-1 text-sm font-semibold">{g}</legend>
          {campos
            .filter((c) => c.grupo === g)
            .map((c) => {
              const id = `${clave}-${c.clave}`;
              const def = omision[c.clave];
              return c.tipo === "si_no" ? (
                <div key={c.clave} className="flex items-start gap-3">
                  <input
                    id={id}
                    name={c.clave}
                    type="checkbox"
                    defaultChecked={capturado ? capturado[c.clave] === "on" : (valores[c.clave] as boolean)}
                    className="mt-0.5 h-4 w-4 accent-finbra-purple"
                  />
                  <label htmlFor={id} className="text-sm">
                    <span className="font-medium">{c.etiqueta}</span>
                    {c.ayuda && <span className="block text-xs text-finbra-gray">{c.ayuda}</span>}
                  </label>
                </div>
              ) : (
                <div key={c.clave} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label htmlFor={id} className="text-sm">
                    <span className="font-medium">{c.etiqueta}</span>
                    <span className="block text-xs text-finbra-gray">
                      {c.ayuda ? `${c.ayuda} ` : ""}Por omisión: {String(def)} {c.unidad}.
                    </span>
                  </label>
                  <span className="flex items-center gap-2">
                    <input
                      id={id}
                      name={c.clave}
                      type="number"
                      inputMode="numeric"
                      min={c.min}
                      max={c.max}
                      step={1}
                      required
                      defaultValue={capturado?.[c.clave] ?? String(valores[c.clave])}
                      className="w-24 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-right text-sm tabular-nums"
                    />
                    <span className="w-12 text-xs text-finbra-gray">{c.unidad}</span>
                  </span>
                </div>
              );
            })}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-4">
        <button type="submit" disabled={guardando} className={boton}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={llenarOmision} className="rounded-lg px-3 py-2 text-sm text-finbra-gray hover:bg-black/5">
          Volver a los de omisión
        </button>
        <Resultado r={r} />
      </div>
    </form>
  );
}

/** Ejecutivo que queda en cada empresa nueva que llega de SIAC. */
export function FormEjecutivoPorOmision({ actual, ejecutivos }: { actual: string | null; ejecutivos: { email: string; nombre: string }[] }) {
  const [r, accion, guardando] = useActionState(guardarEjecutivoPorOmisionAction, null);
  return (
    <form action={accion} className="flex flex-wrap items-center gap-3">
      <label htmlFor="ejecutivo-omision" className="sr-only">
        Ejecutivo por omisión
      </label>
      <select id="ejecutivo-omision" name="email" defaultValue={actual ?? ""} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
        <option value="">Sin asignar</option>
        {ejecutivos.map((u) => (
          <option key={u.email} value={u.email}>
            {u.nombre}
          </option>
        ))}
      </select>
      <button type="submit" disabled={guardando} className={boton}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      <Resultado r={r} />
    </form>
  );
}
