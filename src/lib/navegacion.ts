/**
 * El mapa de módulos del ERP: **la única fuente de verdad de la navegación**.
 *
 * Lo consumen los tres menús —la sidebar de escritorio, la tab bar del celular y
 * el drawer de "Menú"—, así que un módulo nuevo se agrega ACÁ y aparece en los
 * tres. Si alguna vez ves un ítem definido dentro de un componente de menú, está
 * mal puesto.
 *
 * **Solo van módulos que existen.** No hay ítems "próximamente": el menú lista lo
 * que se puede usar hoy y crece cuando crece el sistema. Sumar uno son dos pasos:
 * una entrada en `MENU` y su archivo en `src/routes/`.
 *
 * Los grupos existen para que el menú escale sin rediseñarse. Con tres módulos
 * podrían no estar, pero es la estructura que un ERP necesita en cuanto son ocho,
 * y el costo de dejarla armada es una línea por grupo.
 */

import {
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Home,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ItemNav = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Frase corta: la usan el drawer del celular y la cabecera de escritorio. */
  descripcion: string;
};

export type GrupoNav = {
  /** Encabezado de la sección en la sidebar. `null` = sin encabezado (Inicio). */
  titulo: string | null;
  items: ItemNav[];
};

/**
 * Los módulos, agrupados como se leen en la sidebar.
 *
 * El orden es el de uso esperado, no alfabético.
 */
export const MENU: GrupoNav[] = [
  {
    titulo: null,
    items: [
      {
        to: "/home",
        label: "Inicio",
        icon: Home,
        descripcion: "Resumen y accesos rápidos",
      },
    ],
  },
  {
    titulo: "Operación",
    items: [
      {
        to: "/evaluaciones",
        label: "Evaluaciones",
        icon: ClipboardList,
        descripcion: "Evaluación de facilitadores",
      },
      {
        to: "/intervenciones",
        label: "Intervenciones",
        icon: CalendarClock,
        descripcion: "Carga manual de intervenciones",
      },
    ],
  },
  {
    titulo: "Reportes",
    items: [
      {
        to: "/agendas",
        label: "Agendas",
        icon: CalendarDays,
        descripcion: "Horario semanal de los facilitadores",
      },
    ],
  },
  {
    titulo: "Sistema",
    items: [
      {
        to: "/account",
        label: "Mi cuenta",
        icon: Settings,
        descripcion: "Sesión, tema y preferencias",
      },
    ],
  },
];

/** Los ítems sin agrupar, para buscar por ruta. */
export const ITEMS: ItemNav[] = MENU.flatMap((g) => g.items);

/**
 * Cuántos módulos entran en la barra ADEMÁS de "Mi cuenta".
 *
 * Dos + "Mi cuenta" + el botón "Menú" = cuatro objetivos táctiles, que es el
 * máximo que deja un ancho cómodo en un teléfono. Con los tres módulos de hoy
 * (Inicio, Evaluaciones, Mi cuenta) el resultado es idéntico a la barra que ya
 * existía; a partir del cuarto módulo, los que sobran caen en la hoja de "Menú".
 */
const MAX_TABS = 2;

/**
 * Los accesos directos de la tab bar del celular.
 *
 * **Se derivan de `MENU`, no se listan a mano.** Son los primeros
 * {@link MAX_TABS} módulos en el orden en que están declarados, más "Mi cuenta"
 * al final, que va fijo: es el acceso a sesión y preferencias y tiene que estar
 * siempre a un toque, aunque algún día haya diez módulos por delante.
 *
 * Antes las tres rutas estaban escritas literalmente acá. Con eso, agregar un
 * módulo a `MENU` lo dejaba fuera de la barra en silencio y había que acordarse
 * de tocar este archivo en dos lugares. Ahora un módulo nuevo entra solo hasta
 * llenar la barra, y a partir de ahí cae en la hoja de "Menú" — que es
 * exactamente para lo que existe.
 *
 * El drawer sigue mostrando `MENU` entero, así que nada queda inalcanzable.
 */
export const TABS: ItemNav[] = (() => {
  const cuenta = ITEMS.find((i) => i.to === "/account");
  const resto = ITEMS.filter((i) => i.to !== "/account").slice(0, MAX_TABS);
  return cuenta ? [...resto, cuenta] : resto;
})();

/**
 * Si `pathname` cae dentro de `to`.
 *
 * `startsWith` con la barra: `/evaluaciones/nueva` y `/evaluaciones/7` marcan
 * "Evaluaciones" como activo. La barra evita que `/evaluaciones-x` lo active.
 */
export function esRutaActiva(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** El ítem al que corresponde la ruta actual, o `undefined`. */
export function itemActivo(pathname: string) {
  return ITEMS.find((i) => esRutaActiva(pathname, i.to));
}

/** Iniciales para el avatar. "Jose Galvez" → "JG". */
export function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0][0] ?? "";
  const segunda = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primera + segunda).toUpperCase();
}
