import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Copy, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  BotonBorrar,
  BotonPrimario,
  Buscador,
  Cargando,
  Etiqueta,
  Fallo,
  NumeroPagina,
  SoloLectura,
} from "@/components/admin-ui";
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
import {
  ACCIONES,
  actualizarPermiso,
  agregarPermiso,
  copiarPermisos,
  keysPermisos,
  listarNombresPaginas,
  listarPermisos,
  listarUsuarios,
  META_PERMISOS,
  quitarPermiso,
  RUTA_PERMISOS,
  usePermisos,
  type Accion,
  type Permiso,
  type UsuarioPermisos,
} from "@/lib/permisos";
import { campo, normalizar } from "@/lib/utils";

export const Route = createFileRoute("/permisos/")({
  head: () => ({
    meta: [
      { title: "Roles de páginas — Juventud con Valores" },
      { name: "description", content: "Qué páginas puede usar cada usuario." },
    ],
  }),
  // `?usuario=X` abre ese usuario directamente: lo usa "Ver permisos" de la
  // pantalla Usuarios.
  validateSearch: (s: Record<string, unknown>): { usuario?: string } => ({
    usuario: typeof s.usuario === "string" && s.usuario ? s.usuario : undefined,
  }),
  component: PermisosPage,
});

/** Lo que puede hacer el usuario en sesión acá, según la página de Permisos. */
function useAcciones() {
  const { puedeRuta } = usePermisos();
  return (accion: Accion) => puedeRuta(RUTA_PERMISOS, accion);
}

/**
 * Permisos: qué páginas puede usar cada usuario (`ROLES_PAGINAS`).
 *
 * Lo que se puede hacer depende de los permisos sobre la propia página de
 * Permisos (`/permisos`): sin "insertar" no aparece "Agregar página", y así.
 * El backend lo controla igual.
 *
 * Las páginas del menú se crean en otra pantalla, Crear páginas (`/paginas`):
 * las administra otra persona (08/10/2026).
 *
 * Es la página 2 de APEX (Roles de Usuarios). Sus dos modales de allá son
 * diálogos de esta misma pantalla, NO páginas aparte ni entradas del menú, y
 * los usa quien puede usar esta:
 *
 * | APEX | Acá |
 * | --- | --- |
 * | 3, Crear Rol | "Agregar página" y tocar una página ({@link EditorPermiso}) |
 * | 19, Copiar Roles | "Copiar de…" ({@link CopiarPermisos}) |
 */
function PermisosPage() {
  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Roles de páginas</h1>
          <p className="text-xs text-muted-foreground">
            Qué páginas puede usar cada usuario. Es la misma tabla que usa APEX: un cambio acá vale
            para las dos.
          </p>
        </div>

        <PestanaUsuarios />
      </div>
    </AppShell>
  );
}

/**
 * El nombre de una página: el de `MENU_PAGINAS` si es de esta app, el de APEX si
 * no, o "Página N" si no se conoce.
 */
function useNombrePagina() {
  const { data } = useQuery({
    queryKey: keysPermisos.nombres,
    queryFn: listarNombresPaginas,
    staleTime: 10 * 60 * 1000,
    meta: META_PERMISOS,
  });
  const nombre = (pagina: number) =>
    data?.get(pagina) ?? { nombre: `Página ${pagina}`, origen: "apex" as const };
  return { nombre, todas: data };
}

/**
 * Primero se elige el usuario y después se ven sus páginas, porque así se
 * administra en la práctica: se da de alta a alguien, o se le suma o quita una
 * pantalla. En escritorio las dos columnas se ven a la vez; en el celular, una
 * a la vez con un "volver".
 */
function PestanaUsuarios() {
  const [buscar, setBuscar] = useState("");
  const [elegido, setElegido] = useState<UsuarioPermisos | null>(null);
  const { usuario: deUrl } = Route.useSearch();
  // El de la URL vale hasta que se elige otro o se vuelve a la lista: si no,
  // "volver" en el celular lo abriría de nuevo.
  const [usarUrl, setUsarUrl] = useState(true);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysPermisos.usuarios,
    queryFn: listarUsuarios,
    meta: META_PERMISOS,
  });

  const q = normalizar(buscar.trim());
  const usuarios = (data ?? []).filter(
    (u) => !q || normalizar(`${u.usuario} ${u.nombre ?? ""}`).includes(q),
  );
  // El elegido se relee de la lista: así el contador de páginas se actualiza
  // después de agregar o quitar una.
  const actual = elegido
    ? (data?.find((u) => u.usuario === elegido.usuario) ?? elegido)
    : usarUrl && deUrl
      ? (data?.find((u) => u.usuario === deUrl.toUpperCase()) ?? null)
      : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* Usuarios. En el celular se esconde mientras se ve uno. */}
      <section className={actual ? "hidden lg:block" : ""}>
        <Buscador valor={buscar} onCambio={setBuscar} placeholder="Buscar usuario…" />

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudieron cargar los usuarios" />
        ) : !usuarios.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Ningún usuario coincide con la búsqueda.
          </p>
        ) : (
          <ul className="space-y-2">
            {usuarios.map((u) => {
              const activo = actual?.usuario === u.usuario;
              return (
                <li key={u.usuario}>
                  <button
                    type="button"
                    onClick={() => setElegido(u)}
                    aria-current={activo ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-soft ${
                      activo
                        ? "border-primary/40 bg-primary-soft"
                        : "border-border/60 bg-card hover:border-primary/40"
                    }`}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                      <UserRound className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{u.nombre || u.usuario}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        <span>{u.usuario}</span>
                        <span className="font-medium text-foreground">
                          {u.paginas} página{u.paginas === 1 ? "" : "s"}
                        </span>
                        {!u.enWorkspace && (
                          <span className="text-destructive">fuera del workspace</span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Páginas del elegido. */}
      <section className={actual ? "" : "hidden lg:block"}>
        {actual ? (
          <PaginasDeUsuario
            usuario={actual}
            onVolver={() => {
              setElegido(null);
              setUsarUrl(false);
            }}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <ShieldCheck className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Elegí un usuario para ver sus páginas.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function PaginasDeUsuario({
  usuario,
  onVolver,
}: {
  usuario: UsuarioPermisos;
  onVolver: () => void;
}) {
  const puede = useAcciones();
  const { nombre } = useNombrePagina();
  /** `null` cerrado, `"nueva"` alta, o el permiso que se edita. */
  const [editando, setEditando] = useState<Permiso | "nueva" | null>(null);
  const [copiando, setCopiando] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysPermisos.deUsuario(usuario.usuario),
    queryFn: () => listarPermisos(usuario.usuario),
    meta: META_PERMISOS,
  });

  const filas = data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onVolver}
            className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground lg:hidden"
          >
            <ArrowLeft className="size-3.5" />
            Usuarios
          </button>
          <p className="truncate font-semibold">{usuario.nombre || usuario.usuario}</p>
          <p className="text-[11px] text-muted-foreground">{usuario.usuario}</p>
        </div>
        {puede("insertar") && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCopiando(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-sm font-semibold shadow-soft hover:border-primary/40"
            >
              <Copy className="size-4" />
              Copiar de…
            </button>
            <BotonPrimario onClick={() => setEditando("nueva")}>Agregar página</BotonPrimario>
          </div>
        )}
      </div>

      {isLoading ? (
        <Cargando />
      ) : isError ? (
        <Fallo error={error} texto="No se pudieron cargar los permisos" />
      ) : !filas.length ? (
        // Un usuario nuevo es el caso típico de Copiar Roles: se le da lo mismo
        // que a otro que hace la misma tarea. Por eso el atajo va acá también.
        <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center">
          <p className="text-sm text-muted-foreground">Este usuario no tiene ninguna página.</p>
          {puede("insertar") && (
            <button
              type="button"
              onClick={() => setCopiando(true)}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
            >
              <Copy className="size-4" />
              Copiar los permisos de otro usuario
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
          {filas.map((p) => {
            const n = nombre(p.pagina);
            return (
              <li key={p.pagina}>
                <button
                  type="button"
                  onClick={() => setEditando(p)}
                  className="flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
                >
                  <NumeroPagina pagina={p.pagina} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="truncate">{n.nombre}</span>
                      {n.origen === "app" && <Etiqueta>app nueva</Etiqueta>}
                    </p>
                    <Banderas permiso={p} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editando != null && (
        <EditorPermiso
          key={editando === "nueva" ? "nueva" : editando.pagina}
          usuario={usuario.usuario}
          permiso={editando === "nueva" ? null : editando}
          asignadas={filas.map((p) => p.pagina)}
          onCerrar={() => setEditando(null)}
        />
      )}

      {copiando && (
        <CopiarPermisos
          hacia={usuario}
          asignadas={filas.map((p) => p.pagina)}
          onCerrar={() => setCopiando(false)}
        />
      )}
    </div>
  );
}

/**
 * Copiar Roles (la página 19 de APEX): se elige de quién copiar y se ve ANTES
 * qué páginas va a recibir este usuario. En APEX se elegían los dos usuarios a
 * ciegas; acá el destino es el usuario que se está mirando y el origen se elige
 * viendo cuántas páginas tiene.
 *
 * Como en APEX, solo suma: las páginas que el usuario ya tiene no se tocan, ni
 * sus banderas. El resumen lo dice antes de confirmar.
 */
function CopiarPermisos({
  hacia,
  asignadas,
  onCerrar,
}: {
  hacia: UsuarioPermisos;
  /** Las páginas que `hacia` ya tiene: esas no se copian. */
  asignadas: number[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { nombre } = useNombrePagina();
  const [desde, setDesde] = useState<string | null>(null);

  // La misma consulta que la lista de usuarios: ya está en caché.
  const usuarios = useQuery({
    queryKey: keysPermisos.usuarios,
    queryFn: listarUsuarios,
    meta: META_PERMISOS,
  });
  // Solo los que tienen algo para copiar, y nunca el mismo usuario.
  const candidatos = (usuarios.data ?? [])
    .filter((u) => u.paginas > 0 && u.usuario !== hacia.usuario)
    .sort((a, b) => (a.nombre || a.usuario).localeCompare(b.nombre || b.usuario));
  // `PickerModal` trabaja con ids numéricos: el índice en `candidatos`.
  const opciones: Opcion[] = candidatos.map((u, i) => {
    const texto = u.nombre ? `${u.nombre} (${u.usuario})` : u.usuario;
    return {
      id: i,
      texto,
      extra: `${u.paginas} página${u.paginas === 1 ? "" : "s"}`,
      busqueda: normalizar(texto),
    };
  });
  const idx = desde == null ? -1 : candidatos.findIndex((u) => u.usuario === desde);

  const origen = useQuery({
    queryKey: keysPermisos.deUsuario(desde ?? ""),
    queryFn: () => listarPermisos(desde ?? ""),
    enabled: desde != null,
    meta: META_PERMISOS,
  });
  const nuevas = (origen.data ?? []).filter((p) => !asignadas.includes(p.pagina));
  const yaTiene = (origen.data?.length ?? 0) - nuevas.length;
  const plural = (n: number) => (n === 1 ? "" : "s");

  const copiar = useMutation({
    mutationFn: () => copiarPermisos(desde ?? "", hacia.usuario),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: keysPermisos.todo });
      toast.success(`${n} página${plural(n)} copiada${plural(n)}`);
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo copiar"),
  });

  const listo = desde != null && origen.isSuccess && nuevas.length > 0 && !copiar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !copiar.isPending && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Copiar permisos</DialogTitle>
          <DialogDescription className="text-xs">
            {hacia.nombre || hacia.usuario} recibe las páginas del usuario que elijas, con los
            mismos permisos. Lo que ya tiene no cambia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {usuarios.isLoading ? (
            <Cargando />
          ) : !opciones.length ? (
            <p className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
              No hay otro usuario con páginas para copiar.
            </p>
          ) : (
            <PickerModal
              label="Copiar de"
              opciones={opciones}
              value={idx >= 0 ? idx : null}
              onChange={(o) => setDesde(candidatos[o.id]?.usuario ?? null)}
              placeholder="Elegir usuario"
              requerido
            />
          )}

          {desde != null &&
            (origen.isLoading ? (
              <Cargando />
            ) : origen.isError ? (
              <Fallo error={origen.error} texto="No se pudieron cargar sus páginas" />
            ) : (
              <div>
                <p className="mb-2 text-sm">
                  {nuevas.length ? (
                    <>
                      Va a recibir <strong>{nuevas.length}</strong> página{plural(nuevas.length)}.
                    </>
                  ) : (
                    "Ya tiene todas las páginas de ese usuario: no hay nada para copiar."
                  )}
                  {yaTiene > 0 && nuevas.length > 0 && (
                    <span className="text-muted-foreground">
                      {yaTiene === 1
                        ? " La que ya tiene queda como está."
                        : ` Las ${yaTiene} que ya tiene quedan como están.`}
                    </span>
                  )}
                </p>
                {nuevas.length > 0 && (
                  <ul className="max-h-60 space-y-1.5 overflow-y-auto rounded-xl border border-border/60 p-2">
                    {nuevas.map((p) => (
                      <li
                        key={p.pagina}
                        className="flex items-start gap-2.5 rounded-lg px-1.5 py-1"
                      >
                        <span className="w-8 shrink-0 pt-px text-right text-xs font-bold text-muted-foreground tabular-nums">
                          {p.pagina}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{nombre(p.pagina).nombre}</p>
                          <Banderas permiso={p} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

          <button
            type="button"
            disabled={!listo}
            onClick={() => copiar.mutate()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {copiar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Copy className="size-4" />
            )}
            {desde == null
              ? "Elegí de quién copiar"
              : nuevas.length
                ? `Copiar ${nuevas.length} página${plural(nuevas.length)}`
                : "Nada para copiar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Las cinco acciones como pastillas: encendidas en el color primario. */
function Banderas({ permiso }: { permiso: Permiso }) {
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {ACCIONES.map((a) => (
        <span
          key={a.clave}
          title={`${a.label}: ${permiso[a.clave] ? "sí" : "no"}`}
          className={`rounded-md px-1.5 py-px text-[10px] font-semibold ${
            permiso[a.clave]
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground line-through"
          }`}
        >
          {a.label}
        </span>
      ))}
    </p>
  );
}

/** Un alta arranca con todo en "sí": es como están cargadas casi todas las filas. */
const TODO_SI: Record<Accion, boolean> = {
  insertar: true,
  actualizar: true,
  borrar: true,
  consultar: true,
  ver_campos: true,
};

function EditorPermiso({
  usuario,
  permiso,
  asignadas,
  onCerrar,
}: {
  usuario: string;
  permiso: Permiso | null;
  /** Las páginas que el usuario ya tiene: no se ofrecen en el alta. */
  asignadas: number[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const puede = useAcciones();
  const { nombre, todas } = useNombrePagina();
  const [pagina, setPagina] = useState<number | null>(permiso?.pagina ?? null);
  const [paginaTexto, setPaginaTexto] = useState("");
  const [acciones, setAcciones] = useState<Record<Accion, boolean>>(
    permiso
      ? {
          insertar: permiso.insertar,
          actualizar: permiso.actualizar,
          borrar: permiso.borrar,
          consultar: permiso.consultar,
          ver_campos: permiso.ver_campos,
        }
      : TODO_SI,
  );
  // Quitar pide un segundo toque en el mismo botón, sin un diálogo encima de
  // otro diálogo.
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const nueva = permiso == null;
  const puedeGuardar = puede(nueva ? "insertar" : "actualizar");
  const puedeQuitar = !nueva && puede("borrar");

  // Las de esta app primero: son las que se administran desde acá.
  const opciones: Opcion[] = [...(todas ?? new Map())]
    .filter(([n]) => !asignadas.includes(n))
    .sort(([a, x], [b, y]) => (x.origen === y.origen ? a - b : x.origen === "app" ? -1 : 1))
    .map(([n, info]) => {
      const texto = `${n} · ${info.nombre}${info.origen === "app" ? " (app nueva)" : ""}`;
      return { id: n, texto, busqueda: normalizar(texto) };
    });

  const invalidar = () => qc.invalidateQueries({ queryKey: keysPermisos.todo });
  const fila = (): Permiso => ({ usuario, pagina: pagina ?? 0, ...acciones });

  const guardar = useMutation({
    mutationFn: () => (nueva ? agregarPermiso(fila()) : actualizarPermiso(fila())),
    onSuccess: () => {
      invalidar();
      toast.success(nueva ? "Página agregada" : "Permiso actualizado");
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => quitarPermiso({ usuario, pagina: permiso!.pagina }),
    onSuccess: () => {
      invalidar();
      toast.success("Página quitada");
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo quitar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const sinCambios =
    permiso != null && ACCIONES.every((a) => acciones[a.clave] === permiso[a.clave]);
  const yaAsignada = nueva && pagina !== null && asignadas.includes(pagina);
  const listo = pagina !== null && pagina > 0 && !yaAsignada && !sinCambios && puedeGuardar;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nueva ? "Agregar página" : `${permiso.pagina} · ${nombre(permiso.pagina).nombre}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nueva ? `Para ${usuario}.` : `Permisos de ${usuario} sobre esta página.`}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate();
          }}
          className="space-y-4"
        >
          {nueva &&
            (opciones.length ? (
              <PickerModal
                label="Página"
                opciones={opciones}
                value={pagina}
                onChange={(o) => setPagina(o.id)}
                placeholder="Elegir página"
                requerido
              />
            ) : (
              // Sin la lista de nombres se escribe el número a mano.
              <div>
                <label htmlFor="pagina-numero" className="mb-1.5 block text-sm font-medium">
                  Número de página <span className="text-destructive">*</span>
                </label>
                <input
                  id="pagina-numero"
                  inputMode="numeric"
                  value={paginaTexto}
                  onChange={(e) => {
                    const t = e.target.value.replace(/\D/g, "");
                    setPaginaTexto(t);
                    setPagina(t ? Number(t) : null);
                  }}
                  placeholder="Ej.: 23"
                  className={campo}
                />
                {yaAsignada && (
                  <p className="mt-1 text-xs text-destructive">El usuario ya tiene esa página.</p>
                )}
              </div>
            ))}

          <fieldset disabled={!puedeGuardar || ocupado} className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium">Puede</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ACCIONES.map((a) => (
                <label
                  key={a.clave}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border/60 px-3 text-sm has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="checkbox"
                    checked={acciones[a.clave]}
                    onChange={(e) => setAcciones((s) => ({ ...s, [a.clave]: e.target.checked }))}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nueva ? "agregar" : "modificar"} permisos.`}
            />
          )}

          <div className="flex gap-2">
            {puedeQuitar && (
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
              {nueva
                ? pagina === null
                  ? "Elegí la página"
                  : "Agregar"
                : sinCambios
                  ? "Sin cambios"
                  : "Guardar cambios"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
