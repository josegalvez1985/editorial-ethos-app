/**
 * El PDF del botón "Imprimir" de la página 20 de APEX (Postulaciones): la
 * función `generarPDF` de pdfmake de esa página, pasada a jsPDF + autotable
 * (las librerías del resto de los reportes del sitio).
 *
 * Igual que APEX: hoja oficio apaisada, el nombre de la institución arriba y
 * una tabla con las mismas columnas, encabezados, anchos y colores por
 * columna (Ser y Liderazgo rojo, Hacer verde, Tener violeta, Carácter gris,
 * Visión amarillo, Coraje azul). APEX no imprimía la columna "2°": tampoco va.
 *
 * Distinto: imprime las filas que muestra la grilla (la institución, el año y
 * el turno elegidos). El proceso DATOS de APEX leía V_POSTULACIONES de la
 * institución sin filtrar el año, así que mezclaba todos los años.
 */

import { t } from "@/lib/pdf-base";
import type { PostulacionFila } from "@/lib/postulaciones";

type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** `colorPorColumna` de la página 20. */
const COLOR: Record<string, RGB> = {
  SER: hex("#e74c3c"),
  LIDERAZGO: hex("#e74c3c"),
  HACER: hex("#27ae60"),
  TENER: hex("#c39bd3"),
  CARACTER: hex("#a5a5a5"),
  VISION: hex("#ffee58"),
  CORAJE: hex("#3498db"),
};

type Columna = {
  clave: string;
  titulo: string;
  ancho: number;
  valor: (p: PostulacionFila) => string;
};

const cant = (n: number) => (n ? String(n) : "");
const dia = (f: { desde: string; hasta: string }) =>
  f.desde || f.hasta ? `${f.desde}-${f.hasta}` : "";

/** Las columnas y encabezados de `generarPDF`, en el mismo orden y ancho (pt). */
const COLUMNAS: Columna[] = [
  {
    clave: "TURNO",
    titulo: "Turno",
    ancho: 20,
    valor: (p) => (p.turno == null ? "" : String(p.turno)),
  },
  { clave: "SECCION", titulo: "Sección", ancho: 20, valor: (p) => p.seccion },
  { clave: "ENFASIS", titulo: "Énfasis", ancho: 20, valor: (p) => p.enfasis },
  { clave: "3", titulo: "3º", ancho: 20, valor: (p) => cant(p.grados.g3) },
  { clave: "4", titulo: "4º", ancho: 20, valor: (p) => cant(p.grados.g4) },
  { clave: "5", titulo: "5º", ancho: 20, valor: (p) => cant(p.grados.g5) },
  { clave: "6", titulo: "6º", ancho: 20, valor: (p) => cant(p.grados.g6) },
  { clave: "7", titulo: "7º", ancho: 20, valor: (p) => cant(p.grados.g7) },
  { clave: "8", titulo: "8º", ancho: 20, valor: (p) => cant(p.grados.g8) },
  { clave: "9", titulo: "9º", ancho: 20, valor: (p) => cant(p.grados.g9) },
  { clave: "1M", titulo: "1M", ancho: 20, valor: (p) => cant(p.grados.g1m) },
  { clave: "2M", titulo: "2M", ancho: 20, valor: (p) => cant(p.grados.g2m) },
  { clave: "3M", titulo: "3M", ancho: 20, valor: (p) => cant(p.grados.g3m) },
  { clave: "SER", titulo: "Ser", ancho: 20, valor: (p) => cant(p.manuales.ser) },
  { clave: "HACER", titulo: "Hacer", ancho: 20, valor: (p) => cant(p.manuales.hacer) },
  { clave: "TENER", titulo: "Tener", ancho: 20, valor: (p) => cant(p.manuales.tener) },
  { clave: "CARACTER", titulo: "Carác.", ancho: 20, valor: (p) => cant(p.manuales.caracter) },
  { clave: "VISION", titulo: "Visión", ancho: 20, valor: (p) => cant(p.manuales.vision) },
  { clave: "CORAJE", titulo: "Coraje", ancho: 20, valor: (p) => cant(p.manuales.coraje) },
  { clave: "LIDERAZGO", titulo: "Lider.", ancho: 20, valor: (p) => cant(p.manuales.liderazgo) },
  { clave: "LUNES", titulo: "Lunes", ancho: 25, valor: (p) => dia(p.dias.lunes) },
  { clave: "MARTES", titulo: "Mart.", ancho: 25, valor: (p) => dia(p.dias.martes) },
  { clave: "MIERCOLES", titulo: "Miérc.", ancho: 25, valor: (p) => dia(p.dias.miercoles) },
  { clave: "JUEVES", titulo: "Juev.", ancho: 25, valor: (p) => dia(p.dias.jueves) },
  { clave: "VIERNES", titulo: "Vier.", ancho: 25, valor: (p) => dia(p.dias.viernes) },
  { clave: "NOMBRE_PROFESOR", titulo: "Nombre Prof.", ancho: 75, valor: (p) => p.docente },
  { clave: "TELEFONO", titulo: "Telef.", ancho: 40, valor: (p) => p.telefono },
  { clave: "NOMBRE_FACILITADOR", titulo: "Facilitador", ancho: 75, valor: (p) => p.facilitador },
];

/** El PDF de las filas de UNA institución. */
export async function generarPdfPostulaciones(
  institucion: string,
  filas: PostulacionFila[],
): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  // pdfmake: LEGAL apaisado, márgenes [10, 40, 40, 40] en pt.
  const doc = new jsPDF({ unit: "pt", format: "legal", orientation: "landscape" });
  doc.setProperties({
    title: t(`Postulaciones - ${institucion}`),
    creator: "Juventud con Valores",
  });

  const ancho = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(t(institucion), ancho / 2, 40, { align: "center" });

  autoTable(doc, {
    startY: 56,
    margin: { top: 40, right: 40, bottom: 40, left: 10 },
    theme: "grid",
    head: [COLUMNAS.map((c) => t(c.titulo))],
    body: filas.map((p) => COLUMNAS.map((c) => t(c.valor(p)))),
    styles: {
      font: "helvetica",
      fontSize: 8,
      halign: "center",
      valign: "middle",
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      textColor: [0, 0, 0],
      overflow: "linebreak",
    },
    headStyles: {
      fontStyle: "bold",
      fontSize: 9,
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
    },
    columnStyles: Object.fromEntries(COLUMNAS.map((c, i) => [i, { cellWidth: c.ancho }])),
    // El color de cada columna, en el encabezado y en las filas.
    didParseCell: (d) => {
      const color = COLOR[COLUMNAS[d.column.index]?.clave ?? ""];
      if (color) d.cell.styles.fillColor = color;
    },
  });

  return doc.output("blob");
}

/** "postulaciones-colegio-nacional-2026.pdf". */
export function nombrePdfPostulaciones(institucion: string, anio: string): string {
  const base = institucion
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `postulaciones-${base || "institucion"}${anio ? `-${anio}` : ""}.pdf`;
}
