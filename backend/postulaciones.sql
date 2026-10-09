--------------------------------------------------------------------------------
-- POSTULACIONES  —  lo que cada institucion postula para el anio
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio, para UNA institucion, al modal 38 de APEX (Datos, el
-- boton "Postulaciones" del 21) y a la pagina 60 (Consulta de Postulaciones,
-- con su PDF y su imagen). En el sitio es la pestana Postulaciones de
-- /instituciones/:id, con los permisos de la 16. La pagina 20 (Postulaciones)
-- y la 24 (Consulta de Postulaciones) del menu son de esta misma tabla:
-- cuando se hagan, usan este backend.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  postulaciones?id_institucion=&anio=        las de una institucion y
--                                                   anio (sin anio: el lectivo
--                                                   actual), con los anios que
--                                                   tiene
--   GET  postulaciones/opciones                     los estados (lista de APEX)
--   GET  postulaciones/formulario?id_institucion=&anio=
--                                                   lo que imprime el
--                                                   "Formulario N 1": el proceso
--                                                   DATOS de la pagina 60
--   POST   postulaciones           {datos} una fila de la grilla -> {id}
--   PUT    postulaciones/:id       {datos}
--   DELETE postulaciones/:id       solo si no tiene intervenciones ni evaluaciones
--   PUT    postulaciones/:id/estado  {estado, obs_estado}
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql y anios_lectivos.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- DE DONDE SALEN
--------------------------------------------------------------------------------
--
-- Hoy las postulaciones las crea TRG_POSTULACIONES al confirmar un pre-horario
-- (ver pre_horarios.sql): una por pre-horario, con la cantidad en la columna
-- de su grado y de su manual, y las horas en las de su dia. Si el pre-horario
-- se modifica, la postulacion se BORRA Y SE VUELVE A CREAR. La pantalla es
-- la grilla editable de la 38 (pedido el 09/10/2026: que funcione igual que
-- APEX): se edita cualquier columna visible y se agregan y borran filas.
-- Igual que en APEX, si la fila salio de un pre-horario y despues se
-- modifica ese pre-horario, la postulacion se regenera y esos cambios se
-- pierden (vuelve Activa).
--
-- "Activa" = ESTADO <> 'Inactivo' o vacio: el criterio de la pagina 60
-- (nvl(p.estado,'Activo') <> 'Inactivo').
--
-- Las columnas de grados se llaman "2" ... "9", "1M", "2M", "3M" (con
-- comillas: empiezan con numero). Viajan como g2 ... g9, g1m, g2m, g3m.
--
--------------------------------------------------------------------------------
-- EL FORMULARIO (lo que era DATOS en la pagina 60)
--------------------------------------------------------------------------------
--
-- Devuelve lo mismo que el proceso DATOS: la institucion, las autoridades del
-- periodo (directores y coordinadores ACTIVOS con PERIODO = el anio), el
-- detalle (las postulaciones activas, numeradas por turno en orden de dia y
-- hora) y el horario de la institucion de ese anio. El PDF y la imagen los arma
-- el sitio (lib/formulario-postulacion.ts). Dos cambios:
--
--   - DATOS filtraba `i.id_pais = 1`: una institucion sin pais (o con otro)
--     salia con el encabezado VACIO. Aca no se filtra por pais, y la ubicacion
--     se une por las claves compuestas de las FK.
--   - El docente: el nombre de DOCENTES si hay, y si no NOMBRE_PROFESOR (el
--     texto que copio el trigger), como evaluaciones_facilitadores.sql. El
--     telefono, el de la postulacion y si no el del docente.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET pide solo sesion. Cambiar el estado pide ACTUALIZAR en /instituciones
--   (la 16; la 38 colgaba del 21) o en /postulaciones (la 20).
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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'POSTULACIONES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla POSTULACIONES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla POSTULACIONES encontrada.');
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'POSTULACIONES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_POSTULACIONES_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_anio IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  -- El proceso DATOS de la pagina 60 (ver el encabezado).
  PROCEDURE formulario(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_anio IN VARCHAR2);

  PROCEDURE cambiar_estado(
    p_token      IN VARCHAR2,
    p_id         IN VARCHAR2,
    p_estado     IN VARCHAR2,
    p_obs_estado IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion de una fila, como la grilla de la 38.
  -- p_datos: el JSON de la fila como texto.
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_datos IN CLOB);

  -- Baja. 409 si tiene intervenciones o evaluaciones.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_POSTULACIONES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_POSTULACIONES_ETHOS AS

  c_ruta_ficha CONSTANT VARCHAR2(40) := '/instituciones';
  c_ruta       CONSTANT VARCHAR2(40) := '/postulaciones';
  c_app_id     CONSTANT NUMBER       := 40587;
  c_workspace  CONSTANT VARCHAR2(64) := 'FUNDCARAC';

  TYPE t_usos IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;

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

  FUNCTION f_anio RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_anio;

  -- Si el usuario puede p_accion en la pagina de p_ruta. Sin pagina, no.
  FUNCTION puede(p_usuario IN VARCHAR2, p_ruta IN VARCHAR2, p_accion IN VARCHAR2)
    RETURN BOOLEAN IS
    l_pagina NUMBER;
  BEGIN
    l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta(p_ruta);
    RETURN l_pagina IS NOT NULL
       AND PKG_ROLES_PAGINAS_ETHOS.puede(p_usuario, l_pagina, p_accion) = 'S';
  EXCEPTION
    WHEN OTHERS THEN RETURN FALSE;
  END puede;

  -- Sesion + permiso (ver el encabezado). 'C' pide solo sesion.
  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    IF p_accion = 'C'
       OR puede(l_usuario, c_ruta_ficha, 'U')
       OR puede(l_usuario, c_ruta, p_accion) THEN
      RETURN TRUE;
    END IF;
    p_error(403, 'Forbidden', 'No tenes permiso para modificar postulaciones');
    RETURN FALSE;
  END exigir;

  -- Cuantas filas de otras tablas (intervenciones, evaluaciones) usan cada
  -- postulacion de la institucion: las FK de una columna, salvo las _JN.
  PROCEDURE cargar_usos(p_usos OUT t_usos, p_id_institucion IN NUMBER) IS
    TYPE t_nums IS TABLE OF NUMBER;
    l_ids  t_nums;
    l_cnts t_nums;
    l_col  VARCHAR2(200);
  BEGIN
    FOR f IN (
        SELECT c.table_name, cc.column_name
          FROM user_constraints c
          JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
         WHERE c.constraint_type = 'R'
           AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                        WHERE table_name = 'POSTULACIONES'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
    ) LOOP
      l_col := DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE);
      EXECUTE IMMEDIATE
        'SELECT ' || l_col || ', COUNT(*) FROM ' || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
        || ' WHERE ' || l_col || ' IN (SELECT id_postulacion FROM postulaciones'
        || '                          WHERE id_institucion = :i)'
        || ' GROUP BY ' || l_col
        BULK COLLECT INTO l_ids, l_cnts USING p_id_institucion;
      FOR j IN 1 .. l_ids.COUNT LOOP
        p_usos(l_ids(j)) := CASE WHEN p_usos.EXISTS(l_ids(j)) THEN p_usos(l_ids(j)) ELSE 0 END
                            + l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_usos;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_anio IN VARCHAR2) IS
    l_inst NUMBER := f_numero(p_id_institucion);
    l_anio VARCHAR2(16) := NVL(TRIM(p_anio), f_anio);
    l_usos t_usos;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    cargar_usos(l_usos, l_inst);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', l_anio);
    APEX_JSON.WRITE('anio_actual', f_anio);
    -- Los anios que tiene la institucion, para elegir.
    APEX_JSON.OPEN_ARRAY('anios');
    FOR a IN (SELECT DISTINCT anio FROM postulaciones
               WHERE id_institucion = l_inst AND anio IS NOT NULL ORDER BY anio DESC) LOOP
      APEX_JSON.WRITE(a.anio);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT p.id_postulacion, p.id_pre_horario, p.turno, p.seccion,
               p."2" AS g2, p."3" AS g3, p."4" AS g4, p."5" AS g5, p."6" AS g6,
               p."7" AS g7, p."8" AS g8, p."9" AS g9,
               p."1M" AS g1m, p."2M" AS g2m, p."3M" AS g3m,
               p.ser, p.hacer, p.tener, p.caracter, p.vision, p.coraje, p.liderazgo,
               TO_CHAR(p.lunes_desde, 'HH24:MI')     AS lunes_desde,
               TO_CHAR(p.lunes_hasta, 'HH24:MI')     AS lunes_hasta,
               TO_CHAR(p.martes_desde, 'HH24:MI')    AS martes_desde,
               TO_CHAR(p.martes_hasta, 'HH24:MI')    AS martes_hasta,
               TO_CHAR(p.miercoles_desde, 'HH24:MI') AS miercoles_desde,
               TO_CHAR(p.miercoles_hasta, 'HH24:MI') AS miercoles_hasta,
               TO_CHAR(p.jueves_desde, 'HH24:MI')    AS jueves_desde,
               TO_CHAR(p.jueves_hasta, 'HH24:MI')    AS jueves_hasta,
               TO_CHAR(p.viernes_desde, 'HH24:MI')   AS viernes_desde,
               TO_CHAR(p.viernes_hasta, 'HH24:MI')   AS viernes_hasta,
               p.id_materia, m.descripcion AS materia,
               p.id_docente, COALESCE(d.nombre_apellido, p.nombre_profesor) AS docente,
               COALESCE(TRIM(p.telefono), TRIM(d.nro_telefono)) AS telefono,
               p.id_facilitador, f.nombre_apellido AS facilitador,
               p.id_enfasis, e.descripcion AS enfasis,
               p.observacion, p.estado, p.obs_estado, p.anio
          FROM postulaciones p
          LEFT JOIN materias m      ON m.id_materia = p.id_materia
          LEFT JOIN docentes d      ON d.id_docente = p.id_docente
          LEFT JOIN facilitadores f ON f.id_facilitador = p.id_facilitador
          LEFT JOIN enfasis e       ON e.id_enfasis = p.id_enfasis
         WHERE p.id_institucion = l_inst
           AND (p.anio = l_anio OR (l_anio IS NULL AND p.anio IS NULL))
         -- El orden de DATOS: por turno y la primera hora de la semana.
         ORDER BY p.turno,
                  NVL(TO_CHAR(p.lunes_desde, 'HH24:MI'), '99'),
                  NVL(TO_CHAR(p.martes_desde, 'HH24:MI'), '99'),
                  NVL(TO_CHAR(p.miercoles_desde, 'HH24:MI'), '99'),
                  NVL(TO_CHAR(p.jueves_desde, 'HH24:MI'), '99'),
                  NVL(TO_CHAR(p.viernes_desde, 'HH24:MI'), '99'),
                  p.id_postulacion
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',              r.id_postulacion);
      APEX_JSON.WRITE('id_pre_horario',  r.id_pre_horario);
      APEX_JSON.WRITE('turno',           r.turno);
      APEX_JSON.WRITE('seccion',         r.seccion);
      APEX_JSON.WRITE('g2',  r.g2);  APEX_JSON.WRITE('g3',  r.g3);  APEX_JSON.WRITE('g4',  r.g4);
      APEX_JSON.WRITE('g5',  r.g5);  APEX_JSON.WRITE('g6',  r.g6);  APEX_JSON.WRITE('g7',  r.g7);
      APEX_JSON.WRITE('g8',  r.g8);  APEX_JSON.WRITE('g9',  r.g9);
      APEX_JSON.WRITE('g1m', r.g1m); APEX_JSON.WRITE('g2m', r.g2m); APEX_JSON.WRITE('g3m', r.g3m);
      APEX_JSON.WRITE('ser',       r.ser);       APEX_JSON.WRITE('hacer',     r.hacer);
      APEX_JSON.WRITE('tener',     r.tener);     APEX_JSON.WRITE('caracter',  r.caracter);
      APEX_JSON.WRITE('vision',    r.vision);    APEX_JSON.WRITE('coraje',    r.coraje);
      APEX_JSON.WRITE('liderazgo', r.liderazgo);
      APEX_JSON.WRITE('lunes_desde',     r.lunes_desde);
      APEX_JSON.WRITE('lunes_hasta',     r.lunes_hasta);
      APEX_JSON.WRITE('martes_desde',    r.martes_desde);
      APEX_JSON.WRITE('martes_hasta',    r.martes_hasta);
      APEX_JSON.WRITE('miercoles_desde', r.miercoles_desde);
      APEX_JSON.WRITE('miercoles_hasta', r.miercoles_hasta);
      APEX_JSON.WRITE('jueves_desde',    r.jueves_desde);
      APEX_JSON.WRITE('jueves_hasta',    r.jueves_hasta);
      APEX_JSON.WRITE('viernes_desde',   r.viernes_desde);
      APEX_JSON.WRITE('viernes_hasta',   r.viernes_hasta);
      APEX_JSON.WRITE('id_materia',      r.id_materia);
      APEX_JSON.WRITE('materia',         r.materia);
      APEX_JSON.WRITE('id_docente',      r.id_docente);
      APEX_JSON.WRITE('docente',         r.docente);
      APEX_JSON.WRITE('telefono',        r.telefono);
      APEX_JSON.WRITE('id_facilitador',  r.id_facilitador);
      APEX_JSON.WRITE('facilitador',     r.facilitador);
      APEX_JSON.WRITE('id_enfasis',      r.id_enfasis);
      APEX_JSON.WRITE('enfasis',         r.enfasis);
      APEX_JSON.WRITE('observacion',     r.observacion);
      APEX_JSON.WRITE('estado',          r.estado);
      APEX_JSON.WRITE('obs_estado',      r.obs_estado);
      APEX_JSON.WRITE('anio',            r.anio);
      APEX_JSON.WRITE('usos', CASE WHEN l_usos.EXISTS(r.id_postulacion)
                                   THEN l_usos(r.id_postulacion) ELSE 0 END);
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

  -- La lista de estados del IG de la 38 (la 97286413700196297252). Si no se
  -- lee, los valores que ya hay, y si tampoco hay, Activo / Inactivo: lo que
  -- compara la pagina 60.
  PROCEDURE opciones(p_token IN VARCHAR2) IS
    TYPE t_txt IS TABLE OF VARCHAR2(4000);
    l_mostrar t_txt := t_txt();
    l_valor   t_txt := t_txt();
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    fijar_workspace;
    BEGIN
      EXECUTE IMMEDIATE
        'SELECT e.display_value, e.return_value FROM apex_application_lov_entries e'
        || ' WHERE e.application_id = :app'
        || '   AND e.list_of_values_name = (SELECT l.list_of_values_name FROM apex_application_lovs l'
        || '                                 WHERE l.application_id = :app2 AND l.lov_id = :id)'
        || ' ORDER BY e.display_sequence'
        BULK COLLECT INTO l_mostrar, l_valor USING c_app_id, c_app_id, 97286413700196297252;
    EXCEPTION
      WHEN OTHERS THEN l_mostrar.DELETE; l_valor.DELETE;
    END;
    IF l_valor.COUNT = 0 THEN
      SELECT v BULK COLLECT INTO l_valor
        FROM (SELECT 'Activo' v FROM dual UNION SELECT 'Inactivo' FROM dual
              UNION SELECT DISTINCT estado FROM postulaciones WHERE estado IS NOT NULL)
       ORDER BY v;
      l_mostrar := l_valor;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('estado');
    FOR i IN 1 .. l_valor.COUNT LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('valor',   l_valor(i));
      APEX_JSON.WRITE('mostrar', NVL(l_mostrar(i), l_valor(i)));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* FORMULARIO (el DATOS de la pagina 60)                                  */
  /* ---------------------------------------------------------------------- */

  PROCEDURE formulario(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_anio IN VARCHAR2) IS
    l_inst NUMBER := f_numero(p_id_institucion);
    l_anio VARCHAR2(16) := NVL(TRIM(p_anio), f_anio);
    l_n    PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    SELECT COUNT(*) INTO l_n FROM instituciones WHERE id_institucion = l_inst;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'La institucion no existe'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', l_anio);

    -- Sin el `id_pais = 1` de DATOS (ver el encabezado).
    FOR ins IN (SELECT i.nombre, i.direccion, dp.nombre AS departamento,
                     c.nombre AS ciudad, b.nombre AS barrio
                FROM instituciones i
                LEFT JOIN departamentos dp ON dp.id_pais = i.id_pais
                                          AND dp.id_departamento = i.id_departamento
                LEFT JOIN ciudades c       ON c.id_ciudad = i.id_ciudad
                LEFT JOIN barrios b        ON b.id_barrio = i.id_barrio
               WHERE i.id_institucion = l_inst) LOOP
      APEX_JSON.WRITE('nombre',       ins.nombre);
      APEX_JSON.WRITE('direccion',    ins.direccion);
      APEX_JSON.WRITE('departamento', ins.departamento);
      APEX_JSON.WRITE('ciudad',       ins.ciudad);
      APEX_JSON.WRITE('barrio',       ins.barrio);
    END LOOP;

    -- Las del periodo: directores y coordinadores activos con PERIODO = anio.
    APEX_JSON.OPEN_ARRAY('autoridades');
    FOR r IN (SELECT idr.cargo, TRIM(d.nombre_apellido) AS nombre, d.nro_ci,
                     NVL(TRIM(idr.nro_telefono), TRIM(d.nro_telefono)) AS telefono
                FROM instituciones_directores idr
                JOIN directores d ON d.id_director = idr.id_director
               WHERE idr.periodo = l_anio
                 AND UPPER(TRIM(idr.estado)) = 'A'
                 AND idr.id_institucion = l_inst
              UNION ALL
              SELECT ic.tipo_coordinador, TRIM(c.nombre_apellido), c.nro_ci,
                     NVL(TRIM(ic.nro_telefono), TRIM(c.nro_telefono))
                FROM instituciones_coordnadores ic
                JOIN coordinadores c ON c.id_coordinador = ic.id_coordinador
               WHERE ic.periodo = l_anio
                 AND UPPER(TRIM(ic.estado)) = 'A'
                 AND ic.id_institucion = l_inst) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('cargo',    r.cargo);
      APEX_JSON.WRITE('nombre',   r.nombre);
      APEX_JSON.WRITE('ci',       r.nro_ci);
      APEX_JSON.WRITE('telefono', r.telefono);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Las activas, numeradas por turno en orden de dia y hora, como DATOS.
    APEX_JSON.OPEN_ARRAY('detalle');
    FOR r IN (
        SELECT ROW_NUMBER() OVER (
                 PARTITION BY p.turno
                 ORDER BY NVL(TO_CHAR(p.lunes_desde, 'HH24:MI'), '99'),
                          NVL(TO_CHAR(p.martes_desde, 'HH24:MI'), '99'),
                          NVL(TO_CHAR(p.miercoles_desde, 'HH24:MI'), '99'),
                          NVL(TO_CHAR(p.jueves_desde, 'HH24:MI'), '99'),
                          NVL(TO_CHAR(p.viernes_desde, 'HH24:MI'), '99'),
                          p.id_postulacion) AS nro_item,
               p.id_postulacion, p.turno, p.seccion,
               p."2" AS g2, p."3" AS g3, p."4" AS g4, p."5" AS g5, p."6" AS g6,
               p."7" AS g7, p."8" AS g8, p."9" AS g9,
               p."1M" AS g1m, p."2M" AS g2m, p."3M" AS g3m,
               e.descripcion AS enfasis,
               p.ser, p.hacer, p.tener, p.caracter, p.vision, p.coraje, p.liderazgo,
               TO_CHAR(p.lunes_desde, 'HH24:MI')     AS lunes_desde,
               TO_CHAR(p.lunes_hasta, 'HH24:MI')     AS lunes_hasta,
               TO_CHAR(p.martes_desde, 'HH24:MI')    AS martes_desde,
               TO_CHAR(p.martes_hasta, 'HH24:MI')    AS martes_hasta,
               TO_CHAR(p.miercoles_desde, 'HH24:MI') AS miercoles_desde,
               TO_CHAR(p.miercoles_hasta, 'HH24:MI') AS miercoles_hasta,
               TO_CHAR(p.jueves_desde, 'HH24:MI')    AS jueves_desde,
               TO_CHAR(p.jueves_hasta, 'HH24:MI')    AS jueves_hasta,
               TO_CHAR(p.viernes_desde, 'HH24:MI')   AS viernes_desde,
               TO_CHAR(p.viernes_hasta, 'HH24:MI')   AS viernes_hasta,
               m.descripcion AS materia,
               COALESCE(d.nombre_apellido, p.nombre_profesor) AS docente,
               COALESCE(TRIM(p.telefono), TRIM(d.nro_telefono)) AS telefono
          FROM postulaciones p
          LEFT JOIN enfasis e  ON e.id_enfasis = p.id_enfasis
          LEFT JOIN materias m ON m.id_materia = p.id_materia
          LEFT JOIN docentes d ON d.id_docente = p.id_docente
         WHERE p.id_institucion = l_inst
           AND p.anio = l_anio
           AND NVL(p.estado, 'Activo') <> 'Inactivo'
         ORDER BY p.turno, nro_item
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('nro_item',        r.nro_item);
      APEX_JSON.WRITE('id',              r.id_postulacion);
      APEX_JSON.WRITE('turno',           r.turno);
      APEX_JSON.WRITE('seccion',         r.seccion);
      APEX_JSON.WRITE('g2',  r.g2);  APEX_JSON.WRITE('g3',  r.g3);  APEX_JSON.WRITE('g4',  r.g4);
      APEX_JSON.WRITE('g5',  r.g5);  APEX_JSON.WRITE('g6',  r.g6);  APEX_JSON.WRITE('g7',  r.g7);
      APEX_JSON.WRITE('g8',  r.g8);  APEX_JSON.WRITE('g9',  r.g9);
      APEX_JSON.WRITE('g1m', r.g1m); APEX_JSON.WRITE('g2m', r.g2m); APEX_JSON.WRITE('g3m', r.g3m);
      APEX_JSON.WRITE('enfasis',   r.enfasis);
      APEX_JSON.WRITE('ser',       r.ser);       APEX_JSON.WRITE('hacer',     r.hacer);
      APEX_JSON.WRITE('tener',     r.tener);     APEX_JSON.WRITE('caracter',  r.caracter);
      APEX_JSON.WRITE('vision',    r.vision);    APEX_JSON.WRITE('coraje',    r.coraje);
      APEX_JSON.WRITE('liderazgo', r.liderazgo);
      APEX_JSON.WRITE('lunes_desde',     r.lunes_desde);
      APEX_JSON.WRITE('lunes_hasta',     r.lunes_hasta);
      APEX_JSON.WRITE('martes_desde',    r.martes_desde);
      APEX_JSON.WRITE('martes_hasta',    r.martes_hasta);
      APEX_JSON.WRITE('miercoles_desde', r.miercoles_desde);
      APEX_JSON.WRITE('miercoles_hasta', r.miercoles_hasta);
      APEX_JSON.WRITE('jueves_desde',    r.jueves_desde);
      APEX_JSON.WRITE('jueves_hasta',    r.jueves_hasta);
      APEX_JSON.WRITE('viernes_desde',   r.viernes_desde);
      APEX_JSON.WRITE('viernes_hasta',   r.viernes_hasta);
      APEX_JSON.WRITE('materia',         r.materia);
      APEX_JSON.WRITE('docente',         r.docente);
      APEX_JSON.WRITE('telefono',        r.telefono);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('horarios');
    FOR r IN (SELECT turno, observacion,
                     TO_CHAR(hora_inicio, 'HH24:MI') AS hora_inicio,
                     TO_CHAR(hora_fin, 'HH24:MI')    AS hora_fin, total
                FROM horario_instituciones
               WHERE id_institucion = l_inst AND anio = l_anio
               ORDER BY turno, TO_CHAR(hora_inicio, 'HH24:MI')) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('turno',       r.turno);
      APEX_JSON.WRITE('hora_inicio', r.hora_inicio);
      APEX_JSON.WRITE('hora_fin',    r.hora_fin);
      APEX_JSON.WRITE('total',       r.total);
      APEX_JSON.WRITE('observacion', r.observacion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END formulario;

  /* ---------------------------------------------------------------------- */
  /* CAMBIAR ESTADO                                                         */
  /* ---------------------------------------------------------------------- */

  PROCEDURE cambiar_estado(
    p_token      IN VARCHAR2,
    p_id         IN VARCHAR2,
    p_estado     IN VARCHAR2,
    p_obs_estado IN VARCHAR2)
  IS
    l_id     NUMBER := f_numero(p_id);
    l_estado VARCHAR2(32767) := TRIM(p_estado);
    l_obs    VARCHAR2(32767) := TRIM(p_obs_estado);
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de postulacion invalido'); RETURN;
    END IF;
    IF LENGTH(l_estado) > 50 THEN
      p_error(400, 'Bad Request', 'El estado no es valido'); RETURN;
    END IF;
    IF LENGTH(l_obs) > 2000 THEN
      p_error(400, 'Bad Request', 'La observacion no puede pasar de 2000 caracteres'); RETURN;
    END IF;

    UPDATE postulaciones SET estado = l_estado, obs_estado = l_obs
     WHERE id_postulacion = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'La postulacion no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Estado actualizado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END cambiar_estado;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR Y ELIMINAR (la grilla de la 38)                                */
  /* ---------------------------------------------------------------------- */

  -- Entero >= 0, o NULL si viene vacio. -1 si no es un numero valido.
  FUNCTION f_cantidad(p_v IN APEX_JSON.T_VALUES, p_path IN VARCHAR2) RETURN NUMBER IS
    l_t VARCHAR2(4000);
    l_n NUMBER;
  BEGIN
    l_t := TRIM(APEX_JSON.GET_VARCHAR2(p_path => p_path, p_values => p_v));
    IF l_t IS NULL THEN RETURN NULL; END IF;
    l_n := TO_NUMBER(l_t);
    RETURN CASE WHEN l_n >= 0 AND l_n = TRUNC(l_n) AND l_n <= 99999 THEN l_n ELSE -1 END;
  EXCEPTION
    WHEN OTHERS THEN RETURN -1;
  END f_cantidad;

  -- 'HH:MM' sobre el 01/01/2025 (como TRG_POSTULACIONES_SET_FEC_HORA), NULL si
  -- viene vacio. p_ok queda FALSE si viene algo que no es una hora.
  FUNCTION f_hora(p_v IN APEX_JSON.T_VALUES, p_path IN VARCHAR2, p_ok IN OUT BOOLEAN)
    RETURN DATE IS
    l_t VARCHAR2(4000);
  BEGIN
    l_t := TRIM(APEX_JSON.GET_VARCHAR2(p_path => p_path, p_values => p_v));
    IF l_t IS NULL THEN RETURN NULL; END IF;
    IF NOT REGEXP_LIKE(l_t, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$') THEN
      p_ok := FALSE; RETURN NULL;
    END IF;
    RETURN TO_DATE('01/01/2025 ' || l_t, 'DD/MM/YYYY HH24:MI');
  END f_hora;

  ------------------------------------------------------------------------------
  -- Una fila de la grilla, como el IG editable de la 38: todas sus columnas
  -- visibles. Las ocultas (NOMBRE_PROFESOR, TELEFONO, ID_PRE_HORARIO, ANIO) no
  -- se tocan en una modificacion. Ojo, como en APEX: si la fila salio de un
  -- pre-horario y despues se modifica ese pre-horario, TRG_POSTULACIONES la
  -- vuelve a generar y estos cambios se pierden.
  ------------------------------------------------------------------------------
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_datos IN CLOB) IS
    v        APEX_JSON.T_VALUES;
    l_id     NUMBER := f_numero(p_id);
    l_inst   NUMBER;
    l_ok     BOOLEAN := TRUE;
    l_g2  NUMBER; l_g3  NUMBER; l_g4  NUMBER; l_g5  NUMBER; l_g6  NUMBER; l_g7 NUMBER;
    l_g8  NUMBER; l_g9  NUMBER; l_g1m NUMBER; l_g2m NUMBER; l_g3m NUMBER;
    l_ser NUMBER; l_hac NUMBER; l_ten NUMBER; l_car NUMBER; l_vis NUMBER; l_cor NUMBER;
    l_lid NUMBER;
    l_lud DATE; l_luh DATE; l_mad DATE; l_mah DATE; l_mid DATE; l_mih DATE;
    l_jud DATE; l_juh DATE; l_vid DATE; l_vih DATE;
    l_turno   NUMBER;
    l_seccion VARCHAR2(32767);
    l_obs     VARCHAR2(32767);
    l_estado  VARCHAR2(32767);
    l_obs_est VARCHAR2(32767);
    l_materia NUMBER; l_docente NUMBER; l_fac NUMBER; l_enfasis NUMBER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de postulacion invalido'); RETURN;
    END IF;
    BEGIN
      APEX_JSON.PARSE(v, p_datos);
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'Los datos de la fila no son un JSON valido'); RETURN;
    END;

    l_inst    := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'id_institucion', p_values => v));
    l_turno   := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'turno', p_values => v));
    l_seccion := UPPER(TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'seccion', p_values => v)));
    l_obs     := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'observacion', p_values => v));
    l_estado  := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'estado', p_values => v));
    l_obs_est := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'obs_estado', p_values => v));
    l_materia := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'id_materia', p_values => v));
    l_docente := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'id_docente', p_values => v));
    l_fac     := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'id_facilitador', p_values => v));
    l_enfasis := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'id_enfasis', p_values => v));

    l_g2  := f_cantidad(v, 'g2');  l_g3  := f_cantidad(v, 'g3');  l_g4  := f_cantidad(v, 'g4');
    l_g5  := f_cantidad(v, 'g5');  l_g6  := f_cantidad(v, 'g6');  l_g7  := f_cantidad(v, 'g7');
    l_g8  := f_cantidad(v, 'g8');  l_g9  := f_cantidad(v, 'g9');  l_g1m := f_cantidad(v, 'g1m');
    l_g2m := f_cantidad(v, 'g2m'); l_g3m := f_cantidad(v, 'g3m');
    l_ser := f_cantidad(v, 'ser');      l_hac := f_cantidad(v, 'hacer');
    l_ten := f_cantidad(v, 'tener');    l_car := f_cantidad(v, 'caracter');
    l_vis := f_cantidad(v, 'vision');   l_cor := f_cantidad(v, 'coraje');
    l_lid := f_cantidad(v, 'liderazgo');
    IF -1 IN (NVL(l_g2, 0), NVL(l_g3, 0), NVL(l_g4, 0), NVL(l_g5, 0), NVL(l_g6, 0),
              NVL(l_g7, 0), NVL(l_g8, 0), NVL(l_g9, 0), NVL(l_g1m, 0), NVL(l_g2m, 0),
              NVL(l_g3m, 0), NVL(l_ser, 0), NVL(l_hac, 0), NVL(l_ten, 0), NVL(l_car, 0),
              NVL(l_vis, 0), NVL(l_cor, 0), NVL(l_lid, 0)) THEN
      p_error(400, 'Bad Request', 'Las cantidades tienen que ser numeros enteros'); RETURN;
    END IF;

    l_lud := f_hora(v, 'lunes_desde', l_ok);     l_luh := f_hora(v, 'lunes_hasta', l_ok);
    l_mad := f_hora(v, 'martes_desde', l_ok);    l_mah := f_hora(v, 'martes_hasta', l_ok);
    l_mid := f_hora(v, 'miercoles_desde', l_ok); l_mih := f_hora(v, 'miercoles_hasta', l_ok);
    l_jud := f_hora(v, 'jueves_desde', l_ok);    l_juh := f_hora(v, 'jueves_hasta', l_ok);
    l_vid := f_hora(v, 'viernes_desde', l_ok);   l_vih := f_hora(v, 'viernes_hasta', l_ok);
    IF NOT l_ok THEN
      p_error(400, 'Bad Request', 'Las horas van como HH:MM'); RETURN;
    END IF;
    IF (l_lud >= l_luh) OR (l_mad >= l_mah) OR (l_mid >= l_mih) OR (l_jud >= l_juh)
       OR (l_vid >= l_vih) THEN
      p_error(400, 'Bad Request', 'En cada dia, la hora hasta tiene que ser posterior a la desde');
      RETURN;
    END IF;
    IF LENGTH(l_seccion) > 5 THEN
      p_error(400, 'Bad Request', 'La seccion no puede pasar de 5 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_obs) > 1000 THEN
      p_error(400, 'Bad Request', 'La observacion no puede pasar de 1000 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_estado) > 50 OR LENGTH(l_obs_est) > 2000 THEN
      p_error(400, 'Bad Request', 'El estado o su observacion son demasiado largos'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      IF l_inst IS NULL THEN
        p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
      END IF;
      -- Sin ANIO: lo pone TRG_POSTULACIONES_SET_ANIO (el lectivo actual).
      INSERT INTO postulaciones (
        id_institucion, turno, seccion, "2", "3", "4", "5", "6", "7", "8", "9", "1M", "2M", "3M",
        ser, hacer, tener, caracter, vision, coraje, liderazgo,
        lunes_desde, lunes_hasta, martes_desde, martes_hasta, miercoles_desde, miercoles_hasta,
        jueves_desde, jueves_hasta, viernes_desde, viernes_hasta,
        observacion, id_materia, id_docente, id_facilitador, id_enfasis, estado, obs_estado)
      VALUES (
        l_inst, l_turno, l_seccion, l_g2, l_g3, l_g4, l_g5, l_g6, l_g7, l_g8, l_g9,
        l_g1m, l_g2m, l_g3m,
        l_ser, l_hac, l_ten, l_car, l_vis, l_cor, l_lid,
        l_lud, l_luh, l_mad, l_mah, l_mid, l_mih, l_jud, l_juh, l_vid, l_vih,
        l_obs, l_materia, l_docente, l_fac, l_enfasis, l_estado, l_obs_est)
      RETURNING id_postulacion INTO l_id;
    ELSE
      UPDATE postulaciones
         SET turno = l_turno, seccion = l_seccion,
             "2" = l_g2, "3" = l_g3, "4" = l_g4, "5" = l_g5, "6" = l_g6, "7" = l_g7,
             "8" = l_g8, "9" = l_g9, "1M" = l_g1m, "2M" = l_g2m, "3M" = l_g3m,
             ser = l_ser, hacer = l_hac, tener = l_ten, caracter = l_car, vision = l_vis,
             coraje = l_cor, liderazgo = l_lid,
             lunes_desde = l_lud, lunes_hasta = l_luh, martes_desde = l_mad,
             martes_hasta = l_mah, miercoles_desde = l_mid, miercoles_hasta = l_mih,
             jueves_desde = l_jud, jueves_hasta = l_juh, viernes_desde = l_vid,
             viernes_hasta = l_vih,
             observacion = l_obs, id_materia = l_materia, id_docente = l_docente,
             id_facilitador = l_fac, id_enfasis = l_enfasis, estado = l_estado,
             obs_estado = l_obs_est
       WHERE id_postulacion = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'La postulacion no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Postulacion agregada'
                                    ELSE 'Postulacion actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      IF SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La materia, el docente, el facilitador o el enfasis no existe');
      ELSIF SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
      ELSE
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
      END IF;
  END guardar;

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id   NUMBER := f_numero(p_id);
    l_inst NUMBER;
    l_usos t_usos;
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de postulacion invalido'); RETURN;
    END IF;
    BEGIN
      SELECT id_institucion INTO l_inst FROM postulaciones WHERE id_postulacion = l_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La postulacion no existe'); RETURN;
    END;
    cargar_usos(l_usos, l_inst);
    IF l_usos.EXISTS(l_id) THEN
      p_error(409, 'Conflict', 'No se puede eliminar: tiene ' || l_usos(l_id)
              || ' intervencion(es) o evaluacion(es)'); RETURN;
    END IF;

    DELETE FROM postulaciones WHERE id_postulacion = l_id;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Postulacion eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      IF SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que la usan');
      ELSE
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
      END IF;
  END eliminar;

END PKG_POSTULACIONES_ETHOS;
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
  FOR r IN (SELECT 'postulaciones' AS p FROM dual
            UNION ALL SELECT 'postulaciones/opciones' FROM dual
            UNION ALL SELECT 'postulaciones/formulario' FROM dual
            UNION ALL SELECT 'postulaciones/:id' FROM dual
            UNION ALL SELECT 'postulaciones/:id/estado' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'postulaciones',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'postulaciones/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'postulaciones/formulario',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'postulaciones/:id',
                       p_priority => 1, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'postulaciones/:id/estado',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('postulaciones', 'GET', '
    PKG_POSTULACIONES_ETHOS.LISTAR(
        p_token => l_token, p_id_institucion => :id_institucion, p_anio => :anio);');

  handler('postulaciones/opciones', 'GET', '
    PKG_POSTULACIONES_ETHOS.OPCIONES(p_token => l_token);');

  handler('postulaciones/formulario', 'GET', '
    PKG_POSTULACIONES_ETHOS.FORMULARIO(
        p_token => l_token, p_id_institucion => :id_institucion, p_anio => :anio);');

  handler('postulaciones', 'POST', '
    PKG_POSTULACIONES_ETHOS.GUARDAR(p_token => l_token, p_id => NULL, p_datos => :datos);');

  handler('postulaciones/:id', 'PUT', '
    PKG_POSTULACIONES_ETHOS.GUARDAR(p_token => l_token, p_id => :id, p_datos => :datos);');

  handler('postulaciones/:id', 'DELETE', '
    PKG_POSTULACIONES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('postulaciones/:id/estado', 'PUT', '
    PKG_POSTULACIONES_ETHOS.CAMBIAR_ESTADO(
        p_token => l_token, p_id => :id, p_estado => :estado, p_obs_estado => :obs_estado);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de postulaciones publicados.');
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
  preflight('postulaciones');
  preflight('postulaciones/opciones');
  preflight('postulaciones/formulario');
  preflight('postulaciones/:id');
  preflight('postulaciones/:id/estado');
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
   WHERE object_name = 'PKG_POSTULACIONES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_POSTULACIONES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    postulaciones?id_institucion=&anio=');
    DBMS_OUTPUT.PUT_LINE('       GET    postulaciones/opciones');
    DBMS_OUTPUT.PUT_LINE('       GET    postulaciones/formulario?id_institucion=&anio=');
    DBMS_OUTPUT.PUT_LINE('       POST   postulaciones');
    DBMS_OUTPUT.PUT_LINE('       PUT    postulaciones/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE postulaciones/:id');
    DBMS_OUTPUT.PUT_LINE('       PUT    postulaciones/:id/estado');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_POSTULACIONES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_POSTULACIONES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_POSTULACIONES_ETHOS no se creo.');
END;
/
