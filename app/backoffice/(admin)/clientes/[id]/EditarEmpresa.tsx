"use client";

import { useActionState, type ReactNode } from "react";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { editarEmpresaAction, type EmpresaActionResult } from "./actions";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";

export interface EmpresaEditable {
  id: string;
  nombre: string;
  razonSocial: string | null;
  rfc: string | null;
  nombreComercial: string | null;
  industria: string | null;
  sitioWeb: string | null;
  ejecutivoEmail: string | null;
  notas: string | null;
}

function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id} className="text-finbra-gray">{etiqueta}</label>
      {children}
      {ayuda && <p className="text-xs text-finbra-gray">{ayuda}</p>}
    </div>
  );
}

/** Datos de la empresa. Ninguno viene de SIAC ni lo cambia: son del equipo. */
export default function EditarEmpresa({ empresa, ejecutivos }: { empresa: EmpresaEditable; ejecutivos: { email: string; nombre: string }[] }) {
  const [state, accion, guardando] = useActionState(
    (prev: EmpresaActionResult | null, fd: FormData) => editarEmpresaAction(empresa.id, prev, fd),
    null,
  );
  // Un ejecutivo dado de baja sigue apareciendo para no perder el dato al guardar otra cosa.
  const opciones = empresa.ejecutivoEmail && !ejecutivos.some((e) => e.email === empresa.ejecutivoEmail)
    ? [...ejecutivos, { email: empresa.ejecutivoEmail, nombre: `${empresa.ejecutivoEmail} (inactivo)` }]
    : ejecutivos;

  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="emp-nombre" etiqueta="Nombre (como lo conoce el equipo)">
          <input id="emp-nombre" name="nombre" required maxLength={200} defaultValue={empresa.nombre} className={input} />
        </Campo>
        <Campo id="emp-razon" etiqueta="Razón social">
          <input id="emp-razon" name="razonSocial" maxLength={250} defaultValue={empresa.razonSocial ?? ""} className={input} />
        </Campo>
        <Campo id="emp-rfc" etiqueta="RFC" ayuda="12 caracteres si es persona moral, 13 si es física.">
          <input id="emp-rfc" name="rfc" maxLength={15} autoComplete="off" defaultValue={empresa.rfc ?? ""} className={`${input} font-mono uppercase`} />
        </Campo>
        <Campo id="emp-comercial" etiqueta="Nombre comercial">
          <input id="emp-comercial" name="nombreComercial" maxLength={200} defaultValue={empresa.nombreComercial ?? ""} className={input} />
        </Campo>
        <Campo id="emp-industria" etiqueta="Industria o giro">
          <input id="emp-industria" name="industria" maxLength={120} placeholder="Ej. Autotransporte de carga" defaultValue={empresa.industria ?? ""} className={input} />
        </Campo>
        <Campo id="emp-web" etiqueta="Sitio web">
          <input id="emp-web" name="sitioWeb" maxLength={250} inputMode="url" placeholder="ejemplo.com.mx" defaultValue={empresa.sitioWeb ?? ""} className={input} />
        </Campo>
        <Campo id="emp-ejecutivo" etiqueta="Ejecutivo responsable">
          <select id="emp-ejecutivo" name="ejecutivoEmail" defaultValue={empresa.ejecutivoEmail ?? ""} className={input}>
            <option value="">Sin asignar</option>
            {opciones.map((e) => (
              <option key={e.email} value={e.email}>{e.nombre}</option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo id="emp-notas" etiqueta="Notas">
        <textarea id="emp-notas" name="notas" rows={3} maxLength={4000} defaultValue={empresa.notas ?? ""} className={input} />
      </Campo>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
        {state && (state.ok ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{state.error}</p>)}
      </div>
    </form>
  );
}
