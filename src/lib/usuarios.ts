/**
 * Usuarios del workspace: listado y activar / bloquear. Contrato del backend:
 * `backend/usuarios.sql`.
 *
 * Es la página 67 de APEX (Usuarios) y su modal 68 (Activar / Inactivar
 * Usuarios). La 68 no es una página en el sitio: es un diálogo de `/usuarios`,
 * con los permisos de la 67.
 *
 * Los usuarios son los del workspace de APEX: con esos se entra al sitio (ver
 * `backend/auth.sql`). Acá no se crean ni se borran, igual que en APEX.
 *
 * El backend controla `ROLES_PAGINAS` en los dos endpoints: consultar para
 * listar, actualizar para bloquear. No es solo el menú.
 */

import { authFetch } from "@/lib/api";

export type Usuario = {
  /** Nombre de usuario de APEX, en MAYÚSCULAS. */
  usuario: string;
  nombre: string;
  apellido: string;
  email: string;
  bloqueado: boolean;
  /** Cuántas páginas tiene en `ROLES_PAGINAS`. 0 = no ve nada del menú. */
  paginas: number;
  /** El usuario en sesión: no se puede bloquear a sí mismo. */
  esYo: boolean;
  /** La cuenta dueña del workspace: no se bloquea. */
  esDuena: boolean;
};

/** "Nombre Apellido", o el usuario si el workspace no tiene nombre cargado. */
export const nombreCompleto = (u: Usuario) => `${u.nombre} ${u.apellido}`.trim() || u.usuario;

/** Por qué no se le puede cambiar el estado, o `null` si se puede. */
export function motivoNoCambiable(u: Usuario): string | null {
  if (u.esYo) return "Es tu usuario: no lo podés bloquear.";
  if (u.esDuena) return "Es la cuenta dueña del workspace: no se bloquea.";
  return null;
}

export async function listarUsuarios(): Promise<Usuario[]> {
  const r = (await authFetch("usuarios")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => ({
    usuario: String(row.usuario ?? ""),
    nombre: String(row.nombre ?? "").trim(),
    apellido: String(row.apellido ?? "").trim(),
    email: String(row.email ?? "").trim(),
    bloqueado: row.bloqueado === "S",
    paginas: Number(row.paginas ?? 0),
    esYo: row.es_yo === "S",
    esDuena: row.es_duena === "S",
  }));
}

/**
 * Pone al usuario en el estado pedido. Se manda el estado que se quiere y no
 * "invertir", como hacía APEX: con una lista vieja, "Bloquear" nunca termina
 * activando a nadie. Al bloquear, el backend además le cierra la sesión del
 * sitio. Devuelve cuántas sesiones cerró.
 */
export async function cambiarEstadoUsuario(usuario: string, bloqueado: boolean): Promise<number> {
  const r = (await authFetch(`usuarios/${encodeURIComponent(usuario)}/estado`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bloqueado: bloqueado ? "S" : "N" }),
  })) as { sesiones_cerradas?: number };
  return Number(r.sesiones_cerradas ?? 0);
}

export const keysUsuarios = {
  todo: ["usuarios"] as const,
};
