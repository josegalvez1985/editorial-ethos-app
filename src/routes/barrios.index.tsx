import { createFileRoute } from "@tanstack/react-router";
import { Signpost } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiBarrios } from "@/lib/barrios";
import { apiCiudades } from "@/lib/ciudades";

export const Route = createFileRoute("/barrios/")({
  head: () => ({
    meta: [
      { title: "Barrios — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de barrios." },
    ],
  }),
  component: BarriosPage,
});

/**
 * Barrios: la página 10 de APEX (un IG sobre `BARRIOS`) y su modal 11 (Crear
 * Barrio), que acá es el diálogo de la pantalla con los permisos de la 10.
 *
 * El backend es suyo, `backend/barrios.sql` (con `lib/barrios.ts`); la
 * pantalla es `<CatalogoNombre>` con la ciudad como `padre`: filtro y grupos
 * por ciudad. Departamento y país no se eligen: salen de la ciudad.
 *
 * El ícono es el que ya tenía en el menú (`Signpost`): no se cambia.
 */
function BarriosPage() {
  return (
    <CatalogoNombre
      api={apiBarrios}
      ruta="/barrios"
      icon={Signpost}
      padre={{ etiqueta: "Ciudad", plural: "ciudades", api: apiCiudades }}
      textos={{
        titulo: "Barrios",
        descripcion: "Los barrios de cada ciudad. Departamento y país salen de la ciudad.",
        singular: "barrio",
        plural: "barrios",
        ejemplo: "San Vicente",
      }}
    />
  );
}
