/**
 * Comparativo entre inventarios: el último conteo de cada manual contra uno,
 * dos o tres anteriores, por sucursal.
 *
 * ============================================================================
 * LA FORMA: BARRAS HORIZONTALES AGRUPADAS, UN GRÁFICO POR SUCURSAL
 * ============================================================================
 *
 * - **Horizontales** porque el eje de categorías son nombres de manuales, que
 *   son largos: en vertical no entran ni rotados.
 * - **Agrupadas por manual**: la pregunta es "¿cambió este manual?", así que
 *   sus inventarios van juntos, del más viejo (arriba) al último (abajo).
 * - **Un gráfico por sucursal** (small multiples) y no una barra por sucursal
 *   dentro del mismo: mezclarlas daría grupos de ocho barras ilegibles.
 * - **Un solo eje.** Todo es cantidad de libros.
 *
 * ============================================================================
 * EL COLOR: UNA RAMPA ORDINAL, ATADA A LA ANTIGÜEDAD
 * ============================================================================
 *
 * Las series no son categorías sino un ORDEN (hace 3, hace 2, anterior,
 * último), así que van en un solo tono, del más suave al más marcado, y el
 * último es siempre el que más resalta. El color sigue a la antigüedad y no a
 * la cantidad de series: pasar de "1 anterior" a "3 anteriores" no repinta el
 * último.
 *
 * Las dos rampas —claro y oscuro, cada una contra su superficie de tarjeta—
 * pasan el validador de paletas en modo `--ordinal` (monotonía, saltos
 * visibles entre pasos, contraste del extremo suave, un solo tono). **Si se
 * cambian, volver a validarlas.**
 *
 * El texto (nombres, valores, leyenda) va en tokens de texto, nunca en el color
 * de la barra.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import type { ConteoHistorial } from "@/lib/inventarios";

/** Del más reciente (0) al más viejo (3). */
const RAMPA_CLARO = ["#0d366b", "#1c5cab", "#3987e5", "#86b6ef"] as const;
/** En oscuro resalta lo CLARO: la rampa va al revés, con sus propios pasos. */
const RAMPA_OSCURO = ["#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"] as const;

const NOMBRES = ["Último", "Anterior", "Hace 2", "Hace 3"] as const;

/** Alto por barra y aire entre manuales. Menos no deja leer los nombres. */
const ALTO_BARRA = 10;
const AIRE_GRUPO = 16;

const numero = new Intl.NumberFormat("es-PY");

/** `DD/MM/YYYY HH24:MI` → número ordenable. Sin `Date`: no depende del huso. */
function clave(fecha: string | null): number {
  const m = fecha?.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/);
  if (!m) return 0;
  return Number(`${m[3]}${m[2]}${m[1]}${m[4] ?? "00"}${m[5] ?? "00"}`);
}

/** Una fila del gráfico: un manual con sus inventarios, del último hacia atrás. */
type FilaChart = {
  manual: string;
  /** `v0` = último, `v1` = anterior… `undefined` si no hay tantos. */
  v0?: number;
  v1?: number;
  v2?: number;
  v3?: number;
  fechas: (string | null)[];
  /** Último − anterior. `null` si hay un solo inventario. */
  cambio: number | null;
};

/**
 * Arma las filas de UNA sucursal. Cuenta la cantidad FÍSICA: es lo que había en
 * el estante en cada inventario.
 */
function armarFilas(conteos: ConteoHistorial[], cuantos: number): FilaChart[] {
  const porManual = new Map<string, ConteoHistorial[]>();
  for (const c of conteos) {
    if (c.cantidad_fisica == null) continue;
    const g = porManual.get(c.manual);
    if (g) g.push(c);
    else porManual.set(c.manual, [c]);
  }

  return [...porManual.entries()]
    .map(([manual, lista]) => {
      const orden = [...lista]
        .sort((a, b) => clave(b.fecha) - clave(a.fecha))
        .slice(0, cuantos + 1);
      const fila: FilaChart = {
        manual,
        fechas: orden.map((c) => c.fecha),
        cambio: orden.length > 1 ? orden[0].cantidad_fisica! - orden[1].cantidad_fisica! : null,
      };
      orden.forEach((c, i) => {
        fila[`v${i}` as "v0"] = c.cantidad_fisica!;
      });
      return fila;
    })
    .sort((a, b) => a.manual.localeCompare(b.manual));
}

/** Cortado para el eje: los nombres completos van en el tooltip. */
function corto(s: string) {
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

const conSigno = (n: number) => (n > 0 ? `+${numero.format(n)}` : numero.format(n));

/**
 * El modo oscuro se lee de la clase del `<html>`, igual que en
 * `puntualidad-chart.tsx`: lo elige el usuario en Mi cuenta, así que
 * `prefers-color-scheme` diría lo del sistema operativo y no lo que ve.
 */
function useOscuro() {
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    const leer = () => setOscuro(document.documentElement.classList.contains("dark"));
    leer();
    const obs = new MutationObserver(leer);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return oscuro;
}

/* -------------------------------------------------------------------------- */
/* El bloque completo: control + un gráfico por sucursal                      */
/* -------------------------------------------------------------------------- */

export function ComparativoInventarios({ conteos }: { conteos: ConteoHistorial[] }) {
  // Por defecto, contra el inventario anterior: es la pregunta más común
  // ("¿cambió desde la última vez?").
  const [cuantos, setCuantos] = useState(1);
  const oscuro = useOscuro();
  const rampa = oscuro ? RAMPA_OSCURO : RAMPA_CLARO;

  const sucursales = useMemo(() => {
    const m = new Map<string, ConteoHistorial[]>();
    for (const c of conteos) {
      const g = m.get(c.sucursal);
      if (g) g.push(c);
      else m.set(c.sucursal, [c]);
    }
    return [...m.entries()].map(([nombre, lista]) => ({
      nombre,
      filas: armarFilas(lista, cuantos),
    }));
  }, [conteos, cuantos]);

  // Cuántas series hay de verdad: si ningún manual tiene 3 anteriores, la
  // leyenda no ofrece "Hace 3".
  const series = Math.min(
    cuantos + 1,
    Math.max(1, ...sucursales.flatMap((s) => s.filas.map((f) => f.fechas.length))),
  );

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold">Comparativo entre inventarios</h2>
          <p className="text-xs text-muted-foreground">
            Cantidad física del último conteo de cada manual contra los anteriores, dentro del
            período y los filtros elegidos.
          </p>
        </div>
        <div className="shrink-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            Comparar el último con
          </p>
          <div className="flex h-9 rounded-xl border border-input bg-background p-0.5 text-xs">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCuantos(n)}
                aria-pressed={cuantos === n}
                className={`rounded-[10px] px-2.5 font-medium whitespace-nowrap transition-colors ${
                  cuantos === n
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n === 1 ? "el anterior" : `${n} anteriores`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        Leyenda SIEMPRE que haya dos series o más: el color no puede ser lo
        único que diga cuál barra es cuál. Del más viejo al último, en el mismo
        orden en que se apilan las barras de cada grupo.
      */}
      {series > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Array.from({ length: series }, (_, i) => series - 1 - i).map((i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: rampa[i] }} />
              {NOMBRES[i]}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {sucursales.map((s) => (
          <GraficoSucursal
            key={s.nombre}
            nombre={s.nombre}
            filas={s.filas}
            series={series}
            rampa={rampa}
            // Con una sola sucursal el título repetiría lo que ya dice el filtro.
            mostrarNombre={sucursales.length > 1}
          />
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Una sucursal                                                               */
/* -------------------------------------------------------------------------- */

function GraficoSucursal({
  nombre,
  filas,
  series,
  rampa,
  mostrarNombre,
}: {
  nombre: string;
  filas: FilaChart[];
  series: number;
  rampa: readonly string[];
  mostrarNombre: boolean;
}) {
  const unSoloInventario = filas.every((f) => f.fechas.length < 2);
  // Del más viejo al último: el último queda abajo en cada grupo, pegado a su
  // etiqueta de valor.
  const claves = Array.from({ length: series }, (_, i) => series - 1 - i);
  const alto = filas.length * (series * (ALTO_BARRA + 2) + AIRE_GRUPO) + 12;

  return (
    <div className="min-w-0">
      {mostrarNombre && <h3 className="mb-1 text-sm font-semibold">{nombre}</h3>}
      {unSoloInventario && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Cada manual tiene un solo conteo en este período: no hay contra qué comparar todavía.
        </p>
      )}
      <ResponsiveContainer width="100%" height={alto}>
        <BarChart
          data={filas}
          layout="vertical"
          margin={{ top: 4, right: 64, bottom: 4, left: 0 }}
          barCategoryGap={AIRE_GRUPO / 2}
          // 2px de superficie entre barras vecinas del mismo manual.
          barGap={2}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="manual"
            width={136}
            tickLine={false}
            axisLine={false}
            tickFormatter={corto}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            content={<Detalle />}
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            isAnimationActive={false}
          />
          {claves.map((i) => (
            <Bar
              key={i}
              dataKey={`v${i}`}
              name={NOMBRES[i]}
              fill={rampa[i]}
              barSize={ALTO_BARRA}
              // 4px en el extremo del dato, recto contra la base.
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              {/*
                Etiqueta directa SOLO en el último: el valor y el cambio contra
                el anterior. Un número en cada barra sería ruido; el resto está
                en el tooltip.
              */}
              {i === 0 && (
                <LabelList
                  dataKey="v0"
                  position="right"
                  content={(p) => {
                    const { x, y, width, height, index } = p as {
                      x: number;
                      y: number;
                      width: number;
                      height: number;
                      index: number;
                    };
                    const f = filas[index];
                    if (f?.v0 == null) return null;
                    return (
                      <text
                        x={x + width + 6}
                        y={y + height / 2}
                        dominantBaseline="central"
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--foreground)"
                      >
                        {numero.format(f.v0)}
                        {f.cambio != null && f.cambio !== 0 && (
                          <tspan
                            fontWeight={500}
                            fill="var(--muted-foreground)"
                          >{` (${conSigno(f.cambio)})`}</tspan>
                        )}
                      </text>
                    );
                  }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** El tooltip de un manual: cada inventario con su fecha, y el cambio. */
function Detalle({ active, payload }: TooltipProps<number, string>) {
  const f = payload?.[0]?.payload as FilaChart | undefined;
  if (!active || !f) return null;

  return (
    <div className="max-w-64 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs shadow-soft">
      <p className="mb-1.5 font-semibold">{f.manual}</p>
      <table className="w-full">
        <tbody>
          {f.fechas.map((fecha, i) => (
            <tr key={i}>
              <td className="pr-3 text-muted-foreground">{NOMBRES[i]}</td>
              <td className="pr-3 text-muted-foreground tabular-nums">{fecha?.slice(0, 10)}</td>
              <td className="text-right font-semibold tabular-nums">
                {numero.format(f[`v${i}` as "v0"] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {f.cambio != null && (
        <p className="mt-1.5 border-t border-border/60 pt-1.5">
          Contra el anterior:{" "}
          <span
            className={`font-semibold ${
              f.cambio < 0 ? "text-destructive" : f.cambio > 0 ? "text-amber-600" : ""
            }`}
          >
            {f.cambio === 0 ? "sin cambio" : conSigno(f.cambio)}
          </span>
        </p>
      )}
    </div>
  );
}
