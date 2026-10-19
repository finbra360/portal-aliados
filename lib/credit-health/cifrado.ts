import { createDecipheriv } from "node:crypto";

/**
 * Descifra los datos de contacto de Credit Health (AES-256-GCM, formato "v1:" de
 * finbra360/credit-health). Requiere la MISMA llave que usa esa app
 * (CREDIT_HEALTH_DATA_ENCRYPTION_KEY = su DATA_ENCRYPTION_KEY).
 */
export function descifrar(payload: string, llaveB64: string): string {
  const key = Buffer.from(llaveB64, "base64");
  if (key.length !== 32) throw new Error("La llave de Credit Health debe ser base64 de 32 bytes.");
  const [version, data] = payload.split(":");
  if (version !== "v1" || !data) throw new Error("Formato de dato cifrado no reconocido.");
  const buf = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function llaveCreditHealth(): string {
  const llave = process.env.CREDIT_HEALTH_DATA_ENCRYPTION_KEY;
  if (!llave) throw new Error("CREDIT_HEALTH_DATA_ENCRYPTION_KEY no está configurado");
  return llave;
}
