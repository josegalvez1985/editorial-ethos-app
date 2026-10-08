import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Lock, Plus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { PickerModal } from "@/components/picker-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Opcion } from "@/lib/evaluaciones";
import { usePermisos } from "@/lib/permisos";
import { campo, normalizar } from "@/lib/utils";

/**
 * Las tablas de la forma (ID, NOMBRE) del Núcleo de Datos —Países— y las de
 * la forma (ID, PADRE, NOMBRE) —Departamentos, dentro de un país— comparten
 * esta PANTALLA, no el backend: cada una tiene su script y su `lib/` (por
 * ejemplo `backend/paises.sql` y `lib/paises.ts`), y le pasa acá sus
 * funciones en {@link ApiCatalogo}. Decidido el 08/10/2026: un script por
 * tabla, para que no haya un paquete genérico que confunda.
 */

export type Uso = { tabla: string; cantidad: number };

export type ItemCatalogo = {
  id: number;
  nombre: string;
  /** El registro del que depende (el país de un departamento). Solo con `padre`. */
  padre?: { id: number; nombre: string };
  /** Tablas que lo referencian (por FK), con cuántas filas. Vacío = se puede borrar. */
  usos: Uso[];
};

export type ListaCatalogo = {
  items: ItemCatalogo[];
  /** Largo máximo del nombre, según el backend. */
  largo: number;
  /** Las tablas que pueden usarlo, aunque hoy ninguna fila lo haga. */
  tablas: string[];
};

/** Lo que cada tabla le pasa a la pantalla: de dónde lee y cómo guarda. */
export type ApiCatalogo = {
  queryKey: readonly unknown[];
  listar: () => Promise<ListaCatalogo>;
  /** Alta (`id` null) o modificación. Devuelve el id. */
  guardar: (id: number | null, datos: { nombre: string; padreId?: number }) => Promise<number>;
  eliminar: (id: number) => Promise<void>;
};

/**
 * La tabla de la que depende cada fila: el país de un departamento. Se lee con
 * la `api` de esa tabla (la misma caché que su propia pantalla).
 */
export type PadreCatalogo = {
  etiqueta: string;
  plural: string;
  api: ApiCatalogo;
};

const totalUsos = (i: ItemCatalogo) => i.usos.reduce((s, u) => s + u.cantidad, 0);

/** "CIUDADES_BARRIOS" → "ciudades barrios": para "en 3 ciudades barrios". */
const nombreTabla = (tabla: string) => tabla.toLowerCase().replace(/_/g, " ");

/** "en 17 departamentos y 3 facilitadores", o `null` si no se usa. */
function textoUsos(i: ItemCatalogo): string | null {
  if (!i.usos.length) return null;
  const partes = i.usos.map((u) => `${u.cantidad} ${nombreTabla(u.tabla)}`);
  const ultimo = partes.pop();
  return `en ${partes.length ? `${partes.join(", ")} y ${ultimo}` : ultimo}`;
}

/**
 * Cómo se nombra el catálogo en pantalla. Género incluido: "Nuevo país" pero
 * "Nueva materia", "eliminado" o "eliminada".
 */
export type TextosCatalogo = {
  titulo: string;
  descripcion: string;
  singular: string;
  plural: string;
  femenino?: boolean;
  /** Para el placeholder del campo: "Ej.: Paraguay". */
  ejemplo: string;
};

/** Los padres que aparecen en la lista, con cuántas filas tiene cada uno. */
function padresDe(items: ItemCatalogo[]) {
  const m = new Map<number, { id: number; nombre: string; cantidad: number }>();
  for (const i of items) {
    if (!i.padre) continue;
    const p = m.get(i.padre.id) ?? { ...i.padre, cantidad: 0 };
    p.cantidad++;
    m.set(p.id, p);
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * La pantalla entera de un catálogo: el listado de APEX y su modal de
 * crear/editar/borrar, en una.
 *
 * - **Tarjetas en grilla**, 1/2/3 columnas, con buscador (sin tildes ni
 *   mayúsculas) a partir de 7 filas y el total en el encabezado.
 * - **Cada tarjeta dice dónde se usa** ("en 17 ciudades"), que es lo que
 *   decide si se puede borrar. Lo sabe el backend por las FK.
 * - **Alta y edición en un diálogo** sobre la lista, sin perder el lugar.
 * - **Avisa antes de guardar un repetido** ("Paraguay" y "paraguay" son el
 *   mismo), en vez de dejar que responda el backend.
 * - **Los botones siguen los permisos** de la página en `ROLES_PAGINAS`: sin
 *   insertar no hay "Nuevo", y la ficha queda de solo lectura sin actualizar.
 *
 * Con `padre` (Departamentos: el país), además:
 *
 * - **Filtro por padre** en pastillas, con cuántos tiene cada uno, si hay más
 *   de uno; y la lista **agrupada por padre** cuando no se filtra.
 * - **El padre se elige en el diálogo** con un selector con buscador. Arranca
 *   en el padre del filtro, o en el único, o en el que más filas tiene: el
 *   caso común (todo en Paraguay) es cero toques.
 * - El repetido se mide **dentro del mismo padre**: dos países pueden tener un
 *   departamento con el mismo nombre.
 */
export function CatalogoNombre({
  api,
  ruta,
  icon: Icon,
  textos: t,
  padre,
}: {
  api: ApiCatalogo;
  /** La ruta de la pantalla: de ella salen los permisos. */
  ruta: string;
  icon: LucideIcon;
  textos: TextosCatalogo;
  padre?: PadreCatalogo;
}) {
  const { puedeRuta } = usePermisos();
  const [buscar, setBuscar] = useState("");
  const [filtroPadre, setFiltroPadre] = useState<number | null>(null);
  /** `null` cerrado, `"nuevo"` alta, o la fila que se abre. */
  const [abierto, setAbierto] = useState<ItemCatalogo | "nuevo" | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: api.queryKey,
    queryFn: api.listar,
  });

  const items = data?.items ?? [];
  const padres = padre ? padresDe(items) : [];
  const conFiltro = padres.length > 1;
  const q = normalizar(buscar.trim());
  const filas = items.filter(
    (i) =>
      (filtroPadre == null || i.padre?.id === filtroPadre) &&
      (!q || normalizar(i.nombre).includes(q)),
  );
  // Agrupado por padre solo si hay más de uno y no se eligió ninguno.
  const grupos =
    conFiltro && filtroPadre == null
      ? padres
          .map((p) => ({ padre: p, filas: filas.filter((i) => i.padre?.id === p.id) }))
          .filter((g) => g.filas.length)
      : [{ padre: null, filas }];
  const nuevo = t.femenino ? "Nueva" : "Nuevo";

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              {t.titulo}
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">{t.descripcion}</p>
          </div>
          {puedeRuta(ruta, "insertar") && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">
                {nuevo} {t.singular}
              </span>
              <span className="sm:hidden">{nuevo}</span>
            </button>
          )}
        </div>

        {/*
          Las pastillas bajan de línea cuando no entran (08/10/2026). Antes era
          una fila con scroll horizontal: con los 18 departamentos de Ciudades,
          en escritorio no había cómo moverla.
        */}
        {conFiltro && (
          <div
            role="tablist"
            aria-label={`Filtrar por ${padre?.etiqueta.toLowerCase()}`}
            className="mb-3 flex flex-wrap gap-2"
          >
            {[
              { id: null as number | null, nombre: "Todos", cantidad: items.length },
              ...padres,
            ].map((p) => {
              const activo = filtroPadre === p.id;
              return (
                <button
                  key={p.id ?? "todos"}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setFiltroPadre(p.id)}
                  className={`tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                    activo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.nombre}
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      activo ? "bg-white/20" : "bg-muted"
                    }`}
                  >
                    {p.cantidad}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* El buscador aparece recién cuando hay algo que buscar. */}
        {items.length > 6 && (
          <Buscador valor={buscar} onCambio={setBuscar} placeholder={`Buscar ${t.singular}…`} />
        )}

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto={`No se pudo cargar la lista de ${t.plural}`} />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <Icon className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q
                ? `${t.femenino ? "Ninguna" : "Ningún"} ${t.singular} coincide con la búsqueda.`
                : `Todavía no hay ${t.plural}.`}
            </p>
            {!q && puedeRuta(ruta, "insertar") && (
              <button
                type="button"
                onClick={() => setAbierto("nuevo")}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                {t.femenino ? "Cargar la primera" : "Cargar el primero"}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => (
              <section key={g.padre?.id ?? "todos"}>
                {g.padre && (
                  <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {g.padre.nombre}
                    <span className="tabular-nums">· {g.filas.length}</span>
                  </h2>
                )}
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {g.filas.map((i) => {
                    const usos = textoUsos(i);
                    return (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => setAbierto(i)}
                          className="tap flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                            <Icon className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{i.nombre}</span>
                            <span className="block truncate text-[11.5px] text-muted-foreground">
                              {/* Sin agrupar, el padre va en la tarjeta. */}
                              {padre && !g.padre && i.padre ? `${i.padre.nombre} · ` : ""}
                              {usos ? `Se usa ${usos}` : "Sin uso"}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {abierto != null && (
        <EditorCatalogo
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          api={api}
          ruta={ruta}
          textos={t}
          padre={padre}
          padreSugerido={filtroPadre ?? (padres.length ? mayor(padres).id : null)}
          item={abierto === "nuevo" ? null : abierto}
          todos={items}
          largo={data?.largo ?? 200}
          tablas={data?.tablas ?? []}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

/** El padre con más filas: el que se propone en un alta. */
const mayor = <T extends { cantidad: number }>(xs: T[]) =>
  xs.reduce((a, b) => (b.cantidad > a.cantidad ? b : a));

/**
 * La página modal de APEX ("Crear País", "Crear Departamento"): alta, edición
 * y baja.
 *
 * Borrar pide un segundo toque en el mismo botón, y solo se ofrece si nada lo
 * usa; si algo lo usa, dice qué en lugar del botón.
 */
function EditorCatalogo({
  api,
  ruta,
  textos: t,
  padre,
  padreSugerido,
  item,
  todos,
  largo,
  tablas,
  onCerrar,
}: {
  api: ApiCatalogo;
  ruta: string;
  textos: TextosCatalogo;
  padre?: PadreCatalogo;
  padreSugerido: number | null;
  item: ItemCatalogo | null;
  todos: ItemCatalogo[];
  largo: number;
  tablas: string[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [padreElegido, setPadreId] = useState<number | null>(item?.padre?.id ?? padreSugerido);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  // Las opciones del padre: TODOS los de su tabla, no solo los que ya tienen
  // filas acá. Misma caché que la pantalla del padre.
  const padres = useQuery({
    queryKey: padre?.api.queryKey ?? ["sin-padre"],
    queryFn: padre?.api.listar,
    enabled: !!padre,
  });
  // Si el padre tiene a su vez padre (la ciudad elige departamento, y el
  // departamento es de un país), el del padre va debajo del nombre, pero solo
  // si hay más de uno: con todo en Paraguay sería ruido.
  const listaPadres = padres.data?.items ?? [];
  const abuelos = new Set(listaPadres.map((p) => p.padre?.id).filter((id) => id != null));
  const opcionesPadre: Opcion[] = listaPadres.map((p) => ({
    id: p.id,
    texto: p.nombre,
    extra: abuelos.size > 1 ? p.padre?.nombre : undefined,
    busqueda: normalizar(`${p.nombre} ${p.padre?.nombre ?? ""}`),
  }));
  // Sin sugerencia (todavía no hay filas) pero un solo padre posible: ese.
  const padreId = padreElegido ?? (opcionesPadre.length === 1 ? opcionesPadre[0].id : null);

  const nuevo = item == null;
  const puedeGuardar = puedeRuta(ruta, nuevo ? "insertar" : "actualizar");
  const enUso = item != null && totalUsos(item) > 0;
  const puedeBorrar = !nuevo && puedeRuta(ruta, "borrar");

  const limpio = nombre.trim().replace(/\s+/g, " ");
  // Como el backend, pero además sin tildes: "Peru" y "Perú" también avisan.
  // Con padre, dentro del mismo.
  const repetido = todos.find(
    (i) =>
      i.id !== item?.id &&
      (!padre || i.padre?.id === padreId) &&
      normalizar(i.nombre) === normalizar(limpio),
  );
  const sinCambios = item != null && limpio === item.nombre && padreId === (item.padre?.id ?? null);
  const listo =
    puedeGuardar &&
    !!limpio &&
    limpio.length <= largo &&
    (!padre || padreId != null) &&
    !repetido &&
    !sinCambios;

  const invalidar = () => qc.invalidateQueries({ queryKey: api.queryKey });
  const eliminado = t.femenino ? "eliminada" : "eliminado";

  const guardar = useMutation({
    mutationFn: () =>
      api.guardar(item?.id ?? null, { nombre: limpio, padreId: padreId ?? undefined }),
    onSuccess: () => {
      invalidar();
      // El padre cuenta cuántos hijos usa: "en 17 departamentos".
      if (padre) qc.invalidateQueries({ queryKey: padre.api.queryKey });
      toast.success(
        nuevo ? `"${limpio}" ${t.femenino ? "agregada" : "agregado"}` : "Cambios guardados",
      );
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => api.eliminar(item!.id),
    onSuccess: () => {
      invalidar();
      if (padre) qc.invalidateQueries({ queryKey: padre.api.queryKey });
      toast.success(`"${item!.nombre}" ${eliminado}`);
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? `${t.femenino ? "Nueva" : "Nuevo"} ${t.singular}` : item.nombre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? `Se suma a la lista de ${t.plural}.`
              : enUso
                ? `Se usa ${textoUsos(item)}. Cambiarle el nombre lo cambia en todos lados.`
                : "Todavía no se usa en ningún lado."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate();
          }}
          className="space-y-4"
        >
          {padre &&
            (padres.isLoading ? (
              <Cargando />
            ) : padres.isError ? (
              <Fallo error={padres.error} texto={`No se pudo cargar la lista de ${padre.plural}`} />
            ) : (
              <fieldset disabled={!puedeGuardar || ocupado}>
                <PickerModal
                  label={padre.etiqueta}
                  opciones={opcionesPadre}
                  value={padreId}
                  onChange={(o) => setPadreId(o.id)}
                  placeholder={`Elegir ${padre.etiqueta.toLowerCase()}`}
                  requerido
                />
              </fieldset>
            ))}

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label htmlFor="catalogo-nombre" className="text-sm font-medium">
                Nombre <span className="text-destructive">*</span>
              </label>
              <span
                className={`text-[11px] tabular-nums ${
                  limpio.length > largo ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {limpio.length}/{largo}
              </span>
            </div>
            <input
              id="catalogo-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={`Ej.: ${t.ejemplo}`}
              autoFocus={nuevo && !padre}
              autoComplete="off"
              disabled={!puedeGuardar || ocupado}
              className={campo}
            />
            {repetido && (
              <p className="mt-1 text-xs text-destructive">
                Ya existe “{repetido.nombre}”
                {padre && repetido.padre ? ` en ${repetido.padre.nombre}` : ""}.
              </p>
            )}
          </div>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} ${t.plural}.`}
            />
          )}

          {/* Por qué no se puede borrar, en vez de un botón que falla. */}
          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar mientras se use {textoUsos(item!)}.
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

          {/* Qué tablas lo pueden usar: contexto para quien administra. */}
          {tablas.length > 0 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Pueden usarlo: {tablas.map(nombreTabla).join(", ")}.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
