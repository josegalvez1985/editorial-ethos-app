import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Fingerprint, Loader2, UserRound, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getCredenciales } from "@/lib/api";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Editorial Ethos" },
      { name: "description", content: "Accede a tu cuenta de Editorial Ethos." },
      { property: "og:title", content: "Iniciar sesión — Editorial Ethos" },
      { property: "og:description", content: "Accede a tu cuenta de Editorial Ethos." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { sesion, login } = useSession();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // `replace`: el login no debe quedar en el historial, si no el botón de atrás
  // de la cabecera rebota entre esta pantalla y /home.
  useEffect(() => {
    if (sesion) navigate({ to: "/home", replace: true });
  }, [sesion, navigate]);

  // Si llegó acá con credenciales guardadas es que el login automático falló
  // (contraseña cambiada, backend caído). Dejamos el usuario puesto para que solo
  // tenga que escribir la contraseña. En un efecto, no en el estado inicial: en
  // SSR no hay storage y el HTML del servidor no coincidiría con el del cliente.
  useEffect(() => {
    const c = getCredenciales();
    if (c) setUsuario((u) => u || c.usuario);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!usuario || !password) {
      setError("Ingresa tu usuario y contraseña");
      return;
    }
    setLoading(true);
    try {
      await login(usuario, password, recordar);
      toast.success("Bienvenido a Editorial Ethos");
      navigate({ to: "/home", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      // Sin este finally, un error deja el botón deshabilitado para siempre.
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background lg:grid lg:min-h-screen lg:grid-cols-2">
      {/*
        Un solo panel de marca para los dos tamaños: en el celular es una banda
        superior con las esquinas redondeadas; en escritorio, la columna completa.
      */}
      <aside className="relative overflow-hidden bg-hero-gradient px-6 pt-safe pb-9 lg:flex lg:flex-col lg:justify-between lg:rounded-none lg:p-12">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative z-10 flex items-center justify-between pt-8 text-primary-foreground lg:contents">
          <img
            src="/logo.png"
            alt="Editorial Ethos"
            className="size-16 rounded-2xl bg-white p-1.5 shadow-soft lg:size-20 lg:self-start lg:rounded-xl lg:p-2"
          />
          <p className="text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} Editorial Ethos
          </p>
        </div>
      </aside>

      {/* Form */}
      <main className="flex items-start justify-center bg-background px-6 pt-7 pb-safe lg:items-center lg:py-12">
        <div className="w-full max-w-sm pb-10">
          <h1 className="font-display text-[1.75rem] font-bold text-foreground lg:text-3xl">
            Bienvenido
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Inicia sesión</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="usuario">Usuario</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="usuario"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="tu usuario"
                  // text-base = 16px: con menos, iOS hace zoom al enfocar el campo.
                  className="h-12 rounded-xl pl-10 text-base"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 rounded-xl px-10 text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="tap absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                  aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="recordar"
                checked={recordar}
                onCheckedChange={(v) => setRecordar(v === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="recordar" className="text-sm font-normal">
                  Mantener sesión iniciada
                </Label>
                {/* Que el usuario sepa qué se guarda: la contraseña queda en este
                    dispositivo para poder entrar solo cuando el token expira. */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Guarda tu acceso en este dispositivo para entrar sin escribirlo.
                </p>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={loading}
              className="tap h-12 w-full rounded-xl text-base"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? "Iniciando..." : "Entrar"}
            </Button>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-2 text-xs text-muted-foreground">o</span>
              </div>
            </div>

            {/* La biometría real vive en la app de mobile/ (expo-local-authentication).
                En el navegador no hay equivalente sin WebAuthn, así que lo decimos
                en vez de simular un acceso. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => toast.info("El acceso biométrico está disponible en la app móvil")}
              className="tap h-12 w-full rounded-xl text-base"
              disabled={loading}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              Acceder con biometría
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
