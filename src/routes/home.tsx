import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ActividadChart } from "@/components/actividad-chart";
import { SelectorModal } from "@/components/selector-modal";
import { PuntualidadChart } from "@/components/puntualidad-chart";
import { PuntualidadModal } from "@/components/puntualidad-modal";
import { UbicacionChart } from "@/components/ubicacion-chart";
import { UbicacionModal } from "@/components/ubicacion-modal";
import {
  actividadPorDia,
  agruparPorFacilitador,
  agruparPorUbicacion,
  filtrarPorDesarrollo,
  keysIntervenciones,
  listarIntervenciones,
  MESES,
  type FiltroDesarrollo,
  type ResumenFacilitador,
  type ResumenUbicacion,
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
  /*
   * ¿Se desarrolló el índice? Manda sobre los TRES gráficos.
   *
   * Arranca en "TODOS" —el tablero completo, lo que se veía antes de que este
   * filtro existiera—. Ver `FiltroDesarrollo` en `lib/intervenciones.ts`.
   */
  const [desarrollo, setDesarrollo] = useState<FiltroDesarrollo>("TODOS");
  // Qué barra se tocó en cada gráfico. `null` = ese modal está cerrado.
  const [elegido, setElegido] = useState<ResumenFacilitador | null>(null);
  const [elegidoUbi, setElegidoUbi] = useState<ResumenUbicacion | null>(null);

  /*
   * Puntualidad ARRANCA OCULTA, a pedido (14/08/2026).
   *
   * Es el gráfico que expone a personas con nombre y apellido, así que abrir la
   * app frente a otro no lo pone en pantalla solo: hay que pedirlo con el ojo.
   * Los otros dos siguen visibles — Ubicación muestra menos y Actividad es
   * agregada.
   *
   * OJO: esconderlo NO ahorra la consulta. `listarIntervenciones` alimenta
   * también al gráfico de Ubicación, así que se pide igual; lo que se oculta es
   * el dibujo, no la llamada. Si algún día Ubicación deja de depender de esa
   * query, ahí sí conviene condicionarla.
   */
  const [verPuntualidad, setVerPuntualidad] = useState(false);

  /*
   * UNA sola llamada para LOS DOS gráficos.
   *
   * El backend devuelve las marcaciones desviadas del período —por horario o
   * por ubicación— y cada agrupado se queda con lo suyo. Pedir dos veces lo
   * mismo con distinto filtro sería una llamada de más por cada cambio de mes.
   */
  const { data, isLoading, isError } = useQuery({
    queryKey: keysIntervenciones.historial(anio, mes),
    queryFn: () => listarIntervenciones(anio, mes),
  });

  /*
   * El filtro de desarrollo se aplica ACÁ, en memoria, y NO en la query.
   *
   * `listarIntervenciones` ya trajo las filas crudas con su `si_no`, así que
   * las tres opciones del filtro salen de la MISMA respuesta: cambiar el
   * selector no dispara una descarga nueva y el cambio es instantáneo. Meterlo
   * en la query key traería tres veces el mismo mes.
   *
   * El gráfico de Actividad no puede hacer esto —viene agregado por día— y por
   * eso ese sí filtra en el backend. Ver `actividadPorDia`.
   */
  const filtradas = data ? filtrarPorDesarrollo(data, desarrollo) : [];
  const resumen = filtradas.length ? agruparPorFacilitador(filtradas) : [];
  const ubicacion = filtradas.length ? agruparPorUbicacion(filtradas) : [];

  /*
   * La actividad diaria va en SU PROPIA consulta, y no se deriva de `data`.
   *
   * La de arriba trae solo las marcaciones DESVIADAS —las que se apartan del
   * horario o de la ubicación—, así que contar sus filas por día daría un
   * gráfico de infracciones con nombre de actividad. Este endpoint cuenta
   * todas.
   */
  const {
    data: dias,
    isLoading: cargandoDias,
    isError: errorDias,
  } = useQuery({
    queryKey: keysIntervenciones.porDia(anio, mes, desarrollo),
    queryFn: () => actividadPorDia(anio, mes, desarrollo),
  });

  // Los últimos cinco años, del actual hacia atrás: no hay tabla de años para
  // este módulo y pedirla sería una consulta más para llenar un combo.
  const anios = Array.from({ length: 5 }, (_, i) => String(ahora.getFullYear() - i));

  /*
   * La coletilla que los mensajes de "no hay nada" le agregan al período.
   *
   * Sin esto, filtrar por "solo las que no desarrollaron" y quedarse sin datos
   * dice "Sin desvíos en Agosto de 2026", que se lee como si el mes estuviera
   * limpio cuando en realidad lo vació el filtro. Nombrarlo es lo que evita
   * que alguien saque una conclusión al revés.
   */
  const coletilla =
    desarrollo === "SI"
      ? ", entre las que desarrollaron el índice"
      : desarrollo === "NO"
        ? ", entre las que no desarrollaron el índice"
        : "";

  return (
    <>
      {/*
        Los filtros mandan sobre LOS TRES gráficos, así que van una sola vez y
        arriba de todo. Duplicarlos por gráfico dejaría cambiar el mes en uno y
        no en el otro, y dos tableros del mismo período mostrando meses
        distintos es la peor forma de leer esto.
      */}
      <div className="mt-7 mb-3 flex gap-2">
        <SelectorModal
          label="Mes"
          mostrarLabel={false}
          value={String(mes)}
          onChange={(v) => setMes(Number(v))}
          opciones={MESES.map((m, i) => ({ valor: String(i + 1), texto: m }))}
          className="h-10 px-3 text-sm"
        />
        {/*
          El año NO es `flex-1`: con doce meses y tres opciones de desarrollo al
          lado, dejarlo crecer le da un ancho que cuatro dígitos no usan.
        */}
        <div className="w-24 shrink-0">
          <SelectorModal
            label="Año"
            mostrarLabel={false}
            value={anio}
            onChange={setAnio}
            opciones={anios.map((a) => ({ valor: a, texto: a }))}
            className="h-10 px-3 text-sm"
          />
        </div>
        {/*
          El filtro de desarrollo, en la MISMA fila que mes y año.

          En el BOTÓN el texto es corto —"Desarrollados"— porque comparte la
          fila con otros dos controles; adentro del modal, donde el ancho no
          aprieta, cada opción se explica entera. Es lo que un `<select>` no
          permitía: ahí las dos cosas eran el mismo string.
        */}
        <SelectorModal
          label="Desarrollo del índice"
          mostrarLabel={false}
          descripcion="Qué intervenciones entran en los tres gráficos"
          value={desarrollo}
          onChange={(v) => setDesarrollo(v as FiltroDesarrollo)}
          opciones={[
            { valor: "TODOS", texto: "Todas", extra: "Sin filtrar por desarrollo del índice" },
            { valor: "SI", texto: "Desarrollados", extra: "Solo las que desarrollaron el índice" },
            { valor: "NO", texto: "No desarrollados", extra: "Solo las que no lo desarrollaron" },
          ]}
          className="h-10 px-3 text-sm"
        />
      </div>

      {/* ── Gráfico 1: horarios ──────────────────────────────────────────── */}
      <section>
        {/*
          El ojo va en la CABECERA y no adentro de la tarjeta: lo que se oculta
          es la tarjeta entera, así que el control tiene que sobrevivirla.
        */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold">Puntualidad</h2>
            {/*
              "Fuera de horario" y no "atraso": el backend manda las marcaciones
              que se apartan 15+ min EN CUALQUIER DIRECCIÓN, así que en el total
              también entran las marcaciones muy anticipadas.
            */}
            <p className="text-xs text-muted-foreground">
              Total marcado fuera de horario · desvíos de 15 min o más
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVerPuntualidad((v) => !v)}
            aria-expanded={verPuntualidad}
            aria-label={
              verPuntualidad
                ? "Ocultar el gráfico de puntualidad"
                : "Mostrar el gráfico de puntualidad"
            }
            className="tap grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            {verPuntualidad ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        {verPuntualidad && (
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            {isLoading ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            ) : isError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No se pudo cargar la puntualidad.
              </p>
            ) : !resumen.length ? (
              /*
              Dos causas posibles y el texto no las separa a propósito: o no hay
              marcaciones cargadas, o todas cayeron dentro de los 15 minutos.
              Las dos son "no hay nada que revisar".
            */
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin desvíos de 15 minutos o más en {MESES[mes - 1]} de {anio}
                {coletilla}.
              </p>
            ) : (
              <>
                <PuntualidadChart datos={resumen} onSeleccionar={setElegido} />
                <p className="mt-3 border-t border-border/60 pt-2.5 text-center text-[11px] text-muted-foreground">
                  Tocá una barra para ver el detalle
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Gráfico 2: ubicación ─────────────────────────────────────────── */}
      <section className="mt-7">
        <div className="mb-3">
          <h2 className="font-display text-xl font-bold">Ubicación</h2>
          <p className="text-xs text-muted-foreground">
            Marcaciones a más de 1 km de la institución
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          {isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          ) : isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No se pudo cargar la ubicación.
            </p>
          ) : !ubicacion.length ? (
            /*
              El texto dice "sin marcaciones fuera de rango" y NO "todos
              marcaron donde debían", porque también cae acá el caso de que no
              haya con qué comparar: una institución con una sola marcación
              histórica tiene su punto de referencia sobre esa misma marcación,
              así que la distancia da 0 y nunca aparece. Ver el join `ref` en
              `intervenciones.sql`.
            */
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin marcaciones fuera de rango en {MESES[mes - 1]} de {anio}
              {coletilla}.
            </p>
          ) : (
            <>
              <UbicacionChart datos={ubicacion} onSeleccionar={setElegidoUbi} />
              <p className="mt-3 border-t border-border/60 pt-2.5 text-center text-[11px] text-muted-foreground">
                Tocá una barra para ver el detalle y el mapa
              </p>
            </>
          )}
        </div>
      </section>

      {/* ── Gráfico 3: actividad diaria ──────────────────────────────────── */}
      <section className="mt-7">
        <div className="mb-3">
          <h2 className="font-display text-xl font-bold">Actividad</h2>
          {/*
            "Todas" es el dato que evita el malentendido: los dos gráficos de
            arriba muestran solo desvíos, y sin esta aclaración se leería como
            si estas barras también fueran problemas.

            Con el filtro de desarrollo puesto ya NO son todas, así que el texto
            lo dice: dejarlo fijo en "Todas" mientras el backend cuenta un
            subconjunto sería la única línea de la pantalla que miente.
          */}
          <p className="text-xs text-muted-foreground">
            {desarrollo === "TODOS"
              ? "Todas las intervenciones, por día del mes"
              : desarrollo === "SI"
                ? "Intervenciones que desarrollaron el índice, por día del mes"
                : "Intervenciones que no desarrollaron el índice, por día del mes"}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          {cargandoDias ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          ) : errorDias ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No se pudo cargar la actividad.
            </p>
          ) : !dias?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin intervenciones registradas en {MESES[mes - 1]} de {anio}
              {coletilla}.
            </p>
          ) : (
            <ActividadChart datos={dias} />
          )}
        </div>
      </section>

      <PuntualidadModal
        facilitador={elegido}
        anio={anio}
        mes={mes}
        onClose={() => setElegido(null)}
      />
      <UbicacionModal
        facilitador={elegidoUbi}
        anio={anio}
        mes={mes}
        onClose={() => setElegidoUbi(null)}
      />
    </>
  );
}
