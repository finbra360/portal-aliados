// Contactos de los clientes para los recordatorios (WhatsApp y correo), en una
// sola consulta por ambiente.

import { sql } from "@/lib/db";
import type { ContactLike } from "@/lib/collections/contacts";

export type ContactoEnvio = ContactLike & { nombre: string | null };

/** Por cliente: sus contactos (para elegir el WhatsApp) y los correos activos del deudor. */
export async function contactosParaEnvio(ambiente: string): Promise<Map<string, { contactos: ContactoEnvio[]; correos: string[] }>> {
  const rows = await sql`
    SELECT k.id, k.client_id, k.relacion, k.rol, k.tipo, k.telefono_whatsapp, k.estatus, k.baja_whatsapp_at, k.es_principal, k.nombre_contacto, k.valor_original
    FROM col_contacts k JOIN col_clients c ON c.id = k.client_id
    WHERE c.ambiente = ${ambiente}
  `;
  const porCliente = new Map<string, { contactos: ContactoEnvio[]; correos: string[] }>();
  for (const k of rows) {
    const x = porCliente.get(k.client_id) ?? { contactos: [], correos: [] };
    x.contactos.push({
      id: k.id,
      relacion: k.relacion,
      rol: k.rol,
      tipo: k.tipo,
      telefonoWhatsapp: k.telefono_whatsapp,
      estatus: k.estatus,
      bajaWhatsappAt: k.baja_whatsapp_at ? String(k.baja_whatsapp_at) : null,
      esPrincipal: k.es_principal,
      nombre: k.nombre_contacto,
    });
    // Correo del deudor: solo los del titular que siguen activos (nunca a un aval o referencia).
    if (k.tipo === "email" && k.relacion === "titular" && k.estatus === "activo") x.correos.push(k.valor_original);
    porCliente.set(k.client_id, x);
  }
  return porCliente;
}
