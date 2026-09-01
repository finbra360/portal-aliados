/**
 * Contenido borrador para el Centro de Recursos, redactado a partir de los
 * datos reales conocidos de Finbra (SOFOM ENR, crédito PyME con garantía
 * vehicular/inmobiliaria, rango $500k-$5M MXN). No incluye cifras que no
 * conocemos con certeza (tasas, plazos exactos, checklist documental oficial)
 * — Finbra debe revisar y completar antes de considerarlo contenido final.
 */

export const PRODUCTO = {
  nombre: "Crédito PyME con garantía",
  tipoEmpresa: "SOFOM ENR",
  rango: "$500,000 a $5,000,000 MXN",
  garantias: ["Vehicular", "Inmobiliaria"],
  descripcion:
    "Financiamiento para pequeñas y medianas empresas en México que necesitan capital de trabajo o crecimiento, respaldado por una garantía vehicular o inmobiliaria del solicitante o de la empresa.",
};

export const PERFIL_CLIENTE_IDEAL = {
  descripcion:
    "PyMEs formales, con al menos algunos meses de operación, que necesitan capital de trabajo o para crecer y cuentan con un vehículo o inmueble libre de gravamen (o con gravamen menor al valor de la garantía) para respaldar el crédito.",
  senales: [
    "Negocio con flujo de ingresos recurrente y comprobable",
    "Necesidad concreta de capital (inventario, equipo, expansión, liquidez)",
    "Cuenta con un vehículo o inmueble a su nombre o de la empresa",
    "Busca un monto entre $500,000 y $5,000,000 MXN",
  ],
};

export const SECTORES_OBJETIVO = [
  "Comercio y retail",
  "Servicios profesionales",
  "Manufactura ligera",
  "Transporte y logística",
  "Construcción",
];

export const PROCESO_PASOS = [
  { titulo: "Prospección", detalle: "Identificas a la PyME y validas que encaje con el perfil ideal." },
  { titulo: "Solicitud", detalle: "Se recopila la información básica de la empresa y de la garantía propuesta." },
  { titulo: "Análisis", detalle: "Finbra revisa la capacidad de pago del negocio y la garantía ofrecida." },
  { titulo: "Aprobación", detalle: "Se define el monto, plazo y condiciones finales del crédito." },
  { titulo: "Formalización", detalle: "Firma de contrato y constitución de la garantía." },
  { titulo: "Fondeo", detalle: "El monto aprobado se dispersa a la PyME." },
];

export const CHECKLIST_EXPEDIENTE = [
  "Identificación oficial del representante legal / solicitante",
  "Comprobante de domicilio de la empresa",
  "Documentación que acredite la constitución/operación del negocio",
  "Documentación de la garantía propuesta (factura/tarjeta de circulación o escritura, según aplique)",
  "Estados de cuenta recientes del negocio",
];

export const OBJECIONES = [
  {
    objecion: "\"El proceso de crédito con financieras es muy lento\"",
    respuesta:
      "El proceso de Finbra está diseñado para PyMEs: se enfoca en la información esencial del negocio y la garantía, evitando trámites innecesarios.",
  },
  {
    objecion: "\"No quiero arriesgar mi vehículo o inmueble\"",
    respuesta:
      "La garantía respalda el crédito solo mientras esté vigente; al liquidarse el crédito conforme a lo pactado, la garantía se libera normalmente.",
  },
  {
    objecion: "\"Ya tengo crédito con el banco\"",
    respuesta:
      "Finbra puede complementar el financiamiento bancario cuando la PyME necesita capital adicional o no cumple con los requisitos de la banca tradicional.",
  },
];

export const FAQ = [
  {
    pregunta: "¿Qué tipo de empresa puede aplicar?",
    respuesta: "PyMEs formalmente constituidas u operando en México que puedan ofrecer una garantía vehicular o inmobiliaria.",
  },
  {
    pregunta: "¿Cuánto puede solicitar un cliente?",
    respuesta: "Entre $500,000 y $5,000,000 MXN, sujeto a análisis de capacidad de pago y valor de la garantía.",
  },
  {
    pregunta: "¿Cómo le doy seguimiento a una solicitud que envié?",
    respuesta: "Por ahora el seguimiento detallado por etapas está en desarrollo; mientras tanto, contacta directamente a tu contacto en Finbra para status.",
  },
];

export const GLOSARIO = [
  { termino: "SOFOM ENR", definicion: "Sociedad Financiera de Objeto Múltiple, Entidad No Regulada — puede otorgar crédito sin captar depósitos del público." },
  { termino: "Garantía", definicion: "Bien (vehículo, inmueble) que respalda el pago de un crédito en caso de incumplimiento." },
  { termino: "Capital de trabajo", definicion: "Recursos que una empresa necesita para operar en el día a día (inventario, nómina, proveedores)." },
  { termino: "Ticket promedio", definicion: "Monto promedio de las operaciones colocadas por un broker." },
  { termino: "Amortización", definicion: "Proceso de pagar una deuda mediante pagos periódicos que cubren capital e intereses." },
];
