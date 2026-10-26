/**
 * El motor de las planillas con formato (26/10/2026): una grilla de columnas y
 * filas con celdas que pueden unir varias (como Excel), y de esa grilla, tres
 * salidas que no se pueden desincronizar:
 *
 * - **PDF** (jsPDF): oficio apaisado, en una sola hoja (se achica si hace
 *   falta), vectorial.
 * - **Imagen** (`<canvas>` → PNG), de ~2800 px de ancho.
 * - **Excel** (`exceljs`): las mismas columnas, filas, celdas unidas, colores
 *   y logo, listo para imprimir en oficio apaisado.
 *
 * Lo usan el Form. 2 (`planilla-reporte-diario.ts`) y el Form. 3
 * (`planilla-agenda-semanal.ts`): cada uno arma solo su grilla con
 * {@link nuevaPlanilla}. Las medidas son "unidades" (en la imagen, un píxel
 * antes de escalar); el PDF las escala al ancho de la hoja y el Excel las pasa
 * a caracteres (/ 7) y puntos (× 0,75).
 *
 * jsPDF y exceljs se cargan recién al generar (import dinámico), como en
 * `pdf-base.ts` y `excel-base.ts`.
 */

import type { jsPDF } from "jspdf";

import { argbHex, bajarLibro, relleno } from "@/lib/excel-base";
import { logoDataUrl, t } from "@/lib/pdf-base";

/** Los colores que usa el motor; los de cada formulario van en su archivo. */
const C = { negro: "#111111", blanco: "#ffffff", borde: "#3f3f3f" };

/** Tamaño de letra de base (unidades). */
const T = 12;

/* -------------------------------------------------------------------------- */
/* La grilla                                                                  */
/* -------------------------------------------------------------------------- */

/** Un tramo de texto con su propio estilo (un título con una parte en rojo). */
export type Parte = { t: string; tinta?: string; subrayado?: boolean; negrita?: boolean };

export type Estilo = {
  tam?: number;
  negrita?: boolean;
  cursiva?: boolean;
  tinta?: string;
  fondo?: string;
  alinear?: "left" | "center" | "right";
  /** Varias líneas: corta por palabras y achica la letra hasta que entre. */
  multilinea?: boolean;
  /** Las letras una debajo de otra (los manuales del encabezado). */
  vertical?: boolean;
  sinBorde?: boolean;
  /** Solo en el PDF y la imagen (el marco de las firmas): Excel no lo une. */
  soloDibujo?: boolean;
};

export type Celda = Estilo & {
  f: number;
  c: number;
  nf: number;
  nc: number;
  texto: string | Parte[];
};

export type Planilla = {
  anchos: number[];
  altos: number[];
  celdas: Celda[];
  /** Dónde va el logo (un rango de celdas); sin él, la planilla no lleva logo. */
  logo?: { f: number; c: number; nf: number; nc: number };
};

const textoPlano = (x: string | Parte[]) =>
  typeof x === "string" ? x : x.map((p) => p.t).join("");

/**
 * Una grilla nueva con sus columnas (`[clave, ancho]`, en orden). Devuelve:
 *
 * - `fila(alto)`: agrega una fila y devuelve su número; `cuantas()`, cuántas hay;
 * - `poner(f, desde, hasta, texto, estilo, nf)`: una celda de la columna
 *   `desde` a `hasta` (claves) y de `nf` filas desde la `f`;
 * - `terminar(logo)`: la planilla lista para las salidas.
 */
export function nuevaPlanilla(columnas: [string, number][]) {
  const col = new Map(columnas.map(([k], i) => [k, i]));
  const altos: number[] = [];
  const celdas: Celda[] = [];
  return {
    fila: (alto: number) => altos.push(alto) - 1,
    /** Cuántas filas hay: el número de la próxima. */
    cuantas: () => altos.length,
    poner: (
      f: number,
      desde: string,
      hasta: string,
      texto: Celda["texto"],
      e: Estilo = {},
      nf = 1,
    ) => {
      const c = col.get(desde) ?? 0;
      celdas.push({ f, c, nf, nc: (col.get(hasta) ?? c) - c + 1, texto, ...e });
    },
    terminar: (logo?: Planilla["logo"]): Planilla => ({
      anchos: columnas.map(([, a]) => a),
      altos,
      celdas,
      logo,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* El pintor (PDF e imagen)                                                   */
/* -------------------------------------------------------------------------- */

type Letra = { tam: number; negrita?: boolean; cursiva?: boolean; color?: string };

/** El logo ya cargado, con su tamaño natural para no deformarlo. */
type Logo = { url: string; img: HTMLImageElement };

interface Pintor {
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    fondo: string | null,
    borde: string | null,
  ): void;
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number): void;
  /** Alineado a la izquierda; `y` es el CENTRO vertical del texto. */
  texto(s: string, x: number, y: number, l: Letra): void;
  ancho(s: string, l: Letra): number;
  imagen(logo: Logo, x: number, y: number, w: number, h: number): void;
}

class PintorPdf implements Pintor {
  constructor(
    private doc: jsPDF,
    /** mm por unidad. */
    private k: number,
    private mx: number,
    private my: number,
  ) {}
  private fuente(l: Letra) {
    const estilo =
      l.negrita && l.cursiva ? "bolditalic" : l.negrita ? "bold" : l.cursiva ? "italic" : "normal";
    this.doc.setFont("helvetica", estilo);
    // Unidades → mm → puntos.
    this.doc.setFontSize((l.tam * this.k) / 0.3528);
  }
  private px = (x: number) => this.mx + x * this.k;
  private py = (y: number) => this.my + y * this.k;
  rect(x: number, y: number, w: number, h: number, fondo: string | null, borde: string | null) {
    if (fondo) this.doc.setFillColor(fondo);
    if (borde) {
      this.doc.setDrawColor(borde);
      this.doc.setLineWidth(0.15);
    }
    const estilo = fondo && borde ? "FD" : fondo ? "F" : "S";
    if (fondo || borde) this.doc.rect(this.px(x), this.py(y), w * this.k, h * this.k, estilo);
  }
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number) {
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(grosor * this.k);
    this.doc.line(this.px(x1), this.py(y1), this.px(x2), this.py(y2));
  }
  texto(s: string, x: number, y: number, l: Letra) {
    this.fuente(l);
    this.doc.setTextColor(l.color ?? C.negro);
    this.doc.text(t(s), this.px(x), this.py(y), { baseline: "middle" });
  }
  ancho(s: string, l: Letra) {
    this.fuente(l);
    return this.doc.getTextWidth(t(s)) / this.k;
  }
  imagen(logo: Logo, x: number, y: number, w: number, h: number) {
    this.doc.addImage(logo.url, "PNG", this.px(x), this.py(y), w * this.k, h * this.k);
  }
}

class PintorCanvas implements Pintor {
  constructor(private ctx: CanvasRenderingContext2D) {}
  private fuente(l: Letra) {
    this.ctx.font = `${l.cursiva ? "italic " : ""}${l.negrita ? "bold " : ""}${l.tam}px Helvetica, Arial, sans-serif`;
  }
  rect(x: number, y: number, w: number, h: number, fondo: string | null, borde: string | null) {
    if (fondo) {
      this.ctx.fillStyle = fondo;
      this.ctx.fillRect(x, y, w, h);
    }
    if (borde) {
      this.ctx.strokeStyle = borde;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x, y, w, h);
    }
  }
  linea(x1: number, y1: number, x2: number, y2: number, color: string, grosor: number) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = grosor;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }
  texto(s: string, x: number, y: number, l: Letra) {
    this.fuente(l);
    this.ctx.fillStyle = l.color ?? C.negro;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(s, x, y);
  }
  ancho(s: string, l: Letra) {
    this.fuente(l);
    return this.ctx.measureText(s).width;
  }
  imagen(logo: Logo, x: number, y: number, w: number, h: number) {
    this.ctx.drawImage(logo.img, x, y, w, h);
  }
}

/** Las posiciones de cada columna y fila (una más al final: el borde). */
function medidas(pl: Planilla) {
  const xs = [0];
  for (const a of pl.anchos) xs.push(xs[xs.length - 1] + a);
  const ys = [0];
  for (const a of pl.altos) ys.push(ys[ys.length - 1] + a);
  return { xs, ys, ancho: xs[xs.length - 1], alto: ys[ys.length - 1] };
}

/** Corta un texto en líneas que entren en `w` con esa letra. */
function partir(p: Pintor, s: string, w: number, l: Letra): string[] {
  const lineas: string[] = [];
  for (const parrafo of s.split("\n")) {
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (actual && p.ancho(prueba, l) > w) {
        lineas.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    lineas.push(actual);
  }
  return lineas;
}

function dibujar(p: Pintor, pl: Planilla, logo: Logo | null) {
  const { xs, ys } = medidas(pl);

  for (const c of pl.celdas) {
    const x = xs[c.c];
    const y = ys[c.f];
    const w = xs[c.c + c.nc] - x;
    const h = ys[c.f + c.nf] - y;
    p.rect(x, y, w, h, c.fondo ?? null, c.sinBorde ? null : C.borde);

    const base: Letra = {
      tam: c.tam ?? T,
      negrita: c.negrita,
      cursiva: c.cursiva,
      color: c.tinta ?? C.negro,
    };
    const libre = w - 8;
    const alinear = c.alinear ?? "center";
    const xDe = (ancho: number) =>
      alinear === "left" ? x + 4 : alinear === "right" ? x + w - 4 - ancho : x + (w - ancho) / 2;

    if (c.vertical) {
      const letras = [...textoPlano(c.texto)];
      let tam = base.tam;
      while (tam > 6 && letras.length * tam * 1.05 > h - 4) tam -= 0.5;
      const alto = tam * 1.05;
      letras.forEach((ch, i) => {
        const l = { ...base, tam };
        p.texto(
          ch,
          x + (w - p.ancho(ch, l)) / 2,
          y + (h - letras.length * alto) / 2 + alto * (i + 0.5),
          l,
        );
      });
      continue;
    }

    if (c.multilinea) {
      const s = textoPlano(c.texto);
      if (!s) continue;
      let l = base;
      let lineas = partir(p, s, libre, l);
      while (l.tam > base.tam * 0.5 && lineas.length * l.tam * 1.18 > h - 4) {
        l = { ...l, tam: l.tam - 0.5 };
        lineas = partir(p, s, libre, l);
      }
      const alto = l.tam * 1.18;
      lineas.forEach((ln, i) =>
        p.texto(ln, xDe(p.ancho(ln, l)), y + (h - lineas.length * alto) / 2 + alto * (i + 0.5), l),
      );
      continue;
    }

    // Una línea, con tramos: se achica hasta 3/5 y si no entra, se corta.
    const partes: Parte[] = typeof c.texto === "string" ? [{ t: c.texto }] : c.texto;
    if (!partes.some((q) => q.t)) continue;
    // jsPDF no mide los espacios de las puntas: van aparte, como un hueco.
    const medir = (l: Letra) => {
      const hueco = p.ancho("0", l) * 0.8;
      let total = 0;
      const piezas = partes.map((q, i) => {
        const lq = { ...l, negrita: q.negrita ?? l.negrita, color: q.tinta ?? l.color };
        const antes = i > 0 && (q.t.startsWith(" ") || partes[i - 1].t.endsWith(" ")) ? hueco : 0;
        const ancho = p.ancho(q.t.trim(), lq);
        total += antes + ancho;
        return { ...q, s: q.t.trim(), l: lq, antes, ancho };
      });
      return { piezas, total };
    };
    let l = base;
    let m = medir(l);
    while (l.tam > base.tam * 0.6 && m.total > libre) {
      l = { ...l, tam: l.tam - 0.5 };
      m = medir(l);
    }
    if (m.total > libre && m.piezas.length === 1) {
      let s = m.piezas[0].s;
      while (s.length > 1 && p.ancho(`${s}…`, m.piezas[0].l) > libre) s = s.slice(0, -1);
      m.piezas[0] = { ...m.piezas[0], s: `${s}…`, ancho: p.ancho(`${s}…`, m.piezas[0].l) };
      m.total = m.piezas[0].ancho;
    }
    let px = xDe(m.total);
    const cy = y + h / 2;
    for (const q of m.piezas) {
      px += q.antes;
      p.texto(q.s, px, cy, q.l);
      if (q.subrayado) {
        const yy = cy + q.l.tam * 0.55;
        p.linea(px, yy, px + q.ancho, yy, q.l.color ?? C.negro, Math.max(1, q.l.tam / 14));
      }
      px += q.ancho;
    }
  }

  // El logo, centrado en su lugar y sin deformar.
  if (logo && pl.logo) {
    const { f, c, nf, nc } = pl.logo;
    const x = xs[c];
    const y = ys[f];
    const w = xs[c + nc] - x;
    const h = ys[f + nf] - y;
    const r = Math.min((w - 6) / logo.img.naturalWidth, (h - 6) / logo.img.naturalHeight);
    const lw = logo.img.naturalWidth * r;
    const lh = logo.img.naturalHeight * r;
    p.imagen(logo, x + (w - lw) / 2, y + (h - lh) / 2, lw, lh);
  }
}

/** El logo del sitio, cargado. `null` si no se pudo: el formulario sale igual. */
async function cargarLogo(): Promise<Logo | null> {
  const url = await logoDataUrl();
  if (!url) return null;
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok({ url, img });
    img.onerror = () => ok(null);
    img.src = url;
  });
}

/* -------------------------------------------------------------------------- */
/* Salidas                                                                    */
/* -------------------------------------------------------------------------- */

/** El PDF: oficio apaisado, en una sola hoja (se achica si no entra). */
export async function planillaPdf(pl: Planilla, titulo: string): Promise<Blob> {
  const [{ jsPDF }, logo] = await Promise.all([
    import("jspdf"),
    pl.logo ? cargarLogo() : Promise.resolve(null),
  ]);
  const { ancho, alto } = medidas(pl);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "legal" });
  // El título que muestra la pestaña del visor ("Form. 2 - …").
  doc.setProperties({ title: titulo });
  doc.viewerPreferences({ DisplayDocTitle: true });
  const margen = 6;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const k = Math.min((W - 2 * margen) / ancho, (H - 2 * margen) / alto);
  dibujar(new PintorPdf(doc, k, (W - ancho * k) / 2, margen), pl, logo);
  return doc.output("blob");
}

/** Escala de la imagen: ~2800 px de ancho, como la del Form. 1. */
const ESCALA = 1.5;
const PAD = 12;

/** La imagen PNG del mismo dibujo. */
export async function planillaImagen(pl: Planilla): Promise<Blob> {
  const logo = pl.logo ? await cargarLogo() : null;
  const { ancho, alto } = medidas(pl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((ancho + 2 * PAD) * ESCALA);
  canvas.height = Math.ceil((alto + 2 * PAD) * ESCALA);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no puede dibujar la imagen");
  ctx.fillStyle = C.blanco;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ESCALA, ESCALA);
  ctx.translate(PAD, PAD);
  dibujar(new PintorCanvas(ctx), pl, logo);
  return new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo generar la imagen"))), "image/png"),
  );
}

/**
 * El Excel con el mismo formato: las mismas columnas (unidades / 7 = ancho en
 * caracteres), filas (unidades × 0,75 = puntos), celdas unidas, colores y
 * logo. Oficio apaisado, ajustado a una hoja. Lo descarga como `archivo.xlsx`.
 */
export async function planillaExcel(pl: Planilla, archivo: string, hoja: string): Promise<void> {
  const [mod, logo] = await Promise.all([
    import("exceljs"),
    pl.logo ? cargarLogo() : Promise.resolve(null),
  ]);
  // exceljs es CommonJS: según el empaquetador llega como `default` o suelto.
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Juventud con Valores";
  wb.title = archivo;
  const ws = wb.addWorksheet(hoja.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 5, // oficio (legal)
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
    },
  });
  ws.columns = pl.anchos.map((a) => ({ width: a / 7 }));
  pl.altos.forEach((a, i) => (ws.getRow(i + 1).height = a * 0.75));

  const borde = { style: "thin" as const, color: { argb: argbHex(C.borde) } };
  const fuente = (l: {
    tam: number;
    negrita?: boolean;
    cursiva?: boolean;
    tinta?: string;
    subrayado?: boolean;
  }) => ({
    name: "Arial",
    size: Math.round(l.tam * 0.75 * 2) / 2,
    bold: !!l.negrita,
    italic: !!l.cursiva,
    underline: !!l.subrayado,
    color: { argb: argbHex(l.tinta ?? C.negro) },
  });

  for (const c of pl.celdas) {
    if (c.soloDibujo) continue;
    const [f1, c1, f2, c2] = [c.f + 1, c.c + 1, c.f + c.nf, c.c + c.nc];
    if (f2 > f1 || c2 > c1) ws.mergeCells(f1, c1, f2, c2);
    const cel = ws.getCell(f1, c1);
    const base = { tam: c.tam ?? T, negrita: c.negrita, cursiva: c.cursiva, tinta: c.tinta };
    if (typeof c.texto === "string") {
      // Los números, como números: así se pueden sumar en la planilla.
      cel.value = /^\d+$/.test(c.texto) ? Number(c.texto) : c.texto;
      cel.font = fuente(base);
    } else {
      cel.value = {
        richText: c.texto.map((q) => ({
          text: q.t,
          font: fuente({
            ...base,
            negrita: q.negrita ?? base.negrita,
            tinta: q.tinta ?? base.tinta,
            subrayado: q.subrayado,
          }),
        })),
      };
    }
    cel.alignment = {
      horizontal: c.alinear ?? "center",
      vertical: "middle",
      wrapText: !!c.multilinea,
      ...(c.vertical ? { textRotation: "vertical" as const } : {}),
    };
    // El fondo y el borde, en cada celda del rango: Excel los dibuja por celda.
    for (let f = f1; f <= f2; f++) {
      for (let k = c1; k <= c2; k++) {
        const e = ws.getCell(f, k);
        if (c.fondo) e.fill = relleno(argbHex(c.fondo));
        if (!c.sinBorde) e.border = { top: borde, left: borde, bottom: borde, right: borde };
      }
    }
  }

  if (logo && pl.logo) {
    const { f, c, nf, nc } = pl.logo;
    const w = pl.anchos.slice(c, c + nc).reduce((a, b) => a + b, 0);
    const h = pl.altos.slice(f, f + nf).reduce((a, b) => a + b, 0);
    const r = Math.min((w - 6) / logo.img.naturalWidth, (h - 6) / logo.img.naturalHeight);
    const img = wb.addImage({ base64: logo.url, extension: "png" });
    ws.addImage(img, {
      tl: { col: c + 0.15, row: f + 0.1 },
      ext: { width: logo.img.naturalWidth * r, height: logo.img.naturalHeight * r },
    });
  }

  await bajarLibro(wb, `${archivo}.xlsx`);
}
