import { useEffect, useState } from "react";

/*
 * La lupa de las planillas (09/10/2026, a pedido): achica o agranda SOLO la
 * planilla, no la página, para ver todas las columnas de un pantallazo. La
 * usan la grilla editable de la ficha (Pre-horarios y Postulaciones) y la
 * planilla de Postulaciones de Operaciones; el tamaño elegido es uno solo para
 * todas y se recuerda en este navegador.
 */

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.5;
export const PASO_ZOOM = 0.1;
const CLAVE_ZOOM = "ethos-grilla-zoom";

/**
 * El zoom de la planilla, entre 40 % y 150 %, recordado en este navegador
 * (`localStorage`, como el tema). Se lee en un efecto y no en el estado
 * inicial: en el prerender no hay `localStorage`.
 */
export function useZoomPlanilla(): [number, (z: number) => void] {
  const [zoom, setZoomEstado] = useState(1);
  useEffect(() => {
    try {
      const z = Number(localStorage.getItem(CLAVE_ZOOM));
      if (z >= ZOOM_MIN && z <= ZOOM_MAX) setZoomEstado(z);
    } catch {
      /* sin storage: queda en 100 % */
    }
  }, []);
  const setZoom = (z: number) => {
    const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    setZoomEstado(v);
    try {
      localStorage.setItem(CLAVE_ZOOM, String(v));
    } catch {
      /* se pierde la preferencia, no el zoom */
    }
  };
  return [zoom, setZoom];
}

/**
 * Lo que necesita una planilla con lupa y sin barra propia, a partir de su
 * ancho natural (la suma de sus columnas, no la medida de la tabla, que con
 * zoom puesto cada navegador informa distinto):
 *
 * - `marco`: el `ref` del recuadro que contiene la tabla. Es de callback y no
 *   un `useRef`: así lo mide también cuando aparece después (al llegar los
 *   datos) o se vuelve a montar.
 * - `cabe`: si entra a lo ancho con el zoom actual. Entonces el recuadro no
 *   recorta nada y el encabezado puede quedar pegado bajo la cabecera de la
 *   app; si no, solo queda el desplazamiento de costado.
 * - `ajustar`: el zoom con el que TODAS las columnas entran en el recuadro.
 * - `topEncabezado`: el `top` del encabezado fijo, debajo de la cabecera de la
 *   app (64 px + la muesca del celular), dividido por el zoom porque dentro de
 *   la tabla las medidas se escalan.
 */
export function usePlanilla(natural: number) {
  const [zoom, setZoom] = useZoomPlanilla();
  const [el, marco] = useState<HTMLElement | null>(null);
  const [disponible, setDisponible] = useState(0);
  useEffect(() => {
    if (!el) return;
    const obs = new ResizeObserver(() => setDisponible(el.clientWidth));
    obs.observe(el);
    return () => obs.disconnect();
  }, [el]);
  const cabe = disponible > 0 && natural * zoom <= disponible + 1;
  const ajustar = () => {
    const ancho = (el?.clientWidth ?? 0) - 2;
    if (ancho > 0 && natural > 0) setZoom(Math.floor((ancho / natural) * 100) / 100);
  };
  const topEncabezado = `calc((4rem + env(safe-area-inset-top, 0px)) / ${zoom})`;
  return { marco, zoom, setZoom, cabe, ajustar, topEncabezado };
}

/*
 * Las horas escritas a mano (09/10/2026, a pedido: sin el reloj del
 * <input type="time"> y editables con un clic). Se escriben solo los números.
 */

/** Mientras se escribe: los dos puntos recién con el cuarto número ("0730" → "07:30"). */
export const escribirHora = (v: string) => {
  // Con tres ("730") todavía no se sabe si es 7:30 o 73:0; al salir se completa.
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length === 4 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

/** Al salir: "7" → "07:00", "730" → "07:30", "0730"/"07:30" → "07:30". Vacío o inválido: igual. */
export function normalizarHora(v: string): string {
  const d = v.replace(/\D/g, "");
  if (!d) return "";
  let h: number;
  let m: number;
  if (d.length <= 2) {
    h = Number(d);
    m = 0;
  } else if (d.length === 3) {
    h = Number(d.slice(0, 1));
    m = Number(d.slice(1));
  } else {
    h = Number(d.slice(0, 2));
    m = Number(d.slice(2, 4));
  }
  if (h > 23 || m > 59) return v;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
