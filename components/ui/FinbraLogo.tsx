/**
 * Marca de Finbra para el backoffice: el isotipo oficial (public/finbra-isotipo.svg,
 * sacado de "Logos Finbra editable.ai") con el nombre. El logo horizontal
 * completo está en public/finbra-logo.svg.
 */
export default function FinbraLogo({ subtitulo }: { subtitulo?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/finbra-isotipo.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
      <span className="leading-tight">
        <span className="block text-base font-bold text-black">Finbra</span>
        {subtitulo && <span className="block text-[11px] font-medium uppercase tracking-wider text-finbra-gray">{subtitulo}</span>}
      </span>
    </span>
  );
}
