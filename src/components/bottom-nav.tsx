import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, LogOut, User, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";

const items = [
  { to: "/home", label: "Inicio", icon: Home },
  { to: "/account", label: "Cuenta", icon: User },
] as const;

/**
 * Barra de navegación inferior, al estilo de una app móvil.
 * Es el equivalente web de las tabs de `mobile/app/(tabs)/_layout.tsx`.
 *
 * Va en las páginas con sesión (home y cuenta), no en el login.
 * El hueco de abajo lo pone `AppShell` (`pb-28`).
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { logout } = useSession();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/", replace: true });
  };

  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border/60 pb-safe select-none-touch">
      <div className="mx-auto flex max-w-[480px] items-stretch px-2">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={pathname === item.to ? "page" : undefined}
            className="flex-1"
          >
            <TabContent icon={item.icon} label={item.label} active={pathname === item.to} />
          </Link>
        ))}

        <button type="button" onClick={onLogout} className="flex-1">
          <TabContent icon={LogOut} label="Salir" active={false} danger />
        </button>
      </div>
    </nav>
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
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  danger?: boolean;
}): ReactNode {
  return (
    <span
      className={`tap flex flex-col items-center gap-1 py-2 ${
        active ? "text-primary" : "text-muted-foreground"
      } ${danger ? "hover:text-destructive" : "hover:text-foreground"}`}
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
