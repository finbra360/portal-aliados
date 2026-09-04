-- Seed de vertical packs para el motor de prospección.
-- transporte_logistica va completo y activo (prioridad alta, Etapa 3).
-- Los demás quedan activo=false con scian_codes/keywords marcados
-- "a validar" -- no se activan hasta confirmar el catálogo SCIAN vigente
-- y completar el resto del config siguiendo la misma forma.

INSERT INTO lead_vertical_packs (id, nombre, descripcion, scian_codes, keywords, config, activo)
VALUES (
  'transporte_logistica',
  'Transporte y Logística',
  'Autotransporte de carga y logística terrestre con flota propia. Mejor fit del modelo: la flota es a la vez activo operativo y garantía vehicular.',
  ARRAY['484', '4841', '4842', '492', '493'],
  ARRAY['transporte de carga', 'autotransporte', 'flotilla propia', 'logística terrestre', 'paquetería y mensajería', 'transporte refrigerado'],
  '{
    "fuentes_prioritarias": ["denue", "google_maps", "serper_search"],
    "icp": {
      "empleados_min": 3,
      "empleados_max": 150,
      "ventas_mxn_min": 10000000,
      "ventas_mxn_max": 100000000,
      "ventas_mxn_sweet_spot": [15000000, 60000000],
      "antiguedad_anios_min": 2,
      "unidades_flota_min": 5,
      "unidades_flota_max": 50,
      "ciclo_cobranza_dias_min": 30,
      "requiere_garantia": true,
      "tipos_garantia_aceptados": ["vehicular", "inmobiliaria"]
    },
    "scoring_overrides": {},
    "buyer_persona_jerarquia": [
      "Dueño / Socio Director",
      "Director de Operaciones",
      "Director de Administración y Finanzas"
    ],
    "señales_crecimiento": [
      "expansion_flota",
      "nuevos_contratos",
      "nueva_ruta",
      "reparacion_o_mantenimiento_mayor",
      "nueva_sucursal"
    ],
    "enrichment_preguntas_cerradas": [
      {"campo": "tiene_flota_propia", "pregunta": "¿El sitio menciona que la empresa posee flota propia de tractocamiones o unidades de transporte?"},
      {"campo": "numero_unidades", "pregunta": "¿Cuántas unidades de flota se mencionan (número o rango aproximado)?"},
      {"campo": "tipo_unidades", "pregunta": "¿Qué tipo de unidades opera (caja seca, refrigerada, plataforma, pipa, etc.)?"},
      {"campo": "clientes_empresariales", "pregunta": "¿Mencionan trabajar con clientes empresariales o corporativos (no solo particulares)?"},
      {"campo": "señal_expansion", "pregunta": "¿Hay menciones de expansión de flota, nuevos contratos o nuevas rutas en los últimos 12 meses?"},
      {"campo": "antiguedad_operativa", "pregunta": "¿Cuántos años lleva operando la empresa, o en qué año se fundó?"},
      {"campo": "ventas_estimadas_anuales", "pregunta": "¿El sitio menciona ventas anuales, facturación o el tamaño de sus operaciones en términos de ingresos?"},
      {"campo": "ciclo_cobranza_dias", "pregunta": "¿Mencionan plazos de pago o crédito que ofrecen a sus clientes (ejemplo: 30, 60, 90 días)?"}
    ]
  }'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE SET
  config = EXCLUDED.config,
  scian_codes = EXCLUDED.scian_codes,
  keywords = EXCLUDED.keywords,
  updated_at = now();

-- Placeholders -- completar y activar en una pasada dedicada por industria.
INSERT INTO lead_vertical_packs (id, nombre, descripcion, scian_codes, keywords, config, activo)
VALUES
  ('manufactura', 'Manufactura', 'Condicional a posesión de nave industrial propia, maquinaria titulada o flota de reparto -- ver Etapa 3.', ARRAY['A_VALIDAR'], ARRAY['A_VALIDAR'], '{}'::jsonb, false),
  ('energia_solar', 'Energía Solar (EPC/instaladores)', 'Colateral típicamente más débil (poca flota); necesidad de liquidez centrada en compra de equipo antes del cobro de hitos.', ARRAY['A_VALIDAR'], ARRAY['A_VALIDAR'], '{}'::jsonb, false),
  ('servicios', 'Servicios (acotado)', 'Solo subsegmentos con inmueble/equipo propio: clínicas, talleres grandes, restaurantes con local propio.', ARRAY['A_VALIDAR'], ARRAY['A_VALIDAR'], '{}'::jsonb, false),
  ('tecnologia', 'Tecnología (acotado)', 'Solo infraestructura propia (telecom regional, datacenters, integradores de hardware) -- vertical secundaria, peor fit por ser asset-light.', ARRAY['A_VALIDAR'], ARRAY['A_VALIDAR'], '{}'::jsonb, false)
ON CONFLICT (id) DO NOTHING;
