/**
 * Lo común de los reportes PDF: el documento, el encabezado con logo, el pie,
 * las tarjetas de resumen, el estilo de las tablas y cómo abrirlo.
 *
 * Lo usan `pdf-inventario.ts` y `pdf-transferencias.ts`. Un reporte nuevo arma
 * solo su cuerpo: todo lo que hace que los PDFs se vean como la misma familia
 * vive acá, para que no se desincronicen.
 *
 * ============================================================================
 * JSPDF SE CARGA RECIÉN AL GENERAR
 * ============================================================================
 *
 * `jspdf` + `jspdf-autotable` pesan cientos de KB y solo los usan los botones
 * de PDF. Van con `import()` dinámico: Vite los parte en un chunk aparte y el
 * resto de la app no los descarga nunca si nadie genera un PDF.
 *
 * ============================================================================
 * LA PESTAÑA SE ABRE ANTES DE GENERAR
 * ============================================================================
 *
 * Los navegadores solo dejan abrir una pestaña **dentro del clic**: un
 * `window.open` después de un `await` (bajar jsPDF, leer el logo) se bloquea
 * como popup. Por eso `abrirPdfEnPestana` abre la pestaña vacía en el acto,
 * muestra "Generando…" y le pone el PDF cuando está. Si igual no se pudo abrir
 * (bloqueador, o la WebView del APK), cae en descargar el archivo.
 *
 * ============================================================================
 * SOLO LATIN-1 EN EL TEXTO
 * ============================================================================
 *
 * Las fuentes de base de jsPDF (Helvetica) usan WinAnsi: tildes y eñes sí, pero
 * "—", "→", "…" o "−" salen como basura. `t()` los reemplaza antes de escribir.
 */

import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";

import { asset } from "@/lib/asset";

export type RGB = [number, number, number];

/** Los colores de la marca, muestreados del logo (ver README → Marca). */
export const NAVY: RGB = [39, 48, 106];
export const ROJO: RGB = [228, 20, 32];
export const GRIS: RGB = [110, 114, 130];
export const AMBAR: RGB = [180, 110, 0];
export const SUAVE: RGB = [243, 245, 251];

export const MARGEN = 14;
export const ANCHO = 210; // A4 vertical, en mm
export const ALTO = 297;
/** Donde empieza el contenido en la primera página, debajo del encabezado. */
export const INICIO_PRIMERA = 38;
/**
 * Donde empieza el contenido de las páginas 2+: debajo del encabezado y de un
 * rótulo de "(continuación)" si el reporte lo dibuja.
 */
export const TOPE_CONTENIDO = 42;

const numero = new Intl.NumberFormat("es-PY");
export const fmt = (n: number | null | undefined) => (n == null ? "-" : numero.format(n));
export const conSigno = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/** Texto seguro para WinAnsi. Ver el encabezado del archivo. */
export function t(s: string): string {
  return (
    s
      .replace(/[–—−]/g, "-")
      .replace(/→/g, ">")
      .replace(/…/g, "...")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      // Lo que quede fuera de Latin-1 imprimible (y los saltos de línea, que en
      // una celda o un título no se quieren) se vuelve "?" en vez de basura.
      .replace(/[^ -ÿ]/g, "?")
  );
}

/** Fecha y hora locales, armadas a mano para no depender del locale. */
function ahora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** El logo como data URL. `null` si no se pudo leer: el PDF sale igual, sin él. */
async function logoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(asset("logo.png"));
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* El documento                                                               */
/* -------------------------------------------------------------------------- */

/** Lo que el encabezado de cada página dice del reporte. */
export type Cabecera = {
  /** "Inventario de manuales". */
  titulo: string;
  /** "Consulta de detalle · Casa Central". */
  subtitulo: string;
  usuario: string;
};

export type Reporte = {
  doc: jsPDF;
  autoTable: (doc: jsPDF, opciones: UserOptions) => void;
  /** Dibuja encabezado y pie en TODAS las páginas y devuelve el PDF. */
  cerrar: () => Blob;
};

/**
 * Un documento A4 listo para escribir el cuerpo desde `INICIO_PRIMERA`.
 *
 * El encabezado y el pie NO se dibujan acá sino en `cerrar()`: recién al final
 * se sabe el total de páginas para "Página X de Y".
 */
export async function nuevoReporte(cab: Cabecera): Promise<Reporte> {
  const [{ jsPDF }, { autoTable }, logo] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    logoDataUrl(),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: t(`${cab.titulo} - ${cab.subtitulo}`),
    author: t(cab.usuario),
    creator: "Juventud con Valores",
  });
  const emitido = ahora();

  const cerrar = () => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);

      // Con alias ("logo") se embebe UNA vez y cada página lo referencia. Sin
      // él iba una copia por página: 3 páginas pesaban 900 KB.
      if (logo) doc.addImage(logo, "PNG", MARGEN, 9, 18, 18, "logo", "FAST");
      const xTitulo = logo ? MARGEN + 22 : MARGEN;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(...NAVY);
      doc.text(t(cab.titulo), xTitulo, 17);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...GRIS);
      doc.text(t(cab.subtitulo), xTitulo, 23);

      doc.setFontSize(8);
      doc.text(t(`Emitido ${emitido}`), ANCHO - MARGEN, 15, { align: "right" });
      doc.text(t(`Por ${cab.usuario}`), ANCHO - MARGEN, 20, { align: "right" });

      // El acento rojo de la franja del logo.
      doc.setDrawColor(...ROJO);
      doc.setLineWidth(0.6);
      doc.line(MARGEN, 30, ANCHO - MARGEN, 30);

      doc.setDrawColor(226, 229, 238);
      doc.setLineWidth(0.2);
      doc.line(MARGEN, ALTO - 13, ANCHO - MARGEN, ALTO - 13);
      doc.setFontSize(7.5);
      doc.setTextColor(...GRIS);
      doc.text(t(`Juventud con Valores · ${cab.titulo}`), MARGEN, ALTO - 8);
      doc.text(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 8, { align: "right" });
    }
    return doc.output("blob");
  };

  return { doc, autoTable, cerrar };
}

/* -------------------------------------------------------------------------- */
/* Piezas del cuerpo                                                          */
/* -------------------------------------------------------------------------- */

/** Las líneas de "qué filtro se usó", en gris. Devuelve la `y` siguiente. */
export function dibujarFiltros(doc: jsPDF, y: number, lineas: string[]): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  for (const l of lineas) {
    const partes = doc.splitTextToSize(t(l), ANCHO - 2 * MARGEN) as string[];
    doc.text(partes, MARGEN, y);
    y += 4.5 * partes.length;
  }
  return y + 1.5;
}

export type Tarjeta = { etiqueta: string; valor: string; color?: RGB };

/** Las tarjetas de resumen, en una fila. Devuelve la `y` siguiente. */
export function dibujarTarjetas(doc: jsPDF, y: number, tarjetas: Tarjeta[]): number {
  const gap = 4;
  const ancho = (ANCHO - 2 * MARGEN - gap * (tarjetas.length - 1)) / tarjetas.length;
  tarjetas.forEach((c, i) => {
    const x = MARGEN + i * (ancho + gap);
    doc.setFillColor(...SUAVE);
    doc.roundedRect(x, y, ancho, 16, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(t(c.etiqueta), x + 3.5, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...(c.color ?? NAVY));
    doc.text(t(c.valor), x + 3.5, y + 12.5);
  });
  doc.setFont("helvetica", "normal");
  return y + 24;
}

/**
 * Un título de sección en navy, con un complemento gris al lado. Si no queda
 * lugar para el título y unas filas, salta de página antes: un título solo al
 * pie de una hoja no dice nada.
 */
export function dibujarSeccion(doc: jsPDF, y: number, titulo: string, detalle = ""): number {
  if (y > ALTO - 40) {
    doc.addPage();
    y = TOPE_CONTENIDO + 4;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text(t(titulo), MARGEN, y);
  if (detalle) {
    const ancho = doc.getTextWidth(t(titulo));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(t(`   ${detalle}`), MARGEN + ancho, y);
  }
  doc.setFont("helvetica", "normal");
  return y + 3;
}

/** El estilo de tabla de la familia: cabecera navy, pie suave, filas finas. */
export const ESTILO_TABLA: Partial<UserOptions> = {
  theme: "plain",
  showFoot: "lastPage",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
    textColor: [40, 42, 54],
    lineColor: [226, 229, 238],
    lineWidth: { bottom: 0.2 },
  },
  headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
  footStyles: { fillColor: SUAVE, textColor: NAVY, fontStyle: "bold" },
  alternateRowStyles: { fillColor: [250, 251, 254] },
  margin: { top: TOPE_CONTENIDO, left: MARGEN, right: MARGEN, bottom: 18 },
};

/** Donde terminó la última tabla, más un respiro. */
export function despuesDeTabla(doc: jsPDF, y: number, respiro = 10): number {
  const fin = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return (fin ?? y) + respiro;
}

/**
 * El rótulo "X (continuación)" en las páginas que una tabla continúa. Va en el
 * `didDrawPage` de la tabla, con la página en que empezó.
 */
export function rotuloContinuacion(doc: jsPDF, paginaInicio: number, texto: string) {
  return () => {
    if (doc.getNumberOfPages() === paginaInicio) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(t(`${texto} (continuación)`), MARGEN, TOPE_CONTENIDO - 3);
    doc.setFont("helvetica", "normal");
  };
}

/* -------------------------------------------------------------------------- */
/* Abrir en una pestaña nueva                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Abre la pestaña YA (dentro del clic) y le pone el PDF cuando está listo.
 * Ver "La pestaña se abre antes de generar" en el encabezado.
 *
 * **Llamarla sin `await` previo en el handler del clic**: el `window.open` de
 * la primera línea tiene que correr en el mismo tick que el clic.
 */
export function abrirPdfEnPestana(
  generar: () => Promise<Blob>,
  nombreArchivo: string,
): Promise<void> {
  const pestana = window.open("", "_blank");
  if (pestana) {
    try {
      pestana.document.title = "Generando PDF…";
      pestana.document.body.innerHTML =
        '<p style="font:14px system-ui,sans-serif;color:#555;padding:32px">Generando el PDF…</p>';
    } catch {
      /* algunos navegadores no dejan escribir en la pestaña: no importa */
    }
  }

  return generar().then(
    (blob) => {
      const url = URL.createObjectURL(blob);
      if (pestana && !pestana.closed) {
        pestana.location.href = url;
      } else {
        // Sin pestaña (bloqueador de popups, WebView): se descarga.
        const a = document.createElement("a");
        a.href = url;
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Largo a propósito: si se revoca antes de que la pestaña termine de
      // cargar, el visor muestra un error en vez del PDF.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    },
    (err) => {
      pestana?.close();
      throw err;
    },
  );
}
