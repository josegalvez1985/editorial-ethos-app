/**
 * El dibujo del "Formulario N° 3 - Mi agenda semanal del facilitador": la
 * planilla que mandó Jose el 26/10/2026. Los datos se arman en
 * `agenda-semanal-facilitador.ts`.
 *
 * Acá se arma solo la grilla ({@link armarPlanilla}); el PDF, la imagen y el
 * Excel salen de ella con el motor de `planilla-celdas.ts`, igual que el
 * Form. 2.
 */

import { nombreArchivo3, type Agenda, type TurnoAgenda } from "@/lib/agenda-semanal-facilitador";
import {
  nuevaPlanilla,
  planillaExcel,
  planillaImagen,
  planillaPdf,
  type Estilo,
  type Planilla,
} from "@/lib/planilla-celdas";
import { DIAS } from "@/lib/postulaciones";

const C = {
  azul: "#1f3864",
  rojo: "#e00000",
  bloqueo: "#ff0000",
  amarillo: "#ffff00",
  gris: "#d9d9d9",
};

/** "07:00" → "7:00", como la planilla. */
const hora = (h: string) => h.replace(/^0(\d:)/, "$1");

function armarPlanilla(a: Agenda): Planilla {
  const columnas: [string, number][] = [
    ["hora", 58],
    ...DIAS.flatMap((d): [string, number][] => [
      [`${d.clave}_c`, 60],
      [`${d.clave}_i`, 156],
      [`${d.clave}_n`, 40],
    ]),
  ];
  const { fila, poner, terminar } = nuevaPlanilla(columnas);
  const ultima = `${DIAS[DIAS.length - 1].clave}_n`;
  const cab: Estilo = { negrita: true, tam: 12.5, multilinea: true };
  const rojo: Estilo = { negrita: true, tinta: C.rojo };

  /* ---- Título ------------------------------------------------------------- */

  poner(
    fila(24),
    "hora",
    ultima,
    [
      { t: "JUVENTUD CON VALORES - ", tinta: C.azul },
      { t: `EDICIÓN ${a.anio}`, tinta: C.rojo, subrayado: true },
    ],
    { negrita: true, tam: 14 },
  );
  poner(fila(24), "hora", ultima, "FORMULARIO N° 3 - MI AGENDA SEMANAL DEL FACILITADOR", {
    negrita: true,
    tam: 14,
    tinta: C.azul,
    fondo: C.amarillo,
  });
  const rn = fila(22);
  poner(rn, "hora", "lunes_n", "NOMBRE:", { negrita: true, alinear: "left", tam: 13 });
  poner(rn, "martes_c", ultima, a.facilitador.toUpperCase(), { alinear: "left", tam: 13 });

  /* ---- Encabezado --------------------------------------------------------- */

  const h1 = fila(24);
  const h2 = fila(36);
  poner(h1, "hora", "hora", "HORARIO", cab, 2);
  for (const d of DIAS) {
    poner(h1, `${d.clave}_c`, `${d.clave}_n`, d.valor, { negrita: true, tam: 13 });
    poner(h2, `${d.clave}_c`, `${d.clave}_c`, "Curso/ Grado", cab);
    poner(h2, `${d.clave}_i`, `${d.clave}_i`, "Nombre IE", cab);
    poner(h2, `${d.clave}_n`, `${d.clave}_n`, "Cant.", cab);
  }

  /* ---- Mañana y tarde ----------------------------------------------------- */

  const turno = (t: TurnoAgenda) => {
    poner(fila(20), "hora", ultima, t.titulo, { ...rojo, tam: 13 });
    // Sin clases en el turno, un renglón vacío para completar a mano.
    const filas = t.filas.length ? t.filas : [{ hora: "", clases: {}, bloqueado: {} }];
    for (const f of filas) {
      const r = fila(20);
      poner(r, "hora", "hora", hora(f.hora), { alinear: "left" });
      for (const d of DIAS) {
        const c = f.clases[d.clave];
        const fondo = f.bloqueado[d.clave] ? C.bloqueo : undefined;
        poner(r, `${d.clave}_c`, `${d.clave}_c`, c?.curso ?? "", { fondo });
        poner(r, `${d.clave}_i`, `${d.clave}_i`, c?.institucion ?? "", {
          fondo,
          // El nombre completo: en dos renglones si no entra en uno.
          multilinea: true,
        });
        poner(r, `${d.clave}_n`, `${d.clave}_n`, c ? String(c.cant) : "", {
          ...rojo,
          fondo: C.gris,
        });
      }
    }
    const r = fila(20);
    poner(r, "hora", "hora", t.sigla, { ...rojo, fondo: C.gris });
    for (const d of DIAS) {
      poner(r, `${d.clave}_c`, `${d.clave}_i`, "", { fondo: C.gris });
      poner(r, `${d.clave}_n`, `${d.clave}_n`, String(t.totales[d.clave]), {
        ...rojo,
        fondo: C.gris,
      });
    }
  };
  for (const t of a.turnos) turno(t);

  const rt = fila(22);
  poner(rt, "hora", "hora", "TOTAL", rojo);
  poner(rt, "lunes_c", ultima, String(a.total), rojo);

  return terminar();
}

/* -------------------------------------------------------------------------- */
/* Salidas                                                                    */
/* -------------------------------------------------------------------------- */

/** El PDF: oficio apaisado, en una sola hoja. */
export const generarForm3Pdf = (a: Agenda) => planillaPdf(armarPlanilla(a), nombreArchivo3(a));

/** La imagen PNG del mismo dibujo. */
export const generarForm3Imagen = (a: Agenda) => planillaImagen(armarPlanilla(a));

/** El Excel con el mismo formato. */
export const descargarForm3Excel = (a: Agenda) =>
  planillaExcel(armarPlanilla(a), nombreArchivo3(a), "Form. 3");
