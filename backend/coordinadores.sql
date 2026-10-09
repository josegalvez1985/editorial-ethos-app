--------------------------------------------------------------------------------
-- COORDINADORES  —  las personas que coordinan en instituciones (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- COORDINADORES es la tabla de PERSONAS: nombre, telefono y CI. En que
-- institucion coordina cada una, de que tipo, nivel, turno y en que periodo
-- esta en INSTITUCIONES_COORDNADORES (sin la I: asi se llama la tabla; ver
-- instituciones_coordinadores.sql).
--
-- Es el gemelo de directores.sql: misma forma, otra tabla. Hoy la usa la ficha
-- de Instituciones (/instituciones/:id, pestana Autoridades): para elegir al
-- coordinador y para darlo de alta sin salir de la ficha, que es lo que hacia
-- el modal 46 de APEX (Crear Coordinador), abierto desde el 21. La pagina 45
-- (Coordinadores, /coordinadores) todavia no esta en el sitio; cuando se haga,
-- usa este mismo backend.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     coordinadores        todos, con en cuantas instituciones figuran
--   POST    coordinadores        {nombre_apellido, nro_telefono, nro_ci} -> {id_coordinador}
--   PUT     coordinadores/:id    {nombre_apellido, nro_telefono, nro_ci}
--   DELETE  coordinadores/:id    solo si no figura en ninguna institucion
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql (permisos).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   - GET pide solo sesion: la ficha de la institucion lista a todos para
--     elegir.
--   - POST/PUT/DELETE piden insertar/actualizar/borrar en la pagina de
--     /coordinadores (la 45).
--   - Dar de ALTA tambien lo puede quien puede MODIFICAR instituciones
--     (/instituciones, la 16): el modal 46 colgaba de la ficha de la
--     institucion, y los modales usan los permisos de su pagina principal.
--
--------------------------------------------------------------------------------
-- REPETIDOS, ID, BITACORA
--------------------------------------------------------------------------------
--
--   - CI repetida: 409, como en facilitadores.sql. El nombre repetido NO se
--     bloquea (puede haber homonimos): lo avisa la pantalla.
--   - Los largos son MAS CORTOS que en DIRECTORES: nombre 400, telefono y CI
--     80 (verificado el 09/10/2026).
--   - ID_COORDINADOR es identity (verificado el 09/10/2026): no se calcula.
--   - AUDITORIA_COORDINADORES (la bitacora) no asigna :NEW en un DELETE: no tiene
--     el ORA-04084 que tenia SUCURSALES_JNTRG. No se toca.
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

  FOR t IN (SELECT 'COORDINADORES' AS tabla FROM dual
            UNION ALL SELECT 'INSTITUCIONES_COORDNADORES' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.tabla;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.tabla || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.tabla || ' encontrada.');
      FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                  WHERE table_name = t.tabla ORDER BY trigger_name) LOOP
        DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
      END LOOP;
    END IF;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_COORDINADORES_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion.
  PROCEDURE guardar(
    p_token           IN VARCHAR2,
    p_id              IN VARCHAR2,
    p_nombre_apellido IN VARCHAR2,
    p_nro_telefono    IN VARCHAR2,
    p_nro_ci          IN VARCHAR2);

  -- Baja. 409 si figura en alguna institucion.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_COORDINADORES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_COORDINADORES_ETHOS AS

  c_ruta       CONSTANT VARCHAR2(30) := '/coordinadores';
  c_ruta_ficha CONSTANT VARCHAR2(30) := '/instituciones';

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
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: figura en alguna institucion');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
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

  -- Entero positivo, o NULL.
  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_numero;

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

  ------------------------------------------------------------------------------
  -- Sesion + permiso (ver el encabezado). 'C' pide solo sesion. FALSE = ya
  -- respondio el error.
  ------------------------------------------------------------------------------
  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    IF p_accion = 'C'
       OR puede(l_usuario, c_ruta, p_accion)
       OR (p_accion = 'I' AND puede(l_usuario, c_ruta_ficha, 'U')) THEN
      RETURN TRUE;
    END IF;
    p_error(403, 'Forbidden', 'No tenes permiso para '
      || CASE p_accion WHEN 'I' THEN 'agregar'
                       WHEN 'U' THEN 'modificar'
                       ELSE 'eliminar' END
      || ' coordinadores');
    RETURN FALSE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Todos, con en cuantas instituciones figuran (activos o no): es lo que
  -- decide si se pueden borrar, y ayuda a distinguir homonimos.
  ------------------------------------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT d.id_coordinador, d.nombre_apellido, d.nro_telefono, d.nro_ci,
               (SELECT COUNT(*) FROM instituciones_coordnadores x
                 WHERE x.id_coordinador = d.id_coordinador)                  AS asignaciones,
               (SELECT COUNT(DISTINCT x.id_institucion) FROM instituciones_coordnadores x
                 WHERE x.id_coordinador = d.id_coordinador)                  AS instituciones
          FROM coordinadores d
         ORDER BY UPPER(d.nombre_apellido)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_coordinador',     r.id_coordinador);
      APEX_JSON.WRITE('nombre_apellido', r.nombre_apellido);
      APEX_JSON.WRITE('nro_telefono',    r.nro_telefono);
      APEX_JSON.WRITE('nro_ci',          r.nro_ci);
      APEX_JSON.WRITE('asignaciones',    r.asignaciones);
      APEX_JSON.WRITE('instituciones',   r.instituciones);
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
    p_token           IN VARCHAR2,
    p_id              IN VARCHAR2,
    p_nombre_apellido IN VARCHAR2,
    p_nro_telefono    IN VARCHAR2,
    p_nro_ci          IN VARCHAR2)
  IS
    -- 32767: se inicializan en la declaracion, y ahi un texto mas largo que la
    -- variable rompe (ORA-06502) antes de que el EXCEPTION pueda atraparlo. Los
    -- topes reales se validan abajo con un mensaje.
    l_nombre VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_nombre_apellido, '\s+', ' '));
    l_tel    VARCHAR2(32767) := TRIM(p_nro_telefono);
    l_ci     VARCHAR2(32767) := TRIM(p_nro_ci);
    l_id     NUMBER := f_numero(p_id);
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de coordinador invalido'); RETURN;
    END IF;
    IF l_nombre IS NULL THEN
      p_error(400, 'Bad Request', 'El nombre y apellido es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_nombre) > 400 THEN
      p_error(400, 'Bad Request', 'El nombre no puede pasar de 400 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_tel) > 80 THEN
      p_error(400, 'Bad Request', 'El telefono no puede pasar de 80 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_ci) > 80 THEN
      p_error(400, 'Bad Request', 'La CI no puede pasar de 80 caracteres'); RETURN;
    END IF;

    -- CI repetida (si viene): en un alta, o si se la cambia a otro.
    IF l_ci IS NOT NULL THEN
      FOR r IN (SELECT nombre_apellido FROM coordinadores
                 WHERE TRIM(nro_ci) = l_ci AND (l_id IS NULL OR id_coordinador <> l_id)
                   AND ROWNUM = 1) LOOP
        p_error(409, 'Conflict', 'La CI ' || l_ci || ' ya es de ' || r.nombre_apellido); RETURN;
      END LOOP;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO coordinadores (nombre_apellido, nro_telefono, nro_ci)
      VALUES (l_nombre, l_tel, l_ci)
      RETURNING id_coordinador INTO l_id;
    ELSE
      UPDATE coordinadores
         SET nombre_apellido = l_nombre, nro_telefono = l_tel, nro_ci = l_ci
       WHERE id_coordinador = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'El coordinador no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_coordinador', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Coordinador creado'
                                    ELSE 'Coordinador actualizado' END);
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
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de coordinador invalido'); RETURN;
    END IF;

    -- Se cuenta antes para decir donde figura, en vez del ORA-02292 generico.
    SELECT COUNT(DISTINCT id_institucion) INTO l_n
      FROM instituciones_coordnadores WHERE id_coordinador = l_id;
    IF l_n > 0 THEN
      p_error(409, 'Conflict',
              'No se puede eliminar: figura en ' || l_n || ' institucion(es)'); RETURN;
    END IF;

    DELETE FROM coordinadores WHERE id_coordinador = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'El coordinador no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Coordinador eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_COORDINADORES_ETHOS;
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
  FOR r IN (SELECT 'coordinadores' AS p FROM dual
            UNION ALL SELECT 'coordinadores/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'coordinadores',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'coordinadores/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('coordinadores', 'GET', '
    PKG_COORDINADORES_ETHOS.LISTAR(p_token => l_token);');

  handler('coordinadores', 'POST', '
    PKG_COORDINADORES_ETHOS.GUARDAR(
        p_token => l_token, p_id => NULL, p_nombre_apellido => :nombre_apellido,
        p_nro_telefono => :nro_telefono, p_nro_ci => :nro_ci);');

  handler('coordinadores/:id', 'PUT', '
    PKG_COORDINADORES_ETHOS.GUARDAR(
        p_token => l_token, p_id => :id, p_nombre_apellido => :nombre_apellido,
        p_nro_telefono => :nro_telefono, p_nro_ci => :nro_ci);');

  handler('coordinadores/:id', 'DELETE', '
    PKG_COORDINADORES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de coordinadores publicados.');
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
  preflight('coordinadores');
  preflight('coordinadores/:id');
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
   WHERE object_name = 'PKG_COORDINADORES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_COORDINADORES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    coordinadores');
    DBMS_OUTPUT.PUT_LINE('       POST   coordinadores');
    DBMS_OUTPUT.PUT_LINE('       PUT    coordinadores/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE coordinadores/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_COORDINADORES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_COORDINADORES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_COORDINADORES_ETHOS no se creo.');
END;
/
