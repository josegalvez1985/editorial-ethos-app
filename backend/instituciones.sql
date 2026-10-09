--------------------------------------------------------------------------------
-- INSTITUCIONES  —  ABM de instituciones con su ficha (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a estas paginas de APEX, todas con los permisos de la
-- 16 (los modales NO son paginas en el sitio):
--
--   16  Instituciones         el listado                     /instituciones
--   21  Crear Institucion     la ficha (pestana Datos)       /instituciones/:id
--   35  Crear Director        alta de director   } pestana Autoridades: ver
--   46  Crear Coordinador     alta de coordinador} directores.sql y
--                                                  coordinadores.sql
--   33  Horarios              horario IE: pestana Horario (horario_instituciones.sql)
--
-- Las autoridades (INSTITUCIONES_DIRECTORES, INSTITUCIONES_COORDNADORES) y el
-- horario (HORARIO_INSTITUCIONES) tienen su propio script, uno por tabla: ver
-- instituciones_directores.sql, instituciones_coordinadores.sql y
-- horario_instituciones.sql. Los pre-horarios (43) y las postulaciones (38 y
-- 60) son la fase 2 y 3: todavia no estan en el sitio.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     instituciones                  el listado, con como va el anio
--                                          (autoridades, horario, pre-horarios
--                                          y postulaciones del anio lectivo)
--   GET     instituciones/opciones         los estados (lista ACTIVO_INACTIVO)
--                                          y el anio lectivo actual
--   GET     instituciones/:id              la ficha, con en que tablas se usa
--   POST    instituciones                  {nombre, estado, id_ciudad, id_barrio,
--                                           direccion, ubicacion, zona,
--                                           comentario, id_facilitador}
--                                          -> {id_institucion}
--   PUT     instituciones/:id              lo mismo
--   DELETE  instituciones/:id              solo si nada la usa (ver abajo)
--   POST    instituciones/:id/facilitador  el boton "Actualizar Facilitador" de
--                                          la 21: ver abajo
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql (permisos) y anios_lectivos.sql
-- (FN_ANIO_LECTIVO_ACTUAL). La pantalla lee tambien GET ciudades, barrios y
-- facilitadores: conviene tener corridos ciudades.sql, barrios.sql y
-- facilitadores.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- UBICACION: SE ELIGE LA CIUDAD (Y EL BARRIO); EL RESTO SALE DE AHI
--------------------------------------------------------------------------------
--
-- En APEX se elegian departamento y ciudad (obligatorios) y barrio, sueltos.
-- Aca se elige la ciudad y, si se quiere, un barrio DE ESA CIUDAD, como en
-- facilitadores.sql. Pero OJO, distinto de facilitadores: INSTITUCIONES tiene
-- FK COMPUESTAS (verificado el 09/10/2026):
--
--   INSTITUCIONES_FK_BARRIOS        (ID_PAIS, ID_DEPARTAMENTO, ID_CIUDAD, ID_BARRIO)
--   INSTITUCIONES_FK_CIUDADES       (ID_PAIS, ID_DEPARTAMENTO, ID_CIUDAD)
--   INSTITUCIONES_FK_DEPARTAMENTOS  (ID_PAIS, ID_DEPARTAMENTO)
--
-- Por eso pais y departamento se copian DE LA FILA del barrio (si hay barrio)
-- o de la ciudad: asi esas FK se cumplen siempre. Si la ciudad o el barrio
-- tienen datos viejos desalineados (pais de la ciudad distinto del de su
-- departamento), no hay combinacion que cumpla las tres: la base responde
-- ORA-02291 y se avisa que hay que corregir la ciudad o el barrio (las
-- verificaciones de ciudades.sql y barrios.sql imprimen el UPDATE).
--
--------------------------------------------------------------------------------
-- EL ESTADO ARRASTRA A LAS AUTORIDADES
--------------------------------------------------------------------------------
--
-- TRG_UPD_ESTADO_INSTITUCIONES (ya estaba; no se toca): al cambiar el ESTADO de
-- una institucion, pone ese mismo ESTADO a TODAS sus filas de
-- INSTITUCIONES_DIRECTORES e INSTITUCIONES_COORDNADORES. Inactivarla las
-- inactiva; reactivarla las reactiva a todas, tambien las de periodos viejos.
-- `guardar` cuenta cuantas cambia y lo devuelve (autoridades_cambiadas) para
-- que la pantalla lo diga. El trigger compara con !=, asi que si el estado
-- anterior era NULL no hace nada: el conteo tampoco lo cuenta.
--
-- ESTADO es VARCHAR2(1) con la lista ACTIVO_INACTIVO. Activa = 'A' o NULL: hay
-- filas sin estado y para el negocio cuentan como activas (mismo criterio que
-- evaluaciones_facilitadores.sql).
--
--------------------------------------------------------------------------------
-- BORRAR: SU FICHA SE VA CON ELLA, LO DEMAS LA BLOQUEA
--------------------------------------------------------------------------------
--
-- Sus autoridades y su horario son parte de la ficha: se borran con ella, como
-- las listas de un facilitador. Cualquier otra tabla con FK a INSTITUCIONES
-- (pre-horarios, postulaciones, evaluaciones, intervenciones...) la bloquea:
-- la pantalla ya lo sabe por los `usos` de la ficha y no ofrece el boton.
--
--------------------------------------------------------------------------------
-- "ACTUALIZAR FACILITADOR" (POST instituciones/:id/facilitador)
--------------------------------------------------------------------------------
--
-- Es el proceso "Actualizar" de la pagina 21, igual:
--
--   UPDATE pre_horarios SET id_facilitador = <el de la institucion>
--    WHERE id_institucion = :id AND id_facilitador IS NULL
--      AND anio = FN_ANIO_LECTIVO_ACTUAL()
--
-- Usa el facilitador GUARDADO de la institucion (la pantalla pide guardar
-- antes si se lo cambio). TRG_POSTULACIONES, el trigger de PRE_HORARIOS, borra
-- y vuelve a crear la postulacion de cada pre-horario confirmado que se toca:
-- es lo que ya pasaba en APEX. La ficha devuelve cuantos se van a tocar
-- (pre_sin_facilitador) para que la pantalla lo diga antes de confirmar.
--
--------------------------------------------------------------------------------
-- PERMISOS, ID
--------------------------------------------------------------------------------
--
--   - GET pide solo sesion. POST/PUT/DELETE piden insertar/actualizar/borrar
--     en la pagina de /instituciones (la 16); "Actualizar facilitador" pide
--     actualizar.
--   - ID_INSTITUCION es identity (verificado el 09/10/2026).
--   - AUDITORIA_INSTITUCIONES (la bitacora) no asigna :NEW en un DELETE: no se
--     toca.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'PACKAGE BODY' AS tipo,
                   'backend/auth.sql' AS script FROM dual
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'PACKAGE BODY',
                   'backend/roles_paginas.sql' FROM dual
            UNION ALL SELECT 'FN_ANIO_LECTIVO_ACTUAL', 'FUNCTION',
                   'backend/anios_lectivos.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = o.tipo;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  FOR t IN (SELECT 'INSTITUCIONES' AS tabla FROM dual
            UNION ALL SELECT 'INSTITUCIONES_DIRECTORES' FROM dual
            UNION ALL SELECT 'INSTITUCIONES_COORDNADORES' FROM dual
            UNION ALL SELECT 'HORARIO_INSTITUCIONES' FROM dual
            UNION ALL SELECT 'PRE_HORARIOS' FROM dual
            UNION ALL SELECT 'POSTULACIONES' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.tabla;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.tabla || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.tabla || ' encontrada.');
    END IF;
  END LOOP;

  FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
              WHERE table_name = 'INSTITUCIONES' ORDER BY trigger_name) LOOP
    DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
  END LOOP;

  -- Lo que bloquea un borrado (todo menos la ficha y las bitacoras).
  FOR f IN (SELECT DISTINCT c.table_name
              FROM user_constraints c
             WHERE c.constraint_type = 'R'
               AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                            WHERE table_name = 'INSTITUCIONES'
                                              AND constraint_type IN ('P', 'U'))
               AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
               AND c.table_name NOT IN ('INSTITUCIONES_DIRECTORES',
                                        'INSTITUCIONES_COORDNADORES',
                                        'HORARIO_INSTITUCIONES')
             ORDER BY c.table_name) LOOP
    DBMS_OUTPUT.PUT_LINE('       la usa ' || f.table_name || ' (bloquea el borrado)');
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INSTITUCIONES_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  PROCEDURE ficha(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion. Ver UBICACION en el encabezado.
  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_nombre         IN VARCHAR2,
    p_estado         IN VARCHAR2,
    p_id_ciudad      IN VARCHAR2,
    p_id_barrio      IN VARCHAR2,
    p_direccion      IN VARCHAR2,
    p_ubicacion      IN VARCHAR2,
    p_zona           IN VARCHAR2,
    p_comentario     IN VARCHAR2,
    p_id_facilitador IN VARCHAR2);

  -- Baja, con sus autoridades y su horario. 409 si algo mas la usa.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- "Actualizar facilitador" de la pagina 21 (ver el encabezado).
  PROCEDURE asignar_facilitador(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_INSTITUCIONES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INSTITUCIONES_ETHOS AS

  c_ruta      CONSTANT VARCHAR2(20) := '/instituciones';
  c_app_id    CONSTANT NUMBER       := 40587;
  c_workspace CONSTANT VARCHAR2(64) := 'FUNDCARAC';

  TYPE t_cuentas IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
  TYPE t_hija IS RECORD (tabla VARCHAR2(128), cuentas t_cuentas);
  TYPE t_hijas IS TABLE OF t_hija INDEX BY PLS_INTEGER;

  PROCEDURE abrir_json IS
  BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Cache-Control: no-store');
    HTP.P('Access-Control-Allow-Origin: *');
    OWA_UTIL.HTTP_HEADER_CLOSE;
  END abrir_json;

  -- SOLO antes de haber abierto la respuesta: emite headers.
  PROCEDURE p_error(p_status IN NUMBER, p_titulo IN VARCHAR2, p_detalle IN VARCHAR2) IS
  BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_titulo, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  END p_error;

  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request',
                'La ciudad, el barrio o el facilitador elegido no existe, o la ciudad o el '
                || 'barrio tienen pais y departamento desalineados: corregilos en su pantalla');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan esta institucion');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
      WHEN SQLCODE = -20001 THEN
        -- RAISE_APPLICATION_ERROR de TRG_POSTULACIONES (PRE_HORARIOS).
        p_error(409, 'Conflict', 'No se pudieron regenerar las postulaciones: ' || SQLERRM);
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'Un trigger de bitacora asigna :NEW en un DELETE (ORA-04084). Hay que '
                || 'corregirlo, como SUCURSALES_JNTRG en sucursales.sql.');
      ELSE
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
    END CASE;
  END p_error_oracle;

  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  PROCEDURE fijar_workspace IS
  BEGIN
    APEX_UTIL.SET_SECURITY_GROUP_ID(
      p_security_group_id => APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => c_workspace));
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END fijar_workspace;

  -- Entero positivo, o NULL.
  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_numero;

  -- El anio lectivo activo como texto (ANIO es VARCHAR2 en las tablas), o NULL.
  FUNCTION f_anio RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_anio;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' piden la accion en la
  -- pagina de /instituciones. FALSE = ya respondio el error.
  ------------------------------------------------------------------------------
  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
    l_pagina  NUMBER;
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    IF p_accion <> 'C' THEN
      l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta(c_ruta);
      IF l_pagina IS NULL
         OR PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para '
          || CASE p_accion WHEN 'I' THEN 'agregar'
                           WHEN 'U' THEN 'modificar'
                           ELSE 'eliminar' END
          || ' instituciones');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* EN USO                                                                 */
  /* ---------------------------------------------------------------------- */

  -- Las tablas con FK de una columna hacia INSTITUCIONES (salvo las _JN y las
  -- 3 de la ficha), y cuantas filas de cada una usan la institucion p_id.
  PROCEDURE cargar_hijas(p_hijas OUT t_hijas, p_id IN NUMBER) IS
    TYPE t_nums IS TABLE OF NUMBER;
    l_ids  t_nums;
    l_cnts t_nums;
    l_i    PLS_INTEGER := 0;
    l_col  VARCHAR2(200);
  BEGIN
    FOR f IN (
        SELECT c.table_name, cc.column_name
          FROM user_constraints c
          JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
         WHERE c.constraint_type = 'R'
           AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                        WHERE table_name = 'INSTITUCIONES'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND c.table_name NOT IN ('INSTITUCIONES_DIRECTORES', 'INSTITUCIONES_COORDNADORES',
                                    'HORARIO_INSTITUCIONES')
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
         ORDER BY c.table_name
    ) LOOP
      l_i := l_i + 1;
      p_hijas(l_i).tabla := f.table_name;
      l_col := DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE);
      EXECUTE IMMEDIATE
        'SELECT ' || l_col || ', COUNT(*) FROM ' || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
        || ' WHERE ' || l_col || ' = :id GROUP BY ' || l_col
        BULK COLLECT INTO l_ids, l_cnts USING p_id;
      FOR j IN 1 .. l_ids.COUNT LOOP
        p_hijas(l_i).cuentas(l_ids(j)) := l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_hijas;

  PROCEDURE escribir_usos(p_hijas IN t_hijas, p_id IN NUMBER) IS
  BEGIN
    APEX_JSON.OPEN_ARRAY('usos');
    FOR i IN 1 .. p_hijas.COUNT LOOP
      IF p_hijas(i).cuentas.EXISTS(p_id) THEN
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('tabla',    p_hijas(i).tabla);
        APEX_JSON.WRITE('cantidad', p_hijas(i).cuentas(p_id));
        APEX_JSON.CLOSE_OBJECT;
      END IF;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
  END escribir_usos;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Cada institucion con lo que la tarjeta muestra de un vistazo: ubicacion,
  -- facilitador, el director vigente y como va el ANIO LECTIVO ACTUAL
  -- (autoridades activas, bloques de horario, pre-horarios y cuantos estan
  -- confirmados, postulaciones activas). Una consulta, sin N+1: cada conteo es
  -- un GROUP BY y se juntan por id.
  --
  -- El director vigente: el de ESTADO 'A' del periodo mas reciente. PERIODO es
  -- texto (ver evaluaciones_facilitadores.sql, lov_directores): el DESC es
  -- alfabetico, que para anios de 4 cifras alcanza.
  ------------------------------------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_anio VARCHAR2(16) := f_anio;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', l_anio);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH ph AS (
               SELECT id_institucion, COUNT(*) AS total,
                      SUM(CASE WHEN UPPER(TRIM(estado)) = 'SI' THEN 1 ELSE 0 END) AS confirmados
                 FROM pre_horarios
                WHERE anio = l_anio
                GROUP BY id_institucion),
             po AS (
               SELECT id_institucion, COUNT(*) AS n
                 FROM postulaciones
                WHERE anio = l_anio AND NVL(estado, 'Activo') <> 'Inactivo'
                GROUP BY id_institucion),
             ho AS (
               SELECT id_institucion, COUNT(*) AS n
                 FROM horario_instituciones
                WHERE anio = l_anio
                GROUP BY id_institucion),
             au AS (
               SELECT id_institucion, COUNT(*) AS n
                 FROM (SELECT id_institucion FROM instituciones_directores
                        WHERE UPPER(TRIM(estado)) = 'A'
                       UNION ALL
                       SELECT id_institucion FROM instituciones_coordnadores
                        WHERE UPPER(TRIM(estado)) = 'A')
                GROUP BY id_institucion),
             di AS (
               SELECT id_institucion, nombre, telefono
                 FROM (SELECT idr.id_institucion, d.nombre_apellido AS nombre,
                              NVL(TRIM(idr.nro_telefono), TRIM(d.nro_telefono)) AS telefono,
                              ROW_NUMBER() OVER (PARTITION BY idr.id_institucion
                                                 ORDER BY idr.periodo DESC, idr.id_periodo DESC) AS rn
                         FROM instituciones_directores idr
                         JOIN directores d ON d.id_director = idr.id_director
                        WHERE UPPER(TRIM(idr.estado)) = 'A')
                WHERE rn = 1)
        SELECT i.id_institucion, i.nombre, i.estado,
               CASE WHEN UPPER(NVL(TRIM(i.estado), 'A')) = 'A' THEN 'S' ELSE 'N' END AS es_activa,
               i.id_departamento, dp.nombre AS departamento,
               i.id_ciudad, c.nombre AS ciudad, i.id_barrio, b.nombre AS barrio,
               i.zona, i.direccion, i.ubicacion,
               i.id_facilitador, f.nombre_apellido AS facilitador,
               di.nombre AS director, di.telefono AS director_telefono,
               NVL(au.n, 0)          AS autoridades,
               NVL(ho.n, 0)          AS bloques_horario,
               NVL(ph.total, 0)      AS pre_horarios,
               NVL(ph.confirmados, 0) AS pre_confirmados,
               NVL(po.n, 0)          AS postulaciones
          FROM instituciones i
          -- Por la clave compuesta que garantiza la FK, no solo por el id.
          LEFT JOIN departamentos dp ON dp.id_pais = i.id_pais
                                    AND dp.id_departamento = i.id_departamento
          LEFT JOIN ciudades c       ON c.id_ciudad = i.id_ciudad
          LEFT JOIN barrios b        ON b.id_barrio = i.id_barrio
          LEFT JOIN facilitadores f  ON f.id_facilitador = i.id_facilitador
          LEFT JOIN di ON di.id_institucion = i.id_institucion
          LEFT JOIN au ON au.id_institucion = i.id_institucion
          LEFT JOIN ho ON ho.id_institucion = i.id_institucion
          LEFT JOIN ph ON ph.id_institucion = i.id_institucion
          LEFT JOIN po ON po.id_institucion = i.id_institucion
         ORDER BY UPPER(i.nombre)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('nombre',            r.nombre);
      APEX_JSON.WRITE('estado',            r.estado);
      APEX_JSON.WRITE('es_activa',         r.es_activa);
      APEX_JSON.WRITE('id_departamento',   r.id_departamento);
      APEX_JSON.WRITE('departamento',      r.departamento);
      APEX_JSON.WRITE('id_ciudad',         r.id_ciudad);
      APEX_JSON.WRITE('ciudad',            r.ciudad);
      APEX_JSON.WRITE('id_barrio',         r.id_barrio);
      APEX_JSON.WRITE('barrio',            r.barrio);
      APEX_JSON.WRITE('zona',              r.zona);
      APEX_JSON.WRITE('direccion',         r.direccion);
      APEX_JSON.WRITE('ubicacion',         r.ubicacion);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('facilitador',       r.facilitador);
      APEX_JSON.WRITE('director',          r.director);
      APEX_JSON.WRITE('director_telefono', r.director_telefono);
      APEX_JSON.WRITE('autoridades',       r.autoridades);
      APEX_JSON.WRITE('bloques_horario',   r.bloques_horario);
      APEX_JSON.WRITE('pre_horarios',      r.pre_horarios);
      APEX_JSON.WRITE('pre_confirmados',   r.pre_confirmados);
      APEX_JSON.WRITE('postulaciones',     r.postulaciones);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* OPCIONES                                                               */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Una lista de APEX: las entradas fijas de la LOV p_lov (por nombre) o de la
  -- de id p_lov_id; si no tiene, los valores distintos de p_respaldo. Igual que
  -- en facilitadores.sql: dinamico, porque las vistas de APEX cambian de
  -- version en version.
  ------------------------------------------------------------------------------
  PROCEDURE escribir_lista(
    p_clave    IN VARCHAR2,
    p_lov      IN VARCHAR2,
    p_lov_id   IN NUMBER,
    p_respaldo IN VARCHAR2)
  IS
    TYPE t_txt IS TABLE OF VARCHAR2(4000);
    l_mostrar t_txt := t_txt();
    l_valor   t_txt := t_txt();
  BEGIN
    BEGIN
      EXECUTE IMMEDIATE
        'SELECT e.display_value, e.return_value FROM apex_application_lov_entries e'
        || ' WHERE e.application_id = :app AND (e.list_of_values_name = :n'
        || '   OR e.list_of_values_name = (SELECT l.list_of_values_name FROM apex_application_lovs l'
        || '                                WHERE l.application_id = :app2 AND l.lov_id = :id))'
        || ' ORDER BY e.display_sequence'
        BULK COLLECT INTO l_mostrar, l_valor USING c_app_id, p_lov, c_app_id, p_lov_id;
    EXCEPTION
      WHEN OTHERS THEN l_mostrar.DELETE; l_valor.DELETE;
    END;
    IF l_valor.COUNT = 0 AND p_respaldo IS NOT NULL THEN
      EXECUTE IMMEDIATE p_respaldo BULK COLLECT INTO l_valor;
      l_mostrar := l_valor;
    END IF;

    APEX_JSON.OPEN_ARRAY(p_clave);
    FOR i IN 1 .. l_valor.COUNT LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('valor',   l_valor(i));
      APEX_JSON.WRITE('mostrar', NVL(l_mostrar(i), l_valor(i)));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
  END escribir_lista;

  PROCEDURE opciones(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', f_anio);
    -- P21_ESTADO usaba la lista ACTIVO_INACTIVO (la 11839528633369166338 en el IG).
    escribir_lista('estado', 'ACTIVO_INACTIVO', 11839528633369166338,
      'SELECT DISTINCT estado FROM instituciones WHERE estado IS NOT NULL ORDER BY 1');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* FICHA                                                                  */
  /* ---------------------------------------------------------------------- */

  PROCEDURE ficha(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id     NUMBER := f_numero(p_id);
    l_anio   VARCHAR2(16) := f_anio;
    l_hijas  t_hijas;
    l_n      PLS_INTEGER;
    l_sin    PLS_INTEGER;
    l_sin_ok PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de institucion invalido'); RETURN;
    END IF;
    SELECT COUNT(*) INTO l_n FROM instituciones WHERE id_institucion = l_id;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'La institucion no existe'); RETURN;
    END IF;
    cargar_hijas(l_hijas, l_id);

    -- Lo que tocaria "Actualizar facilitador": los pre-horarios del anio sin
    -- facilitador, y de ellos los confirmados (su postulacion se regenera).
    SELECT COUNT(*),
           NVL(SUM(CASE WHEN UPPER(TRIM(estado)) = 'SI' THEN 1 ELSE 0 END), 0)
      INTO l_sin, l_sin_ok
      FROM pre_horarios
     WHERE id_institucion = l_id AND id_facilitador IS NULL AND anio = l_anio;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    FOR r IN (SELECT i.id_institucion, i.nombre, i.estado, i.id_pais, i.id_departamento,
                     i.id_ciudad, i.id_barrio, i.direccion, i.ubicacion, i.zona, i.comentario,
                     i.id_facilitador,
                     dp.nombre AS departamento, c.nombre AS ciudad, b.nombre AS barrio,
                     f.nombre_apellido AS facilitador
                FROM instituciones i
                LEFT JOIN departamentos dp ON dp.id_pais = i.id_pais
                                          AND dp.id_departamento = i.id_departamento
                LEFT JOIN ciudades c       ON c.id_ciudad = i.id_ciudad
                LEFT JOIN barrios b        ON b.id_barrio = i.id_barrio
                LEFT JOIN facilitadores f  ON f.id_facilitador = i.id_facilitador
               WHERE i.id_institucion = l_id) LOOP
      APEX_JSON.OPEN_OBJECT('data');
      APEX_JSON.WRITE('id_institucion',  r.id_institucion);
      APEX_JSON.WRITE('nombre',          r.nombre);
      APEX_JSON.WRITE('estado',          r.estado);
      APEX_JSON.WRITE('id_departamento', r.id_departamento);
      APEX_JSON.WRITE('departamento',    r.departamento);
      APEX_JSON.WRITE('id_ciudad',       r.id_ciudad);
      APEX_JSON.WRITE('ciudad',          r.ciudad);
      APEX_JSON.WRITE('id_barrio',       r.id_barrio);
      APEX_JSON.WRITE('barrio',          r.barrio);
      APEX_JSON.WRITE('direccion',       r.direccion);
      APEX_JSON.WRITE('ubicacion',       r.ubicacion);
      APEX_JSON.WRITE('zona',            r.zona);
      APEX_JSON.WRITE('comentario',      r.comentario);
      APEX_JSON.WRITE('id_facilitador',  r.id_facilitador);
      APEX_JSON.WRITE('facilitador',     r.facilitador);
      APEX_JSON.WRITE('anio',            l_anio);
      APEX_JSON.WRITE('pre_sin_facilitador',             l_sin);
      APEX_JSON.WRITE('pre_sin_facilitador_confirmados', l_sin_ok);
      escribir_usos(l_hijas, l_id);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END ficha;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_nombre         IN VARCHAR2,
    p_estado         IN VARCHAR2,
    p_id_ciudad      IN VARCHAR2,
    p_id_barrio      IN VARCHAR2,
    p_direccion      IN VARCHAR2,
    p_ubicacion      IN VARCHAR2,
    p_zona           IN VARCHAR2,
    p_comentario     IN VARCHAR2,
    p_id_facilitador IN VARCHAR2)
  IS
    -- 32767: ver sucursales.sql. Los topes reales se validan abajo.
    l_nombre  VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_nombre, '\s+', ' '));
    l_estado  VARCHAR2(32767) := TRIM(p_estado);
    l_dir     VARCHAR2(32767) := TRIM(p_direccion);
    l_ubic    VARCHAR2(32767) := TRIM(p_ubicacion);
    l_zona    VARCHAR2(32767) := TRIM(p_zona);
    l_coment  VARCHAR2(32767) := TRIM(p_comentario);
    l_id      NUMBER := f_numero(p_id);
    l_ciudad  NUMBER := f_numero(p_id_ciudad);
    l_barrio  NUMBER := f_numero(p_id_barrio);
    l_fac     NUMBER := f_numero(p_id_facilitador);
    l_pais    NUMBER;
    l_dep     NUMBER;
    l_ciu_b   NUMBER;
    l_est_ant VARCHAR2(10);
    l_cambian PLS_INTEGER := 0;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de institucion invalido'); RETURN;
    END IF;
    IF l_nombre IS NULL THEN
      p_error(400, 'Bad Request', 'El nombre es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_nombre) > 800 THEN
      p_error(400, 'Bad Request', 'El nombre no puede pasar de 800 caracteres'); RETURN;
    END IF;
    IF l_estado IS NULL THEN
      p_error(400, 'Bad Request', 'El estado es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_estado) > 1 THEN
      p_error(400, 'Bad Request', 'El estado no es valido'); RETURN;
    END IF;
    IF LENGTH(l_dir) > 800 THEN
      p_error(400, 'Bad Request', 'La direccion no puede pasar de 800 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_ubic) > 4000 THEN
      p_error(400, 'Bad Request', 'La ubicacion no puede pasar de 4000 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_zona) > 2000 THEN
      p_error(400, 'Bad Request', 'La zona no puede pasar de 2000 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_coment) > 2000 THEN
      p_error(400, 'Bad Request', 'La observacion no puede pasar de 2000 caracteres'); RETURN;
    END IF;

    -- Ubicacion (ver el encabezado): pais y departamento DE LA FILA del barrio,
    -- o de la ciudad si no hay barrio, para que las FK compuestas se cumplan.
    IF l_barrio IS NOT NULL THEN
      BEGIN
        SELECT id_pais, id_departamento, id_ciudad INTO l_pais, l_dep, l_ciu_b
          FROM barrios WHERE id_barrio = l_barrio;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'El barrio elegido no existe'); RETURN;
      END;
      IF l_ciudad IS NULL THEN
        l_ciudad := l_ciu_b;
      ELSIF l_ciudad <> l_ciu_b THEN
        p_error(400, 'Bad Request', 'El barrio elegido no es de esa ciudad'); RETURN;
      END IF;
    ELSIF l_ciudad IS NOT NULL THEN
      BEGIN
        SELECT id_pais, id_departamento INTO l_pais, l_dep
          FROM ciudades WHERE id_ciudad = l_ciudad;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'La ciudad elegida no existe'); RETURN;
      END;
    END IF;
    -- En APEX la ciudad (y el departamento) eran obligatorios.
    IF l_ciudad IS NULL THEN
      p_error(400, 'Bad Request', 'La ciudad es obligatoria'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO instituciones (
        nombre, estado, id_pais, id_departamento, id_ciudad, id_barrio,
        direccion, ubicacion, zona, comentario, id_facilitador)
      VALUES (
        l_nombre, l_estado, l_pais, l_dep, l_ciudad, l_barrio,
        l_dir, l_ubic, l_zona, l_coment, l_fac)
      RETURNING id_institucion INTO l_id;
    ELSE
      BEGIN
        SELECT estado INTO l_est_ant FROM instituciones WHERE id_institucion = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'La institucion no existe'); RETURN;
      END;
      -- Las que TRG_UPD_ESTADO_INSTITUCIONES va a cambiar (ver el encabezado):
      -- solo si cambia el estado y el anterior no era NULL, como el trigger.
      IF l_est_ant IS NOT NULL AND l_est_ant <> l_estado THEN
        SELECT (SELECT COUNT(*) FROM instituciones_directores
                 WHERE id_institucion = l_id AND NVL(estado, '~') <> l_estado)
             + (SELECT COUNT(*) FROM instituciones_coordnadores
                 WHERE id_institucion = l_id AND NVL(estado, '~') <> l_estado)
          INTO l_cambian FROM dual;
      END IF;

      -- Solo las columnas de la ficha. Las viejas que APEX ya no mostraba
      -- (DIRECTOR, NRO_CI, TELEFONO, COORDINADOR..., HORARIO, CARGO, NIVEL,
      -- TURNO, ID_DIRECTOR, ID_COORDINADOR) quedan como estan.
      UPDATE instituciones
         SET nombre = l_nombre, estado = l_estado,
             id_pais = l_pais, id_departamento = l_dep, id_ciudad = l_ciudad,
             id_barrio = l_barrio, direccion = l_dir, ubicacion = l_ubic,
             zona = l_zona, comentario = l_coment, id_facilitador = l_fac
       WHERE id_institucion = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_institucion', l_id);
    APEX_JSON.WRITE('autoridades_cambiadas', l_cambian);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Institucion creada'
                                    ELSE 'Institucion actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  -- Solo si nada la usa fuera de su ficha. Autoridades y horario se van con ella.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id    NUMBER := f_numero(p_id);
    l_hijas t_hijas;
    l_usos  VARCHAR2(4000);
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de institucion invalido'); RETURN;
    END IF;

    cargar_hijas(l_hijas, l_id);
    FOR i IN 1 .. l_hijas.COUNT LOOP
      IF l_hijas(i).cuentas.EXISTS(l_id) THEN
        l_usos := l_usos || CASE WHEN l_usos IS NOT NULL THEN ', ' END
                  || l_hijas(i).cuentas(l_id) || ' en ' || LOWER(l_hijas(i).tabla);
      END IF;
    END LOOP;
    IF l_usos IS NOT NULL THEN
      p_error(409, 'Conflict', 'No se puede eliminar: se usa (' || l_usos || ')'); RETURN;
    END IF;

    DELETE FROM instituciones_directores   WHERE id_institucion = l_id;
    DELETE FROM instituciones_coordnadores WHERE id_institucion = l_id;
    DELETE FROM horario_instituciones      WHERE id_institucion = l_id;
    DELETE FROM instituciones              WHERE id_institucion = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'La institucion no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Institucion eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* ASIGNAR FACILITADOR A LOS PRE-HORARIOS                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE asignar_facilitador(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id   NUMBER := f_numero(p_id);
    l_anio VARCHAR2(16) := f_anio;
    l_fac  NUMBER;
    l_n    PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de institucion invalido'); RETURN;
    END IF;
    BEGIN
      SELECT id_facilitador INTO l_fac FROM instituciones WHERE id_institucion = l_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La institucion no existe'); RETURN;
    END;
    IF l_fac IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion no tiene un facilitador guardado'); RETURN;
    END IF;
    IF l_anio IS NULL THEN
      p_error(409, 'Conflict', 'No hay un ' || UNISTR('a\00f1o') || ' lectivo activo (ver ANIOS_LECTIVOS)'); RETURN;
    END IF;

    UPDATE pre_horarios
       SET id_facilitador = l_fac
     WHERE id_institucion = l_id
       AND id_facilitador IS NULL
       AND anio = l_anio;
    l_n := SQL%ROWCOUNT;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('actualizados', l_n);
    APEX_JSON.WRITE('message', l_n || ' pre-horario(s) actualizados');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END asignar_facilitador;

END PKG_INSTITUCIONES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINTS ORDS ======================================================
--------------------------------------------------------------------------------

DECLARE
  c_token CONSTANT VARCHAR2(400) := '
    l_token := :authorization;
    IF l_token IS NOT NULL THEN
        l_pos := INSTR(UPPER(l_token), ''BEARER '');
        IF l_pos > 0 THEN
            l_token := TRIM(SUBSTR(l_token, l_pos + 7));
        END IF;
    END IF;';

  c_decl CONSTANT VARCHAR2(100) :=
    'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN';

  c_campos CONSTANT VARCHAR2(600) := '
        p_nombre => :nombre, p_estado => :estado,
        p_id_ciudad => :id_ciudad, p_id_barrio => :id_barrio,
        p_direccion => :direccion, p_ubicacion => :ubicacion, p_zona => :zona,
        p_comentario => :comentario, p_id_facilitador => :id_facilitador);';

  PROCEDURE auth_param(p_pattern IN VARCHAR2, p_method IN VARCHAR2) IS
  BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ethos',
        p_pattern            => p_pattern,
        p_method             => p_method,
        p_name               => 'Authorization',
        p_bind_variable_name => 'authorization',
        p_source_type        => 'HEADER',
        p_param_type         => 'STRING',
        p_access_method      => 'IN');
  END auth_param;

  PROCEDURE handler(p_pattern IN VARCHAR2, p_method IN VARCHAR2, p_llamada IN VARCHAR2) IS
  BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ethos',
        p_pattern     => p_pattern,
        p_method      => p_method,
        p_source_type => 'plsql/block',
        p_source      => c_decl || c_token || CHR(10) || p_llamada || CHR(10) || 'END;');
    auth_param(p_pattern, p_method);
  END handler;
BEGIN
  FOR r IN (SELECT 'instituciones' AS p FROM dual
            UNION ALL SELECT 'instituciones/opciones' FROM dual
            UNION ALL SELECT 'instituciones/:id' FROM dual
            UNION ALL SELECT 'instituciones/:id/facilitador' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La literal antes que :id, como en facilitadores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones/:id',
                       p_priority => 1, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones/:id/facilitador',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('instituciones', 'GET', '
    PKG_INSTITUCIONES_ETHOS.LISTAR(p_token => l_token);');

  handler('instituciones/opciones', 'GET', '
    PKG_INSTITUCIONES_ETHOS.OPCIONES(p_token => l_token);');

  handler('instituciones/:id', 'GET', '
    PKG_INSTITUCIONES_ETHOS.FICHA(p_token => l_token, p_id => :id);');

  handler('instituciones', 'POST', '
    PKG_INSTITUCIONES_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('instituciones/:id', 'PUT', '
    PKG_INSTITUCIONES_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('instituciones/:id', 'DELETE', '
    PKG_INSTITUCIONES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('instituciones/:id/facilitador', 'POST', '
    PKG_INSTITUCIONES_ETHOS.ASIGNAR_FACILITADOR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de instituciones publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS: produccion (Pages) y el APK le pegan DIRECTO a ORDS.
DECLARE
  PROCEDURE preflight(p_pattern IN VARCHAR2) IS
  BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ethos',
        p_pattern     => p_pattern,
        p_method      => 'OPTIONS',
        p_source_type => 'plsql/block',
        p_source      => q'~
BEGIN
    OWA_UTIL.MIME_HEADER('text/plain', FALSE);
    HTP.P('Access-Control-Allow-Origin: *');
    HTP.P('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;
~');
  END preflight;
BEGIN
  preflight('instituciones');
  preflight('instituciones/opciones');
  preflight('instituciones/:id');
  preflight('instituciones/:id/facilitador');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Preflight OPTIONS no se pudo publicar: ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 4) VERIFICACION ========================================================
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_INSTITUCIONES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INSTITUCIONES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    instituciones');
    DBMS_OUTPUT.PUT_LINE('       GET    instituciones/opciones');
    DBMS_OUTPUT.PUT_LINE('       GET    instituciones/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   instituciones');
    DBMS_OUTPUT.PUT_LINE('       PUT    instituciones/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE instituciones/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   instituciones/:id/facilitador');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INSTITUCIONES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_INSTITUCIONES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INSTITUCIONES_ETHOS no se creo.');
END;
/
