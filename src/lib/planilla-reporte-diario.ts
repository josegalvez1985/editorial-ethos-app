/**
 * El dibujo del "Formulario N° 2 - Reporte diario del facilitador": la
 * planilla que mandó Jose el 26/10/2026 (la que llenan hoy en Excel). Los
 * datos se arman en `reporte-diario-facilitador.ts`.
 *
 * Acá se arma solo la grilla ({@link armarPlanilla}); el PDF, la imagen y el
 * Excel salen de ella con el motor de `planilla-celdas.ts`, así los tres no se
 * pueden desincronizar.
 */

import { nombreTurno } from "@/lib/evaluaciones";
import {
  nuevaPlanilla,
  planillaExcel,
  planillaImagen,
  planillaPdf,
  type Estilo,
  type Parte,
  type Planilla,
} from "@/lib/planilla-celdas";
import { DIAS, MANUALES } from "@/lib/postulaciones";
import {
  CICLOS,
  COORDINACION,
  gradosDe,
  hechas,
  nombreArchivo2,
  sumaGrado,
  sumaManual,
  totalAlumnos,
  totalManuales,
  type Formulario2,
} from "@/lib/reporte-diario-facilitador";

/* -------------------------------------------------------------------------- */
/* Textos fijos de la planilla                                                */
/* -------------------------------------------------------------------------- */

const MISION =
  "Facilitamos que niños y jóvenes estudiantes descubran, internalicen y apliquen los principios y valores universales en su vida personal y en su comunidad (familia, colegio, barrio, etc.). Nuestro propósito es contribuir a la construcción de un PARAGUAY ÍNTEGRO regido por principios de elevada y comprobada moralidad, con el fin de erradicar la violencia, la pobreza y la corrupción, para construir una sociedad más justa, amable, próspera, de paz, y así elevar el CAPITAL SOCIAL de la Nación.";

const NOTA: Parte[] = [
  {
    t: "* CUANDO NO SE REALIZA LA INTERVENCIÓN PROGRAMADA, JUSTIFICAR ASÍ",
    subrayado: true,
  },
  {
    t: ': "JORNADA SIND.", "LLUVIA", "FERIADO", "ASUETO", "ACTIVIDAD IE" (especifica en comentarios, cuál actividad), "PERSONAL" (justificar en el Whatsapp de JV y en Reporte Digital).',
  },
];

const C = {
  rojo: "#e00000",
  amarillo: "#ffff00",
  verde: "#92d050",
  naranja: "#ffc000",
  gris: "#d9d9d9",
  banda: "#f2f2f2",
};

/* -------------------------------------------------------------------------- */
/* La grilla                                                                  */
/* -------------------------------------------------------------------------- */

/** "2026-05-08" → "08/05". */
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/** TM, TT, TN: la etiqueta del subtotal del turno. */
const siglaTurno = (turno: number | null) => {
  const n = nombreTurno(turno);
  return n ? `T${n.charAt(0).toUpperCase()}` : "S/T";
};

function armarPlanilla(x: Formulario2): Planilla {
  const grados = gradosDe(x.clases).map((g) => g.clave as string);
  const man = MANUALES.map((m) => m.clave as string);
  const ints = [1, 2, 3, 4];

  const columnas: [string, number][] = [
    ["n", 44],
    ...grados.map((k): [string, number] => [k, 30]),
    ["sec", 64],
    ...man.map((k): [string, number] => [k, 27]),
    ["dia", 40],
    ["hr", 46],
    ...ints.flatMap((k): [string, number][] => [
      [`i${k}_ind`, 40],
      [`i${k}_fec`, 62],
      [`i${k}_fir`, 86],
      [`i${k}_uno`, 24],
    ]),
    ["r_aut", 50],
    ["r_dia", 36],
    ["r_hr", 40],
    ["r_ind", 40],
    ["r_fec", 46],
    ["r_fir", 70],
    ["r_uno", 24],
    ["tot", 52],
  ];
  const { fila, poner, cuantas, terminar } = nuevaPlanilla(columnas);
  const g0 = grados[0];

  const rotulo: Estilo = { negrita: true, alinear: "left" };
  const dato: Estilo = { alinear: "left" };
  const cab: Estilo = { negrita: true, tam: 10, multilinea: true };

  /* ---- Título ------------------------------------------------------------- */

  const r0 = fila(36);
  const r1 = fila(24);
  const logo = { f: r0, c: 0, nf: 2, nc: 2 };
  poner(r0, "n", grados[1], "", {}, 2);
  poner(
    r0,
    grados[2],
    "tot",
    [{ t: "JUVENTUD CON VALORES - " }, { t: `EDICIÓN ${x.anio}`, tinta: C.rojo, subrayado: true }],
    { negrita: true, tam: 21 },
  );
  poner(r1, grados[2], "tot", "FORMULARIO N° 2 - REPORTE DIARIO DEL FACILITADOR", {
    negrita: true,
    tam: 15,
    fondo: C.amarillo,
  });

  /* ---- Institución -------------------------------------------------------- */

  const r2 = fila(22);
  const r3 = fila(22);
  const ins = x.institucion;
  poner(r2, "n", "g6", "DATOS INSTITUCIÓN:", { ...rotulo, multilinea: true }, 2);
  poner(r2, "g7", "g3m", "NOMBRE:", rotulo);
  poner(r2, "sec", "i2_uno", ins.nombre, { ...dato, negrita: true });
  poner(r2, "i3_ind", "i3_fec", "DPTO:", rotulo);
  poner(r2, "i3_fir", "i3_uno", ins.departamento, dato);
  poner(r2, "i4_ind", "i4_uno", "FACILITADOR@:", rotulo);
  poner(r2, "r_aut", "r_fec", x.facilitador.nombre.toUpperCase());
  poner(r2, "r_fir", "tot", x.facilitador.telefono);
  poner(r3, "g7", "g3m", "DIRECCIÓN:", rotulo);
  poner(r3, "sec", "hr", ins.direccion, dato);
  poner(r3, "i1_ind", "i1_fec", "CIUDAD:", rotulo);
  poner(r3, "i1_fir", "i2_uno", ins.ciudad, dato);
  poner(r3, "i3_ind", "i3_fec", "BARRIO:", rotulo);
  poner(r3, "i3_fir", "i3_uno", ins.barrio, dato);
  poner(r3, "i4_ind", "i4_uno", "COORD. NACIONAL:", rotulo);
  poner(r3, "r_aut", "r_fec", COORDINACION.nombre);
  poner(r3, "r_fir", "tot", COORDINACION.telefono);

  /* ---- Autoridades y la misión ---------------------------------------------- */

  // Cuatro renglones como mínimo, como la planilla: los que faltan van con los
  // rótulos y vacíos, para completar a mano.
  const vacia = { cargo: "", nombre: "", ci: "", telefono: "" };
  const autoridades = [...x.autoridades];
  while (autoridades.length < 4) autoridades.push(vacia);
  const primera = cuantas();
  for (const a of autoridades) {
    const conCi = !!a.ci;
    const f = fila(20);
    if (conCi) fila(20);
    const n = conCi ? 2 : 1;
    poner(f, "g7", "g3m", "CARGO:", rotulo, n);
    poner(f, "sec", man[2], a.cargo, dato, n);
    poner(f, man[3], man[6], "TÍTULO:", rotulo, n);
    // TÍTULO: la base no lo tiene (ver reporte-diario-facilitador.ts).
    poner(f, "dia", "hr", "", dato, n);
    poner(f, "i1_ind", "i1_fec", "NOMBRE:", rotulo, n);
    poner(f, "i1_fir", "i2_uno", a.nombre, dato, n);
    if (conCi) {
      poner(f, "i3_ind", "i3_fec", "C.I. N°:", rotulo);
      poner(f, "i3_fir", "i3_uno", a.ci, dato);
    }
    poner(f + n - 1, "i3_ind", "i3_fec", "TEL:", rotulo);
    poner(f + n - 1, "i3_fir", "i3_uno", a.telefono, dato);
  }
  const nAut = cuantas() - primera;
  poner(
    primera,
    "n",
    "g6",
    "DATOS PRINCIPALES AUTORIDADES:",
    { ...rotulo, multilinea: true },
    nAut,
  );
  poner(
    primera,
    "i4_ind",
    "tot",
    MISION,
    { negrita: true, cursiva: true, multilinea: true, tam: 10.5 },
    nAut,
  );

  /* ---- La etapa ----------------------------------------------------------- */

  const re = fila(24);
  const dosPuntos = x.etapa.indexOf(":");
  poner(
    re,
    "n",
    "tot",
    dosPuntos > 0
      ? [
          { t: x.etapa.slice(0, dosPuntos), tinta: C.rojo, subrayado: true },
          { t: x.etapa.slice(dosPuntos), tinta: C.rojo },
        ]
      : [{ t: x.etapa, tinta: C.rojo }],
    { negrita: true, tam: 15 },
  );

  /* ---- Encabezado de la tabla --------------------------------------------- */

  const h1 = fila(24);
  const h2 = fila(20);
  const h3 = fila(36);
  poner(h1, "n", "n", "CANT. INT.", cab, 3);
  poner(h1, g0, "g3m", "CANT. ALUM. X GRADO/CURSO", cab);
  for (const ciclo of CICLOS) {
    const suyos = grados.filter((g) => (ciclo.claves as readonly string[]).includes(g));
    if (suyos.length) poner(h2, suyos[0], suyos[suyos.length - 1], ciclo.titulo, cab);
  }
  for (const g of gradosDe(x.clases)) {
    poner(h3, g.clave, g.clave, g.corto.replace("°M", "º").replace("°", "º"), cab);
  }
  poner(h1, "sec", "sec", "A/B, Enfasis/ Esp.", { ...cab, tam: 9.5 }, 3);
  poner(h1, man[0], man[6], "CANT. ALUM. X MANUAL", cab);
  for (const m of MANUALES) {
    poner(
      h2,
      m.clave,
      m.clave,
      m.corto,
      { ...cab, vertical: true, fondo: m.color, tinta: m.tinta },
      2,
    );
  }
  poner(h1, "dia", "hr", "HORARIO ESTABLE", cab, 2);
  poner(h3, "dia", "dia", "DIA", cab);
  poner(h3, "hr", "hr", "HR", cab);
  for (const k of ints) {
    poner(h1, `i${k}_ind`, `i${k}_uno`, `${k}° INTERVENCION ETAPA`, { ...cab, tam: 11 }, 2);
    poner(h3, `i${k}_ind`, `i${k}_ind`, "INDICE", { ...cab, tam: 9.5 });
    poner(h3, `i${k}_fec`, `i${k}_fec`, "FECHA", cab);
    poner(h3, `i${k}_fir`, `i${k}_fir`, "FIRMA PROF. / *JUSTIF.", { ...cab, tam: 9.5 });
    poner(h3, `i${k}_uno`, `i${k}_uno`, "1/0", { ...cab, tam: 9, fondo: C.verde });
  }
  poner(
    h1,
    "r_aut",
    "r_uno",
    "REGISTRO DE RECUPERACIONES JUSTIFICADAS & AUTORIZADAS (máximo 1 x etapa)",
    { ...cab, fondo: C.naranja, tam: 10 },
    2,
  );
  (
    [
      ["r_aut", "AUT. POR:"],
      ["r_dia", "DIA"],
      ["r_hr", "HR"],
      ["r_ind", "INDICE"],
      ["r_fec", "FECHA"],
      ["r_fir", "FIRMA PROF."],
      ["r_uno", "1/0"],
    ] as const
  ).forEach(([k, s]) => poner(h3, k, k, s, { ...cab, tam: 9.5, fondo: C.naranja }));
  poner(h1, "tot", "tot", "TOTAL", { ...cab, fondo: C.verde }, 3);

  /* ---- Detalle, por turno ------------------------------------------------- */

  const num = (v: number) => (v ? String(v) : "");
  const turnos = [...new Set(x.clases.map((c) => c.turno))];
  for (const turno of turnos) {
    const clases = x.clases.filter((c) => c.turno === turno);
    clases.forEach((clase, i) => {
      const n = clase.renglones.length;
      const alto = n > 1 ? 22 : 28;
      const f0 = cuantas();
      for (const r of clase.renglones) {
        const f = fila(alto);
        for (const g of grados) poner(f, g, g, num(r.grados[g as keyof typeof r.grados]));
        poner(f, "sec", "sec", [r.seccion, r.enfasis].filter(Boolean).join(" "));
        for (const m of man) poner(f, m, m, num(r.manuales[m as keyof typeof r.manuales]));
      }
      poner(f0, "n", "n", String(i + 1), {}, n);
      const dia = DIAS.find((d) => d.clave === clase.dia);
      poner(f0, "dia", "dia", (dia?.corto ?? "").toUpperCase(), {}, n);
      poner(f0, "hr", "hr", clase.hora, {}, n);
      for (const k of ints) {
        const iv = clase.intervenciones[k - 1];
        poner(f0, `i${k}_ind`, `i${k}_ind`, iv?.indice ?? "", {}, n);
        poner(f0, `i${k}_fec`, `i${k}_fec`, iv ? ddmm(iv.fecha) : "", {}, n);
        poner(f0, `i${k}_fir`, `i${k}_fir`, iv?.motivo ?? "", { tam: 9, multilinea: true }, n);
        poner(
          f0,
          `i${k}_uno`,
          `i${k}_uno`,
          iv ? (iv.hecha ? "1" : "0") : "",
          {
            negrita: true,
            fondo: C.verde,
          },
          n,
        );
      }
      for (const k of ["r_aut", "r_dia", "r_hr", "r_ind", "r_fec", "r_fir", "r_uno"]) {
        poner(f0, k, k, "", k === "r_aut" || k === "r_uno" ? { fondo: C.naranja } : {}, n);
      }
      poner(
        f0,
        "tot",
        "tot",
        x.conIntervenciones ? String(hechas(clase)) : "",
        { negrita: true, fondo: C.verde },
        n,
      );
    });

    // El subtotal del turno: TM, TT, TN.
    const f = fila(22);
    poner(f, "n", "n", siglaTurno(turno), { negrita: true });
    for (const g of grados) {
      poner(f, g, g, String(sumaGrado(clases, g as never)), { negrita: true });
    }
    poner(f, "sec", "sec", "");
    for (const m of MANUALES) {
      poner(f, m.clave, m.clave, String(sumaManual(clases, m.clave)), {
        negrita: true,
        fondo: m.color,
        tinta: m.tinta,
      });
    }
    poner(f, "dia", "tot", "", { fondo: C.banda });
  }

  /* ---- Totales ------------------------------------------------------------ */

  const rojo: Estilo = { negrita: true, tinta: C.rojo };
  const t1 = fila(22);
  poner(t1, "n", "n", "");
  for (const g of grados) poner(t1, g, g, String(sumaGrado(x.clases, g as never)), rojo);
  poner(t1, "sec", "sec", "");
  for (const m of MANUALES) {
    poner(t1, m.clave, m.clave, String(sumaManual(x.clases, m.clave)), {
      negrita: true,
      fondo: m.color,
      tinta: m.tinta,
    });
  }
  poner(t1, "dia", "tot", "", { fondo: C.banda });

  const t2 = fila(20);
  const t3 = fila(26);
  poner(t2, "n", "n", "TOTAL:", { ...rojo, tam: 11 }, 2);
  for (const ciclo of CICLOS) {
    const suyos = grados.filter((g) => (ciclo.claves as readonly string[]).includes(g));
    if (!suyos.length) continue;
    const suma = suyos.reduce((a, g) => a + sumaGrado(x.clases, g as never), 0);
    poner(t2, suyos[0], suyos[suyos.length - 1], String(suma), rojo);
  }
  poner(t3, g0, "g3m", String(totalAlumnos(x.clases)), { ...rojo, tam: 15 });
  poner(t2, "sec", "sec", "", {}, 2);
  poner(t2, man[0], man[6], String(totalManuales(x.clases)), { ...rojo, tam: 15 }, 2);
  poner(t2, "dia", "hr", "", {}, 2);
  for (const k of ints) {
    poner(t2, `i${k}_ind`, `i${k}_fir`, "", {}, 2);
    const unos = x.clases.filter((c) => c.intervenciones[k - 1]?.hecha).length;
    poner(
      t2,
      `i${k}_uno`,
      `i${k}_uno`,
      x.conIntervenciones ? String(unos) : "",
      { negrita: true, fondo: C.verde },
      2,
    );
  }
  poner(t2, "r_aut", "r_fir", "", {}, 2);
  poner(t2, "r_uno", "r_uno", "", { fondo: C.naranja }, 2);
  const total = x.clases.reduce((a, c) => a + hechas(c), 0);
  poner(
    t2,
    "tot",
    "tot",
    x.conIntervenciones ? String(total) : "",
    { negrita: true, fondo: C.verde },
    2,
  );

  /* ---- Firmas, nota y comentarios ------------------------------------------ */

  const s1 = fila(64);
  const s2 = fila(17);
  const s3 = fila(17);
  poner(s1, "n", "tot", "", { soloDibujo: true }, 3);
  const firma = (desde: string, hasta: string, quien: string, que: string) => {
    poner(s1, desde, hasta, "", { sinBorde: true });
    poner(s2, desde, hasta, quien, { negrita: true, tam: 11, sinBorde: true });
    poner(s3, desde, hasta, que, { tam: 11, sinBorde: true });
  };
  firma("n", "hr", "FACILITADOR/A", "FIRMA, ACLARACIÓN, FECHA, CI.");
  firma("i2_ind", "i3_uno", "COORDINADOR/A COLEGIO", "FIRMA, ACLARACIÓN, FECHA, CI., SELLO");
  firma("r_aut", "tot", "DIRECTOR /A COLEGIO", "FIRMA, ACLARACIÓN, FECHA, CI., SELLO");

  const rn = fila(22);
  poner(rn, "n", "tot", NOTA, { negrita: true, alinear: "left", tam: 11 });
  const rc = fila(34);
  poner(rc, "n", man[0], [{ t: "COMENTARIOS GENERALES:", subrayado: true }], {
    negrita: true,
    alinear: "left",
    fondo: C.gris,
  });
  poner(rc, man[1], "tot", "");

  return terminar(logo);
}

/* -------------------------------------------------------------------------- */
/* Salidas                                                                    */
/* -------------------------------------------------------------------------- */

/** El PDF: oficio apaisado, en una sola hoja. */
export const generarForm2Pdf = (x: Formulario2) => planillaPdf(armarPlanilla(x), nombreArchivo2(x));

/** La imagen PNG del mismo dibujo. */
export const generarForm2Imagen = (x: Formulario2) => planillaImagen(armarPlanilla(x));

/** El Excel con el mismo formato. */
export const descargarForm2Excel = (x: Formulario2) =>
  planillaExcel(armarPlanilla(x), nombreArchivo2(x), "Form. 2");
