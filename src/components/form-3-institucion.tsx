import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, ImageDown, Loader2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  armarAgenda,
  clasesDePostulaciones,
  clasesDePreHorarios,
  nombreArchivo3,
  type Agenda,
} from "@/lib/agenda-semanal-facilitador";
import { keysBloqueos, listarBloqueos } from "@/lib/facilitadores-bloqueos";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import {
  descargarForm3Excel,
  generarForm3Imagen,
  generarForm3Pdf,
} from "@/lib/planilla-agenda-semanal";
import { keysPostulaciones, listarTodasPostulaciones } from "@/lib/postulaciones";
import { keysPreHorarios, listarPreHorarios } from "@/lib/pre-horarios";

type Tipo = "pdf" | "png" | "xlsx";
type Fac = { id: number; nombre: string };

/**
 * `postulaciones/todas` de un año, sin otros filtros. Sin `anio`, el lectivo
 * actual: la misma clave que la primera consulta de `/agenda-semanal-facilitador`.
 */
const delAnio = (anio: string) => ({
  anio,
  idDepartamento: null,
  idCiudad: null,
  idBarrio: null,
  idInstitucion: null,
  turno: null,
});

/**
 * Los botones del Form. 3 (la agenda semanal del facilitador) en las pestañas
 * Pre-horarios y Postulaciones de una institución (26/10/2026), al lado de los
 * del Form. 1: PDF, imagen y Excel con el formato de `/agenda-semanal-facilitador`.
 *
 * Lo acordado con Jose:
 *
 * - **Es la agenda del facilitador**, entera (con sus otras instituciones), de
 *   uno de los que van a esta institución. Si van varios, se elige en un
 *   diálogo; si va uno, sale directo.
 * - **Del año que muestra la pestaña** (27/10/2026, pedido de Jose: en
 *   Postulaciones con 2025 elegido, el título y los registros eran de 2026).
 *   Pre-horarios no tiene selector: es siempre el año actual. Postulaciones
 *   pasa su año en `anio` ("" = el actual).
 * - **Cada pestaña, de su tabla:** Pre-horarios con los pre-horarios (todos,
 *   confirmados o no, como su Form. 1; `pre-horarios/facilitador`),
 *   Postulaciones con las postulaciones activas (`postulaciones/todas`).
 *
 * Los facilitadores son los de esta institución en ese año, en esa misma
 * tabla. Las consultas comparten la caché con la pestaña y con
 * `/agenda-semanal-facilitador`.
 */
export function Form3Institucion({
  origen,
  idInstitucion,
  anio: anioPestana = "",
}: {
  origen: "pre-horarios" | "postulaciones";
  idInstitucion: number;
  anio?: string;
}) {
  const qc = useQueryClient();
  const filtros = delAnio(anioPestana);
  const preHorarios = useQuery({
    queryKey: keysPreHorarios.institucion(idInstitucion),
    queryFn: () => listarPreHorarios(idInstitucion),
    enabled: origen === "pre-horarios",
  });
  const postulaciones = useQuery({
    queryKey: keysPostulaciones.todas(filtros),
    queryFn: () => listarTodasPostulaciones(filtros),
    enabled: origen === "postulaciones",
  });

  // El año de los datos: el que respondió el backend (sin `anio`, el actual).
  const anio =
    (origen === "pre-horarios" ? preHorarios.data?.anioActual : postulaciones.data?.anio) ?? "";

  /** Los facilitadores de esta institución en ese año, por nombre. */
  const facilitadores = useMemo((): Fac[] => {
    const m = new Map<number, string>();
    if (origen === "pre-horarios") {
      // La pestaña lista los del año actual: el mismo `anio` que `anioActual`.
      if (preHorarios.data?.anio === preHorarios.data?.anioActual)
        for (const p of preHorarios.data?.items ?? [])
          if (p.idFacilitador != null) m.set(p.idFacilitador, p.facilitador);
    } else {
      for (const p of postulaciones.data?.items ?? [])
        if (p.idInstitucion === idInstitucion && p.activa && p.idFacilitador != null)
          m.set(p.idFacilitador, p.facilitador);
    }
    return [...m]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [origen, preHorarios.data, postulaciones.data, idInstitucion]);

  const [generando, setGenerando] = useState<Tipo | null>(null);
  const [eligiendo, setEligiendo] = useState<Tipo | null>(null);

  /** La agenda de un facilitador, con los datos de la tabla de esta pestaña. */
  const agendaDe = async (f: Fac): Promise<Agenda> => {
    const [clases, bloqueos] = await Promise.all([
      origen === "pre-horarios"
        ? clasesDePreHorarios(f.id, anio)
        : qc
            .fetchQuery({
              queryKey: keysPostulaciones.todas(filtros),
              queryFn: () => listarTodasPostulaciones(filtros),
            })
            .then((r) => clasesDePostulaciones(r.items, f.id)),
      qc.fetchQuery({ queryKey: keysBloqueos.todo, queryFn: listarBloqueos }),
    ]);
    const bloqueo =
      bloqueos.bloqueos.find((b) => b.idFacilitador === f.id && String(b.anio) === anio) ?? null;
    return armarAgenda({ anio, facilitador: f.nombre, clases, bloqueo });
  };

  /**
   * Sin `await` antes de `abrirPdfEnPestana`: la pestaña se abre dentro del
   * clic (ver pdf-base.ts). Por eso, con varios facilitadores, se genera desde
   * el clic en el diálogo y no después.
   */
  const generar = (tipo: Tipo, f: Fac) => {
    setEligiendo(null);
    setGenerando(tipo);
    const archivo = nombreArchivo3({ facilitador: f.nombre, anio });
    const trabajo =
      tipo === "xlsx"
        ? agendaDe(f).then(descargarForm3Excel)
        : abrirPdfEnPestana(
            () =>
              agendaDe(f).then((a) =>
                tipo === "pdf" ? generarForm3Pdf(a) : generarForm3Imagen(a),
              ),
            `${archivo}.${tipo}`,
            tipo === "pdf" ? "el PDF" : "la imagen",
          );
    trabajo
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar"))
      .finally(() => setGenerando(null));
  };

  const tocar = (tipo: Tipo) => {
    if (facilitadores.length === 1) generar(tipo, facilitadores[0]);
    else setEligiendo(tipo);
  };

  const sinFac = !facilitadores.length;
  const titulo = (que: string) =>
    sinFac
      ? `Ningún facilitador tiene ${origen} de ${anio || "este año"} en esta institución`
      : `La agenda semanal del facilitador (Form. 3) en ${que}, del año ${anio}`;
  const boton = (tipo: Tipo, Icono: typeof FileDown, que: string, clase: string) => (
    <button
      type="button"
      disabled={sinFac || generando != null}
      onClick={() => tocar(tipo)}
      aria-label={`Form. 3 en ${que}`}
      title={titulo(que)}
      className={`flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold disabled:opacity-60 ${clase}`}
    >
      {generando === tipo ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Icono className="size-4" />
      )}
      Form. 3
    </button>
  );

  return (
    <>
      {boton("pdf", FileDown, "PDF", "bg-primary text-primary-foreground shadow-soft")}
      {boton("png", ImageDown, "imagen", "bg-primary-soft text-primary")}
      {boton(
        "xlsx",
        FileSpreadsheet,
        "Excel",
        "border border-primary/40 bg-card text-primary shadow-soft hover:bg-primary-soft",
      )}

      <Dialog open={eligiendo != null} onOpenChange={(abierto) => !abierto && setEligiendo(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>¿De qué facilitador?</DialogTitle>
            <DialogDescription>
              Van {facilitadores.length} a esta institución en {anio}. La agenda es la de su semana
              completa, con sus otras instituciones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {facilitadores.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => eligiendo && generar(eligiendo, f)}
                className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 text-left text-sm font-medium hover:border-primary/40 hover:bg-primary-soft"
              >
                <UserRound className="size-4 text-muted-foreground" />
                {f.nombre}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
