import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fingerprint, Loader2, LogOut, Mail, Moon, Smartphone, Sun } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  activada as biometriaActivada,
  desactivar as desactivarBiometria,
  disponible,
  enApp,
  explicar,
  guardarCredencial,
  type MotivoNoDisponible,
} from "@/lib/biometria";
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

/**
 * Switch del acceso biométrico. **Solo se pinta dentro del APK** — en la web y en
 * la PWA `enApp()` es false y este componente devuelve `null`, porque sin Keystore
 * guardar la contraseña sería `localStorage` en texto plano. Ver `lib/biometria.ts`.
 *
 * Activarlo pide la contraseña de nuevo, y no es burocracia: la contraseña **no
 * está en memoria** (el login no la retiene, ver `lib/api.ts`), así que no hay de
 * dónde sacarla. Que el usuario la reescriba es además lo que impide que alguien
 * con el celular desbloqueado en la mano ate su propia huella a la cuenta ajena.
 */
function AccesoBiometrico({ usuario }: { usuario: string }) {
  const [visible, setVisible] = useState(false);
  const [motivo, setMotivo] = useState<MotivoNoDisponible | null>(null);
  const [activa, setActiva] = useState(false);
  const [pidiendoPass, setPidiendoPass] = useState(false);
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  // En SSR/prerender no hay `window`: la comprobación va en un efecto para que el
  // HTML del servidor y el del cliente coincidan y no se rompa la hidratación.
  useEffect(() => {
    if (!enApp()) return; // web y PWA: no se ofrece
    setVisible(true);
    setActiva(biometriaActivada());
    void disponible().then((d) => setMotivo(d.ok ? null : d.motivo));
  }, []);

  const activar = useCallback(async () => {
    if (!password) return;
    setGuardando(true);
    try {
      // Android muestra su propio prompt acá: es el que autoriza crear la clave
      // protegida en el Keystore.
      await guardarCredencial(usuario, password);
      setActiva(true);
      setPidiendoPass(false);
      setPassword("");
      toast.success("Acceso con huella activado");
    } catch {
      // Cancelar el prompt entra por acá. No se marca como activo: el switch
      // tiene que reflejar lo que de verdad quedó guardado.
      toast.error("No se pudo activar", {
        description: "No se guardó nada. Probá de nuevo.",
      });
    } finally {
      setGuardando(false);
    }
  }, [password, usuario]);

  const alCambiar = useCallback(async (v: boolean) => {
    if (v) {
      setPidiendoPass(true); // hay que reescribir la contraseña
      return;
    }
    await desactivarBiometria();
    setActiva(false);
    toast.success("Acceso con huella desactivado");
  }, []);

  if (!visible) return null;

  return (
    <Group label="Seguridad">
      <div className="flex items-center gap-3.5 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Fingerprint className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Entrar con huella</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            {/*
              El motivo concreto, no un "no disponible" genérico: "poné un PIN" y
              "registrá una huella" se ven idénticos desde afuera y son la causa
              más común de que esto parezca roto. Ver APK.md.
            */}
            {motivo
              ? explicar(motivo)
              : activa
                ? "Tu contraseña queda guardada cifrada en este dispositivo."
                : "Entrá sin escribir la contraseña cada vez."}
          </p>
        </div>
        <Switch
          checked={activa}
          disabled={motivo !== null}
          onCheckedChange={(v) => void alCambiar(v)}
          aria-label="Entrar con huella"
        />
      </div>

      <Dialog
        open={pidiendoPass}
        onOpenChange={(o) => {
          setPidiendoPass(o);
          if (!o) setPassword(""); // no dejar la contraseña colgada en memoria
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmá tu contraseña</DialogTitle>
            <DialogDescription>
              Se guarda cifrada en este dispositivo, protegida por tu huella. Solo se usa para
              iniciar sesión acá.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void activar();
            }}
            className="space-y-4"
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              // text-base = 16px: con menos, iOS hace zoom al enfocar.
              className="h-12 rounded-xl text-base"
              autoFocus
            />
            <Button
              type="submit"
              disabled={!password || guardando}
              className="tap h-12 w-full rounded-xl text-base"
            >
              {guardando ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {guardando ? "Guardando..." : "Activar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Group>
  );
}

function AccountPage() {
  const { theme, setTheme } = useTheme();
  const { sesion, user, logout } = useSession();
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

        {/* Solo se pinta dentro del APK; en la web devuelve null. El usuario sale
            de la sesión viva: es el dueño de la contraseña que se va a guardar. */}
        <AccesoBiometrico usuario={sesion?.usuario ?? ""} />

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
