--------------------------------------------------------------------------------
-- FACILITADORES_DIAS_BLOQUEOS  —  Horarios bloqueados de cada facilitador
--------------------------------------------------------------------------------
--
-- Tabla NUEVA (14/10/2026), no viene de APEX. En el sitio es un MODAL de la
-- pantalla de Facilitadores (/facilitadores, la pagina 14): se abre por
-- facilitador, desde su tarjeta del listado o desde su ficha. NO es una pagina
-- del menu y NO controla permisos (decision de Jose, 14/10/2026): quien entra a
-- Facilitadores ya puede usarlo entero. Ver PERMISOS.
--
-- Cada fila: un facilitador, un anio lectivo y, por dia (LUNES a VIERNES), las
-- franjas en las que NO esta disponible.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     facilitadores-bloqueos       todos los bloqueos (de todos los
--                                        facilitadores y anios), con quien y
--                                        cuando se cargaron, + los anios
--                                        lectivos para elegir + id_anio_actual
--   POST    facilitadores-bloqueos       {id_facilitador, id_anio, lunes,
--                                         martes, miercoles, jueves, viernes}
--                                        -> {id_bloqueo}. Sin id_anio: el
--                                        actual
--   PUT     facilitadores-bloqueos/:id   {lunes ... viernes}
--   DELETE  facilitadores-bloqueos/:id
--
-- CORRER DESPUES de auth.sql, anios_lectivos.sql y facilitadores.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EL FORMATO DE CADA DIA
--------------------------------------------------------------------------------
--
-- El comentario de la columna dice "HH:MI - HH:MI (ej. 07:00 - 08:00)". Un dia
-- puede tener VARIAS franjas: van separadas por coma y espacio, en orden de
-- hora:
--
--     07:00 - 08:00, 13:30 - 15:00
--
-- El paquete NORMALIZA lo que llega (acepta "7:00-8:00", espacios de mas, el
-- orden que sea) y lo guarda siempre asi. Rechaza con 400: una franja que no
-- es HH:MI - HH:MI, una hora que no existe, una que termina antes de empezar,
-- dos que se pisan, o un dia que no entra en los 100 caracteres de la columna
-- (unas 6 franjas). Vacio = ese dia esta libre.
--
--------------------------------------------------------------------------------
-- EL ANIO ACTUAL: FN_ANIO_LECTIVO_ACTUAL()
--------------------------------------------------------------------------------
--
-- "El actual" lo decide FN_ANIO_LECTIVO_ACTUAL() (anios_lectivos.sql): el ANIO
-- de ANIOS_LECTIVOS con UPPER(TRIM(ESTADO)) = 'A', el mas alto si hubiera dos.
-- Es el mismo criterio de horarios, pre-horarios y postulaciones. Como esta
-- tabla guarda ID_ANIO, f_id_anio_actual busca el id de ese anio. El GET lo
-- devuelve en `id_anio_actual` (y `vigente` en la lista de anios), y es el
-- anio con que abre el modal; un POST sin id_anio va a ese anio. Sin anio
-- activo, NULL: el modal abre en el mas nuevo y el POST pide elegir uno.
--
--------------------------------------------------------------------------------
-- REGLAS
--------------------------------------------------------------------------------
--
--   - UNA fila por facilitador y anio: la tabla no lo exige (no tiene UNIQUE),
--     el paquete si. Un POST de un facilitador y anio que ya tienen fila
--     responde 409. La verificacion final avisa si ya habia repetidos.
--   - Al menos una franja en algun dia: para dejarlo sin bloqueos se elimina
--     la fila.
--   - PUT cambia solo los dias: el facilitador y el anio son los de la fila.
--   - Los dias que no cambiaron no se tocan: si no cambia nada, no hay UPDATE
--     (asi la bitacora muestra solo los cambios reales).
--
--------------------------------------------------------------------------------
-- EL TRIGGER (seccion 3): EL MISMO, CON EL USUARIO DE LA APP
--------------------------------------------------------------------------------
--
-- FACILITADORES_DIAS_BLOQUEOS_JNTRG es el que vino con la tabla, con UN cambio:
-- JN_ORACLE_USER era NVL(V('APP_USER'), USER), y desde ORDS eso es el esquema.
-- Ahora cae a CLIENT_IDENTIFIER, que PKG_AUTH_ETHOS.VALIDAR_TOKEN deja con el
-- usuario del token (como envios_graficas.sql). En un UPD sigue guardando :NEW.
-- "Cargado / modificado el ... por ..." salen de esa bitacora, en hora de
-- Paraguay (JN_DATETIME es UTC: - 3/24).
--
--------------------------------------------------------------------------------
-- PERMISOS: SOLO SESION
--------------------------------------------------------------------------------
--
--   Los cuatro metodos piden solo un token valido, sin mirar ROLES_PAGINAS
--   (pedido de Jose, 14/10/2026): el que tiene habilitada la pantalla de
--   Facilitadores ya tiene acceso al modal, y el modal no tiene permisos
--   propios. El menu es el que decide quien llega a la pantalla.
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
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'PACKAGE BODY' AS tipo,
                   'backend/auth.sql' AS script FROM dual
            UNION ALL SELECT 'FN_ANIO_LECTIVO_ACTUAL', 'FUNCTION',
                   'backend/anios_lectivos.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = o.tipo;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  FOR t IN (SELECT 'FACILITADORES' AS nombre FROM dual
            UNION ALL SELECT 'ANIOS_LECTIVOS' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) ESTRUCTURA: tabla, bitacora y secuencia (si faltan) ================
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
  -- La tabla, como la paso Jose el 14/10/2026.
  IF NOT existe('FACILITADORES_DIAS_BLOQUEOS') THEN
    ejecutar(q'~
      CREATE TABLE "FACILITADORES_DIAS_BLOQUEOS" (
        "ID_BLOQUEO" NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY
                     MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1
                     START WITH 1 CACHE 20 NOORDER NOCYCLE NOKEEP NOSCALE NOT NULL ENABLE,
        "ID_FACILITADOR" NUMBER NOT NULL ENABLE,
        "ID_ANIO"        NUMBER NOT NULL ENABLE,
        "LUNES"          VARCHAR2(100),
        "MARTES"         VARCHAR2(100),
        "MIERCOLES"      VARCHAR2(100),
        "JUEVES"         VARCHAR2(100),
        "VIERNES"        VARCHAR2(100),
        "ID_AUDITORIA"   NUMBER,
        PRIMARY KEY ("ID_BLOQUEO") USING INDEX ENABLE
      )~');
    ejecutar('ALTER TABLE "FACILITADORES_DIAS_BLOQUEOS" ADD CONSTRAINT "FK_FAC_BLOQ_ANIO" '
             || 'FOREIGN KEY ("ID_ANIO") REFERENCES "ANIOS_LECTIVOS" ("ID_ANIO") ENABLE');
    ejecutar('ALTER TABLE "FACILITADORES_DIAS_BLOQUEOS" ADD CONSTRAINT "FK_FAC_BLOQ_FACILITADOR" '
             || 'FOREIGN KEY ("ID_FACILITADOR") REFERENCES "FACILITADORES" ("ID_FACILITADOR") ENABLE');

    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."ID_BLOQUEO" IS 'Identificador autonumérico del bloqueo'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."ID_FACILITADOR" IS 'Referencia al facilitador bloqueado'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."ID_ANIO" IS 'Referencia al año lectivo del bloqueo'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."LUNES" IS 'Franjas no disponibles el lunes, formato HH:MI - HH:MI (ej. 07:00 - 08:00)'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."MARTES" IS 'Franjas no disponibles el martes, formato HH:MI - HH:MI (ej. 07:00 - 08:00)'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."MIERCOLES" IS 'Franjas no disponibles el miércoles, formato HH:MI - HH:MI (ej. 07:00 - 08:00)'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."JUEVES" IS 'Franjas no disponibles el jueves, formato HH:MI - HH:MI (ej. 07:00 - 08:00)'~');
    ejecutar(q'~COMMENT ON COLUMN "FACILITADORES_DIAS_BLOQUEOS"."VIERNES" IS 'Franjas no disponibles el viernes, formato HH:MI - HH:MI (ej. 07:00 - 08:00)'~');
    ejecutar(q'~COMMENT ON TABLE "FACILITADORES_DIAS_BLOQUEOS" IS 'Bloqueos de disponibilidad de los facilitadores por día de la semana y año lectivo'~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FACILITADORES_DIAS_BLOQUEOS creada.');
  END IF;

  -- La bitacora: las columnas JN_* de pr_crear_trigger_auditoria + las de la tabla.
  IF NOT existe('FACILITADORES_DIAS_BLOQUEOS_JN') THEN
    ejecutar(q'~
      CREATE TABLE "FACILITADORES_DIAS_BLOQUEOS_JN" (
        "ID_AUDITORIA"   NUMBER,
        "JN_OPERATION"   CHAR(3) NOT NULL,
        "JN_ORACLE_USER" VARCHAR2(30) NOT NULL,
        "JN_DATETIME"    DATE NOT NULL,
        "JN_NOTES"       VARCHAR2(240),
        "JN_APPLN"       VARCHAR2(35),
        "JN_SESSION"     NUMBER(38),
        "ID_BLOQUEO"     NUMBER,
        "ID_FACILITADOR" NUMBER,
        "ID_ANIO"        NUMBER,
        "LUNES"          VARCHAR2(100),
        "MARTES"         VARCHAR2(100),
        "MIERCOLES"      VARCHAR2(100),
        "JUEVES"         VARCHAR2(100),
        "VIERNES"        VARCHAR2(100)
      )~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FACILITADORES_DIAS_BLOQUEOS_JN creada.');
  END IF;

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
-- === 3) TRIGGER DE BITACORA (con el usuario de la app, ver encabezado) =====
--------------------------------------------------------------------------------

CREATE OR REPLACE EDITIONABLE TRIGGER "FACILITADORES_DIAS_BLOQUEOS_JNTRG"
BEFORE INSERT OR UPDATE OR DELETE ON facilitadores_dias_bloqueos
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
    INSERT INTO facilitadores_dias_bloqueos_jn (
      ID_AUDITORIA, ID_BLOQUEO, ID_FACILITADOR, ID_ANIO,
      LUNES, MARTES, MIERCOLES, JUEVES, VIERNES,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_BLOQUEO, :NEW.ID_FACILITADOR, :NEW.ID_ANIO,
      :NEW.LUNES, :NEW.MARTES, :NEW.MIERCOLES, :NEW.JUEVES, :NEW.VIERNES,
      v_operacion, v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSE
    INSERT INTO facilitadores_dias_bloqueos_jn (
      ID_AUDITORIA, ID_BLOQUEO, ID_FACILITADOR, ID_ANIO,
      LUNES, MARTES, MIERCOLES, JUEVES, VIERNES,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :OLD.ID_BLOQUEO, :OLD.ID_FACILITADOR, :OLD.ID_ANIO,
      :OLD.LUNES, :OLD.MARTES, :OLD.MIERCOLES, :OLD.JUEVES, :OLD.VIERNES,
      'DEL', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  END IF;
END;
/

ALTER TRIGGER "FACILITADORES_DIAS_BLOQUEOS_JNTRG" ENABLE;

--------------------------------------------------------------------------------
-- === 4) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_FAC_BLOQUEOS_ETHOS AS

  -- Todos los bloqueos + los anios lectivos.
  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta (con facilitador y anio). Con p_id, solo cambian los dias.
  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_id_facilitador IN VARCHAR2,
    p_id_anio        IN VARCHAR2,
    p_lunes          IN VARCHAR2,
    p_martes         IN VARCHAR2,
    p_miercoles      IN VARCHAR2,
    p_jueves         IN VARCHAR2,
    p_viernes        IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_FAC_BLOQUEOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_FAC_BLOQUEOS_ETHOS AS

  -- El largo de cada columna de dia.
  c_largo CONSTANT PLS_INTEGER  := 100;

  -- Un dato que no sirve: g_msg dice cual. Lo responde `guardar` con un 400.
  e_dato EXCEPTION;
  g_msg  VARCHAR2(4000);

  TYPE t_dias IS TABLE OF VARCHAR2(4000) INDEX BY PLS_INTEGER;

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
        p_error(400, 'Bad Request', 'El facilitador o el ' || TO_CHAR(UNISTR('a\00f1o'))
                || ' lectivo ya no existen');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Las franjas de un dia no pueden pasar de '
                || c_largo || ' caracteres');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de los bloqueos no esta corregido. Volve a correr '
                || 'backend/facilitadores_dias_bloqueos.sql.');
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

  -- El nombre del dia k (1 = lunes), para los mensajes.
  FUNCTION f_dia(k IN PLS_INTEGER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE k WHEN 1 THEN 'lunes' WHEN 2 THEN 'martes'
                  WHEN 3 THEN TO_CHAR(UNISTR('mi\00e9rcoles'))
                  WHEN 4 THEN 'jueves' ELSE 'viernes' END;
  END f_dia;

  ------------------------------------------------------------------------------
  -- El ID_ANIO del anio lectivo actual. El anio lo decide FN_ANIO_LECTIVO_ACTUAL()
  -- (anios_lectivos.sql), la misma que usan horarios, pre-horarios y
  -- postulaciones: asi "el actual" es el mismo en todo el sitio. Como esta tabla
  -- guarda el ID y no el ANIO, se busca la fila de ese anio, prefiriendo la
  -- activa si hubiera dos con el mismo numero. NULL si no hay anio activo (la
  -- funcion devuelve NULL y el WHERE no encuentra nada).
  ------------------------------------------------------------------------------
  FUNCTION f_id_anio_actual RETURN NUMBER IS
    l_id NUMBER;
  BEGIN
    SELECT MAX(id_anio) KEEP (DENSE_RANK FIRST ORDER BY
             CASE WHEN UPPER(TRIM(estado)) = 'A' THEN 0 ELSE 1 END)
      INTO l_id
      FROM anios_lectivos
     WHERE anio = FN_ANIO_LECTIVO_ACTUAL();
    RETURN l_id;
  END f_id_anio_actual;

  -- Minutos desde las 00:00 -> 'HH:MI'.
  FUNCTION f_hora(p_min IN PLS_INTEGER) RETURN VARCHAR2 IS
  BEGIN
    RETURN LPAD(TRUNC(p_min / 60), 2, '0') || ':' || LPAD(MOD(p_min, 60), 2, '0');
  END f_hora;

  ------------------------------------------------------------------------------
  -- Las franjas de UN dia, normalizadas: "7:00-8:00,13:00 - 14:00" ->
  -- "07:00 - 08:00, 13:00 - 14:00", en orden de hora. NULL si no hay ninguna.
  -- Si algo no sirve: e_dato con g_msg. Ver "EL FORMATO DE CADA DIA".
  ------------------------------------------------------------------------------
  FUNCTION f_franjas(p_k IN PLS_INTEGER, p_valor IN VARCHAR2) RETURN VARCHAR2 IS
    TYPE t_min IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
    c_re    CONSTANT VARCHAR2(60) := '^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$';
    l_dia   VARCHAR2(30) := f_dia(p_k);
    l_partes APEX_T_VARCHAR2;
    l_p     VARCHAR2(4000);
    l_ini   t_min;
    l_fin   t_min;
    l_n     PLS_INTEGER := 0;
    l_h1    PLS_INTEGER;
    l_m1    PLS_INTEGER;
    l_h2    PLS_INTEGER;
    l_m2    PLS_INTEGER;
    l_tmp   PLS_INTEGER;
    l_res   VARCHAR2(4000);
  BEGIN
    IF TRIM(p_valor) IS NULL THEN RETURN NULL; END IF;

    l_partes := APEX_STRING.SPLIT(p_valor, ',');
    FOR i IN 1 .. l_partes.COUNT LOOP
      l_p := TRIM(l_partes(i));
      IF l_p IS NOT NULL THEN
        IF NOT REGEXP_LIKE(l_p, c_re) THEN
          g_msg := 'El ' || l_dia || ': "' || SUBSTR(l_p, 1, 40)
                   || '" no es una franja HH:MI - HH:MI';
          RAISE e_dato;
        END IF;
        l_h1 := TO_NUMBER(REGEXP_SUBSTR(l_p, c_re, 1, 1, NULL, 1));
        l_m1 := TO_NUMBER(REGEXP_SUBSTR(l_p, c_re, 1, 1, NULL, 2));
        l_h2 := TO_NUMBER(REGEXP_SUBSTR(l_p, c_re, 1, 1, NULL, 3));
        l_m2 := TO_NUMBER(REGEXP_SUBSTR(l_p, c_re, 1, 1, NULL, 4));
        IF l_h1 > 23 OR l_m1 > 59 OR l_h2 > 23 OR l_m2 > 59 THEN
          g_msg := 'El ' || l_dia || ': ' || l_p || ' tiene una hora que no existe';
          RAISE e_dato;
        END IF;
        l_n := l_n + 1;
        l_ini(l_n) := l_h1 * 60 + l_m1;
        l_fin(l_n) := l_h2 * 60 + l_m2;
        IF l_fin(l_n) <= l_ini(l_n) THEN
          g_msg := 'El ' || l_dia || ': la franja ' || f_hora(l_ini(l_n)) || ' - '
                   || f_hora(l_fin(l_n)) || ' termina antes de empezar';
          RAISE e_dato;
        END IF;
      END IF;
    END LOOP;
    IF l_n = 0 THEN RETURN NULL; END IF;

    -- En orden de hora (insercion: son pocas).
    FOR i IN 2 .. l_n LOOP
      FOR j IN REVERSE 2 .. i LOOP
        EXIT WHEN l_ini(j - 1) <= l_ini(j);
        l_tmp := l_ini(j); l_ini(j) := l_ini(j - 1); l_ini(j - 1) := l_tmp;
        l_tmp := l_fin(j); l_fin(j) := l_fin(j - 1); l_fin(j - 1) := l_tmp;
      END LOOP;
    END LOOP;

    FOR i IN 1 .. l_n LOOP
      IF i > 1 AND l_ini(i) < l_fin(i - 1) THEN
        g_msg := 'El ' || l_dia || ': las franjas ' || f_hora(l_ini(i - 1)) || ' - '
                 || f_hora(l_fin(i - 1)) || ' y ' || f_hora(l_ini(i)) || ' - '
                 || f_hora(l_fin(i)) || ' se pisan: juntalas en una';
        RAISE e_dato;
      END IF;
      l_res := l_res || CASE WHEN i > 1 THEN ', ' END
               || f_hora(l_ini(i)) || ' - ' || f_hora(l_fin(i));
    END LOOP;
    IF LENGTH(l_res) > c_largo THEN
      g_msg := 'El ' || l_dia || ' tiene demasiadas franjas: no entran en '
               || c_largo || ' caracteres. Junta las que van seguidas';
      RAISE e_dato;
    END IF;
    RETURN l_res;
  END f_franjas;

  ------------------------------------------------------------------------------
  -- Solo sesion, para los cuatro metodos: el modal no tiene permisos propios
  -- (ver PERMISOS en el encabezado). FALSE = ya respondio el error.
  ------------------------------------------------------------------------------
  FUNCTION exigir(p_token IN VARCHAR2) RETURN BOOLEAN IS
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_actual NUMBER;
  BEGIN
    IF NOT exigir(p_token) THEN RETURN; END IF;
    l_actual := f_id_anio_actual();

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo', c_largo);
    -- El anio con que abre el modal (NULL si no hay uno activo).
    APEX_JSON.WRITE('id_anio_actual', l_actual, TRUE);

    APEX_JSON.OPEN_ARRAY('data');
    -- Alta y ultimo cambio salen de la bitacora, en hora de Paraguay: el
    -- usuario del alta es el de la fila INS; el del cambio, el de la ultima UPD.
    FOR r IN (SELECT b.id_bloqueo, b.id_facilitador, b.id_anio, a.anio,
                     b.lunes, b.martes, b.miercoles, b.jueves, b.viernes,
                     TO_CHAR(j.alta - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS cargado_el,
                     CASE WHEN j.alta IS NOT NULL THEN j.alta_por END AS cargado_por,
                     TO_CHAR(j.cambio - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS modificado_el,
                     CASE WHEN j.cambio IS NOT NULL THEN j.cambio_por END AS modificado_por
                FROM facilitadores_dias_bloqueos b
                LEFT JOIN anios_lectivos a ON a.id_anio = b.id_anio
                LEFT JOIN (
                  SELECT x.id_auditoria,
                         MIN(CASE WHEN x.jn_operation = 'INS' THEN x.jn_datetime END) AS alta,
                         MIN(x.jn_oracle_user) KEEP (DENSE_RANK FIRST ORDER BY
                           CASE WHEN x.jn_operation = 'INS' THEN 0 ELSE 1 END, x.jn_datetime) AS alta_por,
                         MAX(CASE WHEN x.jn_operation = 'UPD' THEN x.jn_datetime END) AS cambio,
                         MAX(x.jn_oracle_user) KEEP (DENSE_RANK LAST ORDER BY
                           CASE WHEN x.jn_operation = 'UPD' THEN 1 ELSE 0 END, x.jn_datetime) AS cambio_por
                    FROM facilitadores_dias_bloqueos_jn x
                   GROUP BY x.id_auditoria
                ) j ON j.id_auditoria = b.id_auditoria
               ORDER BY a.anio DESC NULLS LAST, b.id_facilitador, b.id_bloqueo) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_bloqueo',     r.id_bloqueo);
      APEX_JSON.WRITE('id_facilitador', r.id_facilitador);
      APEX_JSON.WRITE('id_anio',        r.id_anio);
      APEX_JSON.WRITE('anio',           r.anio);
      APEX_JSON.WRITE('lunes',          r.lunes);
      APEX_JSON.WRITE('martes',         r.martes);
      APEX_JSON.WRITE('miercoles',      r.miercoles);
      APEX_JSON.WRITE('jueves',         r.jueves);
      APEX_JSON.WRITE('viernes',        r.viernes);
      APEX_JSON.WRITE('cargado_el',     r.cargado_el);
      APEX_JSON.WRITE('cargado_por',    r.cargado_por);
      APEX_JSON.WRITE('modificado_el',  r.modificado_el);
      APEX_JSON.WRITE('modificado_por', r.modificado_por);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Los anios lectivos, livianos (sin los usos que cuenta su pantalla).
    -- `vigente` = el de FN_ANIO_LECTIVO_ACTUAL (ver f_id_anio_actual).
    APEX_JSON.OPEN_ARRAY('anios');
    FOR a IN (SELECT id_anio, anio,
                     CASE WHEN id_anio = l_actual THEN 'S' ELSE 'N' END AS vigente
                FROM anios_lectivos
               ORDER BY anio DESC) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_anio', a.id_anio);
      APEX_JSON.WRITE('anio',    a.anio);
      APEX_JSON.WRITE('vigente', a.vigente);
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

  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_id_facilitador IN VARCHAR2,
    p_id_anio        IN VARCHAR2,
    p_lunes          IN VARCHAR2,
    p_martes         IN VARCHAR2,
    p_miercoles      IN VARCHAR2,
    p_jueves         IN VARCHAR2,
    p_viernes        IN VARCHAR2)
  IS
    l_id     NUMBER := f_numero(p_id);
    l_fac    NUMBER;
    l_anio   NUMBER;
    l_numero anios_lectivos.anio%TYPE;
    l_nombre facilitadores.nombre_apellido%TYPE;
    l_n      PLS_INTEGER;
    l_dias   t_dias;
    l_alguno BOOLEAN := FALSE;
  BEGIN
    IF NOT exigir(p_token) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de bloqueo invalido'); RETURN;
    END IF;

    IF l_id IS NOT NULL THEN
      -- Modificar: el facilitador y el anio son los de la fila.
      BEGIN
        SELECT id_facilitador, id_anio INTO l_fac, l_anio
          FROM facilitadores_dias_bloqueos WHERE id_bloqueo = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'Ese bloqueo ya no existe'); RETURN;
      END;
    ELSE
      -- Alta: facilitador y anio, que existan, y que no tengan ya su fila.
      -- Sin id_anio va al anio lectivo actual (FN_ANIO_LECTIVO_ACTUAL).
      l_fac  := f_numero(p_id_facilitador);
      IF l_fac IS NULL THEN
        p_error(400, 'Bad Request', 'Falta el facilitador'); RETURN;
      END IF;
      IF p_id_anio IS NULL THEN
        l_anio := f_id_anio_actual();
        IF l_anio IS NULL THEN
          p_error(400, 'Bad Request', 'No hay un ' || TO_CHAR(UNISTR('a\00f1o'))
                  || ' lectivo activo: elegi el ' || TO_CHAR(UNISTR('a\00f1o'))); RETURN;
        END IF;
      ELSE
        l_anio := f_numero(p_id_anio);
        IF l_anio IS NULL THEN
          p_error(400, 'Bad Request', 'Id de ' || TO_CHAR(UNISTR('a\00f1o')) || ' lectivo invalido');
          RETURN;
        END IF;
      END IF;
      BEGIN
        SELECT nombre_apellido INTO l_nombre FROM facilitadores WHERE id_facilitador = l_fac;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'El facilitador no existe'); RETURN;
      END;
      BEGIN
        SELECT anio INTO l_numero FROM anios_lectivos WHERE id_anio = l_anio;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'El ' || TO_CHAR(UNISTR('a\00f1o')) || ' lectivo no existe');
          RETURN;
      END;
      SELECT COUNT(*) INTO l_n FROM facilitadores_dias_bloqueos
       WHERE id_facilitador = l_fac AND id_anio = l_anio;
      IF l_n > 0 THEN
        p_error(409, 'Conflict', l_nombre || ' ya tiene horarios bloqueados en ' || l_numero
                || ': modificalos en vez de cargar otros');
        RETURN;
      END IF;
    END IF;

    -- Los cinco dias, normalizados. Todo validado ANTES de tocar nada.
    BEGIN
      l_dias(1) := f_franjas(1, p_lunes);
      l_dias(2) := f_franjas(2, p_martes);
      l_dias(3) := f_franjas(3, p_miercoles);
      l_dias(4) := f_franjas(4, p_jueves);
      l_dias(5) := f_franjas(5, p_viernes);
    EXCEPTION
      WHEN e_dato THEN
        p_error(400, 'Bad Request', g_msg); RETURN;
    END;
    FOR k IN 1 .. 5 LOOP
      IF l_dias(k) IS NOT NULL THEN l_alguno := TRUE; END IF;
    END LOOP;
    IF NOT l_alguno THEN
      p_error(400, 'Bad Request', 'Carga al menos una franja. Para dejarlo sin bloqueos, '
              || 'elimina los de ese ' || TO_CHAR(UNISTR('a\00f1o')));
      RETURN;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO facilitadores_dias_bloqueos (
        id_facilitador, id_anio, lunes, martes, miercoles, jueves, viernes)
      VALUES (l_fac, l_anio, l_dias(1), l_dias(2), l_dias(3), l_dias(4), l_dias(5))
      RETURNING id_bloqueo INTO l_id;
    ELSE
      -- Solo si cambio algo: la bitacora muestra los cambios reales.
      UPDATE facilitadores_dias_bloqueos
         SET lunes = l_dias(1), martes = l_dias(2), miercoles = l_dias(3),
             jueves = l_dias(4), viernes = l_dias(5)
       WHERE id_bloqueo = l_id
         AND (   NVL(lunes, CHR(0))     <> NVL(l_dias(1), CHR(0))
              OR NVL(martes, CHR(0))    <> NVL(l_dias(2), CHR(0))
              OR NVL(miercoles, CHR(0)) <> NVL(l_dias(3), CHR(0))
              OR NVL(jueves, CHR(0))    <> NVL(l_dias(4), CHR(0))
              OR NVL(viernes, CHR(0))   <> NVL(l_dias(5), CHR(0)));
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_bloqueo', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Bloqueos cargados'
                                    ELSE 'Bloqueos actualizados' END);
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
    IF NOT exigir(p_token) THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de bloqueo invalido'); RETURN;
    END IF;

    DELETE FROM facilitadores_dias_bloqueos WHERE id_bloqueo = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'Ese bloqueo ya no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Bloqueos eliminados');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_FAC_BLOQUEOS_ETHOS;
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

  -- El cuerpo de POST y PUT, igual salvo el id. En un PUT el facilitador y el
  -- anio no se usan (son los de la fila).
  c_campos CONSTANT VARCHAR2(500) := '
        p_id_facilitador => :id_facilitador, p_id_anio => :id_anio,
        p_lunes => :lunes, p_martes => :martes, p_miercoles => :miercoles,
        p_jueves => :jueves, p_viernes => :viernes);';

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
  FOR r IN (SELECT 'facilitadores-bloqueos' AS p FROM dual
            UNION ALL SELECT 'facilitadores-bloqueos/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facilitadores-bloqueos',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facilitadores-bloqueos/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('facilitadores-bloqueos', 'GET', '
    PKG_FAC_BLOQUEOS_ETHOS.LISTAR(p_token => l_token);');

  handler('facilitadores-bloqueos', 'POST', '
    PKG_FAC_BLOQUEOS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('facilitadores-bloqueos/:id', 'PUT', '
    PKG_FAC_BLOQUEOS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('facilitadores-bloqueos/:id', 'DELETE', '
    PKG_FAC_BLOQUEOS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de facilitadores-bloqueos publicados.');
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
  preflight('facilitadores-bloqueos');
  preflight('facilitadores-bloqueos/:id');
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
  l_n      PLS_INTEGER;
BEGIN
  FOR o IN (SELECT 'FACILITADORES_DIAS_BLOQUEOS_JNTRG' AS nombre, 'TRIGGER' AS tipo FROM dual
            UNION ALL SELECT 'PKG_FAC_BLOQUEOS_ETHOS', 'PACKAGE BODY' FROM dual) LOOP
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

  DBMS_OUTPUT.PUT_LINE('       GET    facilitadores-bloqueos');
  DBMS_OUTPUT.PUT_LINE('       POST   facilitadores-bloqueos');
  DBMS_OUTPUT.PUT_LINE('       PUT    facilitadores-bloqueos/:id');
  DBMS_OUTPUT.PUT_LINE('       DELETE facilitadores-bloqueos/:id');

  -- Una fila por facilitador y anio (ver REGLAS): la tabla no lo exige, asi
  -- que se avisa si ya habia repetidos de antes.
  EXECUTE IMMEDIATE
    'SELECT COUNT(*) FROM (SELECT id_facilitador, id_anio FROM facilitadores_dias_bloqueos '
    || 'GROUP BY id_facilitador, id_anio HAVING COUNT(*) > 1)'
    INTO l_n;
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] ' || l_n || ' facilitador(es) tienen mas de una fila en el mismo '
                         || TO_CHAR(UNISTR('a\00f1o')) || '. El sitio muestra la primera;');
    DBMS_OUTPUT.PUT_LINE('       conviene juntarlas en una y borrar las demas.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Una fila por facilitador y ' || TO_CHAR(UNISTR('a\00f1o')) || '.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Verificacion: ' || SQLERRM);
END;
/
