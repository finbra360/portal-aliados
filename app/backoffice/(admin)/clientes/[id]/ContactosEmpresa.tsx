"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { CANALES, ROLES_DECISION } from "@/lib/clientes/personas";
import type { Canal, Persona } from "@/lib/db/personas";
import { formatTelefono } from "@/lib/format";
import { enviarSinBorrar } from "../../cobranza/enviarSinBorrar";
import { agregarCanalAction, asignarCanalAction, guardarPersonaAction, type EmpresaActionResult } from "./actions";

const input = "w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm";
const boton = "rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50";
const botonChico = "rounded-lg px-2.5 py-1 text-xs font-semibold text-finbra-purple-700 hover:bg-finbra-purple/10";
const chip = "rounded-full px-2 py-0.5 text-xs";

function Aviso({ state }: { state: EmpresaActionResult | null }) {
  if (!state) return null;
  return state.ok ? <p className="text-sm text-emerald-700" role="status">{state.mensaje}</p> : <p className="text-sm text-red-700" role="alert">{state.error}</p>;
}

const mostrarCanal = (k: Canal) => (k.tipo === "telefono" ? formatTelefono(k.valor) : k.valor);

function FormPersona({ empresaId, persona, alTerminar }: { empresaId: string; persona?: Persona; alTerminar: () => void }) {
  const [state, accion, guardando] = useActionState(async (prev: EmpresaActionResult | null, fd: FormData) => {
    const r = await guardarPersonaAction(empresaId, persona?.id ?? null, prev, fd);
    if (r.ok) alTerminar();
    return r;
  }, null);
  const id = (c: string) => `persona-${persona?.id ?? "nueva"}-${c}`;
  return (
    <form onSubmit={enviarSinBorrar(accion)} className="space-y-3 rounded-xl border border-dashed border-black/10 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={id("nombre")} className="space-y-1 text-sm">
          <span className="text-finbra-gray">Nombre</span>
          <input id={id("nombre")} name="nombre" required maxLength={150} defaultValue={persona?.nombre} className={input} />
        </label>
        <label htmlFor={id("puesto")} className="space-y-1 text-sm">
          <span className="text-finbra-gray">Puesto</span>
          <input id={id("puesto")} name="puesto" maxLength={120} placeholder="Ej. Directora de finanzas" defaultValue={persona?.puesto ?? ""} className={input} />
        </label>
        <label htmlFor={id("rol")} className="space-y-1 text-sm">
          <span className="text-finbra-gray">Papel en la decisión del crédito</span>
          <select id={id("rol")} name="rolDecision" defaultValue={persona?.rolDecision ?? ""} className={input}>
            <option value="">Sin clasificar</option>
            {Object.entries(ROLES_DECISION).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label htmlFor={id("canal")} className="space-y-1 text-sm">
          <span className="text-finbra-gray">Canal preferido</span>
          <select id={id("canal")} name="canalPreferido" defaultValue={persona?.canalPreferido ?? ""} className={input}>
            <option value="">Sin preferencia</option>
            {Object.entries(CANALES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label htmlFor={id("horario")} className="space-y-1 text-sm">
          <span className="text-finbra-gray">Horario preferido</span>
          <input id={id("horario")} name="horarioPreferido" maxLength={120} placeholder="Ej. 9 a 14 h, no los lunes" defaultValue={persona?.horarioPreferido ?? ""} className={input} />
        </label>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="esPrincipal" defaultChecked={persona?.esPrincipal} id={id("principal")} /> Contacto principal
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="esRepresentanteLegal" defaultChecked={persona?.esRepresentanteLegal} id={id("legal")} /> Representante legal
          </label>
          {persona && (
            <label className="flex items-center gap-2">
              {/* El oculto va primero: si la casilla está marcada, su valor gana. */}
              <input type="hidden" name="vigente" value="false" />
              <input type="checkbox" name="vigente" value="true" defaultChecked={persona.vigente} id={id("vigente")} /> Sigue en la empresa
            </label>
          )}
        </div>
      </div>
      <label htmlFor={id("notas")} className="block space-y-1 text-sm">
        <span className="text-finbra-gray">Notas</span>
        <textarea id={id("notas")} name="notas" rows={2} maxLength={2000} defaultValue={persona?.notas ?? ""} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={boton}>{guardando ? "Guardando…" : persona ? "Guardar cambios" : "Agregar persona"}</button>
        <button type="button" onClick={alTerminar} className="text-sm text-finbra-gray hover:underline">Cancelar</button>
        <Aviso state={state} />
      </div>
    </form>
  );
}

function AgregarCanal({ empresaId, personaId }: { empresaId: string; personaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState(0);
  const [state, accion, guardando] = useActionState(async (prev: EmpresaActionResult | null, fd: FormData) => {
    const r = await agregarCanalAction(empresaId, personaId, prev, fd);
    if (r.ok) setForm((n) => n + 1);
    return r;
  }, null);
  if (!abierto) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAbierto(true)} className={botonChico}>+ Teléfono o correo</button>
        {state?.ok && <Aviso state={state} />}
      </span>
    );
  }
  return (
    <form key={form} onSubmit={enviarSinBorrar(accion)} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`canal-tipo-${personaId}`} className="sr-only">Tipo</label>
      <select id={`canal-tipo-${personaId}`} name="tipo" className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm">
        <option value="telefono">Teléfono</option>
        <option value="email">Correo</option>
      </select>
      <label htmlFor={`canal-valor-${personaId}`} className="sr-only">Teléfono o correo</label>
      <input id={`canal-valor-${personaId}`} name="valor" required maxLength={120} placeholder="10 dígitos o correo" className="w-56 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm" />
      <button type="submit" disabled={guardando} className="rounded-lg bg-finbra-purple px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{guardando ? "…" : "Agregar"}</button>
      <button type="button" onClick={() => setAbierto(false)} className="text-xs text-finbra-gray hover:underline">Cerrar</button>
      <Aviso state={state} />
    </form>
  );
}

function AsignarCanal({ empresaId, canal, personas }: { empresaId: string; canal: Canal; personas: Persona[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = `asignar-${canal.id}`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">De quién es {mostrarCanal(canal)}</label>
      <select
        id={id}
        value={canal.personaId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const r = await asignarCanalAction(empresaId, canal.id, e.target.value || null);
            if (!r.ok) setError(r.error);
          })
        }
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs"
      >
        <option value="">Sin asignar</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.nombre}</option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </span>
  );
}

function CanalFila({ canal, extra }: { canal: Canal; extra?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <span>
        <span className={canal.estatus === "activo" ? "" : "text-finbra-gray line-through"}>{mostrarCanal(canal)}</span>
        {canal.nombre && <span className="text-finbra-gray"> · {canal.nombre}</span>}
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {canal.origen === "siac" && <span className={`${chip} bg-black/5 text-finbra-gray`}>SIAC</span>}
          {canal.recibeRecordatorios && <span className={`${chip} bg-finbra-purple/10 font-semibold text-finbra-purple-700`}>Recibe recordatorios</span>}
          {canal.estatus === "invalido" && <span className={`${chip} bg-amber-100 text-amber-800`}>Inválido</span>}
        </span>
      </span>
      {extra}
    </li>
  );
}

export default function ContactosEmpresa({
  empresaId,
  personas,
  canales,
  puedeEditar,
}: {
  empresaId: string;
  personas: Persona[];
  canales: Canal[];
  puedeEditar: boolean;
}) {
  const [nueva, setNueva] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const vigentes = personas.filter((p) => p.vigente);
  const anteriores = personas.filter((p) => !p.vigente);
  const delDeudor = canales.filter((k) => k.relacion === "titular");
  const sinAsignar = delDeudor.filter((k) => !k.personaId || !personas.some((p) => p.id === k.personaId));
  const terceros = canales.filter((k) => k.relacion !== "titular");

  const tarjeta = (p: Persona) => {
    const suyos = delDeudor.filter((k) => k.personaId === p.id);
    if (editando === p.id) return <FormPersona key={p.id} empresaId={empresaId} persona={p} alTerminar={() => setEditando(null)} />;
    return (
      <li key={p.id} className="space-y-2 rounded-xl border border-black/5 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">
              {p.nombre}
              {p.puesto && <span className="font-normal text-finbra-gray"> · {p.puesto}</span>}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {p.esPrincipal && <span className={`${chip} bg-finbra-purple text-white`}>Principal</span>}
              {p.rolDecision && <span className={`${chip} bg-black/5`}>{ROLES_DECISION[p.rolDecision]}</span>}
              {p.esRepresentanteLegal && <span className={`${chip} bg-black/5`}>Representante legal</span>}
              {(p.canalPreferido || p.horarioPreferido) && (
                <span className={`${chip} bg-black/5`}>
                  Prefiere {p.canalPreferido ? CANALES[p.canalPreferido] : "contacto"}
                  {p.horarioPreferido ? `, ${p.horarioPreferido}` : ""}
                </span>
              )}
              {!p.vigente && <span className={`${chip} bg-black/5 text-finbra-gray`}>Ya no está</span>}
            </div>
          </div>
          {puedeEditar && <button type="button" onClick={() => setEditando(p.id)} className={botonChico}>Editar</button>}
        </div>
        {p.notas && <p className="whitespace-pre-line text-sm text-finbra-gray">{p.notas}</p>}
        {suyos.length > 0 && (
          <ul className="divide-y divide-black/5">
            {suyos.map((k) => (
              <CanalFila key={k.id} canal={k} extra={puedeEditar ? <AsignarCanal empresaId={empresaId} canal={k} personas={vigentes} /> : undefined} />
            ))}
          </ul>
        )}
        {puedeEditar && p.vigente && <AgregarCanal empresaId={empresaId} personaId={p.id} />}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-finbra-gray">
          Las personas de la empresa y cómo prefieren que las contactemos. Los teléfonos y correos son los del expediente de cobranza: asignarlos a una persona no
          cambia a quién le llegan los recordatorios.
        </p>
        {puedeEditar && !nueva && <button type="button" onClick={() => setNueva(true)} className={boton}>Agregar persona</button>}
      </div>
      {nueva && <FormPersona empresaId={empresaId} alTerminar={() => setNueva(false)} />}

      {vigentes.length === 0 && !nueva ? (
        <p className="rounded-xl border border-dashed border-black/10 p-6 text-sm text-finbra-gray">
          Todavía no hay personas registradas. Agrega al dueño, a quien paga y a quien decide el crédito.
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">{vigentes.map(tarjeta)}</ul>
      )}

      {sinAsignar.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-finbra-gray">Teléfonos y correos del cliente sin asignar a una persona</h3>
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white px-4">
            {sinAsignar.map((k) => (
              <CanalFila key={k.id} canal={k} extra={puedeEditar && vigentes.length > 0 ? <AsignarCanal empresaId={empresaId} canal={k} personas={vigentes} /> : undefined} />
            ))}
          </ul>
        </section>
      )}

      {terceros.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-finbra-gray">Avales y referencias</h3>
          <p className="text-xs text-finbra-gray">No son personas de la empresa. Se administran en el expediente de cobranza.</p>
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white px-4">
            {terceros.map((k) => (
              <CanalFila key={k.id} canal={k} />
            ))}
          </ul>
        </section>
      )}

      {anteriores.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-finbra-gray">Personas que ya no están ({anteriores.length})</summary>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">{anteriores.map(tarjeta)}</ul>
        </details>
      )}
    </div>
  );
}
