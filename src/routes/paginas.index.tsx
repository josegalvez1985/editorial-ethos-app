import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Lock, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  BotonBorrar,
  BotonPrimario,
  Cargando,
  Fallo,
  NumeroPagina,
  SoloLectura,
} from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PANTALLAS } from "@/lib/navegacion";
import {
  eliminarPaginaMenu,
  guardarPaginaMenu,
  keysPermisos,
  listarPaginasMenu,
  META_PERMISOS,
  RUTA_PAGINAS,
  RUTA_PERMISOS,
  usePermisos,
  type Accion,
  type PaginaAdmin,
} from "@/lib/permisos";
import { campo } from "@/lib/utils";

export const Route = createFileRoute("/paginas/")({
  head: () => ({
    meta: [
      { title: "Crear páginas — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de las páginas del menú." },
    ],
  }),
  component: PaginasPage,
});

/**
 * Rutas fijas del sitio: no se cargan como ruta de una página nueva.
 *
 * /permisos sí está en la tabla, como la página 2 de APEX (Roles de Usuarios):
 * esa fila se puede editar, pero ninguna otra puede tomar la ruta.
 */
const RUTAS_FIJAS = [RUTA_PERMISOS, RUTA_PAGINAS, "/home", "/account"];

/** Si la ruta es una pantalla que el sitio tiene. */
const conocida = (ruta: string) => !!PANTALLAS[ruta] || RUTAS_FIJAS.includes(ruta);

/** Lo que puede hacer el usuario en sesión acá, según la página de Páginas del menú. */
function useAcciones() {
  const { puedeRuta } = usePermisos();
  return (accion: Accion) => puedeRuta(RUTA_PAGINAS, accion);
}

/**
 * Páginas del menú (`MENU_PAGINAS`): qué páginas tiene el menú, en qué menú
 * principal y a qué pantalla llevan.
 *
 * Separada de Roles de páginas el 08/10/2026: dar permisos es cosa de quien
 * tenga la página 2 en ROLES_PAGINAS; crear páginas, de quien programa (solo
 * JOSEG, fijo), porque una página sin su pantalla en el código lleva a "no
 * encontrado".
 */
function PaginasPage() {
  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Crear páginas</h1>
          <p className="text-xs text-muted-foreground">
            Qué pantallas tiene el menú y en qué menú principal van. Quién las ve se define en
            Permisos.
          </p>
        </div>

        <PestanaPaginas />
      </div>
    </AppShell>
  );
}

/**
 * Las páginas del menú (`MENU_PAGINAS`), agrupadas por menú principal como se
 * ven en la sidebar.
 *
 * El número de una página nueva lo pone el backend (el último de
 * `MENU_PAGINAS` más 1) y no cambia nunca: por eso no se edita.
 *
 * El alta guarda la página SOLO en el menú (08/10/2026): no le da permisos a
 * nadie, ni a quien la crea. Después se los da el administrador en Roles de
 * páginas; hasta entonces no le aparece a nadie en el menú.
 */
function PestanaPaginas() {
  const puede = useAcciones();
  /** `null` cerrado, `"nueva"` alta, o la página que se edita. */
  const [editando, setEditando] = useState<PaginaAdmin | "nueva" | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysPermisos.paginasMenu,
    queryFn: listarPaginasMenu,
    meta: META_PERMISOS,
  });

  const paginas = data ?? [];
  // En el orden en que llegan: el backend ya ordena los menús principales.
  const grupos = new Map<string, PaginaAdmin[]>();
  for (const p of paginas) grupos.set(p.menuPrincipal, [...(grupos.get(p.menuPrincipal) ?? []), p]);

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          El número lo pone el sistema al crearla (el último más 1) y no cambia. Una página nueva no
          tiene permisos: no le aparece a nadie hasta que se los dan en Roles de páginas.
        </p>
        {puede("insertar") && (
          <BotonPrimario onClick={() => setEditando("nueva")}>Nueva página</BotonPrimario>
        )}
      </div>

      {isLoading ? (
        <Cargando />
      ) : isError ? (
        <Fallo error={error} texto="No se pudieron cargar las páginas" />
      ) : !paginas.length ? (
        <p className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Todavía no hay páginas en el menú.
        </p>
      ) : (
        <div className="space-y-5">
          {[...grupos].map(([menu, items]) => (
            <section key={menu}>
              <p className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {menu}
              </p>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {items.map((p) => (
                  <li key={p.pagina}>
                    <button
                      type="button"
                      onClick={() => setEditando(p)}
                      className="flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
                    >
                      <NumeroPagina pagina={p.pagina} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{p.nombre}</p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                          <span className="font-mono">{p.ruta}</span>
                          <span>
                            {p.permisos} usuario{p.permisos === 1 ? "" : "s"}
                          </span>
                          {!conocida(p.ruta) && (
                            <span className="text-destructive">ruta desconocida</span>
                          )}
                        </p>
                      </div>
                      <Pencil className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editando != null && (
        <EditorPagina
          key={editando === "nueva" ? "nueva" : editando.pagina}
          pagina={editando === "nueva" ? null : editando}
          existentes={paginas}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function EditorPagina({
  pagina,
  existentes,
  onCerrar,
}: {
  pagina: PaginaAdmin | null;
  existentes: PaginaAdmin[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const puede = useAcciones();
  const [menu, setMenu] = useState(pagina?.menuPrincipal ?? "");
  const [nombre, setNombre] = useState(pagina?.nombre ?? "");
  const [ruta, setRuta] = useState(pagina?.ruta ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const nueva = pagina == null;
  const puedeGuardar = puede(nueva ? "insertar" : "actualizar");
  // Una con permisos no se borra: el backend lo rechaza igual.
  const puedeQuitar = !nueva && puede("borrar");

  const limpio = {
    menuPrincipal: menu.trim().replace(/\s+/g, " "),
    nombre: nombre.trim().replace(/\s+/g, " "),
    ruta: ruta.trim().toLowerCase(),
  };
  // Solo para avisarlo en el diálogo: el que vale es el que devuelve el backend.
  // Puede salir más alto si ese número ya tiene permisos de una página de APEX
  // (ver siguiente_pagina en backend/roles_paginas.sql).
  const proximo = Math.max(0, ...existentes.map((p) => p.pagina)) + 1;
  const menusExistentes = [...new Set(existentes.map((p) => p.menuPrincipal))];
  const rutasLibres = Object.keys(PANTALLAS).filter(
    (r) => !existentes.some((p) => p.ruta === r && p.pagina !== pagina?.pagina),
  );
  const rutaValida = /^\/[a-z0-9][a-z0-9/_-]*$/.test(limpio.ruta) && !limpio.ruta.endsWith("/");
  const rutaFija = RUTAS_FIJAS.includes(limpio.ruta) && limpio.ruta !== pagina?.ruta;
  const rutaRepetida = existentes.some(
    (p) => p.ruta === limpio.ruta && p.pagina !== pagina?.pagina,
  );
  const sinCambios =
    pagina != null &&
    limpio.menuPrincipal === pagina.menuPrincipal &&
    limpio.nombre === pagina.nombre &&
    limpio.ruta === pagina.ruta;
  const listo =
    puedeGuardar &&
    !!limpio.menuPrincipal &&
    !!limpio.nombre &&
    rutaValida &&
    !rutaFija &&
    !rutaRepetida &&
    !sinCambios;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysPermisos.todo });

  const guardar = useMutation({
    mutationFn: () => guardarPaginaMenu(pagina?.pagina ?? null, limpio),
    onSuccess: (n) => {
      invalidar();
      if (nueva) {
        // Sin permisos no le aparece a nadie: el paso que sigue es darlos.
        toast.success(`Página ${n} creada`, {
          description: "Todavía no la ve nadie. Dale permisos en Roles de páginas.",
          action: { label: "Dar permisos", onClick: () => navigate({ to: RUTA_PERMISOS }) },
          duration: 10000,
        });
      } else {
        toast.success("Página actualizada");
      }
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarPaginaMenu(pagina!.pagina),
    onSuccess: () => {
      invalidar();
      toast.success("Página eliminada");
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
            {nueva ? "Nueva página" : `Página ${pagina.pagina}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nueva
              ? `Va a ser la página ${proximo}: la última del menú más 1. Se guarda sin permisos.`
              : "El número no cambia: es lo que la une con sus permisos."}
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
              <label htmlFor="pagina-menu" className="mb-1.5 block text-sm font-medium">
                Menú principal <span className="text-destructive">*</span>
              </label>
              <input
                id="pagina-menu"
                list="pagina-menus"
                value={menu}
                onChange={(e) => setMenu(e.target.value)}
                maxLength={100}
                placeholder="Ej.: Operaciones"
                className={campo}
              />
              <datalist id="pagina-menus">
                {menusExistentes.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="pagina-nombre" className="mb-1.5 block text-sm font-medium">
                Nombre <span className="text-destructive">*</span>
              </label>
              <input
                id="pagina-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={200}
                placeholder="Ej.: Evaluaciones"
                className={campo}
              />
            </div>

            <div>
              <label htmlFor="pagina-ruta" className="mb-1.5 block text-sm font-medium">
                Ruta <span className="text-destructive">*</span>
              </label>
              <input
                id="pagina-ruta"
                list="pagina-rutas"
                value={ruta}
                onChange={(e) => setRuta(e.target.value)}
                maxLength={200}
                placeholder="Ej.: /evaluaciones"
                autoCapitalize="none"
                autoCorrect="off"
                className={`${campo} font-mono disabled:opacity-60`}
              />
              <datalist id="pagina-rutas">
                {rutasLibres.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {limpio.ruta && !rutaValida ? (
                <p className="mt-1 text-xs text-destructive">
                  Empieza con /, en minúsculas, sin espacios ni / al final.
                </p>
              ) : rutaFija ? (
                <p className="mt-1 text-xs text-destructive">
                  Esa pantalla es fija: está siempre en el menú, no se carga acá.
                </p>
              ) : rutaRepetida ? (
                <p className="mt-1 text-xs text-destructive">Otra página ya usa esa ruta.</p>
              ) : limpio.ruta && !conocida(limpio.ruta) ? (
                // Se deja guardar: la pantalla puede estar en camino. Pero el menú
                // llevaría a "no encontrado" hasta que exista.
                <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  La app todavía no tiene esa pantalla: el menú va a llevar a "no encontrado" hasta
                  que exista.
                </p>
              ) : null}
            </div>
          </fieldset>

          {!nueva && pagina.permisos > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar: {pagina.permisos} usuario
              {pagina.permisos === 1 ? " tiene" : "s tienen"} permisos sobre ella. Quitalos primero
              en Permisos.
            </p>
          )}

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nueva ? "crear" : "modificar"} páginas.`}
            />
          )}

          <div className="flex gap-2">
            {puedeQuitar && pagina.permisos === 0 && (
              <BotonBorrar
                confirmar={confirmarBorrado}
                pendiente={borrar.isPending}
                deshabilitado={ocupado}
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
              />
            )}
            <button
              type="submit"
              disabled={ocupado || !listo}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
              {sinCambios ? "Sin cambios" : nueva ? "Crear página" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
