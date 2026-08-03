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

import { ClipboardList, Home, Settings, type LucideIcon } from "lucide-react";

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
 * Los accesos de la tab bar del celular.
 *
 * Hoy son todos los módulos, así que el drawer de "Menú" muestra lo mismo que la
 * barra. Se mantiene igual porque es donde vive **cerrar sesión** —que no merece
 * un cuarto del ancho de la barra— y porque es el lugar por donde van a entrar
 * los módulos que no quepan cuando sean más de tres.
 */
export const TABS: ItemNav[] = ["/home", "/evaluaciones", "/account"].map((to) =>
  ITEMS.find((i) => i.to === to)!,
);

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
