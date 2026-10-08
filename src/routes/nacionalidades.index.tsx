import { createFileRoute } from "@tanstack/react-router";
import { Flag } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiNacionalidades } from "@/lib/nacionalidades";

export const Route = createFileRoute("/nacionalidades/")({
  head: () => ({
    meta: [
      { title: "Nacionalidades — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de nacionalidades." },
    ],
  }),
  component: NacionalidadesPage,
});

/**
 * Nacionalidades: la página 12 de APEX (un IG sobre `NACIONALIDADES`) y su
 * modal 13 (Crear Nacionalidad), que acá es el diálogo de la pantalla con los
 * permisos de la 12.
 *
 * El backend es suyo, `backend/nacionalidades.sql` (con `lib/nacionalidades.ts`);
 * la pantalla es la de cualquier tabla de un nombre, `<CatalogoNombre>`. El
 * ícono es el que ya tenía en el menú (`Flag`): no se cambia.
 */
function NacionalidadesPage() {
  return (
    <CatalogoNombre
      api={apiNacionalidades}
      ruta="/nacionalidades"
      icon={Flag}
      textos={{
        titulo: "Nacionalidades",
        descripcion: "El catálogo de nacionalidades del sistema.",
        singular: "nacionalidad",
        plural: "nacionalidades",
        ejemplo: "Paraguaya",
        femenino: true,
      }}
    />
  );
}
