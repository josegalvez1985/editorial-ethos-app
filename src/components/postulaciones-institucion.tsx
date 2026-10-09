import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, ImageDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { GrillaEditable, type ColumnaGrilla, type FilaGrilla } from "@/components/grilla-editable";
import { keysFacilitadores, listarFacilitadores } from "@/lib/facilitadores";
import {
  generarFormularioImagen,
  generarFormularioPdf,
  nombreArchivo,
} from "@/lib/formulario-postulacion";
import { minutos } from "@/lib/horario-instituciones";
import { keysInstituciones } from "@/lib/instituciones";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import { usePermisos } from "@/lib/permisos";
import {
  DIAS,
  eliminarPostulacion,
  GRADOS,
  guardarPostulacion,
  keysPostulaciones,
  listarPostulaciones,
  MANUALES,
  obtenerFormulario,
  opcionesPostulacion,
  type Postulacion,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";

/**
 * La pestaña Postulaciones de la ficha de una institución: el modal 38 de APEX
 * (Datos, el botón "Postulaciones" del 21) y los botones PDF e IMAGEN de la
 * página 60 (Consulta de Postulaciones), para esta institución.
 *
 * Se ve y funciona como el Interactive Grid de la 38 (pedido el 09/10/2026):
 * las mismas columnas, con los manuales en sus colores, editables en la
 * grilla, con Agregar fila y Guardar (ver `<GrillaEditable>`). Lo del sitio:
 *
 * - **Por año**, en pastillas; arranca en el lectivo actual. Solo se editan
 *   las del año actual.
 * - **PDF e Imagen** del "Formulario N° 1" (`lib/formulario-postulacion.ts`).
 * - Las que tienen intervenciones o evaluaciones no se pueden eliminar.
 *
 * Igual que en APEX, si una salió de un pre-horario y después se modifica
 * ese pre-horario, el trigger la vuelve a generar y lo cambiado acá se pierde
 * (ver `postulaciones.sql`).
 */
export function PostulacionesInstitucion({
  idInstitucion,
  nombreInstitucion,
  onIrPreHorarios,
}: {
  idInstitucion: number;
  nombreInstitucion: string;
  onIrPreHorarios: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  // La 38 colgaba del 21 (página 16); la 20 es la de esta tabla.
  const puede =
    puedeRuta("/instituciones", "actualizar") || puedeRuta("/postulaciones", "actualizar");
  const [anio, setAnio] = useState<string | null>(null);
  const [generando, setGenerando] = useState<"pdf" | "png" | null>(null);

  // Sin año: el backend usa el lectivo actual y dice cuál es.
  const lista = useQuery({
    queryKey: keysPostulaciones.institucion(idInstitucion, anio ?? ""),
    queryFn: () => listarPostulaciones(idInstitucion, anio ?? undefined),
  });
  // Turno, materias y docentes: las mismas listas que Pre-horarios.
  const opciones = useQuery({
    queryKey: keysPreHorarios.opciones,
    queryFn: opcionesPreHorario,
    staleTime: 10 * 60 * 1000,
  });
  const estados = useQuery({
    queryKey: keysPostulaciones.opciones,
    queryFn: opcionesPostulacion,
    staleTime: 10 * 60 * 1000,
  });
  const facilitadores = useQuery({
    queryKey: keysFacilitadores.lista,
    queryFn: listarFacilitadores,
  });
  const consultas = [lista, opciones, estados, facilitadores];

  if (consultas.some((c) => c.isLoading)) return <Cargando />;
  const fallo = consultas.find((c) => c.isError);
  if (fallo) return <Fallo error={fallo.error} texto="No se pudieron cargar" />;

  const op = opciones.data!;
  const { items, anioActual, anios } = lista.data!;
  const elegido = lista.data!.anio;
  const todosAnios = [...new Set([anioActual, ...anios].filter(Boolean))].sort().reverse();
  const editable = puede && elegido === anioActual;

  // Las columnas de la 38, en su orden.
  const columnas: ColumnaGrilla[] = [
    { clave: "turno", titulo: "Turno", tipo: "lista", opciones: op.turno, ancho: 64 },
    { clave: "seccion", titulo: "Sección", ancho: 46, mayusculas: true, max: 5 },
    ...GRADOS.map((g): ColumnaGrilla => ({
      clave: g.clave,
      titulo: g.corto,
      tipo: "numero",
      alinear: "der",
      ancho: 32,
      max: 5,
    })),
    ...MANUALES.map((m): ColumnaGrilla => ({
      clave: m.clave,
      // Abreviado (SER, HAC…) para que la columna sea angosta; el nombre
      // completo sale al pasar el mouse por el encabezado.
      titulo: m.corto,
      tipo: "numero",
      alinear: "centro",
      ancho: 38,
      max: 5,
      fondo: m.color,
      tinta: m.tinta,
    })),
    ...DIAS.flatMap((d, i): ColumnaGrilla[] => [
      // Un título por día arriba ("Lunes") y Desde / Hasta debajo: solo el
      // encabezado; siguen siendo dos datos, como en el backend (09/10/2026).
      {
        clave: `${d.clave}_desde`,
        titulo: `${DIA_APEX[i]} Des`,
        tipo: "hora",
        grupo: d.nombre,
        subtitulo: "Desde",
      },
      {
        clave: `${d.clave}_hasta`,
        titulo: `${DIA_APEX[i]} Has`,
        tipo: "hora",
        grupo: d.nombre,
        subtitulo: "Hasta",
      },
    ]),
    { clave: "observacion", titulo: "Obs.", ancho: 110, max: 1000 },
    {
      clave: "id_materia",
      titulo: "Materia",
      tipo: "lista",
      opciones: op.materias.map((m) => ({ valor: String(m.id), mostrar: m.nombre })),
      ancho: 110,
    },
    {
      clave: "id_docente",
      titulo: "Docente",
      tipo: "lista",
      // Como el LOV de APEX: "nombre (teléfono)", todos.
      opciones: op.docentes.map((d) => ({
        valor: String(d.id),
        mostrar: `${d.nombre} (${d.telefono})`,
      })),
      ancho: 150,
    },
    {
      clave: "id_facilitador",
      titulo: "Facilitador",
      tipo: "lista",
      opciones: facilitadores.data!.map((f) => ({
        valor: String(f.id),
        mostrar: f.nombre,
        inactiva: !f.activo,
      })),
      ancho: 130,
    },
    {
      clave: "estado",
      titulo: "Estado",
      tipo: "lista",
      opciones: estados.data!.estado,
      ancho: 70,
    },
    { clave: "obs_estado", titulo: "Obs. Estado", ancho: 110, max: 2000 },
  ];

  const filas: FilaGrilla[] = items.map((p) => ({
    id: p.id,
    datos: aFila(p),
    sinBorrar: p.usos
      ? `Tiene ${p.usos} intervención(es) o evaluación(es): no se puede eliminar.`
      : undefined,
  }));

  /** Sin `await` antes: la pestaña se abre dentro del clic (ver pdf-base.ts). */
  const imprimir = (tipo: "pdf" | "png") => {
    setGenerando(tipo);
    const archivo = nombreArchivo({ nombre: nombreInstitucion, anio: elegido });
    abrirPdfEnPestana(
      () =>
        obtenerFormulario(idInstitucion, elegido).then((f) =>
          tipo === "pdf" ? generarFormularioPdf(f) : generarFormularioImagen(f),
        ),
      `${archivo}.${tipo}`,
      tipo === "pdf" ? "el PDF" : "la imagen",
    )
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar"))
      .finally(() => setGenerando(null));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {todosAnios.length > 1 ? (
          <div role="tablist" aria-label="Año" className="flex flex-wrap gap-2">
            {todosAnios.map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={elegido === a}
                onClick={() => setAnio(a)}
                className={`tap h-9 rounded-full border px-3.5 text-[13px] font-semibold ${
                  elegido === a
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {a}
                {a === anioActual && <span className="ml-1 opacity-70">· actual</span>}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="font-display text-lg font-bold">Postulaciones {elegido}</h2>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={generando != null}
            onClick={() => imprimir("pdf")}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
          >
            {generando === "pdf" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            PDF
          </button>
          <button
            type="button"
            disabled={generando != null}
            onClick={() => imprimir("png")}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-primary-soft px-3.5 text-sm font-semibold text-primary disabled:opacity-60"
          >
            {generando === "png" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImageDown className="size-4" />
            )}
            Imagen
          </button>
        </div>
      </div>

      {elegido !== anioActual && (
        <SoloLectura texto={`Son de ${elegido}: solo se modifican las del año lectivo actual.`} />
      )}
      {!puede && <SoloLectura texto="Solo lectura: tu usuario no puede modificar postulaciones." />}
      {!items.length && elegido === anioActual && (
        <p className="text-[12px] text-muted-foreground">
          Se crean al confirmar los pre-horarios.{" "}
          <button
            type="button"
            onClick={onIrPreHorarios}
            className="font-semibold text-primary underline"
          >
            Ir a Pre-horarios
          </button>
        </p>
      )}

      <GrillaEditable
        key={elegido}
        columnas={columnas}
        filas={filas}
        editable={editable}
        vacio={`No hay postulaciones de ${elegido}.`}
        nueva={() => ({})}
        validar={validar}
        guardarFila={(id, d) => guardarPostulacion(id, idInstitucion, d)}
        eliminarFila={eliminarPostulacion}
        onGuardado={() =>
          Promise.all([
            qc.invalidateQueries({ queryKey: keysPostulaciones.todo }),
            qc.invalidateQueries({ queryKey: keysInstituciones.lista }),
          ])
        }
      />
    </div>
  );
}

/** Como los encabezados de la 38: "Lun Des", "Miér Has", "Vier Des". */
const DIA_APEX = ["Lun", "Mar", "Miér", "Jue", "Vier"];

const txt = (v: number | null) => (v == null ? "" : String(v));
/** En la grilla las cantidades vacías se ven vacías, no 0 (como en APEX). */
const cant = (v: number) => (v ? String(v) : "");

/** La fila con las claves del backend (`postulaciones.sql`). */
function aFila(p: Postulacion): Record<string, string> {
  return {
    turno: txt(p.turno),
    seccion: p.seccion,
    ...Object.fromEntries(GRADOS.map((g) => [g.clave, cant(p.grados[g.clave])])),
    ...Object.fromEntries(MANUALES.map((m) => [m.clave, cant(p.manuales[m.clave])])),
    ...Object.fromEntries(
      DIAS.flatMap((d) => [
        [`${d.clave}_desde`, p.dias[d.clave].desde],
        [`${d.clave}_hasta`, p.dias[d.clave].hasta],
      ]),
    ),
    observacion: p.observacion,
    id_materia: txt(p.idMateria),
    id_docente: txt(p.idDocente),
    id_facilitador: txt(p.idFacilitador),
    // Oculta en la 38: viaja tal cual.
    id_enfasis: txt(p.idEnfasis),
    estado: p.estado,
    obs_estado: p.obsEstado,
  };
}

function validar(d: Record<string, string>): string | null {
  for (const x of DIAS) {
    const a = minutos(d[`${x.clave}_desde`] ?? "");
    const b = minutos(d[`${x.clave}_hasta`] ?? "");
    if (a != null && b != null && b <= a)
      return `${x.nombre}: la hora hasta tiene que ser posterior a la desde.`;
  }
  return null;
}
