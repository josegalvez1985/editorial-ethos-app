import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiMaterias } from "@/lib/materias";

export const Route = createFileRoute("/materias/")({
  head: () => ({
    meta: [
      { title: "Materias — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de materias." },
    ],
  }),
  component: MateriasPage,
});

/**
 * Materias: la página 17 de APEX (un IG sobre `MATERIAS`) y su modal 18
 * (Crear Materia), que acá es el diálogo de la pantalla con los permisos de
 * la 17.
 *
 * El backend es suyo, `backend/materias.sql` (con `lib/materias.ts`); la
 * pantalla es la de cualquier tabla de un nombre, `<CatalogoNombre>`. El
 * ícono es el que ya tenía en el menú (`BookOpen`): no se cambia.
 */
function MateriasPage() {
  return (
    <CatalogoNombre
      api={apiMaterias}
      ruta="/materias"
      icon={BookOpen}
      textos={{
        titulo: "Materias",
        descripcion: "Las materias que se eligen en pre-horarios y postulaciones.",
        singular: "materia",
        plural: "materias",
        ejemplo: "Matemática",
        femenino: true,
      }}
    />
  );
}
