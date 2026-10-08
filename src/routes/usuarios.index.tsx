import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Lock, LockOpen, Mail, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { iniciales } from "@/lib/navegacion";
import { keysPermisos, RUTA_PERMISOS, usePermisos } from "@/lib/permisos";
import {
  cambiarEstadoUsuario,
  keysUsuarios,
  listarUsuarios,
  motivoNoCambiable,
  nombreCompleto,
  type Usuario,
} from "@/lib/usuarios";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/usuarios/")({
  head: () => ({
    meta: [
      { title: "Usuarios — Juventud con Valores" },
      { name: "description", content: "Las cuentas del sistema: activar y bloquear." },
    ],
  }),
  component: UsuariosPage,
});

type Filtro = "todos" | "activos" | "bloqueados";

/**
 * Usuarios: la página 67 de APEX (un IR de `APEX_WORKSPACE_APEX_USERS`) y su
 * modal 68 (Activar / Inactivar), que acá es el diálogo de cada tarjeta. No hay
 * página aparte para la 68: la usa quien puede usar esta.
 *
 * Lo que cambia respecto de APEX:
 *
 * - Tarjetas en vez de grilla, con buscador (nombre, usuario o correo) y un
 *   filtro por estado que dice cuántos hay de cada uno.
 * - Cada tarjeta dice cuántas páginas tiene el usuario en `ROLES_PAGINAS`: uno
 *   activo sin páginas entra y no ve nada, y eso salta a la vista. Quien
 *   administra permisos tiene ahí el atajo a Roles de páginas.
 * - Se pide el estado que se quiere, no "invertir" (ver `lib/usuarios.ts`), y
 *   bloquear pide confirmación y se puede deshacer desde el aviso.
 * - No se ofrece bloquear la cuenta propia ni la dueña del workspace.
 */
function UsuariosPage() {
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [abierto, setAbierto] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysUsuarios.todo,
    queryFn: listarUsuarios,
  });

  const todos = data ?? [];
  const cuenta = {
    todos: todos.length,
    activos: todos.filter((u) => !u.bloqueado).length,
    bloqueados: todos.filter((u) => u.bloqueado).length,
  };
  const q = normalizar(buscar.trim());
  const filas = todos.filter(
    (u) =>
      (filtro === "todos" || u.bloqueado === (filtro === "bloqueados")) &&
      (!q || normalizar(`${nombreCompleto(u)} ${u.usuario} ${u.email}`).includes(q)),
  );
  // Se relee de la lista: después de bloquear, el diálogo ya muestra el estado
  // nuevo sin cerrarse.
  const elegido = abierto ? todos.find((u) => u.usuario === abierto) : undefined;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Usuarios</h1>
          <p className="text-xs text-muted-foreground">
            Las cuentas con las que se entra al sistema. Se crean en APEX; acá se activan o se
            bloquean.
          </p>
        </div>

        {/* Filtro por estado: el número de cada uno ya es el resumen. */}
        <div role="tablist" aria-label="Filtrar por estado" className="mb-3 flex flex-wrap gap-2">
          {(
            [
              ["todos", "Todos"],
              ["activos", "Activos"],
              ["bloqueados", "Bloqueados"],
            ] as const
          ).map(([clave, label]) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={filtro === clave}
              onClick={() => setFiltro(clave)}
              className={`tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                filtro === clave
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  filtro === clave ? "bg-white/20" : "bg-muted"
                }`}
              >
                {isLoading ? "…" : cuenta[clave]}
              </span>
            </button>
          ))}
        </div>

        <Buscador
          valor={buscar}
          onCambio={setBuscar}
          placeholder="Buscar por nombre, usuario o correo…"
        />

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudieron cargar los usuarios" />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <Users className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q || filtro !== "todos"
                ? "Ningún usuario coincide."
                : "El workspace no tiene usuarios."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((u) => (
              <li key={u.usuario}>
                <TarjetaUsuario usuario={u} onAbrir={() => setAbierto(u.usuario)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {elegido && <FichaUsuario usuario={elegido} onCerrar={() => setAbierto(null)} />}
    </AppShell>
  );
}

function Avatar({ usuario, grande = false }: { usuario: Usuario; grande?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-full font-semibold ${
        grande ? "size-16 text-lg" : "size-11 text-[13px]"
      } ${usuario.bloqueado ? "bg-muted text-muted-foreground" : "bg-hero-gradient text-on-brand"}`}
    >
      {iniciales(nombreCompleto(usuario))}
      {usuario.bloqueado && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-destructive text-white ring-2 ring-card ${
            grande ? "size-6" : "size-[18px]"
          }`}
        >
          <Lock className={grande ? "size-3.5" : "size-2.5"} />
        </span>
      )}
    </span>
  );
}

function Estado({ bloqueado }: { bloqueado: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold ${
        bloqueado ? "bg-destructive/10 text-destructive" : "bg-primary-soft text-primary"
      }`}
    >
      {bloqueado ? "Bloqueado" : "Activo"}
    </span>
  );
}

function TarjetaUsuario({ usuario: u, onAbrir }: { usuario: Usuario; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        u.bloqueado ? "border-destructive/20" : "border-border/60"
      }`}
    >
      <Avatar usuario={u} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span
            className={`truncate text-sm font-semibold ${u.bloqueado ? "text-muted-foreground" : ""}`}
          >
            {nombreCompleto(u)}
          </span>
          {u.esYo && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold">
              Vos
            </span>
          )}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">{u.email || u.usuario}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5">
          <Estado bloqueado={u.bloqueado} />
          <span
            className={`text-[11px] ${
              u.paginas ? "text-muted-foreground" : "font-medium text-destructive/80"
            }`}
          >
            {u.paginas ? `${u.paginas} página${u.paginas === 1 ? "" : "s"}` : "Sin páginas"}
          </span>
        </p>
      </div>
    </button>
  );
}

/**
 * La ficha de un usuario y su única acción, activar o bloquear: la página 68 de
 * APEX. Bloquear pide un segundo toque en el mismo botón, sin un diálogo encima
 * de otro, y el aviso trae "Deshacer".
 */
function FichaUsuario({ usuario: u, onCerrar }: { usuario: Usuario; onCerrar: () => void }) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const [confirmar, setConfirmar] = useState(false);

  const puedeCambiar = puedeRuta("/usuarios", "actualizar");
  const motivo = motivoNoCambiable(u);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysUsuarios.todo });
    // El contador de usuarios de Roles de páginas no depende del estado, pero
    // la lista de allá sale del mismo workspace.
    qc.invalidateQueries({ queryKey: keysPermisos.usuarios });
  };

  const cambiar = useMutation({
    mutationFn: (bloquear: boolean) => cambiarEstadoUsuario(u.usuario, bloquear),
    onSuccess: (cerradas, bloquear) => {
      invalidar();
      setConfirmar(false);
      const nombre = nombreCompleto(u);
      toast.success(bloquear ? `${nombre} bloqueado` : `${nombre} activado`, {
        description:
          bloquear && cerradas > 0 ? "Se le cerró la sesión que tenía abierta." : undefined,
        action: {
          label: "Deshacer",
          onClick: () =>
            cambiarEstadoUsuario(u.usuario, !bloquear)
              .then(() => {
                invalidar();
                toast.success(
                  bloquear ? `${nombre} activado de nuevo` : `${nombre} bloqueado de nuevo`,
                );
              })
              .catch((err) =>
                toast.error(err instanceof Error ? err.message : "No se pudo deshacer"),
              ),
        },
      });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo cambiar"),
  });

  const filas: [string, string][] = [
    ["Usuario", u.usuario],
    ["Nombre", u.nombre || "—"],
    ["Apellido", u.apellido || "—"],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !cambiar.isPending && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="items-center text-center">
          <Avatar usuario={u} grande />
          <DialogTitle className="font-display mt-2 text-xl">{nombreCompleto(u)}</DialogTitle>
          <DialogDescription className="flex items-center justify-center gap-2 text-xs">
            <Estado bloqueado={u.bloqueado} />
            {u.esYo && "Tu usuario"}
            {u.esDuena && "Dueña del workspace"}
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
          {filas.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-muted-foreground">Correo</dt>
            <dd className="flex min-w-0 items-center gap-1.5 font-medium">
              {u.email ? (
                <>
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate select-all">{u.email}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-muted-foreground">Páginas</dt>
            <dd className="flex items-center gap-2 font-medium">
              {u.paginas || "Ninguna"}
              {puedeRuta(RUTA_PERMISOS) && (
                <Link
                  to={RUTA_PERMISOS}
                  search={{ usuario: u.usuario }}
                  className="flex items-center gap-1 rounded-lg bg-primary-soft px-2 py-1 text-[11.5px] font-semibold text-primary"
                >
                  <ShieldCheck className="size-3.5" />
                  {u.paginas ? "Ver permisos" : "Dar permisos"}
                </Link>
              )}
            </dd>
          </div>
        </dl>

        {motivo ? (
          <SoloLectura texto={motivo} />
        ) : !puedeCambiar ? (
          <SoloLectura texto="Solo lectura: tu usuario no puede activar ni bloquear usuarios." />
        ) : u.bloqueado ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Va a poder volver a entrar al sistema y a APEX con su contraseña.
            </p>
            <button
              type="button"
              disabled={cambiar.isPending}
              onClick={() => cambiar.mutate(false)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
            >
              {cambiar.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LockOpen className="size-4" />
              )}
              Activar usuario
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              No va a poder entrar al sistema ni a APEX. Si ahora está adentro, se le cierra la
              sesión. Sus permisos no se tocan: al activarlo vuelve a ver lo mismo.
            </p>
            <button
              type="button"
              disabled={cambiar.isPending}
              onClick={() => (confirmar ? cambiar.mutate(true) : setConfirmar(true))}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-60 ${
                confirmar
                  ? "border-destructive bg-destructive text-white"
                  : "border-destructive/40 text-destructive"
              }`}
            >
              {cambiar.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              {confirmar ? "Tocá de nuevo para bloquear" : "Bloquear usuario"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
