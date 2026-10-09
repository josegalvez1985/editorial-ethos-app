--------------------------------------------------------------------------------
-- ETAPAS  —  ABM de etapas (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 79 de APEX (Etapas, un IG sobre ETAPAS) y
-- a su modal 80 (Crear etapa). La 80 NO es una pagina en el sitio: es el
-- dialogo de la pantalla /etapas, con los permisos de la 79.
--
-- La tabla, segun el export de APEX: ID_ETAPA (PK), FECHA_INICIO y FECHA_FIN
-- (DATE, obligatorias). No tiene nombre: la pantalla las numera por anio y
-- orden ("2da etapa 2026"). La verificacion previa muestra las columnas,
-- triggers y quien la usa.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     etapas         todas, por fecha de inicio, con en que tablas se usa
--                          cada una
--   POST    etapas         {fecha_inicio, fecha_fin} -> {id_etapa}
--   PUT     etapas/:id     lo mismo
--   DELETE  etapas/:id     solo si nada la usa
--
--   Fechas como 'YYYY-MM-DD' (lo que da un <input type="date">).
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- REGLAS
--------------------------------------------------------------------------------
--
--   - FECHA_INICIO <= FECHA_FIN, las dos obligatorias.
--   - La misma etapa (mismo inicio y fin) no se carga dos veces (409).
--   - Que se pise con otra NO se frena aca: la pantalla lo avisa. No se sabe
--     si alguna etapa vieja ya se pisa, y frenarlo impediria corregirla.
--
--------------------------------------------------------------------------------
-- EN USO
--------------------------------------------------------------------------------
--
-- Como materias.sql: toda FK de una sola columna que apunte a ETAPAS (salvo
-- las _JN), mas toda tabla con una columna ID_ETAPA aunque no tenga FK. El
-- listado dice cuantas filas usan cada etapa; una etapa en uso no se borra.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /etapas (la 79)
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
--
-- El ID lo completa la tabla (identity). Si no lo hiciera (ORA-01400), cae al
-- mayor mas 1 con la tabla bloqueada, como materias.sql.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON
SET DEFINE OFF

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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'ETAPAS';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ETAPAS.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ETAPAS encontrada.');
    FOR c IN (SELECT c.column_name, c.data_type, c.data_length, c.nullable,
                     NVL2(i.column_name, ' identity', NULL) AS ident
                FROM user_tab_columns c
                LEFT JOIN user_tab_identity_cols i
                  ON i.table_name = c.table_name AND i.column_name = c.column_name
               WHERE c.table_name = 'ETAPAS' ORDER BY c.column_id) LOOP
      DBMS_OUTPUT.PUT_LINE('       ' || RPAD(c.column_name, 16) || c.data_type
                           || '(' || c.data_length || ')'
                           || CASE c.nullable WHEN 'N' THEN ' NOT NULL' END || c.ident);
    END LOOP;
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'ETAPAS' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    FOR t IN (SELECT table_name FROM user_tab_columns
               WHERE column_name = 'ID_ETAPA' AND table_name <> 'ETAPAS'
               ORDER BY table_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       ID_ETAPA en ' || t.table_name);
    END LOOP;
    FOR d IN (SELECT name, type FROM user_dependencies
               WHERE referenced_name = 'ETAPAS' AND referenced_type = 'TABLE'
               ORDER BY type, name) LOOP
      DBMS_OUTPUT.PUT_LINE('       la usa ' || d.type || ' ' || d.name);
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

CREATE OR REPLACE PACKAGE PKG_ETAPAS_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(
    p_token  IN VARCHAR2,
    p_id     IN VARCHAR2,
    p_inicio IN VARCHAR2,
    p_fin    IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_ETAPAS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_ETAPAS_ETHOS AS

  c_ruta CONSTANT VARCHAR2(20) := '/etapas';

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
        p_error(409, 'Conflict', 'Ya existe una etapa con esas fechas');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan esa etapa');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de ETAPAS asigna :NEW en un DELETE (ORA-04084). '
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

  -- 'YYYY-MM-DD' (o con hora atras), o NULL si no es una fecha.
  FUNCTION f_fecha(p_valor IN VARCHAR2) RETURN DATE IS
  BEGIN
    RETURN TO_DATE(SUBSTR(TRIM(p_valor), 1, 10), 'YYYY-MM-DD');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_fecha;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' la accion en la
  -- pagina de /etapas. FALSE = ya respondio el error.
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
          || ' etapas');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  ------------------------------------------------------------------------------
  -- Las tablas que usan ETAPAS y cuantas filas de cada una usan cada etapa.
  -- Ver "EN USO" en el encabezado.
  ------------------------------------------------------------------------------
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
                                        WHERE table_name = 'ETAPAS'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
        UNION
        -- Las que guardan ID_ETAPA, tengan FK o no.
        SELECT c.table_name, c.column_name
          FROM user_tab_columns c
          JOIN user_tables t ON t.table_name = c.table_name
         WHERE c.column_name = 'ID_ETAPA'
           AND c.table_name <> 'ETAPAS'
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
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

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_hijas(l_hijas);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_etapa,
                     TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS inicio,
                     TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS fin
                FROM etapas
               ORDER BY fecha_inicio, fecha_fin, id_etapa) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_etapa',     r.id_etapa);
      APEX_JSON.WRITE('fecha_inicio', r.inicio);
      APEX_JSON.WRITE('fecha_fin',    r.fin);
      APEX_JSON.OPEN_ARRAY('usos');
      FOR i IN 1 .. l_hijas.COUNT LOOP
        IF l_hijas(i).cuentas.EXISTS(r.id_etapa) THEN
          APEX_JSON.OPEN_OBJECT;
          APEX_JSON.WRITE('tabla',    l_hijas(i).tabla);
          APEX_JSON.WRITE('cantidad', l_hijas(i).cuentas(r.id_etapa));
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

  PROCEDURE guardar(
    p_token  IN VARCHAR2,
    p_id     IN VARCHAR2,
    p_inicio IN VARCHAR2,
    p_fin    IN VARCHAR2)
  IS
    l_id     NUMBER := f_numero(p_id);
    l_inicio DATE   := f_fecha(p_inicio);
    l_fin    DATE   := f_fecha(p_fin);
    l_n      PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de etapa invalido'); RETURN;
    END IF;
    IF l_inicio IS NULL OR l_fin IS NULL THEN
      p_error(400, 'Bad Request', 'Las fechas de inicio y fin son obligatorias'); RETURN;
    END IF;
    IF l_inicio > l_fin THEN
      p_error(400, 'Bad Request', 'El inicio no puede ser posterior al fin'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM etapas
     WHERE TRUNC(fecha_inicio) = l_inicio AND TRUNC(fecha_fin) = l_fin
       AND (l_id IS NULL OR id_etapa <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Ya hay una etapa del ' || TO_CHAR(l_inicio, 'DD/MM/YYYY')
              || ' al ' || TO_CHAR(l_fin, 'DD/MM/YYYY'));
      RETURN;
    END IF;

    IF l_id IS NULL THEN
      BEGIN
        INSERT INTO etapas (fecha_inicio, fecha_fin) VALUES (l_inicio, l_fin)
        RETURNING id_etapa INTO l_id;
      EXCEPTION
        WHEN OTHERS THEN
          -- La tabla no completa ID_ETAPA: el mayor mas 1, bloqueada para que
          -- dos altas a la vez no tomen el mismo.
          IF SQLCODE = -1400 AND INSTR(SQLERRM, '"ID_ETAPA"') > 0 THEN
            LOCK TABLE etapas IN EXCLUSIVE MODE;
            SELECT NVL(MAX(id_etapa), 0) + 1 INTO l_id FROM etapas;
            INSERT INTO etapas (id_etapa, fecha_inicio, fecha_fin) VALUES (l_id, l_inicio, l_fin);
          ELSE
            RAISE;
          END IF;
      END;
    ELSE
      UPDATE etapas SET fecha_inicio = l_inicio, fecha_fin = l_fin WHERE id_etapa = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        p_error(404, 'Not Found', 'La etapa no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_etapa', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Etapa creada' ELSE 'Etapa actualizada' END);
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
      p_error(400, 'Bad Request', 'Id de etapa invalido'); RETURN;
    END IF;
    -- Las que guardan ID_ETAPA pueden no tener FK: se mira a mano.
    cargar_hijas(l_hijas);
    FOR i IN 1 .. l_hijas.COUNT LOOP
      IF l_hijas(i).cuentas.EXISTS(l_id) THEN
        p_error(409, 'Conflict', 'No se puede eliminar: la usan '
                || l_hijas(i).cuentas(l_id) || ' fila(s) de ' || l_hijas(i).tabla);
        RETURN;
      END IF;
    END LOOP;

    DELETE FROM etapas WHERE id_etapa = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'La etapa no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Etapa eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_ETAPAS_ETHOS;
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
  FOR r IN (SELECT 'etapas' AS p FROM dual
            UNION ALL SELECT 'etapas/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'etapas',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'etapas/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('etapas', 'GET', '
    PKG_ETAPAS_ETHOS.LISTAR(p_token => l_token);');

  handler('etapas', 'POST', '
    PKG_ETAPAS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,
        p_inicio => :fecha_inicio, p_fin => :fecha_fin);');

  handler('etapas/:id', 'PUT', '
    PKG_ETAPAS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,
        p_inicio => :fecha_inicio, p_fin => :fecha_fin);');

  handler('etapas/:id', 'DELETE', '
    PKG_ETAPAS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de etapas publicados.');
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
  preflight('etapas');
  preflight('etapas/:id');
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
   WHERE object_name = 'PKG_ETAPAS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_ETAPAS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    etapas');
    DBMS_OUTPUT.PUT_LINE('       POST   etapas');
    DBMS_OUTPUT.PUT_LINE('       PUT    etapas/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE etapas/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ETAPAS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_ETAPAS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ETAPAS_ETHOS no se creo.');
END;
/
