// Lector mínimo de .xlsx (la primera hoja, como texto) para los exports de
// SIAC Suite. Un .xlsx es un zip con XML adentro: aquí se lee el directorio del
// zip y se descomprime con la función que se le pase (en el navegador,
// DecompressionStream("deflate-raw"); en las pruebas, zlib). Sin dependencias.

export type Inflar = (datos: Uint8Array) => Promise<Uint8Array>;

/** Los archivos del zip (nombre → contenido), descomprimidos. */
async function abrirZip(bytes: Uint8Array, inflar: Inflar): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: firma 0x06054b50, buscada desde el final.
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx).");
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const archivos = new Map<string, Uint8Array>();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("El Excel está dañado.");
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (!nombre.startsWith("xl/")) continue;
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const datos = bytes.subarray(inicio, inicio + comprimido);
    if (metodo === 0) archivos.set(nombre, datos);
    else if (metodo === 8) archivos.set(nombre, await inflar(datos));
    else throw new Error("El Excel usa una compresión que no conocemos. Ábrelo y guárdalo de nuevo como .xlsx.");
  }
  return archivos;
}

const sinPrefijo = (s: string) => s.replace(/<(\/?)[A-Za-z0-9]+:/g, "<$1");
const entidades = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => entidades(t[1])).join("");

function columna(ref: string): number {
  let n = 0;
  for (const c of ref.match(/^[A-Z]+/)![0]) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

/** La primera hoja del .xlsx como renglones de texto (las celdas vacías, ""). */
export async function leerXlsx(bytes: Uint8Array, inflar: Inflar): Promise<string[][]> {
  const archivos = await abrirZip(bytes, inflar);
  const dec = new TextDecoder();
  const hojas = [...archivos.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!hojas.length) throw new Error("El Excel no tiene hojas.");
  const compartidos = archivos.get("xl/sharedStrings.xml");
  const cadenas = compartidos ? [...sinPrefijo(dec.decode(compartidos)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  const hoja = sinPrefijo(dec.decode(archivos.get(hojas[0])!));
  const renglones: string[][] = [];
  for (const r of hoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+)\d+"/);
      if (!ref) continue;
      const tipo = c[1].match(/\bt="(\w+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const valor = tipo === "s" ? (cadenas[Number(v)] ?? "") : tipo === "inlineStr" ? textos(c[2] ?? "") : entidades(v ?? "");
      fila[columna(ref[1])] = valor;
    }
    renglones.push(Array.from(fila, (x) => x ?? ""));
  }
  return renglones;
}
