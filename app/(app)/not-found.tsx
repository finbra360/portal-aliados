import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";

export default function AppNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState title="No encontramos lo que buscas" description="Puede que el enlace esté incompleto o que esa solicitud no sea tuya." />
      <p className="text-center">
        <Link href="/operaciones" className="text-sm font-semibold text-finbra-purple hover:underline">
          Ir a Mis Operaciones
        </Link>
      </p>
    </div>
  );
}
