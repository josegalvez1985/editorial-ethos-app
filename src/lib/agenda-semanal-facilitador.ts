/**
 * El "Formulario N° 3 - Mi agenda semanal del facilitador" (26/10/2026, pedido
 * de Jose con la planilla que usan hoy): la semana de un facilitador en un año
 * lectivo, por turno, con cada clase en su día y su hora. Acá se arman los
 * datos; el dibujo (PDF, imagen y Excel) está en `planilla-agenda-semanal.ts`.
 *
 * ============================================================================
 * DE DÓNDE SALEN LAS CLASES
 * ============================================================================
 *
 * La agenda se arma con "clases" ({@link ClaseAgenda}: institución, turno,
 * día, horas, grados y sección), que salen de una de dos tablas:
 *
 * | Desde | Las clases | Con |
 * | --- | --- | --- |
 * | La pantalla `/agenda-semanal-facilitador` y la pestaña Postulaciones | `POSTULACIONES` (las activas) | {@link clasesDePostulaciones}, sobre `postulaciones/todas` |
 * | La pestaña Pre-horarios de una institución | `PRE_HORARIOS` (todos, confirmados o no, como el Form. 1 de esa pestaña) | {@link clasesDePreHorarios}, sobre `pre-horarios/facilitador` |
 *
 * Lo rojo sale de `GET facilitadores-bloqueos`: sus horarios bloqueados de ese
 * año. Desde una institución, la agenda es la del facilitador entero (con sus
 * otras instituciones) y del año lectivo actual (Jose, 26/10/2026).
 *
 * ============================================================================
 * LAS REGLAS (las acordadas con Jose el 26/10/2026)
 * ============================================================================
 *
 * - **Solo MAÑANA y TARDE.** El turno es el de la clase; una sin turno va por
 *   su hora (antes de las 12:00, mañana). Las de la noche no salen: se avisa
 *   cuántas.
 * - **Las filas salen de las clases:** las horas de inicio y de fin de todas
 *   sus clases del turno (de todos los días), en orden. Cada clase va en la
 *   fila de su hora de inicio.
 * - **Una celda por institución, día y hora:** las clases que coinciden se
 *   juntan ("7° A+B", "8°&9°") y cuentan **1** en Cant.
 * - **Rojo = horario bloqueado** del facilitador ese año: la fila cuya hora cae
 *   dentro de una franja (desde ≤ hora < hasta, o = hasta si ese día no empieza
 *   una clase a esa hora).
 * - **Nombre IE:** el nombre completo de la institución.
 * - **"REUNIÓN DE FACILITADORES"** y lo demás que no está en la base se
 *   completa a mano.
 */

import { authFetch } from "@/lib/api";
import { leerFranjas, type Bloqueo } from "@/lib/facilitadores-bloqueos";
import { minutos } from "@/lib/horario-instituciones";
import {
  DIAS,
  GRADOS,
  type ClaveDia,
  type ClaveGrado,
  type PostulacionFila,
} from "@/lib/postulaciones";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

/** Una clase de la semana, venga de una postulación o de un pre-horario. */
export type ClaseAgenda = {
  idInstitucion: number;
  institucion: string;
  turno: number | null;
  dia: ClaveDia;
  /** `HH:MM`. */
  desde: string;
  hasta: string;
  grados: ClaveGrado[];
  seccion: string;
};

/** Las clases y lo que quedó afuera por no tener día ni hora. */
export type ClasesAgenda = { clases: ClaseAgenda[]; sinHorario: number };

/** Lo que va en un día de una fila: una clase. */
export type CeldaAgenda = { curso: string; institucion: string; cant: number };

export type FilaAgenda = {
  /** `HH:MM`. */
  hora: string;
  clases: Partial<Record<ClaveDia, CeldaAgenda>>;
  bloqueado: Partial<Record<ClaveDia, boolean>>;
};

export type TurnoAgenda = {
  titulo: "MAÑANA" | "TARDE";
  sigla: "TM" | "TT";
  filas: FilaAgenda[];
  totales: Record<ClaveDia, number>;
};

export type Agenda = {
  anio: string;
  facilitador: string;
  turnos: TurnoAgenda[];
  total: number;
  /** Clases de la noche, que no salen. */
  noche: number;
  /** Postulaciones o pre-horarios sin día ni hora, que no salen. */
  sinHorario: number;
  /** Lo de los bloqueos que no se pudo leer como franja: se avisa. */
  bloqueoIlegible: string[];
};

/* -------------------------------------------------------------------------- */
/* Las clases, de cada tabla                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Las de un facilitador desde `postulaciones/todas` (las del año de TODOS: acá
 * se filtran): las activas, una clase por día con hora.
 */
export function clasesDePostulaciones(ps: PostulacionFila[], idFacilitador: number): ClasesAgenda {
  const clases: ClaseAgenda[] = [];
  let sinHorario = 0;
  for (const p of ps) {
    if (p.idFacilitador !== idFacilitador || !p.activa) continue;
    const dias = DIAS.filter((d) => p.dias[d.clave].desde);
    if (!dias.length) sinHorario += 1;
    for (const d of dias) {
      clases.push({
        idInstitucion: p.idInstitucion,
        institucion: p.institucion,
        turno: p.turno,
        dia: d.clave,
        desde: p.dias[d.clave].desde,
        hasta: p.dias[d.clave].hasta,
        grados: GRADOS.filter((g) => p.grados[g.clave]).map((g) => g.clave),
        seccion: p.seccion,
      });
    }
  }
  return { clases, sinHorario };
}

/**
 * Los pre-horarios de un facilitador en TODAS sus instituciones, de un año
 * (`pre-horarios/facilitador`, en `pre_horarios.sql`): todos, confirmados o no,
 * como el Form. 1 de la pestaña Pre-horarios. Cada uno es un grado y un día.
 */
export async function clasesDePreHorarios(
  idFacilitador: number,
  anio: string,
): Promise<ClasesAgenda> {
  const r = (await authFetch(
    `pre-horarios/facilitador?id_facilitador=${idFacilitador}&anio=${encodeURIComponent(anio)}`,
  )) as { data?: Record<string, unknown>[] };
  const s = (v: unknown) => (v == null ? "" : String(v));
  const clases: ClaseAgenda[] = [];
  let sinHorario = 0;
  for (const x of r.data ?? []) {
    const dia = DIAS.find((d) => d.valor === s(x.dia).toUpperCase());
    const desde = s(x.hora_desde);
    if (!dia || !desde) {
      sinHorario += 1;
      continue;
    }
    const grado = GRADOS.find((g) => g.valor === s(x.grado).toUpperCase());
    clases.push({
      idInstitucion: Number(x.id_institucion),
      institucion: s(x.institucion),
      turno: x.turno == null || x.turno === "" ? null : Number(x.turno),
      dia: dia.clave,
      desde,
      hasta: s(x.hora_hasta),
      grados: grado ? [grado.clave] : [],
      seccion: s(x.seccion),
    });
  }
  return { clases, sinHorario };
}

/* -------------------------------------------------------------------------- */
/* Armado                                                                     */
/* -------------------------------------------------------------------------- */

const min = (h: string) => minutos(h) ?? 0;

/** El grado como en la planilla: "4°", "1°M". */
const grado = (clave: string) => GRADOS.find((g) => g.clave === clave)?.corto ?? "";

/**
 * "4°A", "7° A+B", "8°&9°", "7°,8°&9°": los grados (con sus secciones) de las
 * clases que comparten la celda.
 */
export function textoCurso(cs: Pick<ClaseAgenda, "grados" | "seccion">[]): string {
  const porGrado = new Map<string, Set<string>>();
  for (const c of cs) {
    for (const g of c.grados) {
      const secciones = porGrado.get(g) ?? new Set<string>();
      if (c.seccion.trim()) secciones.add(c.seccion.trim());
      porGrado.set(g, secciones);
    }
  }
  const partes = GRADOS.filter((g) => porGrado.has(g.clave)).map((g) => {
    const secciones = [...porGrado.get(g.clave)!].sort((a, b) => a.localeCompare(b, "es"));
    if (!secciones.length) return grado(g.clave);
    // Una sección pegada ("4°A"); varias, con espacio y "+" ("7° A+B").
    return secciones.length === 1
      ? `${grado(g.clave)}${secciones[0]}`
      : `${grado(g.clave)} ${secciones.join("+")}`;
  });
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(",")}&${partes[partes.length - 1]}`;
}

/** MAÑANA o TARDE de una clase; `null` = de la noche (no sale). */
function turnoDe(turno: number | null, hora: string): 0 | 1 | null {
  if (turno === 1) return 0;
  if (turno === 2) return 1;
  if (turno === 3) return null;
  return min(hora) < 12 * 60 ? 0 : 1;
}

/** La agenda de un facilitador con sus clases y su bloqueo de ese año, si tiene. */
export function armarAgenda(o: {
  anio: string;
  facilitador: string;
  clases: ClasesAgenda;
  bloqueo: Bloqueo | null;
}): Agenda {
  type Grupo = {
    turno: 0 | 1;
    dia: ClaveDia;
    hora: string;
    institucion: string;
    cs: ClaseAgenda[];
  };
  const grupos = new Map<string, Grupo>();
  const horas: [Set<string>, Set<string>] = [new Set(), new Set()];
  let noche = 0;

  for (const c of o.clases.clases) {
    const t = turnoDe(c.turno, c.desde);
    if (t == null) {
      noche += 1;
      continue;
    }
    horas[t].add(c.desde);
    if (c.hasta) horas[t].add(c.hasta);
    const clave = [t, c.dia, c.desde, c.idInstitucion].join("|");
    const g = grupos.get(clave) ?? {
      turno: t,
      dia: c.dia,
      hora: c.desde,
      institucion: c.institucion,
      cs: [],
    };
    g.cs.push(c);
    grupos.set(clave, g);
  }

  // Las franjas bloqueadas de cada día.
  const bloqueoIlegible: string[] = [];
  const franjas = Object.fromEntries(
    DIAS.map((d) => {
      const { franjas, sobrante } = leerFranjas(o.bloqueo?.dias[d.clave] ?? "");
      bloqueoIlegible.push(...sobrante.map((s) => `${d.nombre}: ${s}`));
      return [d.clave, franjas];
    }),
  ) as Record<ClaveDia, { desde: string; hasta: string }[]>;

  const turnos = ([0, 1] as const).map((t): TurnoAgenda => {
    const delTurno = [...grupos.values()].filter((g) => g.turno === t);
    const filas = [...horas[t]]
      .sort((a, b) => min(a) - min(b))
      .map((hora): FilaAgenda => {
        const clases: FilaAgenda["clases"] = {};
        const bloqueado: FilaAgenda["bloqueado"] = {};
        for (const d of DIAS) {
          // De varias instituciones a la misma hora, la primera por nombre (no
          // debería pasar: sería el facilitador en dos lugares a la vez).
          const g = delTurno
            .filter((x) => x.dia === d.clave && x.hora === hora)
            .sort((a, b) => a.institucion.localeCompare(b.institucion, "es"))[0];
          if (g) clases[d.clave] = { curso: textoCurso(g.cs), institucion: g.institucion, cant: 1 };
          const h = min(hora);
          bloqueado[d.clave] = franjas[d.clave].some(
            (f) => min(f.desde) <= h && (h < min(f.hasta) || (h === min(f.hasta) && !g)),
          );
        }
        return { hora, clases, bloqueado };
      });
    const totales = Object.fromEntries(
      DIAS.map((d) => [d.clave, filas.reduce((a, f) => a + (f.clases[d.clave]?.cant ?? 0), 0)]),
    ) as Record<ClaveDia, number>;
    return {
      titulo: t === 0 ? "MAÑANA" : "TARDE",
      sigla: t === 0 ? "TM" : "TT",
      filas,
      totales,
    };
  });

  const total = turnos.reduce((a, t) => a + DIAS.reduce((b, d) => b + t.totales[d.clave], 0), 0);
  return {
    anio: o.anio,
    facilitador: o.facilitador,
    turnos,
    total,
    noche,
    sinHorario: o.clases.sinHorario,
    bloqueoIlegible,
  };
}

/** "Form. 3 - Nadia Rolón - 2026": el nombre del archivo y el título del PDF. */
export function nombreArchivo3(a: Pick<Agenda, "facilitador" | "anio">) {
  const nombre = a.facilitador
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return ["Form. 3", nombre, a.anio].filter(Boolean).join(" - ");
}
