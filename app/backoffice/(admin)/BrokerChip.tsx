import Link from "next/link";

/**
 * Marca de que una empresa o un negocio viene de un broker: «Broker · Nombre»
 * (con liga a su ficha) o «Broker sin asignar» si así llegó de HubSpot y nadie
 * le ha puesto broker todavía.
 */
export default function BrokerChip({ broker, compacto = false }: { broker: { id: string | null; nombre: string | null } | null | undefined; compacto?: boolean }) {
  if (!broker) return null;
  const clase = `inline-flex max-w-full items-center gap-1 rounded-full border border-finbra-lilac bg-finbra-lilac/25 px-2 py-0.5 font-medium text-finbra-purple-700 ${compacto ? "text-[11px]" : "text-xs"}`;
  const texto = (
    <>
      <span aria-hidden="true">⇄</span>
      <span className="truncate">{broker.nombre ? `Broker · ${broker.nombre}` : "Broker sin asignar"}</span>
    </>
  );
  if (broker.id && !compacto) {
    return (
      <Link href={`/backoffice/brokers/${encodeURIComponent(broker.id)}`} className={`${clase} hover:bg-finbra-lilac/40`} title="Referida por este broker">
        {texto}
      </Link>
    );
  }
  return (
    <span className={clase} title={broker.nombre ? "Referida por este broker" : "Viene de un broker, pero no tiene broker asignado: asígnalo en el negocio"}>
      {texto}
    </span>
  );
}
