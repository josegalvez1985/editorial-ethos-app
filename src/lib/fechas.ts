/**
 * Fechas `YYYY-MM-DD` (lo que dan los `<input type="date">` y devuelve el
 * backend) sin zona horaria: se arman y se muestran en UTC para que un
 * `new Date("2026-02-01")` no se corra al 31 de enero en Paraguay.
 *
 * Las usan Años Lectivos y Feriados (09/10/2026).
 */

/** Hoy en la hora local, como `YYYY-MM-DD`. */
export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Días desde 1970: para restar fechas sin que la zona horaria corra el día. */
export function diaISO(f: string): number {
  const [a, m, d] = f.split("-").map(Number);
  return Math.round(Date.UTC(a, (m || 1) - 1, d || 1) / 86_400_000);
}

const fecha = (f: string) => new Date(`${f}T00:00:00Z`);

/** "1 feb 2026". */
export function fechaCorta(f: string): string {
  return f
    ? fecha(f).toLocaleDateString("es", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
}

/** "domingo". */
export function diaSemana(f: string): string {
  return f ? fecha(f).toLocaleDateString("es", { weekday: "long", timeZone: "UTC" }) : "";
}

/** "febrero". */
export function nombreMes(f: string): string {
  return f ? fecha(f).toLocaleDateString("es", { month: "long", timeZone: "UTC" }) : "";
}

/** Sábado o domingo. */
export function esFinDeSemana(f: string): boolean {
  const d = fecha(f).getUTCDay();
  return d === 0 || d === 6;
}

/** "hoy", "mañana", "en 12 días", "hace 3 días". */
export function cuandoEs(f: string): string {
  const n = diaISO(f) - diaISO(hoyISO());
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === -1) return "ayer";
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

/** `f` más `n` días, como `YYYY-MM-DD`. */
export function sumarDias(f: string, n: number): string {
  return new Date((diaISO(f) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Días entre dos fechas, contando las dos ("2026-03-01" a "2026-03-01" = 1). */
export function diasEntre(desde: string, hasta: string): number {
  return diaISO(hasta) - diaISO(desde) + 1;
}
