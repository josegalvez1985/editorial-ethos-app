--------------------------------------------------------------------------------
-- SUCURSALES  —  ABM de sucursales (Nucleo de datos)
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     sucursales          todas, con cuanto las usan inventarios,
--                               existencias y transferencias
--   POST    sucursales          {descripcion}
--   PUT     sucursales/:id      {descripcion}
--   DELETE  sucursales/:id      solo si nada la usa
--
-- CORRER DESPUES de auth.sql. No depende de ningun otro paquete.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- SE CORRIGE SUCURSALES_JNTRG (seccion 2)
--------------------------------------------------------------------------------
--
-- El trigger de bitacora que ya estaba tenia dos problemas, los mismos que
-- auditoria.sql ya corrige en pr_crear_trigger_auditoria:
--
--   1. En DELETING asignaba :NEW.ID_AUDITORIA. En un DELETE no hay fila nueva:
--      Oracle corta con ORA-04084, asi que borrar una sucursal con ID_AUDITORIA
--      en NULL (las cargadas antes de auditar) fallaba SIEMPRE.
--
--   2. JN_ORACLE_USER era NVL(V('APP_USER'), USER). Desde ORDS no hay sesion
--      APEX y todo quedaba a nombre del esquema. Ahora cae a CLIENT_IDENTIFIER,
--      que PKG_AUTH_ETHOS.VALIDAR_TOKEN deja con el usuario del token (ver
--      auth.sql), con SUBSTR a 30 por el largo de la columna.
--
-- Lo demas queda igual: en un UPD sigue guardando :NEW (el DESPUES), como lo
-- hacia. Cambiarlo dejaria la bitacora con filas de las dos formas.
--
--------------------------------------------------------------------------------
-- BORRAR: SOLO LO QUE NADIE USA
--------------------------------------------------------------------------------
--
-- INVENTARIOS, EXISTENCIAS y TRANSFERENCIAS tienen FK a SUCURSALES. Borrar una
-- en uso daria ORA-02292; `eliminar` lo cuenta antes y dice QUE la usa. La
-- pantalla ya lo sabe por el listado y ni ofrece el boton.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM all_objects
   WHERE object_name = 'PKG_AUTH_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Falta PKG_AUTH_ETHOS. Corre backend/auth.sql primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUTH_ETHOS encontrado.');
  END IF;

  FOR t IN (SELECT 'SUCURSALES' AS nombre FROM dual
            UNION ALL SELECT 'SUCURSALES_JN' FROM dual
            UNION ALL SELECT 'INVENTARIOS' FROM dual
            UNION ALL SELECT 'EXISTENCIAS' FROM dual
            UNION ALL SELECT 'TRANSFERENCIAS' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;
END;
/

--------------------------------------------------------------------------------
-- === 2) SUCURSALES_JNTRG (corregido, ver encabezado) ========================
--------------------------------------------------------------------------------

CREATE OR REPLACE EDITIONABLE TRIGGER "SUCURSALES_JNTRG"
BEFORE INSERT OR UPDATE OR DELETE ON sucursales
FOR EACH ROW
DECLARE
  v_audit_id NUMBER;
  -- Quien uso la app, no el esquema. Ver el punto 2 del encabezado.
  v_usuario  VARCHAR2(30) :=
    SUBSTR(NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER'), USER)), 1, 30);
BEGIN
  IF INSERTING THEN
    IF :NEW.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO :NEW.ID_AUDITORIA FROM dual;
    END IF;
    v_audit_id := :NEW.ID_AUDITORIA;
  ELSIF UPDATING THEN
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
      :NEW.ID_AUDITORIA := v_audit_id;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  ELSIF DELETING THEN
    -- SIN asignar :NEW: en un DELETE no hay fila nueva (ORA-04084).
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  END IF;

  IF INSERTING THEN
    INSERT INTO sucursales_JN (
      ID_AUDITORIA, ID_SUCURSAL, DESCRIPCION,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_SUCURSAL, :NEW.DESCRIPCION,
      'INS', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSIF UPDATING THEN
    INSERT INTO sucursales_JN (
      ID_AUDITORIA, ID_SUCURSAL, DESCRIPCION,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_SUCURSAL, :NEW.DESCRIPCION,
      'UPD', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSIF DELETING THEN
    INSERT INTO sucursales_JN (
      ID_AUDITORIA, ID_SUCURSAL, DESCRIPCION,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :OLD.ID_SUCURSAL, :OLD.DESCRIPCION,
      'DEL', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  END IF;
END;
/

ALTER TRIGGER "SUCURSALES_JNTRG" ENABLE;

--------------------------------------------------------------------------------
-- === 3) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_SUCURSALES_ETHOS AS

  -- Todas, con su uso. Sin paginar: son pocas.
  PROCEDURE listar(p_token IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion.
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN NUMBER, p_descripcion IN VARCHAR2);

  -- Baja. 409 si algo la usa.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER);

END PKG_SUCURSALES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_SUCURSALES_ETHOS AS

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
        p_error(409, 'Conflict', 'Ya existe una sucursal con ese nombre');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict',
                'No se puede eliminar: hay inventarios, existencias o transferencias '
                || 'que la usan');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'El nombre no puede pasar de 255 caracteres');
      WHEN SQLCODE = -4084 THEN
        -- El trigger viejo de bitacora. Se corrige corriendo este script.
        p_error(500, 'Internal Server Error',
                'El trigger SUCURSALES_JNTRG no esta corregido. Volve a correr '
                || 'backend/sucursales.sql.');
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

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Con el USO de cada una, para que la pantalla sepa sin preguntar si se puede
  -- borrar y para que el nombre venga con contexto ("340 libros en 12
  -- manuales").
  ------------------------------------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2) IS
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT s.id_sucursal, s.descripcion,
               (SELECT COUNT(*) FROM existencias e
                 WHERE e.id_sucursal = s.id_sucursal)                   AS manuales,
               (SELECT NVL(SUM(e.cantidad_actual), 0) FROM existencias e
                 WHERE e.id_sucursal = s.id_sucursal)                   AS libros,
               (SELECT COUNT(*) FROM inventarios i
                 WHERE i.id_sucursal = s.id_sucursal)                   AS inventarios,
               (SELECT COUNT(*) FROM transferencias t
                 WHERE s.id_sucursal IN (t.id_sucursal_origen,
                                         t.id_sucursal_destino))        AS transferencias
          FROM sucursales s
         ORDER BY s.descripcion
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_sucursal',    r.id_sucursal);
      APEX_JSON.WRITE('descripcion',    r.descripcion);
      APEX_JSON.WRITE('manuales',       r.manuales);
      APEX_JSON.WRITE('libros',         r.libros);
      APEX_JSON.WRITE('inventarios',    r.inventarios);
      APEX_JSON.WRITE('transferencias', r.transferencias);
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
  -- El nombre se guarda TRIM y con los espacios internos colapsados. El UNIQUE
  -- de la tabla distingue mayusculas ("Central" y "CENTRAL" serian dos), asi que
  -- se valida aca sin distinguirlas: son la misma sucursal escrita distinto.
  ------------------------------------------------------------------------------
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN NUMBER, p_descripcion IN VARCHAR2) IS
    -- 32767: se inicializa en la declaracion, y ahi un texto mas largo que la
    -- variable rompe (ORA-06502) antes de que el EXCEPTION pueda atraparlo. El
    -- tope real (255) se valida abajo con un mensaje.
    l_desc VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_descripcion, '\s+', ' '));
    l_id   NUMBER := p_id;
    l_n    PLS_INTEGER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF l_desc IS NULL THEN
      p_error(400, 'Bad Request', 'El nombre es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_desc) > 255 THEN
      p_error(400, 'Bad Request', 'El nombre no puede pasar de 255 caracteres'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM sucursales
     WHERE UPPER(descripcion) = UPPER(l_desc)
       AND (l_id IS NULL OR id_sucursal <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Ya existe una sucursal llamada "' || l_desc || '"'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO sucursales (descripcion) VALUES (l_desc)
      RETURNING id_sucursal INTO l_id;
    ELSE
      UPDATE sucursales SET descripcion = l_desc WHERE id_sucursal = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        p_error(404, 'Not Found', 'La sucursal no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_sucursal', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Sucursal creada'
                                    ELSE 'Sucursal actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER) IS
    l_inv   PLS_INTEGER;
    l_exi   PLS_INTEGER;
    l_tra   PLS_INTEGER;
    l_usos  VARCHAR2(400);
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    -- Se cuenta antes para decir QUE la usa, en vez del ORA-02292 generico.
    SELECT COUNT(*) INTO l_inv FROM inventarios  WHERE id_sucursal = p_id;
    SELECT COUNT(*) INTO l_exi FROM existencias WHERE id_sucursal = p_id;
    SELECT COUNT(*) INTO l_tra FROM transferencias
     WHERE p_id IN (id_sucursal_origen, id_sucursal_destino);

    IF l_inv + l_exi + l_tra > 0 THEN
      l_usos := RTRIM(
             CASE WHEN l_inv > 0 THEN l_inv || ' inventario(s), ' END
          || CASE WHEN l_exi > 0 THEN l_exi || ' existencia(s), ' END
          || CASE WHEN l_tra > 0 THEN l_tra || ' transferencia(s), ' END, ', ');
      p_error(409, 'Conflict', 'No se puede eliminar: la usan ' || l_usos); RETURN;
    END IF;

    DELETE FROM sucursales WHERE id_sucursal = p_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'La sucursal no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Sucursal eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_SUCURSALES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 4) ENDPOINTS ORDS ======================================================
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
  FOR r IN (SELECT 'sucursales' AS p FROM dual
            UNION ALL SELECT 'sucursales/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'sucursales',
                       p_priority => 0, p_etag_type => 'NONE');
  -- Mas prioridad que la coleccion, igual que en intervenciones_crud.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'sucursales/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('sucursales', 'GET', '
    PKG_SUCURSALES_ETHOS.LISTAR(p_token => l_token);');

  handler('sucursales', 'POST', '
    PKG_SUCURSALES_ETHOS.GUARDAR(
        p_token => l_token, p_id => NULL, p_descripcion => :descripcion);');

  handler('sucursales/:id', 'PUT', '
    PKG_SUCURSALES_ETHOS.GUARDAR(
        p_token => l_token, p_id => TO_NUMBER(:id), p_descripcion => :descripcion);');

  handler('sucursales/:id', 'DELETE', '
    PKG_SUCURSALES_ETHOS.ELIMINAR(p_token => l_token, p_id => TO_NUMBER(:id));');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de sucursales publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS: producción (Pages) y el APK le pegan DIRECTO a ORDS.
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
  preflight('sucursales');
  preflight('sucursales/:id');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Preflight OPTIONS no se pudo publicar: ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 5) VERIFICACION ========================================================
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_SUCURSALES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_SUCURSALES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    sucursales');
    DBMS_OUTPUT.PUT_LINE('       POST   sucursales');
    DBMS_OUTPUT.PUT_LINE('       PUT    sucursales/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE sucursales/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_SUCURSALES_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_SUCURSALES_ETHOS'';');
  END IF;

  -- `o.status` y no `status`: user_triggers TAMBIEN tiene STATUS (ORA-00918).
  SELECT o.status INTO l_estado
    FROM user_triggers t JOIN user_objects o ON o.object_name = t.trigger_name
   WHERE t.trigger_name = 'SUCURSALES_JNTRG' AND o.object_type = 'TRIGGER';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   SUCURSALES_JNTRG corregido (DELETE sin ORA-04084).');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] SUCURSALES_JNTRG quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''SUCURSALES_JNTRG'';');
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_SUCURSALES_ETHOS o SUCURSALES_JNTRG no se crearon.');
END;
/
