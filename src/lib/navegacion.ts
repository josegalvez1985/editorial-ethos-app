/**
 * El menú de la app: **sale de la base**, de `MENU_PAGINAS` filtrada por los
 * permisos del usuario en `ROLES_PAGINAS` (ver `lib/permisos.ts`).
 *
 * Lo consumen los tres menús —la sidebar de escritorio, la tab bar del celular y
 * el drawer de "Menú"— a través de {@link useMenu}. Si alguna vez ves un ítem
 * definido dentro de un componente de menú, está mal puesto.
 *
 * Hasta el 08/10/2026 el menú entero estaba escrito acá, en una constante. Ahora
 * la base dice qué pantallas hay, en qué menú principal van, con qué nombre y
 * quién las ve. Sumar una pantalla son tres pasos:
 *
 * 1. Su archivo en `src/routes/`.
 * 2. Su fila en `MENU_PAGINAS` (pantalla Crear páginas): el número lo pone el
 *    backend, el último del menú más 1.
 * 3. Sus permisos en `ROLES_PAGINAS` (pantalla Roles de páginas). El alta no
 *    da ninguno: hasta este paso la página no le aparece a nadie.
 *
 * Y su descripción en {@link PANTALLAS}. El ícono ya está en {@link ICONOS_MENU}
 * y NO se toca; una ruta que no esté ahí recibe uno por el nombre (ver
 * {@link armarMenu}).
 *
 * Los menús principales se pliegan, en la sidebar y en la hoja "Menú" del
 * celular: ver {@link useGruposAbiertos}.
 *
 * Con su ítem armado acá y no desde la base:
 *
 * - Inicio y Mi cuenta: los ve cualquiera con sesión.
 * - Roles de páginas: la ve quien tiene su página (la 2) habilitada en
 *   `ROLES_PAGINAS`, como cualquier otra; solo el nombre y el lugar son fijos.
 * - Crear páginas: la ve quien dice `administra` en el paquete (JOSEG), y
 *   `GET menu` lo trae en `admin.paginas`.
 */

import {
  Activity,
  Anchor,
  AppWindow,
  Archive,
  ArrowLeftRight,
  Backpack,
  Bell,
  Book,
  BookCopy,
  Bookmark,
  BookOpen,
  Box,
  Boxes,
  BriefcaseBusiness,
  Building,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX,
  ChartBar,
  ChartColumn,
  ChartPie,
  ClipboardList,
  Clock,
  Compass,
  Component,
  Database,
  Feather,
  FileClock,
  FileSearch,
  FileText,
  FileUser,
  Flag,
  Folder,
  Gauge,
  Gem,
  Globe,
  GraduationCap,
  Hexagon,
  Highlighter,
  History,
  IdCard,
  Landmark,
  Layers,
  LayoutList,
  Leaf,
  Library,
  Lightbulb,
  ListChecks,
  ListOrdered,
  ListTodo,
  Home,
  Mail,
  Map as MapIcon,
  MapPin,
  MapPinned,
  MessageSquare,
  Milestone,
  Network,
  Package,
  PartyPopper,
  Presentation,
  Puzzle,
  Receipt,
  Rocket,
  School,
  Search,
  Settings,
  Shapes,
  ShieldCheck,
  ShieldHalf,
  ShoppingCart,
  Sigma,
  Signpost,
  SlidersHorizontal,
  Star,
  Store,
  Tag,
  Target,
  Truck,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import {
  esRutaActiva,
  RUTA_PAGINAS,
  RUTA_PERMISOS,
  usePermisos,
  type MiMenu,
} from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export { esRutaActiva };

export type ItemNav = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Frase corta: la usan el drawer del celular y la cabecera de escritorio. */
  descripcion?: string;
  /**
   * `false` = nunca va a la barra del celular, aunque esté entre los primeros.
   *
   * Para los catálogos del Núcleo de Datos: van ANTES de Operaciones en el
   * menú, y sin esto Sucursales —que se toca una vez por mes— le quitaría el
   * lugar de la barra a Evaluaciones, que se usa todos los días. Ver `tabsDe`.
   */
  enBarra?: false;
};

export type GrupoNav = {
  /**
   * Encabezado de la sección. `null` = sin encabezado (Inicio): va siempre a la
   * vista, no se pliega.
   */
  titulo: string | null;
  /** Ícono del menú principal. `null` solo junto con `titulo` `null`. */
  icon: LucideIcon | null;
  items: ItemNav[];
};

/**
 * El ícono de cada página del menú, por su `RUTA` de `MENU_PAGINAS`: las que
 * el sitio ya tiene y las de APEX que todavía no.
 *
 * **ESTA LISTA NO SE TOCA AL PROGRAMAR UNA PANTALLA** (pedido el 08/10/2026).
 * Antes los íconos vivían en dos listas y al programar una página el suyo se
 * pasaba de una a la otra: en el archivo se veía como si se borrara. Ahora hay
 * una sola y la pantalla nueva solo suma su descripción en {@link PANTALLAS}.
 * Cambiar un ícono es solo a pedido explícito, y la pantalla usa el mismo
 * (por ejemplo, el `icon` de `<CatalogoNombre>`).
 *
 * Una página que no esté acá recibe uno por el nombre (ver {@link armarMenu}).
 */
const ICONOS_MENU: Record<string, LucideIcon> = {
  "/paises": Globe,
  "/nacionalidades": Flag,
  "/barrios": Signpost,
  "/ciudades": Building2,
  "/departamentos": MapIcon,
  "/sucursales": Store,
  "/evaluaciones": ClipboardList,
  "/intervenciones": CalendarClock,
  "/inventario": Boxes,
  "/transferencias": Truck,
  "/agendas": CalendarDays,
  "/consulta-inventarios": FileText,
  "/consulta-transferencias": ArrowLeftRight,
  "/auditoria": History,
  "/usuarios": Users,
  "/facilitadores": UserCheck,
  "/instituciones": School,
  "/materias": BookOpen,
  "/postulaciones": FileUser,
  "/asignar-facilitadores": UserPlus,
  "/consulta-postulaciones": FileSearch,
  "/mapa-intervenciones": MapPinned,
  "/enfasis": Highlighter,
  "/indices": ListOrdered,
  "/horarios-instituciones": Clock,
  "/directores": BriefcaseBusiness,
  "/instituciones-directores": Building,
  "/docentes": Presentation,
  "/consulta-instituciones-facilitadores": Network,
  "/coordinadores": UsersRound,
  "/instituciones-coordinadores": Landmark,
  "/consulta-alumnos-grado": GraduationCap,
  "/consulta-cantidad-manuales": BookCopy,
  "/consulta-intervenciones": ListChecks,
  "/resumen-intervenciones": ChartPie,
  "/totales-facilitador": Sigma,
  "/anios-lectivos": CalendarRange,
  "/auditoria-intervenciones": FileClock,
  "/consulta-instituciones": Library,
  "/consulta-facilitadores": IdCard,
  "/intervenciones-no-realizadas": CalendarX,
  "/feriados": PartyPopper,
  "/historial-inventarios": Archive,
  "/etapas": Milestone,
  "/areas-evaluacion": Shapes,
  "/items-evaluacion": ListTodo,
  "/escalas-evaluacion": Gauge,
  "/monitoreo-facilitadores": Activity,
};

/**
 * Lo que la app sabe de cada pantalla que YA TIENE y la base no: descripción y
 * si va a la barra del celular. La clave es la `RUTA` de `MENU_PAGINAS`. El
 * ícono no va acá: está en {@link ICONOS_MENU}.
 *
 * NO decide qué se muestra: una ruta que está acá pero no en la base no
 * aparece en el menú. Sirve también de lista de rutas que existen, para
 * avisar al dar de alta una página con una ruta que la app no tiene.
 */
export const PANTALLAS: Record<string, { descripcion: string; enBarra?: false }> = {
  "/paises": { descripcion: "Catálogo de países", enBarra: false },
  "/facilitadores": { descripcion: "Ficha de cada facilitador", enBarra: false },
  "/nacionalidades": { descripcion: "Catálogo de nacionalidades", enBarra: false },
  "/barrios": { descripcion: "Los barrios de cada ciudad", enBarra: false },
  "/ciudades": { descripcion: "Las ciudades de cada departamento", enBarra: false },
  "/departamentos": { descripcion: "Los departamentos de cada país", enBarra: false },
  "/sucursales": { descripcion: "Alta y modificación de sucursales", enBarra: false },
  "/instituciones": { descripcion: "Datos, autoridades y horario de cada una", enBarra: false },
  "/docentes": { descripcion: "Los docentes de los pre-horarios", enBarra: false },
  "/materias": { descripcion: "Catálogo de materias", enBarra: false },
  "/enfasis": { descripcion: "Catálogo de énfasis", enBarra: false },
  "/evaluaciones": { descripcion: "Evaluación de facilitadores" },
  "/intervenciones": { descripcion: "Carga manual de intervenciones" },
  "/inventario": { descripcion: "Conteo de manuales por sucursal" },
  "/transferencias": { descripcion: "Envío de manuales entre sucursales" },
  "/agendas": { descripcion: "Horario semanal de los facilitadores" },
  "/consulta-inventarios": { descripcion: "Conteos pendientes y cerrados, con PDF" },
  "/consulta-transferencias": { descripcion: "Envíos entre sucursales por ruta y manual, con PDF" },
  "/auditoria": { descripcion: "Consultas de auditoría" },
  "/usuarios": { descripcion: "Activar y bloquear cuentas", enBarra: false },
};

/**
 * El ícono de cada menú principal, por su nombre normalizado (sin tildes ni
 * mayúsculas: "Núcleo de Datos" → "nucleo de datos"). Lo muestra el
 * encabezado plegable del grupo, y en la sidebar angosta es lo único que se ve.
 */
const ICONOS_GRUPO: Record<string, LucideIcon> = {
  "nucleo de datos": Database,
  operaciones: Workflow,
  "reportes y consultas": ChartColumn,
  administrador: ShieldHalf,
  sistema: SlidersHorizontal,
};

/**
 * Para una página o un menú principal NUEVO, que no está en ningún mapa: un
 * ícono por palabra clave del nombre. Si ese ya lo usa otro, el primero libre
 * de {@link REPUESTO}. Así una página recién creada en Crear páginas tampoco
 * sale con el ícono de otra.
 */
const POR_PALABRA: [RegExp, LucideIcon][] = [
  [/usuario|rol/, UserCog],
  [/mapa|ubicacion/, MapPin],
  [/calendario|fecha|horario|agenda/, Calendar],
  [/manual|libro/, Book],
  [/factura|recibo|pago|cobro/, Receipt],
  [/compra|pedido|venta/, ShoppingCart],
  [/stock|existencia|deposito/, Warehouse],
  [/alumno|estudiante/, Backpack],
  [/caja|gasto|ingreso/, Wallet],
  [/aviso|notificacion|alerta/, Bell],
  [/correo|mail/, Mail],
  [/mensaje|comentario/, MessageSquare],
  [/reporte|estadistica|grafico/, ChartBar],
  [/consulta|busqueda|buscar/, Search],
  [/producto|articulo/, Package],
];
const REPUESTO: LucideIcon[] = [
  Folder,
  Box,
  Bookmark,
  Compass,
  Component,
  Gem,
  Hexagon,
  Layers,
  Puzzle,
  Rocket,
  Star,
  Tag,
  Target,
  Zap,
  Anchor,
  Feather,
  Leaf,
  Lightbulb,
];

/** Si se acaban los de {@link REPUESTO}: el único que se puede repetir. */
const ICONO_POR_DEFECTO = AppWindow;

/** Las dos que no dependen de la base: las ve cualquiera con sesión. */
const INICIO: ItemNav = {
  to: "/home",
  label: "Inicio",
  icon: Home,
  descripcion: "Resumen y accesos rápidos",
};
const CUENTA: ItemNav = {
  to: "/account",
  label: "Mi cuenta",
  icon: Settings,
  descripcion: "Sesión, tema y preferencias",
};

/** Rutas que no controla `ROLES_PAGINAS`. */
export const RUTAS_LIBRES = [INICIO.to, CUENTA.to];

/**
 * Las dos pantallas de administración (Roles de páginas y Crear páginas) van
 * **dentro del menú principal Administrador**, el mismo de la base, al
 * principio, con nombre e ícono fijos. Quién las ve:
 *
 * - Roles de páginas: **por `ROLES_PAGINAS`**, con `PUEDE_CONSULTAR` en su
 *   página (la 2 de APEX). Sin eso no aparece (08/10/2026; antes era fija para
 *   JOSEG y EDGARO).
 * - Crear páginas: fija, `administra` en el paquete (`admin.paginas`).
 *
 * Hasta el 08/10/2026 tenían un grupo propio, "Administración", justo después
 * de Inicio. Se juntaron con Administrador, a pedido: eran dos menús con casi
 * el mismo nombre y para lo mismo.
 *
 * El grupo se busca por nombre normalizado, así que si en Crear páginas le
 * cambian una tilde o una mayúscula sigue funcionando. Si no hay ningún menú
 * Administrador en la base, se crea con este nombre, después de Inicio.
 */
const GRUPO_ADMIN = "Administrador";
const PERMISOS: ItemNav = {
  to: RUTA_PERMISOS,
  label: "Roles de páginas",
  icon: ShieldCheck,
  descripcion: "Qué páginas puede usar cada usuario",
  enBarra: false,
};
const PAGINAS: ItemNav = {
  to: RUTA_PAGINAS,
  label: "Crear páginas",
  icon: LayoutList,
  descripcion: "Alta de las páginas del menú",
  enBarra: false,
};

/**
 * El menú a partir de las páginas que devuelve `GET menu`.
 *
 * Solo las que el usuario puede consultar, agrupadas por menú principal en el
 * orden en que llegan (el backend ya las ordena). Inicio va primero, sin
 * encabezado; las dos fijas de administración, si le tocan, al principio de
 * Administrador (ver {@link GRUPO_ADMIN}); y Mi cuenta último, en "Sistema".
 *
 * **Cada página y cada menú principal lleva un ícono distinto.** Los de las
 * pantallas conocidas salen de los mapas; los de una página o un menú nuevos
 * se eligen acá, recorriendo TODAS las páginas y no solo las que el usuario ve:
 * así una página nueva tiene el mismo ícono para todos, y no uno que dependa de
 * qué otras le tocaron a cada uno.
 */
export function armarMenu({ paginas, admin }: MiMenu): GrupoNav[] {
  const usados = new Set(ICONOS_CONOCIDOS);
  const elegir = (nombre: string) => {
    const n = normalizar(nombre);
    const icono =
      [...POR_PALABRA.filter(([re]) => re.test(n)).map(([, i]) => i), ...REPUESTO].find(
        (i) => !usados.has(i),
      ) ?? ICONO_POR_DEFECTO;
    usados.add(icono);
    return icono;
  };
  const iconoPagina = new Map<string, LucideIcon>();
  const iconoGrupo = new Map<string, LucideIcon>();
  for (const p of paginas) {
    if (!iconoPagina.has(p.ruta)) {
      iconoPagina.set(p.ruta, ICONOS_MENU[p.ruta] ?? elegir(p.nombre));
    }
    if (!iconoGrupo.has(p.menuPrincipal)) {
      iconoGrupo.set(
        p.menuPrincipal,
        ICONOS_GRUPO[normalizar(p.menuPrincipal)] ?? elegir(p.menuPrincipal),
      );
    }
  }

  const grupos = new Map<string, ItemNav[]>();
  for (const p of paginas) {
    // /permisos está en la base como la página 2 de APEX (Roles de Usuarios):
    // va con su ítem fijo, al principio de Administrador (`vePermisos`), no
    // acá con el nombre de APEX.
    if (!p.consultar || p.ruta === RUTA_PERMISOS || p.ruta === RUTA_PAGINAS) continue;
    const pantalla = PANTALLAS[p.ruta];
    const items = grupos.get(p.menuPrincipal) ?? [];
    items.push({
      to: p.ruta,
      label: p.nombre,
      icon: iconoPagina.get(p.ruta) ?? ICONO_POR_DEFECTO,
      descripcion: pantalla?.descripcion,
      enBarra: pantalla?.enBarra,
    });
    grupos.set(p.menuPrincipal, items);
  }
  // Roles de páginas, por su fila de ROLES_PAGINAS y no por `admin.permisos`:
  // así vale aunque el backend todavía sea el de antes, que la daba fija.
  const vePermisos = paginas.some((p) => p.ruta === RUTA_PERMISOS && p.consultar);
  const fijas = [vePermisos && PERMISOS, admin.paginas && PAGINAS].filter((i): i is ItemNav => !!i);

  // El orden de los grupos es el de TODAS las páginas (`iconoGrupo` se llenó
  // así), no solo las que el usuario ve: Administrador queda en su lugar aunque
  // al usuario solo le toquen las fijas.
  const grupoAdmin = [...iconoGrupo.keys()].find((t) => normalizar(t) === normalizar(GRUPO_ADMIN));
  const orden = [...iconoGrupo.keys()];
  if (fijas.length && !grupoAdmin) {
    orden.unshift(GRUPO_ADMIN);
    iconoGrupo.set(GRUPO_ADMIN, ICONOS_GRUPO.administrador);
  }
  const delMenu = orden
    .map((titulo) => ({
      titulo,
      icon: iconoGrupo.get(titulo) ?? ICONO_POR_DEFECTO,
      items:
        titulo === (grupoAdmin ?? GRUPO_ADMIN)
          ? [...fijas, ...(grupos.get(titulo) ?? [])]
          : (grupos.get(titulo) ?? []),
    }))
    .filter((g) => g.items.length > 0);

  return [
    { titulo: null, icon: null, items: [INICIO] },
    ...delMenu,
    { titulo: "Sistema", icon: ICONOS_GRUPO.sistema, items: [CUENTA] },
  ];
}

/** Los íconos que ya tienen dueño: un ícono elegido por nombre no los repite. */
const ICONOS_CONOCIDOS: ReadonlySet<LucideIcon> = new Set([
  ...[INICIO, CUENTA, PERMISOS, PAGINAS].map((i) => i.icon),
  ...Object.values(ICONOS_MENU),
  ...Object.values(ICONOS_GRUPO),
]);

/* -------------------------------------------------------------------------- */
/* Menús principales plegables                                                */
/* -------------------------------------------------------------------------- */

/**
 * Qué menús principales están abiertos (08/10/2026). Con las ~45 páginas que
 * trajo `MENU_PAGINAS` el menú abierto entero no entraba en la pantalla.
 *
 * - **Arrancan cerrados**, salvo el de la pantalla actual, que se abre solo al
 *   navegar (si no, el ítem activo quedaría escondido). Después se puede
 *   cerrar a mano.
 * - Se guarda en `localStorage`, como el tema: es preferencia de interfaz y
 *   sobrevive al logout.
 * - Es UN estado para la sidebar y la hoja "Menú" del celular, en un store de
 *   módulo y no en un `useState` de cada uno: abrir un grupo en uno lo abre en
 *   el otro.
 *
 * `useSyncExternalStore` y no un efecto que lea el storage: en el prerender no
 * hay `localStorage`, y con `getServerSnapshot` React hidrata con todo cerrado
 * y recién después aplica lo guardado, sin error de hidratación.
 */
const CLAVE_GRUPOS = "ethos-menu-abiertos";
const NINGUNO: ReadonlySet<string> = new Set();
let abiertos: ReadonlySet<string> | null = null;
const oyentes = new Set<() => void>();

function leerAbiertos(): ReadonlySet<string> {
  if (abiertos) return abiertos;
  try {
    const guardado: unknown = JSON.parse(localStorage.getItem(CLAVE_GRUPOS) ?? "[]");
    abiertos = new Set(
      Array.isArray(guardado) ? guardado.filter((g): g is string => typeof g === "string") : [],
    );
  } catch {
    abiertos = NINGUNO; // modo privado sin storage: todo cerrado, que es el default
  }
  return abiertos;
}

function escribirAbiertos(nuevos: ReadonlySet<string>) {
  abiertos = nuevos;
  try {
    localStorage.setItem(CLAVE_GRUPOS, JSON.stringify([...nuevos]));
  } catch {
    /* se pierde la preferencia, no la navegación */
  }
  oyentes.forEach((o) => o());
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * `abierto(titulo)` y `alternar(titulo)` para los encabezados de `menu`. Abre
 * solo el grupo de `pathname` cada vez que cambia.
 */
export function useGruposAbiertos(menu: GrupoNav[], pathname: string) {
  const estado = useSyncExternalStore(suscribir, leerAbiertos, () => NINGUNO);
  const activo = menu.find((g) => g.items.some((i) => esRutaActiva(pathname, i.to)))?.titulo;

  // Depende del TÍTULO y no del pathname solo: al arrancar el menú llega un
  // instante después que la ruta, y recién ahí se sabe a qué grupo abrir.
  useEffect(() => {
    const actual = leerAbiertos();
    if (activo && !actual.has(activo)) escribirAbiertos(new Set([...actual, activo]));
  }, [activo, pathname]);

  return {
    abierto: (titulo: string) => estado.has(titulo),
    alternar: (titulo: string) => {
      const actual = new Set(leerAbiertos());
      if (actual.has(titulo)) actual.delete(titulo);
      else actual.add(titulo);
      escribirAbiertos(actual);
    },
  };
}

/**
 * Cuántos módulos entran en la barra ADEMÁS de "Mi cuenta".
 *
 * Dos + "Mi cuenta" + el botón "Menú" = cuatro objetivos táctiles, que es el
 * máximo que deja un ancho cómodo en un teléfono. Los que sobran caen en la
 * hoja de "Menú".
 */
const MAX_TABS = 2;

/**
 * Los accesos directos de la tab bar del celular.
 *
 * **Se derivan del menú, no se listan a mano.** Son los primeros
 * {@link MAX_TABS} módulos en el orden del menú, más "Mi cuenta" al final, que
 * va fijo: es el acceso a sesión y preferencias y tiene que estar siempre a un
 * toque, aunque algún día haya diez módulos por delante.
 *
 * Recibe los ítems YA filtrados por permisos: un módulo que el usuario no puede
 * ver no le ocupa un lugar en la barra.
 *
 * Los ítems con `enBarra: false` se saltean: ver `ItemNav.enBarra`.
 */
function tabsDe(items: ItemNav[]): ItemNav[] {
  const cuenta = items.find((i) => i.to === CUENTA.to);
  const resto = items.filter((i) => i.to !== CUENTA.to && i.enBarra !== false).slice(0, MAX_TABS);
  return cuenta ? [...resto, cuenta] : resto;
}

/**
 * El menú del usuario en sesión. Es lo que leen la sidebar, la barra del
 * celular, la hoja "Menú" y la cabecera.
 *
 * Mientras carga son solo Inicio y Mi cuenta: los módulos aparecen un instante
 * después, en vez de mostrarse y desaparecer.
 */
export function useMenu() {
  const { paginas, admin } = usePermisos();
  const menu = armarMenu({ paginas, admin });
  const items = menu.flatMap((g) => g.items);
  return { menu, items, tabs: tabsDe(items) };
}

/** El ítem al que corresponde la ruta actual, o `undefined`. */
export function itemActivo(pathname: string, items: ItemNav[]) {
  return items.find((i) => esRutaActiva(pathname, i.to));
}

/** Iniciales para el avatar. "Jose Galvez" → "JG". */
export function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0][0] ?? "";
  const segunda = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primera + segunda).toUpperCase();
}
