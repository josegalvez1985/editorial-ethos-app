import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, RotateCcw, ShieldOff } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { SidebarNav } from "@/components/sidebar-nav";
import { RUTAS_LIBRES } from "@/lib/navegacion";
import { esRutaActiva, usePermisos } from "@/lib/permisos";
import { useSession } from "@/lib/session";

/**
 * Marco de las pantallas con sesión. **Dos layouts, un solo componente:**
 *
 * | | Navegación | Ancho del contenido |
 * | --- | --- | --- |
 * | Celular y APK (`< lg`) | tab bar abajo + hoja "Menú" | el de la pantalla |
 * | Escritorio (`≥ lg`) | sidebar fija a la izquierda | todo lo que deja la sidebar |
 *
 * SIN TOPE DE ANCHO, a pedido (24/09/2026). Hasta entonces el escritorio
 * centraba el contenido en 1152px (`max-w-6xl`) y entre 640 y 1024px lo metía
 * en una columna de 480px: en un monitor grande quedaban dos franjas vacías a
 * los costados. Ahora cada pantalla usa todo el ancho y reparte en columnas lo
 * que tiene (`md:`/`lg:`/`xl:grid-cols-*`) en vez de estirar una sola.
 *
 * **El celular y el APK se ven igual que antes**: los teléfonos son más angostos
 * que 480px, así que esa columna nunca los limitaba.
 *
 * También hace de **guarda de sesión** para todo lo que envuelve: sin sesión, al
 * login. Es el único lugar por donde pasan las pantallas protegidas, así que la
 * guarda vive acá y no repetida en cada ruta.
 *
 * Y, por lo mismo, de **guarda de permisos** (08/10/2026): si la ruta es de una
 * página de `MENU_PAGINAS` y el usuario no la puede consultar en
 * `ROLES_PAGINAS`, en lugar del contenido sale "Sin acceso". El menú ya no la
 * ofrece, pero se llega igual escribiendo la URL o desde un favorito.
 *
 * | Ruta | Mientras carga el menú | Si el menú falla | Cargado |
 * | --- | --- | --- | --- |
 * | Inicio, Mi cuenta | se ve | se ve | se ve |
 * | De una página | espera | error + reintentar | según `PUEDE_CONSULTAR` |
 * | Roles de páginas | espera | error + reintentar | según su fila en `ROLES_PAGINAS`, como las demás |
 * | Crear páginas | espera | error + reintentar | solo su administrador fijo (`administra`) |
 * | Ninguna página la controla | espera | error + reintentar | se ve |
 *
 * Mientras carga se espera en todas menos las libres porque todavía no se sabe
 * cuáles están controladas.
 */
export function AppShell({
  children,
  /**
   * Las pantallas de formulario lo ponen en false: tienen su propio footer fijo
   * con el botón de guardar y dos barras apiladas abajo no se entienden.
   *
   * Solo afecta al celular. En escritorio la sidebar no estorba a nada —está al
   * costado, no encima— así que se muestra siempre.
   */
  nav = true,
}: {
  children?: ReactNode;
  nav?: boolean;
}) {
  const { sesion, ready } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { paginaDeRuta, puedeRuta, cargando, error, reintentar } = usePermisos();
  const libre = RUTAS_LIBRES.some((r) => esRutaActiva(pathname, r));
  const pagina = paginaDeRuta(pathname);
  const estado: "ok" | "cargando" | "error" | "sin-acceso" = libre
    ? "ok"
    : cargando
      ? "cargando"
      : error
        ? "error"
        : puedeRuta(pathname)
          ? "ok"
          : "sin-acceso";

  // `ready` y no solo `sesion`: al abrir la app el provider todavía está
  // revalidando el token guardado contra el backend, y disparar acá mandaría al
  // login a alguien que sí tiene sesión. `replace` para que el botón de atrás no
  // rebote entre el login y esta pantalla.
  useEffect(() => {
    if (ready && !sesion) navigate({ to: "/", replace: true });
  }, [ready, sesion, navigate]);

  // Sin sesión no se pinta nada del contenido. Antes se veía la pantalla entera
  // con el usuario en "Invitado": se llega escribiendo la URL a mano, desde un
  // favorito o compartiendo un link a una pantalla interna.
  if (!sesion) {
    return (
      <div className="grid min-h-dvh place-items-center bg-muted/40">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Verificando la sesión…</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/40 lg:flex">
      {/* Se corta sola en `< lg`; no hace falta condicionarla acá. */}
      <SidebarNav />

      {/*
        `min-w-0`: sin esto, una tabla ancha dentro de un hijo flex estira la
        columna y empuja la sidebar fuera de la pantalla en vez de scrollear.
      */}
      <div className="flex min-h-dvh w-full min-w-0 flex-1 flex-col bg-background lg:bg-muted/40">
        <AppHeader />

        {/*
          pb-28 solo en celular: es el hueco de la barra fija. En escritorio no
          hay barra abajo, así que ese espacio sobraba al final de cada página.
        */}
        <main className="w-full flex-1 pb-28 lg:pb-10">
          {/*
            Sin padding lateral propio, a propósito: el `px-5` que cada pantalla
            ya trae es el único responsable del margen, así no se duplica el aire
            a los costados.
          */}
          <div className="lg:pt-2">
            {estado === "ok" ? (
              children
            ) : estado === "cargando" ? (
              <div className="grid place-items-center py-20">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <span className="sr-only">Verificando permisos…</span>
              </div>
            ) : estado === "error" ? (
              <div className="px-5 py-20 text-center">
                <p className="font-display text-xl font-bold">No se pudo cargar el menú</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Sin él no se sabe qué podés ver."}
                </p>
                <button
                  type="button"
                  onClick={() => reintentar()}
                  className="tap mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-muted px-5 text-sm font-semibold"
                >
                  <RotateCcw className="size-4" />
                  Reintentar
                </button>
              </div>
            ) : (
              <div className="px-5 py-20 text-center">
                <ShieldOff className="mx-auto size-10 text-muted-foreground/40" />
                <p className="font-display mt-3 text-xl font-bold">Sin acceso</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Tu usuario no tiene permiso para {pagina?.nombre ?? "esta pantalla"}. Pedíselo a
                  quien administra los permisos.
                </p>
                <Link
                  to="/home"
                  className="tap mt-4 inline-flex h-11 items-center rounded-xl bg-muted px-5 text-sm font-semibold"
                >
                  Ir al inicio
                </Link>
              </div>
            )}
          </div>
        </main>

        {nav ? <BottomNav /> : null}
      </div>
    </div>
  );
}
