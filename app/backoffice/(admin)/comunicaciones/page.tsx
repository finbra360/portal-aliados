import EmptyState from "@/components/ui/EmptyState";

export default function BackofficeComunicacionesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comunicaciones</h1>
      <EmptyState
        title="Fase 2 — esquema listo, sin interfaz todavía"
        description="La tabla 'announcements' (título, mensaje, CTA, audiencia, fechas) ya existe en la base de datos. Falta construir la pantalla para crear anuncios y el panel de notificaciones en el portal para consumirlos."
      />
    </div>
  );
}
