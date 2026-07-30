import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Download, Loader2, UserRound, Lock, Eye, EyeOff, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { asset } from "@/lib/asset";
import { useSession } from "@/lib/session";

/**
 * URL de descarga del APK, o `""` para no ofrecerlo.
 *
 * Vacía a propósito: el binario ya no se commitea (ver `*.apk` en .gitignore), así
 * que no hay archivo que servir desde el sitio y el link daría 404. Para volver a
 * ofrecerlo, poner acá la URL del GitHub Release —o de donde se aloje— y listo; el
 * ítem del login reaparece solo.
 */
const DESCARGA_APK_URL = "";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — Editorial Ethos" },
      { name: "description", content: "Accede a tu cuenta de Editorial Ethos." },
      // Sin og:* acá: esta ruta es la que siembra el _shell.html estático, así que
      // su Open Graph terminaba siendo el de TODO el sitio y compartir
      // www.ethospy.online mostraba "Iniciar sesión". Las tags viven en __root.
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { sesion, login } = useSession();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [enApp, setEnApp] = useState(false);

  // `replace`: el login no debe quedar en el historial, si no el botón de atrás
  // de la cabecera rebota entre esta pantalla y /home.
  useEffect(() => {
    if (sesion) navigate({ to: "/home", replace: true });
  }, [sesion, navigate]);

  // Adentro del APK no se ofrece descargar el APK: no tiene sentido y además
  // `scripts/build-apk.ps1` borra `app.apk` del bundle (si no, cada APK
  // empaquetaría al anterior adentro), así que el link daría 404.
  // `window.Capacitor` lo inyecta el puente nativo y solo existe en la WebView.
  // En un efecto y no en el estado inicial: en SSR/prerender no hay `window` y
  // el HTML del servidor no coincidiría con el del cliente.
  useEffect(() => {
    setEnApp(Boolean((window as unknown as { Capacitor?: unknown }).Capacitor));
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
      await login(usuario, password);
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
            src={asset("logo.png")}
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

            {/* Acá vivían "Mantener sesión iniciada" y el botón de biometría. Se
                sacaron: la sesión ya no se guarda en el disco y hay que escribir
                usuario y contraseña en cada arranque. Ver lib/api.ts. */}
          </form>

          {/*
            La descarga del APK está APAGADA a propósito.

            El binario ya no viaja en el repo (`*.apk` en .gitignore): son ~4 MB por
            build y git guarda cada versión para siempre. Como el sitio servía el
            archivo desde `public/`, sacarlo del repo dejaba este link en un 404.

            El APK se reparte a mano. Para volver a ofrecerlo desde acá hay que
            darle una URL estable —un GitHub Release es lo natural— y poner esa URL
            en el `href`. Ver APK.md y DESPLIEGUE.md.

            `enApp` distingue la web de la WebView del APK: adentro del propio APK
            este ítem nunca se mostró, para que cada APK no empaquete al anterior.
          */}
          {DESCARGA_APK_URL && !enApp && (
            <a
              href={DESCARGA_APK_URL}
              download="editorial-ethos.apk"
              className="tap mt-6 flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft hover:bg-accent"
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Smartphone className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">Descargar app para Android</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                  Instala el APK y entra desde el celular sin pasar por el navegador.
                </p>
              </div>
              <Download className="size-5 shrink-0 text-muted-foreground" />
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
