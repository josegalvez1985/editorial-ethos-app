import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, IdCard, Loader2, Lock, Phone, Plus, Presentation } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Pastillas, Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  eliminarDocente,
  guardarDocente,
  keysDocentes,
  listarDocentes,
  type DatosDocente,
  type Docente,
} from "@/lib/docentes";
import { textoUsos } from "@/lib/facilitadores";
import { usePermisos } from "@/lib/permisos";
import { keysPreHorarios } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/docentes/")({
  head: () => ({
    meta: [
      { title: "Docentes — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de docentes." },
    ],
  }),
  component: DocentesPage,
});

const RUTA = "/docentes";

type Filtro = "activos" | "inactivos" | "todos";

/** Solo los dígitos: "1.234.567" y "1234567" son la misma CI. */
const digitos = (v: string) => v.replace(/\D/g, "");

/** "María José Benítez" → "MB". */
const iniciales = (nombre: string) => {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};

/**
 * Docentes: la página 41 de APEX (un IG sobre `DOCENTES`) y su modal 42 (Crear
 * Docente), que acá es el diálogo de la pantalla con los permisos de la 41.
 * Backend: `backend/docentes.sql`. El ícono es el que ya tenía en el menú
 * (`Presentation`): no se cambia.
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Activos primero**: pastillas Activos / Inactivos / Todos con su cuenta;
 *   arranca en Activos, que son los que se ofrecen en Pre-horarios.
 * - **Buscador** por nombre, CI (con o sin puntos) o teléfono.
 * - **Cada tarjeta dice dónde se usa** ("en 12 pre horarios"). Uno en uso no
 *   se borra: el diálogo ofrece marcarlo inactivo en su lugar.
 * - **Avisa de una CI o un nombre repetido** antes de guardar, sin
 *   impedirlo (APEX no lo controlaba y puede haber datos viejos así).
 * - Guardar refresca también la lista de docentes de Pre-horarios.
 */
function DocentesPage() {
  const { puedeRuta } = usePermisos();
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("activos");
  /** `null` cerrado, `"nuevo"` alta, o el docente que se abre. */
  const [abierto, setAbierto] = useState<Docente | "nuevo" | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysDocentes.todo,
    queryFn: listarDocentes,
  });

  const items = data?.items ?? [];
  const activos = items.filter((d) => d.activo).length;
  const cuentas: Record<Filtro, number> = {
    activos,
    inactivos: items.length - activos,
    todos: items.length,
  };
  const q = normalizar(buscar.trim());
  const qDigitos = digitos(buscar);
  const filas = items.filter(
    (d) =>
      (filtro === "todos" || d.activo === (filtro === "activos")) &&
      (!q ||
        normalizar(d.nombre).includes(q) ||
        (qDigitos.length >= 3 &&
          (digitos(d.ci).includes(qDigitos) || digitos(d.telefono).includes(qDigitos)))),
  );

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Docentes
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Los docentes que se eligen en pre-horarios y postulaciones.
            </p>
          </div>
          {puedeRuta(RUTA, "insertar") && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo docente</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {data && (
          <div role="tablist" aria-label="Filtrar por estado" className="mb-3 flex flex-wrap gap-2">
            {(["activos", "inactivos", "todos"] as const).map((f) => {
              const activo = filtro === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setFiltro(f)}
                  className={`tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold capitalize ${
                    activo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
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
            placeholder="Buscar por nombre, CI o teléfono…"
          />
        )}

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudo cargar la lista de docentes" />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <Presentation className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q
                ? "Ningún docente coincide con la búsqueda."
                : items.length
                  ? `No hay docentes ${filtro}.`
                  : "Todavía no hay docentes."}
            </p>
            {!q && !items.length && puedeRuta(RUTA, "insertar") && (
              <button
                type="button"
                onClick={() => setAbierto("nuevo")}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar el primero
              </button>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((d) => (
              <li key={d.id}>
                <Tarjeta d={d} onAbrir={() => setAbierto(d)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierto != null && (
        <EditorDocente
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          docente={abierto === "nuevo" ? null : abierto}
          todos={items}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Tarjeta({ d, onAbrir }: { d: Docente; onAbrir: () => void }) {
  const usos = textoUsos(d.usos);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        d.activo ? "border-border/60" : "border-dashed border-border"
      }`}
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${
          d.activo ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {iniciales(d.nombre) || <Presentation className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-sm font-semibold ${d.activo ? "" : "text-muted-foreground"}`}
          >
            {d.nombre}
          </span>
          {!d.activo && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
              Inactivo
            </span>
          )}
        </span>
        {(d.ci || d.telefono) && (
          <span className="flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground tabular-nums">
            {d.ci && (
              <span className="inline-flex items-center gap-1">
                <IdCard className="size-3" />
                {d.ci}
              </span>
            )}
            {d.telefono && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />
                {d.telefono}
              </span>
            )}
          </span>
        )}
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {usos ? `Se usa ${usos}` : "Sin uso"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** El modal 42 de APEX (Crear Docente): alta, edición y baja. */
function EditorDocente({
  docente,
  todos,
  onCerrar,
}: {
  docente: Docente | null;
  todos: Docente[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = docente == null;
  const inicial: DatosDocente = {
    nombre: docente?.nombre ?? "",
    ci: docente?.ci ?? "",
    telefono: docente?.telefono ?? "",
    // Como la 42: un docente nuevo arranca activo.
    activo: docente?.activo ?? true,
  };
  const [d, setD] = useState<DatosDocente>(inicial);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const set = <K extends keyof DatosDocente>(k: K, v: DatosDocente[K]) =>
    setD((x) => ({ ...x, [k]: v }));

  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");
  const enUso = !!docente?.usos.length;

  const limpio = (v: string) => v.trim().replace(/\s+/g, " ");
  const nombre = limpio(d.nombre);
  const otros = todos.filter((x) => x.id !== docente?.id);
  // Avisos, no bloqueos: APEX no lo controlaba.
  const ciRepetida =
    digitos(d.ci).length >= 3 ? otros.find((x) => digitos(x.ci) === digitos(d.ci)) : undefined;
  const nombreRepetido = nombre
    ? otros.find((x) => normalizar(x.nombre) === normalizar(nombre))
    : undefined;
  const sinCambios =
    !nuevo &&
    nombre === inicial.nombre &&
    limpio(d.ci) === inicial.ci &&
    limpio(d.telefono) === inicial.telefono &&
    d.activo === inicial.activo;
  const listo = puedeGuardar && !!nombre && !sinCambios;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysDocentes.todo });
    // La lista de docentes de Pre-horarios y Postulaciones.
    qc.invalidateQueries({ queryKey: keysPreHorarios.opciones });
  };

  const guardar = useMutation({
    mutationFn: () =>
      guardarDocente(docente?.id ?? null, {
        nombre,
        ci: limpio(d.ci),
        telefono: limpio(d.telefono),
        activo: d.activo,
      }),
    onSuccess: () => {
      invalidar();
      toast.success(nuevo ? `"${nombre}" agregado` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarDocente(docente!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`"${docente!.nombre}" eliminado`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo docente" : docente.nombre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? "Se suma a la lista de docentes de los pre-horarios."
              : enUso
                ? `Se usa ${textoUsos(docente.usos)}.`
                : "Todavía no se usa en ningún pre-horario ni postulación."}
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
                largo={500}
                valor={d.nombre}
                onCambio={(v) => set("nombre", v)}
                placeholder="Ej.: María González"
              />
              {nombreRepetido && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Ya hay un docente con ese nombre
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
                  valor={d.ci}
                  onCambio={(v) => set("ci", v)}
                />
                {ciRepetida && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Esa CI ya es de {ciRepetida.nombre}.
                  </p>
                )}
              </div>
              <Texto
                etiqueta="Nro. teléfono"
                largo={100}
                inputMode="tel"
                valor={d.telefono}
                onCambio={(v) => set("telefono", v)}
                ayuda="Es el que se propone en el pre-horario al elegirlo."
              />
            </div>
            <Pastillas
              etiqueta="Activo"
              req
              opciones={[
                { valor: "SI", mostrar: "Activo" },
                { valor: "NO", mostrar: "Inactivo" },
              ]}
              valor={d.activo ? "SI" : "NO"}
              onCambio={(v) => set("activo", v === "SI")}
            />
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} docentes.`}
            />
          )}

          {/* En uso no se borra: se ofrece lo que sí se puede hacer. */}
          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              <span>
                No se puede eliminar: se usa {textoUsos(docente!.usos)}.
                {d.activo && puedeGuardar && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => set("activo", false)}
                      className="font-semibold text-primary underline"
                    >
                      Marcalo inactivo
                    </button>{" "}
                    y deja de ofrecerse.
                  </>
                )}
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
