import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Clock, Copy, ExternalLink, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { HorarioInstitucion } from "@/components/horario-institucion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nombreTurno } from "@/lib/evaluaciones";
import {
  duracion,
  keysHorario,
  listarTodosHorarios,
  opcionesHorario,
  seSuperponen,
  textoDuracion,
  type BloqueHorario,
} from "@/lib/horario-instituciones";
import { keysInstituciones, listarInstituciones, type InstitucionFila } from "@/lib/instituciones";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/horarios-instituciones/")({
  head: () => ({
    meta: [
      { title: "Horarios de Instituciones — Juventud con Valores" },
      { name: "description", content: "El horario de cada institución, por año." },
    ],
  }),
  component: HorariosPage,
});

type Estado = "con" | "sin" | "todas";

const ESTADOS: { clave: Estado; texto: string }[] = [
  { clave: "con", texto: "Con horario" },
  { clave: "sin", texto: "Sin horario" },
  { clave: "todas", texto: "Todas" },
];

/** Una institución con sus bloques del año elegido. */
type Fila = {
  inst: InstitucionFila;
  bloques: BloqueHorario[];
  /** Sin bloques este año: el año más reciente que sí tiene, para copiar. */
  otroAnio?: string;
};

/**
 * Horarios de Instituciones: la página 31 de APEX (un IG de solo lectura sobre
 * `HORARIO_INSTITUCIONES`) y su modal 32 (Crear Horario). Backend:
 * `backend/horario_instituciones.sql`, el mismo de la pestaña Horario de la
 * ficha (`<HorarioInstitucion>`), que ya preveía esta página en sus permisos.
 * El ícono es el que ya tenía en el menú (`Clock`): no se cambia.
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Una tarjeta por institución**, no una fila por bloque: cada turno con su
 *   rango (de la primera hora a la última), cuántos bloques y cuánto suma. El
 *   IG mostraba bloque por bloque, de todas mezcladas y de todos los años.
 * - **Por año**, en pastillas, arrancando en el lectivo actual (el modal 32 no
 *   tenía año: lo ponía el trigger).
 * - **"Sin horario"**: las instituciones activas que todavía no lo cargaron ese
 *   año, avisando si tienen el de otro año para copiar. APEX no tenía cómo
 *   verlo: una institución sin bloques no aparecía.
 * - Filtro por **turno** y buscador por institución, ciudad o facilitador.
 * - **Tocar una tarjeta abre su horario completo** —el mismo de la ficha—, con
 *   agregar, editar, borrar, copiar de otro año y el aviso de bloques que se
 *   pisan. El 32 se reemplaza por ese diálogo: "Cargar horario" pide primero la
 *   institución, ofreciendo antes las que no tienen.
 *
 * Los permisos son los del componente: modificar instituciones (la 16) o la
 * acción en esta página (la 31).
 */
function HorariosPage() {
  const { puedeRuta } = usePermisos();
  const puedeCargar =
    puedeRuta("/instituciones", "actualizar") || puedeRuta("/horarios-instituciones", "insertar");

  const horarios = useQuery({ queryKey: keysHorario.todas, queryFn: listarTodosHorarios });
  const instituciones = useQuery({
    queryKey: keysInstituciones.lista,
    queryFn: listarInstituciones,
  });
  const opciones = useQuery({
    queryKey: keysHorario.opciones,
    queryFn: opcionesHorario,
    staleTime: 10 * 60 * 1000,
  });

  const [anio, setAnio] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("con");
  /** "" = todos los turnos. */
  const [turno, setTurno] = useState("");
  const [buscar, setBuscar] = useState("");
  const [abierta, setAbierta] = useState<InstitucionFila | null>(null);
  const [eligiendo, setEligiendo] = useState(false);

  const bloques = horarios.data?.bloques ?? [];
  const actual = horarios.data?.anioActual ?? "";
  // Los años con bloques, más el actual aunque esté vacío. "" = sin año, al final.
  const anios = [...new Set([...(actual ? [actual] : []), ...bloques.map((b) => b.anio)])].sort(
    (a, b) => (a === "" ? 1 : b === "" ? -1 : b.localeCompare(a)),
  );
  const elegido = anio ?? (actual || anios[0] || "");

  const listaTurnos = opciones.data?.turno ?? [];
  const nombre = (t: number) =>
    listaTurnos.find((o) => o.valor === String(t))?.mostrar ?? nombreTurno(t) ?? `Turno ${t}`;

  // Los bloques por institución: los del año elegido y el año más reciente de
  // los demás (vienen ordenados por año descendente).
  const delAnio = new Map<number, BloqueHorario[]>();
  const otroAnio = new Map<number, string>();
  for (const b of bloques) {
    if (b.anio === elegido) {
      const l = delAnio.get(b.idInstitucion);
      if (l) l.push(b);
      else delAnio.set(b.idInstitucion, [b]);
    } else if (b.anio && !otroAnio.has(b.idInstitucion)) {
      otroAnio.set(b.idInstitucion, b.anio);
    }
  }

  const filas: Fila[] = (instituciones.data?.items ?? []).map((inst) => ({
    inst,
    bloques: delAnio.get(inst.id) ?? [],
    otroAnio: otroAnio.get(inst.id),
  }));
  // Una inactiva sin horario no "falta": no se cuenta ni se lista.
  const conHorario = filas.filter((f) => f.bloques.length);
  const sinHorario = filas.filter((f) => !f.bloques.length && f.inst.activa);
  const cuentas: Record<Estado, number> = {
    con: conHorario.length,
    sin: sinHorario.length,
    todas: conHorario.length + sinHorario.length,
  };

  const turnosDelAnio = [...new Set([...delAnio.values()].flat().map((b) => b.turno))].sort(
    (a, b) => a - b,
  );
  // El filtro de turno no aplica a "Sin horario".
  const turnoActivo = estado !== "sin" && turnosDelAnio.includes(Number(turno)) ? turno : "";

  const q = normalizar(buscar.trim());
  const visibles = (
    estado === "con" ? conHorario : estado === "sin" ? sinHorario : [...conHorario, ...sinHorario]
  )
    .filter((f) => !turnoActivo || f.bloques.some((b) => String(b.turno) === turnoActivo))
    .filter(
      (f) =>
        !q ||
        normalizar(f.inst.nombre).includes(q) ||
        normalizar(f.inst.ciudad).includes(q) ||
        normalizar(f.inst.facilitador).includes(q),
    )
    .sort((a, b) => a.inst.nombre.localeCompare(b.inst.nombre, "es"));

  const cargando = horarios.isLoading || instituciones.isLoading || opciones.isLoading;
  const error = horarios.error ?? instituciones.error ?? opciones.error;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Horarios de Instituciones
            </h1>
            <p className="text-xs text-muted-foreground">
              El horario de clases de cada institución, por año y turno.
            </p>
          </div>
          {puedeCargar && !cargando && !error && elegido !== "" && (
            <button
              type="button"
              onClick={() => setEligiendo(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Cargar horario</span>
              <span className="sm:hidden">Cargar</span>
            </button>
          )}
        </div>

        {cargando ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar los horarios" />
        ) : (
          <>
            <div className="mb-3 space-y-2">
              {anios.length > 1 && (
                <div role="tablist" aria-label="Año" className="flex flex-wrap gap-2">
                  {anios.map((a) => (
                    <Pastilla key={a || "sin"} activa={elegido === a} onClick={() => setAnio(a)}>
                      {a || "Sin año"}
                      {a === actual && a !== "" && <span className="opacity-70">· actual</span>}
                    </Pastilla>
                  ))}
                </div>
              )}
              <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-2">
                {ESTADOS.map((e) => (
                  <Pastilla
                    key={e.clave}
                    activa={estado === e.clave}
                    onClick={() => setEstado(e.clave)}
                    cuenta={cuentas[e.clave]}
                  >
                    {e.texto}
                  </Pastilla>
                ))}
              </div>
              {estado !== "sin" && turnosDelAnio.length > 1 && (
                <div role="tablist" aria-label="Turno" className="flex flex-wrap gap-2">
                  {[0, ...turnosDelAnio].map((t) => (
                    <Pastilla
                      key={t}
                      chica
                      activa={turnoActivo === (t ? String(t) : "")}
                      onClick={() => setTurno(t ? String(t) : "")}
                    >
                      {t ? nombre(t) : "Todos los turnos"}
                    </Pastilla>
                  ))}
                </div>
              )}
            </div>

            {filas.length > 6 && (
              <Buscador
                valor={buscar}
                onCambio={setBuscar}
                placeholder="Buscar por institución, ciudad o facilitador…"
              />
            )}

            {!visibles.length ? (
              <div className="py-12 text-center">
                <Clock className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {q
                    ? "Ninguna institución coincide con la búsqueda."
                    : estado === "sin"
                      ? `Todas las instituciones activas tienen horario${elegido ? ` en ${elegido}` : ""}.`
                      : `Todavía no hay horarios cargados${elegido ? ` para ${elegido}` : " sin año"}.`}
                </p>
                {!q && estado === "con" && cuentas.sin > 0 && (
                  <button
                    type="button"
                    onClick={() => setEstado("sin")}
                    className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                  >
                    Ver las {cuentas.sin} sin horario
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {visibles.map((f) => (
                  <li key={f.inst.id}>
                    <Tarjeta
                      f={f}
                      anio={elegido}
                      turno={turnoActivo}
                      nombre={nombre}
                      onAbrir={() => setAbierta(f.inst)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {eligiendo && (
        <ElegirInstitucion
          filas={filas.filter((f) => f.inst.activa || f.bloques.length)}
          anio={elegido}
          onElegir={(inst) => {
            setEligiendo(false);
            setAbierta(inst);
          }}
          onCerrar={() => setEligiendo(false)}
        />
      )}

      {abierta && (
        <Dialog open onOpenChange={(o) => !o && setAbierta(null)}>
          <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto rounded-2xl">
            <DialogHeader className="text-left">
              <DialogTitle className="font-display pr-6 text-xl">{abierta.nombre}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {abierta.ciudad && <span>{abierta.ciudad}</span>}
                <Link
                  to="/instituciones/$id"
                  params={{ id: String(abierta.id) }}
                  search={{ tab: "horario" }}
                  className="inline-flex items-center gap-1 font-semibold text-primary"
                >
                  Abrir la ficha
                  <ExternalLink className="size-3" />
                </Link>
              </DialogDescription>
            </DialogHeader>
            <HorarioInstitucion idInstitucion={abierta.id} anioInicial={elegido} />
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}

function Pastilla({
  activa,
  onClick,
  cuenta,
  chica,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  cuenta?: number;
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

function Tarjeta({
  f,
  anio,
  turno,
  nombre,
  onAbrir,
}: {
  f: Fila;
  anio: string;
  /** "" = todos. */
  turno: string;
  nombre: (t: number) => string;
  onAbrir: () => void;
}) {
  const { inst, bloques } = f;
  const turnos = [...new Set(bloques.map((b) => b.turno))]
    .filter((t) => !turno || String(t) === turno)
    .sort((a, b) => a - b);
  const sub = [inst.ciudad, inst.facilitador].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-start gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        bloques.length ? "border-border/60" : "border-dashed border-border"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{inst.nombre}</span>
          {!inst.activa && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
              Inactiva
            </span>
          )}
        </span>
        {sub && <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>}

        {bloques.length ? (
          <span className="mt-2 block space-y-1">
            {turnos.map((t) => {
              const del = bloques
                .filter((b) => b.turno === t)
                .sort((a, b) => a.inicio.localeCompare(b.inicio));
              const desde = del[0].inicio;
              const hasta = del.reduce((m, b) => (b.fin > m ? b.fin : m), del[0].fin);
              const total = del.reduce((acc, b) => acc + duracion(b), 0);
              const pisa = del.some((b, i) => del.some((o, j) => j > i && seSuperponen(o, b)));
              return (
                <span key={t} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                  <span className="w-14 shrink-0 font-medium text-muted-foreground">
                    {nombre(t)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {desde} – {hasta}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {del.length} {del.length === 1 ? "bloque" : "bloques"} · {textoDuracion(total)}
                  </span>
                  {pisa && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3" />
                      se pisan
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        ) : (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px]">
            <span className="text-muted-foreground">Sin horario{anio ? ` en ${anio}` : ""}.</span>
            {f.otroAnio && (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <Copy className="size-3" />
                Tiene el de {f.otroAnio} para copiar
              </span>
            )}
          </span>
        )}
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** El modal 32 pedía la institución en un popup: acá, antes de abrir su horario. */
function ElegirInstitucion({
  filas,
  anio,
  onElegir,
  onCerrar,
}: {
  filas: Fila[];
  anio: string;
  onElegir: (inst: InstitucionFila) => void;
  onCerrar: () => void;
}) {
  const [buscar, setBuscar] = useState("");
  const q = normalizar(buscar.trim());
  // Primero las que no tienen horario: son las que se vienen a cargar.
  const lista = filas
    .filter(
      (f) => !q || normalizar(f.inst.nombre).includes(q) || normalizar(f.inst.ciudad).includes(q),
    )
    .sort(
      (a, b) =>
        Number(a.bloques.length > 0) - Number(b.bloques.length > 0) ||
        a.inst.nombre.localeCompare(b.inst.nombre, "es"),
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md flex-col rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">¿De qué institución?</DialogTitle>
          <DialogDescription className="text-xs">
            Primero las que no tienen horario{anio ? ` en ${anio}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <Buscador valor={buscar} onCambio={setBuscar} placeholder="Buscar institución…" />
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {lista.map((f) => (
            <li key={f.inst.id}>
              <button
                type="button"
                onClick={() => onElegir(f.inst)}
                className="tap flex w-full items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-left hover:border-primary/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.inst.nombre}</span>
                  {f.inst.ciudad && (
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {f.inst.ciudad}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    f.bloques.length
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary-soft text-primary"
                  }`}
                >
                  {f.bloques.length ? "Ya tiene" : "Sin horario"}
                </span>
              </button>
            </li>
          ))}
          {!lista.length && (
            <li className="py-8 text-center text-sm text-muted-foreground">
              Ninguna institución coincide.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
