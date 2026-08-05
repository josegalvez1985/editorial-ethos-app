/**
 * Intervenciones por día del mes: barras verticales.
 *
 * ── POR QUÉ VERTICALES, AL REVÉS QUE LOS OTROS DOS ───────────────────────────
 *
 * Acá el eje de categorías es **el tiempo**, no nombres de personas. Los días se
 * leen de izquierda a derecha —es la convención de cualquier calendario— y las
 * etiquetas son de uno o dos caracteres, así que entran sin rotarlas.
 *
 * Los otros dos gráficos van horizontales porque su eje son nombres largos. No
 * es una inconsistencia: es que el dato es distinto.
 *
 * ── UN COLOR POR DÍA ─────────────────────────────────────────────────────────
 *
 * Reusa la misma paleta validada que los otros dos gráficos, indexada por el
 * NÚMERO DE DÍA. Estrictamente el color no codifica información —la altura ya
 * dice todo— así que acá es ayuda visual para separar barras vecinas, no un
 * segundo dato.
 *
 * Por eso tampoco hay leyenda: el día está escrito debajo de cada barra.
 *
 * ── LOS DÍAS SIN ACTIVIDAD NO SE DIBUJAN ─────────────────────────────────────
 *
 * El backend no los manda y acá tampoco se rellenan. Un fin de semana sin clases
 * no es un cero informativo, y rellenar el mes entero metería ~10 barras vacías
 * que aplastan la escala de las que sí tienen datos.
 */

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { COLORES_CLARO, COLORES_OSCURO } from "@/components/puntualidad-chart";
import type { ActividadDia } from "@/lib/intervenciones";

/** Alto fijo: es una sola fila de barras, no crece con la cantidad de días. */
const ALTO = 180;

/**
 * A partir de cuántos días se dejan de escribir los valores sobre las barras.
 *
 * Con un mes completo (~22 días hábiles) los números se pisan entre sí y se
 * vuelven ilegibles; ahí el eje Y alcanza para leer la magnitud.
 */
const MAX_ETIQUETAS = 16;

export function ActividadChart({ datos }: { datos: ActividadDia[] }) {
  const conEtiquetas = datos.length <= MAX_ETIQUETAS;
  const total = datos.reduce((n, d) => n + d.cantidad, 0);

  // Mismo criterio que los otros gráficos: la clase del `<html>`, no la media
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

  return (
    <div>
      <ResponsiveContainer width="100%" height={ALTO}>
        {/*
          `left: 0` y no negativo: con un margen izquierdo negativo el eje Y se
          sale del área visible y sus números quedan recortados — con valores de
          tres cifras (616, 580) se veía solo el "0" del final.
        */}
        <BarChart data={datos} margin={{ top: 18, right: 8, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="dia"
            tickLine={false}
            axisLine={false}
            // Tokens de texto: el eje es texto, no un dato codificado por color.
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            // `interval={0}` fuerza a mostrar TODOS los días. Sin esto recharts
            // saltea etiquetas y el eje queda con huecos sin explicación.
            interval={0}
          />
          {/*
            `width={48}`: cuatro dígitos entran sin recortarse. Con los 36 px de
            antes, un valor como 1767 quedaba cortado.
          */}
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Bar
            dataKey="cantidad"
            // 4px arriba, cuadrado contra la base: la punta del dato se
            // redondea, el extremo anclado al eje no.
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            // Deja aire entre barras sin que se vuelvan hilos en un mes completo.
            maxBarSize={28}
          >
            {/*
              UN COLOR POR DÍA. El índice sale del NÚMERO DE DÍA, no de la
              posición en el array: así el día 3 conserva su color aunque el mes
              tenga huecos (fines de semana sin actividad no vienen en los datos)
              o se filtre otro período.
            */}
            {datos.map((d) => (
              <Cell key={d.dia} fill={paleta[d.dia % paleta.length]} />
            ))}
            {conEtiquetas && (
              <LabelList
                dataKey="cantidad"
                position="top"
                style={{ fontSize: 10, fontWeight: 600, fill: "var(--muted-foreground)" }}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/*
        El total del período. Es el número que se busca primero —"cuánto se hizo
        este mes"— y sumando barras a ojo no se saca.
      */}
      <p className="mt-2 border-t border-border/60 pt-2.5 text-center text-[13px] font-semibold">
        Total de intervenciones: {total.toLocaleString("es-PY")}
      </p>
    </div>
  );
}
