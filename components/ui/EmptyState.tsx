import type { ReactNode } from "react";
import Card from "./Card";

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <div className="mb-1 text-3xl text-finbra-purple/40">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-finbra-gray">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}
