"use client";

import { useActionState, useState, useTransition } from "react";
import { TIPOS_CONTACTO, type TipoContacto } from "@/lib/collections/contacts";
import type { ProfileContact } from "@/lib/db/collection-clients";
import { formatFechaHora, formatTelefono } from "@/lib/format";
import { addContactAction, setEstatusAction, setRecibeAction, setTipoAction, volverAlSugeridoAction, type ActionResult } from "./actions";
import { enviarSinBorrar } from "../../enviarSinBorrar";

const TIPOS = Object.entries(TIPOS_CONTACTO) as [TipoContacto, (typeof TIPOS_CONTACTO)[TipoContacto]][];

const CAMPO_SIAC: Record<string, string> = {
  Celular: "Celular",
  TelefonoCliente: "Teléfono del cliente",
  CorreoCliente: "Correo del cliente",
  TelefonoAval: "Teléfono del aval",
  CorreoAval: "Correo del aval",
  TelefonoReferencia1: "Referencia 1",
  TelefonoReferencia2: "Referencia 2",
};

function Estado({ c }: { c: ProfileContact }) {
  if (c.estatus === "baja" || c.bajaWhatsappAt) return <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-finbra-gray">Pidió no recibir mensajes</span>;
  if (c.estatus === "invalido") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Marcado como inválido</span>;
  if (c.tipo === "telefono" && !c.telefonoWhatsapp) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">No sirve para WhatsApp: corregir en SIAC</span>;
  return null;
}

function ContactRow({
  clientId,
  c,
  esDestinatario,
  origenDestinatario,
  marcado,
}: {
  clientId: string;
  c: ProfileContact;
  esDestinatario: boolean;
  origenDestinatario: "equipo" | "siac" | null;
  /** El equipo lo marcó para recibir los recordatorios. */
  marcado: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const correr = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
    });

  return (
    <li className={`rounded-lg border p-4 ${esDestinatario ? "border-finbra-purple/40 bg-finbra-purple/5" : "border-black/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {c.tipo === "telefono" ? formatTelefono(c.valor) : c.valor}
            {c.nombre && <span className="ml-2 font-normal text-finbra-gray">{c.nombre}</span>}
          </p>
          <p className="mt-0.5 text-xs text-finbra-gray">
            {c.origen === "siac" ? `De SIAC · ${CAMPO_SIAC[c.campoSiac ?? ""] ?? c.campoSiac}` : `Agregado por ${c.updatedBy ?? "el equipo"}`}
            {c.notas && <> · {c.notas}</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {esDestinatario && (
              <span className="rounded-full bg-finbra-purple px-2 py-0.5 text-xs font-semibold text-white">
                Recibe los recordatorios{origenDestinatario === "siac" ? " (sugerido por SIAC)" : ""}
              </span>
            )}
            <Estado c={c} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`tipo-${c.id}`}>Tipo de contacto</label>
          <select
            id={`tipo-${c.id}`}
            value={c.tipoContacto}
            disabled={pending}
            onChange={(e) => correr(() => setTipoAction(clientId, c.id, e.target.value))}
            className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm"
          >
            <optgroup label="Del deudor (pueden recibir recordatorios)">
              {TIPOS.filter(([, t]) => t.deudor).map(([k, t]) => (
                <option key={k} value={k}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Terceros (no reciben recordatorios)">
              {TIPOS.filter(([, t]) => !t.deudor).map(([k, t]) => (
                <option key={k} value={k}>{t.label}</option>
              ))}
            </optgroup>
          </select>

          {marcado ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => correr(() => setRecibeAction(clientId, c.id, false))}
              className="rounded-lg border border-finbra-purple/40 px-3 py-1.5 text-sm font-semibold text-finbra-purple-700 hover:bg-finbra-purple/10 disabled:opacity-50"
            >
              Ya no mandarle recordatorios
            </button>
          ) : (
            !c.motivoNoRecibe && (
              <button
                type="button"
                disabled={pending}
                onClick={() => correr(() => setRecibeAction(clientId, c.id, true))}
                className="rounded-lg bg-finbra-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50"
              >
                {esDestinatario ? "Dejarlo fijo para recordatorios" : "Mandarle recordatorios"}
              </button>
            )
          )}
          {c.estatus === "activo" && !c.bajaWhatsappAt ? (
            <>
              <button type="button" disabled={pending} onClick={() => correr(() => setEstatusAction(clientId, c.id, "invalido"))} className="rounded-lg px-2 py-1.5 text-sm text-finbra-gray hover:bg-black/5 disabled:opacity-50">
                Marcar inválido
              </button>
              {c.tipo === "telefono" && (
                <button type="button" disabled={pending} onClick={() => correr(() => setEstatusAction(clientId, c.id, "baja"))} className="rounded-lg px-2 py-1.5 text-sm text-finbra-gray hover:bg-black/5 disabled:opacity-50">
                  Pidió no recibir mensajes
                </button>
              )}
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => correr(() => setEstatusAction(clientId, c.id, "activo"))} className="rounded-lg px-2 py-1.5 text-sm text-finbra-purple-700 hover:bg-finbra-purple/10 disabled:opacity-50">
              Reactivar
            </button>
          )}
        </div>
      </div>
      {!esDestinatario && c.motivoNoRecibe && c.relacion === "titular" && c.tipo === "telefono" && (
        <p className="mt-2 text-xs text-finbra-gray">No puede recibir recordatorios: {c.motivoNoRecibe.toLowerCase()}.</p>
      )}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </li>
  );
}

function AddContactForm({ clientId }: { clientId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<"telefono" | "email">("telefono");
  const [tipoContacto, setTipoContacto] = useState<TipoContacto>("pagos");
  const [state, action, pending] = useActionState(
    async (prev: ActionResult | null, fd: FormData) => {
      const r = await addContactAction(clientId, prev, fd);
      if (r.ok) setAbierto(false);
      return r;
    },
    null,
  );
  const puedeRecibir = tipo === "telefono" && TIPOS_CONTACTO[tipoContacto].deudor;

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="rounded-lg border border-dashed border-finbra-purple/40 px-4 py-2 text-sm font-medium text-finbra-purple-700 hover:bg-finbra-purple/5">
        + Agregar contacto
      </button>
    );
  }

  return (
    <form onSubmit={enviarSinBorrar(action)} className="space-y-3 rounded-lg border border-black/10 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Teléfono o correo</span>
          <div className="flex gap-2">
            <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "telefono" | "email")} className="rounded-lg border border-black/10 bg-white px-2 py-1.5">
              <option value="telefono">Teléfono</option>
              <option value="email">Correo</option>
            </select>
            <input name="valor" required placeholder={tipo === "telefono" ? "55 1234 5678" : "pagos@empresa.mx"} className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-1.5" />
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Nombre (opcional)</span>
          <input name="nombre" placeholder="Ej. Laura Pérez" className="w-full rounded-lg border border-black/10 px-3 py-1.5" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Tipo de contacto</span>
          <select name="tipoContacto" value={tipoContacto} onChange={(e) => setTipoContacto(e.target.value as TipoContacto)} className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5">
            {TIPOS.map(([k, t]) => (
              <option key={k} value={k}>{t.label}{t.deudor ? "" : " (no recibe recordatorios)"}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-finbra-gray">Notas (opcional)</span>
          <input name="notas" placeholder="Ej. Contesta en las mañanas" className="w-full rounded-lg border border-black/10 px-3 py-1.5" />
        </label>
      </div>
      <label className={`flex items-center gap-2 text-sm ${puedeRecibir ? "" : "opacity-50"}`}>
        <input type="checkbox" name="usarParaRecordatorios" disabled={!puedeRecibir} />
        Que este contacto reciba los recordatorios de cobranza
      </label>
      {state && !state.ok && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-finbra-purple px-4 py-2 text-sm font-semibold text-white hover:bg-finbra-purple/90 disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar contacto"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-4 py-2 text-sm text-finbra-gray hover:bg-black/5">
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function ContactsPanel({
  clientId,
  contactos,
  recipients,
  elegidoPor,
}: {
  clientId: string;
  contactos: ProfileContact[];
  recipients: { contactIds: string[]; origen: "equipo" | "siac" | null; aviso: string | null };
  elegidoPor: { por: string | null; at: string | null };
}) {
  const [pending, start] = useTransition();
  const deudor = contactos.filter((c) => c.relacion === "titular");
  const terceros = contactos.filter((c) => c.relacion !== "titular");
  const destinatarios = recipients.contactIds.map((id) => contactos.find((c) => c.id === id)).filter((c): c is ProfileContact => !!c);
  const destinatario = destinatarios[0];
  // Marcado por el equipo: con la columna nueva, su marca; antes, el elegido (origen equipo).
  const marcado = (c: ProfileContact) => (c.recibeRecordatorios !== undefined ? c.recibeRecordatorios : recipients.origen === "equipo" && recipients.contactIds.includes(c.id));

  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-4 text-sm ${destinatario ? "bg-finbra-purple/5" : "bg-amber-50 text-amber-900"}`}>
        {destinatario ? (
          <p>
            Los recordatorios por WhatsApp van a{" "}
            {destinatarios.map((d, i) => (
              <span key={d.id}>
                {i > 0 && (i === destinatarios.length - 1 ? " y " : ", ")}
                <strong>{formatTelefono(d.valor)}</strong>
                {d.nombre && <> ({d.nombre})</>}
              </span>
            ))}
            .{" "}
            {recipients.origen === "equipo" ? (
              destinatarios.length === 1 && elegidoPor.por && recipients.contactIds[0] === destinatario.id && destinatario.recibeRecordatorios === undefined ? (
                <span className="text-finbra-gray">Lo eligió {elegidoPor.por}{elegidoPor.at ? ` el ${formatFechaHora(elegidoPor.at)}` : "."}</span>
              ) : (
                <span className="text-finbra-gray">{destinatarios.length === 1 ? "Lo marcó el equipo." : "Los marcó el equipo; cada número recibe su mensaje."}</span>
              )
            ) : (
              <span className="text-finbra-gray">Es el sugerido por SIAC (celular o, si falta, teléfono del cliente). Marca los que quieras abajo.</span>
            )}
          </p>
        ) : (
          <p><strong>Este cliente no tiene a quién mandarle recordatorios.</strong> Marca o agrega un teléfono del deudor con 10 dígitos.</p>
        )}
        {recipients.aviso && destinatario && <p className="mt-1 text-amber-800">{recipients.aviso}</p>}
        {recipients.origen === "equipo" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => void (await volverAlSugeridoAction(clientId)))}
            className="mt-2 text-xs font-medium text-finbra-purple hover:underline disabled:opacity-50"
          >
            Volver al sugerido por SIAC
          </button>
        )}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-finbra-gray">Del deudor</h3>
        {deudor.length === 0 ? (
          <p className="text-sm text-finbra-gray">Sin contactos del deudor.</p>
        ) : (
          <ul className="space-y-2">
            {deudor.map((c) => (
              <ContactRow
                key={c.id}
                clientId={clientId}
                c={c}
                esDestinatario={recipients.contactIds.includes(c.id)}
                origenDestinatario={recipients.origen}
                marcado={marcado(c)}
              />
            ))}
          </ul>
        )}
      </section>

      {terceros.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-finbra-gray">Terceros (aval y referencias)</h3>
          <p className="text-xs text-finbra-gray">Se pueden consultar y llamar a mano, pero no reciben recordatorios automáticos mientras legal no valide otra cosa.</p>
          <ul className="space-y-2">
            {terceros.map((c) => (
              <ContactRow key={c.id} clientId={clientId} c={c} esDestinatario={false} origenDestinatario={null} marcado={false} />
            ))}
          </ul>
        </section>
      )}

      <AddContactForm clientId={clientId} />
    </div>
  );
}
