--------------------------------------------------------------------------------
-- CATALOGOS — endpoints de solo lectura para los combos del formulario de
-- evaluaciones (facilitadores, instituciones, areas, evaluaciones y la cascada
-- pais -> departamento -> ciudad).
--
-- Ejecutar completo como el DUEÑO DEL ESQUEMA. Idempotente.
-- Requiere backend/ethos_auth.sql (PKG_AUTH_ETHOS + modulo ORDS 'ethos').
--
-- ENDPOINTS
--   GET  catalogos                 -> que catalogos hay y cuales existen de verdad
--   GET  catalogos/:nombre         -> filas del catalogo
--        ?id_pais=&id_departamento=&limite=
--
--   Protegidos: Authorization: Bearer <token>.
--
-- POR QUE ESTE DISEÑO (un endpoint generico y no uno tipado por tabla)
--
--   No tengo el DDL de FACILITADORES, INSTITUCIONES, AREAS_EVALUACIONES,
--   EVALUACIONES ni CIUDADES, o sea que no se como se llama la columna
--   descriptiva de cada una (¿NOMBRE? ¿DESCRIPCION? ¿RAZON_SOCIAL?). Adivinar
--   rompe la compilacion.
--
--   Solucion: APEX_JSON.WRITE sabe serializar un REF CURSOR usando los nombres
--   de columna como claves del JSON. Con SELECT * el endpoint devuelve la tabla
--   entera tal como esta, y el front elige que campo mostrar. Sirve hoy, sin
--   saber nada del DDL.
--
--   LA CONTRA, para que la sepas y no te sorprenda:
--     * Devuelve TODAS las columnas, incluidas las que no le importan al combo.
--       Si alguna tabla tiene datos sensibles (documento, telefono, salario),
--       este endpoint los expone a cualquiera con token.
--     * Sin busqueda por texto ni ORDER BY por descripcion: sin saber el nombre
--       de la columna no se puede. Ordena por la PK y el front ordena/filtra en
--       memoria, que con listas de combo alcanza.
--   Cuando me pases los DDL esto se reemplaza por endpoints tipados
--   (id + descripcion, con ?buscar= y orden alfabetico en la base).
--
-- SEGURIDAD DEL SQL DINAMICO
--   El :nombre del cliente NUNCA se concatena en la consulta. Solo elige, con un
--   CASE, cual de las consultas escritas a mano se ejecuta. Si el nombre no esta
--   en la lista blanca, responde 400 sin tocar la base. No hay inyeccion posible.
--------------------------------------------------------------------------------

SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED

--------------------------------------------------------------------------------
-- === 1) PAQUETE PKG_CATALOGOS_ETHOS ========================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_CATALOGOS_ETHOS AS

  -- Lista los catalogos disponibles y si la tabla existe en el esquema.
  PROCEDURE indice(p_token IN VARCHAR2);

  -- Filas de un catalogo de la lista blanca.
  -- p_id_pais / p_id_departamento solo aplican a 'departamentos' y 'ciudades'.
  PROCEDURE listar(
      p_token           IN VARCHAR2,
      p_nombre          IN VARCHAR2,
      p_id_pais         IN NUMBER   DEFAULT NULL,
      p_id_departamento IN NUMBER   DEFAULT NULL,
      p_limite          IN NUMBER   DEFAULT NULL);

END PKG_CATALOGOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_CATALOGOS_ETHOS AS

  c_limite_defecto CONSTANT PLS_INTEGER := 500;
  c_limite_maximo  CONSTANT PLS_INTEGER := 2000;

------------------------------------------------------------------------------
-- Helpers de respuesta (mismo patron que PKG_AUTH_ETHOS)
------------------------------------------------------------------------------

PROCEDURE abrir_json IS
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Access-Control-Allow-Origin: *');
    HTP.P('Access-Control-Allow-Methods: GET, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END abrir_json;

-- STATUS_LINE va ANTES de MIME_HEADER o el status se pierde.
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

FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
END f_usuario;

------------------------------------------------------------------------------
-- Lista blanca
------------------------------------------------------------------------------

-- Nombre publico del catalogo -> tabla real.
-- PAISES y DEPARTAMENTOS son una SUPOSICION: la FK de EVALUACIONES_FACILITADORES
-- solo prueba que CIUDADES tiene (ID_PAIS, ID_DEPARTAMENTO, ID_CIUDAD), no como
-- se llaman las tablas de arriba. Si en tu esquema son PAIS/DEPARTAMENTO u otra
-- cosa, cambia estas dos lineas. El indice te dice cuales existen.
FUNCTION f_tabla(p_nombre IN VARCHAR2) RETURN VARCHAR2 IS
BEGIN
    RETURN CASE LOWER(TRIM(p_nombre))
             WHEN 'facilitadores'      THEN 'FACILITADORES'
             WHEN 'instituciones'      THEN 'INSTITUCIONES'
             WHEN 'areas'              THEN 'AREAS_EVALUACIONES'
             WHEN 'evaluaciones'       THEN 'EVALUACIONES'
             WHEN 'paises'             THEN 'PAISES'
             WHEN 'departamentos'      THEN 'DEPARTAMENTOS'
             WHEN 'ciudades'           THEN 'CIUDADES'
             ELSE NULL
           END;
END f_tabla;

FUNCTION f_existe(p_tabla IN VARCHAR2) RETURN BOOLEAN IS
    l_c PLS_INTEGER;
BEGIN
    SELECT COUNT(*) INTO l_c
      FROM user_tables
     WHERE table_name = p_tabla;
    RETURN l_c > 0;
END f_existe;

------------------------------------------------------------------------------
-- INDICE
------------------------------------------------------------------------------
PROCEDURE indice(p_token IN VARCHAR2) IS
    l_usuario VARCHAR2(255);

    PROCEDURE fila(p_nombre IN VARCHAR2) IS
        l_tabla VARCHAR2(128) := f_tabla(p_nombre);
    BEGIN
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('nombre', p_nombre);
        APEX_JSON.WRITE('tabla',  l_tabla);
        APEX_JSON.WRITE('existe', f_existe(l_tabla));
        APEX_JSON.CLOSE_OBJECT;
    END fila;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    fila('facilitadores');
    fila('instituciones');
    fila('areas');
    fila('evaluaciones');
    fila('paises');
    fila('departamentos');
    fila('ciudades');
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END indice;

------------------------------------------------------------------------------
-- LISTAR
------------------------------------------------------------------------------
PROCEDURE listar(
    p_token           IN VARCHAR2,
    p_nombre          IN VARCHAR2,
    p_id_pais         IN NUMBER   DEFAULT NULL,
    p_id_departamento IN NUMBER   DEFAULT NULL,
    p_limite          IN NUMBER   DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_clave   VARCHAR2(64) := LOWER(TRIM(p_nombre));
    l_tabla   VARCHAR2(128);
    l_limite  PLS_INTEGER;
    l_cursor  SYS_REFCURSOR;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    l_tabla := f_tabla(l_clave);
    IF l_tabla IS NULL THEN
        p_error(400, 'Bad Request',
                'Catalogo desconocido. Validos: facilitadores, instituciones, '
                || 'areas, evaluaciones, paises, departamentos, ciudades');
        RETURN;
    END IF;

    IF NOT f_existe(l_tabla) THEN
        p_error(404, 'Not Found',
                'La tabla ' || l_tabla || ' no existe en este esquema. '
                || 'Revisa el mapeo en PKG_CATALOGOS_ETHOS.f_tabla.');
        RETURN;
    END IF;

    l_limite := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);
    IF l_limite < 1 THEN
        l_limite := c_limite_defecto;
    END IF;

    -- Cada rama es una consulta ESCRITA A MANO. Lo del cliente entra solo por
    -- bind, nunca concatenado.
    --
    -- OJO al tocar el USING: en SQL dinamico nativo los binds se pasan por
    -- ORDEN DE APARICION en el texto, no por nombre. Un placeholder que aparece
    -- dos veces necesita DOS valores en el USING (por eso p_id_pais va repetido).
    -- Si agregas o mueves una condicion, recontar los binds.
    CASE l_clave
      WHEN 'ciudades' THEN
        OPEN l_cursor FOR
          'SELECT * FROM ciudades
            WHERE (:pais_a IS NULL OR id_pais = :pais_b)
              AND (:depto_a IS NULL OR id_departamento = :depto_b)
            ORDER BY id_pais, id_departamento, id_ciudad
            FETCH FIRST :tope ROWS ONLY'
          USING p_id_pais, p_id_pais, p_id_departamento, p_id_departamento, l_limite;

      WHEN 'departamentos' THEN
        OPEN l_cursor FOR
          'SELECT * FROM departamentos
            WHERE (:pais_a IS NULL OR id_pais = :pais_b)
            ORDER BY id_pais, id_departamento
            FETCH FIRST :tope ROWS ONLY'
          USING p_id_pais, p_id_pais, l_limite;

      ELSE
        -- Resto de catalogos: sin jerarquia. ORDER BY 1 = la primera columna,
        -- que en estas tablas es la PK. No ordeno por descripcion porque no se
        -- como se llama: que ordene el front, son listas cortas.
        --
        -- l_tabla NO viene del cliente: sale del CASE de f_tabla, que devuelve
        -- literales escritos aca. Por eso concatenarlo es seguro.
        OPEN l_cursor FOR
          'SELECT * FROM ' || l_tabla || ' ORDER BY 1 FETCH FIRST :tope ROWS ONLY'
          USING l_limite;
    END CASE;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',  TRUE);
    APEX_JSON.WRITE('catalogo', l_clave);
    APEX_JSON.WRITE('tabla',    l_tabla);
    -- Si vuelven exactamente 'limite' filas, puede haber mas: que el front lo sepa.
    APEX_JSON.WRITE('limite',   l_limite);
    -- APEX_JSON serializa el cursor usando los nombres de columna como claves.
    APEX_JSON.WRITE('data', l_cursor);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        IF l_cursor%ISOPEN THEN
            CLOSE l_cursor;
        END IF;
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END listar;

END PKG_CATALOGOS_ETHOS;
/

--------------------------------------------------------------------------------
-- === 2) ENDPOINTS ORDS =====================================================
-- Se agregan al modulo 'ethos' que ya creo ethos_auth.sql.
-- El PAQUETE emite los headers, el handler NO.
-- El DEFINE_PARAMETER del Authorization va por CADA handler.
--------------------------------------------------------------------------------

BEGIN
  BEGIN ORDS.DELETE_HANDLER('ethos', 'catalogos',         'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'catalogos',         'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'catalogos/:nombre', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'catalogos/:nombre', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ----------------------------------------------------------------------------
  -- catalogos  (indice)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'catalogos',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'catalogos',
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
    PKG_CATALOGOS_ETHOS.INDICE(p_token => l_token);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'catalogos',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- catalogos/:nombre
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'catalogos/:nombre',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'catalogos/:nombre',
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
    PKG_CATALOGOS_ETHOS.LISTAR(
        p_token           => l_token,
        p_nombre          => :nombre,
        p_id_pais         => TO_NUMBER(:id_pais),
        p_id_departamento => TO_NUMBER(:id_departamento),
        p_limite          => TO_NUMBER(:limite));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'catalogos/:nombre',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de catalogos publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudieron publicar los handlers: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/ethos_auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, en bloque aparte: algunas versiones de ORDS rechazan OPTIONS.
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
    HTP.P('Access-Control-Allow-Methods: GET, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;
~');
  END preflight;
BEGIN
  preflight('catalogos');
  preflight('catalogos/:nombre');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Esta version de ORDS no acepta handlers OPTIONS: ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 3) VERIFICACION =======================================================
-- Dice que tablas de la lista blanca existen de verdad y con que columnas, que
-- es justo lo que hace falta para escribir despues los endpoints tipados.
--------------------------------------------------------------------------------

DECLARE
  l_n NUMBER;

  PROCEDURE ver(p_nombre IN VARCHAR2, p_tabla IN VARCHAR2) IS
    l_c    NUMBER;
    l_cols VARCHAR2(4000);
  BEGIN
    SELECT COUNT(*) INTO l_c FROM user_tables WHERE table_name = p_tabla;
    IF l_c = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[FALTA] ' || RPAD(p_nombre, 15) || ' -> ' || p_tabla
                           || ' no existe en este esquema');
      RETURN;
    END IF;

    SELECT LISTAGG(column_name, ', ') WITHIN GROUP (ORDER BY column_id)
      INTO l_cols
      FROM user_tab_columns
     WHERE table_name = p_tabla;

    DBMS_OUTPUT.PUT_LINE('[OK]    ' || RPAD(p_nombre, 15) || ' -> ' || p_tabla);
    DBMS_OUTPUT.PUT_LINE('        ' || SUBSTR(l_cols, 1, 3800));
  END ver;
BEGIN
  DBMS_OUTPUT.PUT_LINE('--- Paquete -----------------------------------------------');
  SELECT COUNT(*) INTO l_n FROM user_errors WHERE name = 'PKG_CATALOGOS_ETHOS';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    PKG_CATALOGOS_ETHOS compilo sin errores.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_CATALOGOS_ETHOS tiene ' || l_n || ' error(es):');
    FOR e IN (SELECT line, position, text FROM user_errors
               WHERE name = 'PKG_CATALOGOS_ETHOS' ORDER BY sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        linea ' || e.line || ',' || e.position || ': ' || e.text);
    END LOOP;
  END IF;

  DBMS_OUTPUT.PUT_LINE('--- Catalogos y sus columnas ------------------------------');
  DBMS_OUTPUT.PUT_LINE('    (copia esta salida y pasamela: con esto se escriben');
  DBMS_OUTPUT.PUT_LINE('     los endpoints tipados con id + descripcion)');
  ver('facilitadores', 'FACILITADORES');
  ver('instituciones', 'INSTITUCIONES');
  ver('areas',         'AREAS_EVALUACIONES');
  ver('evaluaciones',  'EVALUACIONES');
  ver('paises',        'PAISES');
  ver('departamentos', 'DEPARTAMENTOS');
  ver('ciudades',      'CIUDADES');
END;
/

--------------------------------------------------------------------------------
-- === 4) PRUEBA RAPIDA ======================================================
--
--   TOKEN=$(curl -s -X POST "https://oracleapex.com/ords/fundcarac/ethos/auth/login" \
--     -H "Content-Type: application/json" -d '{"usuario":"joseg","password":"xxx"}' \
--     | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
--
--   curl -s ".../ethos/catalogos"                      -H "Authorization: Bearer $TOKEN"
--   curl -s ".../ethos/catalogos/facilitadores"        -H "Authorization: Bearer $TOKEN"
--   curl -s ".../ethos/catalogos/departamentos?id_pais=1" -H "Authorization: Bearer $TOKEN"
--   curl -s ".../ethos/catalogos/ciudades?id_pais=1&id_departamento=3" \
--        -H "Authorization: Bearer $TOKEN"
--------------------------------------------------------------------------------
