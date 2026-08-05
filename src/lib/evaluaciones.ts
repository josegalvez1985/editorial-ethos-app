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
  /**
   * `null` cuando la fila es una **cabecera sola**: la evaluación se guardó con
   * facilitador, institución y período pero todavía sin ítems. Las dos columnas
   * son NULLABLE en Oracle desde el 04/08/2026 y viajan juntas — nunca una sola
   * en null. Ver `agrupar()`, que descarta esas filas de `detalles`.
   */
  id_area: number | null;
  area: string | null;
  id_evaluacion: number | null;
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
  /**
   * Nota de quien revisa la evaluación, aparte de los dos campos de aspectos
   * —que son del evaluador—. `OBSERVACION_ADMIN` en Oracle, CLOB y opcional.
   */
  observacion_admin: string | null;
  /**
   * `'S'` cerrada / `'N'` abierta. El backend ya aplica `NVL(...,'N')`, así que
   * nunca llega null aunque la fila sea vieja.
   *
   * Cerrada = **no se puede editar ni borrar**: el backend responde 409. Se
   * reabre con un PUT mandando `'N'`.
   */
  ind_cerrado: string;
  /**
   * La postulación que se está evaluando: el grado y sección concretos.
   *
   * Desde el 05/08/2026 la **elige el usuario** en las tarjetas del formulario y
   * viaja en el JSON. Si no va ninguna, el backend la deduce como antes cruzando
   * facilitador + institución + año lectivo — y deja `null` si hay varias
   * candidatas, que es el caso que las tarjetas vinieron a resolver.
   */
  id_postulacion: number | null;
  /**
   * El índice del manual que se dio en la clase evaluada. Lo elige el evaluador:
   * ver el tipo `Indice`. Los tres de abajo vienen del join, solo para mostrar.
   */
  id_indice: number | null;
  manual: string | null;
  nro_indice: number | null;
  indice_titulo: string | null;
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
  observacion_admin: string;
  /**
   * `boolean` y no el `'S'/'N'` de Oracle: adentro de la app esto es un sí o un
   * no, y la conversión vive en un solo lugar (`filaInput` al salir, `agrupar`
   * al entrar). Así ningún componente tiene que acordarse de comparar con `'S'`.
   */
  cerrada: boolean;
  /**
   * La postulación elegida en las tarjetas del formulario: qué grado y sección
   * se está evaluando. `null` = ninguna elegida, y ahí el backend la deduce.
   */
  id_postulacion: number | null;
  /** El índice del manual dado en la clase. Opcional. */
  id_indice: number | null;
  /**
   * El manual del índice elegido. NO se guarda —se deriva de `id_indice`— pero
   * vive en la cabecera porque el combo de manual necesita estado propio: sin
   * él, al editar no habría con qué precargar el primer combo de la cascada.
   */
  manual: string | null;
  /**
   * El título del índice guardado. Tampoco se guarda —viene del join— pero deja
   * que el campo muestre el índice elegido SIN esperar a que cargue el catálogo.
   */
  indice_titulo: string | null;
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
  observacion_admin: string;
  /** `'S'` / `'N'`. Acá sí va el formato de Oracle: es lo que viaja en el JSON. */
  ind_cerrado: string;
  /**
   * La postulación elegida. Opcional: si va `null`, el backend la deduce sola
   * como hacía antes de que existieran las tarjetas.
   */
  id_postulacion: number | null;
  /** El índice del manual. Opcional; es FK, así que un id inválido lo corta Oracle. */
  id_indice: number | null;
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
/* Postulaciones                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Una postulación: el hecho de que un facilitador da clase en un grado concreto
 * de una institución. Es lo que el evaluador elige para decir **qué** está
 * evaluando, cuando hay más de una.
 *
 * NO usa `Opcion` como los combos: esto se muestra en tarjetas con varios datos,
 * no en una lista de una línea. Forzarlo al `{ id, texto }` de los combos
 * obligaría a concatenar todo en un string y a partirlo de nuevo en la tarjeta.
 *
 * Casi todo es opcional porque en la base casi todo es NULLABLE: hay filas sin
 * grado, sin sección y sin docente. La tarjeta omite lo que no está en vez de
 * mostrar huecos.
 */
export type Postulacion = {
  id_postulacion: number;
  /** "7mo", "1ro Media"… Derivado en el backend de trece columnas. Ver el SQL. */
  grado: string | null;
  /** La matrícula del grado: el VALOR de esa columna, no un id. */
  alumnos: number | null;
  seccion: string | null;
  /** 1/2/3 crudo. La etiqueta la pone `TURNOS`, más abajo. */
  turno: number | null;
  /** SER / HACER / TENER / CARACTER / VISION / CORAJE / LIDERAZGO. */
  programa: string | null;
  /** De `DOCENTES`, con `NOMBRE_PROFESOR` de respaldo. Lo resuelve el backend. */
  docente: string | null;
  telefono: string | null;
  enfasis: string | null;
  materia: string | null;
  /**
   * Los días y horas de clase, ya armados: "Lun 07:30-09:00 Mie 10:00-11:30".
   *
   * Sale de las diez columnas LUNES_DESDE..VIERNES_HASTA, que **solo guardan la
   * hora** —un trigger les fija la fecha al 01/01/2025—. El texto lo arma el
   * backend: traer las diez y juntarlas acá sería repetir esa lógica en el front.
   */
  horario: string | null;
  observacion: string | null;
  estado: string | null;
  anio: string | null;
};

/**
 * `POSTULACIONES.TURNO` es un NUMBER **sin tabla ni FK**: el dominio no está en
 * la base. Confirmado con los datos (1: 4417 filas, 2: 3512, 3: 44) y con el
 * usuario el 05/08/2026.
 *
 * Está cableado acá igual que `ESCALA`, y por el mismo motivo: no hay de dónde
 * leerlo. Anotado en PENDIENTES.md — si algún día se crea la tabla `TURNOS`,
 * este objeto se reemplaza por un join en `lov_postulaciones`.
 */
export const TURNOS: Record<number, string> = {
  1: "Mañana",
  2: "Tarde",
  3: "Noche",
};

/** La etiqueta del turno, o el número crudo si aparece uno que no conocemos. */
export function nombreTurno(turno: number | null): string | null {
  if (turno == null) return null;
  return TURNOS[turno] ?? `Turno ${turno}`;
}

/**
 * Las postulaciones de un facilitador en una institución.
 *
 * Los dos ids son obligatorios **en el backend** (responde 400 sin ellos), así
 * que la llamada no debe hacerse hasta tenerlos: el `enabled` de la query es
 * responsabilidad de quien la usa.
 */
export async function listarPostulaciones(
  id_facilitador: number,
  id_institucion: number,
  /**
   * Día de la semana. **Por defecto, HOY**: una evaluación se carga el día que se
   * observa la clase, así que las de otros días son ruido.
   *
   * El cálculo lo hace el BACKEND con la fecha del servidor, no el navegador: la
   * fecha del teléfono puede estar corrida y el filtro daría otro día.
   *
   * `"TODOS"` lo apaga — es lo que usa el botón "Ver todas". Sábado y domingo el
   * backend también las muestra todas, porque esos días no hay clases.
   */
  dia?: "TODOS",
): Promise<Postulacion[]> {
  const r = (await authFetch(
    `listas/postulaciones${qs({ id_facilitador, id_institucion, dia })}`,
  )) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_postulacion: Number(row.id_postulacion),
    grado: (row.grado as string) ?? null,
    alumnos: row.alumnos == null ? null : Number(row.alumnos),
    seccion: (row.seccion as string) ?? null,
    turno: row.turno == null ? null : Number(row.turno),
    programa: (row.programa as string) ?? null,
    docente: (row.docente as string) ?? null,
    telefono: (row.telefono as string) ?? null,
    enfasis: (row.enfasis as string) ?? null,
    materia: (row.materia as string) ?? null,
    horario: (row.horario as string) ?? null,
    observacion: (row.observacion as string) ?? null,
    estado: (row.estado as string) ?? null,
    anio: (row.anio as string) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* El siguiente índice a desarrollar                                          */
/* -------------------------------------------------------------------------- */

/**
 * El índice que le toca a una postulación, deducido de `INTERVENCIONES`.
 *
 * **No se elige: se calcula.** El formulario lo muestra de solo lectura, igual
 * que la ciudad. La regla, en dos pasos:
 *
 * 1. El último índice con `SI_NO = 'Si'` en las intervenciones de esa
 *    postulación — el último **efectivamente desarrollado**.
 * 2. El inmediato siguiente dentro del mismo manual.
 *
 * Un índice marcado `'No'` no cuenta como avance: significa que no se dio (por
 * eso lleva `MOTIVO_DESARROLLO`) y sigue pendiente, así que se vuelve a
 * proponer. Es el mismo criterio de `TRG_INTERV_FINALIZA_POST`.
 */
export type IndiceSiguiente = {
  /**
   * - `PENDIENTE`: hay siguiente índice, los campos de abajo vienen cargados.
   * - `SIN_INICIAR`: la postulación no tiene ninguna intervención con `'Si'`.
   *   **No se asume el índice 1**: sin intervenciones no se sabe ni el manual.
   * - `FINALIZADO`: el último desarrollado ya era el más alto del manual.
   */
  estado: "PENDIENTE" | "SIN_INICIAR" | "FINALIZADO";
  /** El manual que esa clase viene desarrollando. `null` si `SIN_INICIAR`. */
  manual: string | null;
  /** El último desarrollado. Sirve para explicar de dónde sale la propuesta. */
  nro_ultimo: number | null;
  /** Los tres de abajo solo vienen con `PENDIENTE`. */
  id_indice: number | null;
  nro_indice: number | null;
  titulo: string | null;
};

/**
 * El siguiente índice de una postulación.
 *
 * Es el único endpoint de `listas/` que devuelve **un objeto y no un array**:
 * es un índice o ninguno. `id_postulacion` es obligatorio en el backend (400 sin
 * él), así que el `enabled` de la query es responsabilidad de quien la usa.
 */
export async function obtenerIndiceSiguiente(id_postulacion: number): Promise<IndiceSiguiente> {
  const r = (await authFetch(`listas/indice-siguiente${qs({ id_postulacion })}`)) as {
    data?: Record<string, unknown>;
  };
  const d = r.data ?? {};

  return {
    // Si el backend mandara algo inesperado, SIN_INICIAR es el caso inerte: la
    // UI no propone nada en vez de mostrar un índice inventado.
    estado: (d.estado as IndiceSiguiente["estado"]) ?? "SIN_INICIAR",
    manual: (d.manual as string) ?? null,
    nro_ultimo: d.nro_ultimo == null ? null : Number(d.nro_ultimo),
    id_indice: d.id_indice == null ? null : Number(d.id_indice),
    nro_indice: d.nro_indice == null ? null : Number(d.nro_indice),
    titulo: (d.titulo as string) ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Directores                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Quién dirige una institución. **Es un dato informativo y nada más.**
 *
 * No se guarda en la evaluación: no hay `id_director` en
 * `EVALUACIONES_FACILITADORES` ni va en el JSON del POST/PUT. Está para que el
 * evaluador sepa con quién hablar al llegar a la institución.
 *
 * Sale de `INSTITUCIONES_DIRECTORES` (una fila por período + nivel + turno)
 * unida a `DIRECTORES` (la ficha de la persona). Como no viaja en la evaluación,
 * siempre se lee fresco de la base: si cambia el director, la tarjeta lo refleja
 * sin tocar nada de lo ya cargado.
 *
 * Todo es opcional salvo el nombre porque en la base todo es NULLABLE salvo eso.
 */
export type Director = {
  /** PK de la fila de `INSTITUCIONES_DIRECTORES`, no del director. */
  id_periodo: number;
  /** `VARCHAR2(50)` sin dominio: no es el año lectivo ni tiene FK. Ver el SQL. */
  periodo: string | null;
  id_director: number;
  nombre_apellido: string;
  /** "Directora", "Coordinador"… texto libre. */
  cargo: string | null;
  /** "Escolar Básica", "Media"… texto libre. */
  nivel: string | null;
  /**
   * Texto libre, NO el número 1/2/3 de `POSTULACIONES.TURNO`. Son dos dominios
   * distintos que se llaman igual: acá NO se puede usar `nombreTurno()`.
   */
  turno: string | null;
  estado: string | null;
  /** El de la institución; el backend cae al de la ficha si no está cargado. */
  nro_telefono: string | null;
};

/**
 * La dirección de una institución. **Devuelve TODAS las filas activas**, no una.
 *
 * Una institución puede tener a la vez un director de la mañana en Escolar
 * Básica y otro de la tarde en Media, los dos con `ESTADO = 'A'`. Quedarse con
 * uno escondería al que sí corresponde, así que la tarjeta las lista todas.
 *
 * `id_institucion` es obligatorio en el backend (400 sin él): la llamada no debe
 * hacerse hasta tenerlo, y el `enabled` de la query es de quien la usa.
 */
export async function listarDirectores(id_institucion: number): Promise<Director[]> {
  const r = (await authFetch(`listas/directores${qs({ id_institucion })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_periodo: Number(row.id_periodo),
    periodo: (row.periodo as string) ?? null,
    id_director: Number(row.id_director),
    nombre_apellido: String(row.nombre_apellido ?? ""),
    cargo: (row.cargo as string) ?? null,
    nivel: (row.nivel as string) ?? null,
    turno: (row.turno as string) ?? null,
    estado: (row.estado as string) ?? null,
    nro_telefono: (row.nro_telefono as string) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Índices de manuales                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Una entrada del catálogo `INDICES_MANUALES`: qué contenido se dio en la clase.
 *
 * **No sale de la postulación.** Esa tabla no tiene relación con `POSTULACIONES`
 * —ni FK en un sentido ni en el otro—, así que el índice no se deduce de la
 * clase: lo elige el evaluador. Por eso `ID_INDICE` vive en
 * `EVALUACIONES_FACILITADORES` y no en la postulación.
 */
export type Indice = {
  id_indice: number;
  nro_indice: number;
  titulo: string;
  manual: string;
};

/**
 * Los manuales, sin repetir.
 *
 * `MANUAL` es un `VARCHAR2` de la propia fila de `INDICES_MANUALES`: **no hay
 * tabla de manuales**. El `DISTINCT` del backend ES el catálogo, y por eso esto
 * devuelve strings y no ids.
 */
export async function listarManuales(): Promise<string[]> {
  const r = (await authFetch("listas/manuales")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => String(row.manual ?? "")).filter(Boolean);
}

/**
 * Los índices de un manual, en el orden del manual impreso (`NRO_INDICE`).
 *
 * Sin `manual` devuelve los de todos, que sirve para buscar pero no para la
 * cascada: quien la use debería pasar siempre el manual elegido.
 */
export async function listarIndices(manual?: string | null): Promise<Indice[]> {
  const r = (await authFetch(`listas/indices${qs({ manual: manual ?? undefined })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_indice: Number(row.id_indice),
    nro_indice: Number(row.nro_indice),
    titulo: String(row.titulo ?? ""),
    manual: String(row.manual ?? ""),
  }));
}

/** "3. Los valores en la familia" — como se lee en el manual. */
export function textoIndice(i: Pick<Indice, "nro_indice" | "titulo">) {
  return `${i.nro_indice}. ${i.titulo}`;
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
        observacion_admin: f.observacion_admin ?? "",
        cerrada: f.ind_cerrado === "S",
        id_postulacion: f.id_postulacion,
        id_indice: f.id_indice,
        manual: f.manual,
        indice_titulo:
          f.nro_indice != null && f.indice_titulo
            ? `${f.nro_indice}. ${f.indice_titulo}`
            : f.indice_titulo,
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
    // solo en una: se toma la primera no vacía en vez de la última. Lo mismo
    // vale para la observación del admin, que además puede haberse cargado desde
    // APEX sobre una sola fila del grupo.
    if (!g.aspectos_positivos && f.aspectos_positivos) g.aspectos_positivos = f.aspectos_positivos;
    if (!g.aspectos_mejorar && f.aspectos_mejorar) g.aspectos_mejorar = f.aspectos_mejorar;
    if (!g.observacion_admin && f.observacion_admin) g.observacion_admin = f.observacion_admin;

    // El grupo está cerrado si CUALQUIERA de sus filas lo está.
    //
    // Es lo seguro: guardar son N llamadas, una por detalle, así que un cierre a
    // medias —o una fila cerrada a mano desde APEX— dejaría el resto del grupo
    // editable mientras el backend rechaza esa fila con 409. Marcándolo cerrado
    // entero, el front no ofrece una edición que va a fallar.
    if (f.ind_cerrado === "S") g.cerrada = true;

    // Fila de CABECERA SOLA: `id_area`/`id_evaluacion` en null significa que la
    // evaluación se guardó sin ítems todavía. No es un detalle y no entra a la
    // lista — si entrara, contaría como un ítem vacío en la calificación y en
    // el "(N ítems)" del botón.
    //
    // Su id igual quedó registrado arriba (`g.id`), que es lo que permite
    // reusar la fila al agregarle áreas después en vez de crear una nueva.
    if (f.id_area === null || f.id_evaluacion === null) continue;

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
 * **`d` puede ser `null`**: eso produce una fila de CABECERA SOLA, con
 * `id_area`, `id_evaluacion` y `escala` en null. Es lo que permite guardar una
 * evaluación cuyas áreas todavía no se cargaron — las dos columnas son
 * NULLABLE en Oracle desde el 04/08/2026. En cuanto se agrega la primera área,
 * esa fila se reemplaza por una fila por detalle.
 *
 * `evaluado_por` pasa por `formatearNombre()` ACÁ y no en el `onChange` del
 * input: formatear mientras se tipea pelea con el cursor —al escribir " " la
 * palabra anterior se capitaliza y el cursor salta— y además impide escribir un
 * apellido que de verdad lleve dos mayúsculas. Se normaliza al guardar, que es
 * cuando importa que quede parejo en la base.
 */
function filaInput(cab: Cabecera, d: Detalle | null): EvaluacionInput {
  return {
    id_facilitador: cab.id_facilitador,
    id_institucion: cab.id_institucion,
    id_ciudad: cab.id_ciudad,
    fecha_desde: cab.fecha_desde,
    fecha_hasta: cab.fecha_hasta,
    evaluado_por: formatearNombre(cab.evaluado_por),
    // Los dos juntos o los dos en null: el backend rechaza uno solo.
    id_area: d?.id_area ?? null,
    id_evaluacion: d?.id_evaluacion ?? null,
    // 1 o null, nunca 0: el CHECK solo acepta 1..5 o NULL, y la FK a
    // ESCALAS_EVALUACIONES exige que el valor exista ahí (el 1 existe).
    // Sin detalle no hay estrella que marcar.
    escala: d?.marcada ? 1 : null,
    aspectos_positivos: cab.aspectos_positivos,
    aspectos_mejorar: cab.aspectos_mejorar,
    observacion_admin: cab.observacion_admin,
    // Acá se traduce el boolean de la app al 'S'/'N' que espera Oracle.
    ind_cerrado: cab.cerrada ? "S" : "N",
    // Va en TODAS las filas del grupo, igual que el resto de la cabecera: una
    // evaluación es de una postulación, no cada detalle de la suya.
    id_postulacion: cab.id_postulacion,
    // `manual` NO viaja: se deriva del índice con un join. Guardarlo sería
    // duplicar un dato que ya está en INDICES_MANUALES.
    id_indice: cab.id_indice,
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

  /*
   * SIN DETALLES: una fila de cabecera sola.
   *
   * Sin esto, guardar una evaluación sin áreas no haría ninguna llamada y
   * "Guardar" no guardaría nada, en silencio.
   *
   * Se REUSA la primera fila que ya existía (PUT) en vez de borrar todo y
   * volver a insertar: así el id de la evaluación —y el link que lleva a
   * ella— no cambia al quitarle todas las áreas. Las demás se borran.
   */
  const soloCabecera = detalles.length === 0;
  const idAReusar = soloCabecera ? (idsOriginales[0] ?? null) : null;
  const aBorrarFinal = soloCabecera ? idsOriginales.filter((id) => id !== idAReusar) : aBorrar;

  const tareas: Promise<unknown>[] = [
    ...(soloCabecera
      ? [
          idAReusar === null
            ? crearEvaluacion(filaInput(cab, null))
            : actualizarEvaluacion(idAReusar, filaInput(cab, null)),
        ]
      : detalles.map((d) =>
          d.id === null
            ? crearEvaluacion(filaInput(cab, d))
            : actualizarEvaluacion(d.id, filaInput(cab, d)),
        )),
    ...aBorrarFinal.map((id) => eliminarEvaluacion(id)),
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

  // Con solo cabecera hubo exactamente una operación: la que reusó la fila
  // vieja (PUT) o la que la creó (POST). Contar `detalles` daría 0 y el toast
  // diría que no se guardó nada.
  return soloCabecera
    ? {
        creados: idAReusar === null ? 1 : 0,
        actualizados: idAReusar === null ? 0 : 1,
        borrados: aBorrarFinal.length,
      }
    : {
        creados: detalles.filter((d) => d.id === null).length,
        actualizados: detalles.filter((d) => d.id !== null).length,
        borrados: aBorrarFinal.length,
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
