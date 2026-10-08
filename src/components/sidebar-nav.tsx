import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, LogOut, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { asset } from "@/lib/asset";
import {
  esRutaActiva,
  iniciales,
  useGruposAbiertos,
  useMenu,
  type ItemNav,
} from "@/lib/navegacion";
import { useSession } from "@/lib/session";

/**
 * Navegación de ESCRITORIO: barra lateral fija con todos los módulos del ERP.
 *
 * En el celular no se renderiza (`AppShell` la muestra desde `lg:`); ahí la
 * navegación es la tab bar + el drawer de "Menú". Los tres leen el mismo
 * `lib/navegacion.ts`.
 *
 * Va sobre el navy de marca y no sobre el fondo claro: le da a la columna el
 * peso que se espera de un ERP y separa la navegación del contenido sin
 * necesidad de un borde.
 */

const CLAVE_COLAPSADA = "ethos-sidebar-colapsada";

export function SidebarNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [colapsada, setColapsada] = useState(false);
  const { menu } = useMenu();
  const grupos = useGruposAbiertos(menu, pathname);

  /*
   * La preferencia se lee en un efecto y no en el estado inicial, por lo mismo
   * que el resto de la app: en SSR/prerender no hay `localStorage`, así que
   * leerlo durante el render haría que el HTML del servidor (expandida) no
   * coincida con el del cliente (colapsada) y React tiraría la hidratación.
   */
  useEffect(() => {
    try {
      setColapsada(localStorage.getItem(CLAVE_COLAPSADA) === "1");
    } catch {
      /* modo privado sin storage: queda expandida, que es el default */
    }
  }, []);

  const alternar = () => {
    setColapsada((c) => {
      try {
        localStorage.setItem(CLAVE_COLAPSADA, c ? "0" : "1");
      } catch {
        /* se pierde la preferencia, no la navegación */
      }
      return !c;
    });
  };

  const onLogout = async () => {
    await logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/", replace: true });
  };

  return (
    <aside
      // `sticky` + `h-dvh`: la barra queda a la vista aunque el contenido sea
      // largo, sin sacarla del flujo (con `fixed` habría que compensar el ancho
      // a mano en el main, y se desincroniza al colapsar).
      className={`bg-navy-gradient sticky top-0 hidden h-dvh shrink-0 flex-col text-white/70 transition-[width] duration-300 ease-out lg:flex ${
        colapsada ? "w-[76px]" : "w-[260px]"
      }`}
    >
      {/* Marca */}
      <div className="flex h-16 items-center gap-3 px-4">
        {/*
          Sin `bg-white` ni padding: el logo trae su propio fondo azul, así que
          el recuadro blanco le quedaba como un borde suelto alrededor. Va a
          sangre dentro del cuadrado redondeado.
        */}
        <Link
          to="/home"
          aria-label="Juventud con Valores"
          className="tap grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl shadow-soft"
        >
          <img src={asset("logo.png")} alt="" className="size-full" />
        </Link>
        {!colapsada && (
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[15px] leading-tight font-bold text-white">
              Juventud con Valores
            </p>
            <p className="truncate text-[11px] leading-tight text-white/65">Sistema de gestión</p>
          </div>
        )}
      </div>

      {/* Módulos */}
      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-2">
        {menu.map((grupo, i) => {
          const lista = (
            <ul className="space-y-0.5">
              {grupo.items.map((item) => (
                <li key={item.to}>
                  <ItemSidebar
                    item={item}
                    activo={esRutaActiva(pathname, item.to)}
                    colapsada={colapsada}
                  />
                </li>
              ))}
            </ul>
          );
          // Inicio no tiene encabezado: va siempre a la vista.
          if (!grupo.titulo || !grupo.icon) {
            return (
              <div key={`g${i}`} className="mb-2">
                {lista}
              </div>
            );
          }
          const titulo = grupo.titulo;
          const abierto = grupos.abierto(titulo);
          return (
            <GrupoSidebar
              key={titulo}
              titulo={titulo}
              icon={grupo.icon}
              abierto={abierto}
              // Cerrado con la pantalla actual adentro: el encabezado se
              // resalta, para que se vea de dónde salió.
              contieneActivo={grupo.items.some((it) => esRutaActiva(pathname, it.to))}
              colapsada={colapsada}
              onAlternar={() => grupos.alternar(titulo)}
            >
              {lista}
            </GrupoSidebar>
          );
        })}
      </nav>

      {/* Usuario + salir */}
      <div className="border-t border-white/10 p-3">
        <div
          className={`flex items-center gap-2.5 rounded-xl px-2 py-2 ${
            colapsada ? "justify-center" : ""
          }`}
        >
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-semibold text-white"
          >
            {iniciales(user?.name ?? "")}
          </span>
          {!colapsada && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-tight font-semibold text-white">
                {user?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] leading-tight text-white/65">
                {user?.email ?? ""}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onLogout}
          title={colapsada ? "Cerrar sesión" : undefined}
          className={`tap mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium text-white/75 hover:bg-white/10 hover:text-white ${
            colapsada ? "justify-center px-0" : ""
          }`}
        >
          <LogOut className="size-[18px] shrink-0" />
          {!colapsada && <span>Cerrar sesión</span>}
        </button>

        <button
          type="button"
          onClick={alternar}
          aria-label={colapsada ? "Expandir el menú" : "Colapsar el menú"}
          className={`tap mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium text-white/60 hover:bg-white/10 hover:text-white/90 ${
            colapsada ? "justify-center px-0" : ""
          }`}
        >
          <ChevronLeft
            className={`size-[18px] shrink-0 transition-transform duration-300 ${
              colapsada ? "rotate-180" : ""
            }`}
          />
          {!colapsada && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}

/**
 * Un menú principal plegable (08/10/2026).
 *
 * Expandida: ícono + título + chevron. Colapsada (76px) no hay lugar para el
 * título, así que queda el ícono del grupo en un recuadro tenue —para que no se
 * confunda con un módulo— y el título va en el `title`.
 *
 * El despliegue anima la altura con `grid-template-rows` 0fr → 1fr, que no
 * necesita medir el contenido. Cerrado lleva `inert`: los links escondidos no
 * reciben foco con Tab ni los anuncia el lector de pantalla.
 */
function GrupoSidebar({
  titulo,
  icon: Icon,
  abierto,
  contieneActivo,
  colapsada,
  onAlternar,
  children,
}: {
  titulo: string;
  icon: LucideIcon;
  abierto: boolean;
  contieneActivo: boolean;
  colapsada: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const resaltado = contieneActivo && !abierto;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        aria-controls={id}
        title={colapsada ? titulo : undefined}
        className={
          colapsada
            ? `tap mx-auto flex h-9 w-12 items-center justify-center gap-0.5 rounded-xl bg-white/[0.06] hover:bg-white/12 ${
                resaltado ? "text-white" : "text-white/55 hover:text-white/90"
              }`
            : `tap flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase hover:bg-white/8 ${
                resaltado ? "text-white" : "text-white/55 hover:text-white/90"
              }`
        }
      >
        <Icon className={colapsada ? "size-4 shrink-0" : "size-4 shrink-0 text-white/70"} />
        {!colapsada && <span className="min-w-0 flex-1 truncate text-left">{titulo}</span>}
        <ChevronDown
          className={`shrink-0 transition-transform duration-200 ${
            colapsada ? "size-3" : "size-4"
          } ${abierto ? "" : "-rotate-90"}`}
        />
      </button>
      <div
        id={id}
        inert={!abierto}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className={`min-h-0 overflow-hidden ${colapsada ? "" : "pl-2"}`}>
          <div className="pt-0.5 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Un módulo en la sidebar.
 *
 * El activo se marca por dos vías a la vez —pastilla clara y barra roja a la
 * izquierda— porque colapsada la pastilla sola se lee poco.
 */
function ItemSidebar({
  item,
  activo,
  colapsada,
}: {
  item: ItemNav;
  activo: boolean;
  colapsada: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={activo ? "page" : undefined}
      // `title` solo colapsada: expandida el texto ya está a la vista y el
      // tooltip del navegador sería ruido.
      title={colapsada ? item.label : undefined}
      className={`tap relative flex items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-medium ${
        colapsada ? "justify-center px-0" : "px-3"
      } ${activo ? "bg-white/12 text-white" : "text-white/60 hover:bg-white/8 hover:text-white"}`}
    >
      {activo && (
        <span
          aria-hidden
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon className="size-[18px] shrink-0" />
      {!colapsada && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </Link>
  );
}
