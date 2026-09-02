import Link from "next/link";
import { getLeaderboard } from "@/lib/n8n";
import { formatCurrency } from "@/lib/format";
import Card from "@/components/ui/Card";

export default async function BackofficeBrokersPage() {
  let leaderboard: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let loadError = false;
  try {
    leaderboard = await getLeaderboard();
  } catch {
    loadError = true;
  }

  if (loadError || !leaderboard) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar el listado de brokers en este momento.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Brokers</h1>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-finbra-gray">
              <th className="px-6 py-3">Broker</th>
              <th className="px-6 py-3">ID</th>
              <th className="px-6 py-3">Colocado</th>
              <th className="px-6 py-3">Operaciones</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.ranking.map((b) => (
              <tr key={b.brokerId} className="border-b border-black/5 last:border-0">
                <td className="px-6 py-4">{b.nombre}</td>
                <td className="px-6 py-4 text-finbra-gray">{b.brokerId}</td>
                <td className="px-6 py-4 font-semibold">{formatCurrency(b.totalColocado)}</td>
                <td className="px-6 py-4">{b.numOperaciones}</td>
                <td className="px-6 py-4 text-right">
                  <Link href={`/backoffice/brokers/${b.brokerId}`} className="text-sm font-semibold text-finbra-purple hover:underline">
                    Ver perfil →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
