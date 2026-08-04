/**
 * Cliente de evaluaciones de facilitadores y sus listas de valores.
 *
 * Contrato del backend: `backend/ethos_evaluaciones_facilitadores.sql`.
 * Todo pasa por `authFetch`, que mete el Bearer y detecta el token vencido.
 *
 * ============================================================================
 * CABECERA Y DETALLE, SIN TABLA DE CABECERA
 * ============================================================================
 *
 * Una evaluación es **un facilitador en una institución durante un período**, y
 * tiene varios detalles: un área + una evaluación de esa área + una estrella.
 *
 * En Oracle eso NO está modelado así. `EVALUACIONES_FACILITADORES` tiene una
 * fila por detalle y la cabecera (facilitador, institución, ciudad, fechas,
 * evaluado_por, aspectos) **se repite** en cada una. No hay columna que agrupe
 * las filas de una misma evaluación.
 *
 * Consecuencia: el agrupado lo hace este módulo, por clave natural
 * (`claveNatural`). Lo que eso implica, y no es un bug que se pueda arreglar
 * desde acá:
 *
 * 1. **La paginación puede partir un grupo.** El backend pagina FILAS. Si un
 *    grupo tiene 12 detalles y la página corta en el 8, se ven 8 y los otros 4
 *    aparecen como un grupo aparte en la página siguiente. Por eso el listado
 *    pide `limite` alto y no confía en `total` para contar evaluaciones.
 * 2. **Dos evaluaciones idénticas se fusionan.** Mismo facilitador, misma
 *    institución, mismas fechas y mismo evaluador = un solo grupo, aunque en la
 *    base sean dos cargas distintas.
 * 3. **Guardar y borrar son N llamadas**, sin transacción: si una falla, la
 *    evaluación queda a medias. `guardarEvaluacion` lo reporta.
 *
 * La salida de fondo es una columna de cabecera en la tabla. Está anotada en
 * `backend/README.md`.
 *
 * ============================================================================
 * LA ESTRELLA Y LA CALIFICACIÓN
 * ============================================================================
 *
 * La columna se llama **`ESCALA`** (antes `CALIFICACION_ESTRELLAS`) y guarda
 * **1 (marcada) o NULL (desmarcada)**. No se usa 0 porque el
 * `CHECK (ESCALA BETWEEN 1 AND 5)` lo rechaza.
 *
 * La calificación no se guarda: **se deriva** de cuántos detalles están
 * marcados, buscando ese número en `ESCALAS_EVALUACIONES`. La columna
 * `CALIFICACION` de la tabla se eliminó.
 *
 * OJO CON LA FK NUEVA. `ESCALA` tiene FK a `ESCALAS_EVALUACIONES.ESCALA`, cuyos
 * valores van de 1 a 12, pero el CHECK de esta tabla corta en 5. O sea que por
 * fila solo se pueden guardar escalas 1..5, y según los datos cargados esas
 * cinco filas son 'Deficiente' (1-3) y 'Aceptable' (4-5): 'Bueno' y 'Excelente'
 * son inalcanzables como valor de fila.
 *
 * Con el modelo actual eso no molesta —la fila solo usa el 1 como "marcada" y la
 * calificación sale del CONTEO, no de la FK—, pero si algún día la escala de la
 * fila pasa a ser la calificación de ese ítem, hay que ampliar el CHECK a 1..12
 * o recargar `ESCALAS_EVALUACIONES` con cinco niveles. Está en `backend/README.md`.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Una FILA del backend, con los nombres ya resueltos por los joins.
 *
 * Ojo: es un detalle, no una evaluación completa. Para lo segundo, `agrupar`.
 */
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
  /**
   * Antes `CALIFICACION_ESTRELLAS`. 1 = marcada, null = desmarcada.
   *
   * Nunca 0: el `CHECK (ESCALA BETWEEN 1 AND 5)` lo rechaza. Además tiene FK a
   * `ESCALAS_EVALUACIONES.ESCALA`, así que el valor tiene que existir en esa tabla.
   */
  escala: number | null;
  aspectos_positivos: string | null;
  aspectos_mejorar: string | null;
  /** Solo lectura: lo pone el trigger de bitácora. */
  id_auditoria: number | null;
};

/** La parte que se repite en todas las filas de una misma evaluación. */
export type Cabecera = {
  id_facilitador: number | null;
  id_institucion: number | null;
  id_ciudad: number | null;
  fecha_desde: string;
  fecha_hasta: string;
  evaluado_por: string;
  aspectos_positivos: string;
  aspectos_mejorar: string;
};

/** Un ítem evaluado. `id` es la fila en Oracle; null = todavía no se guardó. */
export type Detalle = {
  id: number | null;
  id_area: number;
  area: string | null;
  id_evaluacion: number;
  evaluacion: string | null;
  marcada: boolean;
};

/** Una evaluación completa, ya reconstruida a partir de sus filas. */
export type EvaluacionAgrupada = Cabecera & {
  clave: string;
  /** Fila más baja del grupo. Es con la que se navega a la pantalla de edición. */
  id: number;
  facilitador: string | null;
  institucion: string | null;
  ciudad: string | null;
  detalles: Detalle[];
  /** Cuántos detalles están marcados. Es el `ESCALA` de `ESCALAS_EVALUACIONES`. */
  marcadas: number;
  /** Derivada de `marcadas`. `null` con 0: la escala arranca en 1. */
  calificacion: Calificacion | null;
};

/** Lo que se manda por fila al crear o actualizar. Un POST/PUT = un detalle. */
export type EvaluacionInput = {
  id_facilitador: number | null;
  id_institucion: number | null;
  id_ciudad: number | null;
  fecha_desde: string;
  fecha_hasta: string;
  evaluado_por: string;
  id_area: number | null;
  id_evaluacion: number | null;
  escala: number | null;
  aspectos_positivos: string;
  aspectos_mejorar: string;
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
/* Escala de calificación                                                     */
/* -------------------------------------------------------------------------- */

export type Calificacion = { calificacion: string; descripcion: string };

/**
 * `ESCALAS_EVALUACIONES`, comprimida.
 *
 * La tabla tiene 12 filas (`ESCALA` 1..12) que son **cuatro tramos de tres**
 * repitiendo el mismo texto, así que acá va un tramo por fila con su tope. Está
 * cableada a propósito: el backend no expone `listas/escalas` y agregarlo era
 * otro handler ORDS y otro script para correr en APEX.
 *
 * SI SE EDITAN LOS TEXTOS EN LA BASE, HAY QUE TOCAR ESTO. No se enteran solos.
 */
export const ESCALA = [
  {
    hasta: 3,
    calificacion: "Deficiente",
    descripcion: "Requiere una mejora significativa en varios aspectos",
  },
  {
    hasta: 6,
    calificacion: "Aceptable",
    descripcion: "Hay un buen esfuerzo, pero es necesario trabajar en varias áreas.",
  },
  {
    hasta: 9,
    calificacion: "Bueno",
    descripcion: "El desempeño es adecuado, pero hay áreas con posibilidad de mejora.",
  },
  {
    hasta: 12,
    calificacion: "Excelente",
    descripcion: "El desempeño es sobresaliente en todas las áreas.",
  },
] as const;

/** El `ESCALA` más alto que tiene la tabla. */
export const ESCALA_MAXIMA = ESCALA[ESCALA.length - 1].hasta;

/**
 * La calificación que corresponde a N detalles marcados.
 *
 * `null` con 0 marcados: `ESCALAS_EVALUACIONES` no tiene fila con `ESCALA = 0`,
 * así que "ninguna marcada" no es un nivel, es la ausencia de calificación.
 *
 * Con más de {@link ESCALA_MAXIMA} marcados cae en el tramo más alto. Puede
 * pasar si en la base se cargan más ítems de evaluación que los 12 que la escala
 * contempla — el front no limita cuántos detalles se pueden marcar.
 */
export function calificacionDeConteo(marcadas: number): Calificacion | null {
  if (marcadas <= 0) return null;
  const tramo = ESCALA.find((t) => marcadas <= t.hasta) ?? ESCALA[ESCALA.length - 1];
  return { calificacion: tramo.calificacion, descripcion: tramo.descripcion };
}

/* -------------------------------------------------------------------------- */
/* Agrupar filas en evaluaciones                                              */
/* -------------------------------------------------------------------------- */

/**
 * Formatea un nombre propio: "jose galvez" -> "Jose Galvez".
 *
 * `evaluado_por` es texto tipeado a mano y venía como saliera —"JOSE GALVEZ",
 * "jose galvez", "Jose galvez"—, así que la misma persona se veía distinta en
 * cada evaluación. Esto lo deja siempre igual.
 *
 * ## Lo que hace
 *
 * - Primera letra de cada palabra en mayúscula, el resto en minúscula. Eso
 *   ARREGLA el texto en MAYÚSCULAS, que es el caso más común (tecla de bloqueo
 *   puesta) y el que peor se lee.
 * - Acepta **varios evaluadores** separados por coma: "jose galvez, elena baez"
 *   -> "Jose Galvez, Elena Baez". Se normaliza el espaciado alrededor de la
 *   coma, que es lo que hace que dos listas iguales se vean distintas.
 * - Colapsa los espacios de más y recorta las puntas.
 *
 * ## Lo que NO hace
 *
 * - **No toca las partículas** ("de", "del", "la", "van"). "Maria de la Cruz"
 *   queda "Maria De La Cruz". Es feo pero es lo correcto acá: la lista de
 *   partículas cambia según el apellido y el país, y equivocarse escribiendo
 *   mal un apellido ajeno es peor que una mayúscula de más. Si algún día se
 *   quiere, la lista va en una constante y se saltea cuando la palabra NO es la
 *   primera del nombre.
 * - No corrige la ortografía ni agrega tildes: "jose" queda "Jose", no "José".
 *   No hay forma de saber si la persona lleva tilde.
 *
 * Los acentos que el usuario SÍ escribió se respetan: `toLocaleUpperCase("es")`
 * mantiene "ángela" -> "Ángela".
 */
export function formatearNombre(valor: string): string {
  return valor
    .split(",")
    .map((parte) =>
      parte
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toLocaleUpperCase("es") + p.slice(1).toLocaleLowerCase("es"))
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

/**
 * Identifica a qué evaluación pertenece una fila.
 *
 * Es lo único que hay: la tabla no tiene columna de cabecera (ver la cabecera de
 * este archivo). `evaluado_por` se normaliza porque es texto tipeado a mano y
 * "Jose Galvez" y "jose galvez " tienen que caer en el mismo grupo.
 *
 * Sigue normalizando con `toLowerCase()` y NO con `formatearNombre()`, a
 * propósito: las evaluaciones ya guardadas tienen el texto como se tipeó
 * entonces, y agrupar por el formato lindo partiría en dos los grupos que
 * mezclan filas viejas y nuevas.
 *
 * NO incluye `id_ciudad` ni los aspectos: la ciudad se deriva de la institución
 * y los aspectos son texto largo que no aporta a la identidad del grupo.
 */
export function claveNatural(f: {
  id_facilitador: number | null;
  id_institucion: number | null;
  fecha_desde: string;
  fecha_hasta: string;
  evaluado_por: string;
}) {
  return [
    f.id_facilitador ?? "",
    f.id_institucion ?? "",
    f.fecha_desde,
    f.fecha_hasta,
    f.evaluado_por.trim().toLowerCase(),
  ].join("|");
}

/**
 * Reconstruye las evaluaciones a partir de las filas del backend.
 *
 * Conserva el orden de llegada (el backend ordena por `fecha_desde DESC`), así
 * que las evaluaciones salen de más reciente a más vieja sin re-ordenar nada.
 */
export function agrupar(filas: Evaluacion[]): EvaluacionAgrupada[] {
  const grupos = new Map<string, EvaluacionAgrupada>();

  for (const f of filas) {
    const clave = claveNatural(f);
    let g = grupos.get(clave);

    if (!g) {
      g = {
        clave,
        id: f.id_evaluacion_facilitador,
        id_facilitador: f.id_facilitador,
        facilitador: f.facilitador,
        id_institucion: f.id_institucion,
        institucion: f.institucion,
        id_ciudad: f.id_ciudad,
        ciudad: f.ciudad,
        fecha_desde: f.fecha_desde,
        fecha_hasta: f.fecha_hasta,
        evaluado_por: f.evaluado_por,
        aspectos_positivos: f.aspectos_positivos ?? "",
        aspectos_mejorar: f.aspectos_mejorar ?? "",
        detalles: [],
        marcadas: 0,
        calificacion: null,
      };
      grupos.set(clave, g);
    }

    // La fila más baja manda: es la que da el id con el que se navega, y así el
    // enlace de una evaluación no cambia cada vez que se agrega un detalle.
    if (f.id_evaluacion_facilitador < g.id) g.id = f.id_evaluacion_facilitador;

    // Los aspectos se repiten en cada fila, pero una carga vieja puede tenerlos
    // solo en una: se toma la primera no vacía en vez de la última.
    if (!g.aspectos_positivos && f.aspectos_positivos) g.aspectos_positivos = f.aspectos_positivos;
    if (!g.aspectos_mejorar && f.aspectos_mejorar) g.aspectos_mejorar = f.aspectos_mejorar;

    g.detalles.push({
      id: f.id_evaluacion_facilitador,
      id_area: f.id_area,
      area: f.area,
      id_evaluacion: f.id_evaluacion,
      evaluacion: f.evaluacion,
      marcada: f.escala === 1,
    });
  }

  for (const g of grupos.values()) {
    g.marcadas = g.detalles.filter((d) => d.marcada).length;
    g.calificacion = calificacionDeConteo(g.marcadas);
  }

  return [...grupos.values()];
}

/** Tope del backend por request. Se pide alto para no partir un grupo. */
export const LIMITE_DETALLES = 200;

/**
 * Carga una evaluación completa a partir del id de **una** de sus filas.
 *
 * Hacen falta dos requests porque `GET evaluaciones-facilitadores/:id` devuelve
 * una fila sola y no hay forma de pedir "las filas hermanas": se trae la fila,
 * y con sus datos de cabecera se filtra el listado para juntar el resto.
 *
 * El filtro por fechas del backend es por rango (`fecha_desde >= desde` y
 * `fecha_hasta <= hasta`), así que con las fechas exactas también entran
 * evaluaciones de períodos más cortos dentro del mismo rango. Por eso después se
 * filtra por clave natural y no se confía en que todo lo que vino sea del grupo.
 */
export async function obtenerEvaluacionAgrupada(id: number): Promise<EvaluacionAgrupada> {
  const fila = await obtenerEvaluacion(id);

  const pagina = await listarEvaluaciones({
    id_facilitador: fila.id_facilitador,
    id_institucion: fila.id_institucion,
    desde: fila.fecha_desde,
    hasta: fila.fecha_hasta,
    limite: LIMITE_DETALLES,
  });

  const clave = claveNatural(fila);
  const grupo = agrupar(pagina.data).find((g) => g.clave === clave);

  // Si el listado no lo trajo (más de LIMITE_DETALLES filas en ese rango), se
  // edita al menos la fila que sí tenemos en vez de mostrar un error.
  return grupo ?? agrupar([fila])[0];
}

/* -------------------------------------------------------------------------- */
/* Guardar una evaluación completa                                            */
/* -------------------------------------------------------------------------- */

/**
 * Arma el payload de una fila combinando la cabecera con uno de sus detalles.
 *
 * `evaluado_por` pasa por `formatearNombre()` ACÁ y no en el `onChange` del
 * input: formatear mientras se tipea pelea con el cursor —al escribir " " la
 * palabra anterior se capitaliza y el cursor salta— y además impide escribir un
 * apellido que de verdad lleve dos mayúsculas. Se normaliza al guardar, que es
 * cuando importa que quede parejo en la base.
 */
function filaInput(cab: Cabecera, d: Detalle): EvaluacionInput {
  return {
    id_facilitador: cab.id_facilitador,
    id_institucion: cab.id_institucion,
    id_ciudad: cab.id_ciudad,
    fecha_desde: cab.fecha_desde,
    fecha_hasta: cab.fecha_hasta,
    evaluado_por: formatearNombre(cab.evaluado_por),
    id_area: d.id_area,
    id_evaluacion: d.id_evaluacion,
    // 1 o null, nunca 0: el CHECK solo acepta 1..5 o NULL, y la FK a
    // ESCALAS_EVALUACIONES exige que el valor exista ahí (el 1 existe).
    escala: d.marcada ? 1 : null,
    aspectos_positivos: cab.aspectos_positivos,
    aspectos_mejorar: cab.aspectos_mejorar,
  };
}

export type ResultadoGuardado = {
  creados: number;
  actualizados: number;
  borrados: number;
};

/**
 * Guarda una evaluación completa: una llamada por detalle.
 *
 * Los detalles con `id` se actualizan (PUT), los que no lo tienen se crean
 * (POST), y los `idsOriginales` que ya no están en `detalles` se borran (DELETE).
 *
 * **No hay transacción.** El backend hace COMMIT por llamada, así que si una
 * falla las demás ya quedaron aplicadas. Se lanza un error que dice cuántas
 * fallaron; la evaluación queda a medias y hay que volver a guardar. Es
 * consecuencia directa de no tener tabla de cabecera.
 *
 * Las llamadas van en paralelo: en serie, 12 detalles son 12 viajes a Oracle uno
 * atrás del otro y el guardado se siente colgado.
 */
export async function guardarEvaluacion(
  cab: Cabecera,
  detalles: Detalle[],
  idsOriginales: number[] = [],
): Promise<ResultadoGuardado> {
  const vigentes = new Set(detalles.map((d) => d.id).filter((id): id is number => id !== null));
  const aBorrar = idsOriginales.filter((id) => !vigentes.has(id));

  const tareas: Promise<unknown>[] = [
    ...detalles.map((d) =>
      d.id === null
        ? crearEvaluacion(filaInput(cab, d))
        : actualizarEvaluacion(d.id, filaInput(cab, d)),
    ),
    ...aBorrar.map((id) => eliminarEvaluacion(id)),
  ];

  const r = await Promise.allSettled(tareas);
  const fallidas = r.filter((x) => x.status === "rejected");

  if (fallidas.length) {
    const motivo = fallidas
      .map((x) => (x as PromiseRejectedResult).reason)
      .map((e) => (e instanceof Error ? e.message : String(e)))
      // Doce detalles que fallan por lo mismo no son doce mensajes distintos.
      .filter((m, i, xs) => xs.indexOf(m) === i)
      .join("; ");
    throw new Error(
      `Fallaron ${fallidas.length} de ${tareas.length} operaciones y la evaluación quedó a medias. ` +
        `Volvé a guardar. Motivo: ${motivo}`,
    );
  }

  return {
    creados: detalles.filter((d) => d.id === null).length,
    actualizados: detalles.filter((d) => d.id !== null).length,
    borrados: aBorrar.length,
  };
}

/** Borra una evaluación completa: una llamada por detalle. */
export async function eliminarEvaluacionCompleta(ids: number[]): Promise<void> {
  const r = await Promise.allSettled(ids.map((id) => eliminarEvaluacion(id)));
  const fallidas = r.filter((x) => x.status === "rejected").length;
  if (fallidas) {
    throw new Error(
      `No se pudieron borrar ${fallidas} de ${ids.length} detalles. La evaluación quedó incompleta.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

export const keys = {
  evaluaciones: (f: Filtros = {}) => ["evaluaciones", f] as const,
  evaluacion: (id: number) => ["evaluacion", id] as const,
  /** La evaluación completa (cabecera + detalles) a partir del id de una fila. */
  grupo: (id: number) => ["evaluacion-grupo", id] as const,
  lista: (nombre: LovNombre, params: LovParams = {}) => ["lista", nombre, params] as const,
};

/** Los combos casi no cambian: no vale re-pedirlos en cada apertura. */
export const STALE_LISTAS = 5 * 60 * 1000;
