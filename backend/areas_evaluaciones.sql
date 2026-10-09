--------------------------------------------------------------------------------
-- AREAS_EVALUACIONES  —  ABM de areas de evaluacion (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 81 de APEX (Areas de Evaluacion, un IG
-- sobre AREAS_EVALUACIONES) y a su modal 82 (Crear Area). La 82 NO es una
-- pagina en el sitio: es el dialogo de la pantalla /areas-evaluacion, con los
-- permisos de la 81. Es una copia de materias.sql (un script por tabla,
-- decidido el 08/10/2026), con la tabla, el largo y las tablas hijas
-- cambiados.
--
-- La tabla: AREAS_EVALUACIONES: ID_AREA y DESCRIPCION (obligatoria, hasta 255).
-- La usan los items de evaluacion (EVALUACIONES.ID_AREA) y las evaluaciones de
-- facilitadores (EVALUACIONES_FACILITADORES.ID_AREA, con FK
-- EVAL_FAC_FK_AREA).
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     areas-evaluacion        todas, por descripcion, con en que tablas se usa cada una
--   POST    areas-evaluacion        {descripcion}  -> {id_area}
--   PUT     areas-evaluacion/:id    {descripcion}
--   DELETE  areas-evaluacion/:id    solo si nada la usa
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql (usa PKG_ROLES_PAGINAS_ETHOS
-- para los permisos).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EN USO
--------------------------------------------------------------------------------
--
-- Como en materias.sql, el listado busca en USER_CONSTRAINTS toda FK de una
-- sola columna que apunte a AREAS_EVALUACIONES (salvo las _JN) y cuenta
-- cuantas filas usan cada area. Ademas suma EVALUACIONES.ID_AREA y
-- EVALUACIONES_FACILITADORES.ID_AREA aunque no tengan FK: se sabe que la
-- guardan, y sin FK borrar las dejaria apuntando a nada. La pantalla no
-- ofrece borrar un area en uso.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion. El combo de areas del formulario de evaluaciones NO
--           sale de aca: sale de listas/areas (evaluaciones_facilitadores.sql).
--   POST    PUEDE_INSERTAR   en la pagina de /areas-evaluacion (la 81)
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
--
-- El ID lo completa la tabla (identity). Si no lo hiciera (ORA-01400), cae al
-- mayor mas 1 con la tabla bloqueada, como materias.sql.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'backend/auth.sql' AS script FROM dual
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'backend/roles_paginas.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = 'PACKAGE BODY';
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'AREAS_EVALUACIONES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla AREAS_EVALUACIONES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla AREAS_EVALUACIONES encontrada.');
    -- Un trigger de bitacora escrito a mano puede tener el ORA-04084 en DELETE
    -- que tenia SUCURSALES_JNTRG. Se listan para saber cuales hay.
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'AREAS_EVALUACIONES' ORDER BY trigger_name) LOOP
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

CREATE OR REPLACE PACKAGE PKG_AREAS_EVAL_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_nombre IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_AREAS_EVAL_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_AREAS_EVAL_ETHOS AS

  c_ruta  CONSTANT VARCHAR2(20) := '/areas-evaluacion';
  -- El largo de AREAS_EVALUACIONES.DESCRIPCION (el IG y el form de APEX cortan en 255).
  c_largo CONSTANT PLS_INTEGER  := 255;

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
      WHEN SQLCODE = -1 THEN
        p_error(409, 'Conflict', 'Ya existe un area con esa descripcion');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan esa area');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de AREAS_EVALUACIONES asigna :NEW en un DELETE (ORA-04084). '
                || 'Hay que corregirlo, como SUCURSALES_JNTRG en sucursales.sql.');
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

  -- Entero positivo, o NULL.
  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_numero;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion (ver el encabezado); 'I', 'U', 'D'
  -- piden la accion en la pagina de /areas-evaluacion. FALSE = ya respondio el error.
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
          || ' areas de evaluacion');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  -- Las tablas con FK de una columna hacia AREAS_EVALUACIONES, y cuantas filas de cada una
  -- usan cada area. Ver "EN USO" en el encabezado.
  PROCEDURE cargar_hijas(p_hijas OUT t_hijas) IS
    TYPE t_nums IS TABLE OF NUMBER;
    l_ids  t_nums;
    l_cnts t_nums;
    l_i    PLS_INTEGER := 0;
  BEGIN
    FOR f IN (
        SELECT c.table_name, cc.column_name
          FROM user_constraints c
          JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
         WHERE c.constraint_type = 'R'
           AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                        WHERE table_name = 'AREAS_EVALUACIONES'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
        UNION
        -- Las que se sabe que la guardan, tengan FK o no.
        SELECT table_name, column_name
          FROM user_tab_columns
         WHERE column_name = 'ID_AREA'
           AND table_name IN ('EVALUACIONES', 'EVALUACIONES_FACILITADORES')
         ORDER BY 1
    ) LOOP
      l_i := l_i + 1;
      p_hijas(l_i).tabla := f.table_name;
      EXECUTE IMMEDIATE
        'SELECT ' || DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE) || ', COUNT(*)'
        || ' FROM ' || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
        || ' WHERE ' || DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE) || ' IS NOT NULL'
        || ' GROUP BY ' || DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE)
        BULK COLLECT INTO l_ids, l_cnts;
      FOR j IN 1 .. l_ids.COUNT LOOP
        p_hijas(l_i).cuentas(l_ids(j)) := l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_hijas;

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_hijas(l_hijas);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo', c_largo);
    -- Las tablas que pueden usar un area, aunque hoy ninguna fila lo haga.
    APEX_JSON.OPEN_ARRAY('tablas');
    FOR i IN 1 .. l_hijas.COUNT LOOP
      APEX_JSON.WRITE(l_hijas(i).tabla);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_area, descripcion FROM areas_evaluaciones ORDER BY UPPER(descripcion)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_area', r.id_area);
      APEX_JSON.WRITE('descripcion', r.descripcion);
      APEX_JSON.OPEN_ARRAY('usos');
      FOR i IN 1 .. l_hijas.COUNT LOOP
        IF l_hijas(i).cuentas.EXISTS(r.id_area) THEN
          APEX_JSON.OPEN_OBJECT;
          APEX_JSON.WRITE('tabla',    l_hijas(i).tabla);
          APEX_JSON.WRITE('cantidad', l_hijas(i).cuentas(r.id_area));
          APEX_JSON.CLOSE_OBJECT;
        END IF;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- La descripcion se guarda TRIM y con los espacios internos colapsados.
  -- Repetida se valida sin distinguir mayusculas: "Comunicacion" y "COMUNICACION"
  -- son lo mismo escrito distinto.
  ------------------------------------------------------------------------------
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_nombre IN VARCHAR2) IS
    -- 32767: un texto mas largo romperia en la declaracion, antes del
    -- EXCEPTION. El tope real se valida abajo con mensaje.
    l_nombre VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_nombre, '\s+', ' '));
    l_id     NUMBER := f_numero(p_id);
    l_n      PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de area invalido'); RETURN;
    END IF;
    IF l_nombre IS NULL THEN
      p_error(400, 'Bad Request', 'La descripcion es obligatoria'); RETURN;
    END IF;
    IF LENGTH(l_nombre) > c_largo THEN
      p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
      RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM areas_evaluaciones
     WHERE UPPER(descripcion) = UPPER(l_nombre)
       AND (l_id IS NULL OR id_area <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Ya existe "' || l_nombre || '"'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      BEGIN
        INSERT INTO areas_evaluaciones (descripcion) VALUES (l_nombre)
        RETURNING id_area INTO l_id;
      EXCEPTION
        WHEN OTHERS THEN
          -- La tabla no completa ID_AREA: el mayor mas 1, bloqueada para que
          -- dos altas a la vez no tomen el mismo.
          IF SQLCODE = -1400 AND INSTR(SQLERRM, '"ID_AREA"') > 0 THEN
            LOCK TABLE areas_evaluaciones IN EXCLUSIVE MODE;
            SELECT NVL(MAX(id_area), 0) + 1 INTO l_id FROM areas_evaluaciones;
            INSERT INTO areas_evaluaciones (id_area, descripcion) VALUES (l_id, l_nombre);
          ELSE
            RAISE;
          END IF;
      END;
    ELSE
      UPDATE areas_evaluaciones SET descripcion = l_nombre WHERE id_area = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        p_error(404, 'Not Found', 'El area no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_area', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Area creada' ELSE 'Area actualizada' END);
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
    l_id    NUMBER := f_numero(p_id);
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de area invalido'); RETURN;
    END IF;
    -- EVALUACIONES y EVALUACIONES_FACILITADORES pueden no tener FK: se mira a mano.
    cargar_hijas(l_hijas);
    FOR i IN 1 .. l_hijas.COUNT LOOP
      IF l_hijas(i).cuentas.EXISTS(l_id) THEN
        p_error(409, 'Conflict', 'No se puede eliminar: lo usan '
                || l_hijas(i).cuentas(l_id) || ' fila(s) de ' || l_hijas(i).tabla);
        RETURN;
      END IF;
    END LOOP;

    DELETE FROM areas_evaluaciones WHERE id_area = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'El area no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Area eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_AREAS_EVAL_ETHOS;
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
  FOR r IN (SELECT 'areas-evaluacion' AS p FROM dual
            UNION ALL SELECT 'areas-evaluacion/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'areas-evaluacion',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'areas-evaluacion/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('areas-evaluacion', 'GET', '
    PKG_AREAS_EVAL_ETHOS.LISTAR(p_token => l_token);');

  handler('areas-evaluacion', 'POST', '
    PKG_AREAS_EVAL_ETHOS.GUARDAR(p_token => l_token, p_id => NULL, p_nombre => :descripcion);');

  handler('areas-evaluacion/:id', 'PUT', '
    PKG_AREAS_EVAL_ETHOS.GUARDAR(p_token => l_token, p_id => :id, p_nombre => :descripcion);');

  handler('areas-evaluacion/:id', 'DELETE', '
    PKG_AREAS_EVAL_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de areas-evaluacion publicados.');
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
  preflight('areas-evaluacion');
  preflight('areas-evaluacion/:id');
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
   WHERE object_name = 'PKG_AREAS_EVAL_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AREAS_EVAL_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    areas-evaluacion');
    DBMS_OUTPUT.PUT_LINE('       POST   areas-evaluacion');
    DBMS_OUTPUT.PUT_LINE('       PUT    areas-evaluacion/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE areas-evaluacion/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AREAS_EVAL_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_AREAS_EVAL_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AREAS_EVAL_ETHOS no se creo.');
END;
/
