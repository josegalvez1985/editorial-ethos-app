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

/**
 * Un valor de una lista de APEX (SI_NO, estado civil, cargo…): lo que se
 * guarda y lo que se ve. Lo devuelven los `…/opciones` de cada backend, que
 * leen las listas de `APEX_APPLICATION_LOV_ENTRIES` (ver facilitadores.sql).
 */
export type ValorLista = { valor: string; mostrar: string };

/** Campo de texto de los formularios en modal. 16px: con menos, iOS hace zoom. */
export const campo =
  "h-12 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus:border-primary/60";
