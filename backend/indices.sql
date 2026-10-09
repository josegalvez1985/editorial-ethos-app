--------------------------------------------------------------------------------
-- INDICES  —  ABM de los indices de los manuales (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 28 de APEX (Indices, un IG de solo lectura
-- sobre INDICES_MANUALES) y a su modal 29 (Crear Indice). La 29 NO es una
-- pagina en el sitio: es el dialogo de la pantalla /indices, con los permisos
-- de la 28.
--
-- La tabla: ID_INDICE (identity), MANUAL (obligatorio, VARCHAR2(100)),
-- NRO_INDICE (obligatorio, NUMBER) y TITULO (obligatorio, hasta 500).
--
-- NO HAY TABLA DE MANUALES: MANUAL es el texto de cada fila, y el DISTINCT de
-- esa columna ES el catalogo de manuales (lo usan evaluaciones, intervenciones,
-- inventario y transferencias; ver inventarios.sql). La 29 elegia el manual
-- con el LOV MANUALES en radio de 4 columnas; aca la pantalla ofrece los que ya
-- hay y deja escribir uno nuevo. Para que un "Manual 7" no aparezca al lado de
-- un "MANUAL 7", el paquete guarda un manual nuevo con la grafia del que ya
-- existe si solo difieren en mayusculas o espacios.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     indices          todos, por manual y numero, con en que tablas se usa cada uno
--   POST    indices          {manual, nro_indice, titulo} -> {id_indice, manual}
--   PUT     indices/:id      {manual, nro_indice, titulo}
--   DELETE  indices/:id      solo si nada lo usa
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql (usa PKG_ROLES_PAGINAS_ETHOS
-- para los permisos).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- REGLAS QUE APEX NO TENIA
--------------------------------------------------------------------------------
--
-- 1. NO SE REPITE UN NUMERO DENTRO DE UN MANUAL. El "indice siguiente" de
--    evaluaciones y el "ultimo indice" que finaliza una postulacion
--    (intervenciones_crud.sql, TRG_INTERV_FINALIZA_POST) ordenan por
--    NRO_INDICE dentro del manual: con dos filas del mismo numero, cual va
--    primero queda librado al azar. Si ya hay repetidos (la verificacion de
--    abajo los lista), se pueden seguir editando mientras no se cambie el
--    manual ni el numero; solo se frena crear o mover uno a un numero ocupado.
--
-- 2. UN INDICE EN USO NO CAMBIA DE MANUAL. INTERVENCIONES.MANUAL guarda el
--    manual del indice (redundante, ver f_manual_indice en
--    intervenciones_crud.sql) y TRG_INTERV_FINALIZA_POST los compara: mover el
--    indice dejaria esas intervenciones diciendo un manual y apuntando a otro.
--    El titulo y el numero si se pueden corregir.
--
-- 3. UN INDICE EN USO NO SE BORRA (409), como los demas catalogos.
--
--------------------------------------------------------------------------------
-- EN USO
--------------------------------------------------------------------------------
--
-- Como en docentes.sql, el listado busca en USER_CONSTRAINTS toda FK de una
-- sola columna que apunte a INDICES_MANUALES (salvo las _JN) y cuenta cuantas
-- filas usan cada indice. Ademas suma INTERVENCIONES.ID_INDICE y
-- EVALUACIONES_FACILITADORES.ID_INDICE aunque no tengan FK, y el DELETE frena
-- por esos tambien.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /indices (la 28)
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'INDICES_MANUALES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla INDICES_MANUALES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla INDICES_MANUALES encontrada.');
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'INDICES_MANUALES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    -- Los manuales que hay hoy: la pantalla los ofrece como pastillas.
    FOR m IN (SELECT manual, COUNT(*) AS n, MIN(nro_indice) AS desde, MAX(nro_indice) AS hasta
                FROM indices_manuales GROUP BY manual ORDER BY manual) LOOP
      DBMS_OUTPUT.PUT_LINE('       manual ''' || m.manual || ''': ' || m.n
                           || ' indice(s), del ' || m.desde || ' al ' || m.hasta);
    END LOOP;
    -- Los numeros repetidos dentro de un manual (ver REGLAS, 1).
    FOR d IN (SELECT manual, nro_indice, COUNT(*) AS n
                FROM indices_manuales
               GROUP BY manual, nro_indice HAVING COUNT(*) > 1
               ORDER BY manual, nro_indice) LOOP
      DBMS_OUTPUT.PUT_LINE('[WARN]  ''' || d.manual || ''' tiene ' || d.n
                           || ' indices con el numero ' || d.nro_indice || '.');
    END LOOP;
    -- Manuales que solo difieren en mayusculas o espacios.
    FOR d IN (SELECT UPPER(TRIM(manual)) AS clave, COUNT(DISTINCT manual) AS n
                FROM indices_manuales
               GROUP BY UPPER(TRIM(manual)) HAVING COUNT(DISTINCT manual) > 1) LOOP
      DBMS_OUTPUT.PUT_LINE('[WARN]  Hay ' || d.n || ' grafias del manual ''' || d.clave || '''.');
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

CREATE OR REPLACE PACKAGE PKG_INDICES_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(p_token  IN VARCHAR2,
                    p_id     IN VARCHAR2,
                    p_manual IN VARCHAR2,
                    p_nro    IN VARCHAR2,
                    p_titulo IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_INDICES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INDICES_ETHOS AS

  c_ruta   CONSTANT VARCHAR2(20) := '/indices';
  -- Los largos de la tabla (los mismos que cortaban el IG y el form de APEX).
  c_manual CONSTANT PLS_INTEGER  := 100;
  c_titulo CONSTANT PLS_INTEGER  := 500;

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
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan ese indice.');
      WHEN SQLCODE = -1 THEN
        p_error(409, 'Conflict', 'Ese indice ya existe en el manual.');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
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

  -- Entero positivo, o NULL. Para el id.
  FUNCTION f_id(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_id;

  -- El numero de indice: cero o mas, con decimales si hace falta (un 3.5 para
  -- meter uno entre el 3 y el 4). Punto o coma, sin depender del NLS de la
  -- sesion de ORDS. NULL si no es un numero valido.
  FUNCTION f_nro(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(REPLACE(TRIM(p_valor), ',', '.'),
                     '999999999990D999999', 'NLS_NUMERIC_CHARACTERS=''.,''');
    RETURN CASE WHEN l_n >= 0 THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_nro;

  -- TRIM y espacios internos colapsados; NULL si queda vacio.
  FUNCTION f_limpio(p_valor IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN TRIM(REGEXP_REPLACE(p_valor, '\s+', ' '));
  END f_limpio;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' piden la accion en
  -- la pagina de /indices. FALSE = ya respondio el error.
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
          || ' indices');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  -- Las tablas que usan indices y cuantas filas por indice. Ver "EN USO".
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
                                        WHERE table_name = 'INDICES_MANUALES'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
        UNION
        -- Las que se sabe que lo guardan, tengan FK o no.
        SELECT table_name, column_name
          FROM user_tab_columns
         WHERE column_name = 'ID_INDICE'
           AND table_name IN ('INTERVENCIONES', 'EVALUACIONES_FACILITADORES')
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

  -- Cuantas filas usan el indice, sumando todas las tablas.
  FUNCTION f_usos(p_hijas IN t_hijas, p_id IN NUMBER) RETURN PLS_INTEGER IS
    l_n PLS_INTEGER := 0;
  BEGIN
    FOR i IN 1 .. p_hijas.COUNT LOOP
      IF p_hijas(i).cuentas.EXISTS(p_id) THEN
        l_n := l_n + p_hijas(i).cuentas(p_id);
      END IF;
    END LOOP;
    RETURN l_n;
  END f_usos;

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
    APEX_JSON.OPEN_ARRAY('tablas');
    FOR i IN 1 .. l_hijas.COUNT LOOP
      APEX_JSON.WRITE(l_hijas(i).tabla);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_indice, manual, nro_indice, titulo
                FROM indices_manuales
               ORDER BY UPPER(manual), nro_indice, id_indice) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_indice',  r.id_indice);
      APEX_JSON.WRITE('manual',     r.manual);
      APEX_JSON.WRITE('nro_indice', r.nro_indice);
      APEX_JSON.WRITE('titulo',     r.titulo, TRUE);
      APEX_JSON.OPEN_ARRAY('usos');
      FOR i IN 1 .. l_hijas.COUNT LOOP
        IF l_hijas(i).cuentas.EXISTS(r.id_indice) THEN
          APEX_JSON.OPEN_OBJECT;
          APEX_JSON.WRITE('tabla',    l_hijas(i).tabla);
          APEX_JSON.WRITE('cantidad', l_hijas(i).cuentas(r.id_indice));
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

  PROCEDURE guardar(p_token  IN VARCHAR2,
                    p_id     IN VARCHAR2,
                    p_manual IN VARCHAR2,
                    p_nro    IN VARCHAR2,
                    p_titulo IN VARCHAR2) IS
    -- 32767: un texto mas largo romperia en la declaracion, antes del
    -- EXCEPTION. Los topes reales se validan abajo con mensaje.
    l_manual    VARCHAR2(32767) := f_limpio(p_manual);
    l_titulo    VARCHAR2(32767) := f_limpio(p_titulo);
    l_nro       NUMBER := f_nro(p_nro);
    l_id        NUMBER := f_id(p_id);
    l_ant_man   indices_manuales.manual%TYPE;
    l_ant_nro   indices_manuales.nro_indice%TYPE;
    l_ocupado   indices_manuales.titulo%TYPE;
    l_hijas     t_hijas;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de indice invalido'); RETURN;
    END IF;
    IF l_manual IS NULL THEN
      p_error(400, 'Bad Request', 'El manual es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_manual) > c_manual THEN
      p_error(400, 'Bad Request', 'El manual no puede pasar de ' || c_manual || ' caracteres');
      RETURN;
    END IF;
    IF l_nro IS NULL THEN
      p_error(400, 'Bad Request', 'El numero de indice tiene que ser un numero, cero o mas');
      RETURN;
    END IF;
    IF l_titulo IS NULL THEN
      p_error(400, 'Bad Request', 'El titulo es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_titulo) > c_titulo THEN
      p_error(400, 'Bad Request', 'El titulo no puede pasar de ' || c_titulo || ' caracteres');
      RETURN;
    END IF;

    IF l_id IS NOT NULL THEN
      BEGIN
        SELECT manual, nro_indice INTO l_ant_man, l_ant_nro
          FROM indices_manuales WHERE id_indice = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'El indice no existe'); RETURN;
      END;
    END IF;

    -- Un manual que ya existe con otras mayusculas o espacios se guarda con
    -- la grafia de siempre: el texto ES el identificador del manual. Si es el
    -- mismo que ya tenia la fila, se queda con el suyo (aunque haya otra
    -- grafia mas usada): corregir un titulo no es cambiar de manual.
    IF UPPER(f_limpio(l_ant_man)) = UPPER(l_manual) THEN
      l_manual := l_ant_man;
    ELSE
      BEGIN
        SELECT manual INTO l_manual
          FROM (SELECT manual, COUNT(*) AS n
                  FROM indices_manuales
                 WHERE UPPER(REGEXP_REPLACE(TRIM(manual), '\s+', ' ')) = UPPER(l_manual)
                 GROUP BY manual
                 ORDER BY n DESC, manual)
         FETCH FIRST 1 ROW ONLY;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN NULL;   -- manual nuevo: queda como vino
      END;
    END IF;

    IF l_id IS NOT NULL THEN
      -- REGLAS, 2: en uso no cambia de manual.
      IF l_ant_man <> l_manual THEN
        cargar_hijas(l_hijas);
        IF f_usos(l_hijas, l_id) > 0 THEN
          p_error(409, 'Conflict', 'No se puede cambiar el manual: el indice ya se usa en '
                  || f_usos(l_hijas, l_id) || ' registro(s), que guardan el manual ''' || l_ant_man || '''.');
          RETURN;
        END IF;
      END IF;
    END IF;

    -- REGLAS, 1: el numero no se repite dentro del manual. Solo si es alta o
    -- si cambia el manual o el numero (los repetidos viejos se pueden editar).
    IF l_id IS NULL OR l_ant_man <> l_manual OR l_ant_nro <> l_nro THEN
      BEGIN
        SELECT titulo INTO l_ocupado
          FROM indices_manuales
         WHERE manual = l_manual AND nro_indice = l_nro
           AND (l_id IS NULL OR id_indice <> l_id)
         FETCH FIRST 1 ROW ONLY;
        p_error(409, 'Conflict', 'El ' || l_manual || ' ya tiene el indice ' || l_nro
                || ': "' || l_ocupado || '".');
        RETURN;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN NULL;
      END;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO indices_manuales (manual, nro_indice, titulo)
      VALUES (l_manual, l_nro, l_titulo)
      RETURNING id_indice INTO l_id;
    ELSE
      UPDATE indices_manuales
         SET manual     = l_manual,
             nro_indice = l_nro,
             titulo     = l_titulo
       WHERE id_indice = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_indice', l_id);
    -- Con la grafia con que quedo, que puede no ser la que se mando.
    APEX_JSON.WRITE('manual', l_manual);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Indice creado' ELSE 'Indice actualizado' END);
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
    l_id    NUMBER := f_id(p_id);
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de indice invalido'); RETURN;
    END IF;
    -- INTERVENCIONES y EVALUACIONES_FACILITADORES pueden no tener FK: se mira a mano.
    cargar_hijas(l_hijas);
    FOR i IN 1 .. l_hijas.COUNT LOOP
      IF l_hijas(i).cuentas.EXISTS(l_id) THEN
        p_error(409, 'Conflict', 'No se puede eliminar: lo usan '
                || l_hijas(i).cuentas(l_id) || ' fila(s) de ' || l_hijas(i).tabla || '.');
        RETURN;
      END IF;
    END LOOP;

    DELETE FROM indices_manuales WHERE id_indice = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'El indice no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Indice eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_INDICES_ETHOS;
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
  FOR r IN (SELECT 'indices' AS p FROM dual
            UNION ALL SELECT 'indices/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'indices',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'indices/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('indices', 'GET', '
    PKG_INDICES_ETHOS.LISTAR(p_token => l_token);');

  handler('indices', 'POST', '
    PKG_INDICES_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,
        p_manual => :manual, p_nro => :nro_indice, p_titulo => :titulo);');

  handler('indices/:id', 'PUT', '
    PKG_INDICES_ETHOS.GUARDAR(p_token => l_token, p_id => :id,
        p_manual => :manual, p_nro => :nro_indice, p_titulo => :titulo);');

  handler('indices/:id', 'DELETE', '
    PKG_INDICES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de indices publicados.');
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
  preflight('indices');
  preflight('indices/:id');
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
   WHERE object_name = 'PKG_INDICES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INDICES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    indices');
    DBMS_OUTPUT.PUT_LINE('       POST   indices');
    DBMS_OUTPUT.PUT_LINE('       PUT    indices/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE indices/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INDICES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_INDICES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INDICES_ETHOS no se creo.');
END;
/
