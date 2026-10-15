import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosReporte } from "./reporte.ts";

const base: DatosReporte = {
  fecha: "2026-10-16",
  urlBase: "https://backoffice.finbra.com",
  foto: { fechaCorte: "2026-10-16", estado: "al_dia", error: null },
  cartera: { clientesEnMora: 24, vencidoEnMora: 1234567.8, creditos: 50, par30: 0.1234 },
  eventos: { entradasMora: [], regularizaciones: 0, pagosDetectados: 0, nuevasVencidas: 0 },
  promesas: { vencenHoy: [], incumplidas: 0 },
  whatsapp: { mora: { enviados: 0, fallidos: 0, bloqueo: "El envío automático está apagado" }, preventivos: { enviados: 0, fallidos: 0, bloqueo: null } },
  chat: { sinLeer: 0, conversaciones: 0, horasMasAntiguo: null },
  alertas: { abiertas: 0, criticas: 0 },
};

test("reporte de un día tranquilo", () => {
  const r = armarReporte(base);
  assert.match(r, /^\*Cobranza — reporte del 2026-10-16\*/);
  assert.match(r, /• 24 clientes en mora, \$1,234,568 vencido/);
  assert.match(r, /• 50 créditos activos · PAR30 12\.3%/);
  assert.match(r, /\*Movimientos de hoy\*\n• Sin cambios/);
  assert.match(r, /• Recordatorios de mora: ninguno \(el envío automático está apagado\)/);
  assert.match(r, /• Preventivos: ninguno$/m);
  assert.match(r, /• Chat: todo leído/);
  assert.doesNotMatch(r, /Promesas|Alertas/, "lo que está en cero no aparece");
  assert.match(r, /<https:\/\/backoffice\.finbra\.com\/cobranza\/cola\|Cola de trabajo>/);
});

test("reporte con movimientos, promesas, envíos y chat", () => {
  const r = armarReporte({
    ...base,
    eventos: { entradasMora: ["A", "B", "C", "D", "E", "F", "G"], regularizaciones: 1, pagosDetectados: 3, nuevasVencidas: 2 },
    promesas: { vencenHoy: ["EMPRESA X"], incumplidas: 2 },
    whatsapp: { mora: { enviados: 12, fallidos: 1, bloqueo: null }, preventivos: { enviados: 1, fallidos: 0, bloqueo: null } },
    chat: { sinLeer: 3, conversaciones: 2, horasMasAntiguo: 5 },
    alertas: { abiertas: 30, criticas: 1 },
  });
  assert.match(r, /Entraron a mora: A, B, C, D, E y 2 más/);
  assert.match(r, /2 créditos vencieron otra mensualidad sin pago/);
  assert.match(r, /3 pagos detectados/);
  assert.match(r, /1 crédito se puso al corriente/);
  assert.match(r, /• Vencen hoy: EMPRESA X/);
  assert.match(r, /2 promesas incumplidas/);
  assert.match(r, /• Recordatorios de mora: 12 enviados, :warning: 1 fallido/);
  assert.match(r, /• Preventivos: 1 enviado$/m);
  assert.match(r, /3 mensajes sin leer en 2 conversaciones; el más antiguo, hace 5 horas → <https:\/\/backoffice\.finbra\.com\/cobranza\/chat\|Chat>/);
  assert.match(r, /\*Alertas:\* 30 abiertas \(1 crítica\)/);
});

test("reporte cuando SIAC no actualizó la foto", () => {
  const r = armarReporte({ ...base, foto: { fechaCorte: "2026-10-15", estado: "atrasada", error: "SIAC respondió 500" } });
  assert.match(r, /:warning: La foto de SIAC no es de hoy: la última es del 2026-10-15\. Error: SIAC respondió 500/);
  assert.match(armarReporte({ ...base, foto: { fechaCorte: null, estado: "sin_foto", error: null }, cartera: null }), /No hay ninguna foto de SIAC/);
});
