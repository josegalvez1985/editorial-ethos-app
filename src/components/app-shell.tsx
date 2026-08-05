import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { SidebarNav } from "@/components/sidebar-nav";
import { useSession } from "@/lib/session";

/**
 * Marco de las pantallas con sesión. **Dos layouts, un solo componente:**
 *
 * | | Navegación | Ancho del contenido |
 * | --- | --- | --- |
 * | Celular y APK (`< lg`) | tab bar abajo + hoja "Menú" | columna de 480px |
 * | Escritorio (`≥ lg`) | sidebar fija a la izquierda | ancho real, hasta 1152px |
 *
 * Antes la columna de 480px era para TODOS los tamaños: la web se veía como un
 * teléfono estirado en el medio de un monitor. Servía cuando la app era solo
 * evaluaciones desde el celular, pero un ERP con módulos de tablas y formularios
 * necesita el ancho. En el celular no cambió nada, así que **el APK se ve igual
 * que antes** (su WebView nunca llega a `lg`).
 *
 * También hace de **guarda de sesión** para todo lo que envuelve: sin sesión, al
 * login. Es el único lugar por donde pasan las pantallas protegidas, así que la
 * guarda vive acá y no repetida en cada ruta.
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
        <main className="mx-auto w-full max-w-[480px] flex-1 pb-28 sm:border-x sm:border-border/60 lg:mx-0 lg:max-w-none lg:border-x-0 lg:pb-10">
          {/*
            En escritorio esto solo ENSANCHA y centra: no pone padding lateral
            propio, a propósito. El `px-5` que cada pantalla ya trae sigue siendo
            el único responsable del margen, así que no hay que tocar las seis
            páginas existentes ni se duplica el aire a los costados.
          */}
          <div className="lg:mx-auto lg:max-w-6xl lg:pt-2">{children}</div>
        </main>

        {nav ? <BottomNav /> : null}
      </div>
    </div>
  );
}
