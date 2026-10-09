/**
 * Facilitadores (Núcleo de Datos). Contrato del backend: `backend/facilitadores.sql`.
 *
 * Reemplaza a la página 14 de APEX (el listado), a su modal 15 (la ficha) y a
 * los modales 63 a 66 (Nominado por, Referencias personales, Estudios y
 * Situación laboral). En el sitio la ficha es una pantalla (`/facilitadores/$id`)
 * y esas cuatro listas son secciones de ella: se guardan junto con la ficha, en
 * una sola transacción, y se pueden cargar desde el alta.
 *
 * La ficha viaja entera como TEXTO en el campo `datos`: ORDS bindea solo los
 * campos escalares del body (ver el encabezado del `.sql`).
 */

import { authFetch } from "@/lib/api";
import type { ValorLista } from "@/lib/utils";

export type Uso = { tabla: string; cantidad: number };

export type FacilitadorFila = {
  id: number;
  nombre: string;
  ci: string;
  telefono: string;
  email: string;
  usuario: string;
  activo: boolean;
  ciudad: string;
  departamento: string;
  barrio: string;
  nacionalidad: string;
  usos: Uso[];
};

/** Vive en `lib/utils` desde el 09/10/2026: la usan también otras fichas. */
export type { ValorLista };

export type OpcionesFacilitador = {
  si_no: ValorLista[];
  estado_civil: ValorLista[];
  con_quien_vive: ValorLista[];
  nivel_academico: ValorLista[];
  tipo_factura: ValorLista[];
};

/** Fila de Nominado por o de Referencias personales. `id` null = nueva. */
export type Persona = {
  id: number | null;
  tipo_relacion: string;
  nombre_apellido: string;
  nro_telefono: string;
};
export type Estudio = { id: number | null; nivel_academico: string; titulo: string; anio: string };
export type Laboral = { id: number | null; empresa: string; cargo: string; anio: string };

/** Los campos de texto de la ficha, con el nombre de su columna en minúsculas. */
export const CAMPOS_TEXTO = [
  "usuario",
  "nombre_apellido",
  "nro_ci",
  "fecha_nacimiento",
  "estado_civil",
  "con_quien_vive",
  "hijos",
  "fecha_ingreso",
  "telefono",
  "activo",
  "direccion",
  "ubicacion",
  "email",
  "observacion",
  "vehiculo",
  "tipo_vehiculo",
  "computadora",
  "internet",
  "office",
  "denominacion",
  "nombre_iglesia",
  "nombre_pastor",
  "nro_telefono_pastor",
  "nombre_lider",
  "nro_telefono_lider",
  "bautizado_agua",
  "area_servicio",
  "nombre_banco",
  "sucursal_banco",
  "titular_banco",
  "nro_ci_titular_banco",
  "tipo_cuenta",
  "nro_cuenta",
  "nombre_emisor",
  "ruc",
  "tipo_factura",
  "credencial",
  "ind_ubicacion_postulacion",
] as const;
export type CampoTexto = (typeof CAMPOS_TEXTO)[number];

export type Ficha = Record<CampoTexto, string> & {
  id_nacionalidad: number | null;
  id_ciudad: number | null;
  id_barrio: number | null;
  nominados: Persona[];
  referencias: Persona[];
  estudios: Estudio[];
  laborales: Laboral[];
};

export type FichaGuardada = Ficha & {
  id: number;
  ciudad: string;
  departamento: string;
  barrio: string;
  usos: Uso[];
};

/** Una ficha vacía, para el alta. */
export function fichaVacia(): Ficha {
  const f = Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, ""])) as Record<CampoTexto, string>;
  return {
    ...f,
    id_nacionalidad: null,
    id_ciudad: null,
    id_barrio: null,
    nominados: [],
    referencias: [],
    estudios: [],
    laborales: [],
  };
}

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const usos = (v: unknown): Uso[] =>
  ((v as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
    tabla: s(u.tabla),
    cantidad: Number(u.cantidad ?? 0),
  }));

export async function listarFacilitadores(): Promise<FacilitadorFila[]> {
  const r = (await authFetch("facilitadores")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_facilitador),
    nombre: s(x.nombre_apellido),
    ci: s(x.nro_ci),
    telefono: s(x.telefono),
    email: s(x.email),
    usuario: s(x.usuario),
    activo: x.es_activo === "S",
    ciudad: s(x.ciudad),
    departamento: s(x.departamento),
    barrio: s(x.barrio),
    nacionalidad: s(x.nacionalidad),
    usos: usos(x.usos),
  }));
}

export async function opcionesFacilitador(): Promise<OpcionesFacilitador> {
  const r = (await authFetch("facilitadores/opciones")) as Record<string, unknown>;
  const lista = (k: string): ValorLista[] =>
    ((r[k] as Record<string, unknown>[] | undefined) ?? []).map((o) => ({
      valor: s(o.valor),
      mostrar: s(o.mostrar) || s(o.valor),
    }));
  return {
    si_no: lista("si_no"),
    estado_civil: lista("estado_civil"),
    con_quien_vive: lista("con_quien_vive"),
    nivel_academico: lista("nivel_academico"),
    tipo_factura: lista("tipo_factura"),
  };
}

export async function obtenerFacilitador(id: number): Promise<FichaGuardada> {
  const r = (await authFetch(`facilitadores/${id}`)) as { data?: Record<string, unknown> };
  const d = r.data ?? {};
  const lista = <T>(k: string, f: (x: Record<string, unknown>) => T): T[] =>
    ((d[k] as Record<string, unknown>[] | undefined) ?? []).map(f);
  const persona = (x: Record<string, unknown>): Persona => ({
    id: n(x.id),
    tipo_relacion: s(x.tipo_relacion),
    nombre_apellido: s(x.nombre_apellido),
    nro_telefono: s(x.nro_telefono),
  });
  return {
    ...(Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, s(d[c])])) as Record<CampoTexto, string>),
    id: Number(d.id_facilitador),
    id_nacionalidad: n(d.id_nacionalidad),
    id_ciudad: n(d.id_ciudad),
    id_barrio: n(d.id_barrio),
    ciudad: s(d.ciudad),
    departamento: s(d.departamento),
    barrio: s(d.barrio),
    usos: usos(d.usos),
    nominados: lista("nominados", persona),
    referencias: lista("referencias", persona),
    estudios: lista("estudios", (x) => ({
      id: n(x.id),
      nivel_academico: s(x.nivel_academico),
      titulo: s(x.titulo),
      anio: s(x.anio),
    })),
    laborales: lista("laborales", (x) => ({
      id: n(x.id),
      empresa: s(x.empresa),
      cargo: s(x.cargo),
      anio: s(x.anio),
    })),
  };
}

/** Alta (`id` null) o modificación, con sus cuatro listas. Devuelve el id. */
export async function guardarFacilitador(id: number | null, ficha: Ficha): Promise<number> {
  const r = (await authFetch(id == null ? "facilitadores" : `facilitadores/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datos: JSON.stringify(ficha) }),
  })) as { id_facilitador?: number };
  return Number(r.id_facilitador ?? id ?? 0);
}

/** Baja, con sus cuatro listas. El backend responde 409 si algo más lo usa. */
export async function eliminarFacilitador(id: number): Promise<void> {
  await authFetch(`facilitadores/${id}`, { method: "DELETE" });
}

/** "en 12 postulaciones y 3 evaluaciones", o `null` si no se usa. */
export function textoUsos(u: Uso[]): string | null {
  if (!u.length) return null;
  const partes = u.map((x) => `${x.cantidad} ${x.tabla.toLowerCase().replace(/_/g, " ")}`);
  const ultimo = partes.pop();
  return `en ${partes.length ? `${partes.join(", ")} y ${ultimo}` : ultimo}`;
}

/** Si un valor de SI_NO es el "sí" (S, Si, Sí…). */
export const esSi = (v: string) => /^s/i.test(v.trim());

export const keysFacilitadores = {
  todo: ["facilitadores"] as const,
  lista: ["facilitadores", "lista"] as const,
  opciones: ["facilitadores", "opciones"] as const,
  ficha: (id: number) => ["facilitadores", "ficha", id] as const,
};
