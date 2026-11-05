// RFC de una empresa: normalización y validación. La base tiene el mismo
// patrón como CHECK en crm_empresas (lib/db/crm-schema.sql).

/** Persona moral: 3 letras; persona física: 4. Luego fecha AAMMDD y homoclave de 3. */
export const RFC_PATRON = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/** Mayúsculas, sin espacios, guiones ni puntos ("tef-150101 ab1" → "TEF150101AB1"). */
export function normalizarRfc(v: string): string {
  return v.trim().toUpperCase().replace(/[\s.\-]/g, "");
}

/**
 * Valida un RFC capturado. Vacío es válido (todavía no se conoce) y regresa null.
 * Revisa la forma y que la fecha tenga mes y día posibles.
 */
export function validarRfc(v: string | null | undefined): { ok: true; rfc: string | null } | { ok: false; error: string } {
  const rfc = normalizarRfc(v ?? "");
  if (!rfc) return { ok: true, rfc: null };
  if (!RFC_PATRON.test(rfc)) {
    return { ok: false, error: "El RFC debe tener 12 caracteres (persona moral) o 13 (persona física): letras, fecha AAMMDD y homoclave." };
  }
  const fecha = rfc.slice(rfc.length - 9, rfc.length - 3);
  const mes = Number(fecha.slice(2, 4));
  const dia = Number(fecha.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { ok: false, error: `La fecha del RFC (${fecha}) no es válida: debe ser AAMMDD.` };
  return { ok: true, rfc };
}
