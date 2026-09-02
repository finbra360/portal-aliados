import EmptyState from "@/components/ui/EmptyState";

export default function BackofficeConfiguracionPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Configuración</h1>
      <EmptyState
        title="Fase 2"
        description="Visibilidad de módulos, umbrales de tiers (hoy en lib/tiers.ts), criterios de ranking, y otros parámetros del portal quedarán configurables aquí sin necesitar despliegue de código."
      />
    </div>
  );
}
