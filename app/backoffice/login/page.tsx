"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Step = "email" | "code";

const AREAS: { titulo: string; detalle: string; icono: ReactNode }[] = [
  {
    titulo: "Brokers y colocación",
    detalle: "Altas, colocación por broker, comisiones y concursos.",
    icono: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 11.5a3 3 0 1 0 0-6M17.5 14.2c2.3.5 4 2.3 4 5.8" />
      </>
    ),
  },
  {
    titulo: "Cobranza",
    detalle: "Cartera, promesas, recordatorios y conversaciones con clientes.",
    icono: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6.5 9.5v.01M17.5 14.5v.01" />
      </>
    ),
  },
  {
    titulo: "Leads",
    detalle: "Prospección B2B calificada, lista para el equipo comercial.",
    icono: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z" />,
  },
];

const input =
  "w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-base placeholder:text-black/35 transition-colors hover:border-finbra-purple/40 focus:border-finbra-purple";

export default function BackofficeLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backoffice/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.sent) {
        setError("No pudimos enviar el código. Verifica que tu email esté dado de alta como usuario interno.");
        return;
      }
      setStep("code");
    } catch {
      setError("Ocurrió un error. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backoffice/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setError("Código inválido o expirado.");
        return;
      }
      router.push("/backoffice/inicio");
      router.refresh();
    } catch {
      setError("Ocurrió un error. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Panel de marca: solo en pantallas grandes. El texto va en la parte morada del degradado (blanco sobre lila no cumple la marca). */}
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#5d5bdb_0%,#5d5bdb_55%,#e9aef9_100%)] text-white lg:block">
        <div aria-hidden="true" className="absolute -bottom-40 -right-32 h-[30rem] w-[30rem] rounded-full border border-white/25" />
        <div aria-hidden="true" className="absolute -bottom-24 -right-16 h-[22rem] w-[22rem] rounded-full border border-white/25" />
        <div aria-hidden="true" className="absolute -bottom-8 right-0 h-[14rem] w-[14rem] rounded-full bg-white/15" />
        <div aria-hidden="true" className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-white/[0.07]" />

        <div className="relative flex h-full max-w-xl flex-col px-12 pt-14 xl:px-16">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/90">Finbra · Backoffice</p>
          <p className="mt-10 text-4xl font-bold leading-tight xl:text-5xl">Todo el negocio, en un solo panel.</p>
          <p className="mt-4 max-w-md text-lg font-normal text-white/90">
            Herramienta interna del equipo de Finbra para operar con aliados, cobranza y prospección.
          </p>

          <ul className="mt-10 space-y-5">
            {AREAS.map((a) => (
              <li key={a.titulo} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {a.icono}
                  </svg>
                </span>
                <span>
                  <span className="block font-bold">{a.titulo}</span>
                  <span className="block text-sm text-white/90">{a.detalle}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Formulario. En móvil el degradado queda de fondo detrás de la tarjeta. */}
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#5d5bdb,#e9aef9)] px-4 py-10 lg:min-h-0 lg:bg-[#f7f7fb] lg:bg-none">
        <div className="w-full max-w-md rounded-2xl border border-finbra-purple/10 bg-white p-8 shadow-[0_4px_24px_rgba(93,91,219,0.2)] sm:p-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/finbra-logo.svg" alt="Finbra" className="mb-8 h-9 w-auto" />

          <ol className="mb-6 flex items-center gap-2 text-xs font-medium" aria-label="Pasos para entrar">
            <li aria-current={step === "email" ? "step" : undefined} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${step === "email" ? "bg-finbra-purple text-white" : "bg-finbra-purple-700 text-white"}`}>
                {step === "email" ? "1" : "✓"}
              </span>
              <span className={step === "email" ? "text-black" : "text-finbra-gray"}>Tu correo</span>
            </li>
            <li aria-hidden="true" className="h-0.5 w-8 rounded-full bg-[linear-gradient(90deg,#5d5bdb,#e9aef9)]" />
            <li aria-current={step === "code" ? "step" : undefined} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${step === "code" ? "bg-finbra-purple text-white" : "bg-black/10 text-finbra-gray"}`}>2</span>
              <span className={step === "code" ? "text-black" : "text-finbra-gray"}>Tu código</span>
            </li>
          </ol>

          <h1 className="text-2xl font-bold text-black">{step === "email" ? "Entra al backoffice" : "Revisa tu correo"}</h1>
          <p className="mb-6 mt-1 text-sm text-finbra-gray">
            {step === "email"
              ? "Acceso interno, solo para usuarios autorizados. Escribe tu correo de Finbra y te enviamos un código de 6 dígitos."
              : "Te enviamos un código de 6 dígitos. Escríbelo para entrar."}
          </p>

          {step === "email" ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                  Correo de Finbra
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@finbra.com"
                  className={input}
                />
              </div>
              {error && (
                <p id="login-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-finbra-purple px-6 py-3 font-bold text-white shadow-[0_2px_12px_rgba(93,91,219,0.3)] transition hover:bg-finbra-purple-700 disabled:opacity-60"
              >
                {loading ? "Enviando…" : "Enviar código"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <p className="rounded-lg bg-finbra-purple/5 px-3 py-2 text-sm">
                Código enviado a <span className="font-medium">{email}</span>
              </p>
              <div>
                <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
                  Código de 6 dígitos
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  title="6 dígitos"
                  maxLength={6}
                  required
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className={`${input} text-center text-2xl font-bold tracking-[0.5em]`}
                />
              </div>
              {error && (
                <p id="login-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-finbra-purple px-6 py-3 font-bold text-white shadow-[0_2px_12px_rgba(93,91,219,0.3)] transition hover:bg-finbra-purple-700 disabled:opacity-60"
              >
                {loading ? "Verificando…" : "Entrar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
                className="w-full rounded-lg border-2 border-finbra-purple px-6 py-2 font-medium text-finbra-purple-700 transition hover:bg-finbra-purple/5"
              >
                Usar otro correo
              </button>
            </form>
          )}

          <p className="mt-8 border-t border-black/5 pt-5 text-center text-xs text-finbra-gray">
            ¿Sin acceso? Pídele a un administrador que te dé de alta como usuario interno.
          </p>
        </div>
      </main>
    </div>
  );
}
