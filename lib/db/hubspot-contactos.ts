// Importar contactos de HubSpot a las empresas de Clientes. Las reglas (leer el
// export, empresa por nombre, duplicados) están en lib/clientes/hubspot-contactos.ts.
// Cada contacto se da de alta con guardarPersona y sus teléfonos y correo con
// agregarCanal, igual que si los capturara el equipo: en un cliente de SIAC van
// a su expediente de cobranza (sin ser destinatarios de recordatorios); en un
// prospecto, con la persona.

import { sql } from "@/lib/db";
import { logAudit } from "@/lib/db/audit";
import { ambienteActual } from "@/lib/db/collections";
import { agregarCanal, guardarPersona, PersonaError } from "@/lib/db/personas";
import { normal } from "@/lib/clientes/hubspot-import";
import { leerExportContactos, planContactos, type ContactoParaImportar, type YaEnEmpresa } from "@/lib/clientes/hubspot-contactos";
import { leerTelefono } from "@/lib/clientes/negocios";

/** Tope del texto que llega del navegador (ya compactado). */
export const MAX_BYTES_CONTACTOS = 900_000;

const canal = (v: string | null) => {
  if (!v) return null;
  const t = v.trim();
  if (t.includes("@")) return t.toLowerCase();
  const tel = leerTelefono(t);
  return tel && tel !== "invalido" ? tel : null;
};

async function contexto() {
  const ambiente = ambienteActual();
  const [empresas, personas, deProspecto, deCobranza] = await Promise.all([
    sql`SELECT id, nombre, razon_social FROM crm_empresas WHERE ambiente = ${ambiente}`,
    sql`SELECT p.empresa_id, p.nombre FROM crm_personas p JOIN crm_empresas e ON e.id = p.empresa_id WHERE e.ambiente = ${ambiente}`,
    sql`
      SELECT p.empresa_id, k.valor FROM crm_persona_canales k JOIN crm_personas p ON p.id = k.persona_id JOIN crm_empresas e ON e.id = p.empresa_id
      WHERE e.ambiente = ${ambiente}
    `,
    sql`SELECT c.empresa_id, k.valor_original AS valor FROM col_contacts k JOIN col_clients c ON c.id = k.client_id WHERE c.ambiente = ${ambiente} AND c.empresa_id IS NOT NULL`,
  ]);
  const existentes = new Map<string, YaEnEmpresa>();
  const de = (id: string) => {
    let x = existentes.get(id);
    if (!x) existentes.set(id, (x = { nombres: new Set(), canales: new Set() }));
    return x;
  };
  for (const p of personas) de(p.empresa_id as string).nombres.add(normal(p.nombre as string));
  for (const k of [...deProspecto, ...deCobranza]) {
    const v = canal(k.valor as string);
    if (v) de(k.empresa_id as string).canales.add(v);
  }
  return {
    empresas: empresas.map((e) => ({ id: e.id as string, nombre: e.nombre as string, razonSocial: (e.razon_social as string) ?? null })),
    existentes,
  };
}

export type VistaContactos = { ok: true; items: ContactoParaImportar[] } | { ok: false; error: string };

export async function vistaPreviaContactos(texto: string): Promise<VistaContactos> {
  const r = leerExportContactos(texto);
  if (!r.ok) return r;
  return { ok: true, items: planContactos(r.filas, await contexto()) };
}

export interface ResultadoContactos {
  creados: number;
  canales: number;
  yaEstaban: number;
  sinEmpresa: number;
}

/**
 * Importa los contactos elegidos (por ID de HubSpot). Vuelve a leer el archivo
 * en el servidor. Si la empresa no tiene contacto principal, el primero que
 * entra queda como principal.
 */
export async function importarContactos(p: { texto: string; ids: string[]; actor: string }): Promise<ResultadoContactos> {
  const r = leerExportContactos(p.texto);
  if (!r.ok) throw new PersonaError(r.error);
  const elegidos = new Set(p.ids);
  const ctx = await contexto();
  const plan = planContactos(r.filas, ctx).filter((x) => elegidos.has(x.fila.hubspotId));
  const res: ResultadoContactos = { creados: 0, canales: 0, yaEstaban: 0, sinEmpresa: 0 };
  for (const x of plan) {
    if (!x.empresa || x.problema) {
      res.sinEmpresa++;
      continue;
    }
    // Lo que entra en esta misma tanda también cuenta como existente.
    const ya = ctx.existentes.get(x.empresa.id);
    if (x.yaExiste || ya?.nombres.has(normal(x.fila.nombre))) {
      res.yaEstaban++;
      continue;
    }
    const [{ principal }] = await sql`SELECT EXISTS (SELECT 1 FROM crm_personas WHERE empresa_id = ${x.empresa.id} AND es_principal AND vigente) AS principal`;
    const personaId = await guardarPersona({
      empresaId: x.empresa.id,
      datos: {
        nombre: x.fila.nombre,
        puesto: x.fila.puesto,
        rolDecision: null,
        esRepresentanteLegal: false,
        canalPreferido: null,
        horarioPreferido: null,
        esPrincipal: !principal,
        vigente: true,
        notas: `Importado de HubSpot (contacto ${x.fila.hubspotId}).`,
      },
      actor: p.actor,
    });
    res.creados++;
    const e = ya ?? { nombres: new Set<string>(), canales: new Set<string>() };
    e.nombres.add(normal(x.fila.nombre));
    ctx.existentes.set(x.empresa.id, e);
    const canales: ["telefono" | "email", string][] = [...x.fila.telefonos.map((t) => ["telefono", t] as ["telefono", string]), ...(x.fila.correo ? [["email", x.fila.correo] as ["email", string]] : [])];
    for (const [tipo, valor] of canales) {
      if (e.canales.has(valor)) continue;
      try {
        await agregarCanal({ empresaId: x.empresa.id, personaId, tipo, valor, actor: p.actor });
        e.canales.add(valor);
        res.canales++;
      } catch (err) {
        // Un teléfono o correo que el expediente no acepta (repetido, mal escrito) no detiene el resto.
        if (!(err instanceof PersonaError)) throw err;
      }
    }
  }
  await logAudit({ actorEmail: p.actor, action: "importar_contactos_hubspot", entityType: "persona", metadata: { ...res, elegidos: p.ids.length } });
  return res;
}
