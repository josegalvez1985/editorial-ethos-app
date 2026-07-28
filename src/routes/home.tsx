import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bookmark, Clock, Flame, Sparkles, TrendingUp } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Inicio — Editorial Ethos" },
      { name: "description", content: "Lo mejor de Editorial Ethos: reportajes, cultura, opinión." },
      { property: "og:title", content: "Inicio — Editorial Ethos" },
      { property: "og:description", content: "Reportajes, cultura y opinión con carácter." },
    ],
  }),
  component: HomePage,
});

const categories = [
  { label: "Todo", icon: Sparkles, active: true },
  { label: "Tendencia", icon: TrendingUp },
  { label: "Popular", icon: Flame },
  { label: "Guardados", icon: Bookmark },
];

const featured = {
  tag: "Reportaje",
  title: "El nuevo pulso de las ciudades intermedias",
  excerpt:
    "Un recorrido por seis ciudades que redefinen la vida cultural fuera de las capitales — y por qué eso importa hoy más que nunca.",
  author: "María Salazar",
  time: "12 min",
};

const articles = [
  {
    tag: "Cultura",
    title: "Regreso al ensayo: la voz que interrumpe el ruido",
    excerpt: "Escritores jóvenes reivindican la forma más incómoda y necesaria.",
    author: "Andrés Ríos",
    time: "8 min",
  },
  {
    tag: "Opinión",
    title: "La política del cuidado en tiempos frenéticos",
    excerpt: "Notas para una ética del sostenimiento colectivo.",
    author: "Luisa Vega",
    time: "6 min",
  },
  {
    tag: "Tecnología",
    title: "Interfaces que respetan tu atención",
    excerpt: "Diseñadores proponen una calma deliberada frente al scroll infinito.",
    author: "Iván Ferrer",
    time: "10 min",
  },
  {
    tag: "Perfil",
    title: "La editora que reinventó el ritmo de una redacción",
    excerpt: "Cómo un equipo pequeño produce lecturas de gran aliento.",
    author: "Camila Ordóñez",
    time: "9 min",
  },
];

function HomePage() {
  const { user } = useSession();
  const greeting = user?.name ?? "Lector";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Greeting */}
        <section className="mb-8">
          <p className="text-sm text-muted-foreground">Hola, {greeting}</p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">
            La lectura de hoy
          </h1>
        </section>

        {/* Category pills */}
        <div className="mb-8 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                c.active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <c.icon className="h-3.5 w-3.5" />
              {c.label}
            </button>
          ))}
        </div>

        {/* Featured hero */}
        <Card className="mb-10 overflow-hidden border-none bg-hero-gradient text-primary-foreground shadow-elegant">
          <div className="grid grid-cols-1 gap-6 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <Badge className="mb-4 border-none bg-primary-foreground/15 text-primary-foreground backdrop-blur">
                {featured.tag}
              </Badge>
              <h2 className="font-display text-3xl leading-tight font-bold sm:text-5xl">
                {featured.title}
              </h2>
              <p className="mt-4 max-w-xl text-sm text-primary-foreground/85 sm:text-base">
                {featured.excerpt}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-primary-foreground/75">
                <span>Por {featured.author}</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {featured.time}
                </span>
              </div>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 bg-primary-foreground text-primary hover:bg-primary-foreground/90"
            >
              Leer ahora <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </Card>

        {/* Articles grid */}
        <section>
          <div className="mb-4 flex items-end justify-between">
            <h3 className="font-display text-2xl font-bold">Últimas piezas</h3>
            <Link to="/home" className="text-sm font-medium text-primary hover:underline">
              Ver todas
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2">
            {articles.map((a) => (
              <Card
                key={a.title}
                className="group cursor-pointer border border-border/70 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elegant"
              >
                <CardHeader className="pb-3">
                  <Badge
                    variant="outline"
                    className="w-fit border-primary/30 text-primary"
                  >
                    {a.tag}
                  </Badge>
                  <CardTitle className="font-display text-xl leading-snug transition-colors group-hover:text-primary">
                    {a.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{a.excerpt}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Por {a.author}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {a.time}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
