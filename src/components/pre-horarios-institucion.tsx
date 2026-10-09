import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { GrillaEditable, type ColumnaGrilla, type FilaGrilla } from "@/components/grilla-editable";
import { keysFacilitadores, listarFacilitadores } from "@/lib/facilitadores";
import { minutos } from "@/lib/horario-instituciones";
import { keysInstituciones } from "@/lib/instituciones";
import { usePermisos } from "@/lib/permisos";
import {
  DIAS,
  franjas,
  GRADOS,
  keysPostulaciones,
  listarPostulaciones,
  MANUALES,
  manualDe,
} from "@/lib/postulaciones";
import {
  eliminarPreHorario,
  guardarPreHorario,
  keysPreHorarios,
  listarPreHorarios,
  opcionesPreHorario,
  type DatosPreHorario,
  type PreHorario,
} from "@/lib/pre-horarios";

/**
 * La pestaña Pre-horarios de la ficha de una institución: el modal 43 de APEX
 * (Pre Horarios, el botón "Pre Postulación" del 21), con los permisos de la 16.
 *
 * Se ve y funciona como el Interactive Grid de la 43 (pedido el 09/10/2026):
 * las mismas columnas y listas, editables en la grilla, con Agregar fila y
 * Guardar (ver `<GrillaEditable>`). Elegir un docente pisa el teléfono con el
 * suyo, como la acción dinámica de APEX. Confirmado = SI crea la postulación
 * (lo hace el trigger: ver `lib/pre-horarios.ts`).
 *
 * Lo que agrega el sitio:
 *
 * - **Validación antes de guardar**: turno, grado, manual, día y horas, que
 *   el trigger necesita (en APEX fallaba al confirmar sin ellos).
 * - **Bloqueados a la vista**: si la postulación de un pre-horario ya tiene
 *   intervenciones o evaluaciones, la fila queda con candado (en APEX fallaba
 *   el trigger).
 * - **"Horarios de otro año"** reemplaza el copiar (doble clic en la 60) y
 *   pegar (doble clic en la 43), que no anda en el celular: agrega una fila
 *   con una clase de las postulaciones del año anterior.
 */
export function PreHorariosInstitucion({
  idInstitucion,
  idFacilitadorInstitucion,
}: {
  idInstitucion: number;
  /** El facilitador de la institución: se propone en cada fila nueva. */
  idFacilitadorInstitucion: number | null;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const puede = puedeRuta("/instituciones", "actualizar");

  const lista = useQuery({
    queryKey: keysPreHorarios.institucion(idInstitucion),
    queryFn: () => listarPreHorarios(idInstitucion),
  });
  const opciones = useQuery({
    queryKey: keysPreHorarios.opciones,
    queryFn: opcionesPreHorario,
    staleTime: 10 * 60 * 1000,
  });
  const facilitadores = useQuery({
    queryKey: keysFacilitadores.lista,
    queryFn: listarFacilitadores,
  });

  if (lista.isLoading || opciones.isLoading || facilitadores.isLoading) return <Cargando />;
  if (lista.isError || opciones.isError || facilitadores.isError)
    return (
      <Fallo
        error={lista.error ?? opciones.error ?? facilitadores.error}
        texto="No se pudieron cargar los pre-horarios"
      />
    );

  const op = opciones.data!;
  const { anio, anioActual, items } = lista.data!;
  const editable = puede && anio === anioActual;
  const turnoUnico = op.turno.length === 1 ? op.turno[0].valor : "";

  // Las columnas y listas de la 43, en su orden.
  const columnas: ColumnaGrilla[] = [
    { clave: "turno", titulo: "Turno", tipo: "lista", opciones: op.turno, ancho: 100 },
    {
      clave: "grado",
      titulo: "Grado",
      tipo: "lista",
      // Como la lista de APEX: "2°" … "9°", "1M" … "3M".
      opciones: GRADOS.map((g) => ({
        valor: g.valor,
        mostrar: g.valor.endsWith("M") ? g.valor : `${g.valor}°`,
      })),
      ancho: 72,
    },
    { clave: "seccion", titulo: "Seccion", ancho: 76, mayusculas: true, max: 5 },
    {
      clave: "idEnfasis",
      titulo: "Énfasis",
      tipo: "lista",
      opciones: op.enfasis.map((e) => ({ valor: String(e.id), mostrar: e.nombre })),
      ancho: 150,
    },
    { clave: "cantidad", titulo: "Cant.", tipo: "numero", alinear: "der", ancho: 64, max: 4 },
    {
      clave: "manual",
      titulo: "Manual",
      tipo: "lista",
      opciones: MANUALES.map((m) => ({
        valor: m.valor,
        mostrar: m.valor === "CARACTER" ? "Caracter" : m.nombre,
      })),
      ancho: 104,
    },
    {
      clave: "dia",
      titulo: "Dia",
      tipo: "lista",
      opciones: DIAS.map((d, i) => ({ valor: d.valor, mostrar: DIA_APEX[i] })),
      ancho: 84,
    },
    { clave: "desde", titulo: "Hora Desde", tipo: "hora" },
    { clave: "hasta", titulo: "Hora Hasta", tipo: "hora" },
    {
      clave: "idMateria",
      titulo: "Materia",
      tipo: "lista",
      opciones: op.materias.map((m) => ({ valor: String(m.id), mostrar: m.nombre })),
      ancho: 170,
    },
    {
      clave: "idDocente",
      titulo: "Docente",
      tipo: "lista",
      // Como el LOV de APEX: "nombre (teléfono)", todos.
      opciones: op.docentes.map((d) => ({
        valor: String(d.id),
        mostrar: `${d.nombre} (${d.telefono})`,
      })),
      ancho: 230,
    },
    { clave: "telefono", titulo: "Telefono", ancho: 120, max: 200 },
    {
      clave: "idFacilitador",
      titulo: "Facilitador",
      tipo: "lista",
      opciones: facilitadores.data!.map((f) => ({
        valor: String(f.id),
        mostrar: f.nombre,
        inactiva: !f.activo,
      })),
      ancho: 190,
    },
    { clave: "observacion", titulo: "Observacion", ancho: 220, max: 2000 },
    {
      clave: "confirmado",
      titulo: "Confirmado",
      tipo: "lista",
      opciones: op.estado.length
        ? op.estado
        : [
            { valor: "SI", mostrar: "SI" },
            { valor: "NO", mostrar: "NO" },
          ],
      ancho: 96,
    },
  ];

  const orden = (p: PreHorario) =>
    `${p.turno ?? 9}-${DIAS.findIndex((d) => d.valor === p.dia) + 1 || 9}-${p.desde}`;
  const filas: FilaGrilla[] = [...items]
    .sort((a, b) => orden(a).localeCompare(orden(b)))
    .map((p) => ({
      id: p.id,
      datos: aFila(p),
      bloqueada: p.usos
        ? `Su postulación tiene ${p.usos} intervención(es) o evaluación(es): no se puede modificar ni eliminar.`
        : undefined,
    }));

  const telefonoDe = (id: string) => op.docentes.find((d) => String(d.id) === id)?.telefono ?? "";

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-bold">Pre-horarios {anio}</h2>
        <p className="text-[12px] text-muted-foreground">
          Confirmado = SI crea su postulación, que es lo que sale en el formulario.
        </p>
      </div>

      {anio !== anioActual && (
        <SoloLectura texto={`Son de ${anio}: solo se modifican los del año lectivo actual.`} />
      )}
      {!puede && <SoloLectura texto="Solo lectura: tu usuario no puede modificar pre-horarios." />}

      <GrillaEditable
        columnas={columnas}
        filas={filas}
        editable={editable}
        vacio={`Todavía no hay pre-horarios para ${anio}.`}
        nueva={() => ({
          turno: turnoUnico,
          idFacilitador: idFacilitadorInstitucion == null ? "" : String(idFacilitadorInstitucion),
          confirmado: "NO",
        })}
        // La acción dinámica de la 43: al cambiar el docente, su teléfono.
        alCambiar={(clave, valor, d) =>
          clave === "idDocente" ? { ...d, telefono: telefonoDe(valor) } : d
        }
        validar={validar}
        guardarFila={(id, d) => guardarPreHorario(id, idInstitucion, deFila(d))}
        eliminarFila={eliminarPreHorario}
        onGuardado={() =>
          Promise.all([
            qc.invalidateQueries({ queryKey: keysPreHorarios.institucion(idInstitucion) }),
            qc.invalidateQueries({ queryKey: keysPostulaciones.todo }),
            qc.invalidateQueries({ queryKey: keysInstituciones.todo }),
          ])
        }
        extra={(agregar) =>
          editable ? (
            <DesdeOtroAnio
              idInstitucion={idInstitucion}
              anioActual={anioActual}
              onElegir={(d) => {
                agregar({ ...d, telefono: d.telefono || telefonoDe(d.idDocente ?? "") });
                toast.info("Se agregó la fila arriba: revisala y tocá Guardar.");
              }}
            />
          ) : null
        }
      />
    </div>
  );
}

/** La lista estática del día en la 43. */
const DIA_APEX = ["1-Lun", "2-Mar", "3-Mier", "4-Jue", "5-Vier"];

const txt = (v: number | null) => (v == null ? "" : String(v));
const num = (v: string | undefined) => (v ? Number(v) : null);

function aFila(p: PreHorario): Record<string, string> {
  return {
    turno: txt(p.turno),
    grado: p.grado,
    seccion: p.seccion,
    idEnfasis: txt(p.idEnfasis),
    cantidad: txt(p.cantidad),
    manual: p.manual,
    dia: p.dia,
    desde: p.desde,
    hasta: p.hasta,
    idMateria: txt(p.idMateria),
    idDocente: txt(p.idDocente),
    telefono: p.telefono,
    idFacilitador: txt(p.idFacilitador),
    observacion: p.observacion,
    confirmado: p.confirmado ? "SI" : "NO",
  };
}

function deFila(d: Record<string, string>): DatosPreHorario {
  return {
    turno: num(d.turno),
    grado: d.grado ?? "",
    seccion: d.seccion ?? "",
    idEnfasis: num(d.idEnfasis),
    cantidad: d.cantidad ?? "",
    manual: d.manual ?? "",
    dia: d.dia ?? "",
    desde: d.desde ?? "",
    hasta: d.hasta ?? "",
    idMateria: num(d.idMateria),
    idDocente: num(d.idDocente),
    telefono: d.telefono ?? "",
    idFacilitador: num(d.idFacilitador),
    observacion: d.observacion ?? "",
    confirmado: d.confirmado === "SI",
  };
}

/** Lo que el trigger necesita para generar la postulación. */
function validar(d: Record<string, string>): string | null {
  const faltan = [
    ...(d.turno ? [] : ["turno"]),
    ...(d.grado ? [] : ["grado"]),
    ...(d.manual ? [] : ["manual"]),
    ...(d.dia ? [] : ["día"]),
    ...(d.desde ? [] : ["hora desde"]),
    ...(d.hasta ? [] : ["hora hasta"]),
  ];
  if (faltan.length) return `Falta completar: ${faltan.join(", ")}.`;
  const a = minutos(d.desde);
  const b = minutos(d.hasta);
  if (a == null || b == null || b <= a)
    return "La hora hasta tiene que ser posterior a la hora desde.";
  return null;
}

/** El manual como pastilla de su color: "SER". */
function ChipManual({ valor, cantidad }: { valor: string; cantidad?: number | null }) {
  const m = manualDe(valor);
  if (!m) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: m.color, color: m.tinta }}
    >
      {m.corto}
      {cantidad ? <span className="font-semibold opacity-90">{cantidad}</span> : null}
    </span>
  );
}

/**
 * "Horarios de otro año": las clases de las postulaciones del año anterior de
 * la institución, una por día con horario. Elegir una agrega la fila. Es el
 * reemplazo del copiar (doble clic en la 60) y pegar (doble clic en la 43) de
 * APEX, que solo copiaba las horas.
 */
function DesdeOtroAnio({
  idInstitucion,
  anioActual,
  onElegir,
}: {
  idInstitucion: number;
  anioActual: string;
  onElegir: (d: Record<string, string>) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  // Los años que tiene la institución salen de la lista del año actual.
  const actual = useQuery({
    queryKey: keysPostulaciones.institucion(idInstitucion, anioActual),
    queryFn: () => listarPostulaciones(idInstitucion, anioActual),
    enabled: abierto,
  });
  const anterior = actual.data?.anios.find((a) => a < anioActual) ?? null;
  const previas = useQuery({
    queryKey: keysPostulaciones.institucion(idInstitucion, anterior ?? ""),
    queryFn: () => listarPostulaciones(idInstitucion, anterior!),
    enabled: abierto && anterior != null,
  });

  const clases = (previas.data?.items ?? []).flatMap((p) =>
    franjas(p).map((f) => {
      const grado = GRADOS.find((g) => p.grados[g.clave] > 0);
      const manual = MANUALES.find((m) => p.manuales[m.clave] > 0);
      return { p, f, grado, manual };
    }),
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-primary"
      >
        <History className="size-4" />
        <span className="flex-1">Horarios de otro año</span>
        <ChevronDown className={`size-4 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>
      {abierto && (
        <div className="max-h-72 overflow-y-auto border-t border-border/60 p-2">
          {actual.isLoading || previas.isLoading ? (
            <Cargando />
          ) : actual.isError || previas.isError ? (
            <Fallo error={actual.error ?? previas.error} texto="No se pudo cargar" />
          ) : anterior == null || !clases.length ? (
            <p className="px-2 py-4 text-center text-[12.5px] text-muted-foreground">
              No hay postulaciones de años anteriores para esta institución.
            </p>
          ) : (
            <ul className="space-y-1.5">
              <li className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Postulaciones {anterior} · tocá una para agregarla
              </li>
              {clases.map(({ p, f, grado, manual }) => (
                <li key={`${p.id}-${f.dia.clave}`}>
                  <button
                    type="button"
                    onClick={() =>
                      onElegir({
                        turno: txt(p.turno),
                        dia: f.dia.valor,
                        desde: f.desde,
                        hasta: f.hasta,
                        grado: grado?.valor ?? "",
                        seccion: p.seccion,
                        manual: manual?.valor ?? "",
                        cantidad: grado ? String(p.grados[grado.clave]) : "",
                        idMateria: txt(p.idMateria),
                        idEnfasis: txt(p.idEnfasis),
                        idDocente: txt(p.idDocente),
                        telefono: p.telefono,
                      })
                    }
                    className="tap flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border/60 px-3 py-2 text-left text-[12.5px] hover:border-primary/40"
                  >
                    <span className="font-semibold tabular-nums">
                      {f.dia.corto} {f.desde}–{f.hasta}
                    </span>
                    <span>
                      {grado?.corto ?? ""}
                      {p.seccion ? ` ${p.seccion}` : ""}
                    </span>
                    {manual && <ChipManual valor={manual.valor} />}
                    <span className="text-muted-foreground">
                      {[p.materia, p.docente].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
