// Límites del login del portal. Lógica pura (sin base de datos) para probarla
// con `node --test`; los conteos los saca lib/db/login-intentos.ts.
//
// Ninguna ventana puede pasar de 60 minutos: la consulta solo mira la última hora.

export const LIMITES = {
  /** Códigos que se pueden pedir para un mismo correo. */
  codigoPorCorreo: { max: 3, minutos: 10 },
  /** Códigos que se pueden pedir desde una misma conexión, sea cual sea el correo. */
  codigoPorIp: { max: 10, minutos: 60 },
  /** Códigos equivocados para un mismo correo; al llegar al tope ni el correcto entra. */
  fallosPorCorreo: { max: 5, minutos: 15 },
  /** Códigos equivocados desde una misma conexión. */
  fallosPorIp: { max: 20, minutos: 60 },
} as const;

export interface ConteoIntentos {
  codigoCorreo: number;
  codigoIp: number;
  fallosCorreo: number;
  fallosIp: number;
}

export function puedePedirCodigo(c: ConteoIntentos): boolean {
  return c.codigoCorreo < LIMITES.codigoPorCorreo.max && c.codigoIp < LIMITES.codigoPorIp.max;
}

export function puedeVerificarCodigo(c: ConteoIntentos): boolean {
  return c.fallosCorreo < LIMITES.fallosPorCorreo.max && c.fallosIp < LIMITES.fallosPorIp.max;
}

export const MENSAJE_DEMASIADOS_INTENTOS = "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
