import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-finbra-purple/10 bg-white p-8 text-center shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
        <h1 className="mb-2 text-2xl font-bold text-finbra-purple">No encontramos esa página</h1>
        <p className="mb-6 text-sm text-finbra-gray">Puede que el enlace esté incompleto o que la página ya no exista.</p>
        <Link href="/" className="inline-block rounded-lg bg-finbra-purple px-6 py-2 text-sm font-bold text-white">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
