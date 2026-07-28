import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fingerprint, Moon, Sun, Monitor, LogOut, ShieldCheck, Mail, User as UserIcon } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/session";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Mi cuenta — Editorial Ethos" },
      { name: "description", content: "Configura biometría, tema y preferencias." },
      { property: "og:title", content: "Mi cuenta — Editorial Ethos" },
      { property: "og:description", content: "Configura biometría, tema y preferencias." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { theme, setTheme } = useTheme();
  const { user, biometry, setBiometry, logout } = useSession();
  const navigate = useNavigate();

  const displayName = user?.name ?? "Invitado";
  const displayEmail = user?.email ?? "invitado@ethos.mx";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onBiometry = (v: boolean) => {
    setBiometry(v);
    toast.success(v ? "Biometría activada" : "Biometría desactivada");
  };

  const onLogout = () => {
    logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/" });
  };

  const themeOptions = [
    { value: "light" as const, label: "Claro", icon: Sun },
    { value: "dark" as const, label: "Oscuro", icon: Moon },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <p className="text-sm text-muted-foreground">Configuración</p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Mi cuenta</h1>
        </div>

        {/* Profile card */}
        <Card className="mb-6 overflow-hidden border-none bg-hero-gradient text-primary-foreground shadow-elegant">
          <CardContent className="flex flex-wrap items-center gap-4 p-6">
            <Avatar className="h-16 w-16 border-2 border-primary-foreground/30 bg-primary-foreground/15 text-lg font-semibold text-primary-foreground">
              <AvatarFallback className="bg-transparent text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="font-display truncate text-2xl font-bold">{displayName}</h2>
              <p className="flex items-center gap-1.5 text-sm text-primary-foreground/80">
                <Mail className="h-3.5 w-3.5" />
                <span className="truncate">{displayEmail}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle className="font-display text-xl">Seguridad</CardTitle>
            </div>
            <CardDescription>Controla cómo accedes a tu cuenta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Fingerprint className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="bio" className="text-base font-semibold">
                    Acceso biométrico
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Usa tu huella o rostro para iniciar sesión más rápido.
                  </p>
                </div>
              </div>
              <Switch id="bio" checked={biometry} onCheckedChange={onBiometry} />
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="font-display text-xl">Apariencia</CardTitle>
            </div>
            <CardDescription>Elige cómo se ve Editorial Ethos.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {themeOptions.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                      active
                        ? "border-primary bg-primary-soft shadow-soft"
                        : "border-border hover:border-primary/40 hover:bg-muted"
                    }`}
                  >
                    <div
                      className={`grid h-9 w-9 place-items-center rounded-lg ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Tema {opt.label.toLowerCase()}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Account */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" />
              <CardTitle className="font-display text-xl">Cuenta</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full sm:w-auto" onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
