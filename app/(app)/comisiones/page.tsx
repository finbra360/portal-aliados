import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import { IconCoins } from "@/components/ui/icons";

export default function ComisionesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comisiones</h1>

      <EmptyState
        icon={<IconCoins />}
        title="Aún no tenemos comisiones conectadas a tu portal"
        description="Estamos trabajando para traer aquí tus comisiones generadas, pendientes y pagadas, junto con su histórico."
      />

      <Card>
        <p className="mb-3 text-sm font-medium text-finbra-gray">Lo que vas a poder ver aquí</p>
        <ul className="grid gap-3 sm:grid-cols-3">
          <li className="rounded-lg bg-finbra-purple/5 p-4 text-sm">
            <p className="font-semibold text-finbra-purple">Generadas</p>
            <p className="mt-1 text-finbra-gray">Comisión calculada por cada operación fondeada.</p>
          </li>
          <li className="rounded-lg bg-finbra-purple/5 p-4 text-sm">
            <p className="font-semibold text-finbra-purple">Pendientes</p>
            <p className="mt-1 text-finbra-gray">Comisiones ya generadas en proceso de pago.</p>
          </li>
          <li className="rounded-lg bg-finbra-purple/5 p-4 text-sm">
            <p className="font-semibold text-finbra-purple">Pagadas</p>
            <p className="mt-1 text-finbra-gray">Histórico completo de pagos realizados.</p>
          </li>
        </ul>
      </Card>
    </div>
  );
}
