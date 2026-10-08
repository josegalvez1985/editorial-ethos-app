import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, LayoutGrid, LogOut, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { esRutaActiva, iniciales, itemActivo, useGruposAbiertos, useMenu } from "@/lib/navegacion";
import { useSession } from "@/lib/session";

/**
 * Navegación de CELULAR: barra inferior al estilo de una app nativa.
 * Es el equivalente web de las tabs de `mobile/app/(tabs)/_layout.tsx`.
 *
 * En escritorio no se renderiza (`AppShell` la corta en `lg:`); ahí navega la
 * sidebar. Los dos leen el mismo `lib/navegacion.ts`.
 *
 * Tres accesos directos + **Menú**, que abre el resto de los módulos del ERP en
 * una hoja. En una barra de teléfono no entran siete ítems: cuatro es el máximo
 * que deja objetivos táctiles cómodos, así que el cuarto es la puerta a todo lo
 * demás. "Salir" se mudó adentro de esa hoja — se usa una vez por sesión y no
 * merecía un cuarto del ancho, además de que estaba pegado a "Cuenta", que es
 * justo donde uno no quiere errarle.
 *
 * El hueco de abajo lo pone `AppShell` (`pb-28`).
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [abierto, setAbierto] = useState(false);
  const { tabs } = useMenu();

  // La hoja se cierra sola al navegar: sin esto queda abierta encima de la
  // pantalla nueva, porque el Link no desmonta este componente.
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  // "Menú" se marca activo cuando la ruta actual NO es ninguno de los accesos
  // directos de la barra: un módulo que solo vive en la hoja. Sin esto el
  // usuario no vería de dónde salió la pantalla.
  const enMenu = !tabs.some((t) => esRutaActiva(pathname, t.to));

  return (
    <>
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border/60 pb-safe select-none-touch lg:hidden">
        <div className="mx-auto flex max-w-[480px] items-stretch px-2">
          {tabs.map((item) => {
            const active = esRutaActiva(pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className="flex-1"
              >
                <TabContent icon={item.icon} label={item.label} active={active} />
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setAbierto(true)}
            aria-haspopup="dialog"
            aria-expanded={abierto}
            className="flex-1"
          >
            <TabContent icon={LayoutGrid} label="Menú" active={enMenu} />
          </button>
        </div>
      </nav>

      <MenuDrawer abierto={abierto} onOpenChange={setAbierto} />
    </>
  );
}

/**
 * La hoja con todos los módulos, en grilla de dos columnas.
 *
 * Grilla y no lista: son tarjetas con ícono y descripción, que en un sistema con
 * módulos que el usuario todavía no conoce se leen mucho mejor que una fila de
 * texto.
 */
function MenuDrawer({
  abierto,
  onOpenChange,
}: {
  abierto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const { menu, items } = useMenu();
  const actual = itemActivo(pathname, items);
  const grupos = useGruposAbiertos(menu, pathname);

  const onLogout = async () => {
    onOpenChange(false);
    await logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/", replace: true });
  };

  return (
    <Drawer open={abierto} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88dvh] rounded-t-3xl border-border/60 lg:hidden">
        {/* El título es obligatorio para accesibilidad (lo anuncia el lector de
            pantalla al abrir el diálogo), y acá además se ve. */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <span
            aria-hidden
            className="bg-hero-gradient grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-on-brand"
          >
            {iniciales(user?.name ?? "")}
          </span>
          <div className="min-w-0 flex-1">
            <DrawerTitle className="truncate text-[15px] leading-tight font-semibold">
              {user?.name ?? "Juventud con Valores"}
            </DrawerTitle>
            <p className="truncate text-[11.5px] leading-tight text-muted-foreground">
              {actual?.descripcion ?? user?.email ?? ""}
            </p>
          </div>
        </div>

        <div className="no-scrollbar overflow-y-auto px-5 pb-2">
          {menu.map((grupo, i) => {
            const tarjetas = (
              <div className="grid grid-cols-2 gap-2.5">
                {grupo.items.map((item) => {
                  const Icon = item.icon;
                  const activo = esRutaActiva(pathname, item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={activo ? "page" : undefined}
                      className={`tap relative flex flex-col gap-2 rounded-2xl border p-3.5 shadow-soft ${
                        activo
                          ? "border-primary/30 bg-primary-soft"
                          : "border-border/60 bg-card hover:bg-accent"
                      }`}
                    >
                      <span
                        className={`grid size-9 place-items-center rounded-xl ${
                          activo
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary-soft text-primary"
                        }`}
                      >
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">
                          {item.label}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground">
                          {item.descripcion}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
            // Inicio no tiene encabezado: va siempre a la vista.
            if (!grupo.titulo || !grupo.icon) {
              return (
                <div key={`g${i}`} className="mb-2">
                  {tarjetas}
                </div>
              );
            }
            const titulo = grupo.titulo;
            return (
              <GrupoDrawer
                key={titulo}
                titulo={titulo}
                icon={grupo.icon}
                cantidad={grupo.items.length}
                abierto={grupos.abierto(titulo)}
                contieneActivo={grupo.items.some((it) => esRutaActiva(pathname, it.to))}
                onAlternar={() => grupos.alternar(titulo)}
              >
                {tarjetas}
              </GrupoDrawer>
            );
          })}
        </div>

        <div className="border-t border-border/60 px-5 pt-3 pb-safe">
          <button
            type="button"
            onClick={onLogout}
            className="tap mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/10 py-3 text-[14px] font-semibold text-destructive"
          >
            <LogOut className="size-[18px]" />
            Cerrar sesión
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Un menú principal plegable en la hoja (08/10/2026): una fila de 56px —ícono,
 * título, cuántos módulos tiene y chevron— que abre la grilla de tarjetas.
 *
 * El ícono del grupo va sobre `bg-muted` y no sobre `bg-primary-soft` como el
 * de las tarjetas: así el encabezado no se lee como un módulo más. Mismo
 * despliegue que la sidebar (`grid-template-rows` + `inert`).
 */
function GrupoDrawer({
  titulo,
  icon: Icon,
  cantidad,
  abierto,
  contieneActivo,
  onAlternar,
  children,
}: {
  titulo: string;
  icon: LucideIcon;
  cantidad: number;
  abierto: boolean;
  contieneActivo: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        aria-controls={id}
        className="tap flex min-h-14 w-full items-center gap-3 py-2 text-left"
      >
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${
            contieneActivo ? "bg-primary-soft text-primary" : "bg-muted text-foreground/80"
          }`}
        >
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold">{titulo}</span>
          <span className="block text-[11.5px] leading-tight text-muted-foreground">
            {cantidad === 1 ? "1 módulo" : `${cantidad} módulos`}
          </span>
        </span>
        <ChevronDown
          className={`size-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        id={id}
        inert={!abierto}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* `-mx-1.5 px-1.5`: el `overflow-hidden` del despliegue cortaba la
            sombra de las tarjetas a los costados. */}
        <div className="-mx-1.5 min-h-0 overflow-hidden px-1.5">
          <div className="pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Ítem del tab bar: el icono vive dentro de una pastilla que se colorea y se
 * expande cuando la pestaña está activa (patrón de Material 3).
 */
function TabContent({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
}): ReactNode {
  return (
    <span
      className={`tap flex flex-col items-center gap-1 py-2 ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span
        className={`grid h-8 place-items-center rounded-full transition-all duration-200 ease-out ${
          active ? "w-16 bg-primary-soft" : "w-11 bg-transparent"
        }`}
      >
        <Icon className="size-5" />
      </span>
      <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
        {label}
      </span>
    </span>
  );
}
