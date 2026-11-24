"use client";

import { useActionState, useState } from "react";
import { ORIGENES_NEGOCIO, TIPOS_NEGOCIO } from "@/lib/clientes/negocios";
import { crearNegocioAction } from "../actions";

const campo = "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm";
const etiqueta = "block text-sm font-medium";

type EmpresaOpcion = { id: string; nombre: string; rfc: string | null; esCliente: boolean };

/**
 * Formulario de alta. Con «Empresa de Clientes» se elige una que ya existe; con
 * «Empresa nueva» se da de alta como prospecto junto con su contacto.
 */
export default function NuevoNegocio({
  empresas,
  ejecutivos,
  yo,
  empresaInicial,
}: {
  empresas: EmpresaOpcion[];
  ejecutivos: { email: string; nombre: string }[];
  yo: string;
  empresaInicial: string | null;
}) {
  const [r, accion, guardando] = useActionState(crearNegocioAction, null);
  const [modo, setModo] = useState<"existente" | "nueva">(empresaInicial || empresas.length > 0 ? "existente" : "nueva");
  const [empresaId, setEmpresaId] = useState(empresaInicial ?? "");
  const elegida = empresas.find((e) => e.id === empresaId);

  return (
    <form action={accion} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Empresa</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="De qué empresa es">
          {(
            [
              ["existente", "Empresa de Clientes"],
              ["nueva", "Empresa nueva"],
            ] as const
          ).map(([v, t]) => (
            <label key={v} className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium ${modo === v ? "bg-finbra-purple text-white" : "bg-black/5 text-finbra-gray hover:bg-black/10"}`}>
              <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => setModo(v)} className="sr-only" />
              {t}
            </label>
          ))}
        </div>

        {modo === "existente" ? (
          <div className="space-y-1">
            <label htmlFor="empresaId" className={etiqueta}>Empresa</label>
            <select id="empresaId" name="empresaId" required value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo}>
              <option value="" disabled>Elige una empresa</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.rfc ? ` · ${e.rfc}` : ""}
                  {e.esCliente ? "" : " · prospecto"}
                </option>
              ))}
            </select>
            <p className="text-xs text-finbra-gray">¿No está? Elige «Empresa nueva» y se da de alta como prospecto.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="empresaNombre" className={etiqueta}>Nombre de la empresa</label>
              <input id="empresaNombre" name="empresaNombre" required maxLength={200} className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="empresaRazonSocial" className={etiqueta}>Razón social <span className="font-normal text-finbra-gray">(opcional)</span></label>
              <input id="empresaRazonSocial" name="empresaRazonSocial" maxLength={250} className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="empresaRfc" className={etiqueta}>RFC <span className="font-normal text-finbra-gray">(opcional por ahora)</span></label>
              <input id="empresaRfc" name="empresaRfc" maxLength={15} className={`${campo} font-mono uppercase`} />
            </div>
            <p className="text-sm font-semibold sm:col-span-2">Persona de contacto <span className="font-normal text-finbra-gray">(queda como contacto principal)</span></p>
            <div className="space-y-1">
              <label htmlFor="contactoNombre" className={etiqueta}>Nombre</label>
              <input id="contactoNombre" name="contactoNombre" maxLength={150} className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="contactoPuesto" className={etiqueta}>Puesto</label>
              <input id="contactoPuesto" name="contactoPuesto" maxLength={120} className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="contactoTelefono" className={etiqueta}>Teléfono</label>
              <input id="contactoTelefono" name="contactoTelefono" inputMode="tel" placeholder="10 dígitos" className={campo} />
            </div>
            <div className="space-y-1">
              <label htmlFor="contactoCorreo" className={etiqueta}>Correo</label>
              <input id="contactoCorreo" name="contactoCorreo" type="email" className={campo} />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Negocio</legend>
        {modo === "existente" && elegida?.esCliente ? (
          <div className="space-y-1">
            <label htmlFor="tipo" className={etiqueta}>Tipo</label>
            <select id="tipo" name="tipo" defaultValue="renovacion" className={campo}>
              {Object.entries(TIPOS_NEGOCIO).map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="tipo" value="nuevo" />
        )}
        <div className="space-y-1">
          <label htmlFor="origen" className={etiqueta}>De dónde llegó</label>
          <select id="origen" name="origen" required defaultValue="" className={campo}>
            <option value="" disabled>Elige el origen</option>
            {Object.entries(ORIGENES_NEGOCIO).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="montoEstimado" className={etiqueta}>Monto estimado <span className="font-normal text-finbra-gray">(opcional)</span></label>
          <input id="montoEstimado" name="montoEstimado" inputMode="decimal" placeholder="1,500,000" className={`${campo} tabular-nums`} />
        </div>
        <div className="space-y-1">
          <label htmlFor="responsableEmail" className={etiqueta}>Responsable</label>
          <select id="responsableEmail" name="responsableEmail" defaultValue={ejecutivos.some((u) => u.email === yo) ? yo : ""} className={campo}>
            <option value="">Yo</option>
            {ejecutivos.map((u) => (
              <option key={u.email} value={u.email}>{u.nombre}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="notas" className={etiqueta}>Notas <span className="font-normal text-finbra-gray">(opcional)</span></label>
          <textarea id="notas" name="notas" rows={3} maxLength={4000} className={campo} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-4">
        <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {guardando ? "Creando…" : "Crear negocio"}
        </button>
        <p className="text-xs text-finbra-gray">Entra como Prospecto. El monto no es una oferta ni una aprobación.</p>
        {r && !r.ok && <p className="w-full text-sm text-red-700" role="alert">{r.error}</p>}
      </div>
    </form>
  );
}
