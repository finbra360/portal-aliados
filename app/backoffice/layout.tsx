import type { Metadata } from "next";
import type { ReactNode } from "react";

// Sobrescribe el título de la raíz ("Portal de Aliados") para todo /backoffice/*,
// que es lo que se ve en la pestaña al entrar por backoffice.finbra.com.
// El robots noindex del layout raíz se hereda.
export const metadata: Metadata = {
  title: "Finbra Backoffice",
  description: "Panel interno de administración de Finbra.",
};

export default function BackofficeRootLayout({ children }: { children: ReactNode }) {
  return children;
}
