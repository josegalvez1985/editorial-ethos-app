import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

/**
 * Cabecera translúcida al estilo de una app nativa: atrás + logo + saludo + tema.
 *
 * La navegación vive en `BottomNav` (barra inferior), que también incluye el
 * acceso para cerrar sesión.
 */
export function AppHeader() {
  const { theme, toggle } = useTheme();
  const { user, ready } = useSession();
  const router = useRouter();
  // `canGoBack()` no es reactivo por sí solo: lo recalculamos con cada cambio
  // de ruta para que el botón aparezca/desaparezca al navegar.
  // En /home no se muestra: es la pantalla raíz de la sesión.
  const showBack = useRouterState({
    select: (s) => s.location.pathname !== "/home" && router.history.canGoBack(),
  });

  const fecha = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

  return (
    <header className="glass sticky top-0 z-40 border-b border-border/60 pt-safe">
      {/* h-16 + botones de 44px: el mínimo táctil de iOS/Android */}
      <div className="flex h-16 items-center gap-2.5 px-3">
        {showBack ? (
          <button
            type="button"
            onClick={() => router.history.back()}
            aria-label="Volver a la página anterior"
            className="tap grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-5" />
          </button>
        ) : null}

        <Link
          to="/home"
          aria-label="Editorial Ethos"
          className="tap shrink-0 rounded-xl bg-white p-1 shadow-soft"
        >
          <img src="/logo.png" alt="Editorial Ethos" className="size-8 rounded-lg" />
        </Link>

        {/* Mientras revalidamos el token no sabemos el nombre: barra en gris en vez
            de un salto de "Hola," a "Hola, Jose Galvez". */}
        {!ready ? (
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-32 animate-pulse rounded-full bg-muted" />
            <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted" />
          </div>
        ) : user ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight">
              Hola, <span className="font-semibold">{user.name}</span>
            </p>
            <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground">
              {fecha}
            </p>
          </div>
        ) : (
          <span className="flex-1" />
        )}

        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          className="tap grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-accent"
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </div>
    </header>
  );
}
