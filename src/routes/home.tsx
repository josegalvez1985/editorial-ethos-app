import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Inicio — Editorial Ethos" },
      {
        name: "description",
        content: "Lo mejor de Editorial Ethos: reportajes, cultura, opinión.",
      },
      { property: "og:title", content: "Inicio — Editorial Ethos" },
      { property: "og:description", content: "Reportajes, cultura y opinión con carácter." },
    ],
  }),
  component: HomePage,
});

/**
 * Pantalla de inicio.
 *
 * Sin contenido todavía: el saludo y la fecha viven en `AppHeader` y el backend
 * aún no expone artículos. Lo que se agregue va dentro de `AppShell`.
 */
function HomePage() {
  return <AppShell />;
}
