--------------------------------------------------------------------------------
-- CLOUDINARY  —  Subida de archivos (fotos de facturas) firmada desde Oracle
--------------------------------------------------------------------------------
--
-- Nuevo (04/11/2026). No publica endpoints propios: es un servicio que usan
-- los paquetes de cada modulo (hoy solo facturas_facilitadores.sql), igual que
-- PKG_AUTH_ETHOS.
--
-- COMO SE SUBE UNA FOTO
--
--   El navegador sube el archivo DIRECTO a Cloudinary (no pasa por Oracle: ORDS
--   no tiene por que cargar con imagenes de varios MB). Pero el preset es
--   SIGNED: Cloudinary rechaza la subida si no viene firmada con el API SECRET,
--   y el secreto no puede estar en el navegador. Entonces:
--
--     1. El sitio le pide la firma al modulo (POST facturas-facilitadores/
--        firma-foto), que controla sesion y permiso.
--     2. El modulo llama a PKG_CLOUDINARY_ETHOS.escribir_firma: arma los
--        parametros (timestamp, preset, carpeta), los firma con SHA-1 + el
--        secreto y devuelve todo menos el secreto.
--     3. El navegador hace POST del archivo con esos campos a
--        https://api.cloudinary.com/v1_1/<cloud>/auto/upload y recibe el
--        secure_url.
--     4. Ese URL viaja en el guardar del modulo, que lo acepta solo si es de
--        NUESTRO cloud (es_url_propia).
--
--   La firma vence en una hora (lo controla Cloudinary con el timestamp).
--
-- COMO SE BORRA (04/11/2026)
--
--   borrar(url) lo hace Oracle (pide el secreto): un POST firmado a
--   .../<resource_type>/destroy con invalidate=true. Lo llaman los modulos
--   DESPUES de su COMMIT, al borrar el registro o al reemplazar o quitar la
--   foto: si Cloudinary falla, el dato ya quedo bien y solo se avisa. Necesita
--   que Oracle llegue a api.cloudinary.com (lo prueba `probar`).
--
-- CORRER DESPUES de auth.sql y ANTES de facturas_facilitadores.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta. No pisa lo cargado.
--
--------------------------------------------------------------------------------
-- Y DESPUES, A MANO (SQL Workshop -> SQL Commands), NUNCA EN ESTE ARCHIVO
--------------------------------------------------------------------------------
--
--   1. LA CLAVE Y EL SECRETO. En Cloudinary: Settings -> API Keys. El secreto
--      no se escribe en el repositorio ni se pasa por chat:
--
--        BEGIN PKG_CLOUDINARY_ETHOS.fijar_credenciales('la-api-key', 'el-api-secret'); END;
--
--   2. PROBAR. Dice si Oracle llega a Cloudinary, si la clave y el secreto
--      sirven y como esta configurado el preset:
--
--        BEGIN PKG_CLOUDINARY_ETHOS.probar; END;
--
--   El cloud y el preset ya vienen cargados (cayve9bx / fc). Si cambian:
--
--        BEGIN PKG_CLOUDINARY_ETHOS.configurar('otro-cloud', 'otro-preset'); END;
--
--------------------------------------------------------------------------------
-- CONFIGURACION (CLOUDINARY_CONFIG, clave / valor). PRIVADA.
--------------------------------------------------------------------------------
--
--   CLOUD_NAME     el cloud (es publico: va en cada URL de imagen)
--   UPLOAD_PRESET  el preset de subida, SIGNED
--   API_KEY        la clave de la API (va en cada subida, no es secreta)
--   API_SECRET     el secreto: NUNCA sale de Oracle
--
--   El asistente con IA no puede leer esta tabla: CLOUDINARY_* esta en
--   es_privada de ia_asistente.sql (hay que haber corrido ese script despues
--   del 04/11/2026; la verificacion de abajo avisa si no).
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
  SELECT COUNT(*) INTO l_n FROM all_objects
   WHERE object_name = 'PKG_AUTH_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Falta PKG_AUTH_ETHOS. Corre backend/auth.sql primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUTH_ETHOS encontrado.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) ESTRUCTURA: CLOUDINARY_CONFIG (si falta) ============================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'CLOUDINARY_CONFIG';
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[SKIP] La tabla CLOUDINARY_CONFIG ya existia.');
  ELSE
    EXECUTE IMMEDIATE q'~
      CREATE TABLE CLOUDINARY_CONFIG (
        CLAVE         VARCHAR2(60)   NOT NULL,
        VALOR         VARCHAR2(4000),
        MODIFICADO_EL DATE DEFAULT SYSDATE NOT NULL,
        CONSTRAINT PK_CLOUDINARY_CONFIG PRIMARY KEY (CLAVE)
      )~';
    EXECUTE IMMEDIATE q'~COMMENT ON TABLE CLOUDINARY_CONFIG IS 'Configuracion de Cloudinary (cloud, preset, clave y secreto de la API). Privada: la IA no la puede consultar'~';
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla CLOUDINARY_CONFIG creada.');
  END IF;

  -- Los valores de entrada. Los que ya estan no se tocan.
  FOR c IN (SELECT 'CLOUD_NAME' AS clave, 'cayve9bx' AS valor FROM dual
            UNION ALL SELECT 'UPLOAD_PRESET', 'fc' FROM dual) LOOP
    EXECUTE IMMEDIATE q'~
      MERGE INTO cloudinary_config t
      USING (SELECT :1 AS clave, :2 AS valor FROM dual) s
         ON (t.clave = s.clave)
       WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor)~'
      USING c.clave, c.valor;
  END LOOP;
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   CLOUDINARY_CONFIG con sus valores de entrada.');
END;
/

--------------------------------------------------------------------------------
-- === 3) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_CLOUDINARY_ETHOS AS

  -- Un valor de CLOUDINARY_CONFIG, o NULL.
  FUNCTION config(p_clave IN VARCHAR2) RETURN VARCHAR2;

  -- Que falta para poder subir ('falta el secreto...'), o NULL si esta todo.
  FUNCTION falta RETURN VARCHAR2;

  -- Escribe, dentro del objeto APEX_JSON que el llamador ya abrio:
  --   cloud_name, upload_url y "campos" (api_key, timestamp, upload_preset,
  --   asset_folder, signature): lo que el navegador manda junto al archivo.
  -- Llamarla SOLO si falta es NULL y despues de controlar sesion y permiso.
  PROCEDURE escribir_firma(p_carpeta IN VARCHAR2);

  -- TRUE si el URL es de una imagen o archivo de NUESTRO cloud.
  FUNCTION es_url_propia(p_url IN VARCHAR2) RETURN BOOLEAN;

  -- Borra de Cloudinary el archivo de ese URL (destroy firmado, con
  -- invalidate: deja de servirse tambien desde la CDN). NULL si quedo borrado
  -- (o ya no estaba); si no, el motivo. NUNCA lanza: el llamador ya hizo su
  -- COMMIT y el archivo es lo ultimo que se limpia. Un URL que no es de
  -- nuestro cloud no se toca.
  FUNCTION borrar(p_url IN VARCHAR2) RETURN VARCHAR2;

  -- A mano, en SQL Commands.
  PROCEDURE configurar(p_cloud_name IN VARCHAR2, p_upload_preset IN VARCHAR2);
  PROCEDURE fijar_credenciales(p_api_key IN VARCHAR2, p_api_secret IN VARCHAR2);
  PROCEDURE probar;

END PKG_CLOUDINARY_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_CLOUDINARY_ETHOS AS

  c_api CONSTANT VARCHAR2(40) := 'https://api.cloudinary.com/v1_1/';
  c_res CONSTANT VARCHAR2(40) := 'https://res.cloudinary.com/';

  FUNCTION config(p_clave IN VARCHAR2) RETURN VARCHAR2 IS
    l_v cloudinary_config.valor%TYPE;
  BEGIN
    SELECT TRIM(valor) INTO l_v FROM cloudinary_config WHERE clave = p_clave;
    RETURN l_v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END config;

  PROCEDURE fijar(p_clave IN VARCHAR2, p_valor IN VARCHAR2) IS
  BEGIN
    IF TRIM(p_valor) IS NULL THEN
      DELETE FROM cloudinary_config WHERE clave = p_clave;
    ELSE
      MERGE INTO cloudinary_config t
      USING (SELECT p_clave AS clave, TRIM(p_valor) AS valor FROM dual) s
         ON (t.clave = s.clave)
       WHEN MATCHED THEN UPDATE SET t.valor = s.valor, t.modificado_el = SYSDATE
       WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
    END IF;
  END fijar;

  FUNCTION falta RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE
      WHEN config('CLOUD_NAME') IS NULL    THEN 'Falta el cloud de Cloudinary'
      WHEN config('UPLOAD_PRESET') IS NULL THEN 'Falta el preset de subida de Cloudinary'
      WHEN config('API_KEY') IS NULL
        OR config('API_SECRET') IS NULL    THEN 'Faltan la clave y el secreto de Cloudinary '
                                                || '(PKG_CLOUDINARY_ETHOS.fijar_credenciales)'
    END;
  END falta;

  -- Segundos desde 1970 en UTC: el timestamp que espera Cloudinary.
  FUNCTION ahora_unix RETURN NUMBER IS
  BEGIN
    RETURN TRUNC((CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE) - DATE '1970-01-01') * 86400);
  END ahora_unix;

  -- SHA-1 en hexadecimal (minusculas) de los parametros + el secreto. Los
  -- parametros van en orden alfabetico, clave=valor unidos con '&', sin
  -- file, cloud_name, resource_type ni api_key: la regla de Cloudinary.
  -- STANDARD_HASH es de SQL (no existe en PL/SQL), de ahi el SELECT.
  FUNCTION firmar(p_parametros IN VARCHAR2) RETURN VARCHAR2 IS
    l_cadena VARCHAR2(4000) := p_parametros || config('API_SECRET');
    l_firma  VARCHAR2(40);
  BEGIN
    SELECT LOWER(RAWTOHEX(STANDARD_HASH(l_cadena, 'SHA1'))) INTO l_firma FROM dual;
    RETURN l_firma;
  END firmar;

  PROCEDURE escribir_firma(p_carpeta IN VARCHAR2) IS
    l_cloud   VARCHAR2(200) := config('CLOUD_NAME');
    l_preset  VARCHAR2(200) := config('UPLOAD_PRESET');
    l_ts      NUMBER        := ahora_unix;
    l_carpeta VARCHAR2(200) := TRIM(p_carpeta);
    l_params  VARCHAR2(4000);
  BEGIN
    -- En orden alfabetico: asset_folder, timestamp, upload_preset.
    l_params := CASE WHEN l_carpeta IS NOT NULL THEN 'asset_folder=' || l_carpeta || '&' END
             || 'timestamp=' || l_ts
             || '&upload_preset=' || l_preset;

    APEX_JSON.WRITE('cloud_name', l_cloud);
    -- auto: acepta imagenes y PDF (la factura electronica viene en PDF).
    APEX_JSON.WRITE('upload_url', c_api || l_cloud || '/auto/upload');
    APEX_JSON.OPEN_OBJECT('campos');
    APEX_JSON.WRITE('api_key',       config('API_KEY'));
    APEX_JSON.WRITE('timestamp',     TO_CHAR(l_ts));
    APEX_JSON.WRITE('upload_preset', l_preset);
    IF l_carpeta IS NOT NULL THEN
      APEX_JSON.WRITE('asset_folder', l_carpeta);
    END IF;
    APEX_JSON.WRITE('signature',     firmar(l_params));
    APEX_JSON.CLOSE_OBJECT;
  END escribir_firma;

  FUNCTION es_url_propia(p_url IN VARCHAR2) RETURN BOOLEAN IS
    l_cloud VARCHAR2(200) := config('CLOUD_NAME');
  BEGIN
    RETURN l_cloud IS NOT NULL
       AND SUBSTR(p_url, 1, LENGTH(c_res || l_cloud || '/')) = c_res || l_cloud || '/'
       -- Nada que pueda romper un atributo HTML o colar otra cosa.
       AND NOT REGEXP_LIKE(p_url, '[[:space:]"''<>\\]');
  END es_url_propia;

  ------------------------------------------------------------------------------
  -- BORRAR. Del secure_url salen el resource_type y el public_id:
  --
  --   https://res.cloudinary.com/<cloud>/image/upload/v1730000000/facturas-facilitadores/abc123.jpg
  --                                      ^^^^^ ^^^^^^ ^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  --                              resource_type  tipo  version       public_id (+ extension)
  --
  -- Para image y video el public_id va SIN la extension; para raw, con ella.
  -- Un PDF subido con auto/upload es 'image'.
  ------------------------------------------------------------------------------
  FUNCTION borrar(p_url IN VARCHAR2) RETURN VARCHAR2 IS
    l_cloud     VARCHAR2(200) := config('CLOUD_NAME');
    l_resto     VARCHAR2(4000);
    l_tipo_rec  VARCHAR2(20);
    l_public_id VARCHAR2(4000);
    l_ts        NUMBER := ahora_unix;
    l_resp      CLOB;
    l_status    NUMBER;
    l_result    VARCHAR2(100);
    l_nombres   APEX_APPLICATION_GLOBAL.VC_ARR2;
    l_valores   APEX_APPLICATION_GLOBAL.VC_ARR2;
  BEGIN
    IF TRIM(p_url) IS NULL THEN
      RETURN NULL;
    END IF;
    IF NOT es_url_propia(p_url) THEN
      RETURN 'El enlace no es del Cloudinary del sistema: no se toco';
    END IF;
    IF falta IS NOT NULL THEN
      RETURN falta;
    END IF;

    l_resto    := SUBSTR(p_url, LENGTH(c_res || l_cloud || '/') + 1);
    l_resto    := REGEXP_REPLACE(l_resto, '[?#].*$', '');
    l_tipo_rec := REGEXP_SUBSTR(l_resto, '^[^/]+');
    -- Sin resource_type y tipo de entrega (upload), sin la version.
    l_public_id := REGEXP_REPLACE(l_resto, '^[^/]+/[^/]+/', '');
    l_public_id := REGEXP_REPLACE(l_public_id, '^v[0-9]+/', '');
    IF l_tipo_rec <> 'raw' THEN
      l_public_id := REGEXP_REPLACE(l_public_id, '\.[^./]+$', '');
    END IF;
    l_public_id := UTL_URL.UNESCAPE(l_public_id);
    IF l_tipo_rec NOT IN ('image', 'video', 'raw') OR l_public_id IS NULL THEN
      RETURN 'No se pudo leer el archivo del enlace';
    END IF;

    -- La firma: los parametros en orden alfabetico, sin api_key ni resource_type.
    l_nombres(1) := 'api_key';    l_valores(1) := config('API_KEY');
    l_nombres(2) := 'invalidate'; l_valores(2) := 'true';
    l_nombres(3) := 'public_id';  l_valores(3) := l_public_id;
    l_nombres(4) := 'timestamp';  l_valores(4) := TO_CHAR(l_ts);
    l_nombres(5) := 'signature';
    l_valores(5) := firmar('invalidate=true&public_id=' || l_public_id || '&timestamp=' || l_ts);

    APEX_WEB_SERVICE.g_request_headers.DELETE;
    APEX_WEB_SERVICE.g_request_headers(1).name  := 'Content-Type';
    APEX_WEB_SERVICE.g_request_headers(1).value := 'application/x-www-form-urlencoded';
    l_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
                p_url         => c_api || l_cloud || '/' || l_tipo_rec || '/destroy',
                p_http_method => 'POST',
                p_parm_name   => l_nombres,
                p_parm_value  => l_valores);
    l_status := APEX_WEB_SERVICE.g_status_code;

    BEGIN
      l_result := JSON_VALUE(l_resp, '$.result');
    EXCEPTION
      WHEN OTHERS THEN l_result := NULL;
    END;
    -- 'not found': ya no estaba, que es lo que se queria.
    IF l_status = 200 AND l_result IN ('ok', 'not found') THEN
      RETURN NULL;
    END IF;
    RETURN 'Cloudinary respondio ' || l_status || ': ' || DBMS_LOB.SUBSTR(l_resp, 200, 1);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'No se pudo conectar con Cloudinary: ' || SQLERRM;
  END borrar;

  /* ---------------------------------------------------------------------- */
  /* A MANO, EN SQL COMMANDS                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE configurar(p_cloud_name IN VARCHAR2, p_upload_preset IN VARCHAR2) IS
  BEGIN
    fijar('CLOUD_NAME', p_cloud_name);
    fijar('UPLOAD_PRESET', p_upload_preset);
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('[OK]   Cloud ' || NVL(config('CLOUD_NAME'), '(ninguno)')
                         || ', preset ' || NVL(config('UPLOAD_PRESET'), '(ninguno)') || '.');
  END configurar;

  PROCEDURE fijar_credenciales(p_api_key IN VARCHAR2, p_api_secret IN VARCHAR2) IS
  BEGIN
    fijar('API_KEY', p_api_key);
    fijar('API_SECRET', p_api_secret);
    COMMIT;
    IF config('API_SECRET') IS NULL THEN
      DBMS_OUTPUT.PUT_LINE('[OK]   Credenciales borradas: no se pueden subir fotos.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Credenciales guardadas (clave ' || config('API_KEY')
                           || ', secreto terminado en ...' || SUBSTR(config('API_SECRET'), -4)
                           || '). Proba con: BEGIN PKG_CLOUDINARY_ETHOS.probar; END;');
    END IF;
  END fijar_credenciales;

  -- GET a la Admin API, que se autentica con clave:secreto (basic auth).
  FUNCTION admin_get(p_ruta IN VARCHAR2, p_status OUT NUMBER) RETURN CLOB IS
    l_resp CLOB;
  BEGIN
    APEX_WEB_SERVICE.g_request_headers.DELETE;
    l_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
                p_url         => c_api || config('CLOUD_NAME') || '/' || p_ruta,
                p_http_method => 'GET',
                p_username    => config('API_KEY'),
                p_password    => config('API_SECRET'));
    p_status := APEX_WEB_SERVICE.g_status_code;
    RETURN l_resp;
  END admin_get;

  PROCEDURE probar IS
    l_status NUMBER;
    l_resp   CLOB;
    l_preset JSON_OBJECT_T;
    l_set    JSON_OBJECT_T;
  BEGIN
    IF falta IS NOT NULL THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] ' || falta || '.');
      RETURN;
    END IF;
    DBMS_OUTPUT.PUT_LINE('[OK]   Cloud ' || config('CLOUD_NAME') || ', preset '
                         || config('UPLOAD_PRESET') || ', clave ' || config('API_KEY') || '.');

    l_resp := admin_get('ping', l_status);
    IF l_status = 200 THEN
      DBMS_OUTPUT.PUT_LINE('[OK]   Oracle llega a Cloudinary y la clave y el secreto sirven.');
    ELSIF l_status = 401 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Cloudinary rechazo la clave o el secreto (401). Revisalos en');
      DBMS_OUTPUT.PUT_LINE('        Settings -> API Keys y volve a correr fijar_credenciales.');
      RETURN;
    ELSE
      DBMS_OUTPUT.PUT_LINE('[ERROR] Cloudinary respondio ' || l_status || ': '
                           || DBMS_LOB.SUBSTR(l_resp, 300, 1));
      DBMS_OUTPUT.PUT_LINE('        Si el cloud esta mal: PKG_CLOUDINARY_ETHOS.configurar.');
      RETURN;
    END IF;

    l_resp := admin_get('upload_presets/' || config('UPLOAD_PRESET'), l_status);
    IF l_status = 200 THEN
      l_preset := JSON_OBJECT_T.parse(l_resp);
      IF l_preset.get_boolean('unsigned') THEN
        DBMS_OUTPUT.PUT_LINE('[WARN] El preset ' || config('UPLOAD_PRESET') || ' es UNSIGNED: anda,');
        DBMS_OUTPUT.PUT_LINE('       pero cualquiera con su nombre puede subir. Mejor Signed.');
      ELSE
        DBMS_OUTPUT.PUT_LINE('[OK]   El preset ' || config('UPLOAD_PRESET') || ' es Signed.');
      END IF;
      l_set := l_preset.get_object('settings');
      IF l_set IS NOT NULL AND l_set.has('asset_folder') THEN
        DBMS_OUTPUT.PUT_LINE('       Su carpeta: ' || l_set.get_string('asset_folder')
                             || ' (cada modulo la cambia por la suya al subir).');
      END IF;
    ELSIF l_status = 404 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe el preset ' || config('UPLOAD_PRESET')
                           || ' en el cloud ' || config('CLOUD_NAME') || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo leer el preset (' || l_status || '): '
                           || DBMS_LOB.SUBSTR(l_resp, 300, 1));
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo conectar con https://api.cloudinary.com: ' || SQLERRM);
      DBMS_OUTPUT.PUT_LINE('        Si es ORA-24247 (ACL) o un error de certificado, la instancia');
      DBMS_OUTPUT.PUT_LINE('        no deja salir a ese host. La subida desde el navegador anda');
      DBMS_OUTPUT.PUT_LINE('        igual: esta prueba es lo unico que necesita salir de Oracle.');
  END probar;

END PKG_CLOUDINARY_ETHOS;
/

--------------------------------------------------------------------------------
-- === 4) VERIFICACION ========================================================
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
  l_n      PLS_INTEGER;
BEGIN
  BEGIN
    SELECT status INTO l_estado FROM user_objects
     WHERE object_name = 'PKG_CLOUDINARY_ETHOS' AND object_type = 'PACKAGE BODY';
    IF l_estado = 'VALID' THEN
      DBMS_OUTPUT.PUT_LINE('[OK]   PKG_CLOUDINARY_ETHOS compilado.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_CLOUDINARY_ETHOS quedo INVALID.');
      FOR e IN (SELECT line, text FROM user_errors
                 WHERE name = 'PKG_CLOUDINARY_ETHOS' ORDER BY type, sequence) LOOP
        DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
      END LOOP;
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_CLOUDINARY_ETHOS no se creo.');
  END;

  -- Que el asistente con IA no pueda leer el secreto.
  SELECT COUNT(*) INTO l_n FROM user_objects
   WHERE object_name = 'PKG_IA_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_n > 0 THEN
    SELECT COUNT(*) INTO l_n FROM user_source
     WHERE name = 'PKG_IA_ETHOS' AND type = 'PACKAGE BODY' AND text LIKE '%CLOUDINARY%';
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[WARN] El asistente con IA todavia puede leer CLOUDINARY_CONFIG:');
      DBMS_OUTPUT.PUT_LINE('       volve a correr backend/ia_asistente.sql ANTES de cargar el secreto.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   El asistente con IA no ve CLOUDINARY_CONFIG.');
    END IF;
  END IF;

  IF PKG_CLOUDINARY_ETHOS.falta IS NOT NULL THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] ' || PKG_CLOUDINARY_ETHOS.falta || '. Ver el encabezado.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Listo para firmar. Proba con: BEGIN PKG_CLOUDINARY_ETHOS.probar; END;');
  END IF;
END;
/
