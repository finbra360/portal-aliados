import Skeleton from "./Skeleton";

export default function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Cargando">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
