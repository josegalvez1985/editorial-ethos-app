/**
 * El "Formulario N° 2 - Reporte diario del facilitador" (26/10/2026, pedido de
 * Jose con la planilla Excel que usan hoy): para UN facilitador en UNA
 * institución y un rango de fechas, sus clases con las intervenciones de ese
 * rango. Acá se juntan los datos; el dibujo (PDF, imagen y Excel) está en
 * `planilla-reporte-diario.ts`.
 *
 * ============================================================================
 * SIN BACKEND PROPIO
 * ============================================================================
 *
 * Todo sale de endpoints que ya existen y piden solo sesión:
 *
 * | Qué | De dónde |
 * | --- | --- |
 * | Institución y autoridades (la cabecera) | `postulaciones/formulario`, el del Form. 1 |
 * | Las clases (el detalle) | `postulaciones/todas` del año, de ese facilitador en esa institución |
 * | Las intervenciones | `intervenciones-crud` del año, de los dos, filtradas por fecha acá |
 * | El teléfono del facilitador | `GET facilitadores` |
 *
 * ============================================================================
 * LAS REGLAS (las acordadas con Jose el 26/10/2026)
 * ============================================================================
 *
 * - **Una fila por postulación activa** (estado distinto de Inactivo) y por día
 *   con horario, en bloques por turno con su subtotal (TM, TT, TN).
 * - **Las secciones se juntan:** las postulaciones del mismo turno, día, hora,
 *   grado y manual que solo cambian de sección son UNA clase con un renglón por
 *   sección (la fila 5 de la planilla: 7° A y 7° B), con la cantidad de cada
 *   una en su renglón y las intervenciones compartidas.
 * - **Las intervenciones de la 1° a la 4°** son las de esa clase dentro del
 *   rango, en orden de fecha, **una por día** (de varias el mismo día cuenta la
 *   última, como el Resumen de Intervenciones). Si hay más de cuatro, salen las
 *   primeras cuatro y la pantalla avisa.
 * - **1/0:** 1 si se desarrolló el índice, 0 si no. **FIRMA PROF. / *JUSTIF.**
 *   queda para la firma; si no se desarrolló, lleva el motivo.
 * - **Recuperaciones:** en blanco, para completar a mano (la base no las
 *   distingue).
 * - **TÍTULO de las autoridades:** en blanco. Ni `DIRECTORES` ni
 *   `INSTITUCIONES_DIRECTORES` (ni los de coordinadores) tienen esa columna.
 * - **El año** de las clases es el de la fecha desde.
 */

import { authFetch } from "@/lib/api";
import { listarCrud, type IntervencionCrud } from "@/lib/intervenciones-crud";
import {
  DIAS,
  GRADOS,
  MANUALES,
  obtenerFormulario,
  type ClaveDia,
  type ClaveGrado,
  type ClaveManual,
  type PostulacionFila,
} from "@/lib/postulaciones";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

/** Una intervención de la clase, como sale en sus cuatro columnas. */
export type Intervencion2 = {
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** El número del índice ("3", "3,5"). */
  indice: string;
  hecha: boolean;
  /** El motivo, cuando no se desarrolló. */
  motivo: string;
};

/** Un renglón de la clase: una sección, con sus alumnos por grado y manual. */
export type Renglon = {
  idPostulacion: number;
  seccion: string;
  enfasis: string;
  grados: Record<ClaveGrado, number>;
  manuales: Record<ClaveManual, number>;
};

/** Una fila de la planilla: una clase (un día y una hora) con sus secciones. */
export type Clase = {
  turno: number | null;
  dia: ClaveDia;
  /** `HH:MM`. */
  hora: string;
  renglones: Renglon[];
  /** Las primeras cuatro del rango, en orden de fecha. */
  intervenciones: Intervencion2[];
  /** Las que hubo en el rango además de esas cuatro. */
  sobran: number;
};

export type Formulario2 = {
  anio: string;
  /** `YYYY-MM-DD`. */
  desde: string;
  hasta: string;
  /** La línea roja: "3ª ETAPA: 20 ABRIL - 13 MAYO". */
  etapa: string;
  institucion: {
    nombre: string;
    direccion: string;
    departamento: string;
    ciudad: string;
    barrio: string;
  };
  autoridades: { cargo: string; nombre: string; ci: string; telefono: string }[];
  facilitador: { nombre: string; telefono: string };
  clases: Clase[];
  /** Si se llenan las columnas de intervenciones y el TOTAL (ver {@link CON_INTERVENCIONES}). */
  conIntervenciones: boolean;
};

/**
 * **Por ahora las columnas de la 1° a la 4° intervención salen en blanco**
 * (pedido de Jose el 26/10/2026), y con ellas el TOTAL de cada fila y los
 * totales de 1/0 del pie: un 0 ahí diría "no se dio", y es "no se muestra".
 * Con `false` ni se piden las intervenciones. Para llenarlas, pasar a `true`:
 * las reglas del encabezado siguen armadas y probadas.
 */
export const CON_INTERVENCIONES = false;

/** La coordinación nacional que imprime la cabecera (la misma del Form. 1). */
export const COORDINACION = { nombre: "Cecilia Rafael", telefono: "0983 196085" };

/* -------------------------------------------------------------------------- */
/* Etapa                                                                      */
/* -------------------------------------------------------------------------- */

const MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SETIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

/** "2026-04-20" → "20 ABRIL". */
const diaMes = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1] ?? ""}`;

/**
 * La línea de la etapa armada con las fechas: "ETAPA: 20 ABRIL - 13 MAYO", o
 * "3ª ETAPA: …" si se eligió una de la tabla. La pantalla deja escribirla.
 */
export function textoEtapa(desde: string, hasta: string, numero?: number | null): string {
  if (!desde || !hasta) return "";
  return `${numero ? `${numero}ª ` : ""}ETAPA: ${diaMes(desde)} - ${diaMes(hasta)}`;
}

/* -------------------------------------------------------------------------- */
/* Armado                                                                     */
/* -------------------------------------------------------------------------- */

/** "DD/MM/YYYY" → "YYYY-MM-DD". */
const aISO = (f: string | null) => {
  const m = f?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/** El día de la semana de un `YYYY-MM-DD` como clave de `DIAS` (sábado y domingo: null). */
const diaDeFecha = (f: string): ClaveDia | null => {
  const d = new Date(`${f}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return d >= 1 && d <= 5 ? DIAS[d - 1].clave : null;
};

const nroIndice = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

/** Las columnas con algo, como texto: la clave para juntar secciones. */
const usadas = (r: Record<string, number>) =>
  Object.entries(r)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(",");

/**
 * Las clases de un facilitador en una institución con sus intervenciones del
 * rango. `postulaciones` son las del año (de `postulaciones/todas`) y
 * `intervenciones`, las del año de los dos (de `intervenciones-crud`).
 */
export function armarClases(
  postulaciones: PostulacionFila[],
  intervenciones: IntervencionCrud[],
  desde: string,
  hasta: string,
): Clase[] {
  // Una por día, la última (el id más alto), de cada postulación, en el rango.
  const porPostulacion = new Map<number, Map<string, IntervencionCrud>>();
  for (const i of intervenciones) {
    const f = aISO(i.fecha);
    if (!f || f < desde || f > hasta) continue;
    const dias = porPostulacion.get(i.id_postulacion) ?? new Map<string, IntervencionCrud>();
    const antes = dias.get(f);
    if (!antes || antes.id_intervencion < i.id_intervencion) dias.set(f, i);
    porPostulacion.set(i.id_postulacion, dias);
  }

  type Armada = Omit<Clase, "intervenciones" | "sobran"> & {
    todas: Map<string, IntervencionCrud>;
  };
  const clases = new Map<string, Armada>();

  for (const p of postulaciones) {
    const dias = DIAS.filter((d) => p.dias[d.clave].desde);
    const propias = porPostulacion.get(p.id) ?? new Map<string, IntervencionCrud>();
    for (const d of dias) {
      const hora = p.dias[d.clave].desde;
      const clave = [p.turno ?? "", d.clave, hora, usadas(p.grados), usadas(p.manuales)].join("|");
      const clase = clases.get(clave) ?? {
        turno: p.turno,
        dia: d.clave,
        hora,
        renglones: [],
        todas: new Map<string, IntervencionCrud>(),
      };
      clase.renglones.push({
        idPostulacion: p.id,
        seccion: p.seccion,
        enfasis: p.enfasis,
        grados: p.grados,
        manuales: p.manuales,
      });
      // Con varios días, cada intervención va a la fila de su día; la de un
      // día que la postulación no tiene, a la primera.
      for (const [f, i] of propias) {
        const suDia = diaDeFecha(f);
        const tieneSuDia = dias.some((x) => x.clave === suDia);
        if (dias.length > 1 && (tieneSuDia ? suDia !== d.clave : d !== dias[0])) continue;
        const antes = clase.todas.get(f);
        if (!antes || antes.id_intervencion < i.id_intervencion) clase.todas.set(f, i);
      }
      clases.set(clave, clase);
    }
  }

  const ordenDia = (c: ClaveDia) => DIAS.findIndex((d) => d.clave === c);
  return [...clases.values()]
    .map(({ todas, ...c }) => {
      const lista = [...todas.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fecha, i]) => ({
          fecha,
          indice: nroIndice(i.nro_indice),
          hecha: i.si_no.toUpperCase() === "SI",
          motivo: i.si_no.toUpperCase() === "SI" ? "" : (i.motivo_desarrollo ?? ""),
        }));
      return {
        ...c,
        renglones: c.renglones.sort((a, b) =>
          a.seccion.localeCompare(b.seccion, "es", { numeric: true }),
        ),
        intervenciones: lista.slice(0, 4),
        sobran: Math.max(0, lista.length - 4),
      };
    })
    .sort(
      (a, b) =>
        (a.turno ?? 99) - (b.turno ?? 99) ||
        ordenDia(a.dia) - ordenDia(b.dia) ||
        a.hora.localeCompare(b.hora),
    );
}

/** Todas las intervenciones del año de un facilitador en una institución. */
async function intervencionesDelAnio(
  anio: string,
  idFacilitador: number,
  idInstitucion: number,
): Promise<IntervencionCrud[]> {
  const todas: IntervencionCrud[] = [];
  // El backend devuelve hasta 500 por página: se piden hasta tenerlas todas.
  for (let pagina = 1; pagina <= 40; pagina++) {
    const r = await listarCrud({
      anio,
      id_facilitador: idFacilitador,
      id_institucion: idInstitucion,
      limite: 500,
      pagina,
    });
    todas.push(...r.data);
    if (!r.data.length || todas.length >= r.total) break;
  }
  return todas;
}

/** El teléfono del facilitador, de `GET facilitadores`. */
async function telefonoFacilitador(id: number): Promise<string> {
  const r = (await authFetch("facilitadores")) as { data?: Record<string, unknown>[] };
  const f = (r.data ?? []).find((x) => Number(x.id_facilitador) === id);
  return f?.telefono == null ? "" : String(f.telefono);
}

/**
 * El formulario completo. `postulaciones` son las del año que la pantalla ya
 * tiene (las de todas las instituciones): acá se filtran.
 */
export async function cargarFormulario2(o: {
  idInstitucion: number;
  idFacilitador: number;
  facilitador: string;
  desde: string;
  hasta: string;
  etapa: string;
  postulaciones: PostulacionFila[];
}): Promise<Formulario2> {
  const anio = o.desde.slice(0, 4);
  // Si el rango cruza de año, las intervenciones de los dos.
  const anios = [...new Set([anio, o.hasta.slice(0, 4)])];
  const [cab, telefono, ...porAnio] = await Promise.all([
    obtenerFormulario(o.idInstitucion, anio),
    telefonoFacilitador(o.idFacilitador),
    ...(CON_INTERVENCIONES
      ? anios.map((a) => intervencionesDelAnio(a, o.idFacilitador, o.idInstitucion))
      : []),
  ]);
  const propias = o.postulaciones.filter(
    (p) => p.idInstitucion === o.idInstitucion && p.idFacilitador === o.idFacilitador && p.activa,
  );
  return {
    anio,
    desde: o.desde,
    hasta: o.hasta,
    etapa: o.etapa,
    institucion: {
      nombre: cab.nombre,
      direccion: cab.direccion,
      departamento: cab.departamento,
      ciudad: cab.ciudad,
      barrio: cab.barrio,
    },
    autoridades: cab.autoridades,
    facilitador: { nombre: o.facilitador, telefono },
    clases: armarClases(propias, porAnio.flat(), o.desde, o.hasta),
    conIntervenciones: CON_INTERVENCIONES,
  };
}

/* -------------------------------------------------------------------------- */
/* Cuentas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Los grados que van en la planilla: 4° a 6°, 7° a 9° y 1° a 3° de la Media,
 * como la planilla de Jose. 2° y 3° grado se suman al 2° ciclo solo si alguna
 * clase los tiene, para no perder alumnos.
 */
export function gradosDe(clases: Clase[]) {
  const con2y3 = clases.some((c) => c.renglones.some((r) => r.grados.g2 || r.grados.g3));
  return GRADOS.filter((g) => con2y3 || (g.clave !== "g2" && g.clave !== "g3"));
}

export const CICLOS = [
  { titulo: "2º CICLO", claves: ["g2", "g3", "g4", "g5", "g6"] },
  { titulo: "3º CICLO", claves: ["g7", "g8", "g9"] },
  { titulo: "N.MEDIO", claves: ["g1m", "g2m", "g3m"] },
] as const satisfies readonly { titulo: string; claves: readonly ClaveGrado[] }[];

export const sumaGrado = (clases: Clase[], g: ClaveGrado) =>
  clases.reduce((a, c) => a + c.renglones.reduce((b, r) => b + r.grados[g], 0), 0);

export const sumaManual = (clases: Clase[], m: ClaveManual) =>
  clases.reduce((a, c) => a + c.renglones.reduce((b, r) => b + r.manuales[m], 0), 0);

export const totalAlumnos = (clases: Clase[]) =>
  GRADOS.reduce((a, g) => a + sumaGrado(clases, g.clave), 0);

export const totalManuales = (clases: Clase[]) =>
  MANUALES.reduce((a, m) => a + sumaManual(clases, m.clave), 0);

/** Las desarrolladas de una clase: su columna TOTAL. */
export const hechas = (c: Clase) => c.intervenciones.filter((i) => i.hecha).length;

/**
 * "Form. 2 - Escuela Básica N°129 - Nadia Rolón - 20-04-2026 al 13-05-2026":
 * el nombre del archivo y el título del PDF, como "Form. 1 - …".
 */
export function nombreArchivo2(
  f: Pick<Formulario2, "institucion" | "facilitador" | "desde" | "hasta">,
) {
  const limpio = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const fecha = (x: string) => x.split("-").reverse().join("-");
  return [
    "Form. 2",
    limpio(f.institucion.nombre),
    limpio(f.facilitador.nombre),
    `${fecha(f.desde)} al ${fecha(f.hasta)}`,
  ]
    .filter(Boolean)
    .join(" - ");
}
