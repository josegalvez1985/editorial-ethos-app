/**
 * El aviso de que se está trabajando sin conexión, y de lo que falta subir.
 *
 * ── POR QUÉ HACE FALTA ───────────────────────────────────────────────────────
 *
 * Sin esto la app se ve exactamente igual con red y sin red: muestra los datos
 * cacheados sin decir que son viejos, y el usuario no tiene forma de saber que
 * lo que carga quedó en el teléfono y todavía no llegó a Oracle. Es el punto 6
 * de PENDIENTES.md.
 *
 * ── DOS MENSAJES DISTINTOS ───────────────────────────────────────────────────
 *
 * 1. **Sin conexión**: la sesión se abrió sin validar contra el backend. Se
 *    puede ver lo cacheado y cargar evaluaciones nuevas, nada más.
 * 2. **Pendientes de subir**: hay evaluaciones en la cola. Aparece TAMBIÉN con
 *    red —mientras no se hayan subido— porque es justamente cuando el usuario
 *    tiene que saber que algo quedó a medias.
 *
 * Los dos pueden darse a la vez y se muestran juntos en un solo bloque, para no
 * apilar dos barras sobre el contenido.
 */

import { CloudOff, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

import { contarPendientes } from "@/lib/offline";
import { useSession } from "@/lib/session";

export function OfflineBanner() {
  const { offline } = useSession();

  /*
   * El conteo se lee de `localStorage`, que no es reactivo: hay que releerlo
   * cuando algo pudo haberlo cambiado. Los tres momentos que importan son
   * volver a la pestaña/app, recuperar la red, y el montaje inicial.
   *
   * Se arranca en 0 y no leyendo el storage para no romper la hidratación del
   * SSR: el servidor no tiene `localStorage` y pintaría un número distinto.
   */
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    const releer = () => setPendientes(contarPendientes());
    releer();

    const alVolver = () => {
      if (document.visibilityState === "visible") releer();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", releer);
    // `storage` avisa de cambios hechos en OTRA pestaña del mismo origen.
    window.addEventListener("storage", releer);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", releer);
      window.removeEventListener("storage", releer);
    };
  }, [offline]);

  if (!offline && pendientes === 0) return null;

  return (
    <div className="px-5 pt-3">
      <div className="rounded-xl border border-border/60 bg-muted/50 px-4 py-2.5">
        {offline && (
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <CloudOff className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">Sin conexión.</span> Estás viendo
              datos guardados en el teléfono. Podés cargar evaluaciones: se suben solas al volver la
              señal.
            </span>
          </p>
        )}

        {pendientes > 0 && (
          <p
            className={`flex items-start gap-2 text-[13px] text-muted-foreground ${
              offline ? "mt-2 border-t border-border/60 pt-2" : ""
            }`}
          >
            <UploadCloud className="mt-0.5 size-4 shrink-0" />
            <span>
              {pendientes === 1
                ? "1 evaluación esperando subirse."
                : `${pendientes} evaluaciones esperando subirse.`}{" "}
              Se envían al entrar con internet.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
