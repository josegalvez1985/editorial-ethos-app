--------------------------------------------------------------------------------
-- INVENTARIOS  —  inventario de manuales por sucursal
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET   inventarios/sucursales                las sucursales, con cuantos
--                                               manuales tienen un conteo abierto
--   GET   inventarios        ?id_sucursal=      la PLANILLA: todos los manuales,
--                                               con su conteo y su existencia
--   POST  inventarios/conteo {id_sucursal, items}
--                                               guarda varios conteos juntos
--   POST  inventarios/cerrar {id_sucursal}      cierra lo abierto de la sucursal
--                                               y actualiza EXISTENCIAS
--   GET   inventarios/historial ?id_sucursal=&estado=&desde=&hasta=
--                                               la consulta de detalle (y el PDF):
--                                               conteos pendientes y cerrados
--
-- CORRER DESPUES de auth.sql (modulo ORDS 'ethos' y PKG_AUTH_ETHOS). No depende
-- de ningun otro paquete.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- SE CUENTA POR MANUAL, NO POR INDICE (cambiado el 25/09/2026)
--------------------------------------------------------------------------------
--
-- La primera version contaba por indice (INVENTARIOS.ID_INDICE). Se saco esa
-- columna: lo que hay en el estante son MANUALES, y EXISTENCIAS se lleva por
-- (MANUAL, ID_SUCURSAL), con UNIQUE. Ese mismo dia se saco EXISTENCIAS.ID_EXISTENCIA:
-- la fila se identifica por el par, y este paquete nunca uso el id.
--
-- INDICES_MANUALES no tiene tabla de manuales: MANUAL es un VARCHAR2(100) de
-- cada indice. El DISTINCT de esa columna ES el catalogo, y es la lista de
-- valores de la planilla. El identificador de un manual es su TEXTO.
--
--------------------------------------------------------------------------------
-- LAS DOS TABLAS
--------------------------------------------------------------------------------
--
--   EXISTENCIAS   lo que hay HOY: una fila por (manual, sucursal).
--   INVENTARIOS   el HISTORIAL de conteos: una fila por cada inventario hecho.
--
-- INVENTARIOS ya no tiene UNIQUE, asi que cada inventario es una fila nueva:
--
--   IND_CERRADO = 'N'   el conteo en curso. A LO SUMO UNO por (manual,
--                       sucursal): lo garantiza el indice INVENTARIOS_UN_ABIERTO
--                       que crea este script (seccion 2).
--   IND_CERRADO = 'S'   un inventario terminado. No se toca mas: es historia.
--
-- El inventario siguiente abre una fila nueva; no se reabre la vieja.
--
--------------------------------------------------------------------------------
-- LAS DOS CANTIDADES (decidido el 25/09/2026)
--------------------------------------------------------------------------------
--
--   CANTIDAD_SISTEMA  lo que decia EXISTENCIAS.CANTIDAD_ACTUAL al contar. NO se
--                     pide: la pone este paquete en cada guardado (0 si el
--                     manual no tiene fila en EXISTENCIAS para esa sucursal).
--   CANTIDAD_FISICA   lo que se conto en el estante. Es lo unico que se carga.
--
-- Al cerrar, EXISTENCIAS queda con la FISICA: corregir lo que dice el sistema
-- con lo que hay de verdad es para lo que existe el inventario.
--
--------------------------------------------------------------------------------
-- EL TRIGGER DE EXISTENCIAS SE REESCRIBE ACA (seccion 3)
--------------------------------------------------------------------------------
--
-- INVENTARIOS_ACTUALIZAR_EXISTENCIAS usaba :NEW.ID_INDICE, que ya no existe:
-- quedo INVALID y, mientras siga asi, CUALQUIER UPDATE sobre INVENTARIOS falla
-- con ORA-04098. Ahora busca EXISTENCIAS por MANUAL. Ademas:
--
--   - copia CANTIDAD_FISICA, no CANTIDAD_SISTEMA (con la de sistema, cerrar
--     dejaba EXISTENCIAS igual que estaba);
--   - actua solo en la TRANSICION a 'S', no en cualquier UPDATE de una fila
--     cerrada: retocar una fila vieja desde APEX volvia a pisar EXISTENCIAS;
--   - rechaza (-20002) cerrar sin cantidad fisica o sin manual, en vez de
--     chocar con los NOT NULL de EXISTENCIAS con un ORA crudo.
--
-- OJO: es AFTER UPDATE, no INSERT. Una fila que se INSERTA ya cerrada no toca
-- EXISTENCIAS. Por eso este paquete siempre inserta con 'N' y cierra con UPDATE.
--
-- Los otros dos triggers de la tabla no se tocan:
--
--   AUDITORIA_INVENTARIOS  -> INVENTARIOS_JN (el ANTES, como todos los AUDITORIA_*)
--   INVENTARIOS_JNTRG      -> FECHA = SYSDATE si viene NULL
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

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

  FOR t IN (SELECT 'INVENTARIOS' AS nombre FROM dual
            UNION ALL SELECT 'INDICES_MANUALES' FROM dual
            UNION ALL SELECT 'SUCURSALES' FROM dual
            UNION ALL SELECT 'EXISTENCIAS' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;

  -- El modelo por manual necesita INVENTARIOS.MANUAL y EXISTENCIAS.MANUAL.
  SELECT COUNT(*) INTO l_n FROM user_tab_columns
   WHERE (table_name = 'INVENTARIOS' AND column_name = 'MANUAL')
      OR (table_name = 'EXISTENCIAS' AND column_name = 'MANUAL');
  IF l_n < 2 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Falta la columna MANUAL en INVENTARIOS o en EXISTENCIAS.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) UN SOLO CONTEO ABIERTO POR (MANUAL, SUCURSAL) =======================
--
-- Sin UNIQUE en la tabla, dos personas contando el mismo manual a la vez
-- abririan dos filas, y el cierre pisaria EXISTENCIAS dos veces con conteos
-- distintos. Este indice lo impide en la base, no solo en el paquete.
--
-- Indexa solo las filas ABIERTAS: en las cerradas las dos expresiones dan NULL,
-- y Oracle no guarda en el indice las filas con todas las claves en NULL. Asi el
-- historial de cerradas puede repetir (manual, sucursal) todas las veces que haga
-- falta.
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_indexes WHERE index_name = 'INVENTARIOS_UN_ABIERTO';
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[SKIP] INVENTARIOS_UN_ABIERTO ya existe.');
    RETURN;
  END IF;

  -- Si ya hay duplicados (cargados desde APEX), crear el indice fallaria. Se
  -- avisa cuales son en vez de romper el script.
  SELECT COUNT(*) INTO l_n FROM (
      SELECT manual, id_sucursal
        FROM inventarios
       WHERE NVL(ind_cerrado, 'N') <> 'S'
       GROUP BY manual, id_sucursal
      HAVING COUNT(*) > 1);
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] Hay ' || l_n || ' manual(es) con MAS DE UN conteo abierto en la');
    DBMS_OUTPUT.PUT_LINE('       misma sucursal: no se crea INVENTARIOS_UN_ABIERTO. Para verlos:');
    DBMS_OUTPUT.PUT_LINE('       SELECT manual, id_sucursal, COUNT(*) FROM inventarios');
    DBMS_OUTPUT.PUT_LINE('        WHERE NVL(ind_cerrado,''N'') <> ''S''');
    DBMS_OUTPUT.PUT_LINE('        GROUP BY manual, id_sucursal HAVING COUNT(*) > 1;');
    DBMS_OUTPUT.PUT_LINE('       Borra o cerra los sobrantes y volve a correr el script.');
    RETURN;
  END IF;

  EXECUTE IMMEDIATE q'~
    CREATE UNIQUE INDEX INVENTARIOS_UN_ABIERTO ON INVENTARIOS (
      CASE WHEN NVL(IND_CERRADO, 'N') <> 'S' THEN MANUAL      END,
      CASE WHEN NVL(IND_CERRADO, 'N') <> 'S' THEN ID_SUCURSAL END)~';
  DBMS_OUTPUT.PUT_LINE('[OK]   INVENTARIOS_UN_ABIERTO creado.');
END;
/

--------------------------------------------------------------------------------
-- === 3) TRIGGER DE EXISTENCIAS (reescrito, ver encabezado) ==================
--------------------------------------------------------------------------------

CREATE OR REPLACE EDITIONABLE TRIGGER "INVENTARIOS_ACTUALIZAR_EXISTENCIAS"
AFTER UPDATE ON INVENTARIOS
FOR EACH ROW
BEGIN
  -- Solo al CERRAR (transicion a 'S'), no en cualquier UPDATE de una fila
  -- cerrada: si no, retocar una fila vieja vuelve a pisar EXISTENCIAS.
  IF :NEW.IND_CERRADO = 'S' AND NVL(:OLD.IND_CERRADO, 'N') <> 'S' THEN
    -- EXISTENCIAS tiene MANUAL y CANTIDAD_ACTUAL NOT NULL: sin esto el cierre
    -- falla con un ORA-01400 que no dice cual es el problema.
    IF :NEW.MANUAL IS NULL THEN
      RAISE_APPLICATION_ERROR(-20002,
          'No se puede cerrar el inventario ' || :NEW.ID_INVENTARIO || ': no tiene manual');
    END IF;
    IF :NEW.CANTIDAD_FISICA IS NULL THEN
      RAISE_APPLICATION_ERROR(-20002,
          'No se puede cerrar el inventario de ' || :NEW.MANUAL || ' sin cantidad fisica');
    END IF;

    -- La FISICA, no la de sistema. Ver el encabezado del script.
    --
    -- FECHA_ACTUALIZACION en hora LOCAL y al minuto (pedido el 25/09/2026): el
    -- servidor esta en UTC y SYSDATE pelado la dejaba 3 horas adelantada. Mismo
    -- criterio que f_ahora del paquete.
    UPDATE EXISTENCIAS
       SET CANTIDAD_ACTUAL     = :NEW.CANTIDAD_FISICA,
           FECHA_ACTUALIZACION = TRUNC(SYSDATE - 3/24, 'MI')
     WHERE MANUAL      = :NEW.MANUAL
       AND ID_SUCURSAL = :NEW.ID_SUCURSAL;

    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO EXISTENCIAS (ID_SUCURSAL, MANUAL, CANTIDAD_ACTUAL, FECHA_ACTUALIZACION)
      VALUES (:NEW.ID_SUCURSAL, :NEW.MANUAL, :NEW.CANTIDAD_FISICA,
              TRUNC(SYSDATE - 3/24, 'MI'));
    END IF;
  END IF;
END INVENTARIOS_ACTUALIZAR_EXISTENCIAS;
/

ALTER TRIGGER "INVENTARIOS_ACTUALIZAR_EXISTENCIAS" ENABLE;

--------------------------------------------------------------------------------
-- === 3b) TRIGGERS DE AUDITORIA QUE QUEDARON INVALID ========================
--
-- El 25/09/2026 se sacaron INVENTARIOS.ID_INDICE y EXISTENCIAS.ID_EXISTENCIA.
-- Los AUDITORIA_* nombran cada columna, asi que el que todavia nombre una que ya
-- no existe queda INVALID — y un trigger INVALID hace fallar TODO INSERT/UPDATE
-- de su tabla (ORA-04098). Con AUDITORIA_EXISTENCIAS eso rompe el cierre: el
-- trigger de existencias escribe EXISTENCIAS.
--
-- Se regeneran con pr_crear_trigger_auditoria (auditoria.sql), que arma el
-- trigger con las columnas ACTUALES. Solo si estan INVALID: uno sano no se toca.
-- Va con EXECUTE IMMEDIATE para que el script corra aunque el procedimiento no
-- exista; en ese caso avisa.
--------------------------------------------------------------------------------

DECLARE
  l_proc PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_proc FROM user_objects
   WHERE object_name = 'PR_CREAR_TRIGGER_AUDITORIA' AND object_type = 'PROCEDURE';

  FOR t IN (SELECT tr.table_name
              FROM user_triggers tr JOIN user_objects o ON o.object_name = tr.trigger_name
             WHERE tr.trigger_name IN ('AUDITORIA_INVENTARIOS', 'AUDITORIA_EXISTENCIAS')
               AND o.object_type = 'TRIGGER'
               AND o.status <> 'VALID') LOOP
    IF l_proc = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] AUDITORIA_' || t.table_name || ' esta INVALID y no existe');
      DBMS_OUTPUT.PUT_LINE('        pr_crear_trigger_auditoria. Corre backend/auditoria.sql y');
      DBMS_OUTPUT.PUT_LINE('        despues este script de nuevo.');
    ELSE
      BEGIN
        EXECUTE IMMEDIATE 'BEGIN pr_crear_trigger_auditoria(:t); END;' USING t.table_name;
        DBMS_OUTPUT.PUT_LINE('[OK]   AUDITORIA_' || t.table_name || ' regenerado con las columnas actuales.');
      EXCEPTION
        WHEN OTHERS THEN
          DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo regenerar AUDITORIA_' || t.table_name
                            || ': ' || SQLERRM);
      END;
    END IF;
  END LOOP;
END;
/

--------------------------------------------------------------------------------
-- === 4) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INVENTARIOS_ETHOS AS

  -- Las sucursales, con cuantos manuales tienen un conteo abierto.
  --
  -- NO LLAMARLO `sucursales`: se llamaba asi y el body no compilaba
  -- (PLS-00225, 25/09/2026). Dentro del paquete el nombre del procedimiento
  -- tapa al de la TABLA, y `sucursales.descripcion%TYPE` pasaba a apuntar a el.
  PROCEDURE listar_sucursales(p_token IN VARCHAR2);

  -- La planilla de una sucursal: TODOS los manuales de INDICES_MANUALES, se
  -- hayan contado o no.
  PROCEDURE planilla(p_token IN VARCHAR2, p_id_sucursal IN NUMBER);

  -- Guarda varios conteos en una transaccion. p_items: 'manual:cantidad'
  -- separados por ';', con el manual URL-encoded. Cantidad vacia = borrar el
  -- conteo abierto.
  PROCEDURE guardar_conteo(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER,
      p_items       IN VARCHAR2);

  -- Cierra TODO lo abierto de la sucursal. El trigger actualiza EXISTENCIAS.
  PROCEDURE cerrar(p_token IN VARCHAR2, p_id_sucursal IN NUMBER);

  -- La consulta de detalle: los conteos (pendientes y cerrados) de una sucursal
  -- o de todas, en un periodo. Es la fuente de la pantalla y del PDF.
  -- p_desde / p_hasta: 'YYYY-MM-DD', los dos inclusive.
  PROCEDURE historial(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_desde       IN VARCHAR2 DEFAULT NULL,
      p_hasta       IN VARCHAR2 DEFAULT NULL);

END PKG_INVENTARIOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INVENTARIOS_ETHOS AS

  -- Mensaje de las validaciones propias, para distinguirlas de un ORA.
  g_mensaje VARCHAR2(4000);
  e_validacion EXCEPTION;

  /* ---------------------------------------------------------------------- */
  /* Respuesta                                                              */
  /* ---------------------------------------------------------------------- */

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

  -- Traduce los ORA a algo accionable. El -20002 es el del trigger de
  -- existencias: su mensaje ya esta escrito para el usuario.
  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -20002 THEN
        p_error(409, 'Conflict', REGEXP_REPLACE(SQLERRM, '^ORA-[0-9]+: ', ''));
      WHEN SQLCODE = -1 THEN
        -- INVENTARIOS_UN_ABIERTO: otra persona abrio un conteo del mismo manual
        -- entre que se cargo la planilla y se guardo.
        p_error(409, 'Conflict',
                'Alguien mas abrio un conteo de este manual en la sucursal al mismo '
                || 'tiempo. Recarga la planilla y volve a intentar.');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La sucursal no existe. Recarga la planilla.');
      WHEN SQLCODE IN (-1438, -12899) THEN
        p_error(400, 'Bad Request', 'Una cantidad excede el largo permitido');
      WHEN SQLCODE = -4098 THEN
        -- Un trigger INVALID. Paso con INVENTARIOS_ACTUALIZAR_EXISTENCIAS al
        -- sacar ID_INDICE de la tabla: el arreglo es volver a correr este script.
        p_error(500, 'Internal Server Error',
                'Hay un trigger invalido en INVENTARIOS o EXISTENCIAS. '
                || 'Volve a correr backend/inventarios.sql. (' || SQLERRM || ')');
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

  ------------------------------------------------------------------------------
  -- LA HORA LOCAL, igual que TRG_INTERVENCIONES_SET_FECHA.
  --
  -- El servidor de oracleapex.com esta en UTC y Paraguay en UTC-3. Con SYSDATE
  -- pelado, un conteo de las 22:00 quedaria con fecha del dia siguiente.
  --
  -- AL MINUTO (pedido el 25/09/2026): la fecha se guarda con hora y minuto, sin
  -- segundos. El trigger de existencias usa la misma cuenta para
  -- FECHA_ACTUALIZACION. INVENTARIOS_JNTRG (FECHA si viene NULL) sigue con
  -- SYSDATE, y por eso aca la FECHA se manda siempre y no se deja al trigger.
  ------------------------------------------------------------------------------
  FUNCTION f_ahora RETURN DATE IS
  BEGIN
    RETURN TRUNC(SYSDATE - 3/24, 'MI');
  END f_ahora;

  -- Lo que dice EXISTENCIAS hoy. 0 si el manual no tiene fila en esa sucursal:
  -- nunca entro, asi que el sistema cree que no hay ninguno. EXISTENCIAS tiene
  -- UNIQUE (MANUAL, ID_SUCURSAL), asi que no puede venir mas de una.
  FUNCTION f_existencia(p_manual IN VARCHAR2, p_id_sucursal IN NUMBER) RETURN NUMBER IS
    l_cant NUMBER;
  BEGIN
    SELECT cantidad_actual INTO l_cant
      FROM existencias
     WHERE manual = p_manual AND id_sucursal = p_id_sucursal;
    RETURN NVL(l_cant, 0);
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN 0;
  END f_existencia;

  -- 401 si el token no sirve, 400/404 si la sucursal no. TRUE = seguir.
  FUNCTION f_validar(p_token IN VARCHAR2, p_id_sucursal IN NUMBER) RETURN BOOLEAN IS
    l_n PLS_INTEGER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN FALSE;
    END IF;
    IF p_id_sucursal IS NULL THEN
      p_error(400, 'Bad Request', 'id_sucursal es obligatorio'); RETURN FALSE;
    END IF;
    SELECT COUNT(*) INTO l_n FROM sucursales WHERE id_sucursal = p_id_sucursal;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'La sucursal ' || p_id_sucursal || ' no existe');
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END f_validar;

  /* ---------------------------------------------------------------------- */
  /* SUCURSALES                                                             */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar_sucursales(p_token IN VARCHAR2) IS
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT s.id_sucursal, s.descripcion,
               -- Abierto = todo lo que no esta cerrado, NULL incluido: una fila
               -- cargada desde APEX sin indicador tampoco impacto en EXISTENCIAS.
               (SELECT COUNT(*) FROM inventarios i
                 WHERE i.id_sucursal = s.id_sucursal
                   AND NVL(i.ind_cerrado, 'N') <> 'S') AS abiertos
          FROM sucursales s
         ORDER BY s.descripcion
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_sucursal', r.id_sucursal);
      APEX_JSON.WRITE('descripcion', r.descripcion);
      APEX_JSON.WRITE('abiertos',    r.abiertos);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar_sucursales;

  /* ---------------------------------------------------------------------- */
  /* PLANILLA                                                               */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Parte de INDICES_MANUALES, no de INVENTARIOS: la planilla tiene que mostrar
  -- tambien los manuales que todavia no se contaron.
  --
  -- Por manual trae tres cosas distintas, que no hay que confundir:
  --
  --   el conteo ABIERTO     lo que se esta contando ahora (a lo sumo uno)
  --   la EXISTENCIA         lo que dice el sistema hoy
  --   el ULTIMO CIERRE      el inventario anterior, como referencia
  --
  -- Los ROW_NUMBER son defensa: con INVENTARIOS_UN_ABIERTO no puede haber dos
  -- abiertos, pero si el indice no se pudo crear (duplicados de APEX, ver la
  -- seccion 2) sin esto el manual saldria dos veces en la planilla.
  ------------------------------------------------------------------------------
  PROCEDURE planilla(p_token IN VARCHAR2, p_id_sucursal IN NUMBER) IS
    l_desc         VARCHAR2(255);
    l_abiertos     PLS_INTEGER;
    l_sin_cantidad PLS_INTEGER;
  BEGIN
    IF NOT f_validar(p_token, p_id_sucursal) THEN RETURN; END IF;

    SELECT descripcion INTO l_desc FROM sucursales WHERE id_sucursal = p_id_sucursal;

    SELECT COUNT(*),
           COUNT(CASE WHEN cantidad_fisica IS NULL OR manual IS NULL THEN 1 END)
      INTO l_abiertos, l_sin_cantidad
      FROM inventarios
     WHERE id_sucursal = p_id_sucursal
       AND NVL(ind_cerrado, 'N') <> 'S';

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);

    APEX_JSON.OPEN_OBJECT('resumen');
    APEX_JSON.WRITE('id_sucursal',  p_id_sucursal);
    APEX_JSON.WRITE('descripcion',  l_desc);
    APEX_JSON.WRITE('abiertos',     l_abiertos);
    -- Abiertos sin fisica o sin manual. Desde la app no se pueden crear (vaciar
    -- la cantidad borra el conteo), pero si desde APEX; y bloquean el cierre.
    APEX_JSON.WRITE('sin_cantidad', l_sin_cantidad);
    APEX_JSON.CLOSE_OBJECT;

    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH cat AS (
            SELECT manual, COUNT(*) AS indices
              FROM indices_manuales
             GROUP BY manual
        ), abierto AS (
            SELECT id_inventario, manual, cantidad_fisica, cantidad_sistema, fecha,
                   ROW_NUMBER() OVER (PARTITION BY manual
                                      ORDER BY fecha DESC, id_inventario DESC) AS rn
              FROM inventarios
             WHERE id_sucursal = p_id_sucursal
               AND NVL(ind_cerrado, 'N') <> 'S'
        ), cierre AS (
            SELECT manual, cantidad_fisica, fecha,
                   ROW_NUMBER() OVER (PARTITION BY manual
                                      ORDER BY fecha DESC, id_inventario DESC) AS rn
              FROM inventarios
             WHERE id_sucursal = p_id_sucursal
               AND ind_cerrado = 'S'
        )
        SELECT c.manual, c.indices,
               a.id_inventario, a.cantidad_fisica, a.cantidad_sistema,
               TO_CHAR(a.fecha, 'DD/MM/YYYY HH24:MI')             AS fecha,
               e.cantidad_actual,
               TO_CHAR(e.fecha_actualizacion, 'DD/MM/YYYY HH24:MI') AS fecha_existencia,
               ci.cantidad_fisica                                 AS cierre_cantidad,
               TO_CHAR(ci.fecha, 'DD/MM/YYYY HH24:MI')            AS cierre_fecha
          FROM cat c
          LEFT JOIN abierto a      ON a.manual = c.manual AND a.rn = 1
          LEFT JOIN cierre ci      ON ci.manual = c.manual AND ci.rn = 1
          LEFT JOIN existencias e  ON e.manual = c.manual AND e.id_sucursal = p_id_sucursal
         ORDER BY c.manual
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('indices',           r.indices);
      APEX_JSON.WRITE('id_inventario',     r.id_inventario);
      APEX_JSON.WRITE('estado',
          CASE
            WHEN r.id_inventario   IS NOT NULL THEN 'ABIERTO'
            WHEN r.cierre_fecha    IS NOT NULL
              OR r.cierre_cantidad IS NOT NULL THEN 'CERRADO'
            ELSE 'SIN'
          END);
      APEX_JSON.WRITE('cantidad_fisica',   r.cantidad_fisica);
      APEX_JSON.WRITE('cantidad_sistema',  r.cantidad_sistema);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('existencia_actual', r.cantidad_actual);
      APEX_JSON.WRITE('fecha_existencia',  r.fecha_existencia);
      APEX_JSON.WRITE('cierre_cantidad',   r.cierre_cantidad);
      APEX_JSON.WRITE('cierre_fecha',      r.cierre_fecha);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END planilla;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR CONTEO                                                         */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- VARIOS CONTEOS, UNA TRANSACCION.
  --
  -- POR QUE `items` ES UN TEXTO Y NO UN ARRAY JSON: ORDS bindea solo los campos
  -- ESCALARES del body (:id_sucursal, :items). Un array obligaria a leer el body
  -- crudo (:body_text) y parsearlo aca, y referenciar el body crudo puede dejar
  -- sin bindear a los demas campos. Ningun otro script del proyecto lo hace.
  --
  -- EL MANUAL VIAJA URL-ENCODED ('MANUAL%201:5;MANUAL%202:'): es texto libre y
  -- podria traer ':' o ';', que son los separadores. encodeURIComponent los
  -- escapa del lado del front y UTL_URL.UNESCAPE los devuelve aca.
  --
  -- Por item:
  --
  --                      con cantidad              cantidad vacia
  --   sin conteo abierto INSERT abierto            nada
  --   con conteo abierto UPDATE                    DELETE (nunca impacto)
  --
  -- En los dos casos con cantidad, CANTIDAD_SISTEMA se vuelve a tomar de
  -- EXISTENCIAS: es "lo que decia el sistema cuando se conto".
  --
  -- Los cerrados no se tocan nunca: contar un manual ya cerrado abre un conteo
  -- NUEVO, y el cerrado queda como historia.
  --
  -- Todo o nada: un item invalido deshace los anteriores.
  ------------------------------------------------------------------------------
  PROCEDURE guardar_conteo(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER,
      p_items       IN VARCHAR2
  ) IS
    l_items      APEX_T_VARCHAR2;
    l_par        APEX_T_VARCHAR2;
    l_manual     VARCHAR2(400);
    l_texto      VARCHAR2(50);
    l_cant       NUMBER;
    l_id_inv     NUMBER;
    l_n          PLS_INTEGER;
    l_sistema    NUMBER;
    l_fecha      DATE;
    l_guardados  PLS_INTEGER := 0;
    l_borrados   PLS_INTEGER := 0;
  BEGIN
    IF NOT f_validar(p_token, p_id_sucursal) THEN RETURN; END IF;
    IF TRIM(p_items) IS NULL THEN
      p_error(400, 'Bad Request', 'No hay conteos para guardar'); RETURN;
    END IF;

    l_items := APEX_STRING.SPLIT(TRIM(p_items), ';');

    FOR k IN 1 .. l_items.COUNT LOOP
      CONTINUE WHEN TRIM(l_items(k)) IS NULL; -- un ';' de mas al final

      l_par := APEX_STRING.SPLIT(l_items(k), ':');
      IF l_par.COUNT <> 2 OR TRIM(l_par(1)) IS NULL THEN
        g_mensaje := 'Item mal formado: "' || l_items(k) || '"'; RAISE e_validacion;
      END IF;
      l_manual := UTL_URL.UNESCAPE(TRIM(l_par(1)), 'AL32UTF8');
      l_texto  := TRIM(l_par(2));

      -- Enteros y no negativos: son libros en un estante.
      IF l_texto IS NOT NULL AND NOT REGEXP_LIKE(l_texto, '^[0-9]{1,7}$') THEN
        g_mensaje := 'La cantidad de ' || l_manual
                  || ' tiene que ser un numero entero, sin signo';
        RAISE e_validacion;
      END IF;
      l_cant := TO_NUMBER(l_texto);

      -- El manual tiene que existir en el catalogo: no hay FK que lo controle,
      -- y un typo crearia un "manual" nuevo en EXISTENCIAS al cerrar.
      SELECT COUNT(*) INTO l_n FROM indices_manuales WHERE manual = l_manual;
      IF l_n = 0 THEN
        g_mensaje := 'El manual "' || l_manual || '" no existe'; RAISE e_validacion;
      END IF;

      -- El conteo abierto, bloqueado: entre este SELECT y el UPDATE nadie lo
      -- cierra.
      BEGIN
        SELECT id_inventario INTO l_id_inv
          FROM inventarios
         WHERE manual = l_manual AND id_sucursal = p_id_sucursal
           AND NVL(ind_cerrado, 'N') <> 'S'
           FOR UPDATE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN l_id_inv := NULL;
        WHEN TOO_MANY_ROWS THEN
          -- Solo posible si INVENTARIOS_UN_ABIERTO no se pudo crear.
          g_mensaje := l_manual || ' tiene mas de un conteo abierto en esta sucursal. '
                    || 'Hay que dejar uno solo desde APEX.';
          RAISE e_validacion;
      END;

      IF l_cant IS NULL THEN
        IF l_id_inv IS NOT NULL THEN
          DELETE FROM inventarios WHERE id_inventario = l_id_inv;
          l_borrados := l_borrados + 1;
        END IF;

      ELSE
        -- FUERA del INSERT/UPDATE: f_existencia y f_ahora son privadas del body
        -- y Oracle no deja llamarlas desde una sentencia SQL (PLS-00231). Es la
        -- misma trampa que anota intervenciones_crud.sql.
        l_sistema := f_existencia(l_manual, p_id_sucursal);
        l_fecha   := f_ahora;

        IF l_id_inv IS NULL THEN
          -- Siempre 'N': el trigger de existencias es AFTER UPDATE y una fila
          -- insertada ya cerrada no impactaria nunca.
          INSERT INTO inventarios (
              id_sucursal, manual, cantidad_fisica, cantidad_sistema, fecha, ind_cerrado)
          VALUES (
              p_id_sucursal, l_manual, l_cant, l_sistema, l_fecha, 'N');
        ELSE
          UPDATE inventarios
             SET cantidad_fisica  = l_cant,
                 cantidad_sistema = l_sistema,
                 fecha            = l_fecha
           WHERE id_inventario = l_id_inv;
        END IF;
        l_guardados := l_guardados + 1;
      END IF;
    END LOOP;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',   TRUE);
    APEX_JSON.WRITE('guardados', l_guardados);
    APEX_JSON.WRITE('borrados',  l_borrados);
    APEX_JSON.WRITE('message',   'Conteo guardado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar_conteo;

  /* ---------------------------------------------------------------------- */
  /* CERRAR                                                                 */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- CIERRA TODO LO ABIERTO DE LA SUCURSAL, de todos los manuales.
  --
  -- Es un solo UPDATE: el trigger de existencias corre por fila y, si alguna
  -- falla, Oracle deshace la sentencia entera. No puede quedar la mitad cerrada.
  --
  -- **No tiene vuelta atras desde la app.** El valor anterior de EXISTENCIAS
  -- queda en EXISTENCIAS_JN si hiciera falta.
  ------------------------------------------------------------------------------
  PROCEDURE cerrar(p_token IN VARCHAR2, p_id_sucursal IN NUMBER) IS
    l_sin_cantidad PLS_INTEGER;
    l_n            PLS_INTEGER;
  BEGIN
    IF NOT f_validar(p_token, p_id_sucursal) THEN RETURN; END IF;

    -- Se valida antes para dar un mensaje con el total, en vez del -20002 del
    -- trigger, que nombra solo la primera fila que encuentra.
    SELECT COUNT(*) INTO l_sin_cantidad
      FROM inventarios
     WHERE id_sucursal = p_id_sucursal
       AND NVL(ind_cerrado, 'N') <> 'S'
       AND (cantidad_fisica IS NULL OR manual IS NULL);
    IF l_sin_cantidad > 0 THEN
      p_error(409, 'Conflict',
              l_sin_cantidad || ' conteo(s) abiertos no tienen cantidad fisica o manual. '
              || 'Completalos o borralos antes de cerrar.');
      RETURN;
    END IF;

    UPDATE inventarios
       SET ind_cerrado = 'S'
     WHERE id_sucursal = p_id_sucursal
       AND NVL(ind_cerrado, 'N') <> 'S';
    l_n := SQL%ROWCOUNT;

    IF l_n = 0 THEN
      ROLLBACK;
      p_error(409, 'Conflict', 'No hay conteos abiertos en esta sucursal');
      RETURN;
    END IF;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('cerrados', l_n);
    APEX_JSON.WRITE('message', 'Inventario cerrado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END cerrar;

  /* ---------------------------------------------------------------------- */
  /* HISTORIAL (consulta de detalle y PDF)                                  */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Todos los conteos que cumplen el filtro, sin paginar: es un REPORTE, y el
  -- PDF tiene que salir completo. Tiene un tope (c_tope_historial) para que un
  -- rango sin limite no arme una respuesta de megas; si se alcanza, `truncado`
  -- viaja en true y la pantalla lo avisa.
  --
  -- `estado`: 'N' pendientes (abiertos), 'S' cerrados, NULL los dos. Abierto es
  -- todo lo que no es 'S', NULL incluido, igual que en el resto del paquete.
  --
  -- El rango filtra por INVENTARIOS.FECHA, que es la del conteo (no la del
  -- cierre: esa no tiene columna).
  ------------------------------------------------------------------------------
  PROCEDURE historial(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_desde       IN VARCHAR2 DEFAULT NULL,
      p_hasta       IN VARCHAR2 DEFAULT NULL
  ) IS
    c_tope_historial CONSTANT PLS_INTEGER := 5000;
    -- 20 y no 2: un ?estado=cerrado romperia en la declaracion (ORA-06502),
    -- antes de que el EXCEPTION del procedimiento pueda atraparlo.
    l_estado VARCHAR2(20) := UPPER(TRIM(SUBSTR(p_estado, 1, 20)));
    l_desde  DATE;
    l_hasta  DATE;
    l_n      PLS_INTEGER := 0;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF l_estado NOT IN ('S', 'N') THEN l_estado := NULL; END IF;

    BEGIN
      l_desde := TO_DATE(TRIM(p_desde), 'YYYY-MM-DD');
      -- +1 y comparacion con "<": el dia HASTA entra entero, horas incluidas.
      l_hasta := TO_DATE(TRIM(p_hasta), 'YYYY-MM-DD') + 1;
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'Las fechas deben venir como YYYY-MM-DD'); RETURN;
    END;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT i.id_inventario, i.id_sucursal, s.descripcion AS sucursal, i.manual,
               i.cantidad_sistema, i.cantidad_fisica,
               TO_CHAR(i.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
               CASE WHEN i.ind_cerrado = 'S' THEN 'CERRADO' ELSE 'ABIERTO' END AS estado
          FROM inventarios i
          JOIN sucursales s ON s.id_sucursal = i.id_sucursal
         WHERE (p_id_sucursal IS NULL OR i.id_sucursal = p_id_sucursal)
           AND (l_estado IS NULL
                OR (l_estado = 'S' AND i.ind_cerrado = 'S')
                OR (l_estado = 'N' AND NVL(i.ind_cerrado, 'N') <> 'S'))
           AND (l_desde IS NULL OR i.fecha >= l_desde)
           AND (l_hasta IS NULL OR i.fecha <  l_hasta)
         -- Agrupado por sucursal (asi lo arma el PDF) y lo mas nuevo arriba.
         ORDER BY s.descripcion, i.fecha DESC, i.manual
         FETCH FIRST c_tope_historial + 1 ROWS ONLY
    ) LOOP
      l_n := l_n + 1;
      -- La fila c_tope+1 solo existe para saber si hubo mas: no se escribe.
      EXIT WHEN l_n > c_tope_historial;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_inventario',    r.id_inventario);
      APEX_JSON.WRITE('id_sucursal',      r.id_sucursal);
      APEX_JSON.WRITE('sucursal',         r.sucursal);
      APEX_JSON.WRITE('manual',           r.manual);
      APEX_JSON.WRITE('cantidad_sistema', r.cantidad_sistema);
      APEX_JSON.WRITE('cantidad_fisica',  r.cantidad_fisica);
      APEX_JSON.WRITE('fecha',            r.fecha);
      APEX_JSON.WRITE('estado',           r.estado);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > c_tope_historial);
    APEX_JSON.WRITE('tope',     c_tope_historial);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END historial;

END PKG_INVENTARIOS_ETHOS;
/

--------------------------------------------------------------------------------
-- === 5) ENDPOINTS ORDS ======================================================
--
-- Se agregan al modulo 'ethos' que creo auth.sql.
-- El DEFINE_PARAMETER del header Authorization va por CADA handler: si falta,
-- :authorization llega NULL y todo responde "Token invalido".
--------------------------------------------------------------------------------

DECLARE
  -- El bloque que extrae el token del header, identico en los cuatro handlers.
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
  -- Idempotencia: se borra lo que hubiera de una corrida anterior.
  FOR r IN (SELECT 'inventarios' AS p FROM dual
            UNION ALL SELECT 'inventarios/sucursales' FROM dual
            UNION ALL SELECT 'inventarios/conteo' FROM dual
            UNION ALL SELECT 'inventarios/cerrar' FROM dual
            UNION ALL SELECT 'inventarios/historial' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- Sin templates con :id, asi que la prioridad no decide nada: todas en 0.
  FOR r IN (SELECT 'inventarios' AS p FROM dual
            UNION ALL SELECT 'inventarios/sucursales' FROM dual
            UNION ALL SELECT 'inventarios/conteo' FROM dual
            UNION ALL SELECT 'inventarios/cerrar' FROM dual
            UNION ALL SELECT 'inventarios/historial' FROM dual) LOOP
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => r.p,
        p_priority    => 0,
        p_etag_type   => 'NONE');
  END LOOP;

  handler('inventarios', 'GET', '
    PKG_INVENTARIOS_ETHOS.PLANILLA(
        p_token       => l_token,
        p_id_sucursal => TO_NUMBER(:id_sucursal));');

  handler('inventarios/sucursales', 'GET', '
    PKG_INVENTARIOS_ETHOS.LISTAR_SUCURSALES(p_token => l_token);');

  handler('inventarios/conteo', 'POST', '
    PKG_INVENTARIOS_ETHOS.GUARDAR_CONTEO(
        p_token       => l_token,
        p_id_sucursal => TO_NUMBER(:id_sucursal),
        p_items       => :items);');

  handler('inventarios/cerrar', 'POST', '
    PKG_INVENTARIOS_ETHOS.CERRAR(
        p_token       => l_token,
        p_id_sucursal => TO_NUMBER(:id_sucursal));');

  handler('inventarios/historial', 'GET', '
    PKG_INVENTARIOS_ETHOS.HISTORIAL(
        p_token       => l_token,
        p_id_sucursal => TO_NUMBER(:id_sucursal),
        p_estado      => :estado,
        p_desde       => :desde,
        p_hasta       => :hasta);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de inventarios publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS: producción (Pages) y el APK le pegan DIRECTO a ORDS.
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
  preflight('inventarios');
  preflight('inventarios/sucursales');
  preflight('inventarios/conteo');
  preflight('inventarios/cerrar');
  preflight('inventarios/historial');
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
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_INVENTARIOS_ETHOS' AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INVENTARIOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    inventarios/sucursales');
    DBMS_OUTPUT.PUT_LINE('       GET    inventarios ?id_sucursal=');
    DBMS_OUTPUT.PUT_LINE('       POST   inventarios/conteo');
    DBMS_OUTPUT.PUT_LINE('       POST   inventarios/cerrar');
    DBMS_OUTPUT.PUT_LINE('       GET    inventarios/historial ?id_sucursal=&estado=&desde=&hasta=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INVENTARIOS_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_INVENTARIOS_ETHOS'';');
  END IF;

  -- `o.status` y no `status` a secas: user_triggers TAMBIEN tiene una columna
  -- STATUS (ENABLED/DISABLED) y sin prefijo Oracle corta con ORA-00918.
  SELECT o.status INTO l_estado
    FROM user_triggers t JOIN user_objects o ON o.object_name = t.trigger_name
   WHERE t.trigger_name = 'INVENTARIOS_ACTUALIZAR_EXISTENCIAS'
     AND o.object_type = 'TRIGGER';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   INVENTARIOS_ACTUALIZAR_EXISTENCIAS: al cerrar copia la FISICA por MANUAL.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] INVENTARIOS_ACTUALIZAR_EXISTENCIAS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''INVENTARIOS_ACTUALIZAR_EXISTENCIAS'';');
  END IF;

  -- Otros triggers de las dos tablas que hayan quedado INVALID al sacar
  -- ID_INDICE: cualquiera de ellos hace fallar todo INSERT/UPDATE (ORA-04098).
  FOR t IN (SELECT o.object_name
              FROM user_triggers tr JOIN user_objects o ON o.object_name = tr.trigger_name
             WHERE tr.table_name IN ('INVENTARIOS', 'EXISTENCIAS')
               AND o.object_type = 'TRIGGER'
               AND o.status <> 'VALID') LOOP
    DBMS_OUTPUT.PUT_LINE('[ERROR] Trigger INVALID: ' || t.object_name
                      || '. Todo INSERT/UPDATE de su tabla falla hasta arreglarlo.');
  END LOOP;

  -- Conteos abiertos que bloquean el cierre de su sucursal. Mejor saberlo
  -- ahora que con el boton "Cerrar" en la mano.
  SELECT COUNT(*) INTO l_n FROM inventarios
   WHERE NVL(ind_cerrado, 'N') <> 'S'
     AND (cantidad_fisica IS NULL OR manual IS NULL);
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('       [AVISO] ' || l_n || ' conteo(s) abiertos sin cantidad fisica o sin manual.');
    DBMS_OUTPUT.PUT_LINE('               Su sucursal no se va a poder cerrar hasta completarlos.');
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INVENTARIOS_ETHOS o el trigger no se crearon.');
END;
/
