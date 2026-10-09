import { createFileRoute } from "@tanstack/react-router";
import { Shapes } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiAreasEvaluacion } from "@/lib/areas-evaluacion";

export const Route = createFileRoute("/areas-evaluacion/")({
  head: () => ({
    meta: [
      { title: "Áreas de Evaluación — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de áreas de evaluación." },
    ],
  }),
  component: AreasEvaluacionPage,
});

/**
 * Áreas de Evaluación: la página 81 de APEX (un IG sobre `AREAS_EVALUACIONES`)
 * y su modal 82 (Crear Area), que acá es el diálogo de la pantalla con los
 * permisos de la 81.
 *
 * El backend es suyo, `backend/areas_evaluaciones.sql` (con
 * `lib/areas-evaluacion.ts`); la pantalla es la de cualquier tabla de un
 * nombre, `<CatalogoNombre>`. El ícono es el que ya tenía en el menú
 * (`Shapes`): no se cambia.
 */
function AreasEvaluacionPage() {
  return (
    <CatalogoNombre
      api={apiAreasEvaluacion}
      ruta="/areas-evaluacion"
      icon={Shapes}
      textos={{
        titulo: "Áreas de Evaluación",
        descripcion: "Las áreas en que se agrupan los ítems de la evaluación de facilitadores.",
        singular: "área",
        plural: "áreas",
        ejemplo: "Puntualidad",
        femenino: true,
      }}
    />
  );
}
