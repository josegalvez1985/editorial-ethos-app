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

/** Campo de texto de los formularios en modal. 16px: con menos, iOS hace zoom. */
export const campo =
  "h-12 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus:border-primary/60";
