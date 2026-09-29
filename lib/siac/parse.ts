// Lectura de respuestas de SIAC. Sin dependencias para poder probarse con
// `node --test` directamente.

import type { ListadoCobranzaItem, ListadoCobranzaResponse } from "./types";

export class SiacParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiacParseError";
  }
}

/** Decodifica entidades HTML/XML. `&amp;` va al final para no convertir "&amp;quot;" en comillas. */
export function decodeEntities(texto: string): string {
  return texto
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * Los servicios .asmx regresan el JSON como texto dentro de un XML:
 * <string xmlns="http://tempuri.org/">{...}</string>, con las entidades escapadas.
 */
export function parseAsmxJson<T>(texto: string): T {
  const match = texto.match(/<string[^>]*>([\s\S]*)<\/string>/);
  if (!match) {
    throw new SiacParseError(`Respuesta inesperada de SIAC: ${decodeEntities(texto).slice(0, 200)}`);
  }
  const json = decodeEntities(match[1]);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new SiacParseError(`SIAC regresó JSON inválido: ${json.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- valores sueltos

/**
 * Fechas de SIAC ("2025-06-20T00:00:00") a "2025-06-20". SIAC usa fechas
 * centinela para "no hay": 1800-01-01 en ProximoVencimiento (ya no hay pagos
 * futuros) y 0001-01-01 en FechaAlta. Cualquier fecha anterior a 1900 se
 * trata como vacía.
 */
export function siacDate(valor: unknown): string | null {
  if (!valor) return null;
  const match = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  if (Number(match[1]) < 1900) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export const money = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};

export const int = (n: unknown): number | null => {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : null;
};

export const text = (s: unknown): string | null => {
  const v = s === null || s === undefined ? "" : String(s).trim();
  return v ? v : null;
};

// ---------------------------------------------------------------- ListadoCobranzaJSON

/** Un crédito del listado, ya limpio y con los nombres de columna de col_credits / col_credit_snapshots. */
export interface ListadoCredito {
  noCredito: string;
  numeroCliente: string;
  cliente: string;
  credito: {
    tipoCredito: string | null;
    tipoProducto: string | null;
    referencia: string | null;
    sucursal: string | null;
    municipio: string | null;
    idCobrador: string | null;
    nombrePromotor: string | null;
    programaEspecial: string | null;
    tasa: number | null;
    montoCredito: number | null;
    fechaMinistracion: string | null;
    fechaTerminoContrato: string | null;
    vencimientos: number | null;
    plazoMeses: number | null;
    frecuenciaPagos: string | null;
  };
  contacto: {
    celular: string | null;
    telefonoCliente: string | null;
    correoCliente: string | null;
    domicilioParticular: string | null;
    domicilioTrabajo: string | null;
    nombreAval: string | null;
    telefonoAval: string | null;
    correoAval: string | null;
    nombreReferencia1: string | null;
    telefonoReferencia1: string | null;
    nombreReferencia2: string | null;
    telefonoReferencia2: string | null;
  };
  foto: {
    antiguedad: number;
    atrasoMaximo: number | null;
    fechaUltimoPago: string | null;
    numeroVecesMora: number | null;
    vencimientosCubiertos: number | null;
    vencimientosVencidos: number | null;
    vencimientosPorVencer: number | null;
    diasSinMovimiento: number | null;
    proximoVencimiento: string | null;
    montoPorVencer: number | null;
    interesesMoratorios: number;
    ivaVencido: number;
    totalVencido: number;
    totalAdeudo: number;
    totalGlobal: number;
  };
  raw: ListadoCobranzaItem;
}

/**
 * Convierte la respuesta de ListadoCobranzaJSON en una lista plana de
 * créditos. Los créditos sin NoCredito o sin NumeroCliente no se pueden
 * identificar: se regresan aparte para registrarlos como aviso.
 */
export function parseListado(r: ListadoCobranzaResponse): { creditos: ListadoCredito[]; descartados: ListadoCobranzaItem[] } {
  const creditos: ListadoCredito[] = [];
  const descartados: ListadoCobranzaItem[] = [];
  for (const bloque of r.vListEntCredito ?? []) {
    for (const c of bloque.Cobranza ?? []) {
      const g = c.InformacionGeneral ?? ({} as ListadoCobranzaItem["InformacionGeneral"]);
      const f = c.CondicionesFinanciamientoCobranza ?? {};
      const k = c.InformacionContacto ?? {};
      const cr = c.CobranzaRespuesta ?? ({} as ListadoCobranzaItem["CobranzaRespuesta"]);
      const v = c.Vencido ?? ({} as ListadoCobranzaItem["Vencido"]);
      const noCredito = text(g.NoCredito);
      const numeroCliente = text(g.NumeroCliente);
      if (!noCredito || !numeroCliente) {
        descartados.push(c);
        continue;
      }
      creditos.push({
        noCredito,
        numeroCliente,
        cliente: text(g.Cliente) ?? "(sin nombre en SIAC)",
        credito: {
          tipoCredito: text(g.TipoCredito),
          tipoProducto: text(g.TipoProducto),
          referencia: text(g.Referencia),
          sucursal: text(g.Sucursal),
          municipio: text(g.Municipio),
          idCobrador: text(g.IDCobrador),
          nombrePromotor: text(g.NombrePromotor),
          programaEspecial: text(g.ProgramaEspecial),
          tasa: f.Tasa === null || f.Tasa === undefined || f.Tasa === "" ? null : Number(f.Tasa),
          montoCredito: f.MontoCredito === null || f.MontoCredito === undefined ? null : money(f.MontoCredito),
          fechaMinistracion: siacDate(f.FechaMinistracion),
          fechaTerminoContrato: siacDate(f.FechaTerminoContrato),
          vencimientos: int(f.Vencimientos),
          plazoMeses: int(f.PlazoMeses),
          frecuenciaPagos: text(cr.FrecuenciaPagos),
        },
        contacto: {
          celular: text(k.Celular),
          telefonoCliente: text(k.TelefonoCliente),
          correoCliente: text(k.CorreoCliente),
          domicilioParticular: text(k.DomicilioParticular),
          domicilioTrabajo: text(k.DomicilioTrabajo),
          nombreAval: text(k.NombreAval),
          telefonoAval: text(k.TelefonoAval),
          correoAval: text(k.CorreoAval),
          nombreReferencia1: text(k.NombreReferencia1),
          telefonoReferencia1: text(k.TelefonoReferencia1),
          nombreReferencia2: text(k.NombreReferencia2),
          telefonoReferencia2: text(k.TelefonoReferencia2),
        },
        foto: {
          antiguedad: Math.max(0, int(cr.Antiguedad) ?? 0),
          atrasoMaximo: int(cr.Atrasomaximo),
          fechaUltimoPago: siacDate(cr.FechaUltimoPago),
          numeroVecesMora: int(cr.NumeroVecesMora),
          vencimientosCubiertos: int(cr.VencimientosCubiertos),
          vencimientosVencidos: int(cr.VencimientosVencidos),
          vencimientosPorVencer: int(cr.VencimientosPorVencer),
          diasSinMovimiento: int(cr.DiasSinMovimiento),
          proximoVencimiento: siacDate(cr.ProximoVencimiento),
          montoPorVencer: cr.MontoPorVencer === null || cr.MontoPorVencer === undefined ? null : money(cr.MontoPorVencer),
          interesesMoratorios: money(v.InteresesMoratorios),
          ivaVencido: money(v.IVAVencido),
          totalVencido: money(v.TotalVencido),
          totalAdeudo: money(v.TotalAdeudo),
          totalGlobal: money(v.TotalGlobal),
        },
        raw: c,
      });
    }
  }
  return { creditos, descartados };
}
