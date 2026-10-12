import type { CSSProperties } from "react";

/*
 * Los tres campos de totales de los reportes de pago (páginas 53 y 55 de
 * APEX), con sus colores del CSS en línea de APEX: Sueldo por Intervención en
 * verde oscuro (se edita acá mismo), Total Intervenciones en azul y Total
 * Salario en naranja.
 */

const numero = new Intl.NumberFormat("es-PY");

const COLORES = {
  sueldo: { backgroundColor: "#2e7d32", boxShadow: "0 0 8px rgba(46, 125, 50, 0.6)" },
  intervenciones: { backgroundColor: "#1976d2", boxShadow: "0 0 8px rgba(25, 118, 210, 0.6)" },
  salario: { backgroundColor: "#ff9800", boxShadow: "0 0 8px rgba(255, 152, 0, 0.6)" },
} satisfies Record<string, CSSProperties>;

/** El sueldo como número: solo los dígitos de lo escrito. */
const sueldoDe = (texto: string) => Number(texto.replace(/\D/g, "")) || 0;

export function TotalesPago({
  sueldo,
  onSueldo,
  intervenciones,
}: {
  /** Lo escrito en el campo (solo dígitos). */
  sueldo: string;
  onSueldo: (s: string) => void;
  intervenciones: number;
}) {
  const n = sueldoDe(sueldo);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block rounded-2xl p-3.5 text-center text-white" style={COLORES.sueldo}>
        <span className="block text-xs font-medium opacity-90">Sueldo por Intervención</span>
        <input
          inputMode="numeric"
          value={n ? numero.format(n) : sueldo}
          onChange={(e) => onSueldo(e.target.value.replace(/\D/g, ""))}
          aria-label="Sueldo por intervención"
          className="mt-1 w-full rounded-lg bg-white/15 px-2 py-1 text-center text-xl font-bold tabular-nums outline-none focus:bg-white/25"
        />
      </label>
      <div className="rounded-2xl p-3.5 text-center text-white" style={COLORES.intervenciones}>
        <p className="text-xs font-medium opacity-90">Total Intervenciones</p>
        <p className="mt-1 py-1 text-xl font-bold tabular-nums">{numero.format(intervenciones)}</p>
      </div>
      <div className="rounded-2xl p-3.5 text-center text-white" style={COLORES.salario}>
        <p className="text-xs font-medium opacity-90">Total Salario</p>
        <p className="mt-1 py-1 text-xl font-bold tabular-nums">
          {numero.format(intervenciones * n)}
        </p>
      </div>
    </div>
  );
}
