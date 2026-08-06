/**
 * Carga manual de intervenciones. **Escribe sobre `INTERVENCIONES`.**
 *
 * Contrato del backend: `backend/intervenciones_crud.sql`.
 *
 * ============================================================================
 * NO CONFUNDIR CON `lib/intervenciones.ts`
 * ============================================================================
 *
 * Son dos módulos sobre la misma tabla y hacen cosas distintas:
 *
 * | | `intervenciones.ts` | este |
 * | --- | --- | --- |
 * | Endpoint | `intervenciones` | `intervenciones-crud` |
 * | Qué hace | solo lee | lee y escribe |
 * | Qué filas | **solo las desviadas** (15+ min o 1+ km) | **todas** |
 * | Para qué | los gráficos del inicio | el formulario de carga |
 *
 * Aquel filtra por desvío en el backend; este no filtra nada, porque para
 * corregir una intervención hay que poder encontrarla aunque fuera puntual.
 *
 * ============================================================================
 * LA POSTULACIÓN ES EL EJE: DE ELLA SALEN SEIS CAMPOS
 * ============================================================================
 *
 * El formulario manda `id_postulacion` y el backend deriva `id_institucion`,
 * `id_facilitador`, `turno`, `grado`, `seccion` e `id_enfasis`. Mandarlos por
 * separado permitiría guardar una intervención cuya institución no fuera la de
 * su propia postulación; derivarlos lo hace imposible.
 *
 * `usuario`, `anio` y `manual` tampoco se mandan: los pone el backend o un
 * trigger. Ver el encabezado del SQL.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Una intervención                                                           */
/* -------------------------------------------------------------------------- */

/** Una fila de `INTERVENCIONES`, con los nombres ya unidos por el backend. */
export type IntervencionCrud = {
  id_intervencion: number;
  id_facilitador: number;
  nombre_facilitador: string | null;
  id_institucion: number;
  institucion: string | null;
  id_postulacion: number;
  /** 1/2/3 crudo. La etiqueta la pone `nombreTurno` de `lib/evaluaciones.ts`. */
  turno: number | null;
  grado: string | null;
  seccion: string | null;
  id_enfasis: number | null;
  enfasis: string | null;
  manual: string | null;
  id_indice: number;
  nro_indice: number | null;
  indice_titulo: string | null;
  /** `'Si'` / `'No'`. Texto libre en la base, pero el backend normaliza. */
  si_no: string;
  /** Obligatorio cuando `si_no` es `'No'`: lo exige un trigger. */
  motivo_desarrollo: string | null;
  observacion: string | null;
  /** `DD/MM/YYYY`, ya formateada por el backend. */
  fecha: string | null;
  /** `HH:MM`. Es la que alimenta el gráfico de puntualidad. */
  hora: string | null;
  latitud: string | null;
  longitud: string | null;
  anio: string | null;
};

/** Lo que el formulario manda al guardar. */
export type IntervencionInput = {
  /** El eje: de acá salen institución, facilitador, turno, grado y énfasis. */
  id_postulacion: number;
  id_indice: number;
  si_no: "Si" | "No";
  /**
   * `DD/MM/YYYY HH24:MI`. **Mandarla siempre en carga atrasada.**
   *
   * El trigger `TRG_INTERVENCIONES_SET_FECHA` solo la completa si llega vacía, y
   * ahí pone la de hoy — que para una intervención de hace dos meses es
   * incorrecta y además la saca del mes que corresponde en los gráficos.
   */
  fecha_hora?: string;
  /** Obligatorio si `si_no` es `'No'`; el backend rechaza con 400 si falta. */
  motivo_desarrollo?: string;
  observacion?: string;
  /**
   * Coordenadas de donde se hizo la marcación. Sin ellas el backend guarda
   * `'0'`/`'0'`, que `f_distancia` lee como "no se sabe" — así una carga manual
   * no inventa una infracción en el gráfico de ubicación.
   */
  latitud?: string;
  longitud?: string;
  /** Solo si la postulación cubre varios grados y hay que elegir uno. */
  grado?: string;
  seccion?: string;
};

export type FiltrosCrud = {
  anio?: string;
  /** Número (1-12) o nombre en español: el backend acepta las dos formas. */
  mes?: string | number;
  id_facilitador?: number;
  id_institucion?: number;
  /** Busca en facilitador, institución y manual. */
  buscar?: string;
  limite?: number;
  pagina?: number;
};

export type PaginaCrud = {
  data: IntervencionCrud[];
  total: number;
  pagina: number;
  limite: number;
};

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

function mapear(row: Record<string, unknown>): IntervencionCrud {
  return {
    id_intervencion: Number(row.id_intervencion),
    id_facilitador: Number(row.id_facilitador),
    nombre_facilitador: (row.nombre_facilitador as string) ?? null,
    id_institucion: Number(row.id_institucion),
    institucion: (row.institucion as string) ?? null,
    id_postulacion: Number(row.id_postulacion),
    turno: row.turno == null ? null : Number(row.turno),
    grado: (row.grado as string) ?? null,
    seccion: (row.seccion as string) ?? null,
    id_enfasis: row.id_enfasis == null ? null : Number(row.id_enfasis),
    enfasis: (row.enfasis as string) ?? null,
    manual: (row.manual as string) ?? null,
    id_indice: Number(row.id_indice),
    nro_indice: row.nro_indice == null ? null : Number(row.nro_indice),
    indice_titulo: (row.indice_titulo as string) ?? null,
    si_no: String(row.si_no ?? ""),
    motivo_desarrollo: (row.motivo_desarrollo as string) ?? null,
    observacion: (row.observacion as string) ?? null,
    fecha: (row.fecha as string) ?? null,
    hora: (row.hora as string) ?? null,
    latitud: (row.latitud as string) ?? null,
    longitud: (row.longitud as string) ?? null,
    anio: (row.anio as string) ?? null,
  };
}

/** La lista paginada. Todos los filtros son opcionales. */
export async function listarCrud(f: FiltrosCrud = {}): Promise<PaginaCrud> {
  const r = (await authFetch(`intervenciones-crud${qs({ ...f })}`)) as {
    data?: Record<string, unknown>[];
    total?: number;
    pagina?: number;
    limite?: number;
  };

  return {
    data: (r.data ?? []).map(mapear),
    total: Number(r.total ?? 0),
    pagina: Number(r.pagina ?? 1),
    limite: Number(r.limite ?? 50),
  };
}

/** Una intervención, para editarla. */
export async function obtenerCrud(id: number): Promise<IntervencionCrud> {
  const r = (await authFetch(`intervenciones-crud/${id}`)) as {
    data?: Record<string, unknown>;
  };
  return mapear(r.data ?? {});
}

/** Alta. Devuelve el id generado por Oracle. */
export async function crearIntervencion(input: IntervencionInput): Promise<number> {
  const r = (await authFetch("intervenciones-crud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as { id_intervencion?: number };
  return Number(r.id_intervencion ?? 0);
}

/** Modificación. */
export async function actualizarIntervencion(
  id: number,
  input: IntervencionInput,
): Promise<void> {
  await authFetch(`intervenciones-crud/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Lo que devuelve el borrado, que no es solo "listo". */
export type ResultadoEliminar = {
  /**
   * `true` si esta intervención era la que había finalizado su postulación.
   *
   * **Importa porque no se revierte.** `TRG_INTERV_FINALIZA_POST` marca la
   * postulación como `'Finalizado'` al cargar el último índice del manual con
   * `'Si'`, y no hay trigger inverso: borrar la intervención deja la
   * postulación finalizada igual. La UI tiene que avisarlo.
   */
  postulacion_finalizada: boolean;
  /** Para poder nombrarla en el aviso. */
  id_postulacion: number | null;
};

/** Baja. Ver `ResultadoEliminar`: puede dejar una postulación mal marcada. */
export async function eliminarIntervencion(id: number): Promise<ResultadoEliminar> {
  const r = (await authFetch(`intervenciones-crud/${id}`, { method: "DELETE" })) as {
    postulacion_finalizada?: boolean;
    id_postulacion?: number;
  };
  return {
    postulacion_finalizada: r.postulacion_finalizada === true,
    id_postulacion: r.id_postulacion == null ? null : Number(r.id_postulacion),
  };
}

/* -------------------------------------------------------------------------- */
/* Manuales                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Los manuales, sin repetir. Primer combo de la cascada Manual → Índice.
 *
 * ## POR QUÉ NO USA `lista()` COMO LOS OTROS COMBOS
 *
 * `INDICES_MANUALES` **no tiene tabla de manuales**: `MANUAL` es un
 * `VARCHAR2(100)` de la propia fila, y el `SELECT DISTINCT` del backend *es* el
 * catálogo. Así que el identificador de un manual **es su texto**, no un número.
 *
 * `lista()` normaliza todo a `{ id: number, texto }`, y meter esto ahí obligaría
 * a inventar un id numérico que no existe en ningún lado. Devuelve strings.
 *
 * Consecuencia conocida: un typo crea un manual nuevo, porque nada lo valida
 * contra un catálogo. Hoy no molesta —esas filas las carga el equipo— pero es
 * la razón por la que el selector es un `<select>` cerrado y no un campo libre.
 */
export async function listarManuales(): Promise<string[]> {
  const r = (await authFetch("listas/manuales")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => String(row.manual ?? "")).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Ubicación del navegador                                                    */
/* -------------------------------------------------------------------------- */

export type Coordenadas = { latitud: string; longitud: string };

/**
 * La posición actual, con la API nativa del navegador.
 *
 * **Sin librería a propósito:** `navigator.geolocation` ya está en la WebView
 * del APK y en cualquier navegador. Un paquete de npm para esto agregaría una
 * dependencia —y en el APK, un plugin nativo, que rompería el OTA— sin aportar
 * nada que esta API no dé.
 *
 * ## LEER ESTO ANTES DE USARLA EN CARGA ATRASADA
 *
 * Devuelve dónde estás **ahora**, no dónde estuvo el facilitador ese día. Si se
 * carga una intervención de hace dos meses desde la oficina, estas coordenadas
 * quedan a kilómetros de la institución y el gráfico de Ubicación la va a
 * mostrar como una infracción **que nunca ocurrió**.
 *
 * Por eso el formulario la ofrece pero no la impone: muestra la distancia a la
 * institución antes de guardar y deja descartarla. Sin coordenadas se guarda
 * `'0'`/`'0'`, que el backend lee como "no se sabe".
 *
 * Rechaza con un mensaje ya escrito para mostrar: los códigos de error de esta
 * API (`PERMISSION_DENIED`, etc.) no son legibles por sí solos.
 */
export function ubicacionActual(): Promise<Coordenadas> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Este dispositivo no permite obtener la ubicación."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          // Como texto porque la columna es VARCHAR2 y así viaja sin que la
          // notación científica de un número muy chico rompa el parseo de Oracle.
          latitud: String(pos.coords.latitude),
          longitud: String(pos.coords.longitude),
        }),
      (err) => {
        const mensajes: Record<number, string> = {
          1: "Permiso de ubicación denegado. Habilitalo para el sitio o la app.",
          2: "No se pudo determinar la ubicación. Revisá el GPS o la señal.",
          3: "La ubicación tardó demasiado. Intentá de nuevo.",
        };
        reject(new Error(mensajes[err.code] ?? "No se pudo obtener la ubicación."));
      },
      {
        // Alta precisión: el umbral del gráfico de ubicación es 1 km, pero una
        // marcación mal ubicada por 500 m ya confunde al leer el detalle.
        enableHighAccuracy: true,
        timeout: 15_000,
        // Sin caché: una posición de hace 5 minutos puede ser de otra cuadra.
        maximumAge: 0,
      },
    );
  });
}

/**
 * Metros entre dos puntos (haversine). **Espejo de `f_distancia` del backend.**
 *
 * Está acá para poder mostrarle al usuario a qué distancia de la institución
 * quedó la ubicación capturada **antes** de guardar. El backend vuelve a
 * calcularla al leer; esto es solo para la advertencia del formulario.
 *
 * `null` si falta alguna coordenada o si alguna es (0,0) — el "null island" que
 * escribe `TRG_INTERV_UBICACION`, que significa "no se sabe", no "a 6.000 km".
 */
export function distanciaMetros(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
): number | null {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  if ((lat1 === 0 && lon1 === 0) || (lat2 === 0 && lon2 === 0)) return null;
  if (Math.abs(lat1) > 90 || Math.abs(lat2) > 90) return null;
  if (Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return null;

  const R = 6_371_000; // radio medio de la Tierra, en metros
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;

  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Query string sin claves vacías. Igual que en los otros módulos. */
function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * `Date` → `DD/MM/YYYY HH24:MI`, que es lo que espera el backend.
 *
 * Se arma a mano y no con `toLocaleString` porque ese formato depende del
 * locale del dispositivo: un teléfono en inglés devolvería `8/5/2026, 3:04 PM`
 * y el `TO_DATE` de Oracle fallaría con ORA-01861.
 */
export function fechaHoraOracle(fecha: string, hora: string): string {
  return `${fecha} ${hora}`;
}

/** `YYYY-MM-DD` (lo que da un `<input type="date">`) → `DD/MM/YYYY`. */
export function isoADdmmyyyy(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : "";
}

/** `DD/MM/YYYY` → `YYYY-MM-DD`, para precargar el `<input type="date">`. */
export function ddmmyyyyAIso(fecha: string): string {
  const [d, m, a] = fecha.split("/");
  return d && m && a ? `${a}-${m}-${d}` : "";
}

export const keysCrud = {
  lista: (f: FiltrosCrud) => ["intervenciones-crud", f] as const,
  uno: (id: number) => ["intervenciones-crud", id] as const,
};
