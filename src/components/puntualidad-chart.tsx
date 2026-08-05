/**
 * Tiempo total marcado fuera del horario, por facilitador: barras horizontales,
 * de mayor a menor.
 *
 * ── QUÉ MIDE LA BARRA ────────────────────────────────────────────────────────
 *
 * El backend manda **solo las marcaciones que se apartan 15+ minutos** del
 * horario, en cualquier dirección, y la barra es la **suma** de esos desvíos.
 * O sea: **un facilitador puntual no tiene barra**, no tiene una barra en cero.
 * El gráfico lista a quienes tienen algo que revisar.
 *
 * Al ser una suma y no un promedio, quien da más clases acumula más aunque cada
 * desvío sea chico: la barra mide impacto acumulado, no severidad por clase.
 *
 * ── POR QUÉ BARRAS HORIZONTALES Y NO VERTICALES ──────────────────────────────
 *
 * El eje de categorías son **nombres de personas**, que son largos. En vertical
 * habría que rotarlos 45° o recortarlos, y con quince facilitadores en la
 * pantalla de un teléfono quedan ilegibles. En horizontal cada nombre se lee de
 * corrido y la lista crece hacia abajo, que es la dirección en la que ya se
 * scrollea.
 *
 * ── UN COLOR POR FACILITADOR, PERO SIN LEYENDA ───────────────────────────────
 *
 * Cada barra lleva el color de su facilitador, atado al `id` (ver la paleta más
 * abajo). No hay leyenda igual, y es correcto: el nombre está escrito al lado de
 * cada barra, así que el color no es lo que identifica — una leyenda repetiría
 * lo que ya se lee de corrido.
 *
 * Esto es lo que hace legítimo que los colores se repitan cuando hay más de seis
 * facilitadores: si el color fuera la única forma de saber quién es quién, esa
 * repetición sería un bug.
 *
 * ── EL VALOR VA A LA DERECHA DE CADA BARRA ───────────────────────────────────
 *
 * Con una sola serie y pocas barras, la etiqueta directa evita tener que cruzar
 * la vista hasta un eje. El eje X queda fuera: sería ruido para leer lo mismo.
 */

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { formatearAtraso, type ResumenFacilitador } from "@/lib/intervenciones";

/**
 * Cuántos facilitadores se muestran al abrir. El resto sale con "Mostrar todos".
 *
 * Cinco, para que los DOS gráficos del inicio entren juntos en una pantalla de
 * teléfono sin scrollear: con diez cada uno, había que bajar mucho para llegar
 * al segundo y dejaba de leerse como un tablero.
 *
 * Como vienen ordenados de mayor a menor, son justamente los que hay que mirar
 * primero; el resto está a un toque.
 */
export const VISIBLES_INICIAL = 5;

/**
 * LOS COLORES DE LAS BARRAS: diez, en orden fijo.
 *
 * ── EL COLOR SIGUE A LA PERSONA, NO A SU POSICIÓN ────────────────────────────
 *
 * El índice sale de `id_facilitador`, no del orden en la lista. Si no fuera así,
 * cambiar de mes o expandir la lista repintaría a todos y el color dejaría de
 * identificar a nadie: alguien sería azul en julio y verde en agosto.
 *
 * Por lo mismo, las dos listas se exportan y las reusa `ubicacion-chart.tsx`:
 * una persona conserva su color en los DOS gráficos del inicio. Si vivieran
 * duplicadas, cualquier retoque en una las desincronizaría.
 *
 * ── EL ORDEN ESTÁ INTERCALADO, NO AGRUPADO POR FAMILIA ───────────────────────
 *
 * Azul → naranja → verde → violeta → oliva → magenta → cyan → rojo… Los tonos
 * parecidos quedan lo más lejos posible entre sí, porque los pares ADYACENTES
 * son los que se comparan de un vistazo en una lista de barras.
 *
 * ── VALIDADOS, NO ELEGIDOS A OJO ─────────────────────────────────────────────
 *
 * Las dos listas pasan los cinco checks del validador de paletas (banda de
 * luminosidad, saturación mínima, separación en daltonismo, separación en visión
 * normal y contraste contra la superficie). El ORDEN también está validado: en
 * las primeras versiones fallaban magenta junto a verde y rojo junto a magenta,
 * y por eso están separados.
 *
 * **Si se agregan o reordenan colores, hay que volver a correr el validador.**
 *
 * ── A PARTIR DEL 11º SE REPITEN, Y ESTÁ BIEN ─────────────────────────────────
 *
 * Diez es lo que se puede distinguir de verdad. Con más facilitadores el color
 * cicla, y eso es correcto: el color acompaña pero **no es lo que identifica**.
 * Eso lo hace el nombre, escrito al lado de cada barra, más el valor.
 */
export const COLORES_CLARO = [
  "#3a4a9f", // azul
  "#c2660a", // naranja
  "#1a7f5a", // verde
  "#7a4fa3", // violeta
  "#5c7c1f", // oliva
  "#c21a5e", // magenta
  "#0f8ab0", // cyan
  "#b5442b", // rojo ladrillo
  "#0d7fa5", // celeste profundo
  "#8c4907", // marrón
] as const;

/** Los mismos tonos subidos de luminosidad para el fondo oscuro. */
export const COLORES_OSCURO = [
  "#6478d8",
  "#c47a28",
  "#2aab7f",
  "#9c76c9",
  "#7a9638",
  "#d6437f",
  "#3494b5",
  "#d16a4f",
  "#2f9dc4",
  "#b06520",
] as const;

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
  /** Ya viene ordenado de mayor a menor desvío. */
  datos: ResumenFacilitador[];
  onSeleccionar: (f: ResumenFacilitador) => void;
}) {
  const [todos, setTodos] = useState(false);

  /*
   * El modo oscuro se lee de la clase del `<html>` y no de una media query: el
   * usuario lo elige a mano en Mi cuenta, así que `prefers-color-scheme` diría
   * lo del sistema operativo y no lo que está viendo. Ver `lib/theme.tsx`.
   *
   * Va en estado + efecto porque en SSR no hay `document`, y leerlo durante el
   * render rompería la hidratación.
   */
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    const leer = () => setOscuro(document.documentElement.classList.contains("dark"));
    leer();
    // El tema se cambia sin recargar, así que hay que enterarse.
    const obs = new MutationObserver(leer);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const paleta = oscuro ? COLORES_OSCURO : COLORES_CLARO;

  const visibles = todos ? datos : datos.slice(0, VISIBLES_INICIAL);
  const ocultos = datos.length - visibles.length;

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
            // Tokens de texto, nunca el color de la barra: el nombre es texto, y
            // pintarlo del color de la serie lo volvería ilegible en los tonos
            // más claros.
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Bar
            dataKey="total"
            // 4px en las puntas del extremo de dato, cuadrado contra la base.
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(_, i) => onSeleccionar(visibles[i])}
          >
            {/*
              Un color por facilitador. El índice sale del ID y no de la posición
              en la lista: así el color no cambia al expandir con "Mostrar
              todos" ni al cambiar de mes. Ver el comentario de la paleta.
            */}
            {filas.map((f) => (
              <Cell key={f.id_facilitador} fill={paleta[f.id_facilitador % paleta.length]} />
            ))}
            <LabelList
              dataKey="total"
              position="right"
              formatter={(v: number) => formatearAtraso(v)}
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--muted-foreground)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/*
        Expandir y volver a contraer. El botón dice cuántos faltan: "Mostrar
        todos" a secas no deja saber si son dos más o cuarenta.
      */}
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
