/**
 * Intervenciones por día: barras verticales, **agrupadas por día** (09/10/2026):
 * el total, las que desarrollaron el índice y las que no.
 *
 * ── POR QUÉ VERTICALES, AL REVÉS QUE LOS OTROS DOS ───────────────────────────
 *
 * Acá el eje de categorías es **el tiempo**, no nombres de personas. Los días se
 * leen de izquierda a derecha —es la convención de cualquier calendario— y las
 * etiquetas son de uno o dos caracteres, así que entran sin rotarlas.
 *
 * ── UN COLOR POR SERIE, NO POR DÍA ───────────────────────────────────────────
 *
 * Antes cada día tenía su color (ayuda visual, sin significado). Con tres
 * barras por día el color pasa a decir QUÉ es cada barra, así que va por serie
 * y con leyenda. Los tres colores están validados con el script de la guía de
 * visualización (todos los pares, claro y oscuro; daltonismo incluido):
 *
 *   Total            #3a4a9f / #7c6fe0   (el azul de la paleta de la app)
 *   Desarrollados    #0f8ab0 / #2aa3c4
 *   No desarrollados #c2660a / #c47a28
 *
 * Con el filtro de desarrollo en "Desarrollados" o "No desarrollados" se ve
 * una sola serie (la elegida): las otras dos contradirían el filtro.
 *
 * ── LOS DÍAS SIN ACTIVIDAD NO SE DIBUJAN ─────────────────────────────────────
 *
 * El backend no los manda y acá tampoco se rellenan. Un fin de semana sin clases
 * no es un cero informativo, y rellenar el mes entero metería ~10 grupos vacíos
 * que aplastan la escala de los que sí tienen datos.
 */

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  SERIES_ACTIVIDAD,
  type ActividadDiaDesglose,
  type SerieActividad,
} from "@/lib/intervenciones";

const SERIES = SERIES_ACTIVIDAD;

/** Alto fijo: es una sola fila de barras, no crece con la cantidad de días. */
const ALTO = 215;

/**
 * A partir de cuántas BARRAS se dejan de escribir los valores encima. Con tres
 * por día, eso es una semana; con el mes entero los números se pisan y el eje Y
 * (y el detalle al pasar el mouse) alcanzan para leer la magnitud.
 */
const MAX_ETIQUETAS = 21;

/**
 * Las franjas que separan un día del otro (09/10/2026, a pedido: las barras de
 * días vecinos se mezclaban). Un día sí y otro no, como una planilla: un fondo
 * suave que no compite con los colores de las barras. Hex y no var(--muted):
 * es un atributo SVG y ahí las variables CSS no se resuelven.
 */
const FRANJA = { claro: "#eef0f6", oscuro: "#262a36" };

/**
 * La ALERTA (09/10/2026, a pedido): un día con más intervenciones que NO
 * desarrollaron el índice que las que sí. Color de advertencia (ámbar), y
 * siempre con ícono y texto, nunca solo el color: el fondo del día, un ⚠
 * arriba, el número del día en ámbar, el aviso con la lista de días debajo y
 * la línea en el detalle al pasar el mouse. Hex por lo mismo que FRANJA.
 */
const ALERTA = {
  fondo: { claro: "#fdebc8", oscuro: "#3d2f12" },
  texto: { claro: "#b45309", oscuro: "#f59e0b" },
};
const enAlerta = (d: Pick<ActividadDiaDesglose, "si" | "no">) => d.no > d.si;

/** L M M J V S D: la inicial del día de la semana, debajo del número. */
const INICIAL = ["D", "L", "M", "M", "J", "V", "S"];

export function ActividadChart({
  datos,
  series,
  anio,
  mes,
  onSeleccionar,
}: {
  datos: ActividadDiaDesglose[];
  series: SerieActividad[];
  /** Para la inicial del día de la semana. */
  anio: string;
  /** 1–12. */
  mes: number;
  /** Tocar una barra: el día y la serie (abre el detalle de ese día). */
  onSeleccionar?: (dia: number, serie: SerieActividad) => void;
}) {
  const conEtiquetas = datos.length * series.length <= MAX_ETIQUETAS;
  const suma = (k: SerieActividad) => datos.reduce((n, d) => n + d[k], 0);
  const total = suma("total");
  const sinDato = total - suma("si") - suma("no");

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
  const color = (k: SerieActividad) => (oscuro ? SERIES[k].oscuro : SERIES[k].claro);
  const franja = oscuro ? FRANJA.oscuro : FRANJA.claro;
  const inicial = (dia: number) =>
    INICIAL[new Date(Date.UTC(Number(anio), mes - 1, dia)).getUTCDay()];
  const ambar = oscuro ? ALERTA.texto.oscuro : ALERTA.texto.claro;
  const diasAlerta = datos.filter(enAlerta);
  const alertaDe = new Set(diasAlerta.map((d) => d.dia));
  const periodoEnAlerta = suma("no") > suma("si");

  return (
    <div>
      {/* Leyenda: solo con más de una serie (una sola la nombra el título). */}
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {series.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color(k) }} />
              {SERIES[k].nombre}
            </li>
          ))}
        </ul>
      )}

      <ResponsiveContainer width="100%" height={ALTO}>
        {/*
          `left: 0` y no negativo: con un margen izquierdo negativo el eje Y se
          sale del área visible y sus números quedan recortados.
          `barGap={2}`: 2 px de aire entre las barras de un mismo día.
        */}
        <BarChart
          data={datos}
          margin={{ top: 18, right: 8, bottom: 4, left: 0 }}
          barGap={2}
          barCategoryGap="18%"
        >
          {/*
            Las franjas van PRIMERO: lo que se dibuja antes queda detrás de las
            barras. Cada una cubre la banda entera de su día (de borde a borde),
            así que las vecinas se tocan y el día queda encerrado.
          */}
          {datos.map((d, i) =>
            alertaDe.has(d.dia) ? (
              // El día en alerta: fondo ámbar (en lugar de la franja) y un ⚠
              // arriba, en el margen del gráfico.
              <ReferenceArea
                key={`f${d.dia}`}
                x1={d.dia}
                x2={d.dia}
                fill={oscuro ? ALERTA.fondo.oscuro : ALERTA.fondo.claro}
                fillOpacity={1}
                strokeOpacity={0}
                ifOverflow="visible"
                label={{ value: "⚠", position: "top", fill: ambar, fontSize: 12, fontWeight: 700 }}
              />
            ) : i % 2 === 0 ? (
              <ReferenceArea
                key={`f${d.dia}`}
                x1={d.dia}
                x2={d.dia}
                fill={franja}
                fillOpacity={1}
                strokeOpacity={0}
                ifOverflow="visible"
              />
            ) : null,
          )}
          <XAxis
            dataKey="dia"
            tickLine={false}
            axisLine={false}
            height={30}
            // El número del día y, debajo, la inicial del día de la semana.
            // Tokens de texto: el eje es texto, no un dato codificado por color.
            tick={({ x, y, payload }: { x: number; y: number; payload: { value: number } }) => (
              <g transform={`translate(${x},${y})`}>
                <text
                  dy={10}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={alertaDe.has(payload.value) ? 700 : 400}
                  style={{ fill: alertaDe.has(payload.value) ? ambar : "var(--foreground)" }}
                >
                  {payload.value}
                </text>
                <text
                  dy={22}
                  textAnchor="middle"
                  fontSize={9}
                  style={{ fill: "var(--muted-foreground)" }}
                >
                  {inicial(payload.value)}
                </text>
              </g>
            )}
            // `interval={0}`: TODOS los días. Sin esto recharts saltea etiquetas.
            interval={0}
          />
          {/* `width={48}`: cuatro dígitos entran sin recortarse. */}
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            // El día bajo el mouse, un poco más marcado que su franja.
            cursor={{ fill: oscuro ? "#323848" : "#dfe3ee", opacity: 0.7 }}
            content={(p) => (
              <Detalle
                active={p.active}
                payload={p.payload as { payload?: unknown }[] | undefined}
                label={p.label as string | number | undefined}
                series={series}
                color={color}
                ambar={ambar}
              />
            )}
          />
          {series.map((k) => (
            <Bar
              key={k}
              dataKey={k}
              name={SERIES[k].nombre}
              fill={color(k)}
              // 4px arriba, cuadrado contra la base.
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              maxBarSize={22}
              cursor={onSeleccionar ? "pointer" : undefined}
              onClick={(d: { payload?: ActividadDiaDesglose }) => {
                if (d?.payload) onSeleccionar?.(d.payload.dia, k);
              }}
            >
              {conEtiquetas && (
                <LabelList
                  dataKey={k}
                  position="top"
                  style={{ fontSize: 10, fontWeight: 600, fill: "var(--muted-foreground)" }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/*
        Los totales del período: lo que se busca primero y sumando barras a ojo
        no se saca.
      */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-[13px]">
        {series.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color(k) }} />
            <span className="text-muted-foreground">{SERIES[k].nombre}:</span>
            <strong className="tabular-nums">{suma(k).toLocaleString("es-PY")}</strong>
          </span>
        ))}
      </div>
      {/* El aviso de la alerta, con los días (tocarlos abre su detalle). */}
      {(diasAlerta.length > 0 || periodoEnAlerta) && (
        <div
          role="status"
          className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-800 dark:text-amber-300"
        >
          <p className="font-semibold">
            ⚠{" "}
            {diasAlerta.length
              ? `En ${diasAlerta.length} ${diasAlerta.length === 1 ? "día" : "días"} los no desarrollados superaron a los desarrollados`
              : "En el período, los no desarrollados superan a los desarrollados"}
          </p>
          {diasAlerta.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {diasAlerta.map((d) => (
                <button
                  key={d.dia}
                  type="button"
                  onClick={() => onSeleccionar?.(d.dia, "no")}
                  disabled={!onSeleccionar}
                  title={`${d.no} no desarrollados contra ${d.si} desarrollados`}
                  className="tap rounded-full border border-amber-500/50 bg-card px-2.5 py-0.5 text-[12px] font-semibold tabular-nums hover:bg-amber-500/15"
                >
                  {inicial(d.dia)} {d.dia} · {d.no} vs {d.si}
                </button>
              ))}
            </div>
          )}
          {periodoEnAlerta && diasAlerta.length > 0 && (
            <p className="mt-1.5">
              En todo el período también: {suma("no").toLocaleString("es-PY")} no desarrollados
              contra {suma("si").toLocaleString("es-PY")} desarrollados.
            </p>
          )}
        </div>
      )}
      {onSeleccionar && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Tocá una barra para ver los facilitadores y sus instituciones
        </p>
      )}
      {series.includes("total") && series.length > 1 && sinDato > 0 && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          {sinDato.toLocaleString("es-PY")} sin el dato de desarrollo: entran en el total y en
          ninguna de las otras dos.
        </p>
      )}
    </div>
  );
}

/** El detalle al pasar el mouse (o tocar) un día. */
function Detalle({
  active,
  payload,
  label,
  series,
  color,
  ambar,
}: {
  active?: boolean;
  payload?: { payload?: unknown }[];
  label?: string | number;
  series: SerieActividad[];
  color: (k: SerieActividad) => string;
  ambar: string;
}) {
  if (!active || !payload?.length) return null;
  const fila = payload[0]?.payload as ActividadDiaDesglose | undefined;
  if (!fila) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-md">
      <p className="mb-1 font-semibold">Día {label}</p>
      {series.map((k) => (
        <p key={k} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-sm" style={{ background: color(k) }} />
          <span className="text-muted-foreground">{SERIES[k].nombre}:</span>
          <strong className="tabular-nums">{fila[k].toLocaleString("es-PY")}</strong>
        </p>
      ))}
      {enAlerta(fila) && (
        <p className="mt-1 font-semibold" style={{ color: ambar }}>
          ⚠ Más no desarrollados que desarrollados
        </p>
      )}
    </div>
  );
}
