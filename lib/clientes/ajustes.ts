// Ajustes de Clientes que un Super Admin puede cambiar desde el backoffice
// (Clientes → Ajustes) sin correr SQL: salud del cliente y playbooks. Aquí
// están los campos, sus límites y la validación; se guardan en crm_settings
// con los mismos nombres que leen leerAjustesSalud y leerAjustesPlaybooks.
// Funciones puras, sin base de datos, para probarlas con `node --test`.

import { AJUSTES_SALUD_DEFAULT, type AjustesSalud } from "./salud.ts";
import { AJUSTES_PLAYBOOKS_DEFAULT, type AjustesPlaybooks } from "./playbooks.ts";

export type ClaveAjustes = "salud" | "playbooks";

export interface CampoAjuste {
  /** Nombre en crm_settings (snake_case). */
  clave: string;
  /** Propiedad en el objeto de ajustes ya leído (camelCase). */
  prop: string;
  etiqueta: string;
  ayuda?: string;
  tipo: "entero" | "si_no";
  min?: number;
  max?: number;
  /** Unidad que se muestra junto al campo. */
  unidad?: "puntos" | "días" | "tareas";
  grupo: string;
}

const pts = (clave: string, prop: keyof AjustesSalud, etiqueta: string, grupo: string, ayuda?: string): CampoAjuste => ({
  clave,
  prop,
  etiqueta,
  ayuda,
  tipo: "entero",
  min: 0,
  max: 100,
  unidad: "puntos",
  grupo,
});

export const CAMPOS_SALUD: CampoAjuste[] = [
  { clave: "corte_sana", prop: "corteSana", etiqueta: "Sana desde", tipo: "entero", min: 1, max: 100, unidad: "puntos", grupo: "Niveles" },
  { clave: "corte_atencion", prop: "corteAtencion", etiqueta: "Atención desde", ayuda: "Debajo de esto es En riesgo.", tipo: "entero", min: 0, max: 99, unidad: "puntos", grupo: "Niveles" },
  { clave: "atraso_leve_dias", prop: "atrasoLeveDias", etiqueta: "Atraso leve: hasta", tipo: "entero", min: 1, max: 60, unidad: "días", grupo: "Atraso de hoy" },
  pts("atraso_leve", "atrasoLeve", "Atraso leve resta", "Atraso de hoy"),
  { clave: "atraso_medio_dias", prop: "atrasoMedioDias", etiqueta: "Atraso medio: hasta", tipo: "entero", min: 2, max: 120, unidad: "días", grupo: "Atraso de hoy" },
  pts("atraso_medio", "atrasoMedio", "Atraso medio resta", "Atraso de hoy"),
  pts("atraso_grave", "atrasoGrave", "Atraso mayor resta", "Atraso de hoy", "Con 60 o más, el cliente queda En riesgo aunque todo lo demás esté bien."),
  pts("cobranza_especial", "cobranzaEspecial", "Cobranza especial resta", "Atraso de hoy", "Jurídico, extrajudicial o reestructura."),
  { clave: "ventana_atrasos_dias", prop: "ventanaAtrasosDias", etiqueta: "Atrasos recientes: ventana", tipo: "entero", min: 7, max: 365, unidad: "días", grupo: "Historia reciente" },
  pts("un_atraso", "unAtraso", "Una vez atrasado resta", "Historia reciente", "Sin contar el atraso de hoy."),
  pts("varios_atrasos", "variosAtrasos", "Dos o más veces resta", "Historia reciente"),
  { clave: "ventana_promesas_dias", prop: "ventanaPromesasDias", etiqueta: "Promesas incumplidas: ventana", tipo: "entero", min: 7, max: 365, unidad: "días", grupo: "Historia reciente" },
  pts("promesa_incumplida", "promesaIncumplida", "Promesa incumplida resta", "Historia reciente", "Resta una vez, sean cuantas sean."),
  pts("contacto_31_a_60", "contacto31a60", "Sin contacto 31 a 60 días resta", "Contacto del equipo"),
  pts("contacto_61_a_90", "contacto61a90", "Sin contacto 61 a 90 días resta", "Contacto del equipo"),
  pts("contacto_mas_90", "contactoMas90", "Sin contacto más de 90 días (o nunca) resta", "Contacto del equipo"),
  { clave: "gracia_contacto_dias", prop: "graciaContactoDias", etiqueta: "Gracia para clientes nuevos", ayuda: "Días desde su primer crédito en que la falta de contacto no resta.", tipo: "entero", min: 0, max: 365, unidad: "días", grupo: "Contacto del equipo" },
  pts("dato_faltante", "datoFaltante", "Cada dato faltante resta", "Datos clave", "Contacto principal, cuenta de pago y WhatsApp válido."),
];

export const CAMPOS_PLAYBOOKS: CampoAjuste[] = [
  { clave: "activo", prop: "activo", etiqueta: "Playbooks prendidos", ayuda: "Apagado, ningún playbook crea tareas.", tipo: "si_no", grupo: "General" },
  { clave: "bienvenida", prop: "bienvenida", etiqueta: "Crédito nuevo", ayuda: "Llamada de bienvenida y, si faltan, cuenta de pago y contacto de pagos.", tipo: "si_no", grupo: "Playbooks" },
  { clave: "primer_pago_dias", prop: "primerPagoDias", etiqueta: "Primer pago: días antes", ayuda: "Llamada para confirmar la CLABE antes del primer vencimiento. 0 = apagado.", tipo: "entero", min: 0, max: 30, unidad: "días", grupo: "Playbooks" },
  { clave: "revision_dias", prop: "revisionDias", etiqueta: "Revisión periódica: días sin contacto", ayuda: "0 = apagado.", tipo: "entero", min: 0, max: 365, unidad: "días", grupo: "Playbooks" },
  { clave: "revision_max_por_dia", prop: "revisionMaxPorDia", etiqueta: "Revisión periódica: tope por día", tipo: "entero", min: 0, max: 100, unidad: "tareas", grupo: "Playbooks" },
  { clave: "liquidacion", prop: "liquidacion", etiqueta: "Salida del listado", ayuda: "Tarea para confirmar si el crédito se liquidó.", tipo: "si_no", grupo: "Playbooks" },
  { clave: "rescate", prop: "rescate", etiqueta: "Pasó a En riesgo", ayuda: "Llamada de rescate cuando la salud del cliente cae a En riesgo.", tipo: "si_no", grupo: "Playbooks" },
];

export const CAMPOS: Record<ClaveAjustes, CampoAjuste[]> = { salud: CAMPOS_SALUD, playbooks: CAMPOS_PLAYBOOKS };
export const DEFAULTS: Record<ClaveAjustes, AjustesSalud | AjustesPlaybooks> = { salud: AJUSTES_SALUD_DEFAULT, playbooks: AJUSTES_PLAYBOOKS_DEFAULT };

export type ValorAjustes = Record<string, number | boolean>;
export type Validacion = { ok: true; valor: ValorAjustes } | { ok: false; error: string };

/**
 * Valida lo que llegó del formulario (texto; casillas: "on" si están
 * marcadas) y regresa el objeto a guardar en crm_settings, con todas las
 * claves. Rechaza en vez de corregir: lo que no sirve se le dice al usuario.
 */
export function validarAjustes(clave: ClaveAjustes, entrada: Record<string, string | null | undefined>): Validacion {
  const valor: ValorAjustes = {};
  for (const c of CAMPOS[clave]) {
    const v = entrada[c.clave];
    if (c.tipo === "si_no") {
      valor[c.clave] = v === "on" || v === "true";
      continue;
    }
    const texto = (v ?? "").trim();
    const n = Number(texto);
    if (texto === "" || !Number.isInteger(n)) return { ok: false, error: `«${c.etiqueta}» tiene que ser un número entero.` };
    if (n < (c.min ?? 0) || n > (c.max ?? Infinity)) return { ok: false, error: `«${c.etiqueta}» tiene que estar entre ${c.min ?? 0} y ${c.max}.` };
    valor[c.clave] = n;
  }
  if (clave === "salud") {
    if ((valor.corte_atencion as number) >= (valor.corte_sana as number)) return { ok: false, error: "«Atención desde» tiene que ser menor que «Sana desde»." };
    if ((valor.atraso_leve_dias as number) >= (valor.atraso_medio_dias as number)) return { ok: false, error: "El atraso leve tiene que terminar antes que el medio." };
  }
  return { ok: true, valor };
}

/** Lo que cambió entre dos objetos de ajustes, para la auditoría. */
export function diferencias(antes: ValorAjustes, despues: ValorAjustes): Record<string, { antes: number | boolean | null; despues: number | boolean }> {
  const d: Record<string, { antes: number | boolean | null; despues: number | boolean }> = {};
  for (const [k, v] of Object.entries(despues)) if (antes[k] !== v) d[k] = { antes: antes[k] ?? null, despues: v };
  return d;
}

/** Valores actuales en el formato del formulario (snake_case), a partir de los ajustes ya leídos. */
export function valoresDe(clave: ClaveAjustes, ajustes: AjustesSalud | AjustesPlaybooks): ValorAjustes {
  return Object.fromEntries(CAMPOS[clave].map((c) => [c.clave, (ajustes as unknown as Record<string, number | boolean>)[c.prop]]));
}
