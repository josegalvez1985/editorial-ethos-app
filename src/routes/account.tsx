import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Mail, Moon, Smartphone, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Mi cuenta — Editorial Ethos" },
      { name: "description", content: "Configura el tema y tus preferencias." },
    ],
  }),
  component: AccountPage,
});

/** Bloque de ajustes al estilo de la app de Ajustes: título chico + tarjeta con filas. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon,
  title,
  hint,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {hint ? (
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

function AccountPage() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useSession();
  const navigate = useNavigate();

  const displayName = user?.name ?? "Invitado";
  const displayEmail = user?.email ?? "invitado@ethos.mx";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onLogout = async () => {
    await logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/", replace: true });
  };

  const themeOptions = [
    { value: "light" as const, label: "Claro", icon: Sun },
    { value: "dark" as const, label: "Oscuro", icon: Moon },
  ];

  return (
    <AppShell>
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Configuración
        </p>
        <h1 className="font-display mt-1 text-[2rem] leading-none font-bold">Mi cuenta</h1>

        {/* Perfil */}
        <div className="relative mt-5 overflow-hidden rounded-3xl bg-hero-gradient p-5 text-primary-foreground shadow-elegant">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:20px_20px]" />
          <div className="relative flex items-center gap-4">
            <div className="grid size-15 shrink-0 place-items-center rounded-full border-2 border-white/30 bg-white/15 text-lg font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display truncate text-[1.35rem] leading-tight font-bold">
                {displayName}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-primary-foreground/80">
                <Mail className="size-3.5 shrink-0" />
                <span className="truncate">{displayEmail}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Acá estaba el grupo "Seguridad" con el switch de acceso biométrico. Se
            quitó junto con la sesión persistente: sin contraseña guardada no hay
            nada que la huella pueda recuperar. Ver lib/api.ts. */}

        <Group label="Apariencia">
          <div className="p-4">
            <p className="text-[15px] font-semibold">Tema</p>
            {/* Control segmentado: la opción activa se desliza sobre el riel */}
            <div
              role="radiogroup"
              aria-label="Tema"
              className="mt-3 flex gap-1 rounded-full bg-muted p-1"
            >
              {themeOptions.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(opt.value)}
                    className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all duration-200 ease-out ${
                      active
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Row
            icon={<Smartphone className="size-5" />}
            title="App instalable"
            hint="Agrega Ethos a tu pantalla de inicio desde el menú del navegador."
          />
        </Group>

        <Group label="Cuenta">
          <button
            type="button"
            onClick={onLogout}
            className="tap flex w-full items-center gap-3.5 p-4 text-left hover:bg-accent"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <LogOut className="size-5" />
            </div>
            <p className="flex-1 text-[15px] font-semibold text-destructive">Cerrar sesión</p>
          </button>
        </Group>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Editorial Ethos · versión web
        </p>
      </div>
    </AppShell>
  );
}
