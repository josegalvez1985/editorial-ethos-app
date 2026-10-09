/**
 * El contrato entre la pestaña Autoridades (`<AutoridadesInstitucion>`) y las
 * dos tablas que muestra: `INSTITUCIONES_DIRECTORES` e
 * `INSTITUCIONES_COORDNADORES`. Las dos tienen la misma forma y sus backends
 * devuelven las filas con las mismas claves; cada lib
 * (`instituciones-directores.ts`, `instituciones-coordinadores.ts`) arma su
 * {@link ApiAutoridades} con esto. Separado del componente para que el archivo
 * del componente exporte solo componentes (fast refresh).
 */

import type { ValorLista } from "@/lib/utils";

/** Una persona de DIRECTORES o COORDINADORES. */
export type Persona = {
  id: number;
  nombre: string;
  ci: string;
  telefono: string;
  /** En cuántas instituciones figura: ayuda a distinguir homónimos. */
  instituciones: number;
};

export type DatosPersona = { nombre_apellido: string; nro_telefono: string; nro_ci: string };

/** Una fila de INSTITUCIONES_DIRECTORES o INSTITUCIONES_COORDNADORES. */
export type Autoridad = {
  id: number;
  idInstitucion: number;
  /** `null`: filas viejas de coordinadores sin persona (la tabla lo permite). */
  idPersona: number | null;
  persona: string;
  personaCi: string;
  /** El de la ficha de la persona: se muestra si la fila no tiene el suyo. */
  personaTelefono: string;
  periodo: string;
  /** El CARGO del director o el TIPO del coordinador. */
  rol: string;
  nivel: string;
  /** Texto libre de una lista de APEX: NO es el 1/2/3 de POSTULACIONES.TURNO. */
  turno: string;
  estado: string;
  activo: boolean;
  /** El de la persona EN ESTA institución. */
  telefono: string;
};

export type DatosAutoridad = {
  idInstitucion: number;
  idPersona: number;
  periodo: string;
  rol: string;
  nivel: string;
  turno: string;
  estado: string;
  telefono: string;
};

export type OpcionesAutoridad = {
  rol: ValorLista[];
  nivel: ValorLista[];
  turno: ValorLista[];
  estado: ValorLista[];
};

/** Lo que cada tabla le pasa a la pestaña. */
export type ApiAutoridades = {
  textos: {
    /** "Directores" */
    titulo: string;
    /** "director" */
    singular: string;
    /** "Cargo" o "Tipo" */
    rol: string;
    femenino?: boolean;
  };
  /** La página de la propia tabla (36 o 47): sus permisos también valen. */
  ruta: string;
  /** La página de las personas (34 o 45): su "insertar" deja crear personas. */
  rutaPersonas: string;
  key: (idInstitucion: number) => readonly unknown[];
  listar: (idInstitucion: number) => Promise<Autoridad[]>;
  keyOpciones: readonly unknown[];
  opciones: () => Promise<OpcionesAutoridad>;
  guardar: (id: number | null, d: DatosAutoridad) => Promise<number>;
  quitar: (id: number) => Promise<void>;
  personas: {
    key: readonly unknown[];
    listar: () => Promise<Persona[]>;
    crear: (d: DatosPersona) => Promise<number>;
  };
};

const s = (v: unknown) => (v == null ? "" : String(v));

/** Una fila de `GET instituciones-directores` o `instituciones-coordinadores`: misma forma. */
export function aAutoridad(x: Record<string, unknown>): Autoridad {
  return {
    id: Number(x.id),
    idInstitucion: Number(x.id_institucion),
    idPersona: x.id_persona == null || x.id_persona === "" ? null : Number(x.id_persona),
    persona: s(x.persona),
    personaCi: s(x.persona_ci),
    personaTelefono: s(x.persona_telefono),
    periodo: s(x.periodo),
    rol: s(x.rol),
    nivel: s(x.nivel),
    turno: s(x.turno),
    estado: s(x.estado),
    activo: x.es_activo === "S",
    telefono: s(x.nro_telefono),
  };
}

/** `GET …/opciones` de las dos tablas: misma forma. */
export function aOpcionesAutoridad(r: Record<string, unknown>): OpcionesAutoridad {
  const lista = (k: string): ValorLista[] =>
    ((r[k] as Record<string, unknown>[] | undefined) ?? []).map((o) => ({
      valor: s(o.valor),
      mostrar: s(o.mostrar) || s(o.valor),
    }));
  return {
    rol: lista("rol"),
    nivel: lista("nivel"),
    turno: lista("turno"),
    estado: lista("estado"),
  };
}
