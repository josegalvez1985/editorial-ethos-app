/**
 * Cliente de evaluaciones de facilitadores y sus listas de valores.
 *
 * Contrato del backend: `backend/ethos_evaluaciones_facilitadores.sql`.
 * Todo pasa por `authFetch`, que mete el Bearer y detecta el token vencido.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

/** Lo que devuelve el backend, con los nombres ya resueltos por los joins. */
export type Evaluacion = {
  id_evaluacion_facilitador: number;
  id_facilitador: number;
  facilitador: string | null;
  id_institucion: number;
  institucion: string | null;
  id_ciudad: number;
  ciudad: string | null;
  /** ISO `YYYY-MM-DD`. */
  fecha_desde: string;
  fecha_hasta: string;
  evaluado_por: string;
  id_area: number;
  area: string | null;
  id_evaluacion: number;
  evaluacion: string | null;
  calificacion_estrellas: number | null;
  aspectos_positivos: string | null;
  aspectos_mejorar: string | null;
  calificacion: string | null;
  /** Solo lectura: lo pone el trigger de bitácora. */
  id_auditoria: number | null;
};

/** Lo que se manda al crear o actualizar. Sin nombres ni id_auditoria. */
export type EvaluacionInput = {
  id_facilitador: number | null;
  id_institucion: number | null;
  id_ciudad: number | null;
  fecha_desde: string;
  fecha_hasta: string;
  evaluado_por: string;
  id_area: number | null;
  id_evaluacion: number | null;
  calificacion_estrellas: number | null;
  aspectos_positivos: string;
  aspectos_mejorar: string;
  calificacion: string;
};

export type Filtros = {
  buscar?: string;
  id_facilitador?: number | null;
  id_institucion?: number | null;
  id_area?: number | null;
  id_evaluacion?: number | null;
  desde?: string;
  hasta?: string;
  pagina?: number;
  limite?: number;
};

export type Pagina = {
  data: Evaluacion[];
  total: number;
  pagina: number;
  limite: number;
};

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Query string sin claves vacías: el backend trata "no vino" como "sin filtro",
 * y mandar `?id_area=` haría un TO_NUMBER('') inútil en cada request.
 */
function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* -------------------------------------------------------------------------- */
/* Evaluaciones                                                               */
/* -------------------------------------------------------------------------- */

export const LIMITE = 20;

export async function listarEvaluaciones(f: Filtros = {}): Promise<Pagina> {
  const r = (await authFetch(
    `evaluaciones-facilitadores${qs({ ...f, limite: f.limite ?? LIMITE })}`,
  )) as Partial<Pagina>;
  return {
    data: r.data ?? [],
    total: r.total ?? 0,
    pagina: r.pagina ?? 1,
    limite: r.limite ?? LIMITE,
  };
}

export async function obtenerEvaluacion(id: number): Promise<Evaluacion> {
  const r = (await authFetch(`evaluaciones-facilitadores/${id}`)) as { data: Evaluacion };
  return r.data;
}

export async function crearEvaluacion(input: EvaluacionInput): Promise<number> {
  const r = (await authFetch("evaluaciones-facilitadores", json(input))) as {
    id_evaluacion_facilitador: number;
  };
  return r.id_evaluacion_facilitador;
}

export async function actualizarEvaluacion(id: number, input: EvaluacionInput): Promise<void> {
  await authFetch(`evaluaciones-facilitadores/${id}`, { ...json(input), method: "PUT" });
}

export async function eliminarEvaluacion(id: number): Promise<void> {
  await authFetch(`evaluaciones-facilitadores/${id}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* Listas de valores                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Forma común de todos los combos. El backend devuelve cada campo con su nombre
 * real (`nombre_apellido`, `nombre`, `descripcion`); acá se normaliza a
 * `{ id, texto }` para que un solo componente sirva para los cinco.
 *
 * `busqueda` es todos los valores de la fila concatenados en minúsculas. Sirve
 * para que el buscador del modal filtre por cualquier dato cargado (CI, estado,
 * id, no solo el nombre) sin volver a pedirle nada al servidor.
 */
export type Opcion = {
  id: number;
  texto: string;
  extra?: string;
  busqueda: string;
  /**
   * Solo en `instituciones`: la ciudad de la institución, para cargarla sola en
   * el formulario. `null` cuando la institución no tiene ciudad asignada
   * (INSTITUCIONES.ID_CIUDAD es nullable) — ahí el front debe pedirla a mano.
   */
  idCiudad?: number | null;
  ciudad?: string | null;
};

/** Todos los valores no nulos de la fila, en minúsculas, para filtrar en memoria. */
function indexar(row: Record<string, unknown>) {
  return Object.values(row)
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).toLowerCase())
    .join(" ");
}

type LovNombre = "facilitadores" | "instituciones" | "areas" | "evaluaciones" | "ciudades";

type LovParams = {
  buscar?: string;
  /** Solo `evaluaciones`: el área elegida. Obligatorio en la práctica. */
  id_area?: number | null;
  /** Solo facilitadores/instituciones: incluye ese id aunque esté inactivo. */
  incluir_id?: number | null;
  /** Solo `instituciones`: las del facilitador, vía POSTULACIONES. */
  id_facilitador?: number | null;
  /** Solo `instituciones`: año lectivo de la postulación. */
  anio?: string;
  limite?: number;
};

export async function lista(nombre: LovNombre, params: LovParams = {}): Promise<Opcion[]> {
  const r = (await authFetch(`listas/${nombre}${qs(params)}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row): Opcion => {
    const busqueda = indexar(row);
    switch (nombre) {
      case "facilitadores":
        return {
          id: Number(row.id_facilitador),
          texto: String(row.nombre_apellido ?? ""),
          // Se marca porque solo aparece si se pidió con incluir_id o activo=TODOS.
          extra: String(row.activo ?? "").toUpperCase() === "NO" ? "inactivo" : undefined,
          busqueda,
        };
      case "instituciones":
        return {
          id: Number(row.id_institucion),
          texto: String(row.nombre ?? ""),
          // La ciudad se muestra como dato secundario y además alimenta la carga
          // automática del campo Ciudad en el formulario.
          extra:
            [
              String(row.estado ?? "").toUpperCase() === "I" ? "inactiva" : null,
              row.ciudad ? String(row.ciudad) : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          busqueda,
          idCiudad: row.id_ciudad == null ? null : Number(row.id_ciudad),
          ciudad: row.ciudad == null ? null : String(row.ciudad),
        };
      case "areas":
        return { id: Number(row.id_area), texto: String(row.descripcion ?? ""), busqueda };
      case "evaluaciones":
        return { id: Number(row.id_evaluacion), texto: String(row.descripcion ?? ""), busqueda };
      case "ciudades":
        return { id: Number(row.id_ciudad), texto: String(row.nombre ?? ""), busqueda };
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

export const keys = {
  evaluaciones: (f: Filtros = {}) => ["evaluaciones", f] as const,
  evaluacion: (id: number) => ["evaluacion", id] as const,
  lista: (nombre: LovNombre, params: LovParams = {}) => ["lista", nombre, params] as const,
};

/** Los combos casi no cambian: no vale re-pedirlos en cada apertura. */
export const STALE_LISTAS = 5 * 60 * 1000;
