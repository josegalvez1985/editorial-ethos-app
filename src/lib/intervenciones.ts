/**
 * Historial de marcaciones de los facilitadores.
 *
 * Contrato del backend: `backend/intervenciones.sql`.
 *
 * ============================================================================
 * UN SOLO ENDPOINT
 * ============================================================================
 *
 * `GET intervenciones?anio=&mes=` devuelve las filas crudas de
 * `V_HISTORIAL_INTERVENCIONES` — una por marcación, con los grados agrupados.
 *
 * El gráfico del inicio se arma ACÁ, agrupando esas filas por facilitador
 * (`agruparPorFacilitador`). Son pocas filas por mes, y tener un endpoint
 * agregado aparte obligaría a mantener el mismo criterio en dos consultas SQL
 * distintas.
 *
 * ============================================================================
 * `diferencia_minutos`: LEER ESTO ANTES DE USARLA
 * ============================================================================
 *
 * Viene de la consulta que ya se usaba en APEX, y tiene **dos rarezas que se
 * conservaron a propósito** para que los números coincidan con los de allá:
 *
 *   ROUND((HORA_DESDE − HORA) * 24 * 60, 0) / 60
 *
 * 1. **El signo está invertido** respecto de lo que sugiere el nombre: el
 *    minuendo es la hora de inicio de la clase y el sustraendo la hora en que
 *    marcó. Entonces **positivo = llegó ANTES**, negativo = llegó tarde.
 * 2. **Está en HORAS, no en minutos**, por el `/ 60` final.
 *
 * Por eso este módulo no la usa directo: `atrasoMinutos()` la convierte a
 * "minutos de atraso" con el signo derecho, que es lo que la UI muestra.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Una marcación                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Una fila de `V_HISTORIAL_INTERVENCIONES`, con los grados ya agrupados por el
 * backend ("7mo, 8vo": una marcación puede cubrir varios).
 *
 * Casi todo es opcional porque en la vista casi todo puede venir en null.
 */
export type Intervencion = {
  id_intervencion: number;
  fecha: string | null;
  /** `HH:MM`. La hora en que efectivamente marcó. */
  hora: string | null;
  /** `HH:MM`. La hora en que empezaba la clase. */
  hora_desde: string | null;
  hora_hasta: string | null;
  /**
   * **En horas y con el signo invertido** (positivo = llegó antes). Tal cual la
   * consulta original. Usar `atrasoMinutos()` en vez de esto.
   *
   * `null` si alguna de las dos horas falta o no parsea: ahí no se puede
   * calcular, y un 0 diría "llegó puntual", que el dato no respalda.
   */
  diferencia_minutos: number | null;
  id_facilitador: number | null;
  nombre_facilitador: string | null;
  id_institucion: number | null;
  /** El nombre de la institución. La vista la llama `NOMBRE` a secas. */
  nombre: string | null;
  turno: number | null;
  /** Los grados de ESA marcación, juntos: "7mo, 8vo". */
  grado: string | null;
  seccion: string | null;
  id_enfasis: number | null;
  /** La descripción del énfasis. */
  descripcion: string | null;
  manual: string | null;
  id_indice: number | null;
  /** `'Si'` / `'No'`: si el índice se desarrolló. Texto libre en la base. */
  si_no: string | null;
  observacion: string | null;
  /** Obligatorio cuando `si_no` es 'No': por qué no se desarrolló. */
  motivo_desarrollo: string | null;
  mes: string | null;
  anio: string | null;
  /** Ya normalizadas con punto decimal por el backend. */
  latitud: string | null;
  longitud: string | null;
  ubicacion_institucion: string | null;
};

/**
 * Los minutos de ATRASO de una marcación: positivo = llegó tarde.
 *
 * Invierte el signo de `diferencia_minutos` y la vuelve a minutos (viene en
 * horas). Ver el encabezado del módulo.
 *
 * **Los adelantos cuentan como 0.** Llegar 5 minutos antes no compensa llegar 5
 * tarde otro día: si se promediaran juntos, alguien irregular daría ~0 y
 * parecería puntual.
 */
export function atrasoMinutos(i: Intervencion): number | null {
  if (i.diferencia_minutos === null) return null;
  // × −60: invierte el signo y deshace el `/ 60` del SQL.
  return Math.max(Math.round(i.diferencia_minutos * -60), 0);
}

/**
 * El historial del período. **Es la única llamada del módulo.**
 *
 * @param anio `"YYYY"`. Sin él, el año en curso. `"TODOS"` lo apaga.
 * @param mes  1–12. Sin él, todo el año.
 */
export async function listarIntervenciones(
  anio?: string,
  mes?: number,
  id_facilitador?: number,
): Promise<Intervencion[]> {
  const r = (await authFetch(`intervenciones${qs({ anio, mes, id_facilitador })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_intervencion: Number(row.id_intervencion),
    fecha: (row.fecha as string) ?? null,
    hora: (row.hora as string) ?? null,
    hora_desde: (row.hora_desde as string) ?? null,
    hora_hasta: (row.hora_hasta as string) ?? null,
    diferencia_minutos: row.diferencia_minutos == null ? null : Number(row.diferencia_minutos),
    id_facilitador: row.id_facilitador == null ? null : Number(row.id_facilitador),
    nombre_facilitador: (row.nombre_facilitador as string) ?? null,
    id_institucion: row.id_institucion == null ? null : Number(row.id_institucion),
    nombre: (row.nombre as string) ?? null,
    turno: row.turno == null ? null : Number(row.turno),
    grado: (row.grado as string) ?? null,
    seccion: (row.seccion as string) ?? null,
    id_enfasis: row.id_enfasis == null ? null : Number(row.id_enfasis),
    descripcion: (row.descripcion as string) ?? null,
    manual: (row.manual as string) ?? null,
    id_indice: row.id_indice == null ? null : Number(row.id_indice),
    si_no: (row.si_no as string) ?? null,
    observacion: (row.observacion as string) ?? null,
    motivo_desarrollo: (row.motivo_desarrollo as string) ?? null,
    mes: (row.mes as string) ?? null,
    anio: (row.anio as string) ?? null,
    latitud: (row.latitud as string) ?? null,
    longitud: (row.longitud as string) ?? null,
    ubicacion_institucion: (row.ubicacion_institucion as string) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* El agrupado para el gráfico                                                */
/* -------------------------------------------------------------------------- */

/** Una barra del gráfico: un facilitador con su atraso promedio. */
export type ResumenFacilitador = {
  id_facilitador: number;
  nombre_facilitador: string;
  /** Minutos de atraso promedio por marcación. Es el valor de la barra. */
  promedio: number;
  /** El peor atraso del período. */
  peor: number;
  /** Cuántas marcaciones se contaron (las que tienen hora calculable). */
  marcaciones: number;
  /** De esas, cuántas fueron tarde de verdad. */
  con_atraso: number;
  /** Las filas de ese facilitador, para el modal. */
  filas: Intervencion[];
};

/**
 * Agrupa las marcaciones por facilitador, **ordenado de mayor a menor atraso**.
 *
 * El promedio se calcula solo sobre las marcaciones con hora calculable: las que
 * no la tienen se guardan en `filas` (el modal las muestra) pero no entran en la
 * cuenta. Contarlas como 0 diría "llegó puntual", que el dato no respalda.
 *
 * Los facilitadores sin ninguna marcación calculable quedan fuera del gráfico:
 * una barra en 0 diría que fue puntual, no que no se sabe.
 */
export function agruparPorFacilitador(filas: Intervencion[]): ResumenFacilitador[] {
  const porId = new Map<number, Intervencion[]>();

  for (const f of filas) {
    if (f.id_facilitador == null) continue; // sin facilitador no hay barra
    const ya = porId.get(f.id_facilitador);
    if (ya) ya.push(f);
    else porId.set(f.id_facilitador, [f]);
  }

  const salida: ResumenFacilitador[] = [];

  for (const [id, suyas] of porId) {
    const atrasos = suyas.map(atrasoMinutos).filter((m): m is number => m !== null);

    if (!atrasos.length) continue; // ninguna hora calculable: no se grafica

    salida.push({
      id_facilitador: id,
      nombre_facilitador:
        suyas.find((f) => f.nombre_facilitador)?.nombre_facilitador ?? `Facilitador #${id}`,
      promedio: Math.round((atrasos.reduce((a, b) => a + b, 0) / atrasos.length) * 10) / 10,
      peor: Math.max(...atrasos),
      marcaciones: atrasos.length,
      con_atraso: atrasos.filter((m) => m > 0).length,
      filas: suyas,
    });
  }

  return salida.sort((a, b) => b.promedio - a.promedio || b.marcaciones - a.marcaciones);
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Query string sin claves vacías. Igual que en `lib/evaluaciones.ts`. */
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
 * Los meses, para el selector. El VALOR es el número: el backend filtra por
 * `EXTRACT(MONTH FROM FECHA)`, no por el texto de la columna `MES` —que es
 * `VARCHAR2` y no se sabe con qué capitalización está cargado—.
 */
export const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Setiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** "8 min", "1 h 5 min". Los minutos sueltos se leen mal arriba de 60. */
export function formatearAtraso(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const keysIntervenciones = {
  historial: (anio: string, mes: number) => ["intervenciones", anio, mes] as const,
};
