import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  MapPin,
  Plus,
  School,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keysInstituciones, listarInstituciones, type InstitucionFila } from "@/lib/instituciones";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/instituciones/")({
  head: () => ({
    meta: [
      { title: "Instituciones — Juventud con Valores" },
      { name: "description", content: "Las instituciones, con sus autoridades y su horario." },
    ],
  }),
  component: InstitucionesPage,
});

type FiltroEstado = "activas" | "inactivas" | "todas";

/** Cuántas tarjetas se dibujan antes de "Ver más": en un teléfono, cientos pesan. */
const TOPE = 60;

/**
 * Instituciones: la página 16 de APEX (un IG de solo lectura con filtros
 * Departamento → Ciudad → Institución). Acá, tarjetas con lo que se busca de
 * un vistazo —dónde queda, quién la facilita, quién la dirige— y **cómo va el
 * año lectivo** en cada una (horario cargado, pre-horarios confirmados,
 * postulaciones), para ver de una pasada cuál falta. La ficha completa, al
 * tocar una (`/instituciones/$id`).
 *
 * El ícono es el que ya tenía en el menú (`School`): no se cambia.
 */
function InstitucionesPage() {
  const { puedeRuta } = usePermisos();
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>("activas");
  const [idDep, setIdDep] = useState<number | null>(null);
  const [idCiudad, setIdCiudad] = useState<number | null>(null);
  const [sinFacilitador, setSinFacilitador] = useState(false);
  const [mostrar, setMostrar] = useState(TOPE);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysInstituciones.lista,
    queryFn: listarInstituciones,
  });

  const todas = data?.items ?? [];
  const anio = data?.anio ?? "";
  const cuenta = {
    todas: todas.length,
    activas: todas.filter((i) => i.activa).length,
    inactivas: todas.filter((i) => !i.activa).length,
  };
  const porEstado = todas.filter((i) => estado === "todas" || i.activa === (estado === "activas"));
  const departamentos = agrupar(
    porEstado,
    (i) => i.idDepartamento,
    (i) => i.departamento,
  );
  const ciudades = agrupar(
    porEstado.filter((i) => idDep == null || i.idDepartamento === idDep),
    (i) => i.idCiudad,
    (i) => i.ciudad,
  );
  const q = normalizar(buscar.trim());
  const filas = porEstado.filter(
    (i) =>
      (idDep == null || i.idDepartamento === idDep) &&
      (idCiudad == null || i.idCiudad === idCiudad) &&
      (!sinFacilitador || i.idFacilitador == null) &&
      (!q ||
        normalizar(
          `${i.nombre} ${i.ciudad} ${i.barrio} ${i.departamento} ${i.zona} ${i.direccion} ${i.director} ${i.facilitador}`,
        ).includes(q)),
  );
  const sinFac = porEstado.filter((i) => i.idFacilitador == null).length;
  const hayFiltros =
    !!buscar.trim() || estado !== "activas" || idDep != null || idCiudad != null || sinFacilitador;
  const limpiar = () => {
    setBuscar("");
    setEstado("activas");
    setIdDep(null);
    setIdCiudad(null);
    setSinFacilitador(false);
  };

  // Un filtro nuevo vuelve a la primera tanda.
  useEffect(() => setMostrar(TOPE), [buscar, estado, idDep, idCiudad, sinFacilitador]);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Instituciones
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {todas.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Datos, autoridades y horario de cada una
              {anio ? `, y cómo va ${anio}` : ""}.
            </p>
          </div>
          {puedeRuta("/instituciones", "insertar") && (
            <Link
              to="/instituciones/$id"
              params={{ id: "nueva" }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              Nueva
            </Link>
          )}
        </div>

        {/* Las pastillas bajan de línea: nunca una fila con scroll horizontal. */}
        <div className="mb-3 flex flex-wrap gap-2">
          {(
            [
              ["activas", "Activas"],
              ["inactivas", "Inactivas"],
              ["todas", "Todas"],
            ] as const
          ).map(([clave, label]) => (
            <Pastilla
              key={clave}
              activa={estado === clave}
              onClick={() => {
                setEstado(clave);
                setIdDep(null);
                setIdCiudad(null);
              }}
              cuenta={isLoading ? "…" : cuenta[clave]}
            >
              {label}
            </Pastilla>
          ))}
          <FiltroLista
            etiqueta="Departamento"
            opciones={departamentos}
            valor={idDep}
            onCambio={(id) => {
              setIdDep(id);
              setIdCiudad(null);
            }}
          />
          <FiltroLista
            etiqueta="Ciudad"
            opciones={ciudades}
            valor={idCiudad}
            onCambio={setIdCiudad}
          />
          {sinFac > 0 && (
            <Pastilla
              activa={sinFacilitador}
              onClick={() => setSinFacilitador((v) => !v)}
              cuenta={sinFac}
            >
              Sin facilitador
            </Pastilla>
          )}
          {/* El "Limpiar Filtros" de la página 16: aparece solo cuando hay algo que limpiar. */}
          {hayFiltros && (
            <button
              type="button"
              onClick={limpiar}
              className="tap flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-primary hover:bg-primary-soft"
            >
              <Eraser className="size-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>

        <Buscador
          valor={buscar}
          onCambio={setBuscar}
          placeholder="Buscar por nombre, ciudad, barrio, zona o director…"
        />

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudieron cargar las instituciones" />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <School className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {todas.length ? "Ninguna institución coincide." : "Todavía no hay instituciones."}
            </p>
            {todas.length > 0 && hayFiltros && (
              <button
                type="button"
                onClick={limpiar}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Eraser className="size-4" />
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {filas.slice(0, mostrar).map((i) => (
                <li key={i.id}>
                  <Tarjeta i={i} anio={anio} />
                </li>
              ))}
            </ul>
            {filas.length > mostrar && (
              <button
                type="button"
                onClick={() => setMostrar((m) => m + TOPE)}
                className="mx-auto mt-4 flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                Ver más ({filas.length - mostrar} restantes)
              </button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Tarjeta({ i, anio }: { i: InstitucionFila; anio: string }) {
  const lugar = [i.ciudad, i.barrio].filter(Boolean).join(" · ");
  return (
    <Link
      to="/instituciones/$id"
      params={{ id: String(i.id) }}
      className="tap flex h-full flex-col gap-2.5 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft hover:border-primary/40"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            i.activa ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          <School className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-sm leading-snug font-semibold">{i.nombre}</span>
            {!i.activa && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                Inactiva
              </span>
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">
              {lugar || "Sin ubicación"}
              {i.zona ? ` · ${i.zona}` : ""}
            </span>
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="space-y-1 text-[12px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <UserCheck className="size-3.5 shrink-0 text-muted-foreground" />
          {i.facilitador ? (
            <span className="truncate">{i.facilitador}</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">Sin facilitador</span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">
            {i.director ? `Dir. ${i.director}` : "Sin director vigente"}
          </span>
        </span>
      </div>

      {/* Cómo va el año lectivo. Sin año activo no hay a qué referirlo. */}
      {anio && (
        <div className="mt-auto flex flex-wrap gap-1.5">
          <Indicador ok={i.bloquesHorario > 0}>
            {i.bloquesHorario > 0 ? `Horario ${anio}` : `Sin horario ${anio}`}
          </Indicador>
          {i.preHorarios > 0 && (
            <Indicador ok={i.preConfirmados === i.preHorarios}>
              Pre-horarios {i.preConfirmados}/{i.preHorarios}
            </Indicador>
          )}
          {i.postulaciones > 0 && (
            <Indicador ok>
              {i.postulaciones} {i.postulaciones === 1 ? "postulación" : "postulaciones"}
            </Indicador>
          )}
        </div>
      )}
    </Link>
  );
}

function Indicador({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        ok ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {ok && <Check className="size-3" />}
      {children}
    </span>
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
  cuenta?: number | string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
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

type OpcionFiltro = { id: number; nombre: string; cantidad: number };

/** Los valores distintos de una columna, con cuántas filas tiene cada uno. */
function agrupar(
  filas: InstitucionFila[],
  id: (i: InstitucionFila) => number | null,
  nombre: (i: InstitucionFila) => string,
): OpcionFiltro[] {
  const m = new Map<number, OpcionFiltro>();
  for (const f of filas) {
    const k = id(f);
    if (k == null) continue;
    const o = m.get(k) ?? { id: k, nombre: nombre(f) || `#${k}`, cantidad: 0 };
    o.cantidad++;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Un filtro de lista larga (los 18 departamentos, las ciudades) como una
 * pastilla más: tocarla abre la lista con buscador y cuántas instituciones hay
 * en cada uno; elegido, muestra el nombre y una cruz para sacarlo. En APEX
 * eran dos popups arriba de la grilla.
 */
function FiltroLista({
  etiqueta,
  opciones,
  valor,
  onCambio,
}: {
  etiqueta: string;
  opciones: OpcionFiltro[];
  valor: number | null;
  onCambio: (id: number | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [buscar, setBuscar] = useState("");
  const elegido = opciones.find((o) => o.id === valor);
  const q = normalizar(buscar.trim());
  const visibles = q ? opciones.filter((o) => normalizar(o.nombre).includes(q)) : opciones;

  if (opciones.length < 2 && !elegido) return null;

  return (
    <>
      {elegido ? (
        <span className="flex h-9 shrink-0 items-center rounded-full border border-primary bg-primary text-[13px] font-semibold text-primary-foreground">
          <button type="button" onClick={() => setAbierto(true)} className="pl-3.5">
            {elegido.nombre}
          </button>
          <button
            type="button"
            onClick={() => onCambio(null)}
            aria-label={`Quitar el filtro de ${etiqueta.toLowerCase()}`}
            className="grid size-9 place-items-center rounded-full"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="tap flex h-9 shrink-0 items-center gap-1 rounded-full border border-border/60 bg-card px-3.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {etiqueta}
          <ChevronDown className="size-3.5" />
        </button>
      )}

      <Dialog
        open={abierto}
        onOpenChange={(o) => {
          setAbierto(o);
          if (!o) setBuscar("");
        }}
      >
        <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-xl">{etiqueta}</DialogTitle>
            <DialogDescription className="text-xs">
              Con cuántas instituciones hay en cada una.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <Buscador valor={buscar} onCambio={setBuscar} placeholder="Buscar…" />
          </div>
          <ul className="min-h-[8rem] space-y-1.5 overflow-y-auto overscroll-contain px-3 pb-4">
            {visibles.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onCambio(o.id);
                    setAbierto(false);
                    setBuscar("");
                  }}
                  className={`tap flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                    o.id === valor
                      ? "border-primary bg-primary-soft"
                      : "border-border/60 bg-card hover:border-primary/40"
                  }`}
                >
                  <span className="min-w-0 flex-1 text-[15px] leading-snug">{o.nombre}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {o.cantidad}
                  </span>
                </button>
              </li>
            ))}
            {!visibles.length && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nada coincide con “{buscar.trim()}”
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
