import EmptyState from "@/components/ui/EmptyState";
import { IconTrophy } from "@/components/ui/icons";

export default function ConcursosPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Concursos</h1>

      <EmptyState
        icon={<IconTrophy />}
        title="No hay concursos activos por el momento"
        description="Cuando Finbra lance un concurso (mensual, trimestral o especial), vas a poder ver aquí las reglas, el periodo, el premio y tu posición en tiempo real."
      />
    </div>
  );
}
