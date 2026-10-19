"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Step = "email" | "code";

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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-finbra-purple/10 bg-white p-8 shadow-[0_2px_12px_rgba(93,91,219,0.12)]">
        <h1 className="mb-1 text-2xl font-bold text-finbra-purple">Portal de Aliados</h1>
        <p className="mb-6 text-sm text-finbra-gray">Finbra 360 Express</p>

        {step === "email" ? (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
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
                placeholder="tu@email.com"
                className="w-full rounded-lg border border-black/10 px-3 py-2 focus:border-finbra-purple"
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-finbra-purple px-6 py-3 font-bold text-white disabled:opacity-60"
            >
              {loading ? "Enviando…" : "Enviar código"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <p className="text-sm">
              Si <span className="font-medium">{email}</span> está dado de alta como aliado, te enviamos un código.
            </p>
            <div>
              <label htmlFor="code" className="mb-1 block text-sm font-medium">
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
                className="w-full rounded-lg border border-black/10 px-3 py-2 tracking-widest focus:border-finbra-purple"
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-finbra-purple px-6 py-3 font-bold text-white disabled:opacity-60"
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
              className="w-full rounded-lg border-2 border-finbra-purple px-6 py-2 font-medium text-finbra-purple"
            >
              Usar otro email
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
