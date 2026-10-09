import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, IdCard, Loader2, Lock, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApiPersonas, Autoridad, DatosPersona, Persona } from "@/lib/autoridades";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

type Filtro = "todos" | "activos" | "sin";

/** Solo los dígitos: "1.234.567" y "1234567" son la misma CI. */
const digitos = (v: string) => v.replace(/\D/g, "");

/** "María José Benítez" → "MB". */
const iniciales = (nombre: string) => {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};

/** Los nombres de las instituciones, sin repetir, en orden. */
const nombres = (filas: Autoridad[]) =>
  [...new Set(filas.map((f) => f.institucion).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );

/**
 * La pantalla de las PERSONAS de una tabla de autoridades: Directores (página
 * 34 de APEX, con su modal 35) y, cuando se haga, Coordinadores (45 y 46). Las
 * dos son un IG de nombre, teléfono y CI con un modal de alta: lo que cambia
 * viene en `api` (ver {@link ApiPersonas}), como en `<CatalogoNombre>`.
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Cada tarjeta dice qué institución dirige hoy** (las filas activas de
 *   su tabla de instituciones), o en cuántas figuró antes, o que no figura en
 *   ninguna. APEX mostraba solo nombre, teléfono y CI.
 * - Pastillas **Todos / Activos / Sin institución** con su cuenta: "Sin
 *   institución" son las que se pueden borrar, para limpiar la lista.
 * - **Buscador** por nombre, CI (con o sin puntos), teléfono o institución.
 * - El diálogo muestra **dónde figura**, con cargo, período y estado, y lleva
 *   a la pestaña Autoridades de esa institución.
 * - **CI repetida**: se avisa antes de guardar (el backend la rechaza con
 *   409). Un nombre repetido solo se avisa: puede haber homónimos.
 * - Una persona que figura en alguna institución no se borra: el diálogo lo
 *   explica en vez de dejar que falle.
 */
export function PersonasAutoridad({ api }: { api: ApiPersonas }) {
  const { puedeRuta } = usePermisos();
  const t = api.textos;
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  /** `null` cerrado, `"nuevo"` alta, o la persona que se abre. */
  const [abierto, setAbierto] = useState<Persona | "nuevo" | null>(null);

  const personas = useQuery({ queryKey: api.key, queryFn: api.listar });
  const asignaciones = useQuery({
    queryKey: api.asignaciones.key,
    queryFn: api.asignaciones.listar,
  });

  // Alta: también quien puede modificar instituciones (el modal colgaba de la
  // ficha), igual que el backend.
  const puedeAgregar = puedeRuta(api.ruta, "insertar") || puedeRuta("/instituciones", "actualizar");

  const items = personas.data ?? [];
  const porPersona = new Map<number, Autoridad[]>();
  for (const a of asignaciones.data ?? []) {
    if (a.idPersona == null) continue;
    const l = porPersona.get(a.idPersona);
    if (l) l.push(a);
    else porPersona.set(a.idPersona, [a]);
  }
  const filasDe = (p: Persona) => porPersona.get(p.id) ?? [];
  const esActivo = (p: Persona) => filasDe(p).some((f) => f.activo);

  const activos = items.filter(esActivo).length;
  const sin = items.filter((p) => !p.instituciones).length;
  const cuentas: Record<Filtro, number> = { todos: items.length, activos, sin };
  const textosFiltro: Record<Filtro, string> = {
    todos: "Todos",
    activos: t.femenino ? "Activas" : "Activos",
    sin: "Sin institución",
  };

  const q = normalizar(buscar.trim());
  const qDigitos = digitos(buscar);
  const filas = items.filter(
    (p) =>
      (filtro === "todos" || (filtro === "activos" ? esActivo(p) : !p.instituciones)) &&
      (!q ||
        normalizar(p.nombre).includes(q) ||
        (qDigitos.length >= 3 &&
          (digitos(p.ci).includes(qDigitos) || digitos(p.telefono).includes(qDigitos))) ||
        filasDe(p).some((f) => normalizar(f.institucion).includes(q))),
  );

  const cargando = personas.isLoading || asignaciones.isLoading;
  const error = personas.error ?? asignaciones.error;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              {t.titulo}
              {personas.data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Las personas; qué institución {t.verbo.toLowerCase()} cada una se carga en su ficha.
            </p>
          </div>
          {puedeAgregar && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">
                {t.femenino ? "Nueva" : "Nuevo"} {t.singular}
              </span>
              <span className="sm:hidden">{t.femenino ? "Nueva" : "Nuevo"}</span>
            </button>
          )}
        </div>

        {!cargando && !error && (
          <div role="tablist" aria-label="Filtrar" className="mb-3 flex flex-wrap gap-2">
            {(["todos", "activos", "sin"] as const).map((f) => {
              const activo = filtro === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setFiltro(f)}
                  className={`tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                    activo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {textosFiltro[f]}
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      activo ? "bg-white/20" : "bg-muted"
                    }`}
                  >
                    {cuentas[f]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {items.length > 6 && (
          <Buscador
            valor={buscar}
            onCambio={setBuscar}
            placeholder="Buscar por nombre, CI, teléfono o institución…"
          />
        )}

        {cargando ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto={`No se pudo cargar la lista de ${t.titulo.toLowerCase()}`} />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <api.icono className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q
                ? "Nadie coincide con la búsqueda."
                : items.length
                  ? "No hay nadie en este filtro."
                  : `Todavía no hay ${t.titulo.toLowerCase()}.`}
            </p>
            {!q && !items.length && puedeAgregar && (
              <button
                type="button"
                onClick={() => setAbierto("nuevo")}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar {t.femenino ? "la primera" : "el primero"}
              </button>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((p) => (
              <li key={p.id}>
                <Tarjeta p={p} filas={filasDe(p)} verbo={t.verbo} onAbrir={() => setAbierto(p)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierto != null && (
        <EditorPersona
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          api={api}
          persona={abierto === "nuevo" ? null : abierto}
          filas={abierto === "nuevo" ? [] : filasDe(abierto)}
          todas={items}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Tarjeta({
  p,
  filas,
  verbo,
  onAbrir,
}: {
  p: Persona;
  filas: Autoridad[];
  verbo: string;
  onAbrir: () => void;
}) {
  const hoy = nombres(filas.filter((f) => f.activo));
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        p.instituciones ? "border-border/60" : "border-dashed border-border"
      }`}
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${
          hoy.length ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {iniciales(p.nombre) || <IdCard className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{p.nombre}</span>
        {(p.ci || p.telefono) && (
          <span className="flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground tabular-nums">
            {p.ci && (
              <span className="inline-flex items-center gap-1">
                <IdCard className="size-3" />
                {p.ci}
              </span>
            )}
            {p.telefono && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />
                {p.telefono}
              </span>
            )}
          </span>
        )}
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {hoy.length ? (
            <>
              {verbo}: <span className="font-medium text-foreground">{hoy.join(", ")}</span>
            </>
          ) : p.instituciones ? (
            `Antes en ${p.instituciones} ${p.instituciones === 1 ? "institución" : "instituciones"}`
          ) : (
            "Sin institución"
          )}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** El modal 35 (o 46) de APEX: alta, edición y baja de la persona. */
function EditorPersona({
  api,
  persona,
  filas,
  todas,
  onCerrar,
}: {
  api: ApiPersonas;
  persona: Persona | null;
  /** Dónde figura (vacío en un alta). */
  filas: Autoridad[];
  todas: Persona[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const t = api.textos;
  const nuevo = persona == null;
  const inicial: DatosPersona = {
    nombre_apellido: persona?.nombre ?? "",
    nro_telefono: persona?.telefono ?? "",
    nro_ci: persona?.ci ?? "",
  };
  const [d, setD] = useState<DatosPersona>(inicial);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const set = <K extends keyof DatosPersona>(k: K, v: DatosPersona[K]) =>
    setD((x) => ({ ...x, [k]: v }));

  const puedeGuardar = nuevo
    ? puedeRuta(api.ruta, "insertar") || puedeRuta("/instituciones", "actualizar")
    : puedeRuta(api.ruta, "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(api.ruta, "borrar");
  const enUso = !!persona?.instituciones;

  const limpio = (v: string) => v.trim().replace(/\s+/g, " ");
  const nombre = limpio(d.nombre_apellido);
  const otros = todas.filter((x) => x.id !== persona?.id);
  // La CI repetida la rechaza el backend (409): se frena acá. El nombre solo se avisa.
  const ciRepetida =
    digitos(d.nro_ci).length >= 3
      ? otros.find((x) => digitos(x.ci) === digitos(d.nro_ci))
      : undefined;
  const nombreRepetido = nombre
    ? otros.find((x) => normalizar(x.nombre) === normalizar(nombre))
    : undefined;
  const sinCambios =
    !nuevo &&
    nombre === inicial.nombre_apellido &&
    limpio(d.nro_ci) === inicial.nro_ci &&
    limpio(d.nro_telefono) === inicial.nro_telefono;
  const listo = puedeGuardar && !!nombre && !ciRepetida && !sinCambios;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: api.key });
    qc.invalidateQueries({ queryKey: api.asignaciones.key });
    for (const k of api.relacionadas) qc.invalidateQueries({ queryKey: k });
  };

  const guardar = useMutation({
    mutationFn: () =>
      api.guardar(persona?.id ?? null, {
        nombre_apellido: nombre,
        nro_telefono: limpio(d.nro_telefono),
        nro_ci: limpio(d.nro_ci),
      }),
    onSuccess: () => {
      invalidar();
      toast.success(nuevo ? `"${nombre}" agregado` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => api.eliminar(persona!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`"${persona!.nombre}" eliminado`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  // Las activas primero; después por período, el más nuevo arriba.
  const ordenadas = [...filas].sort(
    (a, b) => Number(b.activo) - Number(a.activo) || b.periodo.localeCompare(a.periodo),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? `${t.femenino ? "Nueva" : "Nuevo"} ${t.singular}` : persona.nombre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? `La persona. Qué institución ${t.verbo.toLowerCase()} se carga en la pestaña Autoridades de la institución.`
              : enUso
                ? `Figura en ${persona.instituciones} ${persona.instituciones === 1 ? "institución" : "instituciones"}.`
                : "No figura en ninguna institución."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate();
          }}
          className="space-y-4"
        >
          <fieldset disabled={!puedeGuardar || ocupado} className="space-y-4">
            <div>
              <Texto
                etiqueta="Nombre y apellido"
                req
                largo={200}
                valor={d.nombre_apellido}
                onCambio={(v) => set("nombre_apellido", v)}
                placeholder="Ej.: María González"
              />
              {nombreRepetido && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Ya hay alguien con ese nombre
                  {nombreRepetido.ci ? ` (CI ${nombreRepetido.ci})` : ""}. ¿Es otra persona?
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Texto
                  etiqueta="Nro. CI"
                  largo={100}
                  inputMode="numeric"
                  valor={d.nro_ci}
                  onCambio={(v) => set("nro_ci", v)}
                />
                {ciRepetida && (
                  <p className="mt-1 text-xs text-destructive">
                    Esa CI ya es de {ciRepetida.nombre}.
                  </p>
                )}
              </div>
              <Texto
                etiqueta="Nro. teléfono"
                largo={200}
                inputMode="tel"
                valor={d.nro_telefono}
                onCambio={(v) => set("nro_telefono", v)}
              />
            </div>
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} ${t.titulo.toLowerCase()}.`}
            />
          )}

          {ordenadas.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Dónde figura</p>
              <ul className="space-y-1.5">
                {ordenadas.map((f) => (
                  <li key={f.id}>
                    <Link
                      to="/instituciones/$id"
                      params={{ id: String(f.idInstitucion) }}
                      search={{ tab: "autoridades" }}
                      className="tap flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2 hover:border-primary/40"
                    >
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">
                          {f.institucion || `Institución ${f.idInstitucion}`}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {[f.rol, f.periodo, f.nivel, f.turno].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ${
                          f.activo
                            ? "bg-primary-soft text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {f.activo ? "Activo" : f.estado || "Inactivo"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              <span>
                No se puede eliminar: figura en alguna institución. Para borrarlo, primero hay que
                quitarlo de la pestaña Autoridades de cada una.
              </span>
            </p>
          )}

          <div className="flex gap-2">
            {puedeBorrar && !enUso && (
              <BotonBorrar
                confirmar={confirmarBorrado}
                pendiente={borrar.isPending}
                deshabilitado={ocupado}
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
              />
            )}
            {puedeGuardar && (
              <button
                type="submit"
                disabled={ocupado || !listo}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
              >
                {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
                {nuevo ? "Agregar" : sinCambios ? "Sin cambios" : "Guardar cambios"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
