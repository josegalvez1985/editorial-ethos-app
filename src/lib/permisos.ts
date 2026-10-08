/**
 * Menú y permisos: `MENU_PAGINAS` + `ROLES_PAGINAS`.
 *
 * Contrato del backend: `backend/roles_paginas.sql` (y `menu_paginas.sql`, que
 * crea la tabla del menú).
 *
 * ============================================================================
 * EL MODELO (08/10/2026)
 * ============================================================================
 *
 * | Tabla | Qué tiene |
 * | --- | --- |
 * | `ROLES_PAGINAS` | Los permisos. La MISMA tabla que usa APEX, `APP_ID` 40587 |
 * | `MENU_PAGINAS` | El menú de esta app: menú principal, nombre y `RUTA` de cada página |
 *
 * Una pantalla de la app es una página como las de APEX: el mismo número en las
 * dos tablas. El número de una página nueva lo pone el backend al darla de alta
 * (el último de `MENU_PAGINAS` más 1) y no cambia nunca. **Ninguna pantalla tiene su número
 * escrito en el código**: se la encuentra por su `RUTA`.
 *
 * Cómo se lee una fila de permisos: sin fila, sin acceso; `'S'` sí; `'N'` o
 * `NULL` no. El backend ya manda todo como `'S'`/`'N'`.
 *
 * ============================================================================
 * EL MENÚ NO ES LA SEGURIDAD
 * ============================================================================
 *
 * Ocultar un módulo del menú es comodidad: con el token se puede llamar a ORDS
 * directo. El control de verdad es que cada endpoint pregunte
 * `PKG_ROLES_PAGINAS_ETHOS.puede(...)`. Hoy lo hacen solo los de menú,
 * permisos y Usuarios (`backend/usuarios.sql`).
 */

import { useQuery } from "@tanstack/react-query";

import { authFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Las dos pantallas de administración. Van al principio del menú
 * Administrador, con su ítem armado en el código, pero quién las usa sale de
 * lugares distintos:
 *
 * | Ruta | Qué administra | Quién |
 * | --- | --- | --- |
 * | `/permisos` | roles de páginas (`ROLES_PAGINAS`) | quien tenga su página (la 2) en `ROLES_PAGINAS` |
 * | `/paginas` | creación de páginas (`MENU_PAGINAS`) | solo JOSEG, fijo en el paquete (`administra`) |
 *
 * `/permisos` era fija para JOSEG y EDGARO hasta el 08/10/2026; ahora se
 * controla como en APEX: sin `PUEDE_CONSULTAR` en la 2 no aparece en el menú,
 * y cada botón según su bandera (insertar, actualizar, borrar). Sus modales de
 * APEX (3 y 19) son diálogos de la pantalla, con los mismos permisos.
 *
 * `GET menu` devuelve `admin_permisos` (por `ROLES_PAGINAS`) y `admin_paginas`
 * (por el paquete).
 */
export const RUTA_PERMISOS = "/permisos";
export const RUTA_PAGINAS = "/paginas";

/**
 * Si `pathname` cae dentro de `ruta`.
 *
 * `startsWith` con la barra: `/evaluaciones/nueva` y `/evaluaciones/7` caen en
 * "Evaluaciones". La barra evita que `/evaluaciones-x` caiga.
 */
export function esRutaActiva(pathname: string, ruta: string) {
  return pathname === ruta || pathname.startsWith(`${ruta}/`);
}

export type Accion = "insertar" | "actualizar" | "borrar" | "consultar" | "ver_campos";

export const ACCIONES: { clave: Accion; label: string }[] = [
  { clave: "consultar", label: "Consultar" },
  { clave: "insertar", label: "Insertar" },
  { clave: "actualizar", label: "Actualizar" },
  { clave: "borrar", label: "Borrar" },
  { clave: "ver_campos", label: "Ver campos" },
];

export type Permiso = {
  usuario: string;
  pagina: number;
} & Record<Accion, boolean>;

/** Una página del menú con los permisos del usuario en sesión. */
export type PaginaMenu = Permiso & {
  menuPrincipal: string;
  nombre: string;
  ruta: string;
};

function aPermiso(row: Record<string, unknown>): Permiso {
  return {
    usuario: String(row.usuario ?? ""),
    pagina: Number(row.pagina),
    insertar: row.insertar === "S",
    actualizar: row.actualizar === "S",
    borrar: row.borrar === "S",
    consultar: row.consultar === "S",
    ver_campos: row.ver_campos === "S",
  };
}

/** Datos de seguridad: no se guardan en la caché de `localStorage`. */
export const META_PERMISOS = { persistir: false } as const;

/* -------------------------------------------------------------------------- */
/* El menú del usuario en sesión                                              */
/* -------------------------------------------------------------------------- */

/**
 * TODAS las páginas de `MENU_PAGINAS`, con los permisos del usuario (todo en
 * `false` si no tiene fila). Todas y no solo las permitidas: para cerrar una
 * ruta que el usuario no puede ver hay que saber que está controlada.
 *
 * Vienen en el orden del menú: los menús principales en el orden de su primera
 * página, y dentro de cada uno por número.
 */
export type MiMenu = {
  paginas: PaginaMenu[];
  /**
   * Si ve las dos de administración. `permisos` sale de `ROLES_PAGINAS` (la
   * página de `/permisos`); `paginas`, del paquete.
   */
  admin: { permisos: boolean; paginas: boolean };
};

export async function miMenu(): Promise<MiMenu> {
  const r = (await authFetch("menu")) as {
    data?: Record<string, unknown>[];
    admin_permisos?: string;
    admin_paginas?: string;
  };
  return {
    paginas: (r.data ?? []).map((row) => ({
      ...aPermiso(row),
      menuPrincipal: String(row.menu_principal ?? ""),
      nombre: String(row.nombre_pagina ?? ""),
      ruta: String(row.ruta ?? ""),
    })),
    admin: { permisos: r.admin_permisos === "S", paginas: r.admin_paginas === "S" },
  };
}

/**
 * Las páginas del menú y las preguntas sobre ellas.
 *
 * - `puedeRuta(ruta, accion)`: si el usuario puede `accion` en la pantalla de
 *   `ruta`. Crear páginas contesta con `admin.paginas` (fija). Roles de páginas,
 *   con su fila como cualquier otra, pero sin la excepción de abajo: si su
 *   página falta en `MENU_PAGINAS`, no se puede. **Cualquier otra ruta que
 *   ninguna página controla se puede usar siempre** (Inicio, Mi cuenta, o una
 *   pantalla que todavía no se cargó en `MENU_PAGINAS`).
 * - `paginaDeRuta(pathname)`: la página que controla esa ruta, o `undefined`.
 *
 * Mientras carga, o si falla, ninguna ruta controlada se puede usar: se
 * prefiere un menú que aparece un instante después a uno que muestra algo y lo
 * saca.
 *
 * No se persiste en `localStorage`: un permiso quitado tiene que dejar de
 * verse en el próximo arranque, no cuando venza la caché.
 */
export function usePermisos() {
  const { sesion } = useSession();
  const q = useQuery({
    queryKey: keysPermisos.menu(sesion?.usuario ?? ""),
    queryFn: miMenu,
    enabled: !!sesion,
    staleTime: 5 * 60 * 1000,
    meta: META_PERMISOS,
  });

  const paginas = q.data?.paginas ?? [];
  const admin = q.data?.admin ?? { permisos: false, paginas: false };

  // La ruta más larga que calce: si algún día hay /consulta y /consulta/x,
  // manda la más específica.
  const paginaDeRuta = (pathname: string) =>
    paginas
      .filter((p) => esRutaActiva(pathname, p.ruta))
      .sort((a, b) => b.ruta.length - a.ruta.length)[0];

  const puedeRuta = (ruta: string, accion: Accion = "consultar") => {
    // Crear páginas es fija: el administrador puede todo, el resto nada.
    if (esRutaActiva(ruta, RUTA_PAGINAS)) return admin.paginas;
    const p = paginaDeRuta(ruta);
    // Roles de páginas, por su fila. Sin página, nadie: es la que da los
    // permisos y no puede quedar abierta por un menú incompleto.
    if (esRutaActiva(ruta, RUTA_PERMISOS)) return !!p && p[accion];
    return p === undefined ? !q.isLoading && !q.isError : p[accion];
  };

  return {
    paginas,
    admin,
    paginaDeRuta,
    puedeRuta,
    cargando: q.isLoading,
    error: q.isError ? q.error : null,
    reintentar: q.refetch,
  };
}

/* -------------------------------------------------------------------------- */
/* Administración de páginas (MENU_PAGINAS)                                   */
/* -------------------------------------------------------------------------- */

export type PaginaAdmin = {
  pagina: number;
  menuPrincipal: string;
  nombre: string;
  ruta: string;
  /** Cuántos usuarios tienen fila en `ROLES_PAGINAS` para esta página. */
  permisos: number;
};

export async function listarPaginasMenu(): Promise<PaginaAdmin[]> {
  const r = (await authFetch("menu-paginas")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => ({
    pagina: Number(row.pagina),
    menuPrincipal: String(row.menu_principal ?? ""),
    nombre: String(row.nombre_pagina ?? ""),
    ruta: String(row.ruta ?? ""),
    permisos: Number(row.permisos ?? 0),
  }));
}

export type DatosPagina = Pick<PaginaAdmin, "menuPrincipal" | "nombre" | "ruta">;

/**
 * Alta (`pagina` null) o modificación. Devuelve el número de la página: en el
 * alta lo pone el backend (el último del menú más 1). El alta NO da permisos,
 * ni a quien la crea: los da después el administrador en Roles de páginas.
 */
export async function guardarPaginaMenu(pagina: number | null, d: DatosPagina): Promise<number> {
  const r = (await authFetch(pagina == null ? "menu-paginas" : `menu-paginas/${pagina}`, {
    method: pagina == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_principal: d.menuPrincipal,
      nombre_pagina: d.nombre,
      ruta: d.ruta,
    }),
  })) as { pagina?: number };
  return Number(r.pagina ?? pagina ?? 0);
}

/** Baja. El backend responde 409 si la página tiene permisos cargados. */
export async function eliminarPaginaMenu(pagina: number): Promise<void> {
  await authFetch(`menu-paginas/${pagina}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* Administración de permisos (ROLES_PAGINAS)                                 */
/* -------------------------------------------------------------------------- */

export type UsuarioPermisos = {
  usuario: string;
  /** Nombre y apellido del workspace. `null` si no lo tiene o ya no está. */
  nombre: string | null;
  /** `false` = tiene filas pero ya no es usuario del workspace. */
  enWorkspace: boolean;
  /** Cuántas filas tiene en `ROLES_PAGINAS`. */
  paginas: number;
};

export async function listarUsuarios(): Promise<UsuarioPermisos[]> {
  const r = (await authFetch("roles-paginas/usuarios")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => ({
    usuario: String(row.usuario ?? ""),
    nombre: row.nombre ? String(row.nombre) : null,
    enWorkspace: row.en_workspace === "S",
    paginas: Number(row.paginas ?? 0),
  }));
}

export async function listarPermisos(usuario?: string): Promise<Permiso[]> {
  const qs = usuario ? `?usuario=${encodeURIComponent(usuario)}` : "";
  const r = (await authFetch(`roles-paginas${qs}`)) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map(aPermiso);
}

export type NombrePagina = {
  nombre: string;
  /** `app` = de `MENU_PAGINAS`; `apex` = una página de la app APEX. */
  origen: "app" | "apex";
};

/**
 * El nombre de cada página que se puede permisar: las de esta app y las de
 * APEX. Las de APEX pueden faltar si ORDS no alcanza a leer
 * `APEX_APPLICATION_PAGES`: la pantalla cae a "Página N".
 */
export async function listarNombresPaginas(): Promise<Map<number, NombrePagina>> {
  const r = (await authFetch("roles-paginas/paginas")) as { data?: Record<string, unknown>[] };
  return new Map(
    (r.data ?? []).map((row) => [
      Number(row.pagina),
      { nombre: String(row.nombre ?? ""), origen: row.origen === "app" ? "app" : "apex" },
    ]),
  );
}

function cuerpo(p: Permiso) {
  const sn = (b: boolean) => (b ? "S" : "N");
  return JSON.stringify({
    insertar: sn(p.insertar),
    actualizar: sn(p.actualizar),
    borrar: sn(p.borrar),
    consultar: sn(p.consultar),
    ver_campos: sn(p.ver_campos),
    // Solo los lee el POST; en el PUT van en la URL.
    usuario: p.usuario,
    pagina: p.pagina,
  });
}

const ruta = (p: Pick<Permiso, "usuario" | "pagina">) =>
  `roles-paginas/${encodeURIComponent(p.usuario)}/${p.pagina}`;

/** Alta. 409 si el usuario ya tiene esa página. */
export async function agregarPermiso(p: Permiso): Promise<void> {
  await authFetch("roles-paginas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: cuerpo(p),
  });
}

export async function actualizarPermiso(p: Permiso): Promise<void> {
  await authFetch(ruta(p), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: cuerpo(p),
  });
}

export async function quitarPermiso(p: Pick<Permiso, "usuario" | "pagina">): Promise<void> {
  await authFetch(ruta(p), { method: "DELETE" });
}

/**
 * Copiar Roles (la página 19 de APEX): le da a `hacia` las páginas de `desde`
 * que todavía no tiene, con las mismas banderas. Las que ya tiene no se tocan.
 * Devuelve cuántas copió.
 *
 * En APEX la 19 era un modal de la 2; acá también: un diálogo de Roles de
 * páginas, con el mismo acceso que la pantalla. No es una página aparte.
 */
export async function copiarPermisos(desde: string, hacia: string): Promise<number> {
  const r = (await authFetch("roles-paginas/copiar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desde, hacia }),
  })) as { copiadas?: number };
  return Number(r.copiadas ?? 0);
}

/** Todo cuelga de `["permisos"]`: invalidar `todo` refresca también el menú. */
export const keysPermisos = {
  todo: ["permisos"] as const,
  menu: (usuario: string) => ["permisos", "menu", usuario] as const,
  paginasMenu: ["permisos", "paginas-menu"] as const,
  usuarios: ["permisos", "usuarios"] as const,
  deUsuario: (usuario: string) => ["permisos", "usuario", usuario] as const,
  nombres: ["permisos", "nombres"] as const,
};
