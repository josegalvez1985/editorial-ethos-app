import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { PuntualidadChart } from "@/components/puntualidad-chart";
import { PuntualidadModal } from "@/components/puntualidad-modal";
import {
  keysIntervenciones,
  MESES,
  resumenPuntualidad,
  type ResumenFacilitador,
} from "@/lib/intervenciones";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Inicio — Juventud con Valores" },
      { name: "description", content: "Puntualidad de los facilitadores." },
    ],
  }),
  component: HomePage,
});

/**
 * El inicio: **el tablero de puntualidad y nada más.**
 *
 * Hasta el 05/08/2026 esta pantalla tenía además el acceso a "Nueva evaluación",
 * dos baldosas con contadores y la lista de las últimas evaluaciones. Se sacaron
 * a pedido: todo eso vive en la pantalla de Evaluaciones, que es donde se va a
 * buscarlo, y acá solo duplicaba accesos.
 *
 * Al irse esa parte, **se fue también la consulta de evaluaciones**: el inicio ya
 * no la pide. Es una llamada menos en cada arranque de la app.
 */
function HomePage() {
  return (
    <AppShell>
      <div className="px-5 pt-5">
        <Puntualidad />
      </div>
    </AppShell>
  );
}

/**
 * Atraso promedio de cada facilitador en el mes, en barras.
 *
 * ── ARRANCA EN EL MES Y AÑO ACTUALES ─────────────────────────────────────────
 *
 * Es lo que se quiere ver al abrir la app. Los dos selectores están para mirar
 * atrás, no para tener que elegir antes de ver nada.
 *
 * El mes se manda como NÚMERO. La vista de Oracle lo guarda como texto en
 * español ('Agosto'), pero mandar el nombre desde el navegador obligaría a que
 * el idioma y la capitalización del cliente coincidan con los de la base — el
 * backend lo traduce con una tabla fija. Ver `intervenciones.sql`.
 *
 * ── SE OCULTA ENTERA SI NO HAY DATOS ─────────────────────────────────────────
 *
 * Un gráfico vacío con dos selectores ocupa media pantalla para no decir nada.
 * Si el mes no tiene marcaciones, se muestra una línea de texto y se sale.
 */
function Puntualidad() {
  const ahora = new Date();
  const [anio, setAnio] = useState(String(ahora.getFullYear()));
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  // Qué barra se tocó. `null` = modal cerrado.
  const [elegido, setElegido] = useState<ResumenFacilitador | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: keysIntervenciones.resumen(anio, mes),
    queryFn: () => resumenPuntualidad(anio, mes),
  });

  // Los últimos cinco años, del actual hacia atrás: no hay tabla de años para
  // este módulo y pedirla sería una consulta más para llenar un combo.
  const anios = Array.from({ length: 5 }, (_, i) => String(ahora.getFullYear() - i));

  return (
    <section className="mt-7">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">Puntualidad</h2>
          <p className="text-xs text-muted-foreground">Atraso promedio por facilitador</p>
        </div>
      </div>

      {/* Los filtros, en una fila arriba del gráfico. */}
      <div className="mb-3 flex gap-2">
        <select
          value={mes}
          onChange={(e) => setMes(Number(e.target.value))}
          aria-label="Mes"
          className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
        >
          {MESES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={anio}
          onChange={(e) => setAnio(e.target.value)}
          aria-label="Año"
          className="h-10 w-24 shrink-0 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
        >
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : isError ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No se pudo cargar la puntualidad.
          </p>
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay marcaciones registradas en {MESES[mes - 1]} de {anio}.
          </p>
        ) : (
          <>
            <PuntualidadChart datos={data} onSeleccionar={setElegido} />
            <p className="mt-3 border-t border-border/60 pt-2.5 text-center text-[11px] text-muted-foreground">
              Tocá una barra para ver el detalle de las marcaciones
            </p>
          </>
        )}
      </div>

      <PuntualidadModal
        facilitador={elegido}
        anio={anio}
        mes={mes}
        onClose={() => setElegido(null)}
      />
    </section>
  );
}
