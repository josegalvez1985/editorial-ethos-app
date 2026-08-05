/**
 * Marcaciones hechas lejos de la institución: barras horizontales, de mayor a
 * menor cantidad.
 *
 * ── QUÉ MIDE LA BARRA ────────────────────────────────────────────────────────
 *
 * **Cuántas veces** ese facilitador marcó a más de 1 km del lugar donde debía
 * estar. Es un conteo, no una distancia: responde "quién lo hace más seguido".
 * La distancia máxima va en el subtítulo de cada barra, para el caso de la
 * marcación única pero muy lejana.
 *
 * ── LO QUE NO CUENTA COMO INFRACCIÓN ─────────────────────────────────────────
 *
 * Tres casos quedan afuera a propósito, y en los tres el motivo es el mismo:
 * **no se sabe dónde marcó**, y eso no es lo mismo que "marcó lejos".
 *
 *   - La marcación no tiene coordenadas cargadas.
 *   - La institución no tiene su ubicación cargada.
 *   - Las coordenadas son (0,0), que es lo que escribe `TRG_INTERV_UBICACION`
 *     cuando el facilitador tiene `IND_UBICACION_POSTULACION = 'NO'`.
 *
 * ── MISMA ESTRUCTURA QUE EL GRÁFICO DE HORARIOS ──────────────────────────────
 *
 * Barras horizontales por el largo de los nombres, 10 visibles con botón para
 * expandir, y el mismo color por `id_facilitador` — así una persona es del
 * mismo color en los dos gráficos del inicio.
 */

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { COLORES_CLARO, COLORES_OSCURO, VISIBLES_INICIAL } from "@/components/puntualidad-chart";
import { formatearDistancia, type ResumenUbicacion } from "@/lib/intervenciones";

/** Alto por barra. Dos renglones (nombre + distancia máxima) piden más aire. */
const ALTO_BARRA = 38;

/** Primer nombre + primer apellido: los completos no entran en el eje. */
function nombreCorto(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

export function UbicacionChart({
  datos,
  onSeleccionar,
}: {
  /** Ya viene ordenado de mayor a menor cantidad. */
  datos: ResumenUbicacion[];
  onSeleccionar: (f: ResumenUbicacion) => void;
}) {
  const [todos, setTodos] = useState(false);

  // Mismo criterio que el otro gráfico: la clase del `<html>`, no la media
  // query, porque el tema se elige a mano en Mi cuenta.
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    const leer = () => setOscuro(document.documentElement.classList.contains("dark"));
    leer();
    const obs = new MutationObserver(leer);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const paleta = oscuro ? COLORES_OSCURO : COLORES_CLARO;

  const visibles = todos ? datos : datos.slice(0, VISIBLES_INICIAL);
  const ocultos = datos.length - visibles.length;
  const filas = visibles.map((d) => ({ ...d, corto: nombreCorto(d.nombre_facilitador) }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={filas.length * ALTO_BARRA + 16}>
        <BarChart
          data={filas}
          layout="vertical"
          margin={{ top: 4, right: 64, bottom: 4, left: 0 }}
          barCategoryGap={6}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="corto"
            width={104}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Bar
            dataKey="fuera"
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(_, i) => onSeleccionar(visibles[i])}
          >
            {/* El color sale del ID, igual que en el otro gráfico: la misma
                persona conserva su color entre los dos. */}
            {filas.map((f) => (
              <Cell key={f.id_facilitador} fill={paleta[f.id_facilitador % paleta.length]} />
            ))}
            {/*
              La etiqueta lleva el conteo Y la peor distancia: el conteo solo no
              distingue ocho marcaciones a 1,1 km de ocho a 40 km, que son
              situaciones muy distintas.
            */}
            <LabelList
              dataKey="fuera"
              position="right"
              formatter={(v: number, _n: unknown, props: { payload?: ResumenUbicacion }) =>
                `${v} · ${formatearDistancia(props?.payload?.peor ?? null)}`
              }
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--muted-foreground)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {ocultos > 0 && (
        <button
          type="button"
          onClick={() => setTodos(true)}
          className="tap mt-2 w-full rounded-xl border border-border/60 py-2 text-[13px] font-semibold text-primary"
        >
          Mostrar todos ({ocultos} más)
        </button>
      )}

      {todos && datos.length > VISIBLES_INICIAL && (
        <button
          type="button"
          onClick={() => setTodos(false)}
          className="tap mt-2 w-full rounded-xl border border-border/60 py-2 text-[13px] font-semibold text-muted-foreground"
        >
          Mostrar solo los {VISIBLES_INICIAL} primeros
        </button>
      )}
    </div>
  );
}
