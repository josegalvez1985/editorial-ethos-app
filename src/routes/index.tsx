import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, Fingerprint, Loader2, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
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
  const { user, login, biometry } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/home" });
  }, [user, navigate]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Ingresa tu correo y contraseña");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      login(email);
      toast.success("Bienvenido a Editorial Ethos");
      navigate({ to: "/home" });
    }, 700);
  };

  const onBiometric = () => {
    if (!biometry) {
      toast.info("Activa la biometría en tu cuenta primero");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      login("lector@ethos.mx");
      toast.success("Acceso biométrico verificado");
      navigate({ to: "/home" });
    }, 800);
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-hero-gradient lg:block">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary-foreground/15 backdrop-blur">
              <BookOpen className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold">Editorial Ethos</span>
          </div>
          <div>
            <p className="font-display text-5xl leading-tight font-bold">
              Ideas con
              <br /> carácter.
            </p>
            <p className="mt-4 max-w-md text-sm text-primary-foreground/80">
              Reportajes, ensayos y voces cuidadosamente editadas. Una publicación
              hecha para lectores que buscan más.
            </p>
          </div>
          <p className="text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} Editorial Ethos
          </p>
        </div>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-bold">Editorial Ethos</span>
          </div>

          <h1 className="font-display text-3xl font-bold text-foreground">Bienvenido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicia sesión para continuar leyendo.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@ethos.mx"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <button type="button" className="text-xs text-primary hover:underline">
                  ¿Olvidaste tu clave?
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="px-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Mostrar contraseña"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-2 text-xs text-muted-foreground">o</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={onBiometric}
              className="w-full"
              disabled={loading}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              Acceder con biometría
            </Button>

            <p className="pt-4 text-center text-sm text-muted-foreground">
              ¿Sin cuenta?{" "}
              <Link to="/home" className="font-medium text-primary hover:underline">
                Explorar como invitado
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
