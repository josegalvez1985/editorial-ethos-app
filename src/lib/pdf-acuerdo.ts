/**
 * El "Acuerdo Específico de Cooperación" entre la Editorial Ethos y una
 * institución, en PDF (18/11/2026). Copia el modelo que mandó Jose
 * ("7 MODELO ACUERDO IE"), con los blancos ya completos: el nombre de la
 * institución y su director actual (nombre, C.I. y teléfono), y el año.
 *
 * Sale de la pestaña Postulaciones de la ficha de la institución, al lado del
 * Form. 1, del año elegido ahí. **Solo PDF**, a pedido. No escribe nada.
 *
 * ============================================================================
 * EL TEXTO, TAL CUAL
 * ============================================================================
 *
 * Los artículos se copiaron del modelo con sus negritas, subrayados y hasta
 * sus erratas ("LA INSTITUCION" sin tilde, "INSTITUCIÓN. relativos"): es un
 * documento que se firma y no le toca al sitio corregirlo. Lo que el modelo
 * deja en blanco y el sitio no sabe (la vigencia del Convenio Marco con el MEC,
 * art. 3) sigue en blanco, para completar a mano. Lo mismo un dato que falte:
 * sin director activo, sale la raya.
 *
 * En los textos, `**así**` va en negrita y `~~así~~` subrayado (no `__`: chocaría con las rayas de los blancos).
 *
 * ============================================================================
 * EL DIRECTOR ACTUAL
 * ============================================================================
 *
 * Sale de `INSTITUCIONES_DIRECTORES` (`GET instituciones-directores`), no del
 * formulario: ver {@link directorActual}.
 *
 * jsPDF se carga recién al generar (import dinámico), como en `pdf-base.ts`.
 */

import type { jsPDF } from "jspdf";

import type { Autoridad } from "@/lib/autoridades";
import { logoDataUrl, t } from "@/lib/pdf-base";

/* -------------------------------------------------------------------------- */
/* Los datos                                                                  */
/* -------------------------------------------------------------------------- */

/** Lo fijo del lado de la Editorial. Si cambia quién firma o coordina, se cambia acá. */
const EDITORIAL = {
  presidente: "Santiago Monti",
  ciPresidente: "685944",
  coordinadora: "Cecilia Rafael",
  telCoordinadora: "0983-196085",
  ciudad: "ASUNCIÓN",
};

export type DatosAcuerdo = {
  institucion: string;
  /** El año lectivo del acuerdo: "2026". */
  anio: string;
  director: { nombre: string; ci: string; telefono: string } | null;
};

/**
 * El director de hoy de la institución, de sus filas de
 * `INSTITUCIONES_DIRECTORES`: solo los activos y, entre ellos, primero el del
 * año del acuerdo y con cargo de director (no un vicedirector), después
 * cualquier activo. El backend ya los manda con el período más reciente
 * primero. `null` si no hay ninguno activo.
 */
export function directorActual(filas: Autoridad[], anio: string): DatosAcuerdo["director"] {
  const activos = filas.filter((f) => f.activo);
  const esDirector = (f: Autoridad) => /director/i.test(f.rol) && !/vice/i.test(f.rol);
  const elegido =
    activos.find((f) => f.periodo === anio && esDirector(f)) ??
    activos.find((f) => f.periodo === anio) ??
    activos.find(esDirector) ??
    activos[0];
  if (!elegido) return null;
  return {
    nombre: elegido.persona,
    ci: elegido.personaCi,
    telefono: elegido.telefono || elegido.personaTelefono,
  };
}

/** "Acuerdo - Colegio X - 2026", sin lo que un nombre de archivo no acepta. */
export function nombreArchivoAcuerdo(d: Pick<DatosAcuerdo, "institucion" | "anio">): string {
  const nombre = d.institucion
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return ["Acuerdo", nombre, d.anio].filter(Boolean).join(" - ");
}

/* -------------------------------------------------------------------------- */
/* El texto del modelo                                                        */
/* -------------------------------------------------------------------------- */

const RAYA = "_______________";

/** Un dato en negrita, o la raya del modelo si no está. Sin `*` ni `~` que rompan el marcado. */
const dato = (v: string | null | undefined) => {
  const limpio = (v ?? "").replace(/[*~]+/g, " ").replace(/\s+/g, " ").trim();
  return limpio ? `**${limpio}**` : RAYA;
};

type Parrafo = { texto: string; alinear?: "justificado" | "centro"; antes?: number };

function texto(d: DatosAcuerdo): Parrafo[] {
  const inst = dato(d.institucion.toUpperCase());
  const dir = dato(d.director?.nombre);
  const ci = dato(d.director?.ci);
  const tel = dato(d.director?.telefono);
  const anio = d.anio;
  const e = EDITORIAL;

  const clausula = (s: string): Parrafo => ({ texto: `**${s}**`, antes: 1 });

  return [
    {
      texto: `El presente acuerdo específico es celebrado entre ${inst}, representado/a por ${dir} en su carácter de Director/a, con cédula de identidad civil número ${ci}, en adelante denominado/a LA INSTITUCIÓN, y la EDITORIAL ETHOS, representada en este acto, por el Señor ${e.presidente}, en su carácter de Presidente, con cédula de identidad civil número ${e.ciPresidente}, en adelante denominada LA EDITORIAL. Los intervinientes, que actúan en razón de sus respectivos cargos, se reconocen mutua y recíprocamente la capacidad legal necesaria para la formalización del presente documento y, en su mérito, resuelven acordar las siguientes cláusulas y condiciones:`,
    },
    clausula("CLÁUSULA PRIMERA - Del objeto del acuerdo:"),
    {
      texto: `**Artículo 1:** El presente acuerdo tiene por objeto regular el marco de la colaboración entre LA EDITORIAL y LA INSTITUCIÓN, con relación al Proyecto "JUVENTUD CON VALORES", durante el año académico ${anio}.`,
    },
    {
      texto: `**Artículo 2:** El año académico, a los efectos de este acuerdo, abarca 8 meses, de marzo a octubre del año ${anio}.`,
    },
    clausula("CLÁUSULA SEGUNDA - De las condiciones del acuerdo - Obligaciones de LA EDITORIAL:"),
    {
      texto:
        '**Artículo 3:** La EDITORIAL se COMPROMETE a proveer a LA INSTITUCION en formato digital y a través del grupo (WhatsApp) de la Cooperación, los siguientes documentos: la descripción del Proyecto Juventud con Valores, el Convenio Marco de Cooperación Interinstitucional con el Ministerio de Educación y Ciencias vigente hasta el ___ de __________ del 20___, las Resoluciones N° 40.195, N° 6.182 y N° 6.276 de Declaraciones de Interés Educativo para los Programas Misión Antivirus o del Programa Misión Carácter y sus respectivos contenidos programáticos, y el instructivo del Concurso Nacional "Mi Experiencia JV".',
    },
    {
      texto:
        "**Artículo 4:** En el marco de este acuerdo específico, LA EDITORIAL se compromete a desarrollar los contenidos de los Programas Misión Antivirus y/o Misión Carácter, con grupos de aproximadamente 30 (treinta) estudiantes, de los grados y/o cursos detallados en el Formulario de Postulación de la Institución Educativa, que se anexa a este Acuerdo de Cooperación Específico. Los contenidos se entregarán mediante una (1) **intervención semanal** equivalente a una (1) **clase** con una duración de una (1) **hora cátedra** de 35 (mínimo) a 40 minutos (máximo), y LA EDITORIAL cubrirá los costos del/los **Facilitador/es** asignados a LA INSTITUCIÓN.",
    },
    {
      texto:
        "**Artículo 5:** LA EDITORIAL provee a cada estudiante, sin costo para el mismo ni para LA INSTITUCIÓN, un (1) **manual** del Programa Misión Antivirus o del Programa Misión Carácter que entregará por única vez a los estudiantes al inicio y será válido para todo el año académico.",
    },
    clausula("CLÁUSULA TERCERA - De las condiciones del acuerdo - Obligaciones de LA INSTITUCIÓN:"),
    {
      texto:
        "**Artículo 6:** En cuanto a los ~~días y horarios~~ de las **intervenciones**, LA EDITORIAL completará el Formulario de Postulación de la Institución Educativa con los datos previamente proporcionados por LA INSTITUCIÓN. relativos a la cantidad de estudiantes matriculados por grado/curso, la malla de horarios de clases y recesos, así como el nombre y contacto de los maestros/docentes que estarán en aula con el/la Facilitador/a. Dicho Formulario será remitido a LA INSTITUCIÓN a través del grupo (WhatsApp) de la Cooperación, para su correspondiente revisión y aprobación final, convirtiéndose este documento en un Anexo del presente Acuerdo. Los días y horarios de las intervenciones, se mantendrán lo más estable posible, y cualquier variación deberá ser informada al mencionado grupo y consensuada por ambas partes.",
    },
    {
      texto:
        "**Artículo 7:** En cuanto al ~~contenido, frecuencia, duración y participantes~~ de las **intervenciones**, LA INSTITUCIÓN declara conocer y aceptar que LA EDITORIAL desarrolla exclusivamente los contenidos del Programa Misión Antivirus y/o del Programa Misión Carácter y, a tal efecto, otorga a LA EDITORIAL 1 (una) hora cátedra semanal, con una duración mínima de 35 (treinta y cinco) minutos y máxima de 40 (cuarenta) minutos, dirigida aproximadamente 30 (treinta) estudiantes de los grados y/o cursos detallados en el Formulario de Postulación de LA INSTITUCIÓN. Asimismo, LA INSTITUCIÓN reconoce que, en caso de ausencia de más del 25% (veinticinco por ciento) de los estudiantes del grupo correspondiente, la intervención programada no se llevará a cabo.",
    },
    {
      texto:
        "**Artículo 8:** En cuanto a la ~~responsabilidad hacia los estudiantes~~ durante las **intervenciones,** LA INSTITUCIÓN reconoce que la responsabilidad disciplinaria, de supervisión y custodia de los estudiantes corresponde exclusivamente al maestro/docente nominado en el Formulario de Postulación de la Institución Educativa. En consecuencia, LA INSTITUCIÓN se compromete a garantizar la permanencia del referido maestro/docente desde el inicio hasta la finalización de cada intervención, a fin de velar por la asistencia, el orden y la disciplina del grupo, así como por el adecuado aprovechamiento de los contenidos desarrollados. En caso de ausencia eventual del maestro/docente responsable, LA INSTITUCIÓN se obliga a designar otro/a responsable que permanezca en aula durante toda la intervención, garantizando expresamente que el/la Facilitador/a asignado/a por LA EDITORIAL no asumirá funciones de custodia, supervisión ni responsabilidad disciplinaria del grupo. Asimismo, en **situaciones complejas** que los estudiantes pudieran manifestar al/a la Facilitador/a, ya sea en aula o durante el receso, y que involucren presuntos casos de abuso u otras circunstancias que requieran acción inmediata, LA EDITORIAL se compromete a acompañar al/a la estudiante ante las autoridades de LA INSTITUCIÓN para que este/a les informe directamente de la situación. La responsabilidad de activar los protocolos correspondientes y de dar continuidad al proceso recaerá exclusivamente en LA INSTITUCIÓN, quedando LA EDITORIAL liberada de cualquier obligación o responsabilidad adicional derivada de dichos hechos.",
    },
    {
      texto:
        "**Artículo 9:** En cuanto al ~~reporte~~ de las **intervenciones**, los/las Facilitadores/as contarán con 1 (una) Planilla de Reporte Diario del/de la Facilitador/a, en la cual registrarán cada intervención realizada conforme a lo establecido en el Formulario de Postulación. LA INSTITUCIÓN se compromete a verificar los datos consignados y a firmar dicha planilla de la siguiente manera: el/la **docente** presente en aula firmará al finalizar cada intervención; asimismo, la **Coordinación** y el/la **Director/a** firmarán y sellarán dicha planilla 1 (una) vez al mes. Al momento de la firma mensual, LA INSTITUCIÓN podrá realizar una fotocopia o tomar una fotografía de la planilla para su respaldo y eventual reporte ante el Ministerio de Educación y Ciencias (MEC). En cuanto a las evidencias (fotografías, registros u otros respaldos), cada INSTITUCIÓN será responsable de su autogestión a través de su propio plantel.",
    },
    {
      texto:
        "**Artículo 10:** En cuanto a los **manuales** para los alumnos, LA INSTITUCIÓN por medio de cada maestro/docente de grado/curso, se compromete a otorgar puntaje, como parte de su proceso evaluativo, a los estudiantes que cuenten con el correspondiente manual durante las intervenciones.",
    },
    {
      texto:
        "**Artículo 11:** En cuanto a la **encuesta** digital de retroalimentación de fin de año, LA INSTITUCIÓN autoriza a LA EDITORIAL a compartir en aula, con los estudiantes de 3er. Ciclo y Nivel Medio, un código QR; asimismo, autoriza a compartir con el plantel docente un enlace a través del grupo (WhatsApp) de la Cooperación, con el fin de que procedan a completar la referida encuesta.",
    },
    {
      texto:
        '**Artículo 12:** En cuanto al Concurso Nacional "**Mi Experiencia JV**", LA INSTITUCIÓN se compromete a instruir a su plantel docente de 6to grado, 3er. Ciclo y Nivel Medio, a fin de que consideren este proyecto dentro del proceso de evaluación del alumno y otorguen puntos a los participantes que presenten sus trabajos en tiempo y forma al Facilitador/a.',
    },
    {
      texto:
        "**Artículo 13:** LA INSTITUCIÓN se compromete a compartir con las autoridades competentes del Ministerio de Educación y Ciencias (MEC), los documentos mencionados en los artículos 3, 6 y 9, así como el presente Acuerdo.",
    },
    {
      texto:
        "**Artículo 14:** La firma del Formulario de Postulación y del presente Acuerdo constituye suficiente autorización de parte de LA INSTITUCIÓN hacia LA EDITORIAL para iniciar la Cooperación. LA INSTITUCIÓN garantiza el acceso del/los Facilitador/es de LA EDITORIAL a los grados y/o cursos detallados en dicho Formulario, en los días y horarios convenidos.",
    },
    clausula(
      "CLÁUSULA CUARTA - De los responsables, de la duración del acuerdo y de la colaboración entre los firmantes.",
    ),
    {
      texto: `**Artículo 15**: Cada una de las partes firmantes de este Acuerdo nombrará a un responsable encargado de coordinar todos los asuntos relacionados con el mismo. Por LA EDITORIAL este rol será asumido por la Sra. ${e.coordinadora}, teléfono ${e.telCoordinadora}, y por LA INSTITUCIÓN, por el/la Director/a ${dir}, teléfono ${tel}. LA EDITORIAL habilita el grupo (WhatsApp) de la Cooperación para el envío de documentos, informaciones y avisos relacionados exclusivamente con el Proyecto Juventud con Valores.`,
    },
    {
      texto: `**Artículo 16:** Este acuerdo será válido desde la fecha de la firma hasta el 30 de octubre del ${anio}.`,
    },
    {
      texto: `**Artículo 17:** Las partes suscribientes del presente documento colaborarán en todo momento, de acuerdo con los principios de buena fe y eficacia, para asegurar la correcta ejecución de lo pactado entre las instituciones sujetos del presente Acuerdo. Para que así conste, a los efectos oportunos y en prueba de conformidad, las partes firman el presente documento, en dos ejemplares y a un solo efecto, en la ciudad de ${e.ciudad}, marzo de ${anio}.`,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Maquetado: párrafos justificados con negrita y subrayado                   */
/* -------------------------------------------------------------------------- */

/**
 * A4 vertical, en mm. Las medidas son las que hacen que entre en DOS hojas,
 * como el modelo (una hoja doble faz): con más letra o más margen pasa a tres.
 */
const HOJA = { ancho: 210, alto: 297 };
const MARGEN = { izq: 15, der: 15, arriba: 14, abajo: 13 };
const ANCHO_TEXTO = HOJA.ancho - MARGEN.izq - MARGEN.der;
/** Times, como el modelo (Word, Times New Roman). */
const FUENTE = "times";
const CUERPO = 10;
/** Interlínea, en mm. */
const LINEA = 4.15;
/** Entre párrafos, en mm. */
const ENTRE = 1.9;

type Trozo = { s: string; negrita: boolean; subrayado: boolean };
type Palabra = {
  trozos: Trozo[];
  ancho: number;
  /** Si el espacio ANTES de esta palabra va subrayado (dentro de un `~~…~~`). */
  espacioSubrayado: boolean;
};

function usarFuente(doc: jsPDF, negrita: boolean, tam = CUERPO) {
  doc.setFont(FUENTE, negrita ? "bold" : "normal");
  doc.setFontSize(tam);
}

/** El texto marcado, en palabras con sus trozos de estilo y su ancho. */
function palabras(doc: jsPDF, marcado: string): Palabra[] {
  const out: Palabra[] = [];
  let negrita = false;
  let subrayado = false;
  let actual: Trozo[] = [];
  let espacioSub = false;

  const cerrar = () => {
    if (!actual.length) return;
    let ancho = 0;
    for (const tr of actual) {
      usarFuente(doc, tr.negrita);
      ancho += doc.getTextWidth(tr.s);
    }
    out.push({ trozos: actual, ancho, espacioSubrayado: espacioSub });
    actual = [];
  };

  for (const parte of t(marcado).split(/(\*\*|~~)/)) {
    if (parte === "**") {
      negrita = !negrita;
      continue;
    }
    if (parte === "~~") {
      subrayado = !subrayado;
      continue;
    }
    // Espacios y palabras, alternados.
    for (const pedazo of parte.split(/( +)/)) {
      if (!pedazo) continue;
      if (pedazo.startsWith(" ")) {
        // Cierra la palabra anterior (que se queda con SU espacio previo) y
        // anota cómo va el de la siguiente.
        cerrar();
        espacioSub = subrayado;
        continue;
      }
      actual.push({ s: pedazo, negrita, subrayado });
    }
  }
  cerrar();
  return out;
}

class Escritor {
  y = MARGEN.arriba;
  constructor(public doc: jsPDF) {}

  /** Salta de hoja si lo que sigue (`alto` mm) no entra. */
  lugar(alto: number) {
    if (this.y + alto > HOJA.alto - MARGEN.abajo) {
      this.doc.addPage();
      this.y = MARGEN.arriba + 4;
    }
  }

  parrafo(p: Parrafo) {
    const doc = this.doc;
    this.y += p.antes ?? 0;
    usarFuente(doc, false);
    const espacio = doc.getTextWidth(" ");
    const lista = palabras(doc, p.texto);

    // Corte de líneas, a lo goloso.
    const lineas: Palabra[][] = [];
    let linea: Palabra[] = [];
    let ancho = 0;
    for (const w of lista) {
      const extra = linea.length ? espacio + w.ancho : w.ancho;
      if (linea.length && ancho + extra > ANCHO_TEXTO) {
        lineas.push(linea);
        linea = [w];
        ancho = w.ancho;
      } else {
        linea.push(w);
        ancho += extra;
      }
    }
    if (linea.length) lineas.push(linea);

    lineas.forEach((ws, i) => {
      this.lugar(LINEA);
      const base = this.y + LINEA - 1.2;
      const ocupado = ws.reduce((a, w) => a + w.ancho, 0) + espacio * (ws.length - 1);
      const ultima = i === lineas.length - 1;
      let x = MARGEN.izq;
      let hueco = espacio;
      if (p.alinear === "centro") x += (ANCHO_TEXTO - ocupado) / 2;
      else if (!ultima && ws.length > 1)
        hueco = espacio + (ANCHO_TEXTO - ocupado) / (ws.length - 1);

      ws.forEach((w, j) => {
        if (j > 0) {
          // El espacio subrayado entre dos palabras subrayadas ("días y horarios").
          const previa = ws[j - 1].trozos.at(-1)!;
          if (w.espacioSubrayado && previa.subrayado && w.trozos[0].subrayado)
            this.subrayar(x, x + hueco, base);
          x += hueco;
        }
        for (const tr of w.trozos) {
          usarFuente(doc, tr.negrita);
          doc.text(tr.s, x, base);
          const a = doc.getTextWidth(tr.s);
          if (tr.subrayado) this.subrayar(x, x + a, base);
          x += a;
        }
      });
      this.y += LINEA;
    });
    this.y += ENTRE;
  }

  subrayar(x1: number, x2: number, base: number) {
    this.doc.setLineWidth(0.25);
    this.doc.setDrawColor(0, 0, 0);
    this.doc.line(x1, base + 0.7, x2, base + 0.7);
  }
}

/* -------------------------------------------------------------------------- */
/* El PDF                                                                     */
/* -------------------------------------------------------------------------- */

export async function generarAcuerdoPdf(d: DatosAcuerdo): Promise<Blob> {
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), logoDataUrl()]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: t(nombreArchivoAcuerdo(d)),
    creator: "Juventud con Valores",
  });
  doc.viewerPreferences({ DisplayDocTitle: true });
  doc.setTextColor(0, 0, 0);

  const w = new Escritor(doc);

  // El logo, centrado arriba, como en el modelo.
  if (logo) {
    const lado = 14;
    doc.addImage(logo, "PNG", (HOJA.ancho - lado) / 2, 9, lado, lado, "logo", "FAST");
    w.y = 9 + lado + 2;
  }

  // El título, centrado y en negrita.
  for (const renglon of [
    "ACUERDO ESPECÍFICO DE COOPERACIÓN",
    "ENTRE LA EDITORIAL ETHOS",
    `Y EL/LA ${d.institucion.trim() ? d.institucion.trim().toUpperCase() : RAYA}`,
  ]) {
    usarFuente(doc, true, 10.5);
    const partes = doc.splitTextToSize(t(renglon), ANCHO_TEXTO) as string[];
    for (const p of partes) {
      doc.text(p, HOJA.ancho / 2, w.y + 4, { align: "center" });
      w.y += 4.4;
    }
  }
  w.y += 2.5;

  for (const p of texto(d)) w.parrafo(p);

  firmas(w, d);
  return doc.output("blob");
}

/** Las firmas: el director a la izquierda, la Editorial a la derecha. */
function firmas(w: Escritor, d: DatosAcuerdo) {
  const doc = w.doc;
  w.lugar(38);
  const y = w.y + 3;
  const izq = MARGEN.izq + ANCHO_TEXTO * 0.22;
  const der = MARGEN.izq + ANCHO_TEXTO * 0.78;
  const medio = 26;

  // Derecha: "Editorial Ethos", la raya y la autorización.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Editorial Ethos", der, y, { align: "center" });

  doc.setLineWidth(0.25);
  doc.setDrawColor(0, 0, 0);
  doc.line(izq - medio, y + 22, izq + medio, y + 22);
  doc.line(der - medio, y + 22, der + medio, y + 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(t(`P/Autorización ${EDITORIAL.coordinadora}`), der, y + 27, { align: "center" });

  // Izquierda: "Firma Director IE" y, debajo, quién es.
  doc.text("Firma Director IE", izq, y + 27, { align: "center" });
  if (d.director?.nombre) {
    doc.setFontSize(8.5);
    const nombre = doc.splitTextToSize(t(d.director.nombre), medio * 2 + 10) as string[];
    doc.text(nombre, izq, y + 31.5, { align: "center" });
    if (d.director.ci)
      doc.text(t(`C.I. ${d.director.ci}`), izq, y + 31.5 + 3.8 * nombre.length, {
        align: "center",
      });
  }
  w.y = y + 40;
}
