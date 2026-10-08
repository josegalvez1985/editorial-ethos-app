import { createFileRoute } from "@tanstack/react-router";
import { Globe } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiPaises } from "@/lib/paises";

export const Route = createFileRoute("/paises/")({
  head: () => ({
    meta: [
      { title: "Países — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de países." },
    ],
  }),
  component: PaisesPage,
});

/**
 * Países: la página 4 de APEX (un IG sobre `PAISES`) y su modal 5 (Crear
 * País), que acá es el diálogo de la pantalla con los permisos de la 4.
 *
 * El backend es suyo, `backend/paises.sql` (con `lib/paises.ts`); la pantalla
 * es la de cualquier tabla de un nombre, `<CatalogoNombre>`.
 */
function PaisesPage() {
  return (
    <CatalogoNombre
      api={apiPaises}
      ruta="/paises"
      icon={Globe}
      textos={{
        titulo: "Países",
        descripcion: "El catálogo de países del sistema.",
        singular: "país",
        plural: "países",
        ejemplo: "Paraguay",
      }}
    />
  );
}
