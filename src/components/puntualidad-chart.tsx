/**
 * Atraso promedio por facilitador: barras horizontales, de mayor a menor.
 *
 * ── POR QUÉ BARRAS HORIZONTALES Y NO VERTICALES ──────────────────────────────
 *
 * El eje de categorías son **nombres de personas**, que son largos. En vertical
 * habría que rotarlos 45° o recortarlos, y con quince facilitadores en la
 * pantalla de un teléfono quedan ilegibles. En horizontal cada nombre se lee de
 * corrido y la lista crece hacia abajo, que es la dirección en la que ya se
 * scrollea.
 *
 * ── UNA SOLA SERIE: SIN LEYENDA ──────────────────────────────────────────────
 *
 * Todas las barras miden lo mismo (minutos de atraso), así que el color no
 * codifica identidad y una leyenda no diría nada que el título no diga. Por eso
 * van todas del color primario de la marca: es magnitud, no categoría.
 *
 * Se usa `--primary` y no un color fijo a propósito — el usuario elige entre
 * once paletas y dos modos, y un hex cableado se saldría del tema en 21 de las
 * 22 combinaciones.
 *
 * ── EL VALOR VA A LA DERECHA DE CADA BARRA ───────────────────────────────────
 *
 * Con una sola serie y pocas barras, la etiqueta directa evita tener que cruzar
 * la vista hasta un eje. El eje X queda fuera: sería ruido para leer lo mismo.
 */

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { formatearAtraso, type ResumenFacilitador } from "@/lib/intervenciones";

/**
 * Cuántas barras entran antes de que el gráfico se vuelva una mancha.
 *
 * Con más de doce, cada barra queda de pocos píxeles y los nombres se pisan. Los
 * que sobran no desaparecen: el listado completo está en el modal, y este
 * gráfico responde "quiénes llegan más tarde", que se contesta con los primeros.
 */
const MAX_BARRAS = 12;

/** Alto por barra. Menos de 34 px deja el nombre pegado al de abajo. */
const ALTO_BARRA = 38;

/** Primer nombre + primer apellido: los nombres completos no entran en el eje. */
function nombreCorto(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

export function PuntualidadChart({
  datos,
  onSeleccionar,
}: {
  /** Ya viene ordenado de mayor a menor: el orden lo hace Oracle. */
  datos: ResumenFacilitador[];
  onSeleccionar: (f: ResumenFacilitador) => void;
}) {
  const visibles = datos.slice(0, MAX_BARRAS);

  // Recharts necesita el dato plano, con el nombre ya recortado para el eje.
  const filas = visibles.map((d) => ({ ...d, corto: nombreCorto(d.nombre_facilitador) }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={filas.length * ALTO_BARRA + 16}>
        <BarChart
          data={filas}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
          barCategoryGap={6}
        >
          {/*
            Sin grid ni eje X: con la etiqueta directa en cada barra, las líneas
            de fondo solo agregan ruido para leer un número que ya está escrito.
          */}
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="corto"
            width={104}
            tickLine={false}
            axisLine={false}
            // Tokens de texto, nunca el color de la serie: el nombre es texto,
            // no un dato codificado por color.
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Bar
            dataKey="promedio"
            // 4px en las puntas del extremo de dato, cuadrado contra la base.
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(_, i) => onSeleccionar(visibles[i])}
          >
            {/*
              Una Cell por barra para que el click sepa cuál se tocó. El color es
              el mismo en todas: es una sola serie, el color no distingue.
            */}
            {filas.map((f) => (
              <Cell key={f.id_facilitador} fill="var(--primary)" />
            ))}
            <LabelList
              dataKey="promedio"
              position="right"
              formatter={(v: number) => formatearAtraso(v)}
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--muted-foreground)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {datos.length > MAX_BARRAS && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Se muestran los {MAX_BARRAS} con más atraso, de {datos.length} facilitadores.
        </p>
      )}
    </div>
  );
}
