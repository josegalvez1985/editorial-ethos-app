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
 * EL BACKEND YA FILTRA: SOLO VIENEN LOS DESVÍOS DE 15+ MINUTOS
 * ============================================================================
 *
 * No llegan todas las marcaciones del mes, sino **solo las que se apartan 15
 * minutos o más del horario**, en cualquier dirección (tarde o antes).
 *
 * Es la diferencia que cambia cómo se lee todo lo de abajo: el promedio no es
 * "cuánto se atrasa en promedio", es "cuánto se desvía cuando se desvía". Un
 * facilitador puntual **no aparece**, en vez de aparecer con una barra en cero.
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
 * Por eso este módulo no la usa directo: `desvioMinutos()` la convierte a
 * minutos con el signo natural (positivo = tarde), que es lo que la UI muestra.
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
   * consulta original. Usar `desvioMinutos()` en vez de esto.
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
  /** Donde marcó. Ya normalizadas con punto decimal por el backend. */
  latitud: string | null;
  longitud: string | null;
  /**
   * La URL de Google Maps de la institución, tal como está en la base.
   *
   * **No sirve para calcular**: son links acortados (`goo.gl/maps/…`) cuyas
   * coordenadas solo resuelve Google al abrirlos. Se devuelve por si algún día
   * se quiere mostrar el link tal cual.
   */
  ubicacion_institucion: string | null;
  /**
   * El punto de referencia de la institución, **deducido** por el backend: la
   * mediana de las coordenadas de todas sus marcaciones históricas.
   *
   * No sale de `ubicacion_institucion` — ver arriba. `null` si esa institución
   * no tiene ninguna marcación con coordenadas válidas.
   */
  inst_latitud: number | null;
  inst_longitud: number | null;
  /**
   * Metros entre donde marcó y donde debía marcar.
   *
   * `null` cuando **no se sabe**, que no es lo mismo que cero: falta alguna
   * coordenada, la ubicación de la institución no está cargada, o la marcación
   * quedó en (0,0) —lo que escribe `TRG_INTERV_UBICACION` cuando el facilitador
   * tiene `IND_UBICACION_POSTULACION = 'NO'`—.
   */
  distancia_metros: number | null;
};

/**
 * El desvío de una marcación en minutos: **positivo = llegó tarde**, negativo =
 * llegó antes.
 *
 * Invierte el signo de `diferencia_minutos` y la vuelve a minutos (viene en
 * horas). Ver el encabezado del módulo.
 *
 * Conserva el signo a propósito: el backend solo manda las marcaciones que se
 * apartan 15+ minutos **en cualquier dirección**, así que distinguir "llegó
 * tarde" de "llegó mucho antes" es justamente lo que hay que mostrar.
 */
export function desvioMinutos(i: Intervencion): number | null {
  if (i.diferencia_minutos === null) return null;
  // × −60: invierte el signo y deshace el `/ 60` del SQL.
  return Math.round(i.diferencia_minutos * -60);
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
    inst_latitud: row.inst_latitud == null ? null : Number(row.inst_latitud),
    inst_longitud: row.inst_longitud == null ? null : Number(row.inst_longitud),
    distancia_metros: row.distancia_metros == null ? null : Number(row.distancia_metros),
  }));
}

/* -------------------------------------------------------------------------- */
/* El agrupado para el gráfico                                                */
/* -------------------------------------------------------------------------- */

/** Una barra del gráfico: un facilitador con su total de tiempo fuera de horario. */
export type ResumenFacilitador = {
  id_facilitador: number;
  nombre_facilitador: string;
  /**
   * **El TOTAL de minutos marcados fuera del horario** en el período, sumando
   * todas las marcaciones desviadas. Es el valor de la barra.
   *
   * Se suma la MAGNITUD: llegar 20 tarde y marcar 20 antes son los dos 20
   * minutos fuera de horario. Sumarlos con signo los cancelaría a 0 y el
   * facilitador desaparecería del gráfico justamente por ser irregular.
   */
  total: number;
  /** El peor desvío individual del período, en magnitud. */
  peor: number;
  /** Cuántas marcaciones desviadas se contaron. */
  marcaciones: number;
  /** De esas, cuántas fueron TARDE (las otras fueron adelantos). */
  tarde: number;
  /** Las filas de ese facilitador, para el modal. */
  filas: Intervencion[];
};

/**
 * Agrupa las marcaciones por facilitador, **ordenado de mayor a menor total**.
 *
 * ## QUÉ SUMA, EXACTAMENTE
 *
 * El backend solo manda las marcaciones que se apartan **15+ minutos del
 * horario**, en cualquier dirección. Esto suma esos desvíos: el resultado es
 * **cuánto tiempo en total marcó fuera del horario establecido** en el período.
 *
 * Es una SUMA y no un promedio a pedido (05/08/2026). La diferencia importa al
 * leer el gráfico: quien tiene muchas clases acumula más aunque cada desvío sea
 * chico, así que la barra mide impacto acumulado, no severidad por clase. Para
 * lo segundo está `peor`, y `marcaciones` da el contexto de cuántas fueron.
 *
 * Un facilitador sin desvíos **no aparece en el gráfico**, en vez de aparecer
 * con una barra en cero: la lista es de quienes tienen algo que revisar.
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
    const desvios = suyas.map(desvioMinutos).filter((m): m is number => m !== null);

    if (!desvios.length) continue; // ninguna hora calculable: no se grafica

    const magnitudes = desvios.map(Math.abs);

    salida.push({
      id_facilitador: id,
      nombre_facilitador:
        suyas.find((f) => f.nombre_facilitador)?.nombre_facilitador ?? `Facilitador #${id}`,
      // La SUMA de las magnitudes: el total de tiempo fuera de horario.
      total: magnitudes.reduce((a, b) => a + b, 0),
      peor: Math.max(...magnitudes),
      marcaciones: desvios.length,
      tarde: desvios.filter((m) => m > 0).length,
      filas: suyas,
    });
  }

  return salida.sort((a, b) => b.total - a.total || b.marcaciones - a.marcaciones);
}

/* -------------------------------------------------------------------------- */
/* Actividad diaria                                                           */
/* -------------------------------------------------------------------------- */

/** Cuántas intervenciones hubo un día del mes. */
export type ActividadDia = {
  /** El día del mes, 1–31. Es el eje X. */
  dia: number;
  /** Cuántas intervenciones se registraron ese día. Es el eje Y. */
  cantidad: number;
};

/**
 * La actividad día por día del mes.
 *
 * **Cuenta TODAS las intervenciones**, no solo las desviadas: es la diferencia
 * con `listarIntervenciones`. Este gráfico responde "cuánta actividad hubo", no
 * "quién se portó mal", y por eso es un endpoint aparte.
 *
 * Los días sin actividad **no vienen** en la respuesta: un sábado sin clases no
 * es un cero que haya que dibujar. Ver `rellenarDias` si se los quiere igual.
 */
export async function actividadPorDia(anio?: string, mes?: number): Promise<ActividadDia[]> {
  const r = (await authFetch(`intervenciones/por-dia${qs({ anio, mes })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    dia: Number(row.dia),
    cantidad: Number(row.cantidad ?? 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* Marcaciones fuera de ubicación                                             */
/* -------------------------------------------------------------------------- */

/**
 * Metros a partir de los cuales una marcación cuenta como "fuera de rango".
 *
 * **Tiene que coincidir con `c_umbral_metros` del backend**, que ya filtró con
 * ese mismo número. Está acá para poder separar, dentro de las filas que
 * llegaron, cuáles vinieron por ubicación y cuáles por horario.
 */
export const UMBRAL_METROS = 1000;

/** Si esta marcación se hizo a más de 1 km de la institución. */
export function fueraDeRango(i: Intervencion): boolean {
  return i.distancia_metros !== null && i.distancia_metros > UMBRAL_METROS;
}

/** Una barra del gráfico de ubicación. */
export type ResumenUbicacion = {
  id_facilitador: number;
  nombre_facilitador: string;
  /** Cuántas veces marcó a más de 1 km. Es el valor de la barra. */
  fuera: number;
  /** La distancia más grande del período, en metros. */
  peor: number;
  /** Solo las marcaciones fuera de rango, para el modal. */
  filas: Intervencion[];
};

/**
 * Agrupa por facilitador **solo las marcaciones fuera de rango**, de mayor a
 * menor cantidad.
 *
 * Las filas sin distancia calculable no cuentan: ver `distancia_metros`. Un
 * facilitador sin ninguna marcación lejana no aparece, en vez de aparecer con
 * una barra en cero.
 */
export function agruparPorUbicacion(filas: Intervencion[]): ResumenUbicacion[] {
  const porId = new Map<number, Intervencion[]>();

  for (const f of filas) {
    if (f.id_facilitador == null || !fueraDeRango(f)) continue;
    const ya = porId.get(f.id_facilitador);
    if (ya) ya.push(f);
    else porId.set(f.id_facilitador, [f]);
  }

  const salida: ResumenUbicacion[] = [];

  for (const [id, suyas] of porId) {
    const distancias = suyas.map((f) => f.distancia_metros!);
    salida.push({
      id_facilitador: id,
      nombre_facilitador:
        suyas.find((f) => f.nombre_facilitador)?.nombre_facilitador ?? `Facilitador #${id}`,
      fuera: suyas.length,
      peor: Math.max(...distancias),
      filas: suyas.sort((a, b) => (b.distancia_metros ?? 0) - (a.distancia_metros ?? 0)),
    });
  }

  return salida.sort((a, b) => b.fuera - a.fuera || b.peor - a.peor);
}

/** "850 m", "3,2 km". Abajo del kilómetro los metros se leen mejor. */
export function formatearDistancia(metros: number | null): string {
  if (metros === null) return "—";
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
}

/**
 * El link de Google Maps que muestra las DOS ubicaciones a la vez.
 *
 * Se usa el modo *directions* (origen → destino) y no dos pines sueltos: es la
 * única forma con una URL simple de que Maps encuadre los dos puntos juntos y
 * muestre cuánto hay entre ellos, que es justo lo que se quiere verificar.
 *
 * `travelmode=walking` porque la ruta en auto puede dar una vuelta larga y
 * confundir; a pie la línea es más directa y se entiende la separación real.
 *
 * `null` si falta alguna de las cuatro coordenadas: sin las dos puntas no hay
 * nada que comparar, y un link a medias llevaría a un mapa equivocado.
 */
export function linkMapaComparativo(i: Intervencion): string | null {
  if (!i.latitud || !i.longitud || i.inst_latitud === null || i.inst_longitud === null) {
    return null;
  }
  const marco = `${i.latitud},${i.longitud}`;
  const institucion = `${i.inst_latitud},${i.inst_longitud}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${institucion}&destination=${marco}&travelmode=walking`;
}

/** Un pin suelto en Google Maps, para ver una sola de las dos ubicaciones. */
export function linkMapaPunto(lat: string | number | null, lng: string | number | null) {
  if (lat === null || lng === null || lat === "" || lng === "") return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
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

/**
 * "18 min", "1 h 5 min". Los minutos sueltos se leen mal arriba de 60.
 *
 * Toma la MAGNITUD: el signo no se escribe acá porque un "−20 min" no se
 * entiende solo. Quien muestra el dato pone la palabra ("tarde" / "antes"), que
 * es lo que hace la diferencia legible.
 */
export function formatearAtraso(minutos: number | null): string {
  if (minutos === null) return "—";
  const abs = Math.abs(minutos);
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const keysIntervenciones = {
  historial: (anio: string, mes: number) => ["intervenciones", anio, mes] as const,
  porDia: (anio: string, mes: number) => ["intervenciones-por-dia", anio, mes] as const,
};
