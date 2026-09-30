// Respuestas de los web services de SIAC Suite (ConsultasSIACSuiteJSON.asmx).
// Solo incluye campos verificados contra el ambiente de pruebas (28 y 29 de
// septiembre de 2026). Muchos llegan vacíos o null; lo demás se conserva en
// el `raw` de cada tabla.

export interface SiacEnvelope {
  Detalle: string;
}

type Texto = string | null | undefined;
type Numero = number | string | null | undefined;

export interface ListadoCobranzaItem {
  InformacionGeneral: {
    NoCredito: Texto;
    NumeroCliente: Texto;
    Cliente: Texto;
    TipoCredito?: Texto;
    Referencia?: Texto;
    Sucursal?: Texto;
    Municipio?: Texto;
    TipoProducto?: Texto;
    IDCobrador?: Texto;
    NombrePromotor?: Texto;
    ProgramaEspecial?: Texto;
    ReferenciaClubPago?: Texto;
    CLABEClubPago?: Texto;
  };
  CondicionesFinanciamientoCobranza?: {
    Tasa?: Numero;
    MontoCredito?: Numero;
    FechaMinistracion?: Texto;
    FechaTerminoContrato?: Texto;
    Vencimientos?: Numero;
    PlazoMeses?: Numero;
  };
  InformacionContacto?: {
    TelefonoCliente?: Texto;
    Celular?: Texto;
    CorreoCliente?: Texto;
    DomicilioParticular?: Texto;
    DomicilioTrabajo?: Texto;
    NombreAval?: Texto;
    DireccionAval?: Texto;
    TelefonoAval?: Texto;
    CorreoAval?: Texto;
    NombreReferencia1?: Texto;
    DireccionReferencia1?: Texto;
    TelefonoReferencia1?: Texto;
    NombreReferencia2?: Texto;
    DireccionReferencia2?: Texto;
    TelefonoReferencia2?: Texto;
  };
  CobranzaRespuesta: {
    /** Días de atraso actuales. */
    Antiguedad: Numero;
    Atrasomaximo?: Numero;
    FechaUltimoPago?: Texto;
    NumeroVecesMora?: Numero;
    VencimientosCubiertos?: Numero;
    VencimientosVencidos?: Numero;
    VencimientosPorVencer?: Numero;
    FrecuenciaPagos?: Texto;
    DiasSinMovimiento?: Numero;
    /** "1800-01-01" cuando ya no hay pagos futuros. */
    ProximoVencimiento?: Texto;
    /** Total pendiente por vencer, NO la mensualidad. */
    MontoPorVencer?: Numero;
  };
  Vencido: {
    InteresesMoratorios: Numero;
    IVAVencido: Numero;
    TotalVencido: Numero;
    TotalAdeudo: Numero;
    TotalGlobal: Numero;
  };
}

export interface ListadoCobranzaResponse extends SiacEnvelope {
  vListEntCredito?: { Cobranza?: ListadoCobranzaItem[] }[];
}

/** Respuesta de ConsultarSaldoCredito (solo bajo demanda). */
export interface ConsultarSaldoCreditoResponse extends SiacEnvelope {
  Generales: { NoControl: string; IDCliente: string; NombreCliente: string; FechaCalculo: string };
  SaldoVigente: Record<string, number> & { saldoVigente: number };
  SaldoVencido: Record<string, number> & { saldoVencido: number };
  Totales: { SaldoActual: number; TotalPagar: number; SaldoGlobal: number; CAT: string | null };
  Sumatorias: Record<string, number>;
}

/** Respuesta de ConsultarPagos: toda la historia de pagos de un crédito. */
export interface ConsultarPagosResponse extends SiacEnvelope {
  ListadoPagos?: {
    Generales?: { NoControl?: Texto; IDCliente?: Texto; NombreCliente?: Texto };
    DetallePago?: {
      FechaCaptura?: Texto;
      Monto?: Numero;
      FechaAplicacion?: Texto;
      /** Llega en 1 en todos los registros probados: no sirve como identificador. */
      NoPago?: Numero;
      ConceptoPago?: Texto;
      Comentario?: Texto;
    };
  }[];
}
