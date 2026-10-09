--------------------------------------------------------------------------------
-- FERIADOS  —  ABM de feriados nacionales (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 70 de APEX (Feriados Nacioanles, un IG
-- sobre FERIADOS) y a su modal 71 (Crear Feriado). La 71 NO es una pagina en
-- el sitio: es el dialogo de la pantalla /feriados, con los permisos de la 70.
--
-- La tabla, segun el export de APEX: ID_FERIADO (PK), FECHA_FERIADO (DATE,
-- obligatoria), DESCRIPCION (obligatoria, hasta 255) y FECHA_CREACION (DATE,
-- oculta en APEX). La verificacion previa muestra las columnas y triggers que
-- tiene de verdad.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     feriados            todos, por fecha
--   POST    feriados            {fecha_feriado, descripcion} -> {id_feriado}
--   PUT     feriados/:id        lo mismo
--   DELETE  feriados/:id
--   POST    feriados/copiar     {desde, hacia} (anios) -> {copiados, salteados}
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
--   - Un dia no se carga dos veces (409, diciendo cual ya esta).
--   - FECHA_CREACION se pone en SYSDATE al dar de alta (APEX la dejaba al
--     trigger o vacia); al modificar no se toca.
--   - COPIAR pasa los feriados de un anio al otro con el mismo dia y mes. Los
--     que ya estan ese dia, y el 29 de febrero en un anio que no lo tiene, se
--     saltean. Los moviles (Semana Santa) hay que corregirlos a mano despues:
--     la pantalla lo avisa.
--   - El ID lo completa la tabla (identity). Si no lo hiciera (ORA-01400), cae
--     al mayor mas 1 con la tabla bloqueada, como materias.sql.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /feriados (la 70); copiar tambien
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'FERIADOS';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla FERIADOS.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FERIADOS encontrada.');
    FOR c IN (SELECT c.column_name, c.data_type, c.data_length, c.nullable,
                     NVL2(i.column_name, ' identity', NULL) AS ident
                FROM user_tab_columns c
                LEFT JOIN user_tab_identity_cols i
                  ON i.table_name = c.table_name AND i.column_name = c.column_name
               WHERE c.table_name = 'FERIADOS' ORDER BY c.column_id) LOOP
      DBMS_OUTPUT.PUT_LINE('       ' || RPAD(c.column_name, 16) || c.data_type
                           || '(' || c.data_length || ')'
                           || CASE c.nullable WHEN 'N' THEN ' NOT NULL' END || c.ident);
    END LOOP;
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'FERIADOS' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    -- Quien la lee (vistas de agenda, intervenciones no realizadas...).
    FOR d IN (SELECT name, type FROM user_dependencies
               WHERE referenced_name = 'FERIADOS' AND referenced_type = 'TABLE'
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

CREATE OR REPLACE PACKAGE PKG_FERIADOS_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(
    p_token       IN VARCHAR2,
    p_id          IN VARCHAR2,
    p_fecha       IN VARCHAR2,
    p_descripcion IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- Los feriados de p_desde (anio) a p_hacia, mismo dia y mes.
  PROCEDURE copiar(p_token IN VARCHAR2, p_desde IN VARCHAR2, p_hacia IN VARCHAR2);

END PKG_FERIADOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_FERIADOS_ETHOS AS

  c_ruta  CONSTANT VARCHAR2(20) := '/feriados';
  c_largo CONSTANT PLS_INTEGER  := 255;

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
        p_error(409, 'Conflict', 'Ese dia ya tiene un feriado cargado');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de FERIADOS asigna :NEW en un DELETE (ORA-04084). '
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
  -- pagina de /feriados. FALSE = ya respondio el error.
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
          || ' feriados');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  -- Alta con el id de la tabla, o el mayor mas 1 si no es identity.
  PROCEDURE insertar(p_fecha IN DATE, p_desc IN VARCHAR2, p_id OUT NUMBER) IS
  BEGIN
    INSERT INTO feriados (fecha_feriado, descripcion, fecha_creacion)
    VALUES (p_fecha, p_desc, SYSDATE)
    RETURNING id_feriado INTO p_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE = -1400 AND INSTR(SQLERRM, '"ID_FERIADO"') > 0 THEN
        LOCK TABLE feriados IN EXCLUSIVE MODE;
        SELECT NVL(MAX(id_feriado), 0) + 1 INTO p_id FROM feriados;
        INSERT INTO feriados (id_feriado, fecha_feriado, descripcion, fecha_creacion)
        VALUES (p_id, p_fecha, p_desc, SYSDATE);
      ELSE
        RAISE;
      END IF;
  END insertar;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo', c_largo);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_feriado, descripcion,
                     TO_CHAR(fecha_feriado, 'YYYY-MM-DD') AS fecha,
                     TO_CHAR(fecha_creacion, 'YYYY-MM-DD') AS creado
                FROM feriados
               ORDER BY fecha_feriado, id_feriado) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_feriado',     r.id_feriado);
      APEX_JSON.WRITE('fecha_feriado',  r.fecha);
      APEX_JSON.WRITE('descripcion',    r.descripcion);
      APEX_JSON.WRITE('fecha_creacion', r.creado);
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
    p_token       IN VARCHAR2,
    p_id          IN VARCHAR2,
    p_fecha       IN VARCHAR2,
    p_descripcion IN VARCHAR2)
  IS
    -- 32767: ver materias.sql. El tope real se valida abajo con mensaje.
    l_desc  VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_descripcion, '\s+', ' '));
    l_id    NUMBER := f_numero(p_id);
    l_fecha DATE   := f_fecha(p_fecha);
    l_otro  feriados.descripcion%TYPE;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de feriado invalido'); RETURN;
    END IF;
    IF l_fecha IS NULL THEN
      p_error(400, 'Bad Request', 'La fecha es obligatoria'); RETURN;
    END IF;
    IF l_desc IS NULL THEN
      p_error(400, 'Bad Request', 'La descripcion es obligatoria'); RETURN;
    END IF;
    IF LENGTH(l_desc) > c_largo THEN
      p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
      RETURN;
    END IF;

    BEGIN
      SELECT descripcion INTO l_otro FROM feriados
       WHERE TRUNC(fecha_feriado) = l_fecha AND (l_id IS NULL OR id_feriado <> l_id)
         AND ROWNUM = 1;
      p_error(409, 'Conflict', 'El ' || TO_CHAR(l_fecha, 'DD/MM/YYYY') || ' ya es feriado: ' || l_otro);
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;

    IF l_id IS NULL THEN
      insertar(l_fecha, l_desc, l_id);
    ELSE
      UPDATE feriados SET fecha_feriado = l_fecha, descripcion = l_desc WHERE id_feriado = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        p_error(404, 'Not Found', 'El feriado no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_feriado', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Feriado creado' ELSE 'Feriado actualizado' END);
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
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de feriado invalido'); RETURN;
    END IF;

    DELETE FROM feriados WHERE id_feriado = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'El feriado no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Feriado eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* COPIAR UN AÑO A OTRO                                                   */
  /* ---------------------------------------------------------------------- */

  PROCEDURE copiar(p_token IN VARCHAR2, p_desde IN VARCHAR2, p_hacia IN VARCHAR2) IS
    l_desde     NUMBER := f_numero(p_desde);
    l_hacia     NUMBER := f_numero(p_hacia);
    l_fecha     DATE;
    l_id        NUMBER;
    l_n         PLS_INTEGER;
    l_copiados  PLS_INTEGER := 0;
    l_salteados PLS_INTEGER := 0;
  BEGIN
    IF NOT exigir(p_token, 'I') THEN RETURN; END IF;
    IF l_desde IS NULL OR l_hacia IS NULL
       OR l_desde NOT BETWEEN 1900 AND 2999 OR l_hacia NOT BETWEEN 1900 AND 2999 THEN
      p_error(400, 'Bad Request', 'Los ' || UNISTR('a\00f1os') || ' tienen que ser de 4 cifras'); RETURN;
    END IF;
    IF l_desde = l_hacia THEN
      p_error(400, 'Bad Request', 'Elegi dos ' || UNISTR('a\00f1os') || ' distintos'); RETURN;
    END IF;

    FOR r IN (SELECT fecha_feriado, descripcion FROM feriados
               WHERE EXTRACT(YEAR FROM fecha_feriado) = l_desde
               ORDER BY fecha_feriado) LOOP
      BEGIN
        l_fecha := TO_DATE(l_hacia || TO_CHAR(r.fecha_feriado, 'MMDD'), 'YYYYMMDD');
      EXCEPTION
        -- 29 de febrero en un anio que no lo tiene.
        WHEN OTHERS THEN l_fecha := NULL;
      END;
      IF l_fecha IS NULL THEN
        l_salteados := l_salteados + 1;
      ELSE
        SELECT COUNT(*) INTO l_n FROM feriados WHERE TRUNC(fecha_feriado) = l_fecha;
        IF l_n > 0 THEN
          l_salteados := l_salteados + 1;
        ELSE
          insertar(l_fecha, r.descripcion, l_id);
          l_copiados := l_copiados + 1;
        END IF;
      END IF;
    END LOOP;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('copiados', l_copiados);
    APEX_JSON.WRITE('salteados', l_salteados);
    APEX_JSON.WRITE('message', l_copiados || ' feriado(s) copiados a ' || l_hacia);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END copiar;

END PKG_FERIADOS_ETHOS;
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
  FOR r IN (SELECT 'feriados' AS p FROM dual
            UNION ALL SELECT 'feriados/copiar' FROM dual
            UNION ALL SELECT 'feriados/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'feriados',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La literal antes que :id, como en instituciones_directores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'feriados/copiar',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'feriados/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('feriados', 'GET', '
    PKG_FERIADOS_ETHOS.LISTAR(p_token => l_token);');

  handler('feriados', 'POST', '
    PKG_FERIADOS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,
        p_fecha => :fecha_feriado, p_descripcion => :descripcion);');

  handler('feriados/:id', 'PUT', '
    PKG_FERIADOS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,
        p_fecha => :fecha_feriado, p_descripcion => :descripcion);');

  handler('feriados/:id', 'DELETE', '
    PKG_FERIADOS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('feriados/copiar', 'POST', '
    PKG_FERIADOS_ETHOS.COPIAR(p_token => l_token, p_desde => :desde, p_hacia => :hacia);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de feriados publicados.');
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
  preflight('feriados');
  preflight('feriados/copiar');
  preflight('feriados/:id');
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
   WHERE object_name = 'PKG_FERIADOS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_FERIADOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    feriados');
    DBMS_OUTPUT.PUT_LINE('       POST   feriados');
    DBMS_OUTPUT.PUT_LINE('       PUT    feriados/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE feriados/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   feriados/copiar');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_FERIADOS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_FERIADOS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_FERIADOS_ETHOS no se creo.');
END;
/
