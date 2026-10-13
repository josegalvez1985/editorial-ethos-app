/**
 * Envíos de gráficas: CABECERA (`ENVIOS_CABECERA`: la gráfica y la fecha) y
 * DETALLE (`ENVIOS_GRAFICAS`: cada destino). Contrato del backend:
 * `backend/envios_graficas.sql`.
 *
 * Pantalla nueva del sitio (13/10/2026), no viene de APEX. Ese mismo día Jose
 * pasó la tabla única a cabecera y detalle: un envío es lo que una gráfica (la
 * imprenta) mandó en una fecha, y cada línea dice a qué departamento, ciudad y
 * sucursal fue, con cuántos manuales de cada uno. Las columnas de los manuales
 * se llaman como las `clave` de `MANUALES` (lib/postulaciones), así que se
 * recorren con esa lista.
 *
 * - `SUCURSAL` es el NOMBRE de la sucursal, no su id: así es la tabla.
 * - `CANTIDAD` de cada línea es la suma de los siete y la calcula el backend.
 * - "Cargado el … por …" sale de la bitácora de la cabecera, ya en hora de
 *   Paraguay. Guardar toca siempre la cabecera, así que "modificado" cuenta
 *   también los cambios de líneas.
 *
 * El GET trae los envíos con sus líneas y los catálogos del formulario
 * (departamentos, ciudades y sucursales), livianos. No hay GET de un envío:
 * la pantalla de un envío lo busca en esa misma lista (misma caché).
 *
 * Las cantidades se SUGIEREN a partir de las postulaciones de la ciudad: ver
 * {@link sumarSugerencia}, al final.
 */

import { authFetch } from "@/lib/api";
import {
  MANUALES,
  type ClaveManual,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";

/** Un destino del envío (una fila de `ENVIOS_GRAFICAS`). */
export type LineaEnvio = {
  id: number;
  idDepartamento: number;
  departamento: string;
  idCiudad: number;
  ciudad: string;
  sucursal: string;
  manuales: Record<ClaveManual, number>;
  cantidad: number;
  /** Observación del destino (`COMENTARIO`, hasta 2000). Vacío si no tiene. */
  comentario: string;
};

/** Un envío: la cabecera con sus líneas y los totales ya sumados. */
export type EnvioGrafica = {
  id: number;
  grafica: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  lineas: LineaEnvio[];
  /** La suma de las líneas. */
  manuales: Record<ClaveManual, number>;
  cantidad: number;
  /** `YYYY-MM-DDTHH:MI` en hora de Paraguay, o `""` si la bitácora no lo tiene. */
  cargadoEl: string;
  cargadoPor: string;
  modificadoEl: string;
  modificadoPor: string;
};

export type ItemCatalogo = { id: number; nombre: string };
export type CiudadCatalogo = ItemCatalogo & { idDepartamento: number };

export type ListaEnvios = {
  envios: EnvioGrafica[];
  departamentos: ItemCatalogo[];
  ciudades: CiudadCatalogo[];
  sucursales: ItemCatalogo[];
  /** Tope de la gráfica y de la sucursal (100). */
  largo: number;
  /** Tope del comentario de cada destino (2000). */
  largoComentario: number;
};

/** Lo que se guarda: la cabecera y TODAS las líneas (las que faltan se borran). */
export type DatosEnvio = {
  nombre_grafica: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  lineas: ({
    /** Solo en las que ya existían. */
    id_envio?: number;
    id_departamento: number;
    id_ciudad: number;
    sucursal: string;
    comentario: string;
  } & Record<ClaveManual, number>)[];
};

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Los siete manuales en cero, para un envío nuevo. */
export const manualesEnCero = () =>
  Object.fromEntries(MANUALES.map((m) => [m.clave, 0])) as Record<ClaveManual, number>;

/** La suma por manual de varias líneas. */
export function sumarLineas(lineas: { manuales: Record<ClaveManual, number> }[]) {
  const t = manualesEnCero();
  for (const l of lineas) for (const m of MANUALES) t[m.clave] += l.manuales[m.clave];
  return t;
}

export async function listarEnvios(): Promise<ListaEnvios> {
  const r = (await authFetch("envios-graficas")) as {
    data?: Record<string, unknown>[];
    departamentos?: Record<string, unknown>[];
    ciudades?: Record<string, unknown>[];
    sucursales?: Record<string, unknown>[];
    largo?: number;
    largo_comentario?: number;
  };
  const item = (x: Record<string, unknown>) => ({ id: n(x.id), nombre: s(x.nombre) });
  return {
    envios: (r.data ?? []).map((x) => {
      const lineas: LineaEnvio[] = ((x.lineas as Record<string, unknown>[] | undefined) ?? []).map(
        (l) => ({
          id: n(l.id_envio),
          idDepartamento: n(l.id_departamento),
          departamento: s(l.departamento),
          idCiudad: n(l.id_ciudad),
          ciudad: s(l.ciudad),
          sucursal: s(l.sucursal),
          manuales: Object.fromEntries(MANUALES.map((m) => [m.clave, n(l[m.clave])])) as Record<
            ClaveManual,
            number
          >,
          cantidad: n(l.cantidad),
          comentario: s(l.comentario),
        }),
      );
      return {
        id: n(x.id_cabecera),
        grafica: s(x.nombre_grafica),
        fecha: s(x.fecha),
        lineas,
        manuales: sumarLineas(lineas),
        cantidad: lineas.reduce((a, l) => a + l.cantidad, 0),
        cargadoEl: s(x.cargado_el),
        cargadoPor: s(x.cargado_por),
        modificadoEl: s(x.modificado_el),
        modificadoPor: s(x.modificado_por),
      };
    }),
    departamentos: (r.departamentos ?? []).map(item),
    ciudades: (r.ciudades ?? []).map((x) => ({ ...item(x), idDepartamento: n(x.id_departamento) })),
    sucursales: (r.sucursales ?? []).map(item),
    largo: Number(r.largo ?? 100),
    largoComentario: Number(r.largo_comentario ?? 2000),
  };
}

/**
 * Alta (`id` null) o modificación, cabecera y líneas juntas. Devuelve el id
 * de la cabecera. Las líneas viajan como TEXTO con un JSON (`detalle`): ORDS
 * bindea solo los campos escalares del body.
 */
export async function guardarEnvio(id: number | null, d: DatosEnvio): Promise<number> {
  const r = (await authFetch(id == null ? "envios-graficas" : `envios-graficas/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre_grafica: d.nombre_grafica,
      fecha: d.fecha,
      detalle: JSON.stringify({ lineas: d.lineas }),
    }),
  })) as { id_cabecera?: number };
  return Number(r.id_cabecera ?? id ?? 0);
}

/** El envío con todas sus líneas. */
export async function eliminarEnvio(id: number): Promise<void> {
  await authFetch(`envios-graficas/${id}`, { method: "DELETE" });
}

export const keysEnvios = {
  todo: ["envios-graficas"] as const,
};

/* -------------------------------------------------------------------------- */
/* Los paquetes (13/10/2026)                                                  */
/* -------------------------------------------------------------------------- */

/*
 * El esquema de trabajo de las gráficas: los manuales van en paquetes de 100,
 * 50 y 25 unidades. Cada cantidad (de UN manual para UN destino, que es lo que
 * se arma junto) se divide de mayor a menor, y lo que no completa un paquete
 * de 25 va **suelto** (Jose, 13/10/2026). 380 → 3 de 100, 1 de 50, 1 de 25 y
 * 5 sueltos. No se guarda: se calcula de la cantidad.
 *
 * Los totales (de un destino, de un manual, de un informe) son la SUMA de las
 * divisiones de cada cantidad, no la división del total: 2 destinos de 60
 * son 2 de 50 y 20 sueltos, no 1 de 100 y 1 de 25 con 5 sueltos.
 */

/** Los tamaños de paquete, de mayor a menor. */
export const PAQUETES = [100, 50, 25] as const;
export type Paquete = (typeof PAQUETES)[number];

export type Division = { paquetes: Record<Paquete, number>; sueltos: number };

export const sinPaquetes = (): Division => ({ paquetes: { 100: 0, 50: 0, 25: 0 }, sueltos: 0 });

/** Divide una cantidad en paquetes de 100, 50 y 25 y lo que queda suelto. */
export function dividir(cantidad: number): Division {
  const d = sinPaquetes();
  let resto = Math.max(0, Math.trunc(cantidad) || 0);
  for (const p of PAQUETES) {
    d.paquetes[p] = Math.floor(resto / p);
    resto %= p;
  }
  d.sueltos = resto;
  return d;
}

/** Suma divisiones: la de cada cantidad por separado (ver arriba). */
export function sumarDivisiones(divisiones: Division[]): Division {
  const t = sinPaquetes();
  for (const d of divisiones) {
    for (const p of PAQUETES) t.paquetes[p] += d.paquetes[p];
    t.sueltos += d.sueltos;
  }
  return t;
}

/** La división de cada manual de una línea, sumada: los paquetes de un destino. */
export const paquetesDe = (l: { manuales: Record<ClaveManual, number> }) =>
  sumarDivisiones(MANUALES.map((m) => dividir(l.manuales[m.clave])));

/** "3×100 · 1×50 · 1×25 + 5 sueltos", sin lo que es 0. Vacío si no hay nada. */
export function textoDivision(d: Division, corto = false): string {
  const partes = PAQUETES.filter((p) => d.paquetes[p] > 0).map((p) => `${d.paquetes[p]}×${p}`);
  const sueltos = d.sueltos
    ? corto
      ? `+${d.sueltos}`
      : `${d.sueltos} suelto${d.sueltos === 1 ? "" : "s"}`
    : "";
  if (!partes.length) return sueltos;
  return partes.join(" · ") + (sueltos ? (corto ? ` ${sueltos}` : ` + ${sueltos}`) : "");
}

/* -------------------------------------------------------------------------- */
/* La sugerencia de cantidades (13/10/2026)                                   */
/* -------------------------------------------------------------------------- */

/*
 * Cuántos manuales mandar a una ciudad sale de lo que postularon sus
 * instituciones: la suma de cada manual en las postulaciones ACTIVAS del año
 * lectivo actual de las instituciones de ese departamento y esa ciudad. Es el
 * mismo criterio que Cantidad de Manuales (la página 50: `ESTADO` distinto de
 * 'Inactivo'), y la misma consulta (`postulaciones/todas`, con su caché), así
 * que no hay SQL propio.
 */

export type InstitucionSugerida = {
  id: number;
  nombre: string;
  postulaciones: number;
  manuales: Record<ClaveManual, number>;
  total: number;
};

export type Sugerencia = {
  /** El año de las postulaciones: el lectivo actual (lo decide el backend). */
  anio: string;
  postulaciones: number;
  manuales: Record<ClaveManual, number>;
  total: number;
  /** Las que suman algo, de la que más manuales lleva a la que menos. */
  instituciones: InstitucionSugerida[];
};

/** `anio` vacío: el backend usa el año lectivo actual. */
export const filtrosSugerencia = (
  idDepartamento: number,
  idCiudad: number,
): FiltrosPostulaciones => ({
  anio: "",
  idDepartamento,
  idCiudad,
  idBarrio: null,
  idInstitucion: null,
  turno: null,
});

/** La suma por manual y por institución. Va como `select` de la consulta. */
export function sumarSugerencia(r: { anio: string; items: PostulacionFila[] }): Sugerencia {
  const manuales = manualesEnCero();
  const porInst = new Map<number, InstitucionSugerida>();
  let postulaciones = 0;
  for (const p of r.items) {
    if (!p.activa) continue;
    postulaciones++;
    let i = porInst.get(p.idInstitucion);
    if (!i) {
      i = {
        id: p.idInstitucion,
        nombre: p.institucion,
        postulaciones: 0,
        manuales: manualesEnCero(),
        total: 0,
      };
      porInst.set(p.idInstitucion, i);
    }
    i.postulaciones++;
    for (const m of MANUALES) {
      const c = Number(p.manuales[m.clave]) || 0;
      manuales[m.clave] += c;
      i.manuales[m.clave] += c;
      i.total += c;
    }
  }
  return {
    anio: r.anio,
    postulaciones,
    manuales,
    total: MANUALES.reduce((a, m) => a + manuales[m.clave], 0),
    instituciones: [...porInst.values()]
      .filter((i) => i.total > 0)
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es")),
  };
}
