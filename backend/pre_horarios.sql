--------------------------------------------------------------------------------
-- PRE_HORARIOS  —  la planificacion del anio de cada institucion
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio al modal 43 de APEX (Pre Horarios, el boton "Pre
-- Postulacion" del 21). En el sitio es la pestana Pre-horarios de
-- /instituciones/:id, con los permisos de la 16.
--
-- Un pre-horario es UNA clase de la semana: turno, grado y seccion, manual,
-- cuantos alumnos, dia y horas, materia, docente y facilitador. Al
-- CONFIRMARLO (ESTADO = 'SI') se convierte en una postulacion: lo hace el
-- trigger TRG_POSTULACIONES de esta tabla (ya estaba, no se toca; ver abajo).
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     pre-horarios?id_institucion=&anio=  los de una institucion y anio
--                                               (sin anio: el lectivo actual)
--   GET     pre-horarios/opciones               turnos y "confirmado" (listas
--                                               de APEX), materias, enfasis y
--                                               docentes
--   POST    pre-horarios          {id_institucion, turno, grado, seccion,
--                                  id_enfasis, cantidad_alumnos, manual, dia,
--                                  hora_desde, hora_hasta, id_materia,
--                                  id_docente, telefono, id_facilitador,
--                                  observacion, estado} -> {id}
--   PUT     pre-horarios/:id      lo mismo
--   DELETE  pre-horarios/:id
--   POST    pre-horarios/confirmar  {id_institucion, ids, estado} confirma (o
--                                   des-confirma) varios de una vez
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql, anios_lectivos.sql e
-- instituciones.sql. La pantalla lee tambien GET facilitadores y GET
-- postulaciones (postulaciones.sql).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- TRG_POSTULACIONES: CONFIRMAR CREA LA POSTULACION
--------------------------------------------------------------------------------
--
-- El trigger de PRE_HORARIOS (verificado el 09/10/2026):
--
--   - INSERT con ESTADO 'SI'  -> inserta una POSTULACION con ID_PRE_HORARIO,
--                                la cantidad en la columna de su GRADO y de su
--                                MANUAL, y las horas en las de su DIA.
--   - UPDATE                  -> BORRA la postulacion del pre-horario y, si
--                                sigue en 'SI', la vuelve a crear (otro id).
--   - DELETE                  -> borra la postulacion.
--
-- Dos consecuencias que este paquete cuida:
--
--   1. El trigger hace CASE sobre GRADO, DIA y MANUAL SIN ELSE: un valor
--      vacio o desconocido da ORA-06592 al confirmar. Por eso los tres son
--      OBLIGATORIOS y se validan contra las listas de la pagina 43 (APEX no
--      los pedia).
--
--   2. EVALUACIONES_FACILITADORES e INTERVENCIONES tienen FK a POSTULACIONES.
--      Si la postulacion de un pre-horario ya tiene intervenciones o
--      evaluaciones, el trigger no puede borrarla: modificar o borrar ESE
--      pre-horario falla (en APEX tambien). El listado lo marca (`bloqueado`)
--      y guardar/eliminar lo rechaza antes, con un mensaje claro, en vez del
--      ORA-02292 envuelto en el -20001 del trigger.
--
-- La postulacion nueva toma el anio lectivo ACTUAL (TRG_POSTULACIONES_SET_ANIO),
-- no el del pre-horario: por eso la pantalla solo deja editar los del anio
-- actual.
--
--------------------------------------------------------------------------------
-- LAS LISTAS
--------------------------------------------------------------------------------
--
-- GRADO, DIA y MANUAL eran listas ESTATICAS del IG de la 43 (no compartidas):
--
--   GRADO   2 3 4 5 6 7 8 9 1M 2M 3M        (se muestran 2o, 3o... 1M)
--   DIA     LUNES MARTES MIERCOLES JUEVES VIERNES
--   MANUAL  SER HACER TENER CARACTER VISION CORAJE LIDERAZGO
--
-- Estan escritas en el front (lib/postulaciones.ts) y aca, para validar. Las
-- compartidas (turno, confirmado) se leen de APEX como en facilitadores.sql;
-- materias, enfasis y docentes, de sus tablas (MATERIAS.DESCRIPCION,
-- ENFASIS.DESCRIPCION, DOCENTES.NOMBRE_APELLIDO, NRO_TELEFONO y ACTIVO; estructura
-- verificada el 09/10/2026).
--
-- Las horas viajan 'HH:MM' y se guardan sobre el 01/01/2025, como en
-- horario_instituciones.sql. Si no viene telefono y hay docente, se usa el del
-- docente (en APEX lo copiaba una accion dinamica al elegirlo).
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET pide solo sesion. Escribir pide ACTUALIZAR en /instituciones (la 16):
--   el modal 43 colgaba del 21 y no tiene pagina propia en el menu.
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

  FOR t IN (SELECT 'PRE_HORARIOS' AS tabla FROM dual
            UNION ALL SELECT 'POSTULACIONES' FROM dual
            UNION ALL SELECT 'DOCENTES' FROM dual
            UNION ALL SELECT 'MATERIAS' FROM dual
            UNION ALL SELECT 'ENFASIS' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.tabla;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.tabla || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.tabla || ' encontrada.');
    END IF;
  END LOOP;

  FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
              WHERE table_name = 'PRE_HORARIOS' ORDER BY trigger_name) LOOP
    DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
  END LOOP;

  -- Lo que bloquea modificar un pre-horario confirmado (ver el encabezado).
  FOR f IN (SELECT DISTINCT c.table_name
              FROM user_constraints c
             WHERE c.constraint_type = 'R'
               AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                            WHERE table_name = 'POSTULACIONES'
                                              AND constraint_type IN ('P', 'U'))
               AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
             ORDER BY c.table_name) LOOP
    DBMS_OUTPUT.PUT_LINE('       ' || f.table_name || ' usa POSTULACIONES (bloquea modificar el pre-horario)');
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_PRE_HORARIOS_ETHOS AS

  -- Los de una institucion y anio (sin p_anio: el lectivo actual).
  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_anio IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion. Horas 'HH:MM'.
  PROCEDURE guardar(
    p_token            IN VARCHAR2,
    p_id               IN VARCHAR2,
    p_id_institucion   IN VARCHAR2,
    p_turno            IN VARCHAR2,
    p_grado            IN VARCHAR2,
    p_seccion          IN VARCHAR2,
    p_id_enfasis       IN VARCHAR2,
    p_cantidad_alumnos IN VARCHAR2,
    p_manual           IN VARCHAR2,
    p_dia              IN VARCHAR2,
    p_hora_desde       IN VARCHAR2,
    p_hora_hasta       IN VARCHAR2,
    p_id_materia       IN VARCHAR2,
    p_id_docente       IN VARCHAR2,
    p_telefono         IN VARCHAR2,
    p_id_facilitador   IN VARCHAR2,
    p_observacion      IN VARCHAR2,
    p_estado           IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- p_ids: ids separados por coma. p_estado: 'SI' o 'NO'.
  PROCEDURE confirmar(
    p_token          IN VARCHAR2,
    p_id_institucion IN VARCHAR2,
    p_ids            IN VARCHAR2,
    p_estado         IN VARCHAR2);

END PKG_PRE_HORARIOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_PRE_HORARIOS_ETHOS AS

  c_ruta      CONSTANT VARCHAR2(20) := '/instituciones';
  c_app_id    CONSTANT NUMBER       := 40587;
  c_workspace CONSTANT VARCHAR2(64) := 'FUNDCARAC';
  c_fecha     CONSTANT VARCHAR2(10) := '01/01/2025';

  -- Las listas estaticas de la pagina 43, entre comas para buscar con INSTR.
  c_grados    CONSTANT VARCHAR2(100) := ',2,3,4,5,6,7,8,9,1M,2M,3M,';
  c_dias      CONSTANT VARCHAR2(100) := ',LUNES,MARTES,MIERCOLES,JUEVES,VIERNES,';
  c_manuales  CONSTANT VARCHAR2(100) := ',SER,HACER,TENER,CARACTER,VISION,CORAJE,LIDERAZGO,';

  -- Cuantos usos (intervenciones, evaluaciones) tiene cada postulacion.
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

  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -1 THEN
        p_error(409, 'Conflict',
                'Ya hay un pre-horario igual (mismo turno, grado, seccion, enfasis, cantidad, '
                || 'manual y dia)');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La materia, el enfasis o el facilitador elegido no existe');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
      WHEN SQLCODE = -20001 THEN
        -- RAISE_APPLICATION_ERROR de TRG_POSTULACIONES (ver el encabezado).
        IF INSTR(SQLERRM, 'ORA-02292') > 0 THEN
          p_error(409, 'Conflict',
                  'Su postulacion ya tiene intervenciones o evaluaciones: no se puede modificar');
        ELSE
          p_error(409, 'Conflict', 'No se pudo generar la postulacion: ' || SQLERRM);
        END IF;
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

  -- 'HH:MM' (24 h) sobre c_fecha, o NULL.
  FUNCTION f_hora(p_txt IN VARCHAR2) RETURN DATE IS
    l_t VARCHAR2(4000) := TRIM(p_txt);
  BEGIN
    IF l_t IS NULL OR NOT REGEXP_LIKE(l_t, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$') THEN
      RETURN NULL;
    END IF;
    RETURN TO_DATE(c_fecha || ' ' || l_t, 'DD/MM/YYYY HH24:MI');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_hora;

  FUNCTION f_anio RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_anio;

  -- Si p_valor esta en la lista p_lista (',A,B,C,').
  FUNCTION en_lista(p_valor IN VARCHAR2, p_lista IN VARCHAR2) RETURN BOOLEAN IS
  BEGIN
    RETURN p_valor IS NOT NULL AND INSTR(p_lista, ',' || p_valor || ',') > 0;
  END en_lista;

  -- Sesion + permiso: escribir pide actualizar en /instituciones.
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
         OR PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, 'U') <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para modificar los pre-horarios');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  ------------------------------------------------------------------------------
  -- Cuantas filas de otras tablas usan cada postulacion de la institucion (las
  -- FK de una columna hacia POSTULACIONES, salvo las _JN). Si p_id_postulacion
  -- viene, solo esa.
  ------------------------------------------------------------------------------
  PROCEDURE cargar_usos(
    p_usos           OUT t_usos,
    p_id_institucion IN NUMBER,
    p_id_postulacion IN NUMBER DEFAULT NULL)
  IS
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
        || '                          WHERE id_institucion = :i'
        || '                            AND (:p IS NULL OR id_postulacion = :p2))'
        || ' GROUP BY ' || l_col
        BULK COLLECT INTO l_ids, l_cnts USING p_id_institucion, p_id_postulacion, p_id_postulacion;
      FOR j IN 1 .. l_ids.COUNT LOOP
        p_usos(l_ids(j)) := CASE WHEN p_usos.EXISTS(l_ids(j)) THEN p_usos(l_ids(j)) ELSE 0 END
                            + l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_usos;

  -- Cuantos usos tienen las postulaciones del pre-horario p_id (0 si ninguna).
  FUNCTION usos_de(p_id IN NUMBER) RETURN PLS_INTEGER IS
    l_usos t_usos;
    l_inst NUMBER;
    l_tot  PLS_INTEGER := 0;
  BEGIN
    SELECT id_institucion INTO l_inst FROM pre_horarios WHERE id_pre_horario = p_id;
    cargar_usos(l_usos, l_inst);
    FOR p IN (SELECT id_postulacion FROM postulaciones WHERE id_pre_horario = p_id) LOOP
      IF l_usos.EXISTS(p.id_postulacion) THEN
        l_tot := l_tot + l_usos(p.id_postulacion);
      END IF;
    END LOOP;
    RETURN l_tot;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN 0;
  END usos_de;

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
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT ph.id_pre_horario, ph.turno, ph.grado, ph.seccion, ph.id_enfasis,
               e.descripcion AS enfasis, ph.cantidad_alumnos, ph.manual, ph.dia,
               TO_CHAR(ph.hora_desde, 'HH24:MI') AS hora_desde,
               TO_CHAR(ph.hora_hasta, 'HH24:MI') AS hora_hasta,
               ph.id_materia, m.descripcion AS materia,
               ph.id_docente, COALESCE(d.nombre_apellido, ph.nombre_profesor) AS docente,
               TRIM(d.nro_telefono) AS docente_telefono, ph.telefono,
               ph.id_facilitador, f.nombre_apellido AS facilitador,
               ph.observacion, ph.estado, ph.anio,
               (SELECT MIN(p.id_postulacion) FROM postulaciones p
                 WHERE p.id_pre_horario = ph.id_pre_horario) AS id_postulacion
          FROM pre_horarios ph
          LEFT JOIN enfasis e       ON e.id_enfasis = ph.id_enfasis
          LEFT JOIN materias m      ON m.id_materia = ph.id_materia
          LEFT JOIN docentes d      ON d.id_docente = ph.id_docente
          LEFT JOIN facilitadores f ON f.id_facilitador = ph.id_facilitador
         WHERE ph.id_institucion = l_inst
           AND (ph.anio = l_anio OR (l_anio IS NULL AND ph.anio IS NULL))
         ORDER BY INSTR(c_dias, ',' || ph.dia || ','), TO_CHAR(ph.hora_desde, 'HH24:MI'),
                  ph.turno, ph.grado, ph.seccion
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',               r.id_pre_horario);
      APEX_JSON.WRITE('turno',            r.turno);
      APEX_JSON.WRITE('grado',            r.grado);
      APEX_JSON.WRITE('seccion',          r.seccion);
      APEX_JSON.WRITE('id_enfasis',       r.id_enfasis);
      APEX_JSON.WRITE('enfasis',          r.enfasis);
      APEX_JSON.WRITE('cantidad_alumnos', r.cantidad_alumnos);
      APEX_JSON.WRITE('manual',           r.manual);
      APEX_JSON.WRITE('dia',              r.dia);
      APEX_JSON.WRITE('hora_desde',       r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',       r.hora_hasta);
      APEX_JSON.WRITE('id_materia',       r.id_materia);
      APEX_JSON.WRITE('materia',          r.materia);
      APEX_JSON.WRITE('id_docente',       r.id_docente);
      APEX_JSON.WRITE('docente',          r.docente);
      APEX_JSON.WRITE('docente_telefono', r.docente_telefono);
      APEX_JSON.WRITE('telefono',         r.telefono);
      APEX_JSON.WRITE('id_facilitador',   r.id_facilitador);
      APEX_JSON.WRITE('facilitador',      r.facilitador);
      APEX_JSON.WRITE('observacion',      r.observacion);
      APEX_JSON.WRITE('estado',           r.estado);
      APEX_JSON.WRITE('anio',             r.anio);
      APEX_JSON.WRITE('id_postulacion',   r.id_postulacion);
      APEX_JSON.WRITE('usos', CASE WHEN r.id_postulacion IS NOT NULL
                                    AND l_usos.EXISTS(r.id_postulacion)
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

  -- Igual que en facilitadores.sql (ver escribir_lista ahi).
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
    APEX_JSON.WRITE('anio_actual', f_anio);
    escribir_lista('turno', NULL, 86501754240348596707,
      'SELECT TO_CHAR(turno) FROM (SELECT DISTINCT turno FROM pre_horarios'
      || ' WHERE turno IS NOT NULL) ORDER BY turno');
    -- "Confirmado" del IG de la 43. Si la lista no se lee, SI / NO: es lo que
    -- compara TRG_POSTULACIONES.
    escribir_lista('estado', NULL, 85622367482902737331,
      'SELECT v FROM (SELECT ''SI'' v FROM dual UNION ALL SELECT ''NO'' FROM dual)');

    APEX_JSON.OPEN_ARRAY('materias');
    FOR r IN (SELECT id_materia, descripcion FROM materias ORDER BY UPPER(descripcion)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_materia);
      APEX_JSON.WRITE('nombre', r.descripcion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('enfasis');
    FOR r IN (SELECT id_enfasis, descripcion FROM enfasis ORDER BY UPPER(descripcion)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_enfasis);
      APEX_JSON.WRITE('nombre', r.descripcion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('docentes');
    -- DOCENTES.ACTIVO (VARCHAR2(2) NOT NULL): activo si empieza con S, el mismo
    -- criterio que facilitadores.sql. La pantalla ofrece los activos y el que
    -- ya estaba elegido.
    FOR r IN (SELECT id_docente, nombre_apellido, TRIM(nro_telefono) AS nro_telefono,
                     CASE WHEN UPPER(SUBSTR(TRIM(activo), 1, 1)) = 'S' THEN 'S' ELSE 'N' END
                       AS es_activo
                FROM docentes ORDER BY UPPER(nombre_apellido)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_docente);
      APEX_JSON.WRITE('nombre', r.nombre_apellido);
      APEX_JSON.WRITE('telefono', r.nro_telefono);
      APEX_JSON.WRITE('es_activo', r.es_activo);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(
    p_token            IN VARCHAR2,
    p_id               IN VARCHAR2,
    p_id_institucion   IN VARCHAR2,
    p_turno            IN VARCHAR2,
    p_grado            IN VARCHAR2,
    p_seccion          IN VARCHAR2,
    p_id_enfasis       IN VARCHAR2,
    p_cantidad_alumnos IN VARCHAR2,
    p_manual           IN VARCHAR2,
    p_dia              IN VARCHAR2,
    p_hora_desde       IN VARCHAR2,
    p_hora_hasta       IN VARCHAR2,
    p_id_materia       IN VARCHAR2,
    p_id_docente       IN VARCHAR2,
    p_telefono         IN VARCHAR2,
    p_id_facilitador   IN VARCHAR2,
    p_observacion      IN VARCHAR2,
    p_estado           IN VARCHAR2)
  IS
    -- 32767: ver sucursales.sql. Los topes reales se validan abajo.
    l_grado   VARCHAR2(32767) := UPPER(TRIM(p_grado));
    l_seccion VARCHAR2(32767) := UPPER(TRIM(p_seccion));
    l_manual  VARCHAR2(32767) := UPPER(TRIM(p_manual));
    l_dia     VARCHAR2(32767) := UPPER(TRIM(p_dia));
    l_tel     VARCHAR2(32767) := TRIM(p_telefono);
    l_obs     VARCHAR2(32767) := TRIM(p_observacion);
    l_estado  VARCHAR2(32767) := NVL(UPPER(TRIM(p_estado)), 'NO');
    l_id      NUMBER := f_numero(p_id);
    l_inst    NUMBER := f_numero(p_id_institucion);
    l_turno   NUMBER := f_numero(p_turno);
    l_enfasis NUMBER := f_numero(p_id_enfasis);
    l_materia NUMBER := f_numero(p_id_materia);
    l_docente NUMBER := f_numero(p_id_docente);
    l_fac     NUMBER := f_numero(p_id_facilitador);
    l_desde   DATE   := f_hora(p_hora_desde);
    l_hasta   DATE   := f_hora(p_hora_hasta);
    l_cant    NUMBER;
    l_anio    VARCHAR2(16);
    l_n       PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de pre-horario invalido'); RETURN;
    END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    IF l_turno IS NULL THEN
      p_error(400, 'Bad Request', 'El turno es obligatorio'); RETURN;
    END IF;
    -- Obligatorios aca: el CASE del trigger no tiene ELSE (ver el encabezado).
    IF NOT en_lista(l_grado, c_grados) THEN
      p_error(400, 'Bad Request', 'El grado es obligatorio (2 a 9, 1M, 2M o 3M)'); RETURN;
    END IF;
    IF NOT en_lista(l_dia, c_dias) THEN
      p_error(400, 'Bad Request', 'El dia es obligatorio (de LUNES a VIERNES)'); RETURN;
    END IF;
    IF NOT en_lista(l_manual, c_manuales) THEN
      p_error(400, 'Bad Request', 'El manual es obligatorio'); RETURN;
    END IF;
    IF l_desde IS NULL OR l_hasta IS NULL THEN
      p_error(400, 'Bad Request', 'La hora desde y la hora hasta son obligatorias (HH:MM)'); RETURN;
    END IF;
    IF l_hasta <= l_desde THEN
      p_error(400, 'Bad Request', 'La hora hasta tiene que ser posterior a la hora desde'); RETURN;
    END IF;
    IF l_estado NOT IN ('SI', 'NO') THEN
      p_error(400, 'Bad Request', 'Confirmado tiene que ser SI o NO'); RETURN;
    END IF;
    IF LENGTH(l_seccion) > 8 THEN
      p_error(400, 'Bad Request', 'La seccion no puede pasar de 8 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_tel) > 2000 OR LENGTH(l_obs) > 2000 THEN
      p_error(400, 'Bad Request', 'Telefono y observacion no pueden pasar de 2000 caracteres');
      RETURN;
    END IF;
    IF TRIM(p_cantidad_alumnos) IS NOT NULL THEN
      BEGIN
        l_cant := TO_NUMBER(TRIM(p_cantidad_alumnos));
      EXCEPTION
        WHEN OTHERS THEN l_cant := -1;
      END;
      IF l_cant < 0 OR l_cant <> TRUNC(l_cant) OR l_cant > 9999 THEN
        p_error(400, 'Bad Request', 'La cantidad de alumnos no es valida'); RETURN;
      END IF;
    END IF;

    -- Sin telefono, el del docente (lo hacia una accion dinamica en APEX).
    IF l_tel IS NULL AND l_docente IS NOT NULL THEN
      BEGIN
        SELECT TRIM(nro_telefono) INTO l_tel FROM docentes WHERE id_docente = l_docente;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'El docente elegido no existe'); RETURN;
      END;
    END IF;

    IF l_id IS NOT NULL THEN
      BEGIN
        SELECT anio INTO l_anio FROM pre_horarios
         WHERE id_pre_horario = l_id AND id_institucion = l_inst;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'El pre-horario no existe'); RETURN;
      END;
      -- Solo los del anio actual: la postulacion regenerada tomaria el actual.
      IF NVL(l_anio, '~') <> NVL(f_anio, '~') THEN
        p_error(409, 'Conflict', 'Solo se modifican los pre-horarios del ' || UNISTR('a\00f1o')
                || ' lectivo actual'); RETURN;
      END IF;
      l_n := usos_de(l_id);
      IF l_n > 0 THEN
        p_error(409, 'Conflict', 'Su postulacion ya tiene ' || l_n || ' intervencion(es) o '
                || 'evaluacion(es): no se puede modificar'); RETURN;
      END IF;
    END IF;

    IF l_id IS NULL THEN
      -- Sin ANIO: lo pone TRG_PRE_HORARIO_SET_ANIO (el lectivo actual).
      INSERT INTO pre_horarios (
        id_institucion, grado, dia, telefono, turno, seccion, estado, cantidad_alumnos,
        id_enfasis, observacion, manual, id_materia, hora_desde, hora_hasta,
        id_facilitador, id_docente)
      VALUES (
        l_inst, l_grado, l_dia, l_tel, l_turno, l_seccion, l_estado, l_cant,
        l_enfasis, l_obs, l_manual, l_materia, l_desde, l_hasta,
        l_fac, l_docente)
      RETURNING id_pre_horario INTO l_id;
    ELSE
      UPDATE pre_horarios
         SET grado = l_grado, dia = l_dia, telefono = l_tel, turno = l_turno,
             seccion = l_seccion, estado = l_estado, cantidad_alumnos = l_cant,
             id_enfasis = l_enfasis, observacion = l_obs, manual = l_manual,
             id_materia = l_materia, hora_desde = l_desde, hora_hasta = l_hasta,
             id_facilitador = l_fac, id_docente = l_docente
       WHERE id_pre_horario = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Pre-horario agregado'
                                    ELSE 'Pre-horario actualizado' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id NUMBER := f_numero(p_id);
    l_n  PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de pre-horario invalido'); RETURN;
    END IF;
    l_n := usos_de(l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Su postulacion ya tiene ' || l_n || ' intervencion(es) o '
              || 'evaluacion(es): no se puede eliminar'); RETURN;
    END IF;

    -- TRG_POSTULACIONES borra su postulacion.
    DELETE FROM pre_horarios WHERE id_pre_horario = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'El pre-horario no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Pre-horario eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* CONFIRMAR VARIOS                                                       */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Cambia ESTADO a SI (o NO) en los pre-horarios p_ids de la institucion, del
  -- anio actual, que no lo tengan ya. Se saltean los bloqueados (su
  -- postulacion tiene usos) y, al confirmar, los que no tienen grado, dia o
  -- manual validos. Todo o nada: si uno falla en el trigger, no cambia ninguno.
  ------------------------------------------------------------------------------
  PROCEDURE confirmar(
    p_token          IN VARCHAR2,
    p_id_institucion IN VARCHAR2,
    p_ids            IN VARCHAR2,
    p_estado         IN VARCHAR2)
  IS
    l_inst    NUMBER := f_numero(p_id_institucion);
    l_estado  VARCHAR2(10) := UPPER(TRIM(p_estado));
    l_anio    VARCHAR2(16) := f_anio;
    l_partes  APEX_T_VARCHAR2;
    l_id      NUMBER;
    l_ok      PLS_INTEGER := 0;
    l_salteo  PLS_INTEGER := 0;
    l_usos    t_usos;
    l_bloq    PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    IF l_estado IS NULL OR l_estado NOT IN ('SI', 'NO') THEN
      p_error(400, 'Bad Request', 'El estado tiene que ser SI o NO'); RETURN;
    END IF;
    cargar_usos(l_usos, l_inst);

    l_partes := APEX_STRING.SPLIT(TRIM(p_ids), ',');
    FOR i IN 1 .. l_partes.COUNT LOOP
      l_id := f_numero(l_partes(i));
      IF l_id IS NOT NULL THEN
        FOR r IN (SELECT ph.id_pre_horario, ph.grado, ph.dia, ph.manual, ph.estado
                    FROM pre_horarios ph
                   WHERE ph.id_pre_horario = l_id AND ph.id_institucion = l_inst
                     AND ph.anio = l_anio) LOOP
          IF NVL(UPPER(TRIM(r.estado)), 'NO') = l_estado THEN
            NULL; -- ya estaba
          ELSE
            l_bloq := 0;
            FOR p IN (SELECT id_postulacion FROM postulaciones
                       WHERE id_pre_horario = r.id_pre_horario) LOOP
              IF l_usos.EXISTS(p.id_postulacion) THEN
                l_bloq := l_bloq + l_usos(p.id_postulacion);
              END IF;
            END LOOP;
            IF l_bloq > 0
               OR (l_estado = 'SI' AND (NOT en_lista(UPPER(r.grado), c_grados)
                                        OR NOT en_lista(UPPER(r.dia), c_dias)
                                        OR NOT en_lista(UPPER(r.manual), c_manuales))) THEN
              l_salteo := l_salteo + 1;
            ELSE
              UPDATE pre_horarios SET estado = l_estado WHERE id_pre_horario = r.id_pre_horario;
              l_ok := l_ok + 1;
            END IF;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('actualizados', l_ok);
    APEX_JSON.WRITE('salteados', l_salteo);
    APEX_JSON.WRITE('message', l_ok || ' pre-horario(s) actualizados');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END confirmar;

END PKG_PRE_HORARIOS_ETHOS;
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

  c_campos CONSTANT VARCHAR2(1000) := '
        p_id_institucion => :id_institucion, p_turno => :turno, p_grado => :grado,
        p_seccion => :seccion, p_id_enfasis => :id_enfasis,
        p_cantidad_alumnos => :cantidad_alumnos, p_manual => :manual, p_dia => :dia,
        p_hora_desde => :hora_desde, p_hora_hasta => :hora_hasta,
        p_id_materia => :id_materia, p_id_docente => :id_docente, p_telefono => :telefono,
        p_id_facilitador => :id_facilitador, p_observacion => :observacion,
        p_estado => :estado);';

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
  FOR r IN (SELECT 'pre-horarios' AS p FROM dual
            UNION ALL SELECT 'pre-horarios/opciones' FROM dual
            UNION ALL SELECT 'pre-horarios/confirmar' FROM dual
            UNION ALL SELECT 'pre-horarios/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'pre-horarios',
                       p_priority => 0, p_etag_type => 'NONE');
  -- Las literales antes que :id, como en facilitadores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'pre-horarios/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'pre-horarios/confirmar',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'pre-horarios/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('pre-horarios', 'GET', '
    PKG_PRE_HORARIOS_ETHOS.LISTAR(
        p_token => l_token, p_id_institucion => :id_institucion, p_anio => :anio);');

  handler('pre-horarios/opciones', 'GET', '
    PKG_PRE_HORARIOS_ETHOS.OPCIONES(p_token => l_token);');

  handler('pre-horarios', 'POST', '
    PKG_PRE_HORARIOS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('pre-horarios/:id', 'PUT', '
    PKG_PRE_HORARIOS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('pre-horarios/:id', 'DELETE', '
    PKG_PRE_HORARIOS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('pre-horarios/confirmar', 'POST', '
    PKG_PRE_HORARIOS_ETHOS.CONFIRMAR(
        p_token => l_token, p_id_institucion => :id_institucion,
        p_ids => :ids, p_estado => :estado);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de pre-horarios publicados.');
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
  preflight('pre-horarios');
  preflight('pre-horarios/opciones');
  preflight('pre-horarios/confirmar');
  preflight('pre-horarios/:id');
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
   WHERE object_name = 'PKG_PRE_HORARIOS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_PRE_HORARIOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    pre-horarios?id_institucion=&anio=');
    DBMS_OUTPUT.PUT_LINE('       GET    pre-horarios/opciones');
    DBMS_OUTPUT.PUT_LINE('       POST   pre-horarios');
    DBMS_OUTPUT.PUT_LINE('       PUT    pre-horarios/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE pre-horarios/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   pre-horarios/confirmar');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_PRE_HORARIOS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_PRE_HORARIOS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_PRE_HORARIOS_ETHOS no se creo.');
END;
/
