// Reporte diario de cobranza para Slack (reemplaza el "Reporte Diario
// Encargado" de n8n). Función pura: recibe los números y arma el texto en el
// formato de Slack (mrkdwn).

export interface DatosReporte {
  fecha: string;
  urlBase: string;
  foto: { fechaCorte: string | null; estado: "al_dia" | "atrasada" | "sin_foto"; error: string | null };
  cartera: { clientesEnMora: number; vencidoEnMora: number; creditos: number; par30: number | null } | null;
  /** Movimientos que detectó la foto de hoy. */
  eventos: { entradasMora: string[]; regularizaciones: number; pagosDetectados: number; nuevasVencidas: number };
  promesas: { vencenHoy: string[]; incumplidas: number };
  whatsapp: {
    mora: { enviados: number; fallidos: number; bloqueo: string | null };
    preventivos: { enviados: number; fallidos: number; bloqueo: string | null };
  };
  chat: { sinLeer: number; conversaciones: number; horasMasAntiguo: number | null };
  alertas: { abiertas: number; criticas: number };
}

const peso = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Hasta `max` nombres y "y N más". */
function nombres(lista: string[], max = 5): string {
  if (lista.length <= max) return lista.join(", ");
  return `${lista.slice(0, max).join(", ")} y ${lista.length - max} más`;
}

function lineaEnvios(nombre: string, e: { enviados: number; fallidos: number; bloqueo: string | null }): string {
  if (e.enviados === 0 && e.fallidos === 0) return `• ${nombre}: ninguno${e.bloqueo ? ` (${e.bloqueo.charAt(0).toLowerCase()}${e.bloqueo.slice(1)})` : ""}`;
  return `• ${nombre}: ${plural(e.enviados, "enviado", "enviados")}${e.fallidos ? `, :warning: ${plural(e.fallidos, "fallido", "fallidos")}` : ""}`;
}

export function armarReporte(d: DatosReporte): string {
  const l: string[] = [`*Cobranza — reporte del ${d.fecha}*`];

  if (d.foto.estado === "sin_foto") l.push(":rotating_light: No hay ninguna foto de SIAC todavía.");
  else if (d.foto.estado === "atrasada") l.push(`:warning: La foto de SIAC no es de hoy: la última es del ${d.foto.fechaCorte}.${d.foto.error ? ` Error: ${d.foto.error}` : ""}`);

  if (d.cartera) {
    l.push(
      "",
      `*Cartera* (foto del ${d.foto.fechaCorte})`,
      `• ${plural(d.cartera.clientesEnMora, "cliente", "clientes")} en mora, ${peso(d.cartera.vencidoEnMora)} vencido`,
      `• ${plural(d.cartera.creditos, "crédito", "créditos")} activos · PAR30 ${pct(d.cartera.par30)}`,
    );
  }

  const e = d.eventos;
  const movimientos = [
    e.entradasMora.length ? `• :red_circle: Entraron a mora: ${nombres(e.entradasMora)}` : null,
    e.nuevasVencidas ? `• ${plural(e.nuevasVencidas, "crédito venció otra mensualidad", "créditos vencieron otra mensualidad")} sin pago` : null,
    e.pagosDetectados ? `• :moneybag: ${plural(e.pagosDetectados, "pago detectado", "pagos detectados")}` : null,
    e.regularizaciones ? `• :large_green_circle: ${plural(e.regularizaciones, "crédito se puso", "créditos se pusieron")} al corriente` : null,
  ].filter((x): x is string => x !== null);
  l.push("", "*Movimientos de hoy*", ...(movimientos.length ? movimientos : ["• Sin cambios"]));

  const p = d.promesas;
  if (p.vencenHoy.length || p.incumplidas) {
    l.push("", "*Promesas*");
    if (p.vencenHoy.length) l.push(`• Vencen hoy: ${nombres(p.vencenHoy)}`);
    if (p.incumplidas) l.push(`• :warning: ${plural(p.incumplidas, "promesa incumplida", "promesas incumplidas")}`);
  }

  l.push("", "*WhatsApp*", lineaEnvios("Recordatorios de mora", d.whatsapp.mora), lineaEnvios("Preventivos", d.whatsapp.preventivos));
  if (d.chat.sinLeer) {
    const desde = d.chat.horasMasAntiguo !== null && d.chat.horasMasAntiguo >= 1 ? `; el más antiguo, hace ${plural(d.chat.horasMasAntiguo, "hora", "horas")}` : "";
    l.push(`• :speech_balloon: ${plural(d.chat.sinLeer, "mensaje sin leer", "mensajes sin leer")} en ${plural(d.chat.conversaciones, "conversación", "conversaciones")}${desde} → <${d.urlBase}/cobranza/chat|Chat>`);
  } else {
    l.push("• Chat: todo leído");
  }

  if (d.alertas.abiertas) {
    l.push("", `*Alertas:* ${plural(d.alertas.abiertas, "abierta", "abiertas")}${d.alertas.criticas ? ` (${plural(d.alertas.criticas, "crítica", "críticas")})` : ""}`);
  }
  l.push("", `<${d.urlBase}/cobranza/cola|Cola de trabajo> · <${d.urlBase}/cobranza|Inicio>`);
  return l.join("\n");
}
