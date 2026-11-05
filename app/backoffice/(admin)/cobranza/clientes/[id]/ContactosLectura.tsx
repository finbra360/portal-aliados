import { TIPOS_CONTACTO } from "@/lib/collections/contacts";
import type { ProfileContact } from "@/lib/db/collection-clients";
import { formatTelefono } from "@/lib/format";

/** Contactos del cliente sin controles, para quien solo puede consultar (lib/permisos.ts). */
export default function ContactosLectura({ contactos, destinatarioId }: { contactos: ProfileContact[]; destinatarioId: string | null }) {
  if (contactos.length === 0) return <p className="text-sm text-finbra-gray">Sin contactos.</p>;
  return (
    <ul className="divide-y divide-black/5 text-sm">
      {contactos.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
          <span>
            <span className={c.estatus === "activo" ? "font-medium" : "text-finbra-gray line-through"}>
              {c.tipo === "telefono" ? formatTelefono(c.valor) : c.valor}
            </span>
            {c.nombre && <span className="text-finbra-gray"> · {c.nombre}</span>}
            {c.notas && <span className="block text-xs text-finbra-gray">{c.notas}</span>}
          </span>
          <span className="flex flex-wrap gap-1 text-xs">
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-finbra-gray">{TIPOS_CONTACTO[c.tipoContacto].label}</span>
            {c.id === destinatarioId && <span className="rounded-full bg-finbra-purple/10 px-2 py-0.5 font-semibold text-finbra-purple-700">Recibe recordatorios</span>}
            {c.estatus === "invalido" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Inválido</span>}
            {c.estatus === "baja" && <span className="rounded-full bg-black/5 px-2 py-0.5 text-finbra-gray">Dado de baja</span>}
            {c.bajaWhatsappAt && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">No quiere WhatsApp</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
