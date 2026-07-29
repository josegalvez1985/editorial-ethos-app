--------------------------------------------------------------------------------
-- Editorial Ethos — Autenticacion completa (Oracle APEX / ORDS)
--------------------------------------------------------------------------------
-- Script UNICO y idempotente: se puede volver a correr sin romper nada.
-- Contiene, en este orden:
--
--   1. Tabla ETHOS_TOKENS + indices
--   2. Job de purga de tokens vencidos (opcional, no aborta si falta privilegio)
--   3. Paquete PKG_AUTH_ETHOS (spec + body)
--   4. Endpoints ORDS del modulo 'ethos': auth/login, auth/logout, auth/me
--   5. Verificacion final (imprime la URL base real)
--
-- COMO CORRERLO
--   APEX -> SQL Workshop -> SQL Scripts -> Upload -> Run.
--   Hay que ejecutarlo con el usuario DUEÑO del esquema (el del workspace),
--   no como SYS. Ver la salida de DBMS_OUTPUT al final.
--
-- WORKSPACE
--   Tomado de la URL del proyecto:
--   https://oracleapex.com/ords/r/fundcarac/juventud-con-valores/login
--                                  ^^^^^^^^ path prefix del workspace
--   Si el nombre real del workspace no es FUNDCARAC, cambia c_workspace en
--   PKG_AUTH_ETHOS (seccion 3). El bloque de verificacion (seccion 5) lo valida
--   y te avisa si no coincide.
--
-- QUIENES SON LOS USUARIOS
--   Los usuarios del WORKSPACE APEX (Administration -> Manage Users).
--   Si Editorial Ethos va a tener su propia tabla de usuarios, la UNICA funcion
--   a reescribir es PKG_AUTH_ETHOS.credenciales_validas (hay un ejemplo
--   comentado ahi mismo). Nada mas cambia.
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON
SET DEFINE OFF

--------------------------------------------------------------------------------
-- 1. TABLA DE TOKENS
--------------------------------------------------------------------------------
-- Token opaco guardado en tabla (no JWT): simple, revocable y sin librerias.

BEGIN
  EXECUTE IMMEDIATE q'~
    CREATE TABLE ETHOS_TOKENS (
        TOKEN             VARCHAR2(128) NOT NULL,
        USUARIO           VARCHAR2(255) NOT NULL,
        FECHA_CREACION    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
        FECHA_EXPIRACION  TIMESTAMP     NOT NULL,
        ACTIVO            CHAR(1)       DEFAULT 'S' NOT NULL,
        CONSTRAINT PK_ETHOS_TOKENS PRIMARY KEY (TOKEN),
        CONSTRAINT CK_ETHOS_TOKENS_ACT CHECK (ACTIVO IN ('S','N'))
    )~';
  DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ETHOS_TOKENS creada.');
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -955 THEN                       -- ORA-00955: ya existe
      DBMS_OUTPUT.PUT_LINE('[SKIP] Tabla ETHOS_TOKENS ya existia.');
    ELSE
      RAISE;
    END IF;
END;
/

-- Indice del camino caliente: validar_token corre en CADA request protegido.
BEGIN
  EXECUTE IMMEDIATE
    'CREATE INDEX IX_ETHOS_TOKENS_ACT ON ETHOS_TOKENS (TOKEN, ACTIVO, FECHA_EXPIRACION)';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE
    'CREATE INDEX IX_ETHOS_TOKENS_USR ON ETHOS_TOKENS (USUARIO, ACTIVO)';
EXCEPTION
  WHEN OTHERS THEN IF SQLCODE NOT IN (-955, -1408) THEN RAISE; END IF;
END;
/

--------------------------------------------------------------------------------
-- 2. PURGA DE TOKENS VIEJOS
--------------------------------------------------------------------------------
-- La tabla crece con cada login. Borra lo vencido hace mas de 7 dias, 3 AM.
-- Si el usuario no tiene CREATE JOB, esto se salta sin abortar el script.

BEGIN
  BEGIN
    DBMS_SCHEDULER.DROP_JOB('JOB_PURGAR_ETHOS_TOKENS', force => TRUE);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  DBMS_SCHEDULER.CREATE_JOB(
    job_name        => 'JOB_PURGAR_ETHOS_TOKENS',
    job_type        => 'PLSQL_BLOCK',
    job_action      => 'BEGIN DELETE FROM ETHOS_TOKENS WHERE FECHA_EXPIRACION < SYSTIMESTAMP - 7; COMMIT; END;',
    start_date      => SYSTIMESTAMP,
    repeat_interval => 'FREQ=DAILY;BYHOUR=3',
    enabled         => TRUE);

  DBMS_OUTPUT.PUT_LINE('[OK]   Job JOB_PURGAR_ETHOS_TOKENS programado (diario 3 AM).');
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo crear el job de purga: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('       No es bloqueante. Purga manual:');
    DBMS_OUTPUT.PUT_LINE('       DELETE FROM ETHOS_TOKENS WHERE FECHA_EXPIRACION < SYSTIMESTAMP - 7;');
END;
/

--------------------------------------------------------------------------------
-- 3. PAQUETE PKG_AUTH_ETHOS
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_AUTH_ETHOS AS

  -- Valida credenciales y, si son correctas, emite un token nuevo.
  -- Escribe la respuesta JSON directamente (lo llama el handler ORDS).
  PROCEDURE login(p_usuario IN VARCHAR2, p_password IN VARCHAR2);

  -- Desactiva el token (cierre de sesion explicito).
  PROCEDURE logout(p_token IN VARCHAR2);

  -- Datos del usuario dueño del token. 401 si el token no sirve.
  -- El front la usa al arrancar para saber si la sesion guardada sigue viva.
  PROCEDURE perfil(p_token IN VARCHAR2);

  -- Devuelve el usuario dueño del token, o NULL si es invalido/expirado.
  -- La usan TODOS los paquetes de negocio para autorizar.
  FUNCTION validar_token(p_token IN VARCHAR2) RETURN VARCHAR2;

END PKG_AUTH_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_AUTH_ETHOS AS

  -- Path prefix del workspace APEX. Ver el encabezado del script.
  c_workspace CONSTANT VARCHAR2(64) := 'FUNDCARAC';

  -- Vigencia del token emitido en LOGIN.
  c_horas_token CONSTANT NUMBER := 6;

------------------------------------------------------------------------------
-- Helpers de respuesta
------------------------------------------------------------------------------

-- Abre la respuesta HTTP en JSON.
-- CORS abierto por el unico cliente que pega directo a ORDS: la app Expo de
-- mobile/. El sitio web NO lo necesita, porque pasa por su proxy server-side
-- (src/routes/api/ords.$.ts) y por lo tanto es mismo origen.
-- Se deja abierto igual: no cuesta nada y cubre pruebas desde el navegador.
PROCEDURE abrir_json IS
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Access-Control-Allow-Origin: *');
    HTP.P('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END abrir_json;

-- Error con status HTTP real.
-- OJO con el orden: STATUS_LINE va ANTES de MIME_HEADER. Si se invierte, la
-- respuesta ya esta abierta y el status se pierde (queda 200 con success:false).
PROCEDURE p_error(
    p_status  IN NUMBER,
    p_reason  IN VARCHAR2,
    p_message IN VARCHAR2
) IS
BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_reason, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_message);
    APEX_JSON.CLOSE_OBJECT;
END p_error;

------------------------------------------------------------------------------
-- Credenciales
------------------------------------------------------------------------------

FUNCTION generar_token RETURN VARCHAR2 IS
BEGIN
    RETURN UPPER(RAWTOHEX(SYS_GUID()) || RAWTOHEX(SYS_GUID()));
END generar_token;

-- Deja el contexto de seguridad apuntando al workspace. Necesario para
-- IS_LOGIN_PASSWORD_VALID y para leer APEX_WORKSPACE_APEX_USERS.
PROCEDURE fijar_workspace IS
    l_security_group_id NUMBER;
BEGIN
    l_security_group_id := APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => c_workspace);
    APEX_UTIL.SET_SECURITY_GROUP_ID(p_security_group_id => l_security_group_id);
END fijar_workspace;

-- Valida contra los usuarios del workspace APEX.
--
-- ESTE es el unico punto a cambiar si Editorial Ethos pasa a tener su propia
-- tabla de usuarios. Ejemplo con tabla propia y hash:
--
--   FUNCTION credenciales_validas(p_usuario IN VARCHAR2, p_password IN VARCHAR2)
--   RETURN BOOLEAN IS
--       l_hash ETHOS_USUARIOS.PASSWORD_HASH%TYPE;
--   BEGIN
--       SELECT PASSWORD_HASH INTO l_hash
--         FROM ETHOS_USUARIOS
--        WHERE UPPER(USUARIO) = UPPER(p_usuario) AND ACTIVO = 'S';
--       RETURN l_hash = STANDARD_HASH(p_password || UPPER(p_usuario), 'SHA256');
--   EXCEPTION WHEN NO_DATA_FOUND THEN RETURN FALSE;
--   END;
--
-- Nada mas del paquete cambia.
FUNCTION credenciales_validas(
    p_usuario  IN VARCHAR2,
    p_password IN VARCHAR2
) RETURN BOOLEAN IS
BEGIN
    fijar_workspace;
    RETURN APEX_UTIL.IS_LOGIN_PASSWORD_VALID(
        p_username => UPPER(p_usuario),
        p_password => p_password);
END credenciales_validas;

-- Nombre y correo del usuario del workspace, para poblar la pantalla de cuenta.
-- Best-effort: si el usuario no esta en el workspace o falta el privilegio de
-- lectura, devolvemos nulos y el front cae al usuario tipeado.
PROCEDURE datos_usuario(
    p_usuario IN  VARCHAR2,
    p_nombre  OUT VARCHAR2,
    p_email   OUT VARCHAR2
) IS
BEGIN
    fijar_workspace;
    SELECT TRIM(TRIM(FIRST_NAME) || ' ' || TRIM(LAST_NAME)), EMAIL
      INTO p_nombre, p_email
      FROM APEX_WORKSPACE_APEX_USERS
     WHERE UPPER(USER_NAME) = UPPER(p_usuario)
       AND ROWNUM = 1;
EXCEPTION
    WHEN OTHERS THEN
        p_nombre := NULL;
        p_email  := NULL;
END datos_usuario;

------------------------------------------------------------------------------
-- API publica
------------------------------------------------------------------------------

PROCEDURE login(p_usuario IN VARCHAR2, p_password IN VARCHAR2) IS
    l_token  VARCHAR2(128);
    l_exp    TIMESTAMP;
    l_nombre VARCHAR2(512);
    l_email  VARCHAR2(255);
BEGIN
    IF p_usuario IS NULL OR p_password IS NULL THEN
        abrir_json;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('message', 'Usuario y contrasena son obligatorios');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    IF credenciales_validas(p_usuario, p_password) THEN
        l_token := generar_token;
        l_exp   := SYSTIMESTAMP + NUMTODSINTERVAL(c_horas_token * 60 * 60, 'SECOND');

        -- Un solo token activo por usuario: desactiva los anteriores.
        UPDATE ETHOS_TOKENS SET ACTIVO = 'N'
         WHERE USUARIO = UPPER(p_usuario) AND ACTIVO = 'S';

        INSERT INTO ETHOS_TOKENS (TOKEN, USUARIO, FECHA_CREACION, FECHA_EXPIRACION, ACTIVO)
        VALUES (l_token, UPPER(p_usuario), SYSTIMESTAMP, l_exp, 'S');
        COMMIT;

        datos_usuario(p_usuario, l_nombre, l_email);

        abrir_json;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('message', 'Autenticacion exitosa');
        APEX_JSON.OPEN_OBJECT('data');
        APEX_JSON.WRITE('token',   l_token);
        APEX_JSON.WRITE('usuario', UPPER(p_usuario));
        APEX_JSON.WRITE('nombre',  l_nombre);
        APEX_JSON.WRITE('email',   l_email);
        APEX_JSON.WRITE('expira',  TO_CHAR(l_exp, 'YYYY-MM-DD"T"HH24:MI:SS'));
        APEX_JSON.CLOSE_OBJECT;
        APEX_JSON.CLOSE_OBJECT;
    ELSE
        -- 401 real. El front igual detecta el fallo por success:false.
        p_error(401, 'Unauthorized', 'Usuario o contrasena incorrectos');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END login;

PROCEDURE logout(p_token IN VARCHAR2) IS
    l_filas NUMBER;
BEGIN
    UPDATE ETHOS_TOKENS SET ACTIVO = 'N'
     WHERE TOKEN = UPPER(p_token) AND ACTIVO = 'S';
    l_filas := SQL%ROWCOUNT;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', l_filas > 0);
    APEX_JSON.WRITE('message',
        CASE WHEN l_filas > 0 THEN 'Sesion cerrada'
             ELSE 'Token no encontrado o ya inactivo' END);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END logout;

PROCEDURE perfil(p_token IN VARCHAR2) IS
    l_usuario VARCHAR2(255);
    l_nombre  VARCHAR2(512);
    l_email   VARCHAR2(255);
    l_exp     TIMESTAMP;
BEGIN
    l_usuario := validar_token(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    SELECT FECHA_EXPIRACION INTO l_exp
      FROM ETHOS_TOKENS WHERE TOKEN = UPPER(p_token);

    datos_usuario(l_usuario, l_nombre, l_email);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_OBJECT('data');
    APEX_JSON.WRITE('usuario', l_usuario);
    APEX_JSON.WRITE('nombre',  l_nombre);
    APEX_JSON.WRITE('email',   l_email);
    APEX_JSON.WRITE('expira',  TO_CHAR(l_exp, 'YYYY-MM-DD"T"HH24:MI:SS'));
    APEX_JSON.CLOSE_OBJECT;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END perfil;

FUNCTION validar_token(p_token IN VARCHAR2) RETURN VARCHAR2 IS
    l_usuario VARCHAR2(255);
BEGIN
    SELECT USUARIO INTO l_usuario
      FROM ETHOS_TOKENS
     WHERE TOKEN = UPPER(p_token)
       AND ACTIVO = 'S'
       AND FECHA_EXPIRACION > SYSTIMESTAMP;
    RETURN l_usuario;
EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
END validar_token;

END PKG_AUTH_ETHOS;
/

-- Si el paquete quedo INVALID, esto lo dice en vez de fallar 20 minutos despues.
DECLARE
  l_errores NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_errores
    FROM USER_ERRORS WHERE NAME = 'PKG_AUTH_ETHOS';
  IF l_errores > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AUTH_ETHOS compilo con errores:');
    FOR e IN (SELECT TYPE, LINE, TEXT FROM USER_ERRORS
               WHERE NAME = 'PKG_AUTH_ETHOS' ORDER BY TYPE, SEQUENCE) LOOP
      DBMS_OUTPUT.PUT_LINE('        ' || e.TYPE || ' L' || e.LINE || ': ' || e.TEXT);
    END LOOP;
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUTH_ETHOS compilado.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- 4. ENDPOINTS ORDS
--------------------------------------------------------------------------------
-- Estructura PLANA: la logica va directo en el p_source del handler.
-- Nunca el patron anidado de "un GET que se redefine a si mismo" (da HTTP 500).
--
--   POST   /ethos/auth/login    { usuario, password }  -> { success, data:{token,...} }
--   POST   /ethos/auth/logout   Authorization: Bearer  -> desactiva el token
--   GET    /ethos/auth/me       Authorization: Bearer  -> datos de sesion / 401
--   OPTIONS de los tres         -> preflight CORS del navegador

-- 4.1 REST-enable del esquema.
-- Solo si no estaba habilitado: re-habilitarlo con otro patron cambiaria la URL
-- de TODO lo que ya este publicado en este esquema.
DECLARE
  l_ya NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_ya FROM USER_ORDS_SCHEMAS;
  IF l_ya = 0 THEN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => USER,
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => 'fundcarac',
        p_auto_rest_auth      => FALSE);
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('[OK]   Esquema ' || USER || ' habilitado en ORDS como /fundcarac/');
  ELSE
    FOR s IN (SELECT PARSING_SCHEMA, PATTERN FROM USER_ORDS_SCHEMAS) LOOP
      DBMS_OUTPUT.PUT_LINE('[SKIP] Esquema ' || s.PARSING_SCHEMA ||
                           ' ya estaba en ORDS como /' || s.PATTERN || '/');
    END LOOP;
  END IF;
END;
/

-- 4.2 Modulo.
BEGIN
  ORDS.DEFINE_MODULE(
      p_module_name    => 'ethos',
      p_base_path      => '/ethos/',
      p_items_per_page => 0,
      p_status         => 'PUBLISHED');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Modulo ORDS ethos definido.');
END;
/

-- 4.3 Handlers.
BEGIN
  -- Borrado previo: DEFINE_HANDLER falla si el handler ya existe.
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/login',  'POST');    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/login',  'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/logout', 'POST');    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/logout', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/me',     'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auth/me',     'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ----------------------------------------------------------------------------
  -- /auth/login  (publico)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auth/login',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- :usuario y :password los auto-bindea ORDS desde el JSON PLANO del body.
  -- OJO: el paquete ya emite MIME_HEADER/HTTP_HEADER_CLOSE — no emitirlos aca.
  -- Headers duplicados = respuesta corrupta.
  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auth/login',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => q'~
BEGIN
    PKG_AUTH_ETHOS.LOGIN(
        p_usuario  => :usuario,
        p_password => :password);
END;
~');

  ----------------------------------------------------------------------------
  -- /auth/logout  (token en el header Authorization)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auth/logout',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auth/logout',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => q'~
DECLARE
    l_token VARCHAR2(256);
    l_pos   PLS_INTEGER;
BEGIN
    l_token := :authorization;
    IF l_token IS NOT NULL THEN
        l_pos := INSTR(UPPER(l_token), 'BEARER ');
        IF l_pos > 0 THEN
            l_token := TRIM(SUBSTR(l_token, l_pos + 7));
        END IF;
    END IF;
    PKG_AUTH_ETHOS.LOGOUT(p_token => l_token);
END;
~');

  -- OBLIGATORIO: sin esto :authorization llega NULL y todo responde
  -- "Token invalido o expirado" aunque el login haya dado un token bueno.
  -- Va por CADA handler, no por template.
  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auth/logout',
      p_method             => 'POST',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- /auth/me  (protegido) — el front lo llama al arrancar para saber si la
  -- sesion guardada sigue viva. Es el patron a copiar para todo endpoint
  -- de negocio que se agregue despues.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auth/me',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auth/me',
      p_method      => 'GET',
      p_source_type => 'plsql/block',
      p_source      => q'~
DECLARE
    l_token VARCHAR2(256);
    l_pos   PLS_INTEGER;
BEGIN
    l_token := :authorization;
    IF l_token IS NOT NULL THEN
        l_pos := INSTR(UPPER(l_token), 'BEARER ');
        IF l_pos > 0 THEN
            l_token := TRIM(SUBSTR(l_token, l_pos + 7));
        END IF;
    END IF;
    PKG_AUTH_ETHOS.PERFIL(p_token => l_token);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auth/me',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers auth/login, auth/logout y auth/me publicados.');
END;
/

-- 4.4 Preflight CORS (OPTIONS), en bloque aparte y a prueba de fallos.
--
-- El preflight solo lo dispara un navegador pegandole DIRECTO a ORDS. Con la
-- arquitectura actual eso no pasa: el sitio web va por su proxy server-side
-- (mismo origen) y la app Expo no aplica CORS. O sea que esto es opcional.
--
-- Va en bloque aparte porque algunas versiones de ORDS solo aceptan
-- GET/POST/PUT/DELETE en p_method y rechazan OPTIONS. Si eso pasa preferimos un
-- [WARN] a tumbar el script entero.
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
    HTP.P('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;
~');
  END preflight;
BEGIN
  preflight('auth/login');
  preflight('auth/logout');
  preflight('auth/me');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado para los 3 endpoints.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Esta version de ORDS no acepta handlers OPTIONS: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('       No bloquea nada: el sitio web va por su proxy server-side y la');
    DBMS_OUTPUT.PUT_LINE('       app Expo no aplica CORS. Solo importa si algun dia se sirve el');
    DBMS_OUTPUT.PUT_LINE('       front web como sitio estatico, sin servidor Node.');
END;
/

--------------------------------------------------------------------------------
-- 5. VERIFICACION
--------------------------------------------------------------------------------

DECLARE
  l_pattern   VARCHAR2(255);
  l_sgid      NUMBER;
  l_handlers  NUMBER;
  l_base      VARCHAR2(500);
BEGIN
  DBMS_OUTPUT.PUT_LINE(RPAD('-', 78, '-'));

  -- Base path real del esquema en ORDS.
  BEGIN
    SELECT PATTERN INTO l_pattern FROM USER_ORDS_SCHEMAS WHERE ROWNUM = 1;
  EXCEPTION WHEN OTHERS THEN l_pattern := '???';
  END;
  l_base := 'https://oracleapex.com/ords/' || l_pattern || '/ethos/';

  -- El workspace configurado en el paquete tiene que existir.
  BEGIN
    l_sgid := APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => 'FUNDCARAC');
    IF l_sgid IS NULL THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] El workspace FUNDCARAC no existe o no es visible.');
      DBMS_OUTPUT.PUT_LINE('        Corrige c_workspace en PKG_AUTH_ETHOS y recompila.');
      DBMS_OUTPUT.PUT_LINE('        Workspaces visibles: SELECT WORKSPACE_NAME FROM APEX_WORKSPACES;');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Workspace FUNDCARAC encontrado (security_group_id ' || l_sgid || ').');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo validar el workspace: ' || SQLERRM);
  END;

  SELECT COUNT(*) INTO l_handlers
    FROM USER_ORDS_HANDLERS h
    JOIN USER_ORDS_TEMPLATES t ON t.ID = h.TEMPLATE_ID
    JOIN USER_ORDS_MODULES   m ON m.ID = t.MODULE_ID
   WHERE m.NAME = 'ethos';
  -- 3 = login/logout/me. 6 = ademas el preflight OPTIONS de cada uno.
  DBMS_OUTPUT.PUT_LINE('[INFO] Handlers publicados en el modulo ethos: ' || l_handlers ||
                       ' (3 sin preflight, 6 con preflight OPTIONS).');
  IF l_handlers < 3 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Faltan handlers. Revisa los mensajes de la seccion 4.');
  END IF;

  DBMS_OUTPUT.PUT_LINE(RPAD('-', 78, '-'));
  DBMS_OUTPUT.PUT_LINE('URL BASE PARA EL FRONTEND:');
  DBMS_OUTPUT.PUT_LINE('  ' || l_base);
  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('Ponela en:');
  DBMS_OUTPUT.PUT_LINE('  .env             ->  ORDS_TARGET / ORDS_PREFIX   (sitio web)');
  DBMS_OUTPUT.PUT_LINE('  mobile/app.json  ->  expo.extra.apiUrl           (app Expo)');
  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('Probar sin front:');
  DBMS_OUTPUT.PUT_LINE('  curl -X POST "' || l_base || 'auth/login" \');
  DBMS_OUTPUT.PUT_LINE('    -H "Content-Type: application/json" \');
  DBMS_OUTPUT.PUT_LINE('    -d ''{"usuario":"TU_USUARIO","password":"TU_CLAVE"}''');
  DBMS_OUTPUT.PUT_LINE(RPAD('-', 78, '-'));
END;
/
