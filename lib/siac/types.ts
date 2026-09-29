// Respuestas de los web services de SIAC Suite (ConsultasSIACSuiteJSON.asmx).
// Solo incluye campos verificados contra el ambiente de pruebas el 2026-09-28;
// lo demás se conserva en el `raw` de cada tabla.

export interface SiacEnvelope {
  Detalle: string;
}

export interface SiacCliente {
  IdCliente: string;
  Nombre: string | null;
  Rfc: string | null;
  Celular: string | null;
  NumeroTelefono: string | null;
  Email: string | null;
  Email2?: string | null;
  [campo: string]: unknown;
}

export interface ConsultarClientesResponse extends SiacEnvelope {
  ClienteOuts?: SiacCliente[];
}

export interface SiacCredito {
  Generales: {
    IDCliente: string;
    NombreCliente: string;
    NoControl: string;
    TipoCredito: string | null;
    FechaAlta: string;
    MontoCredito: number;
  };
  CondicionesFinanciamiento: {
    TasaNormal: string | null;
    TasaNormalPuntosAdicionales: number | null;
    TasaMoratoria: string | null;
    TasaMoratoriaPuntosAdicionales: number | null;
    TasaMoratoriaFactor: number | null;
    PeriodoPago: string | null;
    EsquemaPago: string | null;
    FrecuenciaPago: string | null;
    NumeroVencimientos: number | null;
    [campo: string]: unknown;
  };
  Otros: {
    EstatusCredito: string;
    Promotor: string | null;
    Referencia: string | null;
  };
  [campo: string]: unknown;
}

export interface ConsultarCreditosResponse extends SiacEnvelope {
  ListadoCreditos?: SiacCredito[];
}

export interface ConsultarSaldoCreditoResponse extends SiacEnvelope {
  Generales: {
    NoControl: string;
    IDCliente: string;
    NombreCliente: string;
    FechaCalculo: string;
  };
  SaldoVigente: {
    saldoVigente: number;
    CapitalVigente: number;
    IVACapitalVigente: number;
    InteresesVigentes: number;
    IVAInteresesVigentes: number;
    ComisionesFuturas: number;
    IVAComisionesFuturas: number;
  };
  SaldoVencido: {
    saldoVencido: number;
    CapitalVencido: number;
    IVACapitalVencido: number;
    InteresesVencidos: number;
    IVAInteresesVencidos: number;
    InteresesMoratorios: number;
    IVAInteresesMoratorios: number;
    ComisionesVencidas: number;
    IVAComisionesVencidas: number;
  };
  Totales: {
    SaldoActual: number;
    TotalPagar: number;
    SaldoGlobal: number;
    CAT: string | null;
  };
  Sumatorias: {
    Ministraciones: number;
    Pagos: number;
    Comisiones: number;
    Condonaciones: number;
    Quitas: number;
    Castigos: number;
  };
}
