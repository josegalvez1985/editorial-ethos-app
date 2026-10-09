import { createFileRoute } from "@tanstack/react-router";
import { Highlighter } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiEnfasis } from "@/lib/enfasis";

export const Route = createFileRoute("/enfasis/")({
  head: () => ({
    meta: [
      { title: "Énfasis — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de énfasis." },
    ],
  }),
  component: EnfasisPage,
});

/**
 * Énfasis: la página 26 de APEX (un IG sobre `ENFASIS`) y su modal 27 (Crear
 * Énfasis), que acá es el diálogo de la pantalla con los permisos de la 26.
 *
 * El backend es suyo, `backend/enfasis.sql` (con `lib/enfasis.ts`); la
 * pantalla es la de cualquier tabla de un nombre, `<CatalogoNombre>`. La
 * descripción llega a 500 caracteres (la de Materias, a 200). El ícono es el
 * que ya tenía en el menú (`Highlighter`): no se cambia.
 */
function EnfasisPage() {
  return (
    <CatalogoNombre
      api={apiEnfasis}
      ruta="/enfasis"
      icon={Highlighter}
      textos={{
        titulo: "Énfasis",
        descripcion: "Los énfasis que se eligen en los pre-horarios.",
        singular: "énfasis",
        plural: "énfasis",
        ejemplo: "Ciencias Sociales",
      }}
    />
  );
}
