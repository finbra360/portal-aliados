"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Step = "email" | "code";

const BENEFICIOS: { titulo: string; detalle: string; icono: ReactNode }[] = [
  {
    titulo: "Sigue tus solicitudes",
    detalle: "Ve en qué etapa va cada crédito que nos mandas, sin llamar.",
    icono: <path d="M4 6h16M4 12h10M4 18h6" />,
  },
  {
    titulo: "Consulta tus comisiones",
    detalle: "Qué está generado, aprobado y pagado, al día.",
    icono: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5C9.5 8.4 10.6 8 12 8s2.5.6 2.5 1.7-1 1.5-2.5 1.8-2.5.7-2.5 1.8S10.6 15 12 15s2.5-.5 2.5-1.5" />
      </>
    ),
  },
  {
    titulo: "Compite en los concursos",
    detalle: "Mira tu lugar en tiempo real y qué te falta para ganar.",
    icono: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />,
  },
];

const input =
  "w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-base placeholder:text-black/35 transition-colors hover:border-finbra-purple/40 focus:border-finbra-purple";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El portal manda aquí con ?sesion=cerrada cuando el acceso se desactivó con la sesión abierta.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sesion") === "cerrada") {
      setError("Tu acceso al portal ya no está activo. Si crees que es un error, contacta a Finbra.");
    }
  }, []);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setError(data.error ?? "Demasiados intentos. Espera unos minutos e intenta de nuevo.");
        return;
      }
      if (!res.ok || !data.sent) {
        setError("No pudimos enviar el código. Intenta de nuevo en unos minutos.");
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
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setError(data.error ?? "Demasiados intentos. Espera unos minutos e intenta de nuevo.");
        return;
      }
      if (!res.ok || !data.valid) {
        setError("Código inválido o expirado.");
        return;
      }
      router.push("/dashboard");
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
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/90">Finbra · Portal de Aliados</p>
          <p className="mt-10 text-4xl font-bold leading-tight xl:text-5xl">El brazo financiero de tu negocio.</p>
          <p className="mt-4 max-w-md text-lg font-normal text-white/90">
            Todo lo que colocas con Finbra, en un solo lugar y en tiempo real.
          </p>

          <ul className="mt-10 space-y-5">
            {BENEFICIOS.map((b) => (
              <li key={b.titulo} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {b.icono}
                  </svg>
                </span>
                <span>
                  <span className="block font-bold">{b.titulo}</span>
                  <span className="block text-sm text-white/90">{b.detalle}</span>
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

          <h1 className="text-2xl font-bold text-black">{step === "email" ? "Entra a tu portal" : "Revisa tu correo"}</h1>
          <p className="mb-6 mt-1 text-sm text-finbra-gray">
            {step === "email"
              ? "Escribe el correo con el que estás dado de alta como aliado y te enviamos un código de 6 dígitos."
              : "Si el correo está dado de alta como aliado, te enviamos un código. Vence en 10 minutos."}
          </p>

          {step === "email" ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                  Correo electrónico
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
                  placeholder="tu@correo.com"
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
            ¿Problemas para entrar? Escríbele a tu contacto en Finbra. · SOFOM ENR
          </p>
        </div>
      </main>
    </div>
  );
}
