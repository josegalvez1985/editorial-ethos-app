--------------------------------------------------------------------------------
-- AUDITORIA  —  consulta de las bitacoras _JN
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  auditoria/tablas                         las tablas auditadas, sus
--                                                 triggers, columnas y conteos
--   GET  auditoria/movimientos ?tabla=&operacion=&usuario=&desde=&hasta=
--                              &id_auditoria=&limite=&pagina=&buscar=
--   GET  auditoria/historial   ?tabla=&id_auditoria=
--
-- Y ADEMAS versiona pr_crear_trigger_auditoria —el procedimiento que arma las
-- tablas _JN y sus triggers— con dos correcciones (seccion 2), y regenera los
-- triggers que ese procedimiento ya habia creado (seccion 3).
--
-- CORRER DESPUES de auth.sql (modulo ORDS 'ethos' y PKG_AUTH_ETHOS). No depende
-- de ningun otro paquete.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- QUE ES UNA "TABLA AUDITADA"
--------------------------------------------------------------------------------
--
-- Una tabla X para la que existe X_JN con las columnas JN_OPERATION y
-- JN_DATETIME. NO se decide por el nombre del trigger, porque hoy conviven dos
-- convenciones:
--
--   AUDITORIA_<TABLA>                  el que genera pr_crear_trigger_auditoria
--   EVALUACIONES_FACILITADORES_JNTRG   escrito a mano (evaluaciones_facilitadores.sql)
--
-- El trigger que escribe la bitacora se busca por dependencia: es el trigger de
-- X que referencia a X_JN (USER_DEPENDENCIES), o el que se llama como alguna de
-- las dos convenciones. Si hay DOS, la pantalla lo marca: cada cambio se
-- estaria anotando dos veces.
--
-- Las X_JN cuya tabla X ya no existe tambien se listan (existe_tabla = false):
-- su historial sigue siendo consultable.
--
--------------------------------------------------------------------------------
-- LAS DOS CONVENCIONES NO GUARDAN LO MISMO EN UN UPDATE   <-- OJO
--------------------------------------------------------------------------------
--
--                            INS      UPD                    DEL
--   AUDITORIA_<TABLA>        :NEW     :OLD  (el ANTES)       :OLD
--   *_JNTRG (evaluaciones)   :NEW     :NEW  (el DESPUES)     :OLD
--
-- Para mostrar QUE cambio en un UPD hay que saber cual de las dos es. Con :OLD
-- el valor nuevo esta en la fila SIGUIENTE de la bitacora (o en la tabla, si
-- fue el ultimo cambio); con :NEW el valor viejo esta en la fila ANTERIOR.
--
-- `guarda_en_update` lo deduce leyendo la fuente del trigger (USER_SOURCE): toma
-- la lista VALUES del INSERT que escribe 'UPD' y cuenta :OLD contra :NEW. Si no
-- puede decidirlo devuelve NULL y el front lo avisa en vez de adivinar.
--
-- El diff lo arma el FRONT (src/lib/auditoria.ts), no este paquete: aca se
-- devuelven las filas crudas de la bitacora y la fila actual de la tabla.
--
--------------------------------------------------------------------------------
-- LAS HORAS: JN_DATETIME ES LA HORA DEL SERVIDOR, NO LA DE PARAGUAY
--------------------------------------------------------------------------------
--
-- Los triggers graban SYSDATE, que en oracleapex.com es la hora del servidor
-- (UTC). Es el mismo motivo por el que TRG_INTERVENCIONES_SET_FECHA hace
-- SYSDATE - 3h. Este paquete devuelve las horas YA CORRIDAS a Paraguay (UTC-3,
-- fijo desde octubre de 2024) y corre los filtros desde/hasta al reves.
--
-- Si algun dia las horas salen corridas, el unico lugar a tocar es c_desfase,
-- al principio del body.
--
--------------------------------------------------------------------------------
-- SEGURIDAD: SQL DINAMICO, PERO SOLO SOBRE NOMBRES DEL DICCIONARIO
--------------------------------------------------------------------------------
--
-- Las consultas se arman en tiempo de ejecucion porque cada _JN tiene sus
-- propias columnas. El nombre de tabla que manda el front NUNCA se concatena
-- sin validar: f_tabla lo busca en USER_TABLES, y todo nombre que entra en un
-- SQL pasa por DBMS_ASSERT.ENQUOTE_NAME. Una tabla sin bitacora responde 404.
--
-- Los valores de los filtros van siempre como binds.
--
-- ACCESO: cualquier usuario con sesion (decidido el 24/09/2026). La bitacora
-- tiene datos de TODAS las tablas auditadas, textos de evaluaciones incluidos.
-- Si hay que restringirlo, el lugar es f_usuario, en el body.
--
--------------------------------------------------------------------------------

SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_objects
   WHERE object_name = 'PKG_AUTH_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Falta PKG_AUTH_ETHOS. Corre backend/auth.sql primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUTH_ETHOS encontrado.');
  END IF;

  SELECT COUNT(*) INTO l_n FROM user_sequences WHERE sequence_name = 'SEQ_AUDITORIA';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[INFO] No existe SEQ_AUDITORIA: la crea el procedimiento');
    DBMS_OUTPUT.PUT_LINE('       la primera vez que se audite una tabla.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   SEQ_AUDITORIA encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) pr_crear_trigger_auditoria ==========================================
--
-- EL PROCEDIMIENTO QUE YA ESTABA EN LA BASE, versionado aca por primera vez.
-- Crea (o completa) la tabla <TABLA>_JN y genera el trigger AUDITORIA_<TABLA>.
-- Es el mismo de siempre, con DOS cambios en el trigger que genera:
--
--   1. JN_ORACLE_USER registra QUIEN USO LA APP, no el esquema.
--
--      Antes era NVL(V('APP_USER'), USER). Desde ORDS no hay sesion APEX,
--      V('APP_USER') es NULL, y todo lo que se editaba desde la app nueva quedaba
--      a nombre del esquema. Ahora cae a CLIENT_IDENTIFIER, que
--      PKG_AUTH_ETHOS.VALIDAR_TOKEN deja con el usuario del token en cada
--      request (ver auth.sql).
--
--      El ORDEN del NVL importa: dentro de APEX sigue mandando APP_USER, porque
--      APEX pone en CLIENT_IDENTIFIER 'USUARIO:SESION' y no el usuario solo.
--
--      Va con SUBSTR(..., 1, 30) porque JN_ORACLE_USER es VARCHAR2(30). Un
--      usuario mas largo haria fallar el INSERT de la bitacora, y con el el
--      INSERT/UPDATE/DELETE del negocio que lo disparo.
--
--   2. :NEW.ID_AUDITORIA se asigna solo en UPDATING, nunca en DELETING.
--
--      Es el mismo arreglo que ya tiene EVALUACIONES_FACILITADORES_JNTRG: en un
--      DELETE no hay fila nueva que escribir (ORA-04084), y esa rama se activaba
--      con las filas que tienen ID_AUDITORIA en NULL — las que ya estaban
--      cargadas antes de empezar a auditar la tabla.
--
-- LO QUE NO CAMBIA, A PROPOSITO: en un UPD sigue guardando :OLD (el valor
-- ANTERIOR). Pasarlo a :NEW dejaria la bitacora con filas de las dos formas y ya
-- no se podria reconstruir el historial. Ver el encabezado.
--
-- NO CORRERLO SOBRE EVALUACIONES_FACILITADORES: esa tabla ya tiene su propio
-- trigger (_JNTRG), y este le crearia un SEGUNDO que escribe la misma bitacora.
--------------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE pr_crear_trigger_auditoria(p_table_name IN VARCHAR2) IS
  v_trigger_name VARCHAR2(100);
  v_sql          CLOB;
  v_columns      VARCHAR2(4000);
  v_audit_table  VARCHAR2(100);
  v_exists       NUMBER;
  v_seq_exists   NUMBER;
  -- Quien hizo el cambio. Ver el cambio 1 en el encabezado de la seccion.
  v_usuario      CONSTANT VARCHAR2(200) :=
    'SUBSTR(NVL(V(''APP_USER''), NVL(SYS_CONTEXT(''USERENV'', ''CLIENT_IDENTIFIER''), USER)), 1, 30)';
BEGIN
  v_trigger_name := 'AUDITORIA_' || p_table_name;
  v_audit_table  := p_table_name || '_JN';

  SELECT COUNT(*)
  INTO v_exists
  FROM user_tables
  WHERE table_name = UPPER(v_audit_table);

  SELECT LISTAGG(
            CASE
              WHEN INSTR(column_name, '"') > 0 THEN column_name
              WHEN SUBSTR(column_name, 1, 1) IN ('0','1','2','3','4','5','6','7','8','9') THEN
                '"' || column_name || '"'
              ELSE
                column_name
            END, ','
          ) WITHIN GROUP (ORDER BY column_id)
  INTO v_columns
  FROM user_tab_columns
  WHERE table_name = UPPER(p_table_name)
    AND column_name != 'ID_AUDITORIA';

  IF v_exists = 0 THEN
    v_sql := 'CREATE TABLE ' || v_audit_table || ' (' || CHR(10) ||
             '  ID_AUDITORIA NUMBER,' || CHR(10) ||
             '  JN_OPERATION CHAR(3) NOT NULL,' || CHR(10) ||
             '  JN_ORACLE_USER VARCHAR2(30) NOT NULL,' || CHR(10) ||
             '  JN_DATETIME DATE NOT NULL,' || CHR(10) ||
             '  JN_NOTES VARCHAR2(240),' || CHR(10) ||
             '  JN_APPLN VARCHAR2(35),' || CHR(10) ||
             '  JN_SESSION NUMBER(38),' || CHR(10);

    FOR r IN (
      SELECT column_name, data_type, data_length, data_precision, data_scale
      FROM user_tab_columns
      WHERE table_name = UPPER(p_table_name)
      AND column_name != 'ID_AUDITORIA'
      ORDER BY column_id
    ) LOOP
      v_sql := v_sql || '  ' || r.column_name || ' ' || r.data_type;

      CASE r.data_type
        WHEN 'VARCHAR2' THEN
          v_sql := v_sql || '(' || r.data_length || ')';
        WHEN 'CHAR' THEN
          v_sql := v_sql || '(' || r.data_length || ')';
        WHEN 'NUMBER' THEN
          IF r.data_precision IS NOT NULL AND r.data_scale IS NOT NULL THEN
            v_sql := v_sql || '(' || r.data_precision || ',' || r.data_scale || ')';
          ELSIF r.data_precision IS NOT NULL THEN
            v_sql := v_sql || '(' || r.data_precision || ')';
          END IF;
        ELSE
          NULL;
      END CASE;

      v_sql := v_sql || ',' || CHR(10);
    END LOOP;

    v_sql := RTRIM(v_sql, ',' || CHR(10)) || CHR(10) || ')';
    EXECUTE IMMEDIATE v_sql;

    SELECT COUNT(*) INTO v_exists
    FROM user_tab_columns
    WHERE table_name = UPPER(p_table_name)
    AND column_name = 'ID_AUDITORIA';

    IF v_exists = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || p_table_name || ' ADD (ID_AUDITORIA NUMBER)';
    END IF;

  ELSE
    FOR r IN (
      SELECT t.column_name, t.data_type, t.data_length, t.data_precision, t.data_scale
      FROM user_tab_columns t
      WHERE t.table_name = UPPER(p_table_name)
      AND t.column_name NOT IN (
        SELECT j.column_name FROM user_tab_columns j WHERE j.table_name = UPPER(v_audit_table)
      )
      AND t.column_name != 'ID_AUDITORIA'
      ORDER BY t.column_id
    ) LOOP
      v_sql := 'ALTER TABLE ' || v_audit_table || ' ADD (' || r.column_name || ' ' || r.data_type;

      CASE r.data_type
        WHEN 'VARCHAR2' THEN
          v_sql := v_sql || '(' || r.data_length || ')';
        WHEN 'CHAR' THEN
          v_sql := v_sql || '(' || r.data_length || ')';
        WHEN 'NUMBER' THEN
          IF r.data_precision IS NOT NULL AND r.data_scale IS NOT NULL THEN
            v_sql := v_sql || '(' || r.data_precision || ',' || r.data_scale || ')';
          ELSIF r.data_precision IS NOT NULL THEN
            v_sql := v_sql || '(' || r.data_precision || ')';
          END IF;
        ELSE
          NULL;
      END CASE;

      v_sql := v_sql || ')';
      EXECUTE IMMEDIATE v_sql;
    END LOOP;

    SELECT COUNT(*) INTO v_exists
    FROM user_tab_columns
    WHERE table_name = UPPER(p_table_name)
    AND column_name = 'ID_AUDITORIA';

    IF v_exists = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || p_table_name || ' ADD (ID_AUDITORIA NUMBER)';
    END IF;

    SELECT COUNT(*) INTO v_exists
    FROM user_tab_columns
    WHERE table_name = UPPER(v_audit_table)
    AND column_name = 'ID_AUDITORIA';

    IF v_exists = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || v_audit_table || ' ADD (ID_AUDITORIA NUMBER)';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_seq_exists
  FROM user_sequences
  WHERE sequence_name = 'SEQ_AUDITORIA';

  IF v_seq_exists = 0 THEN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_AUDITORIA START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE';
  END IF;

  v_sql := 'CREATE OR REPLACE TRIGGER ' || v_trigger_name || CHR(10) ||
           'BEFORE INSERT OR UPDATE OR DELETE ON ' || p_table_name || CHR(10) ||
           'FOR EACH ROW ' || CHR(10) ||
           'DECLARE' || CHR(10) ||
           '  v_audit_id NUMBER;' || CHR(10) ||
           'BEGIN ' || CHR(10) ||

           '  IF INSERTING THEN ' || CHR(10) ||
           '    IF :NEW.ID_AUDITORIA IS NULL THEN ' || CHR(10) ||
           '      SELECT SEQ_AUDITORIA.NEXTVAL INTO :NEW.ID_AUDITORIA FROM dual;' || CHR(10) ||
           '    END IF;' || CHR(10) ||
           '    v_audit_id := :NEW.ID_AUDITORIA; ' || CHR(10) ||
           '  ELSIF UPDATING THEN ' || CHR(10) ||
           '    IF :OLD.ID_AUDITORIA IS NULL THEN ' || CHR(10) ||
           '      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual; ' || CHR(10) ||
           '      :NEW.ID_AUDITORIA := v_audit_id; ' || CHR(10) ||
           '    ELSE ' || CHR(10) ||
           '      v_audit_id := :OLD.ID_AUDITORIA; ' || CHR(10) ||
           '    END IF; ' || CHR(10) ||
           -- Cambio 2: en DELETE no se toca :NEW. Ver el encabezado de la seccion.
           '  ELSIF DELETING THEN ' || CHR(10) ||
           '    IF :OLD.ID_AUDITORIA IS NULL THEN ' || CHR(10) ||
           '      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual; ' || CHR(10) ||
           '    ELSE ' || CHR(10) ||
           '      v_audit_id := :OLD.ID_AUDITORIA; ' || CHR(10) ||
           '    END IF; ' || CHR(10) ||
           '  END IF;' || CHR(10) ||

           '  IF INSERTING THEN ' || CHR(10) ||
           '    INSERT INTO ' || v_audit_table || ' (' || CHR(10) ||
           '      ID_AUDITORIA,' || CHR(10) ||
           '      ' || REPLACE(v_columns, ',', ',' || CHR(10) || '      ') || ',' || CHR(10) ||
           '      JN_OPERATION,' || CHR(10) ||
           '      JN_ORACLE_USER,' || CHR(10) ||
           '      JN_DATETIME,' || CHR(10) ||
           '      JN_NOTES,' || CHR(10) ||
           '      JN_APPLN,' || CHR(10) ||
           '      JN_SESSION' || CHR(10) ||
           '    ) VALUES (' || CHR(10) ||
           '      v_audit_id,' || CHR(10) ||
           '      ' || REPLACE(':NEW.' || v_columns, ',', ',' || CHR(10) || '      :NEW.') || ',' || CHR(10) ||
           '      ''INS'',' || CHR(10) ||
           '      ' || v_usuario || ',' || CHR(10) ||
           '      SYSDATE,' || CHR(10) ||
           '      NULL,' || CHR(10) ||
           '      ''AUDITORIA_' || UPPER(p_table_name) || ''',' || CHR(10) ||
           '      SYS_CONTEXT(''USERENV'', ''SESSIONID'')' || CHR(10) ||
           '    );' || CHR(10) ||

           '  ELSIF UPDATING THEN ' || CHR(10) ||
           '    INSERT INTO ' || v_audit_table || ' (' || CHR(10) ||
           '      ID_AUDITORIA,' || CHR(10) ||
           '      ' || REPLACE(v_columns, ',', ',' || CHR(10) || '      ') || ',' || CHR(10) ||
           '      JN_OPERATION,' || CHR(10) ||
           '      JN_ORACLE_USER,' || CHR(10) ||
           '      JN_DATETIME,' || CHR(10) ||
           '      JN_NOTES,' || CHR(10) ||
           '      JN_APPLN,' || CHR(10) ||
           '      JN_SESSION' || CHR(10) ||
           '    ) VALUES (' || CHR(10) ||
           '      v_audit_id,' || CHR(10) ||
           '      ' || REPLACE(':OLD.' || v_columns, ',', ',' || CHR(10) || '      :OLD.') || ',' || CHR(10) ||
           '      ''UPD'',' || CHR(10) ||
           '      ' || v_usuario || ',' || CHR(10) ||
           '      SYSDATE,' || CHR(10) ||
           '      NULL,' || CHR(10) ||
           '      ''AUDITORIA_' || UPPER(p_table_name) || ''',' || CHR(10) ||
           '      SYS_CONTEXT(''USERENV'', ''SESSIONID'')' || CHR(10) ||
           '    );' || CHR(10) ||

           '  ELSIF DELETING THEN ' || CHR(10) ||
           '    INSERT INTO ' || v_audit_table || ' (' || CHR(10) ||
           '      ID_AUDITORIA,' || CHR(10) ||
           '      ' || REPLACE(v_columns, ',', ',' || CHR(10) || '      ') || ',' || CHR(10) ||
           '      JN_OPERATION,' || CHR(10) ||
           '      JN_ORACLE_USER,' || CHR(10) ||
           '      JN_DATETIME,' || CHR(10) ||
           '      JN_NOTES,' || CHR(10) ||
           '      JN_APPLN,' || CHR(10) ||
           '      JN_SESSION' || CHR(10) ||
           '    ) VALUES (' || CHR(10) ||
           '      v_audit_id,' || CHR(10) ||
           '      ' || REPLACE(':OLD.' || v_columns, ',', ',' || CHR(10) || '      :OLD.') || ',' || CHR(10) ||
           '      ''DEL'',' || CHR(10) ||
           '      ' || v_usuario || ',' || CHR(10) ||
           '      SYSDATE,' || CHR(10) ||
           '      NULL,' || CHR(10) ||
           '      ''AUDITORIA_' || UPPER(p_table_name) || ''',' || CHR(10) ||
           '      SYS_CONTEXT(''USERENV'', ''SESSIONID'')' || CHR(10) ||
           '    );' || CHR(10) ||
           '  END IF;' || CHR(10) ||
           'END;';

  EXECUTE IMMEDIATE v_sql;

  EXECUTE IMMEDIATE 'ALTER TRIGGER ' || v_trigger_name || ' ENABLE';
END;
/

--------------------------------------------------------------------------------
-- === 3) REGENERAR LOS TRIGGERS QUE YA HABIA CREADO EL PROCEDIMIENTO ==========
--
-- Sin esto la correccion del usuario no llega a ninguna tabla: el trigger es
-- CODIGO GENERADO, y el que esta hoy en la base se genero con la version vieja.
--
-- Se regenera solo el que se llama AUDITORIA_<TABLA>, que es la firma de este
-- procedimiento. EVALUACIONES_FACILITADORES_JNTRG no: vive en su propio script
-- (evaluaciones_facilitadores.sql, seccion 2).
--
-- Efecto secundario, bienvenido: si a una tabla se le agregaron columnas
-- despues de auditarla, el procedimiento las suma a la _JN y el trigger nuevo
-- las incluye. Es lo que la pantalla marca como "sin auditar".
--
-- Cada tabla va en su propio bloque: si una falla (por ejemplo, el DDL no
-- consigue el lock porque alguien esta editando esa tabla), se informa y se
-- sigue con la siguiente. Volver a correr el script la reintenta.
--
-- Los nombres se juntan ANTES de empezar: cada llamada hace DDL, y recorrer
-- USER_TRIGGERS mientras se recrean sus filas es buscarse un resultado raro.
--------------------------------------------------------------------------------

DECLARE
  TYPE t_nombres IS TABLE OF VARCHAR2(128);
  l_tablas t_nombres;
  l_ok     PLS_INTEGER := 0;
BEGIN
  SELECT tr.table_name
    BULK COLLECT INTO l_tablas
    FROM user_triggers tr
   WHERE tr.trigger_name     = 'AUDITORIA_' || tr.table_name
     AND tr.base_object_type = 'TABLE'
   ORDER BY tr.table_name;

  IF l_tablas.COUNT = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[SKIP] No hay triggers AUDITORIA_* para regenerar.');
    RETURN;
  END IF;

  FOR i IN 1 .. l_tablas.COUNT LOOP
    BEGIN
      pr_crear_trigger_auditoria(l_tablas(i));
      l_ok := l_ok + 1;
      DBMS_OUTPUT.PUT_LINE('[OK]   AUDITORIA_' || l_tablas(i) || ' regenerado.');
    EXCEPTION
      WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('[ERROR] ' || l_tablas(i) || ': ' || SQLERRM);
        DBMS_OUTPUT.PUT_LINE('        El trigger anterior sigue activo. Reintentar corriendo');
        DBMS_OUTPUT.PUT_LINE('        de nuevo el script o: BEGIN pr_crear_trigger_auditoria('''
                             || l_tablas(i) || '''); END;');
    END;
  END LOOP;

  DBMS_OUTPUT.PUT_LINE('       ' || l_ok || ' de ' || l_tablas.COUNT || ' triggers regenerados.');
END;
/

--------------------------------------------------------------------------------
-- === 4) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_AUDITORIA_ETHOS AS

  -- Las tablas auditadas, con sus triggers, sus columnas y sus conteos.
  PROCEDURE tablas(p_token IN VARCHAR2);

  -- La bitacora de todas las tablas (o de una), de la mas nueva a la mas vieja.
  PROCEDURE movimientos(
      p_token        IN VARCHAR2,
      p_tabla        IN VARCHAR2 DEFAULT NULL,
      p_operacion    IN VARCHAR2 DEFAULT NULL,
      p_usuario      IN VARCHAR2 DEFAULT NULL,
      p_desde        IN VARCHAR2 DEFAULT NULL,
      p_hasta        IN VARCHAR2 DEFAULT NULL,
      p_id_auditoria IN NUMBER   DEFAULT NULL,
      p_limite       IN NUMBER   DEFAULT NULL,
      p_pagina       IN NUMBER   DEFAULT NULL,
      -- Contiene, en CUALQUIER columna de datos de la bitacora.
      p_buscar       IN VARCHAR2 DEFAULT NULL);

  -- Toda la historia de UN registro: sus filas de bitacora y como esta hoy.
  PROCEDURE historial(
      p_token        IN VARCHAR2,
      p_tabla        IN VARCHAR2,
      p_id_auditoria IN NUMBER);

END PKG_AUDITORIA_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_AUDITORIA_ETHOS AS

  c_limite_defecto CONSTANT PLS_INTEGER := 50;
  c_limite_maximo  CONSTANT PLS_INTEGER := 200;

  -- Tope de filas del historial de UN registro. Un registro con mas cambios que
  -- esto es raro; si pasa, el front avisa que la lista esta cortada.
  c_max_eventos CONSTANT PLS_INTEGER := 500;

  -- Hora del servidor -> hora de Paraguay. Ver el encabezado del script.
  c_desfase   CONSTANT NUMBER       := -3 / 24;
  c_fmt_fecha CONSTANT VARCHAR2(30) := 'YYYY-MM-DD"T"HH24:MI:SS';

  -- DBMS_SQL.DESCRIBE_COLUMNS2 informa el tipo como numero: 112 es CLOB/NCLOB.
  c_tipo_clob CONSTANT PLS_INTEGER := 112;

  TYPE t_set    IS TABLE OF BOOLEAN       INDEX BY VARCHAR2(128);
  TYPE t_tipos  IS TABLE OF VARCHAR2(128) INDEX BY VARCHAR2(128);
  TYPE t_nombres IS TABLE OF VARCHAR2(128);

  -- TRUE mientras APEX_JSON esta escribiendo en un CLOB. Ver `iniciar`.
  g_en_clob BOOLEAN := FALSE;

  ------------------------------------------------------------------------------
  -- LAS TABLAS AUDITADAS: las X_JN que tienen forma de bitacora.
  ------------------------------------------------------------------------------
  CURSOR c_auditadas IS
    SELECT SUBSTR(j.table_name, 1, LENGTH(j.table_name) - 3) AS tabla,
           j.table_name                                      AS tabla_jn
      FROM user_tables j
     WHERE j.table_name LIKE '%\_JN' ESCAPE '\'
       AND NVL(j.dropped, 'NO') = 'NO'
       AND EXISTS (SELECT 1 FROM user_tab_columns c
                    WHERE c.table_name = j.table_name AND c.column_name = 'JN_OPERATION')
       AND EXISTS (SELECT 1 FROM user_tab_columns c
                    WHERE c.table_name = j.table_name AND c.column_name = 'JN_DATETIME')
     ORDER BY j.table_name;

  ------------------------------------------------------------------------------
  -- LOS TRIGGERS QUE ESCRIBEN LA BITACORA DE UNA TABLA.
  --
  -- Por dependencia (el trigger referencia a la _JN) o por nombre. El nombre
  -- cubre el caso del trigger INVALID, cuyas dependencias pueden no estar
  -- registradas: es justo el caso que mas importa mostrar.
  ------------------------------------------------------------------------------
  CURSOR c_triggers(p_tabla IN VARCHAR2, p_jn IN VARCHAR2) IS
    SELECT t.trigger_name, t.status, o.status AS estado_objeto
      FROM user_triggers t
      JOIN user_objects o
        ON o.object_name = t.trigger_name
       AND o.object_type = 'TRIGGER'
     WHERE t.table_name       = p_tabla
       AND t.base_object_type = 'TABLE'
       AND (   t.trigger_name IN ('AUDITORIA_' || p_tabla, p_tabla || '_JNTRG')
            OR EXISTS (SELECT 1 FROM user_dependencies d
                        WHERE d.name             = t.trigger_name
                          AND d.type             = 'TRIGGER'
                          AND d.referenced_owner = USER
                          AND d.referenced_name  = p_jn
                          AND d.referenced_type  = 'TABLE'))
     ORDER BY t.trigger_name;

  ------------------------------------------------------------------------------
  -- Salida.
  --
  -- LA RESPUESTA SE ARMA EN UN CLOB Y SE MANDA AL FINAL, a diferencia de los
  -- otros paquetes que escriben directo con HTP. El motivo es el SQL dinamico:
  -- puede fallar a mitad de camino (una _JN con un tipo raro), y con la
  -- respuesta ya abierta no hay forma de devolver un error legible — quedaria
  -- un JSON cortado y un 200. Armandola aparte, un error descarta el CLOB y
  -- responde un 500 limpio.
  --
  -- p_preserve => TRUE es lo que hace que, despues de FREE_OUTPUT, APEX_JSON
  -- vuelva a escribir en HTP. Sin eso la sesion de ORDS —que se reusa entre
  -- requests— podria quedar escribiendo en la nada para el proximo paquete.
  ------------------------------------------------------------------------------

  PROCEDURE abrir_json IS
  BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Cache-Control: no-store');
    HTP.P('Access-Control-Allow-Origin: *');
    OWA_UTIL.HTTP_HEADER_CLOSE;
  END abrir_json;

  -- El error va escrito a mano y no con APEX_JSON para no depender del estado
  -- de su salida, que es justo lo que puede haber quedado a medias.
  PROCEDURE p_error(p_status IN NUMBER, p_titulo IN VARCHAR2, p_detalle IN VARCHAR2) IS
  BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_titulo, FALSE);
    abrir_json;
    HTP.P('{"success":false,"message":"' || APEX_ESCAPE.JSON(p_detalle) || '"}');
  END p_error;

  PROCEDURE iniciar IS
  BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT(p_preserve => TRUE);
    g_en_clob := TRUE;
  END iniciar;

  PROCEDURE enviar IS
    l_json  CLOB;
    l_largo PLS_INTEGER;
    l_pos   PLS_INTEGER := 1;
    -- En caracteres: 8000 x 4 bytes (UTF-8) no pasa los 32767 de HTP.PRN.
    c_tramo CONSTANT PLS_INTEGER := 8000;
  BEGIN
    l_json  := APEX_JSON.GET_CLOB_OUTPUT;
    abrir_json;
    l_largo := NVL(DBMS_LOB.GETLENGTH(l_json), 0);
    WHILE l_pos <= l_largo LOOP
      HTP.PRN(DBMS_LOB.SUBSTR(l_json, c_tramo, l_pos));
      l_pos := l_pos + c_tramo;
    END LOOP;
    g_en_clob := FALSE;
    APEX_JSON.FREE_OUTPUT;
  END enviar;

  PROCEDURE descartar IS
  BEGIN
    IF g_en_clob THEN
      g_en_clob := FALSE;
      APEX_JSON.FREE_OUTPUT;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END descartar;

  -- El usuario del token, o NULL. Delega en PKG_AUTH_ETHOS, que ademas deja el
  -- usuario en CLIENT_IDENTIFIER. ACA iria una restriccion de acceso.
  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  ------------------------------------------------------------------------------
  -- Diccionario.
  ------------------------------------------------------------------------------

  -- Un nombre del diccionario, entre comillas: "ID_X", "4", "3M".
  --
  -- Con comillas SIEMPRE, aunque la mayoria no las necesite: POSTULACIONES
  -- tiene columnas que empiezan con un digito, y sin comillas no compilan.
  FUNCTION f_nombre(p_nombre IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN DBMS_ASSERT.ENQUOTE_NAME(p_nombre, FALSE);
  END f_nombre;

  FUNCTION f_existe_tabla(p_tabla IN VARCHAR2) RETURN BOOLEAN IS
    l_n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO l_n
      FROM user_tables
     WHERE table_name = p_tabla
       AND NVL(dropped, 'NO') = 'NO';
    RETURN l_n > 0;
  END f_existe_tabla;

  FUNCTION f_tiene_columna(p_tabla IN VARCHAR2, p_columna IN VARCHAR2) RETURN BOOLEAN IS
    l_n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO l_n
      FROM user_tab_columns
     WHERE table_name  = p_tabla
       AND column_name = p_columna;
    RETURN l_n > 0;
  END f_tiene_columna;

  ------------------------------------------------------------------------------
  -- LA UNICA PUERTA DE UN NOMBRE DE TABLA QUE VIENE DEL FRONT.
  --
  -- Devuelve el nombre de la tabla auditada, o NULL si p_tabla no tiene una
  -- bitacora con forma de bitacora. Solo pasa un nombre que existe tal cual en
  -- USER_TABLES, asi que lo que devuelve es seguro de usar en SQL dinamico
  -- (y ademas se usa siempre con f_nombre).
  ------------------------------------------------------------------------------
  FUNCTION f_tabla(p_tabla IN VARCHAR2) RETURN VARCHAR2 IS
    l_jn VARCHAR2(128);
  BEGIN
    IF TRIM(p_tabla) IS NULL OR LENGTH(TRIM(p_tabla)) > 125 THEN
      RETURN NULL;
    END IF;
    l_jn := UPPER(TRIM(p_tabla)) || '_JN';
    IF f_existe_tabla(l_jn)
       AND f_tiene_columna(l_jn, 'JN_OPERATION')
       AND f_tiene_columna(l_jn, 'JN_DATETIME') THEN
      RETURN SUBSTR(l_jn, 1, LENGTH(l_jn) - 3);
    END IF;
    RETURN NULL;
  END f_tabla;

  -- p_alias."COLUMNA" si la columna existe en p_tabla; si no, un NULL del tipo
  -- pedido. Las _JN no son todas iguales, y cada rama de un UNION ALL necesita
  -- las mismas columnas con el mismo tipo.
  FUNCTION f_col(
      p_tabla   IN VARCHAR2,
      p_columna IN VARCHAR2,
      p_alias   IN VARCHAR2,
      p_nulo    IN VARCHAR2
  ) RETURN VARCHAR2 IS
  BEGIN
    IF f_tiene_columna(p_tabla, p_columna) THEN
      RETURN p_alias || '.' || f_nombre(p_columna);
    END IF;
    RETURN 'CAST(NULL AS ' || p_nulo || ')';
  END f_col;

  ------------------------------------------------------------------------------
  -- UNA COLUMNA CUALQUIERA, COMO TEXTO.
  --
  -- El historial trae columnas de todos los tipos y el front las muestra y las
  -- compara como texto. Convertirlas aca —y no dejar que lo haga el driver—
  -- fija el formato: las fechas en ISO, los decimales con punto (sin depender
  -- del NLS de la sesion de ORDS). Los CLOB viajan como CLOB, sin cortar.
  --
  -- Un tipo que no esta en la lista sale como '(TIPO)' en vez de romper la
  -- consulta entera por una columna que igual no se podria mostrar.
  -- p_tipo NULL = la columna no existe en esa tabla: sale NULL.
  ------------------------------------------------------------------------------
  FUNCTION f_texto(p_alias IN VARCHAR2, p_columna IN VARCHAR2, p_tipo IN VARCHAR2)
  RETURN VARCHAR2 IS
    l_c VARCHAR2(300);
  BEGIN
    IF p_tipo IS NULL THEN
      RETURN 'CAST(NULL AS VARCHAR2(1))';
    END IF;

    l_c := p_alias || '.' || f_nombre(p_columna);

    RETURN CASE
      WHEN p_tipo IN ('VARCHAR2', 'CHAR') THEN
        l_c
      WHEN p_tipo IN ('NVARCHAR2', 'NCHAR') THEN
        'TO_CHAR(' || l_c || ')'
      WHEN p_tipo = 'CLOB' THEN
        l_c
      WHEN p_tipo = 'NCLOB' THEN
        'TO_CLOB(' || l_c || ')'
      WHEN p_tipo = 'DATE' THEN
        'TO_CHAR(' || l_c || q'~, 'YYYY-MM-DD"T"HH24:MI:SS')~'
      WHEN p_tipo LIKE 'TIMESTAMP%' THEN
        'TO_CHAR(' || l_c || q'~, 'YYYY-MM-DD"T"HH24:MI:SS.FF3')~'
      WHEN p_tipo IN ('NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'INTEGER') THEN
        'TO_CHAR(' || l_c || q'~, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''')~'
      WHEN p_tipo LIKE 'INTERVAL%' THEN
        'TO_CHAR(' || l_c || ')'
      WHEN p_tipo = 'RAW' THEN
        'RAWTOHEX(' || l_c || ')'
      WHEN p_tipo = 'BLOB' THEN
        'CASE WHEN ' || l_c || ' IS NULL THEN NULL ELSE ''(binario, '' || '
        || 'DBMS_LOB.GETLENGTH(' || l_c || ') || '' bytes)'' END'
      ELSE
        DBMS_ASSERT.ENQUOTE_LITERAL('(' || REPLACE(p_tipo, '''') || ')')
    END;
  END f_texto;

  ------------------------------------------------------------------------------
  -- UNA COLUMNA COMO TEXTO PARA BUSCAR, EN MAYUSCULAS. NULL = no se busca en
  -- ella (binarios y tipos raros).
  --
  -- Parecida a f_texto, pero aca manda lo que el usuario VE en la pantalla, no
  -- lo que el front compara: las fechas van como DD/MM/YYYY y no en ISO, para
  -- que buscar "14/08/2026" las encuentre.
  ------------------------------------------------------------------------------
  FUNCTION f_buscable(p_alias IN VARCHAR2, p_columna IN VARCHAR2, p_tipo IN VARCHAR2)
  RETURN VARCHAR2 IS
    l_c VARCHAR2(300);
  BEGIN
    l_c := p_alias || '.' || f_nombre(p_columna);

    RETURN CASE
      WHEN p_tipo IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR', 'CLOB', 'NCLOB') THEN
        'UPPER(' || l_c || ')'
      WHEN p_tipo = 'DATE' OR p_tipo LIKE 'TIMESTAMP%' THEN
        'TO_CHAR(' || l_c || q'~, 'DD/MM/YYYY HH24:MI:SS')~'
      WHEN p_tipo IN ('NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'INTEGER') THEN
        'TO_CHAR(' || l_c || q'~, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''')~'
    END;
  END f_buscable;

  ------------------------------------------------------------------------------
  -- EL FILTRO "BUSCAR" DE UNA RAMA DE MOVIMIENTOS: el texto en CUALQUIER
  -- columna de datos de esa bitacora.
  --
  -- Va DENTRO de cada rama del UNION ALL y no en el WHERE de afuera, porque
  -- afuera solo quedan las columnas de control: cada _JN tiene las suyas.
  --
  -- Las de control (JN_*) y ID_AUDITORIA no entran: el usuario y el ID tienen
  -- sus propios filtros. Si una bitacora no tiene ninguna columna buscable, la
  -- rama no puede coincidir; se escribe como `:buscar IS NULL` (siempre falso
  -- al buscar) y no como 1 = 0 para que :buscar siga estando en el SQL: bind_
  -- filtros lo bindea siempre que se busca.
  --
  -- :buscar llega en mayusculas, entre % y con los comodines escapados.
  ------------------------------------------------------------------------------
  FUNCTION f_filtro_busqueda(p_jn IN VARCHAR2) RETURN CLOB IS
    l_expr VARCHAR2(400);
    l_pred CLOB;
  BEGIN
    FOR c IN (SELECT column_name, data_type
                FROM user_tab_columns
               WHERE table_name = p_jn
                 AND column_name <> 'ID_AUDITORIA'
                 AND column_name NOT LIKE 'JN\_%' ESCAPE '\'
               ORDER BY column_id) LOOP
      l_expr := f_buscable('j', c.column_name, c.data_type);
      IF l_expr IS NOT NULL THEN
        l_pred := l_pred
          || CASE WHEN l_pred IS NOT NULL THEN ' OR ' END
          || l_expr || q'~ LIKE :buscar ESCAPE '\'~';
      END IF;
    END LOOP;

    IF l_pred IS NULL THEN
      RETURN '(:buscar IS NULL)';
    END IF;
    RETURN '(' || l_pred || ')';
  END f_filtro_busqueda;

  -- El tipo como se escribe en un DDL: VARCHAR2(255), NUMBER(10,2), DATE.
  FUNCTION f_tipo(
      p_tipo      IN VARCHAR2,
      p_largo     IN NUMBER,
      p_char_len  IN NUMBER,
      p_char_used IN VARCHAR2,
      p_precision IN NUMBER,
      p_escala    IN NUMBER
  ) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE
      WHEN p_tipo IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') THEN
        p_tipo || '(' || NVL(NULLIF(p_char_len, 0), p_largo)
        || CASE WHEN p_char_used = 'C' THEN ' CHAR' END || ')'
      WHEN p_tipo = 'NUMBER' AND p_precision IS NOT NULL THEN
        'NUMBER(' || p_precision
        || CASE WHEN NVL(p_escala, 0) <> 0 THEN ',' || p_escala END || ')'
      WHEN p_tipo = 'RAW' THEN
        'RAW(' || p_largo || ')'
      ELSE
        p_tipo
    END;
  END f_tipo;

  ------------------------------------------------------------------------------
  -- ¿EN UN UPDATE, EL TRIGGER GUARDA :OLD O :NEW?  'OLD' / 'NEW' / NULL.
  --
  -- Ver el encabezado: las dos convenciones de la base guardan cosas distintas
  -- y sin saberlo no se puede decir que cambio en cada UPD.
  --
  -- Se lee la fuente del trigger y se busca el VALUES mas cercano ANTES del
  -- literal 'UPD': esa es la lista de valores de la fila que se anota como UPD.
  -- Ahi se cuentan :OLD. contra :NEW.; gana el que aparece mas.
  --
  -- Si el trigger arma el INSERT de otra forma (por ejemplo, un unico INSERT con
  -- la operacion en una variable), no hay VALUES antes del 'UPD' y devuelve
  -- NULL. El front, con NULL, avisa que el diff es una suposicion.
  ------------------------------------------------------------------------------
  FUNCTION f_guarda_en_update(p_trigger IN VARCHAR2) RETURN VARCHAR2 IS
    l_src    VARCHAR2(32767);
    l_upd    PLS_INTEGER;
    l_values PLS_INTEGER;
    l_tramo  VARCHAR2(32767);
    l_new    PLS_INTEGER;
    l_old    PLS_INTEGER;
  BEGIN
    FOR s IN (SELECT text FROM user_source
               WHERE name = p_trigger AND type = 'TRIGGER'
               ORDER BY line) LOOP
      l_src := l_src || UPPER(s.text);
    END LOOP;

    l_upd := INSTR(l_src, '''UPD''');
    IF l_upd = 0 THEN
      RETURN NULL;
    END IF;

    -- Posicion negativa: INSTR busca de atras para adelante.
    l_values := INSTR(SUBSTR(l_src, 1, l_upd), 'VALUES', -1);
    IF l_values = 0 THEN
      RETURN NULL;
    END IF;

    l_tramo := SUBSTR(l_src, l_values, l_upd - l_values);
    l_new   := REGEXP_COUNT(l_tramo, ':NEW\.');
    l_old   := REGEXP_COUNT(l_tramo, ':OLD\.');

    RETURN CASE WHEN l_new > l_old THEN 'NEW'
                WHEN l_old > l_new THEN 'OLD' END;
  EXCEPTION
    -- VALUE_ERROR si la fuente pasa los 32K. No vale tumbar la pantalla por eso.
    WHEN OTHERS THEN RETURN NULL;
  END f_guarda_en_update;

  -- La convencion de la tabla: la del primer trigger que se deja leer.
  FUNCTION f_semantica(p_tabla IN VARCHAR2, p_jn IN VARCHAR2) RETURN VARCHAR2 IS
    l_s VARCHAR2(3);
  BEGIN
    FOR tr IN c_triggers(p_tabla, p_jn) LOOP
      l_s := f_guarda_en_update(tr.trigger_name);
      IF l_s IS NOT NULL THEN
        RETURN l_s;
      END IF;
    END LOOP;
    RETURN NULL;
  END f_semantica;

  ------------------------------------------------------------------------------
  -- LAS COLUMNAS QUE LEE UN TRIGGER, SACADAS DE SU FUENTE.
  --
  -- Suma a p_cols cada columna que el trigger nombra como :NEW.X u :OLD.X, con
  -- o sin comillas (pr_crear_trigger_auditoria escribe :NEW."4X" para las
  -- columnas que empiezan con un digito, como las de POSTULACIONES).
  --
  -- POR QUE NO USER_TRIGGER_COLS, que es la vista que responde justo esto: EN
  -- ORACLEAPEX.COM SE CUELGA. Medido el 24/09/2026:
  --
  --   SELECT COUNT(*) FROM user_trigger_cols WHERE table_name = 'INTERVENCIONES'
  --
  -- no volvia nunca, mientras USER_SOURCE con la fuente de TODOS los triggers
  -- respondia al instante. `tablas` la consultaba una vez por trigger, asi que
  -- el endpoint no terminaba y ORDS respondia su 500 generico. NO VOLVER A
  -- USARLA en nada que corra desde ORDS.
  --
  -- Leer la fuente es exacto para los dos formatos que hay en la base: el
  -- AUDITORIA_* generado y el _JNTRG de evaluaciones nombran cada columna como
  -- :NEW.X / :OLD.X. El unico falso positivo posible es un :NEW.X escrito en
  -- un comentario del trigger: esa columna saldria como leida.
  ------------------------------------------------------------------------------
  PROCEDURE p_columnas_trigger(p_trigger IN VARCHAR2, p_cols IN OUT NOCOPY t_set) IS
    -- Subexpresion 2: el nombre de la columna, entre comillas o no.
    c_ref CONSTANT VARCHAR2(100) :=
      ':(NEW|OLD)\s*\.\s*("[^"]+"|[A-Za-z][A-Za-z0-9_$#]*)';
    l_ref VARCHAR2(200);
    l_i   PLS_INTEGER;
  BEGIN
    FOR s IN (SELECT text FROM user_source
               WHERE name = p_trigger AND type = 'TRIGGER'
               ORDER BY line) LOOP
      l_i := 1;
      LOOP
        l_ref := REGEXP_SUBSTR(s.text, c_ref, 1, l_i, 'i', 2);
        EXIT WHEN l_ref IS NULL;
        -- Entre comillas el nombre va tal cual; sin ellas Oracle lo guarda en
        -- mayusculas.
        IF SUBSTR(l_ref, 1, 1) = '"' THEN
          l_ref := SUBSTR(l_ref, 2, LENGTH(l_ref) - 2);
        ELSE
          l_ref := UPPER(l_ref);
        END IF;
        p_cols(SUBSTR(l_ref, 1, 128)) := TRUE;
        l_i := l_i + 1;
      END LOOP;
    END LOOP;
  END p_columnas_trigger;

  ------------------------------------------------------------------------------
  -- LA CLAVE DEL REGISTRO, LEGIBLE: 'ID_INTERVENCION 123'.
  --
  -- ID_AUDITORIA agrupa la historia de una fila, pero no le dice nada a una
  -- persona. La PK de la tabla si: es el numero que se ve en el resto de la app.
  -- Sale de la bitacora (no de la tabla) para que funcione con filas borradas.
  --
  -- Sin PK, o si la _JN no la guarda, no hay clave: la fila se identifica solo
  -- por ID_AUDITORIA.
  ------------------------------------------------------------------------------
  FUNCTION f_clave_expr(p_tabla IN VARCHAR2, p_jn IN VARCHAR2) RETURN VARCHAR2 IS
    l_expr VARCHAR2(4000);
  BEGIN
    FOR c IN (SELECT cc.column_name
                FROM user_constraints k
                JOIN user_cons_columns cc
                  ON cc.constraint_name = k.constraint_name
                 AND cc.table_name      = k.table_name
               WHERE k.table_name      = p_tabla
                 AND k.constraint_type = 'P'
               ORDER BY cc.position) LOOP
      IF NOT f_tiene_columna(p_jn, c.column_name) THEN
        RETURN 'CAST(NULL AS VARCHAR2(4000))';
      END IF;
      l_expr := CASE WHEN l_expr IS NOT NULL THEN l_expr || q'~ || ', ' || ~' END
             || DBMS_ASSERT.ENQUOTE_LITERAL(REPLACE(c.column_name, '''') || ' ')
             || ' || TO_CHAR(j.' || f_nombre(c.column_name) || ')';
    END LOOP;
    RETURN NVL(l_expr, 'CAST(NULL AS VARCHAR2(4000))');
  END f_clave_expr;

  ------------------------------------------------------------------------------
  -- UN ARRAY JSON CON LAS FILAS DE UN CURSOR DBMS_SQL YA PARSEADO Y BINDEADO.
  --
  -- Cada fila es un objeto con el alias de cada columna como clave. TODAS las
  -- columnas del SELECT tienen que venir como texto o CLOB (ver f_texto): se
  -- definen como VARCHAR2 salvo las CLOB.
  --
  -- p_write_null => TRUE a proposito: en un historial, "estaba vacio" es un dato
  -- y el front tiene que poder compararlo. Sin esto APEX_JSON omite la clave.
  ------------------------------------------------------------------------------
  PROCEDURE escribir_filas(p_nombre IN VARCHAR2, p_cur IN INTEGER) IS
    l_desc  DBMS_SQL.DESC_TAB2;
    l_n     INTEGER;
    l_txt   VARCHAR2(32767);
    l_clob  CLOB;
    l_filas INTEGER;
  BEGIN
    DBMS_SQL.DESCRIBE_COLUMNS2(p_cur, l_n, l_desc);
    FOR i IN 1 .. l_n LOOP
      IF l_desc(i).col_type = c_tipo_clob THEN
        DBMS_SQL.DEFINE_COLUMN(p_cur, i, l_clob);
      ELSE
        DBMS_SQL.DEFINE_COLUMN(p_cur, i, l_txt, 32767);
      END IF;
    END LOOP;

    l_filas := DBMS_SQL.EXECUTE(p_cur);

    APEX_JSON.OPEN_ARRAY(p_nombre);
    WHILE DBMS_SQL.FETCH_ROWS(p_cur) > 0 LOOP
      APEX_JSON.OPEN_OBJECT;
      FOR i IN 1 .. l_n LOOP
        IF l_desc(i).col_type = c_tipo_clob THEN
          DBMS_SQL.COLUMN_VALUE(p_cur, i, l_clob);
          APEX_JSON.WRITE(l_desc(i).col_name, l_clob, TRUE);
        ELSE
          DBMS_SQL.COLUMN_VALUE(p_cur, i, l_txt);
          APEX_JSON.WRITE(l_desc(i).col_name, l_txt, TRUE);
        END IF;
      END LOOP;
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
  END escribir_filas;

  ------------------------------------------------------------------------------
  -- TABLAS
  ------------------------------------------------------------------------------

  PROCEDURE escribir_columna(
      p_columna    IN VARCHAR2,
      p_tipo       IN VARCHAR2,
      p_nulable    IN BOOLEAN,
      p_en_tabla   IN BOOLEAN,
      p_en_jn      IN BOOLEAN,
      p_en_trigger IN BOOLEAN,
      p_es_pk      IN BOOLEAN
  ) IS
  BEGIN
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('columna',    p_columna);
    APEX_JSON.WRITE('tipo',       p_tipo);
    APEX_JSON.WRITE('nulable',    p_nulable);
    APEX_JSON.WRITE('en_tabla',   p_en_tabla);
    APEX_JSON.WRITE('en_jn',      p_en_jn);
    APEX_JSON.WRITE('en_trigger', p_en_trigger);
    APEX_JSON.WRITE('es_pk',      p_es_pk);
    APEX_JSON.CLOSE_OBJECT;
  END escribir_columna;

  ------------------------------------------------------------------------------
  -- UNA TABLA AUDITADA, CON TODO LO QUE LA PANTALLA NECESITA PARA JUZGARLA.
  --
  -- LAS COLUMNAS SE CRUZAN EN TRES LUGARES, y cada cruce responde una pregunta:
  --
  --   en_jn       ¿la bitacora tiene donde guardarla?
  --   en_trigger  ¿el trigger la lee? (su fuente: ver p_columnas_trigger)
  --   en_tabla    ¿sigue existiendo en la tabla?
  --
  -- Una columna esta auditada de verdad solo con las dos primeras. La tipica que
  -- falla es la que se agrego a la tabla DESPUES de auditarla: no esta en la
  -- _JN, el trigger no la conoce, y sus cambios no quedan anotados en ningun
  -- lado. Correr pr_crear_trigger_auditoria de nuevo la suma.
  --
  -- Las que estan en la _JN y ya no en la tabla (en_tabla = false) son
  -- historicas: se borraron de la tabla pero su pasado sigue en la bitacora.
  --
  -- Si contar la bitacora falla, la tabla se lista igual con `error`: una _JN
  -- rota no puede esconder a las demas.
  ------------------------------------------------------------------------------
  PROCEDURE escribir_tabla(p_tabla IN VARCHAR2, p_jn IN VARCHAR2) IS
    l_en_jn      t_set;
    l_en_trigger t_set;
    l_pk         t_set;
    l_clave      VARCHAR2(4000);
    l_total      NUMBER;
    l_ins        NUMBER;
    l_upd        NUMBER;
    l_del        NUMBER;
    l_primero    VARCHAR2(30);
    l_ultimo     VARCHAR2(30);
    l_error      VARCHAR2(4000);
  BEGIN
    FOR c IN (SELECT column_name FROM user_tab_columns WHERE table_name = p_jn) LOOP
      l_en_jn(c.column_name) := TRUE;
    END LOOP;

    FOR c IN (SELECT cc.column_name
                FROM user_constraints k
                JOIN user_cons_columns cc
                  ON cc.constraint_name = k.constraint_name
                 AND cc.table_name      = k.table_name
               WHERE k.table_name      = p_tabla
                 AND k.constraint_type = 'P'
               ORDER BY cc.position) LOOP
      l_pk(c.column_name) := TRUE;
      l_clave := CASE WHEN l_clave IS NULL THEN c.column_name
                      ELSE l_clave || ', ' || c.column_name END;
    END LOOP;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('tabla',        p_tabla);
    APEX_JSON.WRITE('tabla_jn',     p_jn);
    APEX_JSON.WRITE('existe_tabla', f_existe_tabla(p_tabla));
    APEX_JSON.WRITE('clave',        l_clave, TRUE);

    APEX_JSON.OPEN_ARRAY('triggers');
    FOR tr IN c_triggers(p_tabla, p_jn) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('nombre',           tr.trigger_name);
      APEX_JSON.WRITE('habilitado',       tr.status = 'ENABLED');
      APEX_JSON.WRITE('valido',           tr.estado_objeto = 'VALID');
      APEX_JSON.WRITE('guarda_en_update', f_guarda_en_update(tr.trigger_name), TRUE);
      APEX_JSON.CLOSE_OBJECT;

      -- De su fuente, NO de USER_TRIGGER_COLS: ver p_columnas_trigger.
      p_columnas_trigger(tr.trigger_name, l_en_trigger);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('columnas');
    -- Las de la tabla, en su orden.
    FOR c IN (SELECT column_name, data_type, data_length, char_length, char_used,
                     data_precision, data_scale, nullable
                FROM user_tab_columns
               WHERE table_name = p_tabla
               ORDER BY column_id) LOOP
      escribir_columna(
          c.column_name,
          f_tipo(c.data_type, c.data_length, c.char_length, c.char_used,
                 c.data_precision, c.data_scale),
          c.nullable = 'Y',
          TRUE,
          l_en_jn.EXISTS(c.column_name),
          l_en_trigger.EXISTS(c.column_name),
          l_pk.EXISTS(c.column_name));
    END LOOP;
    -- Las que quedaron solo en la bitacora. Las JN_* son de control, no datos.
    FOR c IN (SELECT j.column_name, j.data_type, j.data_length, j.char_length, j.char_used,
                     j.data_precision, j.data_scale, j.nullable
                FROM user_tab_columns j
               WHERE j.table_name = p_jn
                 AND j.column_name NOT LIKE 'JN\_%' ESCAPE '\'
                 AND j.column_name <> 'ID_AUDITORIA'
                 AND NOT EXISTS (SELECT 1 FROM user_tab_columns t
                                  WHERE t.table_name  = p_tabla
                                    AND t.column_name = j.column_name)
               ORDER BY j.column_id) LOOP
      escribir_columna(
          c.column_name,
          f_tipo(c.data_type, c.data_length, c.char_length, c.char_used,
                 c.data_precision, c.data_scale),
          c.nullable = 'Y',
          FALSE,
          TRUE,
          FALSE,
          FALSE);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    BEGIN
      EXECUTE IMMEDIATE
           'SELECT COUNT(*),'
        || ' COUNT(CASE WHEN TRIM(jn_operation) = ''INS'' THEN 1 END),'
        || ' COUNT(CASE WHEN TRIM(jn_operation) = ''UPD'' THEN 1 END),'
        || ' COUNT(CASE WHEN TRIM(jn_operation) = ''DEL'' THEN 1 END),'
        || ' TO_CHAR(CAST(MIN(jn_datetime) AS DATE) + :d1, :f1),'
        || ' TO_CHAR(CAST(MAX(jn_datetime) AS DATE) + :d2, :f2)'
        || ' FROM ' || f_nombre(p_jn)
        INTO l_total, l_ins, l_upd, l_del, l_primero, l_ultimo
        USING c_desfase, c_fmt_fecha, c_desfase, c_fmt_fecha;
    EXCEPTION
      WHEN OTHERS THEN l_error := SQLERRM;
    END;

    APEX_JSON.WRITE('movimientos',       l_total,   TRUE);
    APEX_JSON.WRITE('inserciones',       l_ins,     TRUE);
    APEX_JSON.WRITE('actualizaciones',   l_upd,     TRUE);
    APEX_JSON.WRITE('eliminaciones',     l_del,     TRUE);
    APEX_JSON.WRITE('primer_movimiento', l_primero, TRUE);
    APEX_JSON.WRITE('ultimo_movimiento', l_ultimo,  TRUE);
    APEX_JSON.WRITE('error',             l_error,   TRUE);
    APEX_JSON.CLOSE_OBJECT;
  END escribir_tabla;

  PROCEDURE tablas(p_token IN VARCHAR2) IS
    l_err VARCHAR2(4000);
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    iniciar;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR t IN c_auditadas LOOP
      escribir_tabla(t.tabla, t.tabla_jn);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    enviar;
  EXCEPTION
    WHEN OTHERS THEN
      l_err := SQLERRM;
      descartar;
      p_error(500, 'Internal Server Error', 'Error: ' || l_err);
  END tablas;

  ------------------------------------------------------------------------------
  -- MOVIMIENTOS: la bitacora de todas las tablas en una sola lista.
  --
  -- Es un UNION ALL con una rama por _JN, armado en el momento: la lista de
  -- tablas auditadas cambia cada vez que se corre pr_crear_trigger_auditoria y
  -- una vista fija quedaria vieja. Los filtros van en el WHERE de afuera y
  -- Oracle los empuja a cada rama.
  --
  -- EL ORDEN: fecha, y a igual segundo, el ROWID de la fila de bitacora. JN_
  -- DATETIME es DATE (precision de segundo) y un "Guardar" puede disparar un
  -- INS y un UPD en el mismo segundo; el ROWID de una tabla que solo recibe
  -- INSERTs sigue, en la practica, el orden de insercion. No es una garantia de
  -- Oracle, pero es el mejor desempate disponible sin columna de secuencia.
  --
  -- Sin indices en las _JN esto recorre cada bitacora entera. Con los volumenes
  -- de hoy no se nota; si un dia pesa, el indice a crear es sobre JN_DATETIME.
  --
  -- BUSCAR (p_buscar) mira en todas las columnas de datos de cada bitacora: ver
  -- f_filtro_busqueda. Un indice no la ayudaria (es un "contiene"), asi que
  -- con busqueda cada rama lee y convierte a texto todas sus filas. Lo que
  -- apunta a otra tabla esta guardado como ID (ID_FACILITADOR, no el nombre):
  -- se encuentra por el numero.
  ------------------------------------------------------------------------------
  PROCEDURE movimientos(
      p_token        IN VARCHAR2,
      p_tabla        IN VARCHAR2 DEFAULT NULL,
      p_operacion    IN VARCHAR2 DEFAULT NULL,
      p_usuario      IN VARCHAR2 DEFAULT NULL,
      p_desde        IN VARCHAR2 DEFAULT NULL,
      p_hasta        IN VARCHAR2 DEFAULT NULL,
      p_id_auditoria IN NUMBER   DEFAULT NULL,
      p_limite       IN NUMBER   DEFAULT NULL,
      p_pagina       IN NUMBER   DEFAULT NULL,
      p_buscar       IN VARCHAR2 DEFAULT NULL
  ) IS
    l_tabla  VARCHAR2(128);
    l_op     VARCHAR2(10);
    l_usr    VARCHAR2(300);
    l_bus    VARCHAR2(800);
    l_desde  DATE;
    l_hasta  DATE;
    l_tope   NUMBER;
    l_pagina NUMBER;
    l_salto  NUMBER;
    l_union  CLOB;
    l_where  VARCHAR2(4000);
    l_cur    INTEGER;
    l_total  NUMBER := 0;
    l_filas  INTEGER;
    l_err    VARCHAR2(4000);

    -- Por nombre (DBMS_SQL): cada bind aparece dos veces en el WHERE y asi se
    -- bindea una sola.
    PROCEDURE bind_filtros(p_cur IN INTEGER) IS
    BEGIN
      DBMS_SQL.BIND_VARIABLE(p_cur, 'op',    l_op);
      DBMS_SQL.BIND_VARIABLE(p_cur, 'usr',   l_usr);
      DBMS_SQL.BIND_VARIABLE(p_cur, 'desde', l_desde);
      DBMS_SQL.BIND_VARIABLE(p_cur, 'hasta', l_hasta);
      DBMS_SQL.BIND_VARIABLE(p_cur, 'id',    p_id_auditoria);
      -- Solo si se busca: sin busqueda el SQL no tiene :buscar, y bindear un
      -- nombre que no esta en el SQL da ORA-01006.
      IF l_bus IS NOT NULL THEN
        DBMS_SQL.BIND_VARIABLE(p_cur, 'buscar', l_bus);
      END IF;
    END bind_filtros;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    IF TRIM(p_tabla) IS NOT NULL THEN
      l_tabla := f_tabla(p_tabla);
      IF l_tabla IS NULL THEN
        p_error(404, 'Not Found', 'La tabla ' || SUBSTR(p_tabla, 1, 128) || ' no esta auditada');
        RETURN;
      END IF;
    END IF;

    l_op := UPPER(SUBSTR(TRIM(p_operacion), 1, 10));
    IF l_op IS NOT NULL AND l_op NOT IN ('INS', 'UPD', 'DEL') THEN
      p_error(400, 'Bad Request', 'operacion tiene que ser INS, UPD o DEL');
      RETURN;
    END IF;

    IF TRIM(p_usuario) IS NOT NULL THEN
      l_usr := '%' || UPPER(TRIM(SUBSTR(p_usuario, 1, 255))) || '%';
    END IF;

    -- En mayusculas y con los comodines de LIKE escapados: buscar "10%" o
    -- "A_B" tiene que encontrar ese texto, no usarlo de patron.
    IF TRIM(p_buscar) IS NOT NULL THEN
      l_bus := '%'
        || REPLACE(REPLACE(REPLACE(UPPER(TRIM(SUBSTR(p_buscar, 1, 255))),
                   '\', '\\'), '%', '\%'), '_', '\_')
        || '%';
    END IF;

    -- Las fechas llegan en hora de Paraguay y se comparan contra la del
    -- servidor: se corren al reves que en la salida. `hasta` es inclusivo.
    BEGIN
      IF TRIM(p_desde) IS NOT NULL THEN
        l_desde := TO_DATE(SUBSTR(TRIM(p_desde), 1, 10), 'YYYY-MM-DD') - c_desfase;
      END IF;
      IF TRIM(p_hasta) IS NOT NULL THEN
        l_hasta := TO_DATE(SUBSTR(TRIM(p_hasta), 1, 10), 'YYYY-MM-DD') + 1 - c_desfase;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'desde y hasta van como YYYY-MM-DD');
        RETURN;
    END;

    l_tope   := LEAST(GREATEST(NVL(TRUNC(p_limite), c_limite_defecto), 1), c_limite_maximo);
    l_pagina := GREATEST(NVL(TRUNC(p_pagina), 1), 1);
    l_salto  := (l_pagina - 1) * l_tope;

    FOR t IN c_auditadas LOOP
      IF l_tabla IS NULL OR t.tabla = l_tabla THEN
        IF l_union IS NOT NULL THEN
          l_union := l_union || ' UNION ALL ';
        END IF;
        l_union := l_union
          || 'SELECT ' || DBMS_ASSERT.ENQUOTE_LITERAL(t.tabla) || ' AS tabla, '
          || f_col(t.tabla_jn, 'ID_AUDITORIA',   'j', 'NUMBER')         || ' AS id_auditoria, '
          || 'TRIM(j.jn_operation) AS operacion, '
          || f_col(t.tabla_jn, 'JN_ORACLE_USER', 'j', 'VARCHAR2(4000)') || ' AS usuario, '
          || 'CAST(j.jn_datetime AS DATE) AS fecha, '
          || 'TO_CHAR(' || f_col(t.tabla_jn, 'JN_SESSION', 'j', 'NUMBER') || ') AS sesion, '
          || f_col(t.tabla_jn, 'JN_APPLN',       'j', 'VARCHAR2(4000)') || ' AS aplicacion, '
          || f_col(t.tabla_jn, 'JN_NOTES',       'j', 'VARCHAR2(4000)') || ' AS notas, '
          || f_clave_expr(t.tabla, t.tabla_jn) || ' AS clave, '
          || 'j.ROWID AS rid '
          || 'FROM ' || f_nombre(t.tabla_jn) || ' j';
        -- La busqueda va ADENTRO de la rama: ver f_filtro_busqueda.
        IF l_bus IS NOT NULL THEN
          l_union := l_union || ' WHERE ' || f_filtro_busqueda(t.tabla_jn);
        END IF;
      END IF;
    END LOOP;

    -- Sin tablas auditadas no hay nada que consultar.
    IF l_union IS NULL THEN
      iniciar;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('success', TRUE);
      APEX_JSON.WRITE('total',   0);
      APEX_JSON.WRITE('pagina',  l_pagina);
      APEX_JSON.WRITE('limite',  l_tope);
      APEX_JSON.OPEN_ARRAY('data');
      APEX_JSON.CLOSE_ARRAY;
      APEX_JSON.CLOSE_OBJECT;
      enviar;
      RETURN;
    END IF;

    l_where := ' WHERE (:op IS NULL OR m.operacion = :op)'
            || ' AND (:usr IS NULL OR UPPER(m.usuario) LIKE :usr)'
            || ' AND (:desde IS NULL OR m.fecha >= :desde)'
            || ' AND (:hasta IS NULL OR m.fecha < :hasta)'
            || ' AND (:id IS NULL OR m.id_auditoria = :id)';

    -- El total, sin paginar.
    l_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(l_cur, 'SELECT COUNT(*) FROM (' || l_union || ') m' || l_where,
                   DBMS_SQL.NATIVE);
    bind_filtros(l_cur);
    DBMS_SQL.DEFINE_COLUMN(l_cur, 1, l_total);
    l_filas := DBMS_SQL.EXECUTE_AND_FETCH(l_cur);
    DBMS_SQL.COLUMN_VALUE(l_cur, 1, l_total);
    DBMS_SQL.CLOSE_CURSOR(l_cur);

    -- La pagina.
    l_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(l_cur,
         'SELECT m.tabla AS "tabla",'
      || ' TO_CHAR(m.id_auditoria) AS "id_auditoria",'
      || ' m.operacion AS "operacion",'
      || ' m.usuario AS "usuario",'
      || ' TO_CHAR(m.fecha + :desfase, :fmt) AS "fecha",'
      || ' m.sesion AS "sesion",'
      || ' m.aplicacion AS "aplicacion",'
      || ' m.notas AS "notas",'
      || ' m.clave AS "clave",'
      || ' ROWIDTOCHAR(m.rid) AS "rid"'
      || ' FROM (' || l_union || ') m' || l_where
      || ' ORDER BY m.fecha DESC, m.tabla, m.rid DESC'
      || ' OFFSET :salto ROWS FETCH NEXT :tope ROWS ONLY',
      DBMS_SQL.NATIVE);
    bind_filtros(l_cur);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'desfase', c_desfase);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'fmt',     c_fmt_fecha);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'salto',   l_salto);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'tope',    l_tope);

    iniciar;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_tope);
    escribir_filas('data', l_cur);
    APEX_JSON.CLOSE_OBJECT;
    DBMS_SQL.CLOSE_CURSOR(l_cur);
    enviar;
  EXCEPTION
    WHEN OTHERS THEN
      l_err := SQLERRM;
      IF DBMS_SQL.IS_OPEN(l_cur) THEN
        DBMS_SQL.CLOSE_CURSOR(l_cur);
      END IF;
      descartar;
      p_error(500, 'Internal Server Error', 'Error: ' || l_err);
  END movimientos;

  ------------------------------------------------------------------------------
  -- HISTORIAL: toda la vida de UN registro.
  --
  -- Un registro se sigue por ID_AUDITORIA: el trigger lo asigna en el INSERT y
  -- lo repite en cada UPD y DEL de esa fila. Devuelve:
  --
  --   columnas  las columnas de datos: primero las de la tabla en su orden,
  --             despues las que solo quedan en la bitacora (historicas)
  --   eventos   las filas de la _JN, de la mas vieja a la mas nueva
  --   actual    la fila como esta HOY en la tabla (0 o 1 elemento). Con la
  --             convencion :OLD es lo unico que dice como quedo el ultimo UPD.
  --
  -- Las claves de los eventos: los datos van con el nombre real de la columna
  -- (MAYUSCULAS) y los de control en minuscula ("operacion", "usuario"...), asi
  -- que no se pisan aunque la tabla tenga una columna USUARIO.
  ------------------------------------------------------------------------------
  PROCEDURE historial(
      p_token        IN VARCHAR2,
      p_tabla        IN VARCHAR2,
      p_id_auditoria IN NUMBER
  ) IS
    l_tabla  VARCHAR2(128);
    l_jn     VARCHAR2(128);
    l_existe BOOLEAN;
    l_actual BOOLEAN;
    l_cols   t_nombres := t_nombres();
    l_tipo_t t_tipos;
    l_tipo_j t_tipos;
    l_pk     t_set;
    l_sel_jn CLOB;
    l_sel_t  CLOB;
    l_cur    INTEGER;
    l_err    VARCHAR2(4000);

    FUNCTION tipo_de(p_tipos IN t_tipos, p_col IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
      IF p_tipos.EXISTS(p_col) THEN
        RETURN p_tipos(p_col);
      END IF;
      RETURN NULL;
    END tipo_de;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    l_tabla := f_tabla(p_tabla);
    IF l_tabla IS NULL THEN
      p_error(404, 'Not Found', 'La tabla ' || SUBSTR(p_tabla, 1, 128) || ' no esta auditada');
      RETURN;
    END IF;
    IF p_id_auditoria IS NULL THEN
      p_error(400, 'Bad Request', 'Falta id_auditoria');
      RETURN;
    END IF;

    l_jn := l_tabla || '_JN';
    IF NOT f_tiene_columna(l_jn, 'ID_AUDITORIA') THEN
      p_error(400, 'Bad Request',
              'La bitacora de ' || l_tabla || ' no tiene ID_AUDITORIA: no se puede seguir un registro');
      RETURN;
    END IF;

    l_existe := f_existe_tabla(l_tabla);
    l_actual := l_existe AND f_tiene_columna(l_tabla, 'ID_AUDITORIA');

    FOR c IN (SELECT column_name, data_type
                FROM user_tab_columns
               WHERE table_name = l_tabla
                 AND column_name <> 'ID_AUDITORIA'
               ORDER BY column_id) LOOP
      l_cols.EXTEND;
      l_cols(l_cols.COUNT)    := c.column_name;
      l_tipo_t(c.column_name) := c.data_type;
    END LOOP;

    FOR c IN (SELECT column_name, data_type
                FROM user_tab_columns
               WHERE table_name = l_jn
                 AND column_name <> 'ID_AUDITORIA'
                 AND column_name NOT LIKE 'JN\_%' ESCAPE '\'
               ORDER BY column_id) LOOP
      IF NOT l_tipo_t.EXISTS(c.column_name) THEN
        l_cols.EXTEND;
        l_cols(l_cols.COUNT) := c.column_name;
      END IF;
      l_tipo_j(c.column_name) := c.data_type;
    END LOOP;

    IF l_cols.COUNT = 0 THEN
      p_error(400, 'Bad Request', 'La bitacora de ' || l_tabla || ' no tiene columnas de datos');
      RETURN;
    END IF;

    FOR c IN (SELECT cc.column_name
                FROM user_constraints k
                JOIN user_cons_columns cc
                  ON cc.constraint_name = k.constraint_name
                 AND cc.table_name      = k.table_name
               WHERE k.table_name      = l_tabla
                 AND k.constraint_type = 'P') LOOP
      l_pk(c.column_name) := TRUE;
    END LOOP;

    -- Las filas de la bitacora.
    l_sel_jn := 'SELECT TRIM(j.jn_operation) AS "operacion", '
      || f_col(l_jn, 'JN_ORACLE_USER', 'j', 'VARCHAR2(4000)') || ' AS "usuario", '
      || 'TO_CHAR(CAST(j.jn_datetime AS DATE) + :desfase, :fmt) AS "fecha", '
      || 'TO_CHAR(' || f_col(l_jn, 'JN_SESSION', 'j', 'NUMBER') || ') AS "sesion", '
      || f_col(l_jn, 'JN_APPLN', 'j', 'VARCHAR2(4000)') || ' AS "aplicacion", '
      || f_col(l_jn, 'JN_NOTES', 'j', 'VARCHAR2(4000)') || ' AS "notas", '
      || 'ROWIDTOCHAR(j.ROWID) AS "rid"';
    FOR i IN 1 .. l_cols.COUNT LOOP
      l_sel_jn := l_sel_jn || ', '
        || f_texto('j', l_cols(i), tipo_de(l_tipo_j, l_cols(i)))
        || ' AS ' || f_nombre(l_cols(i));
    END LOOP;
    l_sel_jn := l_sel_jn
      || ' FROM ' || f_nombre(l_jn) || ' j'
      || ' WHERE j.' || f_nombre('ID_AUDITORIA') || ' = :id'
      || ' ORDER BY j.jn_datetime, j.ROWID'
      || ' FETCH FIRST :tope ROWS ONLY';

    -- La fila de hoy.
    IF l_actual THEN
      l_sel_t := 'SELECT ';
      FOR i IN 1 .. l_cols.COUNT LOOP
        l_sel_t := l_sel_t || CASE WHEN i > 1 THEN ', ' END
          || f_texto('t', l_cols(i), tipo_de(l_tipo_t, l_cols(i)))
          || ' AS ' || f_nombre(l_cols(i));
      END LOOP;
      l_sel_t := l_sel_t
        || ' FROM ' || f_nombre(l_tabla) || ' t'
        || ' WHERE t.' || f_nombre('ID_AUDITORIA') || ' = :id'
        || ' FETCH FIRST 1 ROWS ONLY';
    END IF;

    iniciar;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',          TRUE);
    APEX_JSON.WRITE('tabla',            l_tabla);
    APEX_JSON.WRITE('id_auditoria',     p_id_auditoria);
    APEX_JSON.WRITE('existe_tabla',     l_existe);
    APEX_JSON.WRITE('guarda_en_update', f_semantica(l_tabla, l_jn), TRUE);
    APEX_JSON.WRITE('max_eventos',      c_max_eventos);

    APEX_JSON.OPEN_ARRAY('columnas');
    FOR i IN 1 .. l_cols.COUNT LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('columna',  l_cols(i));
      APEX_JSON.WRITE('en_tabla', l_tipo_t.EXISTS(l_cols(i)));
      APEX_JSON.WRITE('en_jn',    l_tipo_j.EXISTS(l_cols(i)));
      APEX_JSON.WRITE('es_pk',    l_pk.EXISTS(l_cols(i)));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    l_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(l_cur, l_sel_jn, DBMS_SQL.NATIVE);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'desfase', c_desfase);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'fmt',     c_fmt_fecha);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'id',      p_id_auditoria);
    DBMS_SQL.BIND_VARIABLE(l_cur, 'tope',    c_max_eventos);
    escribir_filas('eventos', l_cur);
    DBMS_SQL.CLOSE_CURSOR(l_cur);

    IF l_actual THEN
      l_cur := DBMS_SQL.OPEN_CURSOR;
      DBMS_SQL.PARSE(l_cur, l_sel_t, DBMS_SQL.NATIVE);
      DBMS_SQL.BIND_VARIABLE(l_cur, 'id', p_id_auditoria);
      escribir_filas('actual', l_cur);
      DBMS_SQL.CLOSE_CURSOR(l_cur);
    ELSE
      APEX_JSON.OPEN_ARRAY('actual');
      APEX_JSON.CLOSE_ARRAY;
    END IF;

    APEX_JSON.CLOSE_OBJECT;
    enviar;
  EXCEPTION
    WHEN OTHERS THEN
      l_err := SQLERRM;
      IF DBMS_SQL.IS_OPEN(l_cur) THEN
        DBMS_SQL.CLOSE_CURSOR(l_cur);
      END IF;
      descartar;
      p_error(500, 'Internal Server Error', 'Error: ' || l_err);
  END historial;

END PKG_AUDITORIA_ETHOS;
/

--------------------------------------------------------------------------------
-- === 5) HANDLERS ORDS =======================================================
--------------------------------------------------------------------------------
--
-- Se AGREGAN al modulo 'ethos' que creo auth.sql. Este script NO define el
-- modulo: ORDS.DEFINE_MODULE sobre un modulo existente lo borra con todos sus
-- templates, incluidos los de los otros scripts.
--
-- OJO CON ORDS.DEFINE_PARAMETER DEL HEADER: si falta, :authorization llega NULL
-- y TODO responde "Token invalido o expirado" aunque el login haya dado un token
-- bueno. Va UNA VEZ POR HANDLER.
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_ords_modules WHERE name = 'ethos';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe el modulo ORDS ethos. Corre backend/auth.sql.');
    RAISE_APPLICATION_ERROR(-20001, 'Falta el modulo ethos');
  END IF;
END;
/

BEGIN
  ----------------------------------------------------------------------------
  -- auditoria/tablas
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auditoria/tablas',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auditoria/tablas',
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
    PKG_AUDITORIA_ETHOS.TABLAS(p_token => l_token);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auditoria/tablas',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- auditoria/movimientos  ?tabla=&operacion=&usuario=&desde=&hasta=
  --                        &id_auditoria=&limite=&pagina=&buscar=
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auditoria/movimientos',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auditoria/movimientos',
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
    PKG_AUDITORIA_ETHOS.MOVIMIENTOS(
        p_token        => l_token,
        p_tabla        => :tabla,
        -- INS / UPD / DEL
        p_operacion    => :operacion,
        -- Contiene, sin distinguir mayusculas.
        p_usuario      => :usuario,
        -- YYYY-MM-DD en hora de Paraguay. `hasta` es inclusivo.
        p_desde        => :desde,
        p_hasta        => :hasta,
        p_id_auditoria => TO_NUMBER(:id_auditoria),
        p_limite       => TO_NUMBER(:limite),
        p_pagina       => TO_NUMBER(:pagina),
        -- Contiene, en cualquier columna de datos de la bitacora.
        p_buscar       => :buscar);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auditoria/movimientos',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- auditoria/historial  ?tabla=&id_auditoria=
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auditoria/historial',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auditoria/historial',
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
    PKG_AUDITORIA_ETHOS.HISTORIAL(
        p_token        => l_token,
        p_tabla        => :tabla,
        p_id_auditoria => TO_NUMBER(:id_auditoria));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auditoria/historial',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de auditoria publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar el handler: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, a prueba de fallos. Hace falta porque el sitio publicado en
-- GitHub Pages le pega DIRECTO a ORDS (no hay proxy en el hosting estatico).
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
  preflight('auditoria/tablas');
  preflight('auditoria/movimientos');
  preflight('auditoria/historial');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Preflight OPTIONS no se pudo publicar: ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 6) VERIFICACION ========================================================
--
-- Lista lo que la pantalla va a mostrar, para poder contrastarlo sin abrirla.
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
  l_n      PLS_INTEGER := 0;
  l_trg    VARCHAR2(4000);
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_AUDITORIA_ETHOS'
     AND object_type = 'PACKAGE BODY';

  IF l_estado <> 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AUDITORIA_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_AUDITORIA_ETHOS'';');
    RETURN;
  END IF;
  DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUDITORIA_ETHOS compilado.');

  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PR_CREAR_TRIGGER_AUDITORIA'
     AND object_type = 'PROCEDURE';
  DBMS_OUTPUT.PUT_LINE(CASE WHEN l_estado = 'VALID' THEN '[OK]   ' ELSE '[ERROR] ' END
                       || 'PR_CREAR_TRIGGER_AUDITORIA: ' || l_estado);

  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('       Tablas auditadas:');
  FOR t IN (
      SELECT SUBSTR(j.table_name, 1, LENGTH(j.table_name) - 3) AS tabla
        FROM user_tables j
       WHERE j.table_name LIKE '%\_JN' ESCAPE '\'
         AND NVL(j.dropped, 'NO') = 'NO'
         AND EXISTS (SELECT 1 FROM user_tab_columns c
                      WHERE c.table_name = j.table_name AND c.column_name = 'JN_OPERATION')
         AND EXISTS (SELECT 1 FROM user_tab_columns c
                      WHERE c.table_name = j.table_name AND c.column_name = 'JN_DATETIME')
       ORDER BY j.table_name
  ) LOOP
    l_n := l_n + 1;
    SELECT LISTAGG(tr.trigger_name || ' (' || tr.status || ')', ', ')
             WITHIN GROUP (ORDER BY tr.trigger_name)
      INTO l_trg
      FROM user_triggers tr
     WHERE tr.table_name = t.tabla
       AND tr.trigger_name IN ('AUDITORIA_' || t.tabla, t.tabla || '_JNTRG');
    DBMS_OUTPUT.PUT_LINE('         ' || RPAD(t.tabla, 34) || NVL(l_trg, '(sin trigger)'));
  END LOOP;

  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('         (ninguna: no hay tablas X con su X_JN)');
  END IF;

  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('       GET auditoria/tablas');
  DBMS_OUTPUT.PUT_LINE('       GET auditoria/movimientos ?tabla=&operacion=&usuario=&desde=&hasta=');
  DBMS_OUTPUT.PUT_LINE('                                 &id_auditoria=&limite=&pagina=&buscar=');
  DBMS_OUTPUT.PUT_LINE('       GET auditoria/historial   ?tabla=&id_auditoria=');
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AUDITORIA_ETHOS o PR_CREAR_TRIGGER_AUDITORIA no se crearon.');
END;
/
