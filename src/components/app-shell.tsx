import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { useSession } from "@/lib/session";

/**
 * Marco de las pantallas con sesión: cabecera arriba, tab bar abajo y el
 * contenido en una sola columna.
 *
 * La app se usa desde el celular, así que en pantallas grandes no estiramos el
 * contenido: lo dejamos en una columna del ancho de un teléfono con bordes a los
 * lados. Así se ve igual en los dos sitios y no hay que diseñar dos veces.
 *
 * También hace de **guarda de sesión** para todo lo que envuelve (home,
 * evaluaciones, cuenta): sin sesión, al login. Es el único lugar por donde pasan
 * las cinco pantallas, así que la guarda vive acá y no repetida en cada ruta.
 */
export function AppShell({
  children,
  /**
   * Las pantallas de formulario lo ponen en false: tienen su propio footer fijo
   * con el botón de guardar y dos barras apiladas abajo no se entienden.
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
    <div className="min-h-dvh bg-muted/40">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background sm:border-x sm:border-border/60">
        <AppHeader />
        {/* pb-28: hueco para que la barra fija no tape el final del contenido */}
        <main className="flex-1 pb-28">{children}</main>
        {nav ? <BottomNav /> : null}
      </div>
    </div>
  );
}
