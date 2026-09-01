import { getRecursos, type Recurso } from "@/lib/n8n";

export default async function RecursosPage() {
  let recursos: Recurso[] = [];
  let loadError = false;

  try {
    const data = await getRecursos();
    recursos = data.recursos;
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        No pudimos cargar los recursos en este momento. Intenta de nuevo más tarde.
      </div>
    );
  }

  const porCategoria = recursos.reduce<Record<string, Recurso[]>>((acc, recurso) => {
    (acc[recurso.categoria] ??= []).push(recurso);
    return acc;
  }, {});

  const categorias = Object.keys(porCategoria);

  if (!categorias.length) {
    return <p className="text-sm text-finbra-gray">Todavía no hay recursos disponibles.</p>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Recursos</h1>
      {categorias.map((categoria) => (
        <section key={categoria}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-finbra-purple">{categoria}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {porCategoria[categoria].map((recurso) => (
              <a
                key={recurso.url}
                href={recurso.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-finbra-purple/10 bg-white p-5 shadow-[0_2px_12px_rgba(93,91,219,0.12)] transition hover:shadow-[0_4px_24px_rgba(93,91,219,0.2)]"
              >
                <span className="mb-2 inline-block rounded-full bg-finbra-purple/10 px-3 py-1 text-xs font-semibold text-finbra-purple">
                  {recurso.tipo}
                </span>
                <p className="font-medium">{recurso.titulo}</p>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
