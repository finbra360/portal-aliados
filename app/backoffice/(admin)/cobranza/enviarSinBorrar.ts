import { startTransition, type FormEvent } from "react";

/**
 * Handler de onSubmit para un formulario de useActionState. Con `action={...}`,
 * React 19 vacía el formulario al terminar aunque la acción regrese un error, y
 * la persona tiene que volver a escribir todo. Así se conserva lo escrito; para
 * limpiarlo después de guardar, cambia la `key` del formulario o desmóntalo.
 */
export function enviarSinBorrar(accion: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => accion(fd));
  };
}
