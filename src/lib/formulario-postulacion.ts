/**
 * El "Formulario N° 1 - Postulación anual de instituciones educativas": el
 * PDF y la imagen que generaba la página 60 de APEX (botones PDF e IMAGEN,
 * con `genera.js`, pdfmake y html2canvas). Los datos son los del proceso DATOS
 * de esa página, hoy `GET postulaciones/formulario` (ver `postulaciones.sql`).
 *
 * ============================================================================
 * UN DIBUJO, DOS SALIDAS
 * ============================================================================
 *
 * El formulario se dibuja UNA vez, en {@link dibujar}, contra un "pintor" con
 * cuatro primitivas (rectángulo, línea, texto, medir texto). Hay dos pintores:
 *
 * - **PDF** (jsPDF): vectorial, en hoja oficio apaisada, paginado. Si el
 *   detalle no entra, la tabla sigue en la hoja siguiente repitiendo el
 *   encabezado del turno.
 * - **Imagen** (un `<canvas>` → PNG): una sola imagen, larga si hace falta, de
 *   ~2500 px de ancho como la que hacía APEX.
 *
 * Así el PDF y la imagen no se pueden desincronizar, y no hace falta
 * html2canvas ni un HTML escondido en la página. Las medidas son "unidades"
 * del dibujo: en la imagen, un píxel; en el PDF se escalan para que el ancho
 * entre en la hoja.
 *
 * El diseño copia el formulario que mandó Jose el 09/10/2026 (la imagen que
 * generaba APEX): bandas, colores de los manuales, subtotal por turno en
 * amarillo, total general en celeste y el texto de la declaración, tal cual,
 * incluso "Cómo tal" y "ésta".
 *
 * jsPDF se carga recién al generar (import dinámico), como en `pdf-base.ts`.
 */

import type { jsPDF } from "jspdf";

import { nombreTurno } from "@/lib/evaluaciones";
import { t } from "@/lib/pdf-base";
import {
  DIAS,
  duracion,
  GRADOS,
  MANUALES,
  sumaGrados,
  sumaManuales,
  type ClaveGrado,
  type ClaveManual,
  type Detalle,
  type Formulario,
} from "@/lib/postulaciones";

/* -------------------------------------------------------------------------- */
/* Textos fijos del formulario                                                */
/* -------------------------------------------------------------------------- */

/**
 * La declaración, como la imprimía `genera.js`. Lo que va entre ** sale en
 * negrita. `{anio}` es el año de la postulación.
 */
const DECLARACION =
  '**DECLARO** haber recibido en formato digital los siguientes documentos del Proyecto Estudiantil Juventud con Valores: 1) Carta de Presentación, 2) Proyecto, 3) Sub-Proyecto "Mi Experiencia JV", 4) Convenio Marco firmado entre La Editorial Ethos y el MEC, 5) Resoluciones de Declaración de Interés Educativo del MEC (Programas), 6) Contenido Programático de los Programas Misión Antivirus y Misión Carácter, y el 7) Modelo del Acuerdo de Cooperación Interinstitucional. En mi carácter de Director/a General de esta Institución Educativa, **POSTULO** los grados/cursos arriba detallados para recibir el Proyecto Estudiantil Juventud con Valores, durante el período académico {anio}. **ENTIENDO** que de aprobarse esta Postulación, La Editorial Ethos invertirá una suma importante de su Presupuesto para entregar clases de Principios y Valores y manuales de forma totalmente gratuita a los estudiantes de estos grados/cursos. Cómo tal, en contrapartida **ME COMPROMETO** a cumplir a partir de este momento con los **REQUISITOS** establecidos en la **CLÁUSULA TERCERA - De las condiciones del Acuerdo - Obligaciones de LA INSTITUCIÓN,** del Acuerdo de Cooperación Interinstitucional que firmaremos formalmente con La Editorial Ethos, antes del inicio de las intervenciones/clases.';

const NOTA = "**NOTA:** La Editorial Ethos se reserva el derecho de admisión de ésta postulación.";

/** El contacto impreso. Si cambia la coordinación, se cambia acá. */
const CONTACTO =
  "**CONTACTO:** La Editorial Ethos - Coordinación Nacional del Proyecto Juventud con Valores - Cecilia Rafael 0983-196085.";

/* -------------------------------------------------------------------------- */
/* Colores y medidas                                                          */
/* -------------------------------------------------------------------------- */

const C = {
  navy: "#1f4e79",
  turno: "#1f3864",
  azul: "#2e75b6",
  claro: "#dae3f3",
  amarillo: "#ffff00",
  subtotal: "#fff2cc",
  total: "#bdd7ee",
  borde: "#8c8c8c",
  verde: "#1e9e4a",
  negro: "#111111",
  blanco: "#ffffff",
};

/** Alto de una fila de la tabla. */
const FILA = 26;
/** Tamaños de letra (unidades). */
const T = { banda: 22, dato: 22, tabla: 15, cuerpo: 19, firma: 21 };

type Col = { clave: string; ancho: number };

/** Las columnas de la tabla, en orden, con su ancho (proporciones de APEX). */
const COLS: Col[] = [
  { clave: "n", ancho: 30 },
  ...GRADOS.map((g) => ({ clave: g.clave, ancho: g.clave.endsWith("m") ? 56 : 40 })),
  { clave: "sec", ancho: 55 },
  { clave: "enf", ancho: 95 },
  ...MANUALES.map((m) => ({ clave: m.clave, ancho: 64 })),
  ...DIAS.flatMap((d) => [
    { clave: `${d.clave}_d`, ancho: 72 },
    { clave: `${d.clave}_h`, ancho: 72 },
  ]),
  { clave: "dur", ancho: 60 },
  { clave: "materia", ancho: 222 },
  { clave: "nombre", ancho: 225 },
  { clave: "celular", ancho: 152 },
];

const X: Record<string, number> = {};
const W: Record<string, number> = {};
{
  let x = 0;
  for (const c of COLS) {
    X[c.clave] = x;
    W[c.clave] = c.ancho;
    x += c.ancho;
  }
}
/** Ancho total del dibujo. */
const ANCHO = COLS.reduce((a, c) => a + c.ancho, 0);

/** x y ancho de un tramo de columnas, de `desde` a `hasta` inclusive. */
const tramo = (desde: string, hasta: string) => ({
  x: X[desde],
  w: X[hasta] + W[hasta] - X[desde],
});

/* -------------------------------------------------------------------------- */
/* El pintor                                                                  */
/* -------------------------------------------------------------------------- */

type Estilo = {
  tam: number;
  negrita?: boolean;
  color?: string;
  alinear?: "left" | "center" | "right";
};

interface Pintor {
  rect(x: number, y: number, w: number, h: number, relleno: string | null, borde?: string): void;
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number): void;
  /** `y` es el CENTRO vertical del texto. */
  texto(s: string, x: number, y: number, e: Estilo): void;
  ancho(s: string, tam: number, negrita?: boolean): number;
  nuevaPagina(): void;
}

class PintorPdf implements Pintor {
  constructor(
    private doc: jsPDF,
    /** mm por unidad. */
    private k: number,
    private margen: number,
  ) {}
  private fuente(tam: number, negrita?: boolean) {
    this.doc.setFont("helvetica", negrita ? "bold" : "normal");
    // Unidades → mm → puntos.
    this.doc.setFontSize((tam * this.k) / 0.3528);
  }
  rect(x: number, y: number, w: number, h: number, relleno: string | null, borde?: string) {
    const [px, py] = [this.margen + x * this.k, this.margen + y * this.k];
    if (relleno) this.doc.setFillColor(relleno);
    if (borde) {
      this.doc.setDrawColor(borde);
      this.doc.setLineWidth(0.15);
    }
    const estilo = relleno && borde ? "FD" : relleno ? "F" : "S";
    if (relleno || borde) this.doc.rect(px, py, w * this.k, h * this.k, estilo);
  }
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number) {
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(grosor * this.k);
    const m = this.margen;
    this.doc.line(m + x1 * this.k, m + y1 * this.k, m + x2 * this.k, m + y2 * this.k);
  }
  texto(s: string, x: number, y: number, e: Estilo) {
    this.fuente(e.tam, e.negrita);
    this.doc.setTextColor(e.color ?? C.negro);
    this.doc.text(t(s), this.margen + x * this.k, this.margen + y * this.k, {
      align: e.alinear ?? "left",
      baseline: "middle",
    });
  }
  ancho(s: string, tam: number, negrita?: boolean) {
    this.fuente(tam, negrita);
    return this.doc.getTextWidth(t(s)) / this.k;
  }
  nuevaPagina() {
    this.doc.addPage();
  }
}

class PintorCanvas implements Pintor {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private margen: number,
    /** Solo medir: la primera pasada, para saber el alto de la imagen. */
    private soloMedir = false,
  ) {}
  private fuente(tam: number, negrita?: boolean) {
    this.ctx.font = `${negrita ? "bold " : ""}${tam}px Helvetica, Arial, sans-serif`;
  }
  rect(x: number, y: number, w: number, h: number, relleno: string | null, borde?: string) {
    if (this.soloMedir) return;
    const [px, py] = [this.margen + x, this.margen + y];
    if (relleno) {
      this.ctx.fillStyle = relleno;
      this.ctx.fillRect(px, py, w, h);
    }
    if (borde) {
      this.ctx.strokeStyle = borde;
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeRect(px, py, w, h);
    }
  }
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number) {
    if (this.soloMedir) return;
    const m = this.margen;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = grosor;
    this.ctx.beginPath();
    this.ctx.moveTo(m + x1, m + y1);
    this.ctx.lineTo(m + x2, m + y2);
    this.ctx.stroke();
  }
  texto(s: string, x: number, y: number, e: Estilo) {
    if (this.soloMedir) return;
    this.fuente(e.tam, e.negrita);
    this.ctx.fillStyle = e.color ?? C.negro;
    this.ctx.textAlign = e.alinear ?? "left";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(s, this.margen + x, this.margen + y);
  }
  ancho(s: string, tam: number, negrita?: boolean) {
    this.fuente(tam, negrita);
    return this.ctx.measureText(s).width;
  }
  nuevaPagina() {
    /* la imagen es una sola */
  }
}

/* -------------------------------------------------------------------------- */
/* El dibujo                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dibuja el formulario y devuelve el alto que ocupó (de la última hoja, si
 * pagina). `alto`: el alto útil de una hoja, en unidades; `null` = no paginar.
 */
function dibujar(p: Pintor, f: Formulario, alto: number | null): number {
  let y = 0;

  /** Si `h` no entra en la hoja, hoja nueva (y lo que haya que repetir). */
  const asegurar = (h: number, alPartir?: () => void) => {
    if (alto != null && y + h > alto) {
      p.nuevaPagina();
      y = 0;
      alPartir?.();
    }
  };

  /** Un texto que entra en `w`: achica la letra hasta 3/4 y si no, lo corta. */
  const ajustar = (s: string, w: number, e: Estilo): [string, Estilo] => {
    const libre = w - 8;
    let tam = e.tam;
    while (tam > e.tam * 0.75 && p.ancho(s, tam, e.negrita) > libre) tam -= 0.5;
    let txt = s;
    while (txt.length > 1 && p.ancho(txt, tam, e.negrita) > libre) txt = txt.slice(0, -2) + "…";
    return [txt, { ...e, tam }];
  };

  const celda = (x: number, w: number, h: number, texto: string, fondo: string, e?: Estilo) => {
    p.rect(x, y, w, h, fondo, C.borde);
    if (texto) {
      const est: Estilo = { tam: T.tabla, alinear: "center", ...e };
      const [s, e2] = ajustar(texto, w, est);
      const tx = est.alinear === "left" ? x + 5 : est.alinear === "right" ? x + w - 5 : x + w / 2;
      p.texto(s, tx, y + h / 2, e2);
    }
  };

  /** Una línea con tramos normales y en negrita (marcados con **). */
  const tramos = (s: string) =>
    s
      .split("**")
      .map((texto, i) => ({ texto, negrita: i % 2 === 1 }))
      .filter((x) => x.texto);

  /** Un párrafo justificado, palabra por palabra, en el ancho total. */
  const parrafo = (s: string, tam: number, interlinea: number) => {
    const palabras = tramos(s).flatMap((tr) =>
      tr.texto
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ w, negrita: tr.negrita, ancho: p.ancho(w, tam, tr.negrita) })),
    );
    const espacio = p.ancho(" ", tam);
    const lineas: (typeof palabras)[] = [];
    let actual: typeof palabras = [];
    let usado = 0;
    for (const pal of palabras) {
      const extra = actual.length ? espacio + pal.ancho : pal.ancho;
      if (actual.length && usado + extra > ANCHO) {
        lineas.push(actual);
        actual = [pal];
        usado = pal.ancho;
      } else {
        actual.push(pal);
        usado += extra;
      }
    }
    if (actual.length) lineas.push(actual);
    lineas.forEach((l, i) => {
      asegurar(interlinea);
      const ultima = i === lineas.length - 1;
      const ocupado = l.reduce((a, x) => a + x.ancho, 0);
      const hueco = !ultima && l.length > 1 ? (ANCHO - ocupado) / (l.length - 1) : espacio;
      let x = 0;
      for (const pal of l) {
        p.texto(pal.w, x, y + interlinea / 2, { tam, negrita: pal.negrita });
        x += pal.ancho + hueco;
      }
      y += interlinea;
    });
  };

  /* ---- Encabezado --------------------------------------------------------- */

  p.rect(0, y, ANCHO, 92, C.navy);
  p.texto(`LA EDITORIAL ETHOS - JUVENTUD CON VALORES - EDICIÓN ${f.anio}`, ANCHO / 2, y + 46, {
    tam: T.banda,
    negrita: true,
    color: C.blanco,
    alinear: "center",
  });
  y += 102;
  p.rect(0, y, ANCHO, 55, C.amarillo);
  p.texto(
    "FORMULARIO N°1 - POSTULACIÓN ANUAL DE INSTITUCIONES EDUCATIVAS (IEs) - ANEXO ACUERDO DE COOPERACIÓN INTERINSTITUCIONAL",
    ANCHO / 2,
    y + 28,
    { tam: T.banda, negrita: true, alinear: "center" },
  );
  y += 55;

  // Datos de la institución: etiqueta a la izquierda, datos desde x = 414.
  const XD = 414;
  const anchoDatos = ANCHO - XD;
  const dato = (s: string) => ajustar(s, anchoDatos, { tam: T.dato });
  y += 42;
  p.texto("DATOS INSTITUCIÓN:", 10, y, { tam: T.dato, negrita: true });
  {
    const [s, e] = dato(`NOMBRE: ${f.nombre}   |   DIRECCIÓN: ${f.direccion}`);
    p.texto(s, XD, y, e);
  }
  y += 44;
  {
    const [s, e] = dato(
      `DPTO: ${f.departamento}   |   CIUDAD: ${f.ciudad}   |   BARRIO: ${f.barrio}`,
    );
    p.texto(s, XD, y, e);
  }
  y += 22;
  p.linea(0, y, ANCHO, y, C.negro, 2);

  // Autoridades del período: una por línea, al lado de la etiqueta.
  y += 24;
  const autoridades = f.autoridades.map((a) =>
    [
      `${a.cargo ? `${a.cargo.toUpperCase()}: ` : ""}${a.nombre}`,
      a.ci && `CI: ${a.ci}`,
      a.telefono && `CEL: ${a.telefono}`,
    ]
      .filter(Boolean)
      .join("   |   "),
  );
  p.texto("DATOS PRINCIPALES", 10, y, { tam: T.dato, negrita: true });
  p.texto("AUTORIDADES:", 10, y + 26, { tam: T.dato, negrita: true });
  autoridades.forEach((a, i) => {
    const [s, e] = dato(a);
    p.texto(s, XD, y + i * 26, { ...e, tam: Math.min(e.tam, 20) });
  });
  y += Math.max(2, autoridades.length) * 26;

  // El horario de la institución del año (DATOS lo devolvía), si hay.
  if (f.horarios.length) {
    y += 14;
    const porTurno = new Map<string, string[]>();
    for (const h of f.horarios) {
      const k = (nombreTurno(h.turno) ?? "Sin turno").toUpperCase();
      porTurno.set(k, [...(porTurno.get(k) ?? []), `${h.inicio}-${h.fin}`]);
    }
    p.texto("HORARIO INSTITUCIÓN:", 10, y, { tam: T.dato, negrita: true });
    [...porTurno].forEach(([turno, bloques], i) => {
      const [s, e] = dato(`${turno}: ${bloques.join("  ·  ")}`);
      p.texto(s, XD, y + i * 26, { ...e, tam: Math.min(e.tam, 20) });
    });
    y += Math.max(1, porTurno.size) * 26;
  }

  /* ---- Detalle ------------------------------------------------------------ */

  y += 30;
  asegurar(54 + 8 + FILA * 5);
  p.rect(0, y, ANCHO, 54, C.navy);
  p.texto("DETALLE DE POSTULACIONES", ANCHO / 2, y + 27, {
    tam: T.banda,
    negrita: true,
    color: C.blanco,
    alinear: "center",
  });
  y += 62;

  const negrita = (color = C.negro): Estilo => ({ tam: T.tabla, negrita: true, color });
  const ult = COLS[COLS.length - 1].clave;

  const encabezado = (titulo: string) => {
    // Turno.
    p.rect(0, y, ANCHO, FILA, C.turno, C.borde);
    p.texto(titulo, 6, y + FILA / 2, negrita(C.blanco));
    y += FILA;
    // Fila 1: los grupos grandes.
    const azul = (desde: string, hasta: string, s: string) => {
      const r = tramo(desde, hasta);
      celda(r.x, r.w, FILA, s, C.azul, negrita(C.blanco));
    };
    azul("n", "n", "N");
    azul("g2", "enf", "CANTIDAD DE ALUMNO POR GRADO Y CURSO");
    azul("ser", "liderazgo", "CANTIDAD DE ALUMNO POR MANUAL");
    azul("lunes_d", "dur", "HORARIOS");
    azul("materia", ult, "DOCENTES RESPONSABLES");
    y += FILA;
    // Fila 2: ciclos, manuales, días.
    const claro = (desde: string, hasta: string, s: string) => {
      const r = tramo(desde, hasta);
      celda(r.x, r.w, FILA, s, C.claro, negrita());
    };
    claro("n", "n", "");
    claro("g2", "g6", "2° CICLO");
    claro("g7", "g9", "3° CICLO");
    claro("g1m", "g3m", "N. MEDIO");
    claro("sec", "sec", "Sec");
    claro("enf", "enf", "Énfasis");
    for (const m of MANUALES)
      celda(X[m.clave], W[m.clave], FILA, m.corto, m.color, negrita(m.tinta));
    for (const d of DIAS) claro(`${d.clave}_d`, `${d.clave}_h`, d.impreso);
    claro("dur", "dur", "Dur.");
    claro("materia", "materia", "MATERIA");
    claro("nombre", "nombre", "NOMBRE");
    claro("celular", "celular", "CELULAR");
    y += FILA;
    // Fila 3: grados y DE / HASTA.
    claro("n", "n", "");
    for (const g of GRADOS) claro(g.clave, g.clave, g.corto);
    claro("sec", "sec", "");
    claro("enf", "enf", "");
    for (const m of MANUALES) celda(X[m.clave], W[m.clave], FILA, "", m.color);
    for (const d of DIAS) {
      claro(`${d.clave}_d`, `${d.clave}_d`, "DE");
      claro(`${d.clave}_h`, `${d.clave}_h`, "HASTA");
    }
    claro("dur", "dur", "");
    claro("materia", "materia", "");
    claro("nombre", "nombre", "");
    claro("celular", "celular", "");
    y += FILA;
  };

  const n = (v: number) => (v ? String(v) : "");

  /** Una fila de totales: subtotal del turno (amarillo) o total general (celeste). */
  const totales = (filas: Detalle[], fondo: string) => {
    const sum = (c: ClaveGrado) => filas.reduce((a, d) => a + d.grados[c], 0);
    const sumM = (c: ClaveManual) => filas.reduce((a, d) => a + d.manuales[c], 0);
    celda(X.n, W.n, FILA, "", fondo);
    for (const g of GRADOS) celda(X[g.clave], W[g.clave], FILA, n(sum(g.clave)), fondo, negrita());
    celda(X.sec, W.sec, FILA, "", fondo);
    celda(X.enf, W.enf, FILA, "", fondo);
    for (const m of MANUALES)
      celda(X[m.clave], W[m.clave], FILA, n(sumM(m.clave)), m.color, negrita(m.tinta));
    const h = tramo("lunes_d", "dur");
    celda(h.x, h.w, FILA, "", fondo);
    const d = tramo("materia", ult);
    celda(d.x, d.w, FILA, "", fondo);
    y += FILA;
  };

  // Por turno, en orden (1 mañana, 2 tarde, 3 noche; sin turno al final).
  const turnos = [...new Set(f.detalle.map((d) => d.turno))].sort((a, b) => (a ?? 99) - (b ?? 99));
  for (const turno of turnos) {
    const filas = f.detalle.filter((d) => d.turno === turno);
    const titulo = `TURNO: ${(nombreTurno(turno) ?? "Sin turno").toUpperCase()}`;
    asegurar(FILA * 5);
    encabezado(titulo);
    for (const d of filas) {
      asegurar(FILA, () => encabezado(`${titulo} (continuación)`));
      celda(X.n, W.n, FILA, String(d.nroItem), C.blanco);
      for (const g of GRADOS) celda(X[g.clave], W[g.clave], FILA, n(d.grados[g.clave]), C.blanco);
      celda(X.sec, W.sec, FILA, d.seccion, C.blanco);
      celda(X.enf, W.enf, FILA, d.enfasis, C.blanco);
      for (const m of MANUALES)
        celda(X[m.clave], W[m.clave], FILA, n(d.manuales[m.clave]), m.color, negrita(m.tinta));
      for (const dia of DIAS) {
        celda(X[`${dia.clave}_d`], W[`${dia.clave}_d`], FILA, d.dias[dia.clave].desde, C.blanco);
        celda(X[`${dia.clave}_h`], W[`${dia.clave}_h`], FILA, d.dias[dia.clave].hasta, C.blanco);
      }
      celda(X.dur, W.dur, FILA, duracion(d), C.blanco);
      celda(X.materia, W.materia, FILA, d.materia, C.blanco);
      celda(X.nombre, W.nombre, FILA, d.docente, C.blanco);
      celda(X.celular, W.celular, FILA, d.telefono, C.blanco);
      y += FILA;
    }
    asegurar(FILA, () => encabezado(`${titulo} (continuación)`));
    totales(filas, C.subtotal);
  }
  if (f.detalle.length) {
    asegurar(FILA);
    totales(f.detalle, C.total);
  } else {
    asegurar(FILA * 2);
    p.rect(0, y, ANCHO, FILA * 2, C.blanco, C.borde);
    p.texto(`No hay postulaciones activas para ${f.anio}.`, ANCHO / 2, y + FILA, {
      tam: T.tabla + 2,
      alinear: "center",
      color: "#555555",
    });
    y += FILA * 2;
  }

  /* ---- Totales, declaración y firma ---------------------------------------- */

  const alumnos = f.detalle.reduce((a, d) => a + sumaGrados(d), 0);
  const manuales = f.detalle.reduce((a, d) => a + sumaManuales(d), 0);
  y += 22;
  asegurar(30);
  y += 15;
  {
    let x = 0;
    const pieza = (s: string, e: Estilo) => {
      p.texto(s, x, y, e);
      x += p.ancho(s, e.tam, e.negrita);
    };
    // Separaciones explícitas: jsPDF no mide el espacio al final de un texto.
    const hueco = p.ancho("0", T.dato) * 0.6;
    pieza("TOTAL GENERAL DE ALUMNOS:", { tam: T.dato, negrita: true });
    x += hueco;
    pieza(String(alumnos), { tam: T.dato, negrita: true, color: C.verde });
    x += hueco * 2;
    pieza("|", { tam: T.dato });
    x += hueco * 2;
    pieza("TOTAL GENERAL DE MANUALES:", { tam: T.dato, negrita: true });
    x += hueco;
    pieza(String(manuales), { tam: T.dato, negrita: true, color: C.verde });
  }
  y += 15 + 30;

  parrafo(DECLARACION.replace("{anio}", f.anio), T.cuerpo, 20.5);
  y += 20;
  parrafo(NOTA, T.cuerpo, 20.5);
  parrafo(CONTACTO, T.cuerpo, 20.5);

  asegurar(140);
  y += 110;
  p.linea(ANCHO / 2 - 130, y, ANCHO / 2 + 130, y, C.negro, 1.5);
  y += 20;
  p.texto("DIRECTOR/A (firma, fecha y sello)", ANCHO / 2, y, {
    tam: T.firma,
    negrita: true,
    alinear: "center",
  });
  y += 20;
  return y;
}

/* -------------------------------------------------------------------------- */
/* Salidas                                                                    */
/* -------------------------------------------------------------------------- */

/** El PDF: hoja oficio (legal) apaisada, 8 mm de margen, paginado. */
export async function generarFormularioPdf(f: Formulario): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "legal" });
  const margen = 8;
  const anchoHoja = doc.internal.pageSize.getWidth();
  const altoHoja = doc.internal.pageSize.getHeight();
  const k = (anchoHoja - 2 * margen) / ANCHO;
  dibujar(new PintorPdf(doc, k, margen), f, (altoHoja - 2 * margen) / k);
  return doc.output("blob");
}

/** Margen de la imagen, en píxeles. */
const PAD = 18;

/** La imagen: un PNG del ancho del formulario y el alto que haga falta. */
export async function generarFormularioImagen(f: Formulario): Promise<Blob> {
  // Primera pasada: solo medir, para saber el alto.
  const medir = document.createElement("canvas").getContext("2d");
  if (!medir) throw new Error("El navegador no puede dibujar la imagen");
  const alto = dibujar(new PintorCanvas(medir, PAD, true), f, null);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(ANCHO + 2 * PAD);
  canvas.height = Math.ceil(alto + 2 * PAD);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no puede dibujar la imagen");
  ctx.fillStyle = C.blanco;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  dibujar(new PintorCanvas(ctx, PAD), f, null);

  return new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo generar la imagen"))), "image/png"),
  );
}

/** "postulacion-colegio-nacional-2026": para el nombre del archivo. */
export function nombreArchivo(f: Pick<Formulario, "nombre" | "anio">): string {
  const base = f.nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `postulacion-${base || "institucion"}-${f.anio}`;
}
