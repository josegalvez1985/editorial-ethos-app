--------------------------------------------------------------------------------
-- DEPARTAMENTOS  —  ABM de departamentos (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 6 de APEX (Departamentos, un IG sobre
-- DEPARTAMENTOS) y a su modal 7 (Crear Departamento). La 7 NO es una pagina en
-- el sitio: es el dialogo de la pantalla /departamentos, con los permisos de
-- la 6.
--
-- La tabla, segun las paginas de APEX: ID_DEPARTAMENTO (PK), ID_PAIS
-- (obligatorio, FK a PAISES) y NOMBRE (obligatorio, hasta 200).
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     departamentos        todos, con su pais y en que tablas se usa
--                                cada uno
--   POST    departamentos        {id_pais, nombre}  -> {id_departamento}
--   PUT     departamentos/:id    {id_pais, nombre}
--   DELETE  departamentos/:id    solo si nada lo usa
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql (permisos) y paises.sql (la
-- pantalla lee los paises de ahi para el selector).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EN USO: LO DICE LA BASE, NO UNA LISTA A MANO
--------------------------------------------------------------------------------
--
-- Igual que paises.sql: el listado busca en USER_CONSTRAINTS las FK de una
-- columna que apuntan a DEPARTAMENTOS (salvo las _JN) y cuenta cuantas filas
-- usan cada departamento. Es el unico SQL dinamico del paquete. Una tabla que
-- guarde ID_DEPARTAMENTO SIN FK no se detecta.
--
--------------------------------------------------------------------------------
-- REPETIDOS
--------------------------------------------------------------------------------
--
-- Un nombre se repite DENTRO DEL MISMO PAIS, sin distinguir mayusculas: dos
-- paises pueden tener un departamento que se llame igual.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion: los combos de otras pantallas (el departamento de una
--           ciudad, por ejemplo) necesitan la lista.
--   POST    PUEDE_INSERTAR   en la pagina de /departamentos (la 6)
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
--
--------------------------------------------------------------------------------
-- EL ID DE UN DEPARTAMENTO NUEVO
--------------------------------------------------------------------------------
--
-- Como APEX: se inserta sin ID_DEPARTAMENTO y la tabla lo completa (identity o
-- trigger). Si no lo completa (ORA-01400), cae al mayor mas 1 con la tabla
-- bloqueada.
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
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'backend/roles_paginas.sql' FROM dual
            UNION ALL SELECT 'PKG_PAISES_ETHOS', 'backend/paises.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = 'PACKAGE BODY';
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'DEPARTAMENTOS';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla DEPARTAMENTOS.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla DEPARTAMENTOS encontrada.');
    -- Un trigger de bitacora escrito a mano puede tener el ORA-04084 en DELETE
    -- que tenia SUCURSALES_JNTRG. Se listan para saber cuales hay.
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'DEPARTAMENTOS' ORDER BY trigger_name) LOOP
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

CREATE OR REPLACE PACKAGE PKG_DEPARTAMENTOS_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(
    p_token   IN VARCHAR2,
    p_id      IN VARCHAR2,
    p_id_pais IN VARCHAR2,
    p_nombre  IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_DEPARTAMENTOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_DEPARTAMENTOS_ETHOS AS

  c_ruta  CONSTANT VARCHAR2(20) := '/departamentos';
  -- El largo de DEPARTAMENTOS.NOMBRE (el IG y el form de APEX cortan en 200).
  c_largo CONSTANT PLS_INTEGER  := 200;

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
        p_error(409, 'Conflict', 'Ya existe un departamento con ese nombre');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'El pais elegido no existe');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan ese departamento');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'El nombre no puede pasar de ' || c_largo || ' caracteres');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de DEPARTAMENTOS asigna :NEW en un DELETE (ORA-04084). '
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
  -- piden la accion en la pagina de /departamentos. FALSE = ya respondio.
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
          || ' departamentos');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  -- Las tablas con FK de una columna hacia DEPARTAMENTOS, y cuantas filas de
  -- cada una usan cada departamento. Ver "EN USO" en el encabezado.
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
                                        WHERE table_name = 'DEPARTAMENTOS'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
         ORDER BY c.table_name
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

  ------------------------------------------------------------------------------
  -- Ordenados por pais y nombre: la pantalla los agrupa por pais. LEFT JOIN
  -- por si alguno quedo con un ID_PAIS que ya no existe (la columna es
  -- obligatoria, pero la FK no la vi): sale con pais vacio en vez de perderse.
  ------------------------------------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_hijas(l_hijas);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo', c_largo);
    APEX_JSON.OPEN_ARRAY('tablas');
    FOR i IN 1 .. l_hijas.COUNT LOOP
      APEX_JSON.WRITE(l_hijas(i).tabla);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT d.id_departamento, d.id_pais, p.nombre AS pais, d.nombre
                FROM departamentos d
                LEFT JOIN paises p ON p.id_pais = d.id_pais
               ORDER BY UPPER(p.nombre), UPPER(d.nombre)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_departamento', r.id_departamento);
      APEX_JSON.WRITE('id_pais',         r.id_pais);
      APEX_JSON.WRITE('pais',            r.pais);
      APEX_JSON.WRITE('nombre',          r.nombre);
      APEX_JSON.OPEN_ARRAY('usos');
      FOR i IN 1 .. l_hijas.COUNT LOOP
        IF l_hijas(i).cuentas.EXISTS(r.id_departamento) THEN
          APEX_JSON.OPEN_OBJECT;
          APEX_JSON.WRITE('tabla',    l_hijas(i).tabla);
          APEX_JSON.WRITE('cantidad', l_hijas(i).cuentas(r.id_departamento));
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
  -- El nombre se guarda TRIM y con los espacios internos colapsados. Repetido
  -- se valida dentro del mismo pais, sin distinguir mayusculas.
  ------------------------------------------------------------------------------
  PROCEDURE guardar(
    p_token   IN VARCHAR2,
    p_id      IN VARCHAR2,
    p_id_pais IN VARCHAR2,
    p_nombre  IN VARCHAR2)
  IS
    -- 32767: un texto mas largo romperia en la declaracion, antes del
    -- EXCEPTION. El tope real se valida abajo con mensaje.
    l_nombre  VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_nombre, '\s+', ' '));
    l_id      NUMBER := f_numero(p_id);
    l_id_pais NUMBER := f_numero(p_id_pais);
    l_n       PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de departamento invalido'); RETURN;
    END IF;
    IF l_id_pais IS NULL THEN
      p_error(400, 'Bad Request', 'El pais es obligatorio'); RETURN;
    END IF;
    IF l_nombre IS NULL THEN
      p_error(400, 'Bad Request', 'El nombre es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_nombre) > c_largo THEN
      p_error(400, 'Bad Request', 'El nombre no puede pasar de ' || c_largo || ' caracteres');
      RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM paises WHERE id_pais = l_id_pais;
    IF l_n = 0 THEN
      p_error(400, 'Bad Request', 'El pais elegido no existe'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM departamentos
     WHERE id_pais = l_id_pais
       AND UPPER(nombre) = UPPER(l_nombre)
       AND (l_id IS NULL OR id_departamento <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Ya existe "' || l_nombre || '" en ese pais'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      BEGIN
        INSERT INTO departamentos (id_pais, nombre) VALUES (l_id_pais, l_nombre)
        RETURNING id_departamento INTO l_id;
      EXCEPTION
        WHEN OTHERS THEN
          -- La tabla no completa ID_DEPARTAMENTO: el mayor mas 1, bloqueada
          -- para que dos altas a la vez no tomen el mismo.
          IF SQLCODE = -1400 AND INSTR(SQLERRM, '"ID_DEPARTAMENTO"') > 0 THEN
            LOCK TABLE departamentos IN EXCLUSIVE MODE;
            SELECT NVL(MAX(id_departamento), 0) + 1 INTO l_id FROM departamentos;
            INSERT INTO departamentos (id_departamento, id_pais, nombre)
            VALUES (l_id, l_id_pais, l_nombre);
          ELSE
            RAISE;
          END IF;
      END;
    ELSE
      UPDATE departamentos SET id_pais = l_id_pais, nombre = l_nombre
       WHERE id_departamento = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        p_error(404, 'Not Found', 'El departamento no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_departamento', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Departamento creado'
                                    ELSE 'Departamento actualizado' END);
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
      p_error(400, 'Bad Request', 'Id de departamento invalido'); RETURN;
    END IF;

    DELETE FROM departamentos WHERE id_departamento = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'El departamento no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Departamento eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_DEPARTAMENTOS_ETHOS;
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
  FOR r IN (SELECT 'departamentos' AS p FROM dual
            UNION ALL SELECT 'departamentos/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'departamentos',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'departamentos/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('departamentos', 'GET', '
    PKG_DEPARTAMENTOS_ETHOS.LISTAR(p_token => l_token);');

  handler('departamentos', 'POST', '
    PKG_DEPARTAMENTOS_ETHOS.GUARDAR(
        p_token => l_token, p_id => NULL, p_id_pais => :id_pais, p_nombre => :nombre);');

  handler('departamentos/:id', 'PUT', '
    PKG_DEPARTAMENTOS_ETHOS.GUARDAR(
        p_token => l_token, p_id => :id, p_id_pais => :id_pais, p_nombre => :nombre);');

  handler('departamentos/:id', 'DELETE', '
    PKG_DEPARTAMENTOS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de departamentos publicados.');
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
  preflight('departamentos');
  preflight('departamentos/:id');
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
   WHERE object_name = 'PKG_DEPARTAMENTOS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_DEPARTAMENTOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    departamentos');
    DBMS_OUTPUT.PUT_LINE('       POST   departamentos');
    DBMS_OUTPUT.PUT_LINE('       PUT    departamentos/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE departamentos/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_DEPARTAMENTOS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_DEPARTAMENTOS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_DEPARTAMENTOS_ETHOS no se creo.');
END;
/
