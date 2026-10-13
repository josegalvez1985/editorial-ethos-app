import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, RotateCcw, Van } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { RUTA_ENVIOS } from "@/components/envio-grafica-form";
import { keysEnvios, listarEnvios, sumarLineas, type EnvioGrafica } from "@/lib/envios-graficas";
import { diaSemana, fechaCorta, hoyISO } from "@/lib/fechas";
import { usePermisos } from "@/lib/permisos";
import { MANUALES, type ClaveManual } from "@/lib/postulaciones";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/envios-graficas/")({
  head: () => ({
    meta: [
      { title: "Envíos de Gráficas — Juventud con Valores" },
      {
        name: "description",
        content: "Lo que cada gráfica mandó a cada sucursal, manual por manual.",
      },
    ],
  }),
  component: EnviosGraficasPage,
});

const numero = new Intl.NumberFormat("es-PY");
const TODOS = "todos";

/** "12 oct 2026, 18:40" a partir de `YYYY-MM-DDTHH:MI`. */
const cuando = (f: string) => (f ? `${fechaCorta(f.slice(0, 10))}, ${f.slice(11, 16)}` : "");

/** Valores distintos con cuántos envíos tiene cada uno, ordenados por nombre. */
function contar(grupos: string[][]) {
  const m = new Map<string, number>();
  for (const valores of grupos) for (const v of new Set(valores)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0], "es"));
}

/**
 * Envíos de Gráficas: pantalla nueva del sitio (13/10/2026), no viene de APEX.
 * Desde el mismo día cada envío es CABECERA (la gráfica y la fecha) y DETALLE
 * (los destinos: ciudad y sucursal, con cuántos manuales de cada uno). El alta
 * y la edición están en su propia pantalla (`/envios-graficas/nuevo` y
 * `/envios-graficas/$id`), como Transferencias. Backend:
 * `backend/envios_graficas.sql`.
 *
 * - **Arriba, los totales** de lo filtrado: manuales, envíos y destinos, y
 *   cuántos de cada manual, con los colores de los manuales de APEX.
 * - **Filtros en pastillas:** año (el actual de entrada, si tiene envíos),
 *   sucursal y gráfica, cada una con cuántos envíos tiene; buscador y
 *   Restablecer. Con una sucursal elegida, los totales cuentan solo lo que fue
 *   a esa sucursal.
 * - **Tarjetas** del más nuevo al más viejo: gráfica, fecha, los destinos y
 *   los manuales.
 * - **Sin PDF ni Excel acá:** salen solo por envío, en su pantalla (pedido el
 *   13/10/2026: "solo por registro, cabecera y detalle, no general").
 */
function EnviosGraficasPage() {
  const navigate = useNavigate();
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA_ENVIOS, "insertar");

  const { data, isLoading, error } = useQuery({
    queryKey: keysEnvios.todo,
    queryFn: listarEnvios,
  });
  const [anio, setAnio] = useState<string | null>(null);
  const [sucursal, setSucursal] = useState<string | null>(null);
  const [grafica, setGrafica] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");

  const envios = data?.envios ?? [];
  const anios = [...new Set(envios.map((e) => e.fecha.slice(0, 4)))].sort().reverse();
  // De entrada el año actual si tiene envíos; si no, todos.
  const actual = hoyISO().slice(0, 4);
  const anioElegido = anio ?? (anios.includes(actual) ? actual : TODOS);

  const q = normalizar(buscar.trim());
  const delAnio = envios.filter((e) => anioElegido === TODOS || e.fecha.startsWith(anioElegido));
  const porBusqueda = q
    ? delAnio.filter((e) =>
        normalizar(
          [
            e.grafica,
            ...e.lineas.flatMap((l) => [l.sucursal, l.ciudad, l.departamento, l.comentario]),
          ].join(" "),
        ).includes(q),
      )
    : delAnio;
  // Cada faceta cuenta con los otros filtros puestos, no con el suyo.
  const vaA = (e: EnvioGrafica, s: string) => e.lineas.some((l) => l.sucursal === s);
  const sucursales = contar(
    porBusqueda
      .filter((e) => grafica == null || e.grafica === grafica)
      .map((e) => e.lineas.map((l) => l.sucursal)),
  );
  const graficas = contar(
    porBusqueda.filter((e) => sucursal == null || vaA(e, sucursal)).map((e) => [e.grafica]),
  );
  const visibles = porBusqueda.filter(
    (e) => (sucursal == null || vaA(e, sucursal)) && (grafica == null || e.grafica === grafica),
  );
  // Las líneas que cuentan: con una sucursal elegida, solo las que van a ella.
  const filas = visibles.flatMap((e) =>
    e.lineas.filter((l) => sucursal == null || l.sucursal === sucursal),
  );
  const totales = sumarLineas(filas);
  const total = filas.reduce((a, f) => a + f.cantidad, 0);
  const filtrado = anio != null || sucursal != null || grafica != null || !!q;

  const restablecer = () => {
    setAnio(null);
    setSucursal(null);
    setGrafica(null);
    setBuscar("");
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Envíos de Gráficas</h1>
            <p className="text-xs text-muted-foreground">
              Lo que cada gráfica mandó a cada sucursal, manual por manual.
            </p>
          </div>
          {!isLoading && !error && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {puedeAgregar && (
                <Link
                  to="/envios-graficas/nuevo"
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
                >
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">Nuevo envío</span>
                  <span className="sm:hidden">Nuevo</span>
                </Link>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar los envíos" />
        ) : !envios.length ? (
          <div className="py-12 text-center">
            <Van className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Todavía no hay envíos de gráficas cargados.
            </p>
            {puedeAgregar && (
              <Link
                to="/envios-graficas/nuevo"
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar el primero
              </Link>
            )}
          </div>
        ) : (
          <>
            <Resumen
              envios={visibles.length}
              destinos={filas.length}
              total={total}
              totales={totales}
            />

            {envios.length > 6 && (
              <Buscador
                valor={buscar}
                onCambio={setBuscar}
                placeholder="Buscar por gráfica, sucursal, ciudad o departamento…"
              />
            )}

            {anios.length > 1 && (
              <Faceta titulo="Año">
                <Pastilla activa={anioElegido === TODOS} onClick={() => setAnio(TODOS)}>
                  Todos
                </Pastilla>
                {anios.map((a) => (
                  <Pastilla
                    key={a}
                    activa={anioElegido === a}
                    cuenta={envios.filter((e) => e.fecha.startsWith(a)).length}
                    onClick={() => setAnio(a)}
                  >
                    {a}
                  </Pastilla>
                ))}
              </Faceta>
            )}
            {(sucursales.length > 1 || sucursal != null) && (
              <Faceta titulo="Sucursal">
                <Pastilla activa={sucursal == null} onClick={() => setSucursal(null)}>
                  Todas
                </Pastilla>
                {sucursales.map(([s, n]) => (
                  <Pastilla
                    key={s}
                    activa={sucursal === s}
                    cuenta={n}
                    onClick={() => setSucursal(sucursal === s ? null : s)}
                  >
                    {s}
                  </Pastilla>
                ))}
              </Faceta>
            )}
            {(graficas.length > 1 || grafica != null) && (
              <Faceta titulo="Gráfica">
                <Pastilla activa={grafica == null} onClick={() => setGrafica(null)}>
                  Todas
                </Pastilla>
                {graficas.map(([g, n]) => (
                  <Pastilla
                    key={g}
                    activa={grafica === g}
                    cuenta={n}
                    onClick={() => setGrafica(grafica === g ? null : g)}
                  >
                    {g}
                  </Pastilla>
                ))}
              </Faceta>
            )}

            {filtrado && (
              <button
                type="button"
                onClick={restablecer}
                className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-primary"
              >
                <RotateCcw className="size-3.5" />
                Restablecer
              </button>
            )}

            {!visibles.length ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Ningún envío coincide con los filtros.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {visibles.map((e) => (
                  <li key={e.id}>
                    <Tarjeta
                      e={e}
                      onAbrir={() =>
                        navigate({ to: "/envios-graficas/$id", params: { id: String(e.id) } })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Resumen({
  envios,
  destinos,
  total,
  totales,
}: {
  envios: number;
  destinos: number;
  total: number;
  totales: Record<ClaveManual, number>;
}) {
  return (
    <section className="mb-4 rounded-3xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p>
          <span className="font-display text-3xl font-bold tabular-nums">
            {numero.format(total)}
          </span>{" "}
          <span className="text-sm text-muted-foreground">manuales</span>
        </p>
        <p className="text-sm text-muted-foreground">
          en <span className="font-semibold text-foreground tabular-nums">{envios}</span>{" "}
          {envios === 1 ? "envío" : "envíos"} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">{destinos}</span>{" "}
          {destinos === 1 ? "destino" : "destinos"}
        </p>
      </div>
      <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {MANUALES.map((m) => (
          <li
            key={m.clave}
            className={`rounded-xl px-2 py-1.5 text-center ${totales[m.clave] ? "" : "opacity-40"}`}
            style={{ backgroundColor: m.color, color: m.tinta }}
          >
            <span className="block text-[10.5px] font-semibold tracking-wide uppercase opacity-90">
              {m.nombre}
            </span>
            <span className="block text-base font-bold tabular-nums">
              {numero.format(totales[m.clave])}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faceta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        {titulo}
      </p>
      <div role="group" aria-label={titulo} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  );
}

function Pastilla({
  activa,
  onClick,
  cuenta,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  cuenta?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`tap flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="truncate">{children}</span>
      {cuenta != null && (
        <span
          className={`rounded-full px-1.5 text-[11px] tabular-nums ${activa ? "bg-white/20" : "bg-muted"}`}
        >
          {cuenta}
        </span>
      )}
    </button>
  );
}

/** Hasta cuántos destinos se listan en la tarjeta antes de "y N más". */
const DESTINOS_VISIBLES = 3;

function Tarjeta({ e, onAbrir }: { e: EnvioGrafica; onAbrir: () => void }) {
  const resto = e.lineas.length - DESTINOS_VISIBLES;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap flex h-full w-full flex-col gap-2.5 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft hover:border-primary/40"
    >
      <span className="flex w-full items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{e.grafica}</span>
          <span className="block text-[12px] text-muted-foreground capitalize">
            {diaSemana(e.fecha)} {fechaCorta(e.fecha)} · Nº {e.id}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-2xl leading-none font-bold tabular-nums">
            {numero.format(e.cantidad)}
          </span>
          <span className="text-[11px] text-muted-foreground">manuales</span>
        </span>
      </span>

      <span className="block space-y-0.5">
        {e.lineas.slice(0, DESTINOS_VISIBLES).map((l) => (
          <span key={l.id} className="flex items-center gap-1 text-[12.5px]">
            <ArrowRight className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-primary">{l.sucursal}</span>
              <span className="text-muted-foreground"> · {l.ciudad || "Sin ciudad"}</span>
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
              {numero.format(l.cantidad)}
            </span>
          </span>
        ))}
        {resto > 0 && (
          <span className="block pl-[18px] text-[11.5px] text-muted-foreground">
            y {resto} {resto === 1 ? "destino más" : "destinos más"}
          </span>
        )}
      </span>

      <span className="flex flex-wrap gap-1.5">
        {MANUALES.filter((m) => e.manuales[m.clave] > 0).map((m) => (
          <span
            key={m.clave}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ backgroundColor: m.color, color: m.tinta }}
          >
            {m.nombre} {numero.format(e.manuales[m.clave])}
          </span>
        ))}
      </span>

      {e.cargadoEl && (
        <span className="text-[11px] text-muted-foreground">
          Cargado el {cuando(e.cargadoEl)}
          {e.cargadoPor ? ` por ${e.cargadoPor}` : ""}
        </span>
      )}
    </button>
  );
}
