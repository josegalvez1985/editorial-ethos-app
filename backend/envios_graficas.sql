--------------------------------------------------------------------------------
-- ENVIOS_GRAFICAS  —  Envios de graficas a las sucursales (Operaciones)
--------------------------------------------------------------------------------
--
-- Pantalla NUEVA del sitio (13/10/2026), no viene de APEX: /envios-graficas.
--
-- CABECERA Y DETALLE (cambio de estructura de Jose, 13/10/2026):
--
--   ENVIOS_CABECERA   un envio: la grafica (la imprenta) y la FECHA.
--   ENVIOS_GRAFICAS   sus lineas: a que departamento, ciudad y sucursal van,
--                     con cuantos manuales de cada uno (Ser ... Liderazgo) y
--                     el total (CANTIDAD). FK a la cabecera por ID_CABECERA.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     envios-graficas         los envios, del mas nuevo al mas viejo,
--                                   cada uno con sus `lineas` y con quien y
--                                   cuando se cargo y se modifico (de la
--                                   bitacora), + los catalogos del formulario
--   POST    envios-graficas         {nombre_grafica, fecha, detalle} -> {id_cabecera}
--   PUT     envios-graficas/:id     lo mismo
--   DELETE  envios-graficas/:id     el envio con todas sus lineas
--
--   `fecha` 'YYYY-MM-DD'. `detalle` es un TEXTO con un JSON:
--     {"lineas":[{"id_envio":12, "id_departamento":1, "id_ciudad":5,
--                 "sucursal":"Casa Central", "ser":10, ..., "liderazgo":0,
--                 "comentario":"..."}, ...]}
--   Va como texto y no como array porque ORDS bindea solo los campos escalares
--   del body (como `datos` en facilitadores.sql). `id_envio` solo en las lineas
--   que ya existian.
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql, departamentos.sql,
-- ciudades.sql y sucursales.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
-- Y DESPUES, EN EL SITIO: dar de alta la pagina en Crear paginas (Operaciones,
-- "Envios de Graficas", ruta /envios-graficas) y sus permisos en Roles de
-- paginas. Hasta entonces el GET anda, pero guardar y borrar responden 403.
--
--------------------------------------------------------------------------------
-- LA ESTRUCTURA (seccion 2)
--------------------------------------------------------------------------------
--
-- Las tablas que no existan se crean tal cual las paso Jose el 13/10/2026
-- (identity, FKs, comentarios), con sus bitacoras _JN (las columnas JN_* de
-- pr_crear_trigger_auditoria) y SEQ_AUDITORIA. Las que existen no se tocan.
--
-- Si ENVIOS_GRAFICAS existe con la estructura VIEJA (la primera version, con
-- NOMBRE_GRAFICA y sin ID_CABECERA), la verificacion lo dice con [ERROR] y el
-- paquete no compila: no se migra solo. Hay que recrearla con el DDL nuevo.
-- Si su bitacora ENVIOS_GRAFICAS_JN es la vieja, se le AGREGA ID_CABECERA
-- (es solo sumar una columna: el historial viejo queda).
--
--------------------------------------------------------------------------------
-- LOS TRIGGERS (seccion 3): LOS MISMOS, CON EL USUARIO DE LA APP
--------------------------------------------------------------------------------
--
-- ENVIOS_CABECERA_JNTRG y ENVIOS_GRAFICAS_JNTRG son los que vinieron con las
-- tablas, con UN cambio: JN_ORACLE_USER era NVL(V('APP_USER'), USER). Desde
-- ORDS no hay sesion APEX y todo quedaria a nombre del esquema; ahora cae a
-- CLIENT_IDENTIFIER, que PKG_AUTH_ETHOS.VALIDAR_TOKEN deja con el usuario del
-- token (ver auth.sql), con SUBSTR a 30 por el largo de la columna. En un UPD
-- siguen guardando :NEW (el DESPUES), como venian.
--
-- "Cargado el ... por ..." y "modificado el ... por ..." salen de la bitacora
-- de la CABECERA. Para que un cambio que solo toca lineas tambien figure,
-- guardar SIEMPRE actualiza la cabecera (aunque grafica y fecha sean las
-- mismas). JN_DATETIME es UTC: se devuelve corrida a Paraguay (- 3/24).
--
--------------------------------------------------------------------------------
-- REGLAS
--------------------------------------------------------------------------------
--
--   Cabecera:
--   - Grafica y fecha obligatorias. Una grafica escrita con otras mayusculas o
--     espacios se guarda con la grafia que ya tiene: no se parte en los filtros.
--   - Al menos una linea.
--
--   Cada linea:
--   - Departamento, ciudad y sucursal obligatorios; la ciudad tiene que ser
--     del departamento.
--   - SUCURSAL guarda el NOMBRE (no el id, asi es la tabla): tiene que ser una
--     de SUCURSALES y se guarda con su grafia. Una linea que ya existia y cuya
--     sucursal cambio de nombre o se borro se acepta con el nombre que tenia.
--   - Cada manual es un entero de 0 en adelante (vacio = 0), al menos uno mayor
--     que 0. CANTIDAD es la SUMA de los siete: la calcula el paquete.
--   - Dos lineas del mismo envio no pueden ir a la misma ciudad Y sucursal.
--   - COMENTARIO (lo agrego Jose el 13/10/2026): opcional, hasta 2000
--     caracteres. Si la tabla o su _JN no lo tienen, la seccion 2 lo suma.
--
--   Guardar compara con lo que hay: UPDATE de las lineas que cambiaron, INSERT
--   de las nuevas, DELETE de las que ya no vienen (como transferencias.sql),
--   asi la bitacora muestra el cambio real. Todo en UNA transaccion.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /envios-graficas
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON
SET DEFINE OFF

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n   PLS_INTEGER;
  l_cab PLS_INTEGER;
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

  FOR t IN (SELECT 'DEPARTAMENTOS' AS nombre FROM dual
            UNION ALL SELECT 'CIUDADES' FROM dual
            UNION ALL SELECT 'SUCURSALES' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;

  -- La estructura vieja de ENVIOS_GRAFICAS (sin cabecera). Ver el encabezado.
  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'ENVIOS_GRAFICAS';
  SELECT COUNT(*) INTO l_cab FROM user_tab_columns
   WHERE table_name = 'ENVIOS_GRAFICAS' AND column_name = 'ID_CABECERA';
  IF l_n > 0 AND l_cab = 0 THEN
    SELECT COUNT(*) INTO l_n FROM envios_graficas;
    DBMS_OUTPUT.PUT_LINE('[ERROR] ENVIOS_GRAFICAS tiene la estructura VIEJA (sin ID_CABECERA), con '
                         || l_n || ' fila(s).');
    DBMS_OUTPUT.PUT_LINE('        Recreala con el DDL nuevo (cabecera y detalle) y volve a correr');
    DBMS_OUTPUT.PUT_LINE('        este script. No se migra sola.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) ESTRUCTURA: tablas, bitacoras y secuencia (si faltan) ==============
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;

  PROCEDURE ejecutar(p_sql IN VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  END ejecutar;

  FUNCTION existe(p_tabla IN VARCHAR2) RETURN BOOLEAN IS
    l_c PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO l_c FROM user_tables WHERE table_name = p_tabla;
    IF l_c > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[SKIP] La tabla ' || p_tabla || ' ya existia.');
    END IF;
    RETURN l_c > 0;
  END existe;
BEGIN
  -- La cabecera, como la paso Jose.
  IF NOT existe('ENVIOS_CABECERA') THEN
    ejecutar(q'~
      CREATE TABLE "ENVIOS_CABECERA" (
        "ID_CABECERA" NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY
                      MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1
                      START WITH 1 CACHE 20 NOORDER NOCYCLE NOKEEP NOSCALE NOT NULL ENABLE,
        "NOMBRE_GRAFICA" VARCHAR2(100) NOT NULL ENABLE,
        "FECHA"          DATE DEFAULT SYSDATE NOT NULL ENABLE,
        "ID_AUDITORIA"   NUMBER,
        PRIMARY KEY ("ID_CABECERA") USING INDEX ENABLE
      )~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_CABECERA"."ID_CABECERA" IS 'Identificador autonumérico de la cabecera'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_CABECERA"."NOMBRE_GRAFICA" IS 'Nombre de la gráfica enviada'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_CABECERA"."FECHA" IS 'Fecha del envío'~');
    ejecutar(q'~COMMENT ON TABLE "ENVIOS_CABECERA" IS 'Cabecera de envíos de gráficas: nombre de la gráfica y fecha del envío'~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ENVIOS_CABECERA creada.');
  END IF;

  IF NOT existe('ENVIOS_CABECERA_JN') THEN
    ejecutar(q'~
      CREATE TABLE "ENVIOS_CABECERA_JN" (
        "ID_AUDITORIA"   NUMBER,
        "JN_OPERATION"   CHAR(3) NOT NULL,
        "JN_ORACLE_USER" VARCHAR2(30) NOT NULL,
        "JN_DATETIME"    DATE NOT NULL,
        "JN_NOTES"       VARCHAR2(240),
        "JN_APPLN"       VARCHAR2(35),
        "JN_SESSION"     NUMBER(38),
        "ID_CABECERA"    NUMBER,
        "NOMBRE_GRAFICA" VARCHAR2(100),
        "FECHA"          DATE
      )~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ENVIOS_CABECERA_JN creada.');
  END IF;

  -- El detalle, como lo paso Jose.
  IF NOT existe('ENVIOS_GRAFICAS') THEN
    ejecutar(q'~
      CREATE TABLE "ENVIOS_GRAFICAS" (
        "ID_ENVIO" NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY
                   MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1
                   START WITH 1 CACHE 20 NOORDER NOCYCLE NOKEEP NOSCALE NOT NULL ENABLE,
        "ID_CABECERA"     NUMBER NOT NULL ENABLE,
        "ID_DEPARTAMENTO" NUMBER NOT NULL ENABLE,
        "ID_CIUDAD"       NUMBER NOT NULL ENABLE,
        "SUCURSAL"        VARCHAR2(100) NOT NULL ENABLE,
        "SER"             NUMBER DEFAULT 0,
        "HACER"           NUMBER DEFAULT 0,
        "TENER"           NUMBER DEFAULT 0,
        "CARACTER"        NUMBER DEFAULT 0,
        "VISION"          NUMBER DEFAULT 0,
        "CORAJE"          NUMBER DEFAULT 0,
        "LIDERAZGO"       NUMBER DEFAULT 0,
        "CANTIDAD"        NUMBER DEFAULT 0,
        "ID_AUDITORIA"    NUMBER,
        "COMENTARIO"      VARCHAR2(2000),
        PRIMARY KEY ("ID_ENVIO") USING INDEX ENABLE
      )~');
    ejecutar('ALTER TABLE "ENVIOS_GRAFICAS" ADD CONSTRAINT "FK_ENVIOS_CIUDAD" '
             || 'FOREIGN KEY ("ID_CIUDAD") REFERENCES "CIUDADES" ("ID_CIUDAD") ENABLE');
    ejecutar('ALTER TABLE "ENVIOS_GRAFICAS" ADD CONSTRAINT "FK_ENVIOS_DEP" '
             || 'FOREIGN KEY ("ID_DEPARTAMENTO") REFERENCES "DEPARTAMENTOS" ("ID_DEPARTAMENTO") ENABLE');
    ejecutar('ALTER TABLE "ENVIOS_GRAFICAS" ADD CONSTRAINT "FK_ENVIOS_GRAFICAS_CAB" '
             || 'FOREIGN KEY ("ID_CABECERA") REFERENCES "ENVIOS_CABECERA" ("ID_CABECERA") ENABLE');

    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."ID_ENVIO" IS 'Identificador autonumérico del detalle de envío'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."ID_CABECERA" IS 'Referencia a la cabecera del envío'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."ID_DEPARTAMENTO" IS 'Identificador del departamento'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."ID_CIUDAD" IS 'Identificador de la ciudad'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."SUCURSAL" IS 'Nombre de la sucursal destino'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."SER" IS 'Cantidad del manual Ser'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."HACER" IS 'Cantidad del manual Hacer'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."TENER" IS 'Cantidad del manual Tener'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."CARACTER" IS 'Cantidad del manual Carácter'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."VISION" IS 'Cantidad del manual Visión'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."CORAJE" IS 'Cantidad del manual Coraje'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."LIDERAZGO" IS 'Cantidad del manual Liderazgo'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."CANTIDAD" IS 'Cantidad total de gráficas enviadas'~');
    ejecutar(q'~COMMENT ON COLUMN "ENVIOS_GRAFICAS"."COMENTARIO" IS 'OBSERVACION O COMENTARIO DEL REGISTROS'~');
    ejecutar(q'~COMMENT ON TABLE "ENVIOS_GRAFICAS" IS 'Detalle de envíos de gráficas por departamento, ciudad y sucursal, con cantidad por manual'~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ENVIOS_GRAFICAS creada.');
  END IF;

  IF NOT existe('ENVIOS_GRAFICAS_JN') THEN
    ejecutar(q'~
      CREATE TABLE "ENVIOS_GRAFICAS_JN" (
        "ID_AUDITORIA"    NUMBER,
        "JN_OPERATION"    CHAR(3) NOT NULL,
        "JN_ORACLE_USER"  VARCHAR2(30) NOT NULL,
        "JN_DATETIME"     DATE NOT NULL,
        "JN_NOTES"        VARCHAR2(240),
        "JN_APPLN"        VARCHAR2(35),
        "JN_SESSION"      NUMBER(38),
        "ID_ENVIO"        NUMBER,
        "ID_CABECERA"     NUMBER,
        "ID_DEPARTAMENTO" NUMBER,
        "ID_CIUDAD"       NUMBER,
        "SUCURSAL"        VARCHAR2(100),
        "SER"             NUMBER,
        "HACER"           NUMBER,
        "TENER"           NUMBER,
        "CARACTER"        NUMBER,
        "VISION"          NUMBER,
        "CORAJE"          NUMBER,
        "LIDERAZGO"       NUMBER,
        "CANTIDAD"        NUMBER,
        "COMENTARIO"      VARCHAR2(2000)
      )~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ENVIOS_GRAFICAS_JN creada.');
  END IF;

  -- Columnas que llegaron despues (13/10/2026): se SUMAN si faltan, nunca se
  -- quita nada. ID_CABECERA en la bitacora de la primera version, y COMENTARIO
  -- (el que agrego Jose) en la tabla y en su bitacora.
  FOR c IN (SELECT 'ENVIOS_GRAFICAS_JN' AS tabla, 'ID_CABECERA' AS columna, 'NUMBER' AS tipo FROM dual
            UNION ALL SELECT 'ENVIOS_GRAFICAS', 'COMENTARIO', 'VARCHAR2(2000)' FROM dual
            UNION ALL SELECT 'ENVIOS_GRAFICAS_JN', 'COMENTARIO', 'VARCHAR2(2000)' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tab_columns
     WHERE table_name = c.tabla AND column_name = c.columna;
    IF l_n = 0 THEN
      ejecutar('ALTER TABLE "' || c.tabla || '" ADD ("' || c.columna || '" ' || c.tipo || ')');
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || c.tabla || ': agregada la columna ' || c.columna || '.');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_sequences WHERE sequence_name = 'SEQ_AUDITORIA';
  IF l_n = 0 THEN
    ejecutar('CREATE SEQUENCE SEQ_AUDITORIA START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE');
    DBMS_OUTPUT.PUT_LINE('[OK]   Secuencia SEQ_AUDITORIA creada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   SEQ_AUDITORIA encontrada.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Estructura: ' || SQLERRM);
    RAISE;
END;
/

--------------------------------------------------------------------------------
-- === 3) TRIGGERS DE BITACORA (con el usuario de la app, ver encabezado) ====
--------------------------------------------------------------------------------

CREATE OR REPLACE EDITIONABLE TRIGGER "ENVIOS_CABECERA_JNTRG"
BEFORE INSERT OR UPDATE OR DELETE ON envios_cabecera
FOR EACH ROW
DECLARE
  v_audit_id  NUMBER;
  -- Quien uso la app, no el esquema. Ver el encabezado.
  v_usuario   VARCHAR2(30) :=
    SUBSTR(NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER'), USER)), 1, 30);
  -- INSERTING no se puede usar dentro del INSERT (es un booleano de PL/SQL).
  v_operacion CHAR(3);
BEGIN
  IF INSERTING THEN
    v_operacion := 'INS';
    IF :NEW.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO :NEW.ID_AUDITORIA FROM dual;
    END IF;
    v_audit_id := :NEW.ID_AUDITORIA;
  ELSIF UPDATING THEN
    v_operacion := 'UPD';
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
      :NEW.ID_AUDITORIA := v_audit_id;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  ELSE
    -- SIN asignar :NEW: en un DELETE no hay fila nueva (ORA-04084).
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  END IF;

  IF INSERTING OR UPDATING THEN
    INSERT INTO envios_cabecera_jn (
      ID_AUDITORIA, ID_CABECERA, NOMBRE_GRAFICA, FECHA,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_CABECERA, :NEW.NOMBRE_GRAFICA, :NEW.FECHA,
      v_operacion, v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSE
    INSERT INTO envios_cabecera_jn (
      ID_AUDITORIA, ID_CABECERA, NOMBRE_GRAFICA, FECHA,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :OLD.ID_CABECERA, :OLD.NOMBRE_GRAFICA, :OLD.FECHA,
      'DEL', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  END IF;
END;
/

ALTER TRIGGER "ENVIOS_CABECERA_JNTRG" ENABLE;

CREATE OR REPLACE EDITIONABLE TRIGGER "ENVIOS_GRAFICAS_JNTRG"
BEFORE INSERT OR UPDATE OR DELETE ON envios_graficas
FOR EACH ROW
DECLARE
  v_audit_id  NUMBER;
  v_usuario   VARCHAR2(30) :=
    SUBSTR(NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER'), USER)), 1, 30);
  v_operacion CHAR(3);
BEGIN
  IF INSERTING THEN
    v_operacion := 'INS';
    IF :NEW.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO :NEW.ID_AUDITORIA FROM dual;
    END IF;
    v_audit_id := :NEW.ID_AUDITORIA;
  ELSIF UPDATING THEN
    v_operacion := 'UPD';
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
      :NEW.ID_AUDITORIA := v_audit_id;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  ELSE
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  END IF;

  IF INSERTING OR UPDATING THEN
    INSERT INTO envios_graficas_jn (
      ID_AUDITORIA, ID_ENVIO, ID_CABECERA, ID_DEPARTAMENTO, ID_CIUDAD, SUCURSAL,
      SER, HACER, TENER, CARACTER, VISION, CORAJE, LIDERAZGO, CANTIDAD, COMENTARIO,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_ENVIO, :NEW.ID_CABECERA, :NEW.ID_DEPARTAMENTO, :NEW.ID_CIUDAD,
      :NEW.SUCURSAL, :NEW.SER, :NEW.HACER, :NEW.TENER, :NEW.CARACTER, :NEW.VISION,
      :NEW.CORAJE, :NEW.LIDERAZGO, :NEW.CANTIDAD, :NEW.COMENTARIO,
      v_operacion, v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSE
    INSERT INTO envios_graficas_jn (
      ID_AUDITORIA, ID_ENVIO, ID_CABECERA, ID_DEPARTAMENTO, ID_CIUDAD, SUCURSAL,
      SER, HACER, TENER, CARACTER, VISION, CORAJE, LIDERAZGO, CANTIDAD, COMENTARIO,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :OLD.ID_ENVIO, :OLD.ID_CABECERA, :OLD.ID_DEPARTAMENTO, :OLD.ID_CIUDAD,
      :OLD.SUCURSAL, :OLD.SER, :OLD.HACER, :OLD.TENER, :OLD.CARACTER, :OLD.VISION,
      :OLD.CORAJE, :OLD.LIDERAZGO, :OLD.CANTIDAD, :OLD.COMENTARIO,
      'DEL', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  END IF;
END;
/

ALTER TRIGGER "ENVIOS_GRAFICAS_JNTRG" ENABLE;

--------------------------------------------------------------------------------
-- === 4) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_ENVIOS_GRAFICAS_ETHOS AS

  -- Todos los envios con sus lineas, del mas nuevo al mas viejo, + catalogos.
  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta. p_detalle: el JSON de las lineas (ver el encabezado).
  PROCEDURE guardar(
    p_token   IN VARCHAR2,
    p_id      IN VARCHAR2,
    p_grafica IN VARCHAR2,
    p_fecha   IN VARCHAR2,
    p_detalle IN CLOB);

  -- El envio con todas sus lineas.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_ENVIOS_GRAFICAS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_ENVIOS_GRAFICAS_ETHOS AS

  c_ruta  CONSTANT VARCHAR2(30) := '/envios-graficas';
  c_largo CONSTANT PLS_INTEGER  := 100;
  -- ENVIOS_GRAFICAS.COMENTARIO (13/10/2026).
  c_largo_coment CONSTANT PLS_INTEGER := 2000;
  -- Tope por manual: un numero de mas por error de tipeo no tiene que pasar.
  c_tope  CONSTANT NUMBER       := 9999999;

  -- Un dato que no sirve: g_msg dice cual. Lo responde `guardar` con un 400.
  e_dato EXCEPTION;
  g_msg  VARCHAR2(4000);

  TYPE t_cant IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
  TYPE t_linea IS RECORD (
    id       NUMBER,
    dep      NUMBER,
    ciudad   NUMBER,
    sucursal   VARCHAR2(100),
    comentario VARCHAR2(2000),
    cant     t_cant,
    total    NUMBER);
  TYPE t_lineas IS TABLE OF t_linea INDEX BY PLS_INTEGER;

  -- Las columnas de los manuales, en orden: el JSON usa estos nombres.
  TYPE t_nombres IS TABLE OF VARCHAR2(30) INDEX BY PLS_INTEGER;

  FUNCTION manuales RETURN t_nombres IS
    l t_nombres;
  BEGIN
    l(1) := 'ser';      l(2) := 'hacer';  l(3) := 'tener'; l(4) := 'caracter';
    l(5) := 'vision';   l(6) := 'coraje'; l(7) := 'liderazgo';
    RETURN l;
  END manuales;

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
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'El departamento, la ciudad o el envio ya no existen');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'La grafica y la sucursal no pueden pasar de '
                || c_largo || ' caracteres');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'Un trigger de bitacora de envios no esta corregido. Volve a correr '
                || 'backend/envios_graficas.sql.');
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

  -- Una cantidad: vacio = 0; entero de 0 a c_tope; -1 si no sirve.
  FUNCTION f_cantidad(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    IF TRIM(p_valor) IS NULL THEN RETURN 0; END IF;
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n BETWEEN 0 AND c_tope AND l_n = TRUNC(l_n) THEN l_n ELSE -1 END;
  EXCEPTION
    WHEN OTHERS THEN RETURN -1;
  END f_cantidad;

  -- 'YYYY-MM-DD' (o con hora atras), o NULL si no es una fecha.
  FUNCTION f_fecha(p_valor IN VARCHAR2) RETURN DATE IS
  BEGIN
    RETURN TO_DATE(SUBSTR(TRIM(p_valor), 1, 10), 'YYYY-MM-DD');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_fecha;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' la accion en la
  -- pagina de /envios-graficas. FALSE = ya respondio el error.
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
      IF l_pagina IS NULL THEN
        -- Pantalla nueva: hasta que se la da de alta nadie tiene permisos.
        p_error(403, 'Forbidden', 'La pantalla ' || c_ruta || ' todavia no esta en el menu: '
                || 'hay que darla de alta en Crear paginas y darle permisos');
        RETURN FALSE;
      END IF;
      IF PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para '
          || CASE p_accion WHEN 'I' THEN 'agregar'
                           WHEN 'U' THEN 'modificar'
                           ELSE 'eliminar' END
          || ' envios de graficas');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo', c_largo);
    APEX_JSON.WRITE('largo_comentario', c_largo_coment);

    APEX_JSON.OPEN_ARRAY('data');
    -- Alta y ultimo cambio salen de la bitacora de la cabecera, en hora de
    -- Paraguay. El usuario del alta es el de la fila INS; el del cambio, el de
    -- la ultima UPD (guardar siempre toca la cabecera: ver el encabezado).
    FOR c IN (SELECT cab.id_cabecera, cab.nombre_grafica,
                     TO_CHAR(cab.fecha, 'YYYY-MM-DD') AS fecha,
                     TO_CHAR(b.alta - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS cargado_el,
                     CASE WHEN b.alta IS NOT NULL THEN b.alta_por END AS cargado_por,
                     TO_CHAR(b.cambio - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS modificado_el,
                     CASE WHEN b.cambio IS NOT NULL THEN b.cambio_por END AS modificado_por
                FROM envios_cabecera cab
                LEFT JOIN (
                  SELECT j.id_auditoria,
                         MIN(CASE WHEN j.jn_operation = 'INS' THEN j.jn_datetime END) AS alta,
                         MIN(j.jn_oracle_user) KEEP (DENSE_RANK FIRST ORDER BY
                           CASE WHEN j.jn_operation = 'INS' THEN 0 ELSE 1 END, j.jn_datetime) AS alta_por,
                         MAX(CASE WHEN j.jn_operation = 'UPD' THEN j.jn_datetime END) AS cambio,
                         MAX(j.jn_oracle_user) KEEP (DENSE_RANK LAST ORDER BY
                           CASE WHEN j.jn_operation = 'UPD' THEN 1 ELSE 0 END, j.jn_datetime) AS cambio_por
                    FROM envios_cabecera_jn j
                   GROUP BY j.id_auditoria
                ) b ON b.id_auditoria = cab.id_auditoria
               ORDER BY cab.fecha DESC, cab.id_cabecera DESC) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_cabecera',    c.id_cabecera);
      APEX_JSON.WRITE('nombre_grafica', c.nombre_grafica);
      APEX_JSON.WRITE('fecha',          c.fecha);
      APEX_JSON.WRITE('cargado_el',     c.cargado_el);
      APEX_JSON.WRITE('cargado_por',    c.cargado_por);
      APEX_JSON.WRITE('modificado_el',  c.modificado_el);
      APEX_JSON.WRITE('modificado_por', c.modificado_por);
      APEX_JSON.OPEN_ARRAY('lineas');
      FOR l IN (SELECT e.id_envio, e.id_departamento, d.nombre AS departamento,
                       e.id_ciudad, ci.nombre AS ciudad, e.sucursal,
                       NVL(e.ser, 0) AS ser, NVL(e.hacer, 0) AS hacer, NVL(e.tener, 0) AS tener,
                       NVL(e.caracter, 0) AS caracter, NVL(e.vision, 0) AS vision,
                       NVL(e.coraje, 0) AS coraje, NVL(e.liderazgo, 0) AS liderazgo,
                       NVL(e.cantidad, 0) AS cantidad, e.comentario
                  FROM envios_graficas e
                  LEFT JOIN departamentos d ON d.id_departamento = e.id_departamento
                  LEFT JOIN ciudades ci ON ci.id_ciudad = e.id_ciudad
                 WHERE e.id_cabecera = c.id_cabecera
                 ORDER BY e.id_envio) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_envio',        l.id_envio);
        APEX_JSON.WRITE('id_departamento', l.id_departamento);
        APEX_JSON.WRITE('departamento',    l.departamento);
        APEX_JSON.WRITE('id_ciudad',       l.id_ciudad);
        APEX_JSON.WRITE('ciudad',          l.ciudad);
        APEX_JSON.WRITE('sucursal',        l.sucursal);
        APEX_JSON.WRITE('ser',             l.ser);
        APEX_JSON.WRITE('hacer',           l.hacer);
        APEX_JSON.WRITE('tener',           l.tener);
        APEX_JSON.WRITE('caracter',        l.caracter);
        APEX_JSON.WRITE('vision',          l.vision);
        APEX_JSON.WRITE('coraje',          l.coraje);
        APEX_JSON.WRITE('liderazgo',       l.liderazgo);
        APEX_JSON.WRITE('cantidad',        l.cantidad);
        APEX_JSON.WRITE('comentario',      l.comentario);
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Los catalogos del formulario, livianos: sin pasar por los listados de
    -- sus pantallas, que cuentan los usos de cada fila.
    APEX_JSON.OPEN_ARRAY('departamentos');
    FOR r IN (SELECT id_departamento, nombre FROM departamentos ORDER BY UPPER(nombre)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_departamento);
      APEX_JSON.WRITE('nombre', r.nombre);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('ciudades');
    FOR r IN (SELECT id_ciudad, id_departamento, nombre FROM ciudades ORDER BY UPPER(nombre)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_ciudad);
      APEX_JSON.WRITE('id_departamento', r.id_departamento);
      APEX_JSON.WRITE('nombre', r.nombre);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('sucursales');
    FOR r IN (SELECT id_sucursal, descripcion FROM sucursales ORDER BY UPPER(descripcion)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id', r.id_sucursal);
      APEX_JSON.WRITE('nombre', r.descripcion);
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

  -- Lee y valida UNA linea del JSON (la i). Responde con e_dato + g_msg.
  FUNCTION leer_linea(
    p_v      IN APEX_JSON.T_VALUES,
    i        IN PLS_INTEGER,
    p_id_cab IN NUMBER) RETURN t_linea
  IS
    l        t_linea;
    l_nom    t_nombres := manuales();
    l_que    VARCHAR2(30) := 'El destino ' || i;
    l_texto  VARCHAR2(32767);
    l_dep_c  NUMBER;
    l_ciu    ciudades.nombre%TYPE;
    l_depn   departamentos.nombre%TYPE;
    l_antes  envios_graficas.sucursal%TYPE;
    l_cab    NUMBER;
  BEGIN
    l.id     := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'lineas[%d].id_envio', p0 => i, p_values => p_v));
    l.dep    := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'lineas[%d].id_departamento', p0 => i, p_values => p_v));
    l.ciudad := f_numero(APEX_JSON.GET_VARCHAR2(p_path => 'lineas[%d].id_ciudad', p0 => i, p_values => p_v));
    l_texto  := TRIM(REGEXP_REPLACE(
                  APEX_JSON.GET_VARCHAR2(p_path => 'lineas[%d].sucursal', p0 => i, p_values => p_v),
                  '\s+', ' '));

    -- Una linea que dice existir tiene que ser de ESTE envio.
    IF l.id IS NOT NULL THEN
      BEGIN
        SELECT id_cabecera, sucursal INTO l_cab, l_antes FROM envios_graficas WHERE id_envio = l.id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN l_cab := NULL;
      END;
      IF p_id_cab IS NULL OR l_cab IS NULL OR l_cab <> p_id_cab THEN
        g_msg := l_que || ' no es de este envio (id ' || l.id || ')'; RAISE e_dato;
      END IF;
    END IF;

    -- Departamento y ciudad: los dos, y la ciudad de ese departamento.
    IF l.dep IS NULL OR l.ciudad IS NULL THEN
      g_msg := l_que || ': elegi el departamento y la ciudad'; RAISE e_dato;
    END IF;
    BEGIN
      SELECT nombre INTO l_depn FROM departamentos WHERE id_departamento = l.dep;
      SELECT id_departamento, nombre INTO l_dep_c, l_ciu FROM ciudades WHERE id_ciudad = l.ciudad;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        g_msg := l_que || ': el departamento o la ciudad no existen'; RAISE e_dato;
    END;
    IF l_dep_c IS NULL OR l_dep_c <> l.dep THEN
      g_msg := l_que || ': ' || l_ciu || ' no es del departamento ' || l_depn; RAISE e_dato;
    END IF;

    -- Sucursal: una de SUCURSALES, con su grafia; o la que ya tenia la linea.
    IF l_texto IS NULL THEN
      g_msg := l_que || ': elegi la sucursal'; RAISE e_dato;
    END IF;
    BEGIN
      SELECT descripcion INTO l.sucursal FROM sucursales
       WHERE UPPER(TRIM(REGEXP_REPLACE(descripcion, '\s+', ' '))) = UPPER(l_texto)
         AND ROWNUM = 1;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        IF l_antes IS NULL OR UPPER(TRIM(l_antes)) <> UPPER(l_texto) THEN
          g_msg := l_que || ': no existe la sucursal ' || SUBSTR(l_texto, 1, 200); RAISE e_dato;
        END IF;
        l.sucursal := l_antes;
      WHEN VALUE_ERROR THEN
        g_msg := l_que || ': la sucursal no puede pasar de ' || c_largo || ' caracteres';
        RAISE e_dato;
    END;

    -- El comentario: opcional, hasta c_largo_coment. Se recortan los espacios
    -- de las puntas pero se respetan los saltos de linea.
    l_texto := TRIM(APEX_JSON.GET_VARCHAR2(p_path => 'lineas[%d].comentario', p0 => i, p_values => p_v));
    IF LENGTH(l_texto) > c_largo_coment THEN
      g_msg := l_que || ': el comentario no puede pasar de ' || c_largo_coment || ' caracteres';
      RAISE e_dato;
    END IF;
    l.comentario := l_texto;

    -- Los siete manuales, en el orden de las columnas.
    l.total := 0;
    FOR k IN 1 .. 7 LOOP
      l.cant(k) := f_cantidad(APEX_JSON.GET_VARCHAR2(
                     p_path => 'lineas[%d].' || l_nom(k), p0 => i, p_values => p_v));
      IF l.cant(k) < 0 THEN
        g_msg := l_que || ': la cantidad de ' || INITCAP(l_nom(k))
                 || ' tiene que ser un numero entero de 0 a ' || c_tope;
        RAISE e_dato;
      END IF;
      l.total := l.total + l.cant(k);
    END LOOP;
    IF l.total = 0 THEN
      g_msg := l_que || ': carga la cantidad de al menos un manual'; RAISE e_dato;
    END IF;
    RETURN l;
  END leer_linea;

  PROCEDURE guardar(
    p_token   IN VARCHAR2,
    p_id      IN VARCHAR2,
    p_grafica IN VARCHAR2,
    p_fecha   IN VARCHAR2,
    p_detalle IN CLOB)
  IS
    -- 32767: ver materias.sql. El tope real se valida abajo con mensaje.
    l_grafica VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_grafica, '\s+', ' '));
    l_id      NUMBER := f_numero(p_id);
    l_fecha   DATE   := f_fecha(p_fecha);
    l_texto   VARCHAR2(4000);
    l_n       PLS_INTEGER;
    v         APEX_JSON.T_VALUES;
    l_lineas  t_lineas;
    l_quedan  APEX_T_NUMBER := APEX_T_NUMBER();
    l_nuevo   NUMBER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de envio invalido'); RETURN;
    END IF;
    IF l_id IS NOT NULL THEN
      SELECT COUNT(*) INTO l_n FROM envios_cabecera WHERE id_cabecera = l_id;
      IF l_n = 0 THEN
        p_error(404, 'Not Found', 'El envio no existe'); RETURN;
      END IF;
    END IF;

    -- Cabecera: grafica (con la grafia que ya tenga) y fecha.
    IF l_grafica IS NULL THEN
      p_error(400, 'Bad Request', 'La grafica es obligatoria'); RETURN;
    END IF;
    IF LENGTH(l_grafica) > c_largo THEN
      p_error(400, 'Bad Request', 'La grafica no puede pasar de ' || c_largo || ' caracteres');
      RETURN;
    END IF;
    BEGIN
      SELECT nombre_grafica INTO l_texto FROM envios_cabecera
       WHERE UPPER(TRIM(REGEXP_REPLACE(nombre_grafica, '\s+', ' '))) = UPPER(l_grafica)
         AND ROWNUM = 1;
      l_grafica := l_texto;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;
    IF l_fecha IS NULL THEN
      p_error(400, 'Bad Request', 'La fecha es obligatoria'); RETURN;
    END IF;

    -- El detalle: todo validado ANTES de tocar nada.
    BEGIN
      APEX_JSON.PARSE(v, p_detalle);
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'El detalle no es un JSON valido'); RETURN;
    END;
    l_n := NVL(APEX_JSON.GET_COUNT(p_path => 'lineas', p_values => v), 0);
    IF l_n = 0 THEN
      p_error(400, 'Bad Request', 'Agrega al menos un destino'); RETURN;
    END IF;
    BEGIN
      FOR i IN 1 .. l_n LOOP
        l_lineas(i) := leer_linea(v, i, l_id);
        FOR k IN 1 .. i - 1 LOOP
          IF l_lineas(k).ciudad = l_lineas(i).ciudad
             AND UPPER(l_lineas(k).sucursal) = UPPER(l_lineas(i).sucursal) THEN
            g_msg := 'Los destinos ' || k || ' y ' || i
                     || ' van a la misma ciudad y sucursal: juntalos en uno';
            RAISE e_dato;
          END IF;
          IF l_lineas(i).id IS NOT NULL AND l_lineas(k).id = l_lineas(i).id THEN
            g_msg := 'El destino ' || i || ' esta repetido'; RAISE e_dato;
          END IF;
        END LOOP;
      END LOOP;
    EXCEPTION
      WHEN e_dato THEN
        p_error(400, 'Bad Request', g_msg); RETURN;
    END;

    -- Cabecera. Al modificar se actualiza SIEMPRE, aunque no cambie: asi el
    -- "modificado el / por" de la bitacora cuenta tambien los cambios de lineas.
    IF l_id IS NULL THEN
      INSERT INTO envios_cabecera (nombre_grafica, fecha)
      VALUES (l_grafica, l_fecha)
      RETURNING id_cabecera INTO l_id;
    ELSE
      UPDATE envios_cabecera SET nombre_grafica = l_grafica, fecha = l_fecha
       WHERE id_cabecera = l_id;
    END IF;

    -- Lineas: UPDATE de las que cambiaron, INSERT de las nuevas...
    FOR i IN 1 .. l_n LOOP
      IF l_lineas(i).id IS NULL THEN
        INSERT INTO envios_graficas (
          id_cabecera, id_departamento, id_ciudad, sucursal,
          ser, hacer, tener, caracter, vision, coraje, liderazgo, cantidad, comentario)
        VALUES (
          l_id, l_lineas(i).dep, l_lineas(i).ciudad, l_lineas(i).sucursal,
          l_lineas(i).cant(1), l_lineas(i).cant(2), l_lineas(i).cant(3), l_lineas(i).cant(4),
          l_lineas(i).cant(5), l_lineas(i).cant(6), l_lineas(i).cant(7), l_lineas(i).total,
          l_lineas(i).comentario)
        RETURNING id_envio INTO l_nuevo;
        l_lineas(i).id := l_nuevo;
      ELSE
        UPDATE envios_graficas
           SET id_departamento = l_lineas(i).dep, id_ciudad = l_lineas(i).ciudad,
               sucursal = l_lineas(i).sucursal,
               ser = l_lineas(i).cant(1), hacer = l_lineas(i).cant(2),
               tener = l_lineas(i).cant(3), caracter = l_lineas(i).cant(4),
               vision = l_lineas(i).cant(5), coraje = l_lineas(i).cant(6),
               liderazgo = l_lineas(i).cant(7), cantidad = l_lineas(i).total,
               comentario = l_lineas(i).comentario
         WHERE id_envio = l_lineas(i).id
           AND (id_departamento <> l_lineas(i).dep OR id_ciudad <> l_lineas(i).ciudad
                OR sucursal <> l_lineas(i).sucursal
                OR NVL(ser, 0) <> l_lineas(i).cant(1) OR NVL(hacer, 0) <> l_lineas(i).cant(2)
                OR NVL(tener, 0) <> l_lineas(i).cant(3) OR NVL(caracter, 0) <> l_lineas(i).cant(4)
                OR NVL(vision, 0) <> l_lineas(i).cant(5) OR NVL(coraje, 0) <> l_lineas(i).cant(6)
                OR NVL(liderazgo, 0) <> l_lineas(i).cant(7)
                OR NVL(cantidad, 0) <> l_lineas(i).total
                OR NVL(comentario, CHR(0)) <> NVL(l_lineas(i).comentario, CHR(0)));
      END IF;
      l_quedan.EXTEND;
      l_quedan(l_quedan.COUNT) := l_lineas(i).id;
    END LOOP;

    -- ... y DELETE de las que ya no vienen.
    DELETE FROM envios_graficas
     WHERE id_cabecera = l_id
       AND id_envio NOT IN (SELECT COLUMN_VALUE FROM TABLE(l_quedan));
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_cabecera', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Envio registrado' ELSE 'Envio actualizado' END);
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
      p_error(400, 'Bad Request', 'Id de envio invalido'); RETURN;
    END IF;

    -- Primero las lineas (FK a la cabecera), en la misma transaccion.
    DELETE FROM envios_graficas WHERE id_cabecera = l_id;
    DELETE FROM envios_cabecera WHERE id_cabecera = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'El envio no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Envio eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_ENVIOS_GRAFICAS_ETHOS;
/

--------------------------------------------------------------------------------
-- === 5) ENDPOINTS ORDS ======================================================
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

  -- El cuerpo de POST y PUT, igual salvo el id.
  c_campos CONSTANT VARCHAR2(300) := '
        p_grafica => :nombre_grafica, p_fecha => :fecha, p_detalle => :detalle);';

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
  FOR r IN (SELECT 'envios-graficas' AS p FROM dual
            UNION ALL SELECT 'envios-graficas/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'envios-graficas',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'envios-graficas/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('envios-graficas', 'GET', '
    PKG_ENVIOS_GRAFICAS_ETHOS.LISTAR(p_token => l_token);');

  handler('envios-graficas', 'POST', '
    PKG_ENVIOS_GRAFICAS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('envios-graficas/:id', 'PUT', '
    PKG_ENVIOS_GRAFICAS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('envios-graficas/:id', 'DELETE', '
    PKG_ENVIOS_GRAFICAS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de envios-graficas publicados.');
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
  preflight('envios-graficas');
  preflight('envios-graficas/:id');
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
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
  l_pagina NUMBER;
BEGIN
  FOR o IN (SELECT 'ENVIOS_CABECERA_JNTRG' AS nombre, 'TRIGGER' AS tipo FROM dual
            UNION ALL SELECT 'ENVIOS_GRAFICAS_JNTRG', 'TRIGGER' FROM dual
            UNION ALL SELECT 'PKG_ENVIOS_GRAFICAS_ETHOS', 'PACKAGE BODY' FROM dual) LOOP
    BEGIN
      SELECT status INTO l_estado FROM user_objects
       WHERE object_name = o.nombre AND object_type = o.tipo;
      IF l_estado = 'VALID' THEN
        DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' compilado.');
      ELSE
        DBMS_OUTPUT.PUT_LINE('[ERROR] ' || o.nombre || ' quedo INVALID.');
        FOR e IN (SELECT line, text FROM user_errors
                   WHERE name = o.nombre ORDER BY type, sequence) LOOP
          DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
        END LOOP;
      END IF;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('[ERROR] ' || o.nombre || ' no se creo.');
    END;
  END LOOP;

  DBMS_OUTPUT.PUT_LINE('       GET    envios-graficas');
  DBMS_OUTPUT.PUT_LINE('       POST   envios-graficas');
  DBMS_OUTPUT.PUT_LINE('       PUT    envios-graficas/:id');
  DBMS_OUTPUT.PUT_LINE('       DELETE envios-graficas/:id');

  BEGIN
    l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta('/envios-graficas');
  EXCEPTION
    WHEN OTHERS THEN l_pagina := NULL;
  END;
  IF l_pagina IS NULL THEN
    DBMS_OUTPUT.PUT_LINE('[INFO] /envios-graficas todavia no esta en MENU_PAGINAS: darla de alta');
    DBMS_OUTPUT.PUT_LINE('       en Crear paginas (Operaciones) y darle permisos en Roles de paginas.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   /envios-graficas es la pagina ' || l_pagina || ' del menu.');
  END IF;
END;
/
