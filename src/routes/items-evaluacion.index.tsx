import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ListTodo, Loader2, Lock, Plus } from "lucide-react";
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
import { textoUsos } from "@/lib/facilitadores";
import {
  eliminarItemEvaluacion,
  guardarItemEvaluacion,
  invalidarItems,
  keysItemsEvaluacion,
  listarItemsEvaluacion,
  type AreaItem,
  type ItemEvaluacion,
} from "@/lib/items-evaluacion";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/items-evaluacion/")({
  head: () => ({
    meta: [
      { title: "Evaluaciones — Juventud con Valores" },
      { name: "description", content: "Los ítems de la evaluación de facilitadores, por área." },
    ],
  }),
  component: ItemsEvaluacionPage,
});

const RUTA = "/items-evaluacion";

/** Sin tildes, mayúsculas ni espacios de más: lo que el backend toma como repetido. */
const clave = (t: string) => normalizar(t.trim().replace(/\s+/g, " "));

/** "en 34 evaluaciones facilitadores" → "34 evaluaciones". */
const cuantas = (it: ItemEvaluacion) => {
  const n = it.usos.reduce((a, u) => a + u.cantidad, 0);
  return n ? `${n} ${n === 1 ? "evaluación" : "evaluaciones"}` : null;
};

type Abierto = { item: ItemEvaluacion } | { nuevo: true; idArea: number | null } | null;

/**
 * Evaluaciones (los ítems): la página 83 de APEX (un IG sobre `EVALUACIONES`)
 * y su modal 84 (Crear Evaluación), que acá es el diálogo de la pantalla con
 * los permisos de la 83. Backend: `backend/evaluaciones.sql`. El ícono es el
 * que ya tenía en el menú (`ListTodo`).
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Agrupados por área**, con pastillas por área y su cantidad, y buscador.
 *   El IG mezclaba todo en una grilla.
 * - Cada ítem dice **en cuántas evaluaciones se usó**. En uso no se borra ni
 *   cambia de área (las evaluaciones viejas quedarían con otra área); el texto
 *   sí se corrige.
 * - "Agregar" en cada área ya la trae elegida, y **"Agregar y seguir"** carga
 *   varios ítems de corrido sin cerrar el diálogo.
 * - El mismo ítem dos veces en un área se avisa antes de guardar.
 */
function ItemsEvaluacionPage() {
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA, "insertar");
  const [buscar, setBuscar] = useState("");
  /** 0 = todas. */
  const [areaSel, setAreaSel] = useState(0);
  const [abierto, setAbierto] = useState<Abierto>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysItemsEvaluacion.todo,
    queryFn: listarItemsEvaluacion,
  });
  const items = data?.items ?? [];
  const areas = data?.areas ?? [];
  const sel = areas.some((a) => a.id === areaSel) ? areaSel : 0;

  const q = normalizar(buscar.trim());
  const filas = items.filter(
    (x) => (!sel || x.idArea === sel) && (!q || normalizar(x.descripcion).includes(q)),
  );
  // Las áreas en el orden del backend (alfabético); con buscador o filtro, solo las que tienen.
  const grupos = areas
    .map((a) => ({ area: a, filas: filas.filter((x) => x.idArea === a.id) }))
    .filter((g) => (sel ? g.area.id === sel : g.filas.length || (!q && puedeAgregar)));
  const sinArea = filas.filter((x) => !areas.some((a) => a.id === x.idArea));

  const nuevo = (idArea: number | null = sel || null) => setAbierto({ nuevo: true, idArea });

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Evaluaciones
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Los ítems que se califican en la evaluación de facilitadores, por área.
            </p>
          </div>
          {puedeAgregar && areas.length > 0 && (
            <button
              type="button"
              onClick={() => nuevo()}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo ítem</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudieron cargar los ítems de evaluación" />
        ) : !areas.length ? (
          <div className="py-12 text-center">
            <ListTodo className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Todavía no hay áreas de evaluación: cada ítem va en una.
            </p>
            <Link
              to="/areas-evaluacion"
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
            >
              Cargar las áreas
              <ChevronRight className="size-4" />
            </Link>
          </div>
        ) : (
          <>
            {areas.length > 1 && (
              <div
                role="tablist"
                aria-label="Filtrar por área"
                className="mb-3 flex flex-wrap gap-2"
              >
                {[{ id: 0, descripcion: "Todas" }, ...areas].map((a) => {
                  const activo = sel === a.id;
                  const n = a.id ? items.filter((x) => x.idArea === a.id).length : items.length;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="tab"
                      aria-selected={activo}
                      onClick={() => setAreaSel(a.id)}
                      className={`tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                        activo
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {a.descripcion}
                      <span
                        className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                          activo ? "bg-white/20" : "bg-muted"
                        }`}
                      >
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {items.length > 6 && (
              <Buscador valor={buscar} onCambio={setBuscar} placeholder="Buscar un ítem…" />
            )}

            {!grupos.length && !sinArea.length ? (
              <div className="py-12 text-center">
                <ListTodo className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {q ? "Ningún ítem coincide con la búsqueda." : "Todavía no hay ítems."}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {grupos.map((g) => (
                  <Grupo
                    key={g.area.id}
                    titulo={g.area.descripcion}
                    filas={g.filas}
                    onAgregar={puedeAgregar ? () => nuevo(g.area.id) : undefined}
                    onAbrir={(item) => setAbierto({ item })}
                  />
                ))}
                {sinArea.length > 0 && (
                  <Grupo
                    titulo="Sin área"
                    filas={sinArea}
                    onAbrir={(item) => setAbierto({ item })}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {abierto != null && (
        <Editor
          key={"item" in abierto ? abierto.item.id : `nuevo-${abierto.idArea ?? ""}`}
          item={"item" in abierto ? abierto.item : null}
          areaInicial={"item" in abierto ? abierto.item.idArea : abierto.idArea}
          areas={areas}
          todos={items}
          largo={data?.largo ?? 255}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Grupo({
  titulo,
  filas,
  onAgregar,
  onAbrir,
}: {
  titulo: string;
  filas: ItemEvaluacion[];
  onAgregar?: () => void;
  onAbrir: (item: ItemEvaluacion) => void;
}) {
  return (
    <section aria-label={titulo}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display min-w-0 truncate text-base font-bold">
          {titulo}
          <span className="ml-2 text-xs font-semibold text-muted-foreground tabular-nums">
            {filas.length} {filas.length === 1 ? "ítem" : "ítems"}
          </span>
        </h2>
        {onAgregar && (
          <button
            type="button"
            onClick={onAgregar}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-primary hover:bg-primary-soft"
          >
            <Plus className="size-3.5" />
            Agregar
          </button>
        )}
      </div>
      {filas.length ? (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {filas.map((x, i) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => onAbrir(x)}
                className="tap flex h-full w-full items-start gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-[12px] font-bold text-primary tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-3 text-sm leading-snug font-medium">
                    {x.descripcion}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {cuantas(x) ? `Usado en ${cuantas(x)}` : "Sin usar todavía"}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border/80 px-4 py-4 text-center text-[12.5px] text-muted-foreground">
          Sin ítems en esta área.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición (el modal 84)                                               */
/* -------------------------------------------------------------------------- */

function Editor({
  item,
  areaInicial,
  areas,
  todos,
  largo,
  onCerrar,
}: {
  item: ItemEvaluacion | null;
  areaInicial: number | null;
  areas: AreaItem[];
  todos: ItemEvaluacion[];
  largo: number;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = item == null;
  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");

  // Con una sola área, se propone esa.
  const [idArea, setIdArea] = useState<number | null>(
    areaInicial ?? (areas.length === 1 ? areas[0].id : null),
  );
  const [descripcion, setDescripcion] = useState(item?.descripcion ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  /** Cuántos se agregaron con "Agregar y seguir" sin cerrar. */
  const [agregados, setAgregados] = useState(0);

  const desc = descripcion.trim().replace(/\s+/g, " ");
  const enUso = !!item?.usos.length;
  const cambiaArea = !nuevo && idArea !== item.idArea;
  const repetido =
    idArea != null && desc
      ? todos.find(
          (x) => x.id !== item?.id && x.idArea === idArea && clave(x.descripcion) === clave(desc),
        )
      : undefined;
  const sinCambios = !nuevo && !cambiaArea && desc === item.descripcion.trim().replace(/\s+/g, " ");
  const listo =
    puedeGuardar &&
    idArea != null &&
    !!desc &&
    desc.length <= largo &&
    !repetido &&
    !sinCambios &&
    !(enUso && cambiaArea);

  const guardar = useMutation({
    mutationFn: (_seguir: boolean) =>
      guardarItemEvaluacion(item?.id ?? null, { id_area: idArea!, descripcion: desc }),
    onSuccess: (_id, seguir) => {
      invalidarItems(qc);
      if (seguir) {
        // Queda abierto en la misma área, listo para el siguiente.
        toast.success("Ítem agregado");
        setAgregados((n) => n + 1);
        setDescripcion("");
        return;
      }
      toast.success(nuevo ? "Ítem agregado" : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarItemEvaluacion(item!.id),
    onSuccess: () => {
      invalidarItems(qc);
      toast.success("Ítem eliminado");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const areaActual = areas.find((a) => a.id === item?.idArea);

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo ítem" : "Ítem de evaluación"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? agregados
                ? `${agregados} ${agregados === 1 ? "agregado" : "agregados"}. Seguí con el próximo.`
                : "Lo que se califica en la evaluación de facilitadores."
              : enUso
                ? `Usado en ${cuantas(item)}.`
                : "Todavía no se usó en ninguna evaluación."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate(false);
          }}
          className="space-y-4"
        >
          <fieldset disabled={!puedeGuardar || ocupado} className="space-y-4">
            <div>
              <Pastillas
                etiqueta="Área"
                req
                opciones={areas.map((a) => ({ valor: String(a.id), mostrar: a.descripcion }))}
                valor={idArea == null ? "" : String(idArea)}
                onCambio={(v) => setIdArea(v ? Number(v) : null)}
              />
              {enUso && cambiaArea && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                  <Lock className="mt-px size-3 shrink-0" />
                  No se puede mover: ya se usó en evaluaciones de “{areaActual?.descripcion}”.
                </p>
              )}
            </div>
            <div>
              <Texto
                etiqueta="Descripción"
                req
                multilinea
                largo={largo}
                valor={descripcion}
                onCambio={setDescripcion}
                placeholder="Ej.: Llega a horario a la institución"
                ayuda={`${desc.length}/${largo}`}
              />
              {repetido && (
                <p className="mt-1 text-xs text-destructive">Ese ítem ya está en el área.</p>
              )}
            </div>
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} ítems de evaluación.`}
            />
          )}

          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar: ya se usó en evaluaciones. El texto sí se puede corregir.
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
            {puedeGuardar && nuevo && (
              <button
                type="button"
                disabled={ocupado || !listo}
                onClick={() => guardar.mutate(true)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-primary/40 text-sm font-semibold text-primary disabled:opacity-50"
              >
                Agregar y seguir
              </button>
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
