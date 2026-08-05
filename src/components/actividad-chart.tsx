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
 * ── UNA SOLA SERIE, UN SOLO COLOR ────────────────────────────────────────────
 *
 * Todas las barras miden lo mismo (cantidad de intervenciones), así que el color
 * no codifica nada y va el primario de la marca. Poner un color por día sería
 * decorar con la variable equivocada.
 *
 * Se usa `--primary` y no un hex fijo porque el usuario elige entre once paletas
 * y dos modos: un color cableado se saldría del tema en 21 de las 22
 * combinaciones.
 *
 * ── LOS DÍAS SIN ACTIVIDAD NO SE DIBUJAN ─────────────────────────────────────
 *
 * El backend no los manda y acá tampoco se rellenan. Un fin de semana sin clases
 * no es un cero informativo, y rellenar el mes entero metería ~10 barras vacías
 * que aplastan la escala de las que sí tienen datos.
 */

import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

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

  return (
    <ResponsiveContainer width="100%" height={ALTO}>
      <BarChart data={datos} margin={{ top: 16, right: 8, bottom: 4, left: -20 }}>
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
          El eje Y va sin línea ni grid: con pocas barras la altura relativa ya
          se compara sola, y las líneas de fondo solo suman ruido. Se muestra
          igual porque cuando hay muchos días es lo único que da la magnitud.
        */}
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <Bar
          dataKey="cantidad"
          fill="var(--primary)"
          // 4px arriba, cuadrado contra la base: la punta del dato se redondea,
          // el extremo anclado al eje no.
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
          // Deja aire entre barras sin que se vuelvan hilos en un mes completo.
          maxBarSize={28}
        >
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
  );
}
