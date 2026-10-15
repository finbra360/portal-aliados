/**
 * Marca de Finbra para el backoffice. Mientras no esté el archivo oficial del
 * logo, se dibuja el ícono "F" (el mismo de app/icon.svg) con el nombre.
 * Para usar el logo oficial: agregarlo como public/finbra-logo.svg y cambiar
 * este componente por un <img src="/finbra-logo.svg" alt="Finbra" />.
 */
export default function FinbraLogo({ subtitulo }: { subtitulo?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width={32} height={32} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#5d5bdb" />
        <path d="M11 8h12v4H15v4h7v4h-7v6h-4V8Z" fill="#ffffff" />
      </svg>
      <span className="leading-tight">
        <span className="block text-base font-bold text-black">Finbra</span>
        {subtitulo && <span className="block text-[11px] font-medium uppercase tracking-wider text-finbra-gray">{subtitulo}</span>}
      </span>
    </span>
  );
}
