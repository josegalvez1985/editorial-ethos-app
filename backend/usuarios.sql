--------------------------------------------------------------------------------
-- USUARIOS  —  Los usuarios del workspace: listado y activar / bloquear
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 67 de APEX (Usuarios, un IR sobre
-- APEX_WORKSPACE_APEX_USERS) y a su modal 68 (Activar / Inactivar Usuarios).
-- La 68 NO es una pagina en el sitio: es el dialogo de la pantalla /usuarios,
-- y la usa quien puede usar la 67 (ver "Permisos", abajo).
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     usuarios                     los del workspace, con su estado y
--                                        cuantas paginas tienen en ROLES_PAGINAS
--   PUT     usuarios/:usuario/estado     {bloqueado: 'S'|'N'}
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql (usa PKG_ROLES_PAGINAS_ETHOS
-- para los permisos). Tiene que existir PRC_TOGGLE_USUARIO, el procedimiento
-- que ya usaba APEX: este script no lo crea ni lo toca.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
-- A diferencia de los demas modulos, que solo piden sesion, este controla
-- ROLES_PAGINAS en el backend: bloquear una cuenta es demasiado como para
-- dejarlo en "el menu no lo muestra".
--
--   GET   PUEDE_CONSULTAR  en la pagina de /usuarios (la 67)
--   PUT   PUEDE_ACTUALIZAR en la misma
--
-- La pagina se busca por su RUTA (PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta), no
-- por el numero: ninguna pantalla tiene su numero escrito en el codigo.
--
--------------------------------------------------------------------------------
-- ACTIVAR / BLOQUEAR
--------------------------------------------------------------------------------
--
-- APEX llamaba a PRC_TOGGLE_USUARIO, que INVIERTE el estado. Aca se pide el
-- estado que se quiere ('S' bloqueado, 'N' activo) y solo se invierte si hace
-- falta: con dos pestanas abiertas, o una lista vieja, "bloquear" no termina
-- activando a nadie.
--
-- Despues se relee el estado. Si PRC_TOGGLE_USUARIO no lo cambio (por ejemplo,
-- porque desde ORDS no hay sesion APEX y le falta el contexto que tenia en la
-- pagina 68), responde un error que lo dice, en vez de un "listo" falso.
--
-- Al BLOQUEAR, ademas, se cierran sus sesiones del sitio (ETHOS_TOKENS): sin
-- eso seguiria adentro hasta que venza su token, hasta 6 horas. Y el login ya
-- no deja entrar a una cuenta bloqueada (auth.sql, cuenta_bloqueada).
--
-- No se puede bloquear:
--   - la cuenta propia: quedaria afuera quien la esta usando.
--   - la cuenta duena del workspace: es la que administra APEX.
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
            UNION ALL SELECT 'PRC_TOGGLE_USUARIO', 'PROCEDURE',
                   'la app APEX (pagina 68)' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = o.tipo;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Viene de ' || o.script || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
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

CREATE OR REPLACE PACKAGE PKG_USUARIOS_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_bloqueado: 'S' bloquear, 'N' activar.
  PROCEDURE cambiar_estado(p_token IN VARCHAR2, p_usuario IN VARCHAR2, p_bloqueado IN VARCHAR2);

END PKG_USUARIOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_USUARIOS_ETHOS AS

  -- El mismo workspace que PKG_AUTH_ETHOS.
  c_workspace    CONSTANT VARCHAR2(64) := 'FUNDCARAC';
  -- La cuenta duena del workspace: no se bloquea (ver el encabezado).
  c_cuenta_duena CONSTANT VARCHAR2(64) := 'FUNDACIONCARACTER2024@GMAIL.COM';
  c_ruta         CONSTANT VARCHAR2(20) := '/usuarios';
  c_app_id       CONSTANT NUMBER       := 40587;

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

  -- Sin esto APEX_WORKSPACE_APEX_USERS vuelve vacia desde ORDS.
  PROCEDURE fijar_workspace IS
  BEGIN
    APEX_UTIL.SET_SECURITY_GROUP_ID(
      p_security_group_id => APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => c_workspace));
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END fijar_workspace;

  ------------------------------------------------------------------------------
  -- Sesion + la accion sobre la pagina de /usuarios ('C' o 'U'). Devuelve el
  -- usuario, o NULL habiendo ya respondido el error: el que llama solo hace
  -- RETURN.
  ------------------------------------------------------------------------------
  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN VARCHAR2 IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
    l_pagina  NUMBER;
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN NULL;
    END IF;
    l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta(c_ruta);
    IF l_pagina IS NULL
       OR PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
      p_error(403, 'Forbidden', CASE p_accion
                                  WHEN 'U' THEN 'No tenes permiso para activar o bloquear usuarios'
                                  ELSE 'No tenes permiso para ver los usuarios' END);
      RETURN NULL;
    END IF;
    RETURN l_usuario;
  END exigir;

  -- 'S' bloqueada, 'N' activa, NULL si no esta en el workspace.
  FUNCTION estado_de(p_usuario IN VARCHAR2) RETURN VARCHAR2 IS
    l_locked VARCHAR2(10);
  BEGIN
    SELECT account_locked INTO l_locked
      FROM apex_workspace_apex_users
     WHERE UPPER(user_name) = UPPER(p_usuario)
       AND ROWNUM = 1;
    RETURN CASE WHEN l_locked = 'Y' THEN 'S' ELSE 'N' END;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END estado_de;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Las columnas del IR de la pagina 67 (usuario, nombre, apellido, email,
  -- estado) mas cuantas paginas tiene cada uno en ROLES_PAGINAS: asi se ve de
  -- un vistazo quien todavia no tiene ningun permiso.
  --
  -- Marca la cuenta propia y la duena: la pantalla no les ofrece bloquear.
  ------------------------------------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_yo VARCHAR2(255);
  BEGIN
    l_yo := exigir(p_token, 'C');
    IF l_yo IS NULL THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT UPPER(u.user_name) AS usuario,
               TRIM(u.first_name) AS nombre,
               TRIM(u.last_name)  AS apellido,
               u.email,
               CASE WHEN u.account_locked = 'Y' THEN 'S' ELSE 'N' END AS bloqueado,
               (SELECT COUNT(*) FROM roles_paginas p
                 WHERE p.app_id = c_app_id
                   AND p.app_user_id = UPPER(u.user_name)) AS paginas
          FROM apex_workspace_apex_users u
         ORDER BY UPPER(NVL(TRIM(u.first_name), u.user_name)), UPPER(u.user_name)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('usuario',   r.usuario);
      APEX_JSON.WRITE('nombre',    r.nombre);
      APEX_JSON.WRITE('apellido',  r.apellido);
      APEX_JSON.WRITE('email',     r.email);
      APEX_JSON.WRITE('bloqueado', r.bloqueado);
      APEX_JSON.WRITE('paginas',   r.paginas);
      APEX_JSON.WRITE('es_yo',     CASE WHEN r.usuario = UPPER(l_yo) THEN 'S' ELSE 'N' END);
      APEX_JSON.WRITE('es_duena',  CASE WHEN r.usuario = c_cuenta_duena THEN 'S' ELSE 'N' END);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* ACTIVAR / BLOQUEAR (la pagina 68 de APEX)                              */
  /* ---------------------------------------------------------------------- */

  PROCEDURE cambiar_estado(p_token IN VARCHAR2, p_usuario IN VARCHAR2, p_bloqueado IN VARCHAR2) IS
    l_yo      VARCHAR2(255);
    l_usuario VARCHAR2(32767) := UPPER(TRIM(p_usuario));
    l_quiero  VARCHAR2(1) := UPPER(TRIM(p_bloqueado));
    l_antes   VARCHAR2(1);
    l_despues VARCHAR2(1);
    l_cerradas PLS_INTEGER := 0;
  BEGIN
    l_yo := exigir(p_token, 'U');
    IF l_yo IS NULL THEN RETURN; END IF;

    IF l_quiero IS NULL OR l_quiero NOT IN ('S', 'N') THEN
      p_error(400, 'Bad Request', 'bloqueado tiene que ser S o N'); RETURN;
    END IF;
    IF l_usuario = UPPER(l_yo) THEN
      p_error(400, 'Bad Request', 'No podes bloquear tu propio usuario'); RETURN;
    END IF;
    IF l_usuario = c_cuenta_duena THEN
      p_error(400, 'Bad Request', 'La cuenta duena del workspace no se bloquea'); RETURN;
    END IF;

    fijar_workspace;
    l_antes := estado_de(l_usuario);
    IF l_antes IS NULL THEN
      p_error(404, 'Not Found', 'Ese usuario no esta en el workspace'); RETURN;
    END IF;

    IF l_antes <> l_quiero THEN
      -- El mismo procedimiento que la pagina 68. Invierte el estado.
      PRC_TOGGLE_USUARIO(l_usuario);
      l_despues := estado_de(l_usuario);
      IF l_despues IS NULL OR l_despues <> l_quiero THEN
        ROLLBACK;
        p_error(500, 'Internal Server Error',
                'PRC_TOGGLE_USUARIO no cambio el estado de ' || l_usuario
                || '. Revisa que funcione fuera de una pagina de APEX (desde ORDS no hay '
                || 'sesion APEX).');
        RETURN;
      END IF;
    END IF;

    -- Bloqueado: afuera tambien del sitio, ya, no cuando venza su token.
    IF l_quiero = 'S' THEN
      UPDATE ethos_tokens SET activo = 'N'
       WHERE usuario = l_usuario AND activo = 'S';
      l_cerradas := SQL%ROWCOUNT;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('bloqueado', l_quiero);
    APEX_JSON.WRITE('sesiones_cerradas', l_cerradas);
    APEX_JSON.WRITE('message', l_usuario || CASE l_quiero WHEN 'S' THEN ' bloqueado'
                                                          ELSE ' activado' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END cambiar_estado;

END PKG_USUARIOS_ETHOS;
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
  FOR r IN (SELECT 'usuarios' AS p FROM dual
            UNION ALL SELECT 'usuarios/:usuario/estado' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'usuarios',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'usuarios/:usuario/estado',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('usuarios', 'GET', '
    PKG_USUARIOS_ETHOS.LISTAR(p_token => l_token);');

  handler('usuarios/:usuario/estado', 'PUT', '
    PKG_USUARIOS_ETHOS.CAMBIAR_ESTADO(
        p_token => l_token, p_usuario => :usuario, p_bloqueado => :bloqueado);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de usuarios publicados.');
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
  preflight('usuarios');
  preflight('usuarios/:usuario/estado');
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
   WHERE object_name = 'PKG_USUARIOS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_USUARIOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    usuarios');
    DBMS_OUTPUT.PUT_LINE('       PUT    usuarios/:usuario/estado');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_USUARIOS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_USUARIOS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_USUARIOS_ETHOS no se creo.');
END;
/
