// Cuentas de pago de Finbra: validación y el texto que va en los recordatorios.
// Funciones puras, sin base de datos, para poder probarlas con `node --test`.

export interface CuentaPago {
  id: string;
  alias: string;
  banco: string;
  beneficiario: string;
  clabe: string;
  activa: boolean;
}

/**
 * Valida una CLABE: 18 dígitos y dígito verificador correcto. Los primeros 17
 * se multiplican por 3, 7, 1, 3, 7, 1…; se suman las unidades de cada producto
 * y el verificador es (10 − suma mod 10) mod 10. Acepta espacios y guiones.
 */
export function validarClabe(texto: string): { ok: true; clabe: string } | { ok: false; error: string } {
  const clabe = texto.replace(/[\s-]/g, "");
  if (!/^\d{18}$/.test(clabe)) return { ok: false, error: "La CLABE debe tener 18 dígitos" };
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(clabe[i]) * pesos[i % 3]) % 10;
  if ((10 - (suma % 10)) % 10 !== Number(clabe[17])) {
    return { ok: false, error: "La CLABE no es válida: el dígito verificador no coincide. Revisa que esté bien escrita." };
  }
  return { ok: true, clabe };
}

export function validarCuenta(p: {
  alias: string;
  banco: string;
  beneficiario: string;
  clabe?: string;
}): { ok: true; alias: string; banco: string; beneficiario: string; clabe: string | null } | { ok: false; error: string } {
  const alias = p.alias.trim();
  const banco = p.banco.trim();
  const beneficiario = p.beneficiario.trim();
  if (!alias) return { ok: false, error: "Ponle un nombre corto a la cuenta (ej. BBVA cobranza)" };
  if (!banco) return { ok: false, error: "Falta el banco" };
  if (!beneficiario) return { ok: false, error: "Falta el beneficiario (a nombre de quién está la cuenta)" };
  if (alias.length > 60 || banco.length > 60 || beneficiario.length > 120) return { ok: false, error: "Algún dato es demasiado largo" };
  if (p.clabe === undefined) return { ok: true, alias, banco, beneficiario, clabe: null };
  const c = validarClabe(p.clabe);
  if (!c.ok) return c;
  return { ok: true, alias, banco, beneficiario, clabe: c.clabe };
}

/** CLABE agrupada como banco · plaza · cuenta · verificador, para leerla en pantalla. */
export function formatClabe(clabe: string): string {
  return /^\d{18}$/.test(clabe) ? `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 17)} ${clabe.slice(17)}` : clabe;
}

/**
 * Instrucciones de pago que se incluyen en el recordatorio: la cuenta del
 * cliente y, como concepto, el número de crédito. La CLABE va sin espacios
 * para que se pueda copiar directo a la app del banco.
 */
export function instruccionesDePago(cuenta: Pick<CuentaPago, "banco" | "beneficiario" | "clabe">, creditos: string[]): string {
  const base = `Transfiere a ${cuenta.banco}, a nombre de ${cuenta.beneficiario}, CLABE ${cuenta.clabe}.`;
  if (creditos.length === 0) return base;
  if (creditos.length === 1) return `${base} En el concepto escribe tu número de crédito: ${creditos[0]}.`;
  const lista = `${creditos.slice(0, -1).join(", ")} o ${creditos.at(-1)}`;
  return `${base} En el concepto escribe el número del crédito que pagas: ${lista}.`;
}
