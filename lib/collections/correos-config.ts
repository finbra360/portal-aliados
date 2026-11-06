// Límites del envío de correos de cobranza.

/** Mismo horario que el WhatsApp si no hay ajuste "ventana_envio". */
export const HORARIO_DEFAULT_CORREO = { desde: "09:00", hasta: "19:00" };

/** Correos por llamada a n8n: cada uno tarda ~1 s en Gmail, y la función de Vercel tiene límite de tiempo. */
export const MAX_CORREOS_POR_LOTE = 10;

/** Correos de prueba por día (el botón "Enviar prueba a mi correo"). */
export const MAX_PRUEBAS_CORREO_DIA = 10;
