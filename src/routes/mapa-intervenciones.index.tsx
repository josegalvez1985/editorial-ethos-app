import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, MapPinned, MapPinOff } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import {
  MapaIntervenciones,
  type GrupoPin,
  type InstitucionPin,
  type Recorrido,
} from "@/components/mapa-intervenciones";
import { PickerModal } from "@/components/picker-modal";
import { diaISO, diaSemana, hoyISO, sumarDias } from "@/lib/fechas";
import { linkMapaPunto } from "@/lib/intervenciones";
import {
  esc,
  keysMapa,
  listarFacilitadoresMapa,
  listarPuntosMapa,
  textoDistancia,
  type PuntoMapa,
} from "@/lib/mapa-intervenciones";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/mapa-intervenciones/")({
  head: () => ({
    meta: [
      { title: "Intervenciones en el Mapa — Juventud con Valores" },
      { name: "description", content: "Dónde marcó cada facilitador, día por día." },
    ],
  }),
  component: MapaIntervencionesPage,
});

type Periodo = "hoy" | "ayer" | "semana" | "semana-pasada" | "mes" | "otro";

const PERIODOS: { clave: Periodo; texto: string }[] = [
  { clave: "hoy", texto: "Hoy" },
  { clave: "ayer", texto: "Ayer" },
  { clave: "semana", texto: "Esta semana" },
  { clave: "semana-pasada", texto: "Semana pasada" },
  { clave: "mes", texto: "Este mes" },
  { clave: "otro", texto: "Otro período" },
];

/** El lunes de la semana de `f`. */
const lunesDe = (f: string) => {
  const dow = (new Date(`${f}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return sumarDias(f, -dow);
};

function rango(p: Periodo, otro: { desde: string; hasta: string }) {
  const hoy = hoyISO();
  switch (p) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer":
      return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
    case "semana":
      return { desde: lunesDe(hoy), hasta: hoy };
    case "semana-pasada": {
      const l = sumarDias(lunesDe(hoy), -7);
      return { desde: l, hasta: sumarDias(l, 6) };
    }
    case "mes":
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    default:
      return otro;
  }
}

/** "lun 6". */
const diaCorto = (f: string) => `${diaSemana(f).slice(0, 3)} ${Number(f.slice(8))}`;

/**
 * Intervenciones en el Mapa: la página 25 de APEX (fechas + facilitador +
 * institución, un botón "Ver" y los pines en un mapa de 400 px). Backend:
 * `intervenciones/mapa` en `backend/intervenciones.sql`. El ícono es el que ya
 * tenía en el menú (`MapPinned`).
 *
 * Rediseñada (aprobado el 09/10/2026) como "el día de un facilitador en el
 * mapa":
 *
 * - **Período con atajos** (Hoy, Esta semana…), facilitador con cuántas
 *   marcaciones tiene en el período, institución opcional. Se actualiza solo,
 *   sin botón.
 * - **Resumen**: marcaciones, instituciones, días y cuántas fueron lejos de la
 *   institución (más de 1 km del punto que se deduce de sus marcaciones).
 * - **Mapa grande** con pines numerados por hora, el recorrido de cada día y
 *   cada institución con su ícono; las lejanas en ámbar; las del mismo lugar
 *   en un solo pin.
 * - **Línea de tiempo** por día: tocar una marcación vuela el mapa hasta ella.
 *
 * Arregla de APEX: los pines se dibujaban tres veces (y solo una capa tenía
 * el detalle), cada "Ver" se sumaba encima del anterior, y el filtro de fecha
 * pasaba la fecha por texto.
 */
function MapaIntervencionesPage() {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [otro, setOtro] = useState(() => ({ desde: sumarDias(hoyISO(), -6), hasta: hoyISO() }));
  const [idFac, setIdFac] = useState<number | null>(null);
  const [idInst, setIdInst] = useState<number | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const mapaRef = useRef<HTMLDivElement>(null);

  const { desde, hasta } = rango(periodo, otro);
  const rangoValido = !!desde && !!hasta && desde <= hasta && diaISO(hasta) - diaISO(desde) <= 366;

  const facs = useQuery({
    queryKey: keysMapa.facilitadores(desde, hasta),
    queryFn: () => listarFacilitadoresMapa(desde, hasta),
    enabled: rangoValido,
  });
  const puntosQ = useQuery({
    queryKey: keysMapa.puntos(desde, hasta, idFac ?? 0),
    queryFn: () => listarPuntosMapa(desde, hasta, idFac!),
    enabled: rangoValido && idFac != null,
  });

  const todos = useMemo(() => puntosQ.data?.puntos ?? [], [puntosQ.data]);
  const umbral = puntosQ.data?.umbralMetros ?? 1000;

  // Las instituciones del facilitador en el período, con cuántas.
  const instituciones = useMemo(() => {
    const m = new Map<number, { id: number; nombre: string; n: number }>();
    for (const p of todos) {
      if (p.idInstitucion == null) continue;
      const x = m.get(p.idInstitucion);
      if (x) x.n++;
      else m.set(p.idInstitucion, { id: p.idInstitucion, nombre: p.institucion, n: 1 });
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [todos]);
  const instActiva = instituciones.some((i) => i.id === idInst) ? idInst : null;

  const delFiltro = useMemo(
    () => todos.filter((p) => instActiva == null || p.idInstitucion === instActiva),
    [todos, instActiva],
  );
  const dias = useMemo(() => [...new Set(delFiltro.map((p) => p.dia))], [delFiltro]);
  const diaActivo = dia && dias.includes(dia) ? dia : null;

  // Lo que se ve, numerado por hora.
  const visibles = useMemo(
    () =>
      delFiltro
        .filter((p) => diaActivo == null || p.dia === diaActivo)
        .map((p, i) => ({ ...p, n: i + 1, lejos: p.distancia != null && p.distancia > umbral })),
    [delFiltro, diaActivo, umbral],
  );

  const { grupos, instPins, recorridos } = useMemo(() => {
    const g = new Map<string, GrupoPin>();
    const insts = new Map<number, InstitucionPin>();
    const rec = new Map<string, [number, number][]>();
    for (const p of visibles) {
      if (p.idInstitucion != null && p.instLat != null && p.instLng != null) {
        insts.set(p.idInstitucion, {
          id: p.idInstitucion,
          nombre: p.institucion,
          lat: p.instLat,
          lng: p.instLng,
        });
      }
      if (p.lat == null || p.lng == null) continue;
      // ~11 m: el mismo lugar.
      const clave = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      const grupo = g.get(clave) ?? { clave, lat: p.lat, lng: p.lng, puntos: [] };
      grupo.puntos.push({ id: p.id, n: p.n, lejos: p.lejos, html: popup(p, umbral) });
      g.set(clave, grupo);
      const r = rec.get(p.dia) ?? [];
      r.push([p.lat, p.lng]);
      rec.set(p.dia, r);
    }
    return {
      grupos: [...g.values()],
      instPins: [...insts.values()],
      recorridos: [...rec].map(([clave, coords]): Recorrido => ({ clave, coords })),
    };
  }, [visibles, umbral]);

  const lejos = visibles.filter((p) => p.lejos).length;
  const sinUbic = visibles.filter((p) => p.lat == null).length;
  const facElegido = facs.data?.find((f) => f.id === idFac);

  const elegir = (id: number) => {
    setSel(id);
    // En el celular el mapa queda arriba de la lista: se lo trae a la vista.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      mapaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Intervenciones en el Mapa</h1>
          <p className="text-xs text-muted-foreground">
            Dónde marcó cada facilitador, día por día.
          </p>
        </div>

        {/* Filtros */}
        <div className="mb-3 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <div role="tablist" aria-label="Período" className="flex flex-wrap gap-2">
            {PERIODOS.map((p) => (
              <Pastilla
                key={p.clave}
                activa={periodo === p.clave}
                onClick={() => setPeriodo(p.clave)}
              >
                {p.texto}
              </Pastilla>
            ))}
          </div>
          {periodo === "otro" && (
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Desde</span>
                <input
                  type="date"
                  value={otro.desde}
                  onChange={(e) => setOtro((o) => ({ ...o, desde: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Hasta</span>
                <input
                  type="date"
                  value={otro.hasta}
                  onChange={(e) => setOtro((o) => ({ ...o, hasta: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3"
                />
              </label>
              {!rangoValido && (
                <p className="col-span-2 text-xs text-destructive">
                  Elegí un período válido, de hasta un año.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PickerModal
              key={`fac-${desde}-${hasta}-${idFac ?? ""}`}
              label="Facilitador"
              opciones={(facs.data ?? []).map((f) => ({
                id: f.id,
                texto: f.nombre,
                extra: `${f.cantidad} ${f.cantidad === 1 ? "marcación" : "marcaciones"}`,
                busqueda: normalizar(f.nombre),
              }))}
              value={idFac}
              valueText={facElegido?.nombre ?? null}
              onChange={(o) => {
                setIdFac(o.id);
                setIdInst(null);
                setDia(null);
                setSel(null);
              }}
              placeholder={
                facs.isLoading
                  ? "Cargando…"
                  : facs.data?.length
                    ? "Elegir facilitador"
                    : "Nadie marcó en este período"
              }
              disabledReason={!rangoValido ? "Elegí el período" : undefined}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Institución</span>
              <select
                value={instActiva ?? ""}
                onChange={(e) => {
                  setIdInst(e.target.value ? Number(e.target.value) : null);
                  setSel(null);
                }}
                disabled={!instituciones.length}
                className="h-12 w-full rounded-xl border border-input bg-card px-3.5 text-base disabled:opacity-60"
              >
                <option value="">
                  Todas{instituciones.length ? ` (${instituciones.length})` : ""}
                </option>
                {instituciones.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nombre} · {i.n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Resumen */}
        {idFac != null && puntosQ.data && todos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Dato
              valor={visibles.length}
              texto={visibles.length === 1 ? "marcación" : "marcaciones"}
            />
            <Dato valor={instPinsCount(visibles)} texto="instituciones" />
            <Dato valor={dias.length} texto={dias.length === 1 ? "día" : "días"} />
            {lejos > 0 && (
              <Dato
                valor={lejos}
                texto={`lejos (más de ${textoDistancia(umbral)})`}
                icono={<AlertTriangle className="size-3.5" />}
                aviso
              />
            )}
            {sinUbic > 0 && (
              <Dato
                valor={sinUbic}
                texto="sin ubicación"
                icono={<MapPinOff className="size-3.5" />}
              />
            )}
          </div>
        )}

        {/* Días */}
        {dias.length > 1 && (
          <div role="tablist" aria-label="Día" className="mb-3 flex flex-wrap gap-2">
            <Pastilla chica activa={diaActivo == null} onClick={() => setDia(null)}>
              Todos los días
            </Pastilla>
            {dias.map((d) => (
              <Pastilla
                key={d}
                chica
                activa={diaActivo === d}
                onClick={() => {
                  setDia(d);
                  setSel(null);
                }}
              >
                <span className="capitalize">{diaCorto(d)}</span>
              </Pastilla>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* `isolate`: los z-index del mapa (los paneles de Leaflet van de 400 a
              1000, y el cartel de encima en 500) quedan acá adentro. Sin esto
              tapaban las ventanas de la página (z-50), como la lista de
              facilitadores. */}
          <div ref={mapaRef} className="relative isolate scroll-mt-20">
            <MapaIntervenciones
              grupos={grupos}
              instituciones={instPins}
              recorridos={recorridos}
              seleccionado={sel}
              onSeleccionar={setSel}
              className="z-0 h-[55vh] w-full overflow-hidden rounded-2xl border border-border/60 shadow-soft lg:h-[calc(100dvh-17rem)] lg:min-h-[420px]"
            />
            {(idFac == null || puntosQ.isLoading || (puntosQ.data && !todos.length)) && (
              <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center rounded-2xl bg-background/60 backdrop-blur-[1px]">
                <div className="rounded-xl bg-card px-4 py-3 text-center text-sm shadow-soft">
                  {idFac == null ? (
                    <>
                      <MapPinned className="mx-auto mb-1 size-6 text-primary" />
                      Elegí un facilitador para ver dónde marcó.
                    </>
                  ) : puntosQ.isLoading ? (
                    "Cargando marcaciones…"
                  ) : (
                    "Sin marcaciones en este período."
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 lg:max-h-[calc(100dvh-17rem)] lg:min-h-[420px] lg:overflow-y-auto">
            {puntosQ.isError ? (
              <Fallo error={puntosQ.error} texto="No se pudieron cargar las marcaciones" />
            ) : idFac != null && puntosQ.isLoading ? (
              <Cargando />
            ) : visibles.length ? (
              <Linea puntos={visibles} seleccionado={sel} onElegir={elegir} />
            ) : null}
            {facs.isError && (
              <Fallo error={facs.error} texto="No se pudieron cargar los facilitadores" />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const instPinsCount = (ps: { idInstitucion: number | null }[]) =>
  new Set(ps.map((p) => p.idInstitucion).filter((x) => x != null)).size;

/** El contenido del popup de un pin (HTML escapado). */
function popup(p: PuntoMapa & { n: number; lejos: boolean }, umbral: number): string {
  const manual = [p.manual, p.nroIndice].filter(Boolean).join("-");
  const link = linkMapaPunto(p.lat, p.lng);
  return [
    `<strong>${p.n}. ${esc(p.hora)}</strong> <span style="color:#64748b">${esc(diaCorto(p.dia))}</span>`,
    `<div>${esc(p.institucion || "Sin institución")}</div>`,
    manual || p.indice
      ? `<div style="color:#475569">${esc([manual, p.indice].filter(Boolean).join(" · "))}</div>`
      : "",
    p.observacion ? `<div style="color:#475569;font-style:italic">${esc(p.observacion)}</div>` : "",
    p.distancia != null
      ? `<div style="color:${p.distancia > umbral ? "#b45309" : "#475569"}">${p.distancia > umbral ? "⚠ " : ""}A ${esc(textoDistancia(p.distancia))} de la institución</div>`
      : "",
    link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">Abrir en Google Maps</a>` : "",
  ].join("");
}

function Pastilla({
  activa,
  onClick,
  chica,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  chica?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={`tap flex items-center gap-1.5 rounded-full border font-semibold ${
        chica ? "h-8 px-3 text-[12px]" : "h-9 px-3.5 text-[13px]"
      } ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Dato({
  valor,
  texto,
  icono,
  aviso,
}: {
  valor: number;
  texto: string;
  icono?: ReactNode;
  aviso?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
        aviso
          ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "border-border/60 bg-card text-muted-foreground"
      }`}
    >
      {icono}
      <strong className="text-foreground tabular-nums">{valor}</strong>
      {texto}
    </span>
  );
}

/** La línea de tiempo, agrupada por día. */
function Linea({
  puntos,
  seleccionado,
  onElegir,
}: {
  puntos: (PuntoMapa & { n: number; lejos: boolean })[];
  seleccionado: number | null;
  onElegir: (id: number) => void;
}) {
  const porDia = new Map<string, typeof puntos>();
  for (const p of puntos) {
    const l = porDia.get(p.dia);
    if (l) l.push(p);
    else porDia.set(p.dia, [p]);
  }
  return (
    <div className="space-y-4">
      {[...porDia].map(([d, lista]) => (
        <section key={d}>
          <h2 className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            {diaSemana(d)} {Number(d.slice(8))}/{Number(d.slice(5, 7))}
          </h2>
          <ol className="space-y-1.5">
            {lista.map((p) => {
              const sinUbic = p.lat == null;
              const activo = seleccionado === p.id;
              const manual = [p.manual, p.nroIndice].filter(Boolean).join("-");
              const link = linkMapaPunto(p.lat, p.lng);
              return (
                <li key={p.id}>
                  <div
                    className={`flex items-start gap-3 rounded-xl border p-2.5 ${
                      activo ? "border-primary/50 bg-primary-soft/40" : "border-border/60 bg-card"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => !sinUbic && onElegir(p.id)}
                      disabled={sinUbic}
                      className="tap flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default"
                    >
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${
                          sinUbic ? "bg-slate-400" : p.lejos ? "bg-amber-600" : "bg-[#27306a]"
                        }`}
                      >
                        {p.n}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-sm font-bold tabular-nums">{p.hora}</span>
                          <span className="truncate text-[13px] font-medium">
                            {p.institucion || "Sin institución"}
                          </span>
                        </span>
                        {(manual || p.indice) && (
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {[manual, p.indice].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        {p.observacion && (
                          <span className="line-clamp-2 block text-[12px] text-muted-foreground italic">
                            {p.observacion}
                          </span>
                        )}
                        <span
                          className={`block text-[11.5px] ${
                            p.lejos
                              ? "font-semibold text-amber-700 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {sinUbic
                            ? "Sin ubicación"
                            : p.distancia != null
                              ? `${p.lejos ? "⚠ " : ""}A ${textoDistancia(p.distancia)} de la institución`
                              : "Sin punto de la institución para comparar"}
                        </span>
                      </span>
                    </button>
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Abrir en Google Maps"
                        title="Abrir en Google Maps"
                        className="tap grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
