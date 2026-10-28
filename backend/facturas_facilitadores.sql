--------------------------------------------------------------------------------
-- FACTURAS_FACILITADORES  —  Las facturas de los facilitadores (Totales por Facilitador)
--------------------------------------------------------------------------------
--
-- Tabla NUEVA (28/10/2026), no viene de APEX. No es una pagina: es un dialogo
-- de Totales por Facilitador (/totales-facilitador, la 55) y usa sus permisos.
--
-- UNA FACTURA = UN FACILITADOR EN UN PERIODO. El reporte tiene una fila por
-- facilitador e institucion, pero el facilitador factura todo junto: la
-- factura cubre del FECHA_DESDE al FECHA_HASTA, con todas sus instituciones.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     facturas-facilitadores        ?desde=&hasta=&id_facilitador=
--                                         las facturas cuyo periodo TOCA el
--                                         rango (todas, sin parametros), con
--                                         quien y cuando se cargo y modifico
--   POST    facturas-facilitadores        {id_facilitador, nro_factura,
--                                          timbrado, fecha_factura,
--                                          fecha_desde, fecha_hasta,
--                                          cantidad, sueldo, observacion}
--                                         -> {id_factura}
--   PUT     facturas-facilitadores/:id    lo mismo
--   DELETE  facturas-facilitadores/:id
--
--   Las fechas 'YYYY-MM-DD'.
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql y facilitadores.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- LO QUE SE GUARDA ES UNA FOTO
--------------------------------------------------------------------------------
--
-- CANTIDAD y SUELDO son los del reporte al momento de facturar, y MONTO es
-- CANTIDAD x SUELDO (lo calcula el paquete, no viaja en el body). No se
-- recalculan: si despues se corrige una marcacion, el reporte cambia y la
-- factura queda como se pago. Asi el sitio puede mostrar la diferencia.
--
--------------------------------------------------------------------------------
-- REGLAS
--------------------------------------------------------------------------------
--
--   - Facilitador, numero, fecha de la factura y periodo obligatorios.
--   - NRO_FACTURA con el formato 001-001-0000123. Se acepta tambien sin
--     guiones (13 digitos) o sin los ceros de la izquierda (1-1-123): se guarda
--     siempre con el formato completo.
--   - TIMBRADO opcional, solo digitos.
--   - FECHA_HASTA no anterior a FECHA_DESDE (tambien un CHECK en la tabla).
--   - CANTIDAD entero de 1 en adelante; SUELDO entero mayor que 0.
--   - El mismo numero (con el mismo timbrado) no se repite para un
--     facilitador: lo dice el paquete, y un indice unico lo asegura.
--   - DOS FACTURAS DE UN FACILITADOR NO SE SUPERPONEN: ningun dia puede quedar
--     en dos facturas, para no pagar dos veces la misma intervencion. Guardar
--     bloquea la fila del facilitador, asi dos altas a la vez no se cruzan.
--
--   La FK a FACILITADORES hace que un facilitador con facturas figure "en
--   uso" en su pantalla y no se pueda borrar.
--
--------------------------------------------------------------------------------
-- PERMISOS (los de la pagina de /totales-facilitador)
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR
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

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'FACILITADORES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla FACILITADORES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FACILITADORES encontrada.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) ESTRUCTURA: tabla, bitacora, indice y secuencia (si faltan) ========
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
  IF NOT existe('FACTURAS_FACILITADORES') THEN
    ejecutar(q'~
      CREATE TABLE "FACTURAS_FACILITADORES" (
        "ID_FACTURA" NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY
                     MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1
                     START WITH 1 CACHE 20 NOORDER NOCYCLE NOKEEP NOSCALE NOT NULL ENABLE,
        "ID_FACILITADOR" NUMBER NOT NULL ENABLE,
        "NRO_FACTURA"    VARCHAR2(15) NOT NULL ENABLE,
        "TIMBRADO"       VARCHAR2(20),
        "FECHA_FACTURA"  DATE NOT NULL ENABLE,
        "FECHA_DESDE"    DATE NOT NULL ENABLE,
        "FECHA_HASTA"    DATE NOT NULL ENABLE,
        "CANTIDAD"       NUMBER DEFAULT 0 NOT NULL ENABLE,
        "SUELDO"         NUMBER DEFAULT 0 NOT NULL ENABLE,
        "MONTO"          NUMBER DEFAULT 0 NOT NULL ENABLE,
        "OBSERVACION"    VARCHAR2(2000),
        "ID_AUDITORIA"   NUMBER,
        PRIMARY KEY ("ID_FACTURA") USING INDEX ENABLE,
        CONSTRAINT "CK_FACT_FACIL_PERIODO" CHECK ("FECHA_HASTA" >= "FECHA_DESDE") ENABLE
      )~');
    ejecutar('ALTER TABLE "FACTURAS_FACILITADORES" ADD CONSTRAINT "FK_FACT_FACIL_FACILITADOR" '
             || 'FOREIGN KEY ("ID_FACILITADOR") REFERENCES "FACILITADORES" ("ID_FACILITADOR") ENABLE');

    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."ID_FACTURA" IS 'Identificador autonumerico de la factura'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."ID_FACILITADOR" IS 'Facilitador que emitio la factura'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."NRO_FACTURA" IS 'Numero de factura, con el formato 001-001-0000123'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."TIMBRADO" IS 'Numero de timbrado de la factura (opcional)'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."FECHA_FACTURA" IS 'Fecha de emision de la factura'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."FECHA_DESDE" IS 'Primer dia del periodo que cubre la factura'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."FECHA_HASTA" IS 'Ultimo dia del periodo que cubre la factura'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."CANTIDAD" IS 'Intervenciones facturadas, como las contaba el reporte al facturar'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."SUELDO" IS 'Importe por intervencion al facturar'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."MONTO" IS 'CANTIDAD x SUELDO'~');
    ejecutar(q'~COMMENT ON COLUMN "FACTURAS_FACILITADORES"."OBSERVACION" IS 'Observacion libre'~');
    ejecutar(q'~COMMENT ON TABLE "FACTURAS_FACILITADORES" IS 'Facturas de los facilitadores: una por facilitador y periodo, con lo que se facturo'~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FACTURAS_FACILITADORES creada.');
  END IF;

  IF NOT existe('FACTURAS_FACILITADORES_JN') THEN
    ejecutar(q'~
      CREATE TABLE "FACTURAS_FACILITADORES_JN" (
        "ID_AUDITORIA"   NUMBER,
        "JN_OPERATION"   CHAR(3) NOT NULL,
        "JN_ORACLE_USER" VARCHAR2(30) NOT NULL,
        "JN_DATETIME"    DATE NOT NULL,
        "JN_NOTES"       VARCHAR2(240),
        "JN_APPLN"       VARCHAR2(35),
        "JN_SESSION"     NUMBER(38),
        "ID_FACTURA"     NUMBER,
        "ID_FACILITADOR" NUMBER,
        "NRO_FACTURA"    VARCHAR2(15),
        "TIMBRADO"       VARCHAR2(20),
        "FECHA_FACTURA"  DATE,
        "FECHA_DESDE"    DATE,
        "FECHA_HASTA"    DATE,
        "CANTIDAD"       NUMBER,
        "SUELDO"         NUMBER,
        "MONTO"          NUMBER,
        "OBSERVACION"    VARCHAR2(2000)
      )~');
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla FACTURAS_FACILITADORES_JN creada.');
  END IF;

  -- El mismo numero no se repite para un facilitador (con el mismo timbrado;
  -- sin timbrado cuenta como uno solo).
  SELECT COUNT(*) INTO l_n FROM user_indexes WHERE index_name = 'UQ_FACT_FACIL_NRO';
  IF l_n = 0 THEN
    ejecutar('CREATE UNIQUE INDEX "UQ_FACT_FACIL_NRO" ON "FACTURAS_FACILITADORES" '
             || '("ID_FACILITADOR", NVL("TIMBRADO", ''-''), "NRO_FACTURA")');
    DBMS_OUTPUT.PUT_LINE('[OK]   Indice UQ_FACT_FACIL_NRO creado.');
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
-- === 3) TRIGGER DE BITACORA (con el usuario de la app, como envios_graficas) =
--------------------------------------------------------------------------------

CREATE OR REPLACE EDITIONABLE TRIGGER "FACTURAS_FACILITADORES_JNTRG"
BEFORE INSERT OR UPDATE OR DELETE ON facturas_facilitadores
FOR EACH ROW
DECLARE
  v_audit_id  NUMBER;
  -- Quien uso la app, no el esquema: VALIDAR_TOKEN deja el usuario en
  -- CLIENT_IDENTIFIER (ver auth.sql). 30 es el largo de la columna.
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
    INSERT INTO facturas_facilitadores_jn (
      ID_AUDITORIA, ID_FACTURA, ID_FACILITADOR, NRO_FACTURA, TIMBRADO, FECHA_FACTURA,
      FECHA_DESDE, FECHA_HASTA, CANTIDAD, SUELDO, MONTO, OBSERVACION,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :NEW.ID_FACTURA, :NEW.ID_FACILITADOR, :NEW.NRO_FACTURA, :NEW.TIMBRADO,
      :NEW.FECHA_FACTURA, :NEW.FECHA_DESDE, :NEW.FECHA_HASTA, :NEW.CANTIDAD, :NEW.SUELDO,
      :NEW.MONTO, :NEW.OBSERVACION,
      v_operacion, v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  ELSE
    INSERT INTO facturas_facilitadores_jn (
      ID_AUDITORIA, ID_FACTURA, ID_FACILITADOR, NRO_FACTURA, TIMBRADO, FECHA_FACTURA,
      FECHA_DESDE, FECHA_HASTA, CANTIDAD, SUELDO, MONTO, OBSERVACION,
      JN_OPERATION, JN_ORACLE_USER, JN_DATETIME, JN_NOTES, JN_APPLN, JN_SESSION
    ) VALUES (
      v_audit_id, :OLD.ID_FACTURA, :OLD.ID_FACILITADOR, :OLD.NRO_FACTURA, :OLD.TIMBRADO,
      :OLD.FECHA_FACTURA, :OLD.FECHA_DESDE, :OLD.FECHA_HASTA, :OLD.CANTIDAD, :OLD.SUELDO,
      :OLD.MONTO, :OLD.OBSERVACION,
      'DEL', v_usuario, SYSDATE, NULL,
      SYS_CONTEXT('USERENV', 'MODULE'), SYS_CONTEXT('USERENV', 'SESSIONID'));
  END IF;
END;
/

ALTER TRIGGER "FACTURAS_FACILITADORES_JNTRG" ENABLE;

--------------------------------------------------------------------------------
-- === 4) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_FACTURAS_FACIL_ETHOS AS

  -- Las facturas cuyo periodo toca [desde, hasta]; sin rango, todas.
  PROCEDURE listar(
    p_token          IN VARCHAR2,
    p_desde          IN VARCHAR2,
    p_hasta          IN VARCHAR2,
    p_id_facilitador IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_id_facilitador IN VARCHAR2,
    p_nro_factura    IN VARCHAR2,
    p_timbrado       IN VARCHAR2,
    p_fecha_factura  IN VARCHAR2,
    p_fecha_desde    IN VARCHAR2,
    p_fecha_hasta    IN VARCHAR2,
    p_cantidad       IN VARCHAR2,
    p_sueldo         IN VARCHAR2,
    p_observacion    IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_FACTURAS_FACIL_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_FACTURAS_FACIL_ETHOS AS

  c_ruta          CONSTANT VARCHAR2(30) := '/totales-facilitador';
  c_largo_obs     CONSTANT PLS_INTEGER  := 2000;
  c_largo_timbr   CONSTANT PLS_INTEGER  := 20;
  -- Topes contra un error de tipeo: un numero de mas no tiene que pasar.
  c_tope_cant     CONSTANT NUMBER       := 99999;
  c_tope_sueldo   CONSTANT NUMBER       := 999999999;

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
        p_error(409, 'Conflict', 'Ese numero de factura ya esta cargado para el facilitador');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'El facilitador ya no existe');
      WHEN SQLCODE = -2290 THEN
        p_error(400, 'Bad Request', 'La fecha hasta no puede ser anterior a la fecha desde');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla');
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'El trigger de bitacora de facturas no esta corregido. Volve a correr '
                || 'backend/facturas_facilitadores.sql.');
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

  -- 'YYYY-MM-DD' (o con hora atras), o NULL si no es una fecha.
  FUNCTION f_fecha(p_valor IN VARCHAR2) RETURN DATE IS
  BEGIN
    RETURN TO_DATE(SUBSTR(TRIM(p_valor), 1, 10), 'YYYY-MM-DD');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_fecha;

  -- El numero con el formato 001-001-0000123, o NULL si no se puede llevar a
  -- el. Acepta los 13 digitos juntos o cada parte sin sus ceros de la izquierda.
  FUNCTION f_nro_factura(p_valor IN VARCHAR2) RETURN VARCHAR2 IS
    l_v VARCHAR2(4000) := REGEXP_REPLACE(TRIM(p_valor), '\s+', '');
  BEGIN
    IF REGEXP_LIKE(l_v, '^[0-9]{13}$') THEN
      RETURN SUBSTR(l_v, 1, 3) || '-' || SUBSTR(l_v, 4, 3) || '-' || SUBSTR(l_v, 7, 7);
    END IF;
    IF REGEXP_LIKE(l_v, '^[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,7}$') THEN
      RETURN LPAD(REGEXP_SUBSTR(l_v, '[0-9]+', 1, 1), 3, '0') || '-'
          || LPAD(REGEXP_SUBSTR(l_v, '[0-9]+', 1, 2), 3, '0') || '-'
          || LPAD(REGEXP_SUBSTR(l_v, '[0-9]+', 1, 3), 7, '0');
    END IF;
    RETURN NULL;
  END f_nro_factura;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' la accion en la
  -- pagina de /totales-facilitador. FALSE = ya respondio el error.
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
        p_error(403, 'Forbidden', 'La pantalla ' || c_ruta || ' no esta en el menu: '
                || 'hay que darla de alta en Crear paginas y darle permisos');
        RETURN FALSE;
      END IF;
      IF PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para '
          || CASE p_accion WHEN 'I' THEN 'registrar'
                           WHEN 'U' THEN 'modificar'
                           ELSE 'eliminar' END
          || ' facturas de facilitadores');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(
    p_token          IN VARCHAR2,
    p_desde          IN VARCHAR2,
    p_hasta          IN VARCHAR2,
    p_id_facilitador IN VARCHAR2)
  IS
    l_desde DATE   := f_fecha(p_desde);
    l_hasta DATE   := f_fecha(p_hasta);
    l_fac   NUMBER := f_numero(p_id_facilitador);
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF (TRIM(p_desde) IS NOT NULL AND l_desde IS NULL)
       OR (TRIM(p_hasta) IS NOT NULL AND l_hasta IS NULL) THEN
      p_error(400, 'Bad Request', 'Las fechas van como YYYY-MM-DD'); RETURN;
    END IF;
    IF TRIM(p_id_facilitador) IS NOT NULL AND l_fac IS NULL THEN
      p_error(400, 'Bad Request', 'Id de facilitador invalido'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('largo_observacion', c_largo_obs);

    APEX_JSON.OPEN_ARRAY('data');
    -- Alta y ultimo cambio salen de la bitacora, en hora de Paraguay.
    FOR c IN (SELECT f.id_factura, f.id_facilitador, fa.nombre_apellido AS facilitador,
                     f.nro_factura, f.timbrado,
                     TO_CHAR(f.fecha_factura, 'YYYY-MM-DD') AS fecha_factura,
                     TO_CHAR(f.fecha_desde, 'YYYY-MM-DD') AS fecha_desde,
                     TO_CHAR(f.fecha_hasta, 'YYYY-MM-DD') AS fecha_hasta,
                     f.cantidad, f.sueldo, f.monto, f.observacion,
                     TO_CHAR(b.alta - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS cargado_el,
                     CASE WHEN b.alta IS NOT NULL THEN b.alta_por END AS cargado_por,
                     TO_CHAR(b.cambio - 3/24, 'YYYY-MM-DD"T"HH24:MI') AS modificado_el,
                     CASE WHEN b.cambio IS NOT NULL THEN b.cambio_por END AS modificado_por
                FROM facturas_facilitadores f
                JOIN facilitadores fa ON fa.id_facilitador = f.id_facilitador
                LEFT JOIN (
                  SELECT j.id_auditoria,
                         MIN(CASE WHEN j.jn_operation = 'INS' THEN j.jn_datetime END) AS alta,
                         MIN(j.jn_oracle_user) KEEP (DENSE_RANK FIRST ORDER BY
                           CASE WHEN j.jn_operation = 'INS' THEN 0 ELSE 1 END, j.jn_datetime) AS alta_por,
                         MAX(CASE WHEN j.jn_operation = 'UPD' THEN j.jn_datetime END) AS cambio,
                         MAX(j.jn_oracle_user) KEEP (DENSE_RANK LAST ORDER BY
                           CASE WHEN j.jn_operation = 'UPD' THEN 1 ELSE 0 END, j.jn_datetime) AS cambio_por
                    FROM facturas_facilitadores_jn j
                   GROUP BY j.id_auditoria
                ) b ON b.id_auditoria = f.id_auditoria
               WHERE (l_hasta IS NULL OR f.fecha_desde <= l_hasta)
                 AND (l_desde IS NULL OR f.fecha_hasta >= l_desde)
                 AND (l_fac IS NULL OR f.id_facilitador = l_fac)
               ORDER BY f.fecha_desde DESC, UPPER(fa.nombre_apellido), f.id_factura DESC) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_factura',     c.id_factura);
      APEX_JSON.WRITE('id_facilitador', c.id_facilitador);
      APEX_JSON.WRITE('facilitador',    c.facilitador);
      APEX_JSON.WRITE('nro_factura',    c.nro_factura);
      APEX_JSON.WRITE('timbrado',       c.timbrado);
      APEX_JSON.WRITE('fecha_factura',  c.fecha_factura);
      APEX_JSON.WRITE('fecha_desde',    c.fecha_desde);
      APEX_JSON.WRITE('fecha_hasta',    c.fecha_hasta);
      APEX_JSON.WRITE('cantidad',       c.cantidad);
      APEX_JSON.WRITE('sueldo',         c.sueldo);
      APEX_JSON.WRITE('monto',          c.monto);
      APEX_JSON.WRITE('observacion',    c.observacion);
      APEX_JSON.WRITE('cargado_el',     c.cargado_el);
      APEX_JSON.WRITE('cargado_por',    c.cargado_por);
      APEX_JSON.WRITE('modificado_el',  c.modificado_el);
      APEX_JSON.WRITE('modificado_por', c.modificado_por);
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
    p_nro_factura    IN VARCHAR2,
    p_timbrado       IN VARCHAR2,
    p_fecha_factura  IN VARCHAR2,
    p_fecha_desde    IN VARCHAR2,
    p_fecha_hasta    IN VARCHAR2,
    p_cantidad       IN VARCHAR2,
    p_sueldo         IN VARCHAR2,
    p_observacion    IN VARCHAR2)
  IS
    l_id       NUMBER := f_numero(p_id);
    l_fac      NUMBER := f_numero(p_id_facilitador);
    l_nro      VARCHAR2(15);
    -- 32767: ver materias.sql. El tope real se valida abajo con mensaje.
    l_timbrado VARCHAR2(32767) := REGEXP_REPLACE(TRIM(p_timbrado), '\s+', '');
    l_obs      VARCHAR2(32767) := TRIM(p_observacion);
    l_fecha    DATE   := f_fecha(p_fecha_factura);
    l_desde    DATE   := f_fecha(p_fecha_desde);
    l_hasta    DATE   := f_fecha(p_fecha_hasta);
    l_cantidad NUMBER := f_numero(p_cantidad);
    l_sueldo   NUMBER := f_numero(p_sueldo);
    l_n        PLS_INTEGER;
    l_otra     facturas_facilitadores%ROWTYPE;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de factura invalido'); RETURN;
    END IF;
    IF l_id IS NOT NULL THEN
      SELECT COUNT(*) INTO l_n FROM facturas_facilitadores WHERE id_factura = l_id;
      IF l_n = 0 THEN
        p_error(404, 'Not Found', 'La factura no existe'); RETURN;
      END IF;
    END IF;

    -- El facilitador, y su fila bloqueada hasta el COMMIT: dos altas a la vez
    -- para el mismo facilitador no pasan juntas el control de superposicion.
    IF l_fac IS NULL THEN
      p_error(400, 'Bad Request', 'Elegi el facilitador'); RETURN;
    END IF;
    BEGIN
      SELECT id_facilitador INTO l_fac FROM facilitadores
       WHERE id_facilitador = l_fac FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(400, 'Bad Request', 'El facilitador no existe'); RETURN;
    END;

    -- Numero y timbrado.
    IF TRIM(p_nro_factura) IS NULL THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'El numero de factura es obligatorio'); RETURN;
    END IF;
    l_nro := f_nro_factura(p_nro_factura);
    IF l_nro IS NULL THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'El numero de factura va con el formato 001-001-0000123'); RETURN;
    END IF;
    IF l_timbrado IS NOT NULL THEN
      IF NOT REGEXP_LIKE(l_timbrado, '^[0-9]+$') THEN
        ROLLBACK;
        p_error(400, 'Bad Request', 'El timbrado lleva solo numeros'); RETURN;
      END IF;
      IF LENGTH(l_timbrado) > c_largo_timbr THEN
        ROLLBACK;
        p_error(400, 'Bad Request', 'El timbrado no puede pasar de ' || c_largo_timbr || ' digitos');
        RETURN;
      END IF;
    END IF;

    -- Fechas.
    IF l_fecha IS NULL THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'La fecha de la factura es obligatoria'); RETURN;
    END IF;
    IF l_desde IS NULL OR l_hasta IS NULL THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'El periodo (desde y hasta) es obligatorio'); RETURN;
    END IF;
    IF l_hasta < l_desde THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'La fecha hasta no puede ser anterior a la fecha desde'); RETURN;
    END IF;

    -- Cantidad y sueldo: el MONTO lo calcula el paquete.
    IF l_cantidad IS NULL OR l_cantidad > c_tope_cant THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'La cantidad tiene que ser un numero entero de 1 a ' || c_tope_cant);
      RETURN;
    END IF;
    IF l_sueldo IS NULL OR l_sueldo > c_tope_sueldo THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'El sueldo tiene que ser un numero entero mayor que 0');
      RETURN;
    END IF;

    IF LENGTH(l_obs) > c_largo_obs THEN
      ROLLBACK;
      p_error(400, 'Bad Request', 'La observacion no puede pasar de ' || c_largo_obs || ' caracteres');
      RETURN;
    END IF;

    -- El mismo numero para el facilitador (el indice unico es la red de abajo).
    SELECT COUNT(*) INTO l_n FROM facturas_facilitadores
     WHERE id_facilitador = l_fac
       AND nro_factura = l_nro
       AND NVL(timbrado, '-') = NVL(l_timbrado, '-')
       AND (l_id IS NULL OR id_factura <> l_id);
    IF l_n > 0 THEN
      ROLLBACK;
      p_error(409, 'Conflict', 'La factura ' || l_nro || ' ya esta cargada para el facilitador');
      RETURN;
    END IF;

    -- Ningun dia en dos facturas del mismo facilitador.
    BEGIN
      SELECT * INTO l_otra FROM facturas_facilitadores
       WHERE id_facilitador = l_fac
         AND fecha_desde <= l_hasta
         AND fecha_hasta >= l_desde
         AND (l_id IS NULL OR id_factura <> l_id)
         AND ROWNUM = 1;
      ROLLBACK;
      p_error(409, 'Conflict', 'El periodo se superpone con la factura ' || l_otra.nro_factura
              || ', que cubre del ' || TO_CHAR(l_otra.fecha_desde, 'DD/MM/YYYY')
              || ' al ' || TO_CHAR(l_otra.fecha_hasta, 'DD/MM/YYYY'));
      RETURN;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;

    IF l_id IS NULL THEN
      INSERT INTO facturas_facilitadores (
        id_facilitador, nro_factura, timbrado, fecha_factura, fecha_desde, fecha_hasta,
        cantidad, sueldo, monto, observacion)
      VALUES (
        l_fac, l_nro, l_timbrado, l_fecha, l_desde, l_hasta,
        l_cantidad, l_sueldo, l_cantidad * l_sueldo, l_obs)
      RETURNING id_factura INTO l_id;
    ELSE
      UPDATE facturas_facilitadores
         SET id_facilitador = l_fac, nro_factura = l_nro, timbrado = l_timbrado,
             fecha_factura = l_fecha, fecha_desde = l_desde, fecha_hasta = l_hasta,
             cantidad = l_cantidad, sueldo = l_sueldo, monto = l_cantidad * l_sueldo,
             observacion = l_obs
       WHERE id_factura = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_factura', l_id);
    APEX_JSON.WRITE('nro_factura', l_nro);
    APEX_JSON.WRITE('monto', l_cantidad * l_sueldo);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Factura registrada' ELSE 'Factura actualizada' END);
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
      p_error(400, 'Bad Request', 'Id de factura invalido'); RETURN;
    END IF;

    DELETE FROM facturas_facilitadores WHERE id_factura = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'La factura no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Factura eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_FACTURAS_FACIL_ETHOS;
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
  c_campos CONSTANT VARCHAR2(600) := '
        p_id_facilitador => :id_facilitador, p_nro_factura => :nro_factura,
        p_timbrado => :timbrado, p_fecha_factura => :fecha_factura,
        p_fecha_desde => :fecha_desde, p_fecha_hasta => :fecha_hasta,
        p_cantidad => :cantidad, p_sueldo => :sueldo, p_observacion => :observacion);';

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
  FOR r IN (SELECT 'facturas-facilitadores' AS p FROM dual
            UNION ALL SELECT 'facturas-facilitadores/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facturas-facilitadores',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facturas-facilitadores/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  -- ?desde=&hasta=&id_facilitador=, todos opcionales.
  handler('facturas-facilitadores', 'GET', '
    PKG_FACTURAS_FACIL_ETHOS.LISTAR(p_token => l_token, p_desde => :desde,
        p_hasta => :hasta, p_id_facilitador => :id_facilitador);');

  handler('facturas-facilitadores', 'POST', '
    PKG_FACTURAS_FACIL_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('facturas-facilitadores/:id', 'PUT', '
    PKG_FACTURAS_FACIL_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('facturas-facilitadores/:id', 'DELETE', '
    PKG_FACTURAS_FACIL_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de facturas-facilitadores publicados.');
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
  preflight('facturas-facilitadores');
  preflight('facturas-facilitadores/:id');
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
  FOR o IN (SELECT 'FACTURAS_FACILITADORES_JNTRG' AS nombre, 'TRIGGER' AS tipo FROM dual
            UNION ALL SELECT 'PKG_FACTURAS_FACIL_ETHOS', 'PACKAGE BODY' FROM dual) LOOP
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

  DBMS_OUTPUT.PUT_LINE('       GET    facturas-facilitadores?desde=&hasta=&id_facilitador=');
  DBMS_OUTPUT.PUT_LINE('       POST   facturas-facilitadores');
  DBMS_OUTPUT.PUT_LINE('       PUT    facturas-facilitadores/:id');
  DBMS_OUTPUT.PUT_LINE('       DELETE facturas-facilitadores/:id');

  BEGIN
    l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta('/totales-facilitador');
  EXCEPTION
    WHEN OTHERS THEN l_pagina := NULL;
  END;
  IF l_pagina IS NULL THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] /totales-facilitador no esta en MENU_PAGINAS: guardar y borrar');
    DBMS_OUTPUT.PUT_LINE('       facturas respondera 403 hasta que este (corre menu_paginas.sql).');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Las facturas usan los permisos de la pagina ' || l_pagina
                         || ' (/totales-facilitador).');
  END IF;
END;
/
