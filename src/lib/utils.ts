import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Sin mayúsculas ni tildes: "garcia" encuentra "García". */
export function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Una palabra en plural, en singular: "postulaciones" → "postulación". */
function singular(p: string) {
  if (/iones$/.test(p)) return p.slice(0, -5) + "ión"; // postulaciones, intervenciones
  if (/dades$/.test(p)) return p.slice(0, -2); // ciudades, nacionalidades
  if (/(or|al|el|il)es$/.test(p)) return p.slice(0, -2); // facilitadores, sucursales
  if (/a[ií]ses$/.test(p)) return p.slice(0, -4) + "ís"; // paises (en la base va sin tilde)
  if (/[aeo]s$/.test(p)) return p.slice(0, -1); // horarios, docentes, existencias
  return p; // énfasis, pre, detalle
}

/**
 * El nombre de una tabla para los textos de uso: "PRE_HORARIOS" → "pre
 * horarios", y en singular si es una sola fila ("1 postulación", no "1
 * postulaciones"; 19/10/2026, a pedido). El nombre sale de la base (incluso de
 * las FK), así que el singular es por regla y no por lista.
 */
export function nombreTabla(tabla: string, cantidad: number) {
  const palabras = tabla.toLowerCase().split("_").filter(Boolean);
  return (cantidad === 1 ? palabras.map(singular) : palabras).join(" ");
}

/**
 * Un valor de una lista de APEX (SI_NO, estado civil, cargo…): lo que se
 * guarda y lo que se ve. Lo devuelven los `…/opciones` de cada backend, que
 * leen las listas de `APEX_APPLICATION_LOV_ENTRIES` (ver facilitadores.sql).
 */
export type ValorLista = { valor: string; mostrar: string };

/** Campo de texto de los formularios en modal. 16px: con menos, iOS hace zoom. */
export const campo =
  "h-12 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus:border-primary/60";
