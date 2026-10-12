import { diaISO, hoyISO, sumarDias } from "@/lib/fechas";

/*
 * El período de los reportes por fechas (Resumen de Intervenciones, Totales
 * por Facilitador y Auditoría de Intervenciones: páginas 53, 55 y 58): atajos
 * en pastillas y "Otro período" con las dos fechas. Reemplaza los dos date
 * pickers de APEX y su botón Consultar: la pantalla consulta sola al cambiar el
 * período.
 */

export type Periodo = "mes" | "mes-anterior" | "semana" | "semana-pasada" | "otro";
export type Rango = { desde: string; hasta: string };

export const PERIODOS: { clave: Periodo; texto: string }[] = [
  { clave: "mes", texto: "Este mes" },
  { clave: "mes-anterior", texto: "Mes anterior" },
  { clave: "semana", texto: "Esta semana" },
  { clave: "semana-pasada", texto: "Semana pasada" },
  { clave: "otro", texto: "Otro período" },
];

/** El lunes de la semana de `f`. */
const lunesDe = (f: string) => {
  const dow = (new Date(`${f}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return sumarDias(f, -dow);
};

/** Las fechas (`YYYY-MM-DD`) de un período; "otro" son las que se eligieron. */
export function rangoDe(p: Periodo, otro: Rango): Rango {
  const hoy = hoyISO();
  const primero = `${hoy.slice(0, 8)}01`;
  switch (p) {
    case "mes":
      return { desde: primero, hasta: hoy };
    case "mes-anterior": {
      const fin = sumarDias(primero, -1);
      return { desde: `${fin.slice(0, 8)}01`, hasta: fin };
    }
    case "semana":
      return { desde: lunesDe(hoy), hasta: hoy };
    case "semana-pasada": {
      const l = sumarDias(lunesDe(hoy), -7);
      return { desde: l, hasta: sumarDias(l, 6) };
    }
    default:
      return otro;
  }
}

/** Un período que el backend acepta: las dos fechas, en orden, hasta un año. */
export const rangoValido = ({ desde, hasta }: Rango) =>
  !!desde && !!hasta && desde <= hasta && diaISO(hasta) - diaISO(desde) <= 366;

/** El "Otro período" con que entra la pantalla: los últimos 30 días. */
export const otroInicial = (): Rango => ({ desde: sumarDias(hoyISO(), -30), hasta: hoyISO() });
