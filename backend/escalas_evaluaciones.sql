--------------------------------------------------------------------------------
-- ESCALAS_EVALUACIONES  —  la escala de calificacion de las evaluaciones
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 85 de APEX (Escalas de Evaluaciones, un IG
-- sobre ESCALAS_EVALUACIONES) y a su modal 86 (Crear Escala). La 86 NO es una
-- pagina en el sitio: es el dialogo de la pantalla /escalas-evaluacion, con
-- los permisos de la 85.
--
-- QUE ES LA TABLA (ver tambien lib/evaluaciones.ts, "LA ESTRELLA Y LA
-- CALIFICACION")
--
--   Una fila por CANTIDAD DE ITEMS MARCADOS en una evaluacion: ESCALA 0..32
--   (hoy), con la CALIFICACION y la DESCRIPCION que le tocan. En la practica
--   son TRAMOS: 0..15 'Deficiente', 16..20 'Aceptable', ... cada fila del
--   tramo repite el mismo texto.
--
--   ID_ESCALA     PK
--   ESCALA        NUMBER, UNIQUE: EVALUACIONES_FACILITADORES.ESCALA tiene FK
--                 aca (EVAL_FAC_FK_ESCALA), no a la PK. Por esa FK, una ESCALA
--                 que alguna evaluacion usa no se borra ni cambia de numero.
--   CALIFICACION  VARCHAR2(100)
--   DESCRIPCION   VARCHAR2(500)
--   ID_AUDITORIA  lo pone el trigger de auditoria (ver auditoria.sql): aca no
--                 se toca.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     escalas-evaluacion          todas, por ESCALA, con cuantas
--                                       evaluaciones usan cada una
--   POST    escalas-evaluacion          {escala, calificacion, descripcion}
--                                       -> {id_escala}   (una fila, como APEX)
--   PUT     escalas-evaluacion/:id      lo mismo
--   DELETE  escalas-evaluacion/:id      solo si ninguna evaluacion la usa
--   PUT     escalas-evaluacion/tramos   {datos: '[{hasta, calificacion,
--                                       descripcion}, ...]'} -> reescribe la
--                                       escala entera por tramos (ver abajo)
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- TRAMOS
--------------------------------------------------------------------------------
--
-- La pantalla edita la escala por tramos: cada uno con su tope ("hasta"), su
-- calificacion y su descripcion. El primero empieza en 0 y cada uno sigue al
-- anterior; el tope del ultimo es la ESCALA mas alta. Al guardar, en UNA
-- transaccion:
--
--   - cada ESCALA de 0 al tope queda con la calificacion y la descripcion de
--     su tramo (se actualiza la fila, o se crea si faltaba);
--   - las ESCALA por encima del tope se borran, salvo que alguna evaluacion
--     las use: entonces no se toca nada y se responde 409.
--
-- Asi los textos de un tramo no pueden quedar distintos fila por fila (paso el
-- 08/10/2026: la tabla se recargo y la app siguio con los tramos viejos).
--
-- ORDS solo bindea campos escalares del JSON: los tramos viajan como un JSON
-- en texto en "datos", como la ficha de facilitadores.sql.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /escalas-evaluacion (la 85)
--   PUT     PUEDE_ACTUALIZAR (una fila y los tramos)
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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'ESCALAS_EVALUACIONES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ESCALAS_EVALUACIONES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ESCALAS_EVALUACIONES encontrada.');
    FOR c IN (SELECT c.column_name, c.data_type, c.data_length, c.nullable,
                     NVL2(i.column_name, ' identity', NULL) AS ident
                FROM user_tab_columns c
                LEFT JOIN user_tab_identity_cols i
                  ON i.table_name = c.table_name AND i.column_name = c.column_name
               WHERE c.table_name = 'ESCALAS_EVALUACIONES' ORDER BY c.column_id) LOOP
      DBMS_OUTPUT.PUT_LINE('       ' || RPAD(c.column_name, 16) || c.data_type
                           || '(' || c.data_length || ')'
                           || CASE c.nullable WHEN 'N' THEN ' NOT NULL' END || c.ident);
    END LOOP;
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'ESCALAS_EVALUACIONES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    SELECT COUNT(*) INTO l_n FROM escalas_evaluaciones;
    DBMS_OUTPUT.PUT_LINE('       ' || l_n || ' fila(s).');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_ESCALAS_EVAL_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- Una fila. p_id NULL = alta.
  PROCEDURE guardar(
    p_token        IN VARCHAR2,
    p_id           IN VARCHAR2,
    p_escala       IN VARCHAR2,
    p_calificacion IN VARCHAR2,
    p_descripcion  IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- La escala entera por tramos (ver TRAMOS en el encabezado).
  PROCEDURE guardar_tramos(p_token IN VARCHAR2, p_datos IN CLOB);

END PKG_ESCALAS_EVAL_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_ESCALAS_EVAL_ETHOS AS

  c_ruta      CONSTANT VARCHAR2(30) := '/escalas-evaluacion';
  c_largo_cal CONSTANT PLS_INTEGER  := 100;
  c_largo_des CONSTANT PLS_INTEGER  := 500;
  -- Un tope razonable: la escala es "items marcados", no un rango libre.
  c_maximo    CONSTANT PLS_INTEGER  := 999;

  TYPE t_cuentas IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;

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
        p_error(409, 'Conflict', 'Esa escala ya esta cargada');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede: hay evaluaciones que usan esa escala');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'La calificacion pasa de ' || c_largo_cal
                || ' caracteres o la descripcion de ' || c_largo_des);
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de ESCALAS_EVALUACIONES asigna :NEW en un DELETE '
                || '(ORA-04084). Hay que corregirlo, como SUCURSALES_JNTRG en sucursales.sql.');
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

  -- Entero de 0 a c_maximo, o NULL (la escala empieza en 0).
  FUNCTION f_escala(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n BETWEEN 0 AND c_maximo AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_escala;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' la accion en la
  -- pagina de /escalas-evaluacion. FALSE = ya respondio el error.
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
          || ' la escala de evaluaciones');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  -- Cuantas filas de EVALUACIONES_FACILITADORES usan cada ESCALA (la FK es por
  -- el valor, no por el id). Sin la tabla, ninguna.
  PROCEDURE cargar_usos(p_usos OUT t_cuentas) IS
    TYPE t_nums IS TABLE OF NUMBER;
    l_esc  t_nums;
    l_cnts t_nums;
  BEGIN
    EXECUTE IMMEDIATE
      'SELECT escala, COUNT(*) FROM evaluaciones_facilitadores'
      || ' WHERE escala IS NOT NULL GROUP BY escala'
      BULK COLLECT INTO l_esc, l_cnts;
    FOR i IN 1 .. l_esc.COUNT LOOP
      p_usos(l_esc(i)) := l_cnts(i);
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END cargar_usos;

  FUNCTION usos_de(p_usos IN t_cuentas, p_escala IN NUMBER) RETURN PLS_INTEGER IS
  BEGIN
    RETURN CASE WHEN p_escala IS NOT NULL AND p_usos.EXISTS(p_escala) THEN p_usos(p_escala) ELSE 0 END;
  END usos_de;

  -- Alta de una fila con el id de la tabla, o el mayor mas 1 si no es identity.
  PROCEDURE insertar(p_escala IN NUMBER, p_cal IN VARCHAR2, p_des IN VARCHAR2, p_id OUT NUMBER) IS
  BEGIN
    INSERT INTO escalas_evaluaciones (escala, calificacion, descripcion)
    VALUES (p_escala, p_cal, p_des)
    RETURNING id_escala INTO p_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE = -1400 AND INSTR(SQLERRM, '"ID_ESCALA"') > 0 THEN
        LOCK TABLE escalas_evaluaciones IN EXCLUSIVE MODE;
        SELECT NVL(MAX(id_escala), 0) + 1 INTO p_id FROM escalas_evaluaciones;
        INSERT INTO escalas_evaluaciones (id_escala, escala, calificacion, descripcion)
        VALUES (p_id, p_escala, p_cal, p_des);
      ELSE
        RAISE;
      END IF;
  END insertar;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_usos t_cuentas;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_usos(l_usos);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo_calificacion', c_largo_cal);
    APEX_JSON.WRITE('largo_descripcion', c_largo_des);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_escala, escala, calificacion, descripcion
                FROM escalas_evaluaciones
               ORDER BY escala NULLS LAST, id_escala) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_escala',    r.id_escala);
      APEX_JSON.WRITE('escala',       r.escala);
      APEX_JSON.WRITE('calificacion', r.calificacion);
      APEX_JSON.WRITE('descripcion',  r.descripcion);
      APEX_JSON.WRITE('usos',         usos_de(l_usos, r.escala));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* UNA FILA                                                               */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(
    p_token        IN VARCHAR2,
    p_id           IN VARCHAR2,
    p_escala       IN VARCHAR2,
    p_calificacion IN VARCHAR2,
    p_descripcion  IN VARCHAR2)
  IS
    -- 32767: ver materias.sql. Los topes reales se validan abajo con mensaje.
    l_cal    VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_calificacion, '\s+', ' '));
    l_des    VARCHAR2(32767) := TRIM(p_descripcion);
    l_id     NUMBER := f_numero(p_id);
    l_escala NUMBER := f_escala(p_escala);
    l_antes  NUMBER;
    l_usos   t_cuentas;
    l_n      PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de escala invalido'); RETURN;
    END IF;
    IF l_escala IS NULL THEN
      p_error(400, 'Bad Request', 'La escala tiene que ser un numero entero de 0 a ' || c_maximo);
      RETURN;
    END IF;
    IF l_cal IS NULL THEN
      p_error(400, 'Bad Request', 'La calificacion es obligatoria'); RETURN;
    END IF;
    IF LENGTH(l_cal) > c_largo_cal OR LENGTH(l_des) > c_largo_des THEN
      p_error(400, 'Bad Request', 'La calificacion pasa de ' || c_largo_cal
              || ' caracteres o la descripcion de ' || c_largo_des);
      RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM escalas_evaluaciones
     WHERE escala = l_escala AND (l_id IS NULL OR id_escala <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'La escala ' || l_escala || ' ya esta cargada'); RETURN;
    END IF;

    IF l_id IS NOT NULL THEN
      BEGIN
        SELECT escala INTO l_antes FROM escalas_evaluaciones WHERE id_escala = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'La escala no existe'); RETURN;
      END;
      -- La FK es por el valor: una escala usada no cambia de numero.
      IF NVL(l_antes, -1) <> l_escala THEN
        cargar_usos(l_usos);
        IF usos_de(l_usos, l_antes) > 0 THEN
          p_error(409, 'Conflict', 'La escala ' || l_antes || ' la usan '
                  || usos_de(l_usos, l_antes) || ' evaluacion(es): no se puede cambiar el numero');
          RETURN;
        END IF;
      END IF;
    END IF;

    IF l_id IS NULL THEN
      insertar(l_escala, l_cal, l_des, l_id);
    ELSE
      UPDATE escalas_evaluaciones
         SET escala = l_escala, calificacion = l_cal, descripcion = l_des
       WHERE id_escala = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_escala', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Escala creada' ELSE 'Escala actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id     NUMBER := f_numero(p_id);
    l_escala NUMBER;
    l_usos   t_cuentas;
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de escala invalido'); RETURN;
    END IF;
    BEGIN
      SELECT escala INTO l_escala FROM escalas_evaluaciones WHERE id_escala = l_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La escala no existe'); RETURN;
    END;
    cargar_usos(l_usos);
    IF usos_de(l_usos, l_escala) > 0 THEN
      p_error(409, 'Conflict', 'No se puede eliminar: la usan '
              || usos_de(l_usos, l_escala) || ' evaluacion(es)');
      RETURN;
    END IF;

    DELETE FROM escalas_evaluaciones WHERE id_escala = l_id;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Escala eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* TRAMOS                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar_tramos(p_token IN VARCHAR2, p_datos IN CLOB) IS
    TYPE t_tramo IS RECORD (hasta NUMBER, cal VARCHAR2(32767), des VARCHAR2(32767));
    TYPE t_tramos IS TABLE OF t_tramo INDEX BY PLS_INTEGER;
    l_tramos t_tramos;
    l_n      PLS_INTEGER;
    l_tope   NUMBER;
    l_desde  NUMBER := 0;
    l_id     NUMBER;
    l_usos   t_cuentas;
    l_cuenta PLS_INTEGER := 0;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    BEGIN
      APEX_JSON.PARSE(p_datos);
      l_n := APEX_JSON.GET_COUNT(p_path => '.');
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'Los tramos no vinieron bien: ' || SQLERRM); RETURN;
    END;
    IF NVL(l_n, 0) = 0 THEN
      p_error(400, 'Bad Request', 'Tiene que haber al menos un tramo'); RETURN;
    END IF;

    -- Validar todo antes de tocar nada.
    FOR i IN 1 .. l_n LOOP
      l_tramos(i).hasta := f_escala(APEX_JSON.GET_VARCHAR2(p_path => '[%d].hasta', p0 => i));
      l_tramos(i).cal   := TRIM(REGEXP_REPLACE(
                             APEX_JSON.GET_VARCHAR2(p_path => '[%d].calificacion', p0 => i), '\s+', ' '));
      l_tramos(i).des   := TRIM(APEX_JSON.GET_VARCHAR2(p_path => '[%d].descripcion', p0 => i));
      IF l_tramos(i).hasta IS NULL OR l_tramos(i).hasta < l_desde THEN
        p_error(400, 'Bad Request', 'El tramo ' || i || ' tiene que terminar en '
                || l_desde || ' o mas (cada tramo sigue al anterior)');
        RETURN;
      END IF;
      IF l_tramos(i).cal IS NULL THEN
        p_error(400, 'Bad Request', 'El tramo ' || i || ' no tiene calificacion'); RETURN;
      END IF;
      IF LENGTH(l_tramos(i).cal) > c_largo_cal OR LENGTH(l_tramos(i).des) > c_largo_des THEN
        p_error(400, 'Bad Request', 'En el tramo ' || i || ' la calificacion pasa de '
                || c_largo_cal || ' caracteres o la descripcion de ' || c_largo_des);
        RETURN;
      END IF;
      l_desde := l_tramos(i).hasta + 1;
    END LOOP;
    l_tope := l_tramos(l_n).hasta;

    -- Lo que quedaria afuera no puede estar en uso.
    cargar_usos(l_usos);
    FOR r IN (SELECT escala FROM escalas_evaluaciones
               WHERE escala > l_tope OR escala < 0 ORDER BY escala) LOOP
      IF usos_de(l_usos, r.escala) > 0 THEN
        p_error(409, 'Conflict', 'La escala ' || r.escala || ' la usan '
                || usos_de(l_usos, r.escala) || ' evaluacion(es): el ultimo tramo tiene que llegar a '
                || r.escala || ' o mas');
        RETURN;
      END IF;
    END LOOP;

    -- Reescribir: cada ESCALA de 0 al tope con su tramo.
    l_desde := 0;
    FOR i IN 1 .. l_n LOOP
      FOR e IN l_desde .. l_tramos(i).hasta LOOP
        UPDATE escalas_evaluaciones
           SET calificacion = l_tramos(i).cal, descripcion = l_tramos(i).des
         WHERE escala = e;
        IF SQL%ROWCOUNT = 0 THEN
          insertar(e, l_tramos(i).cal, l_tramos(i).des, l_id);
        END IF;
        l_cuenta := l_cuenta + 1;
      END LOOP;
      l_desde := l_tramos(i).hasta + 1;
    END LOOP;
    DELETE FROM escalas_evaluaciones WHERE escala > l_tope OR escala < 0 OR escala IS NULL;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('filas', l_cuenta);
    APEX_JSON.WRITE('message', 'Escala guardada: ' || l_n || ' tramo(s), de 0 a ' || l_tope);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar_tramos;

END PKG_ESCALAS_EVAL_ETHOS;
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
  FOR r IN (SELECT 'escalas-evaluacion' AS p FROM dual
            UNION ALL SELECT 'escalas-evaluacion/tramos' FROM dual
            UNION ALL SELECT 'escalas-evaluacion/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'escalas-evaluacion',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La literal antes que :id, como en instituciones_directores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'escalas-evaluacion/tramos',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'escalas-evaluacion/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('escalas-evaluacion', 'GET', '
    PKG_ESCALAS_EVAL_ETHOS.LISTAR(p_token => l_token);');

  handler('escalas-evaluacion', 'POST', '
    PKG_ESCALAS_EVAL_ETHOS.GUARDAR(p_token => l_token, p_id => NULL, p_escala => :escala,
        p_calificacion => :calificacion, p_descripcion => :descripcion);');

  handler('escalas-evaluacion/:id', 'PUT', '
    PKG_ESCALAS_EVAL_ETHOS.GUARDAR(p_token => l_token, p_id => :id, p_escala => :escala,
        p_calificacion => :calificacion, p_descripcion => :descripcion);');

  handler('escalas-evaluacion/:id', 'DELETE', '
    PKG_ESCALAS_EVAL_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('escalas-evaluacion/tramos', 'PUT', '
    PKG_ESCALAS_EVAL_ETHOS.GUARDAR_TRAMOS(p_token => l_token, p_datos => :datos);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de escalas-evaluacion publicados.');
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
  preflight('escalas-evaluacion');
  preflight('escalas-evaluacion/tramos');
  preflight('escalas-evaluacion/:id');
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
   WHERE object_name = 'PKG_ESCALAS_EVAL_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_ESCALAS_EVAL_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    escalas-evaluacion');
    DBMS_OUTPUT.PUT_LINE('       POST   escalas-evaluacion');
    DBMS_OUTPUT.PUT_LINE('       PUT    escalas-evaluacion/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE escalas-evaluacion/:id');
    DBMS_OUTPUT.PUT_LINE('       PUT    escalas-evaluacion/tramos');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ESCALAS_EVAL_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_ESCALAS_EVAL_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ESCALAS_EVAL_ETHOS no se creo.');
END;
/
