--------------------------------------------------------------------------------
-- TRANSFERENCIAS  —  envio de manuales entre sucursales (cabecera y detalle)
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     transferencias           ?estado=&id_sucursal=&limite=&pagina=
--   GET     transferencias/manuales  ?id_sucursal=&excluir_id=
--                                    el catalogo, con lo que hay y lo comprometido
--                                    en la sucursal de origen
--   GET     transferencias/:id       cabecera + detalle
--   POST    transferencias           {id_sucursal_origen, id_sucursal_destino, items}
--   PUT     transferencias/:id       idem (solo pendientes)
--   POST    transferencias/:id/recibir
--   DELETE  transferencias/:id       (solo pendientes)
--   GET     transferencias/historial ?estado=&id_sucursal=&desde=&hasta=
--                                    la consulta y el PDF: una fila por linea
--
-- CORRER DESPUES de auth.sql e inventarios.sql: la pantalla usa el combo de
-- sucursales de `inventarios/sucursales`. El paquete no depende de ningun otro.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- LAS EXISTENCIAS SE MUEVEN AL RECIBIR, Y LAS MUEVE EL TRIGGER (25/09/2026)
--------------------------------------------------------------------------------
--
-- TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS (AFTER UPDATE, ya estaba en la base y
-- este script NO lo toca) actua al pasar IND_RECIBIDA a 'S': resta del origen y
-- suma al destino cada linea del detalle. Este paquete NUNCA escribe EXISTENCIAS.
--
-- Consecuencias que el paquete y la pantalla tienen en cuenta:
--
--   1. MIENTRAS VIAJA, EL ORIGEN TODAVIA LOS TIENE. Por eso "disponible" no es
--      EXISTENCIAS a secas: es EXISTENCIAS menos lo COMPROMETIDO en otras
--      transferencias pendientes que salen de esa sucursal.
--
--   2. UNA RECIBIDA NO SE TOCA MAS. Editarla o borrarla no deshace el movimiento
--      (no hay trigger inverso). `guardar` y `eliminar` la rechazan con 409.
--
--   3. EL ORIGEN TIENE QUE TENER FILA EN EXISTENCIAS. El trigger resta con un
--      UPDATE: si el manual no tiene fila en el origen, no resta nada y el destino
--      recibe manuales salidos de ningun lado. `recibir` crea antes esas filas en
--      0, asi la resta las deja en negativo y la diferencia queda A LA VISTA en
--      vez de perderse. (Decidido: si falta stock se avisa pero se permite.)
--
--   4. RIESGO CONOCIDO: si se CIERRA un inventario del origen mientras la
--      transferencia viaja, EXISTENCIAS queda con lo contado (ya sin esos
--      manuales) y al recibir el trigger los resta OTRA VEZ. La pantalla de
--      recepcion lo advierte; la regla es recibir antes de inventariar.
--
--------------------------------------------------------------------------------
-- EL DETALLE: UNA LINEA POR MANUAL
--------------------------------------------------------------------------------
--
-- El manual es el texto de INDICES_MANUALES.MANUAL (no hay tabla de manuales),
-- igual que en inventarios.sql. Una transferencia no puede repetir un manual:
-- dos lineas del mismo manual son la misma cosa escrita dos veces.
--
-- `guardar` compara lo que llega con lo que hay y hace UPDATE / INSERT / DELETE
-- solo de lo que cambio, en vez de borrar y recrear todo: asi la bitacora
-- TRANSFERENCIAS_DETALLE_JN muestra el cambio real y no ruido.
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

  FOR t IN (SELECT 'TRANSFERENCIAS' AS nombre FROM dual
            UNION ALL SELECT 'TRANSFERENCIAS_DETALLE' FROM dual
            UNION ALL SELECT 'EXISTENCIAS' FROM dual
            UNION ALL SELECT 'INDICES_MANUALES' FROM dual
            UNION ALL SELECT 'SUCURSALES' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_TRANSFERENCIAS_ETHOS AS

  -- Lista paginada. p_estado: 'N' pendientes, 'S' recibidas, NULL todas.
  -- p_id_sucursal: las que SALEN o LLEGAN a esa sucursal.
  PROCEDURE listar(
      p_token       IN VARCHAR2,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_limite      IN NUMBER   DEFAULT NULL,
      p_pagina      IN NUMBER   DEFAULT NULL);

  -- El catalogo de manuales con lo que hay en la sucursal y lo comprometido en
  -- transferencias pendientes que salen de ella (sin contar p_excluir_id, que es
  -- la que se esta editando).
  PROCEDURE manuales(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER,
      p_excluir_id  IN NUMBER DEFAULT NULL);

  -- Cabecera + detalle.
  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN NUMBER);

  -- Alta (p_id NULL) o modificacion de una PENDIENTE. p_items: 'manual:cantidad'
  -- separados por ';', con el manual URL-encoded.
  PROCEDURE guardar(
      p_token      IN VARCHAR2,
      p_id         IN NUMBER,
      p_id_origen  IN NUMBER,
      p_id_destino IN NUMBER,
      p_items      IN VARCHAR2);

  -- Confirma la recepcion: el trigger mueve las existencias.
  PROCEDURE recibir(p_token IN VARCHAR2, p_id IN NUMBER);

  -- Baja de una PENDIENTE, con su detalle.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER);

  -- La consulta y el PDF: UNA FILA POR LINEA DE DETALLE, con la cabecera
  -- repetida. p_id_sucursal: las que salen O llegan a esa sucursal.
  -- p_desde / p_hasta: 'YYYY-MM-DD', los dos inclusive, sobre la FECHA de alta.
  PROCEDURE historial(
      p_token       IN VARCHAR2,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_desde       IN VARCHAR2 DEFAULT NULL,
      p_hasta       IN VARCHAR2 DEFAULT NULL);

END PKG_TRANSFERENCIAS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_TRANSFERENCIAS_ETHOS AS

  c_limite_defecto CONSTANT PLS_INTEGER := 50;
  c_limite_maximo  CONSTANT PLS_INTEGER := 200;

  -- Mensaje de las validaciones propias, para distinguirlas de un ORA.
  g_mensaje VARCHAR2(4000);
  g_status  PLS_INTEGER;
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

  -- Levanta e_validacion con su status. 400 por defecto.
  PROCEDURE rechazar(p_mensaje IN VARCHAR2, p_status IN PLS_INTEGER DEFAULT 400) IS
  BEGIN
    g_mensaje := p_mensaje;
    g_status  := p_status;
    RAISE e_validacion;
  END rechazar;

  PROCEDURE p_error_validacion IS
  BEGIN
    p_error(g_status,
            CASE g_status WHEN 404 THEN 'Not Found' WHEN 409 THEN 'Conflict'
                          ELSE 'Bad Request' END,
            g_mensaje);
  END p_error_validacion;

  -- Traduce los ORA a algo accionable.
  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'Alguna de las sucursales no existe. Recarga la pantalla.');
      WHEN SQLCODE IN (-1438, -12899) THEN
        p_error(400, 'Bad Request', 'Una cantidad o un texto excede el largo permitido');
      WHEN SQLCODE = -4098 THEN
        -- Un trigger INVALID en TRANSFERENCIAS, su detalle o EXISTENCIAS.
        p_error(500, 'Internal Server Error',
                'Hay un trigger invalido en transferencias o existencias. ('
                || SQLERRM || ')');
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

  -- La hora local (UTC-3) y al minuto, igual que f_ahora de inventarios.sql: el
  -- servidor de oracleapex.com esta en UTC. El DEFAULT SYSDATE de la columna no
  -- se usa.
  FUNCTION f_ahora RETURN DATE IS
  BEGIN
    RETURN TRUNC(SYSDATE - 3/24, 'MI');
  END f_ahora;

  -- 'S' / 'N' de una transferencia, bloqueandola. Rechaza si no existe.
  FUNCTION f_estado_bloqueado(p_id IN NUMBER) RETURN VARCHAR2 IS
    l_estado VARCHAR2(2);
  BEGIN
    SELECT NVL(ind_recibida, 'N') INTO l_estado
      FROM transferencias WHERE id_transferencia = p_id
       FOR UPDATE;
    RETURN l_estado;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      rechazar('La transferencia ' || p_id || ' no existe', 404);
      RETURN NULL;
  END f_estado_bloqueado;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(
      p_token       IN VARCHAR2,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_limite      IN NUMBER   DEFAULT NULL,
      p_pagina      IN NUMBER   DEFAULT NULL
  ) IS
    -- 20 y no 2: un ?estado=pendiente romperia ACA, en la declaracion, antes de
    -- que el EXCEPTION del procedimiento pueda atraparlo (ORA-06502 crudo).
    l_estado VARCHAR2(20) := UPPER(TRIM(SUBSTR(p_estado, 1, 20)));
    l_tope   PLS_INTEGER;
    l_pagina PLS_INTEGER;
    l_offset PLS_INTEGER;
    l_total  PLS_INTEGER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF l_estado NOT IN ('S', 'N') THEN l_estado := NULL; END IF;

    l_tope   := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);
    l_pagina := GREATEST(NVL(p_pagina, 1), 1);
    l_offset := (l_pagina - 1) * l_tope;

    SELECT COUNT(*) INTO l_total
      FROM transferencias t
     WHERE (l_estado IS NULL OR NVL(t.ind_recibida, 'N') = l_estado)
       AND (p_id_sucursal IS NULL
            OR p_id_sucursal IN (t.id_sucursal_origen, t.id_sucursal_destino));

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT t.id_transferencia,
               t.id_sucursal_origen,  so.descripcion AS origen,
               t.id_sucursal_destino, sd.descripcion AS destino,
               TO_CHAR(t.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
               NVL(t.ind_recibida, 'N') AS ind_recibida,
               (SELECT COUNT(*) FROM transferencias_detalle d
                 WHERE d.id_transferencia = t.id_transferencia) AS lineas,
               (SELECT NVL(SUM(d.cantidad), 0) FROM transferencias_detalle d
                 WHERE d.id_transferencia = t.id_transferencia) AS unidades,
               -- Los manuales, para que la tarjeta diga QUE se envia sin tener
               -- que abrirla (el front la corta a dos lineas). Un solo nivel de
               -- subconsulta: correlacionar una vista en linea con `t` da
               -- ORA-00904 segun la version de Oracle.
               (SELECT LISTAGG(d.manual, ', ' ON OVERFLOW TRUNCATE '…' WITHOUT COUNT)
                         WITHIN GROUP (ORDER BY d.manual)
                  FROM transferencias_detalle d
                 WHERE d.id_transferencia = t.id_transferencia) AS resumen
          FROM transferencias t
          JOIN sucursales so ON so.id_sucursal = t.id_sucursal_origen
          JOIN sucursales sd ON sd.id_sucursal = t.id_sucursal_destino
         WHERE (l_estado IS NULL OR NVL(t.ind_recibida, 'N') = l_estado)
           AND (p_id_sucursal IS NULL
                OR p_id_sucursal IN (t.id_sucursal_origen, t.id_sucursal_destino))
         -- Pendientes primero: son las que piden algo (recibirlas).
         ORDER BY NVL(t.ind_recibida, 'N'), t.fecha DESC, t.id_transferencia DESC
         OFFSET l_offset ROWS FETCH NEXT l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_transferencia',    r.id_transferencia);
      APEX_JSON.WRITE('id_sucursal_origen',  r.id_sucursal_origen);
      APEX_JSON.WRITE('origen',              r.origen);
      APEX_JSON.WRITE('id_sucursal_destino', r.id_sucursal_destino);
      APEX_JSON.WRITE('destino',             r.destino);
      APEX_JSON.WRITE('fecha',               r.fecha);
      APEX_JSON.WRITE('ind_recibida',        r.ind_recibida);
      APEX_JSON.WRITE('lineas',              r.lineas);
      APEX_JSON.WRITE('unidades',            r.unidades);
      APEX_JSON.WRITE('resumen',             r.resumen);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* MANUALES (el combo del detalle)                                        */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Por manual: `existencia` (lo que dice EXISTENCIAS hoy) y `comprometido` (lo
  -- que sale en OTRAS transferencias pendientes desde esta sucursal). Lo
  -- disponible es la resta, y lo calcula el front: asi puede mostrar las dos
  -- cosas y explicar de donde sale el numero.
  --
  -- p_excluir_id: al editar, las lineas de la propia transferencia no cuentan
  -- como comprometidas — si no, editarla "se quitaria stock a si misma".
  ------------------------------------------------------------------------------
  PROCEDURE manuales(
      p_token       IN VARCHAR2,
      p_id_sucursal IN NUMBER,
      p_excluir_id  IN NUMBER DEFAULT NULL
  ) IS
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH cat AS (
            SELECT DISTINCT manual FROM indices_manuales
        ), comp AS (
            SELECT d.manual, SUM(d.cantidad) AS cantidad
              FROM transferencias t
              JOIN transferencias_detalle d ON d.id_transferencia = t.id_transferencia
             WHERE t.id_sucursal_origen = p_id_sucursal
               AND NVL(t.ind_recibida, 'N') <> 'S'
               AND (p_excluir_id IS NULL OR t.id_transferencia <> p_excluir_id)
             GROUP BY d.manual
        )
        SELECT c.manual,
               e.cantidad_actual        AS existencia,
               NVL(cp.cantidad, 0)      AS comprometido
          FROM cat c
          LEFT JOIN existencias e ON e.manual = c.manual AND e.id_sucursal = p_id_sucursal
          LEFT JOIN comp cp       ON cp.manual = c.manual
         ORDER BY c.manual
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('manual',       r.manual);
      APEX_JSON.WRITE('existencia',   r.existencia);
      APEX_JSON.WRITE('comprometido', r.comprometido);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END manuales;

  /* ---------------------------------------------------------------------- */
  /* OBTENER                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN NUMBER) IS
    l_n PLS_INTEGER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    SELECT COUNT(*) INTO l_n FROM transferencias WHERE id_transferencia = p_id;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'Transferencia no encontrada'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_OBJECT('data');

    FOR r IN (
        SELECT t.id_transferencia,
               t.id_sucursal_origen,  so.descripcion AS origen,
               t.id_sucursal_destino, sd.descripcion AS destino,
               TO_CHAR(t.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
               NVL(t.ind_recibida, 'N') AS ind_recibida
          FROM transferencias t
          JOIN sucursales so ON so.id_sucursal = t.id_sucursal_origen
          JOIN sucursales sd ON sd.id_sucursal = t.id_sucursal_destino
         WHERE t.id_transferencia = p_id
    ) LOOP
      APEX_JSON.WRITE('id_transferencia',    r.id_transferencia);
      APEX_JSON.WRITE('id_sucursal_origen',  r.id_sucursal_origen);
      APEX_JSON.WRITE('origen',              r.origen);
      APEX_JSON.WRITE('id_sucursal_destino', r.id_sucursal_destino);
      APEX_JSON.WRITE('destino',             r.destino);
      APEX_JSON.WRITE('fecha',               r.fecha);
      APEX_JSON.WRITE('ind_recibida',        r.ind_recibida);
    END LOOP;

    -- La fecha de recepcion no tiene columna: sale de la bitacora, que guarda
    -- el ANTES en cada UPD. La fila con IND_RECIBIDA='N' mas reciente es la del
    -- UPDATE que la marco como recibida.
    FOR r IN (
        SELECT TO_CHAR(MAX(j.jn_datetime) - 3/24, 'DD/MM/YYYY HH24:MI') AS recibida_el,
               MAX(j.jn_oracle_user) KEEP (DENSE_RANK LAST ORDER BY j.jn_datetime)
                 AS recibida_por
          FROM transferencias_jn j
         WHERE j.id_transferencia = p_id
           AND j.jn_operation = 'UPD'
           AND NVL(j.ind_recibida, 'N') = 'N'
           AND EXISTS (SELECT 1 FROM transferencias t
                        WHERE t.id_transferencia = p_id AND t.ind_recibida = 'S')
    ) LOOP
      APEX_JSON.WRITE('recibida_el',  r.recibida_el);
      APEX_JSON.WRITE('recibida_por', r.recibida_por);
    END LOOP;

    APEX_JSON.OPEN_ARRAY('detalle');
    FOR r IN (
        SELECT id_detalle, manual, cantidad
          FROM transferencias_detalle
         WHERE id_transferencia = p_id
         ORDER BY manual
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_detalle', r.id_detalle);
      APEX_JSON.WRITE('manual',     r.manual);
      APEX_JSON.WRITE('cantidad',   r.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.CLOSE_OBJECT;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END obtener;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Alta o modificacion, cabecera y detalle en UNA transaccion.
  --
  -- `items` viaja como texto y no como array JSON por lo mismo que en
  -- inventarios.sql: ORDS bindea solo los campos escalares del body. El manual va
  -- URL-encoded porque es texto libre y podria traer los separadores ':' o ';'.
  --
  -- El detalle se compara con lo que ya habia: UPDATE de lo que cambio de
  -- cantidad, INSERT de lo nuevo, DELETE de lo que ya no esta. Ver el encabezado.
  ------------------------------------------------------------------------------
  PROCEDURE guardar(
      p_token      IN VARCHAR2,
      p_id         IN NUMBER,
      p_id_origen  IN NUMBER,
      p_id_destino IN NUMBER,
      p_items      IN VARCHAR2
  ) IS
    l_id        NUMBER := p_id;
    l_items     APEX_T_VARCHAR2;
    l_par       APEX_T_VARCHAR2;
    l_manuales  APEX_T_VARCHAR2 := APEX_T_VARCHAR2();
    l_cants     APEX_T_NUMBER   := APEX_T_NUMBER();
    l_manual    VARCHAR2(400);
    l_texto     VARCHAR2(50);
    l_n         PLS_INTEGER;
    l_fecha     DATE;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    -- ── Cabecera ──────────────────────────────────────────────────────────
    IF p_id_origen IS NULL OR p_id_destino IS NULL THEN
      rechazar('Elegi la sucursal de origen y la de destino');
    END IF;
    IF p_id_origen = p_id_destino THEN
      rechazar('El origen y el destino no pueden ser la misma sucursal');
    END IF;

    -- ── Detalle: se parsea y valida TODO antes de escribir nada ──────────
    IF TRIM(p_items) IS NULL THEN
      rechazar('Agrega al menos un manual');
    END IF;

    l_items := APEX_STRING.SPLIT(TRIM(p_items), ';');
    FOR k IN 1 .. l_items.COUNT LOOP
      CONTINUE WHEN TRIM(l_items(k)) IS NULL; -- un ';' de mas al final

      l_par := APEX_STRING.SPLIT(l_items(k), ':');
      IF l_par.COUNT <> 2 OR TRIM(l_par(1)) IS NULL THEN
        rechazar('Item mal formado: "' || l_items(k) || '"');
      END IF;
      l_manual := UTL_URL.UNESCAPE(TRIM(l_par(1)), 'AL32UTF8');
      l_texto  := TRIM(l_par(2));

      -- Enteros y positivos: son libros. Una linea en 0 no se manda, se quita.
      IF NOT REGEXP_LIKE(NVL(l_texto, 'x'), '^[0-9]{1,7}$') OR TO_NUMBER(l_texto) = 0 THEN
        rechazar('La cantidad de ' || l_manual || ' tiene que ser un entero mayor que 0');
      END IF;

      SELECT COUNT(*) INTO l_n FROM indices_manuales WHERE manual = l_manual;
      IF l_n = 0 THEN
        rechazar('El manual "' || l_manual || '" no existe');
      END IF;

      FOR j IN 1 .. l_manuales.COUNT LOOP
        IF l_manuales(j) = l_manual THEN
          rechazar(l_manual || ' esta dos veces: deja una sola linea con el total');
        END IF;
      END LOOP;

      l_manuales.EXTEND; l_manuales(l_manuales.COUNT) := l_manual;
      l_cants.EXTEND;    l_cants(l_cants.COUNT)       := TO_NUMBER(l_texto);
    END LOOP;

    IF l_manuales.COUNT = 0 THEN
      rechazar('Agrega al menos un manual');
    END IF;

    -- ── Escritura ─────────────────────────────────────────────────────────
    IF l_id IS NULL THEN
      -- FUERA del INSERT: f_ahora es privada del body y Oracle no deja llamarla
      -- desde SQL (PLS-00231). Paso el 25/09/2026, la misma trampa que anotan
      -- intervenciones_crud.sql e inventarios.sql.
      l_fecha := f_ahora;
      INSERT INTO transferencias (id_sucursal_origen, id_sucursal_destino, fecha, ind_recibida)
      VALUES (p_id_origen, p_id_destino, l_fecha, 'N')
      RETURNING id_transferencia INTO l_id;
    ELSE
      -- Bloqueada: entre la validacion y el UPDATE nadie la recibe.
      IF f_estado_bloqueado(l_id) = 'S' THEN
        rechazar('La transferencia ya fue recibida: las existencias ya se movieron '
                 || 'y no se puede modificar', 409);
      END IF;
      UPDATE transferencias
         SET id_sucursal_origen  = p_id_origen,
             id_sucursal_destino = p_id_destino
       WHERE id_transferencia = l_id;
    END IF;

    -- Lo que ya no esta.
    DELETE FROM transferencias_detalle
     WHERE id_transferencia = l_id
       AND manual NOT IN (SELECT column_value FROM TABLE(l_manuales));

    -- Lo que cambio de cantidad, y lo nuevo.
    FOR k IN 1 .. l_manuales.COUNT LOOP
      UPDATE transferencias_detalle
         SET cantidad = l_cants(k)
       WHERE id_transferencia = l_id
         AND manual = l_manuales(k)
         AND cantidad <> l_cants(k);

      SELECT COUNT(*) INTO l_n FROM transferencias_detalle
       WHERE id_transferencia = l_id AND manual = l_manuales(k);
      IF l_n = 0 THEN
        INSERT INTO transferencias_detalle (id_transferencia, manual, cantidad)
        VALUES (l_id, l_manuales(k), l_cants(k));
      END IF;
    END LOOP;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_transferencia', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Transferencia registrada'
                                    ELSE 'Transferencia actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error_validacion;
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* RECIBIR                                                                */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Pasa IND_RECIBIDA a 'S' y TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS mueve las
  -- existencias. Todo en una transaccion: si el trigger falla, no queda recibida.
  --
  -- Antes crea en 0 las filas de EXISTENCIAS que le falten al ORIGEN: el trigger
  -- resta con UPDATE y, sin fila, no restaria nada (ver el punto 3 del
  -- encabezado). Al destino no hace falta: el trigger ya la crea.
  ------------------------------------------------------------------------------
  PROCEDURE recibir(p_token IN VARCHAR2, p_id IN NUMBER) IS
    l_origen NUMBER;
    l_lineas PLS_INTEGER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    IF f_estado_bloqueado(p_id) = 'S' THEN
      rechazar('La transferencia ya estaba recibida', 409);
    END IF;

    SELECT COUNT(*) INTO l_lineas FROM transferencias_detalle WHERE id_transferencia = p_id;
    IF l_lineas = 0 THEN
      rechazar('La transferencia no tiene manuales: no hay nada que recibir', 409);
    END IF;

    SELECT id_sucursal_origen INTO l_origen
      FROM transferencias WHERE id_transferencia = p_id;

    INSERT INTO existencias (id_sucursal, manual, cantidad_actual, fecha_actualizacion)
    SELECT l_origen, d.manual, 0, TRUNC(SYSDATE - 3/24, 'MI')
      FROM transferencias_detalle d
     WHERE d.id_transferencia = p_id
       AND NOT EXISTS (SELECT 1 FROM existencias e
                        WHERE e.manual = d.manual AND e.id_sucursal = l_origen);

    UPDATE transferencias SET ind_recibida = 'S' WHERE id_transferencia = p_id;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Transferencia recibida');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error_validacion;
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END recibir;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  -- Solo pendientes: una recibida ya movio existencias y borrarla no las
  -- devuelve. El detalle primero: la FK no tiene ON DELETE CASCADE.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER) IS
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    IF f_estado_bloqueado(p_id) = 'S' THEN
      rechazar('La transferencia ya fue recibida: borrarla no devolveria las '
               || 'existencias, asi que no se puede eliminar', 409);
    END IF;

    DELETE FROM transferencias_detalle WHERE id_transferencia = p_id;
    DELETE FROM transferencias WHERE id_transferencia = p_id;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Transferencia eliminada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error_validacion;
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* HISTORIAL (consulta y PDF)                                             */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Plano: una fila por linea de detalle, con los datos de la cabecera en cada
  -- una. El front agrupa por transferencia (tarjetas, PDF con celdas unidas) y
  -- tambien suma por ruta y por manual; con las lineas planas las tres cosas
  -- salen de la misma respuesta.
  --
  -- Sin paginar —es un reporte— y con tope (`truncado`), igual que el historial
  -- de inventarios.
  --
  -- `recibida_el` sale de la bitacora: la columna no existe. Es la fecha de la
  -- fila UPD con IND_RECIBIDA='N' mas reciente, que es el ANTES del UPDATE que
  -- la marco como recibida (los AUDITORIA_* guardan el valor anterior).
  ------------------------------------------------------------------------------
  PROCEDURE historial(
      p_token       IN VARCHAR2,
      p_estado      IN VARCHAR2 DEFAULT NULL,
      p_id_sucursal IN NUMBER   DEFAULT NULL,
      p_desde       IN VARCHAR2 DEFAULT NULL,
      p_hasta       IN VARCHAR2 DEFAULT NULL
  ) IS
    c_tope CONSTANT PLS_INTEGER := 5000;
    -- 20 y no 2: se inicializa en la declaracion, y ahi un texto mas largo
    -- rompe (ORA-06502) antes de que el EXCEPTION pueda atraparlo.
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
        WITH recep AS (
            SELECT j.id_transferencia, MAX(j.jn_datetime) AS cuando
              FROM transferencias_jn j
             WHERE j.jn_operation = 'UPD'
               AND NVL(j.ind_recibida, 'N') = 'N'
             GROUP BY j.id_transferencia
        )
        SELECT t.id_transferencia,
               t.id_sucursal_origen,  so.descripcion AS origen,
               t.id_sucursal_destino, sd.descripcion AS destino,
               TO_CHAR(t.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
               NVL(t.ind_recibida, 'N') AS ind_recibida,
               -- -3h: JN_DATETIME lo pone el trigger con SYSDATE (UTC).
               CASE WHEN t.ind_recibida = 'S'
                    THEN TO_CHAR(r.cuando - 3/24, 'DD/MM/YYYY HH24:MI') END AS recibida_el,
               d.id_detalle, d.manual, d.cantidad
          FROM transferencias t
          JOIN sucursales so ON so.id_sucursal = t.id_sucursal_origen
          JOIN sucursales sd ON sd.id_sucursal = t.id_sucursal_destino
          JOIN transferencias_detalle d ON d.id_transferencia = t.id_transferencia
          LEFT JOIN recep r ON r.id_transferencia = t.id_transferencia
         WHERE (l_estado IS NULL OR NVL(t.ind_recibida, 'N') = l_estado)
           AND (p_id_sucursal IS NULL
                OR p_id_sucursal IN (t.id_sucursal_origen, t.id_sucursal_destino))
           AND (l_desde IS NULL OR t.fecha >= l_desde)
           AND (l_hasta IS NULL OR t.fecha <  l_hasta)
         ORDER BY t.fecha DESC, t.id_transferencia DESC, d.manual
         FETCH FIRST c_tope + 1 ROWS ONLY
    ) LOOP
      l_n := l_n + 1;
      -- La fila c_tope+1 solo existe para saber si hubo mas: no se escribe.
      EXIT WHEN l_n > c_tope;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_transferencia',    r.id_transferencia);
      APEX_JSON.WRITE('id_sucursal_origen',  r.id_sucursal_origen);
      APEX_JSON.WRITE('origen',              r.origen);
      APEX_JSON.WRITE('id_sucursal_destino', r.id_sucursal_destino);
      APEX_JSON.WRITE('destino',             r.destino);
      APEX_JSON.WRITE('fecha',               r.fecha);
      APEX_JSON.WRITE('ind_recibida',        r.ind_recibida);
      APEX_JSON.WRITE('recibida_el',         r.recibida_el);
      APEX_JSON.WRITE('id_detalle',          r.id_detalle);
      APEX_JSON.WRITE('manual',              r.manual);
      APEX_JSON.WRITE('cantidad',            r.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > c_tope);
    APEX_JSON.WRITE('tope',     c_tope);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END historial;

END PKG_TRANSFERENCIAS_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINTS ORDS ======================================================
--
-- Se agregan al modulo 'ethos' que creo auth.sql.
-- El DEFINE_PARAMETER del header Authorization va por CADA handler: si falta,
-- :authorization llega NULL y todo responde "Token invalido".
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

  PROCEDURE plantilla(p_pattern IN VARCHAR2, p_priority IN NUMBER) IS
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => p_pattern,
        p_priority    => p_priority,
        p_etag_type   => 'NONE');
  END plantilla;
BEGIN
  -- Idempotencia: se borra lo que hubiera de una corrida anterior.
  FOR r IN (SELECT 'transferencias' AS p FROM dual
            UNION ALL SELECT 'transferencias/manuales' FROM dual
            UNION ALL SELECT 'transferencias/:id' FROM dual
            UNION ALL SELECT 'transferencias/:id/recibir' FROM dual
            UNION ALL SELECT 'transferencias/historial' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- PRIORIDADES: `transferencias/manuales` y `transferencias/:id` tienen la misma
  -- forma, y sin prioridad ORDS podria mandar "manuales" como si fuera un :id.
  -- El literal va primero (2), despues el :id (1), despues la coleccion (0).
  plantilla('transferencias',              0);
  plantilla('transferencias/manuales',     2);
  plantilla('transferencias/historial',    2);
  plantilla('transferencias/:id',          1);
  plantilla('transferencias/:id/recibir',  1);

  handler('transferencias', 'GET', '
    PKG_TRANSFERENCIAS_ETHOS.LISTAR(
        p_token       => l_token,
        p_estado      => :estado,
        p_id_sucursal => TO_NUMBER(:id_sucursal),
        p_limite      => TO_NUMBER(:limite),
        p_pagina      => TO_NUMBER(:pagina));');

  handler('transferencias', 'POST', '
    PKG_TRANSFERENCIAS_ETHOS.GUARDAR(
        p_token      => l_token,
        p_id         => NULL,
        p_id_origen  => TO_NUMBER(:id_sucursal_origen),
        p_id_destino => TO_NUMBER(:id_sucursal_destino),
        p_items      => :items);');

  handler('transferencias/manuales', 'GET', '
    PKG_TRANSFERENCIAS_ETHOS.MANUALES(
        p_token       => l_token,
        p_id_sucursal => TO_NUMBER(:id_sucursal),
        p_excluir_id  => TO_NUMBER(:excluir_id));');

  handler('transferencias/:id', 'GET', '
    PKG_TRANSFERENCIAS_ETHOS.OBTENER(p_token => l_token, p_id => TO_NUMBER(:id));');

  handler('transferencias/:id', 'PUT', '
    PKG_TRANSFERENCIAS_ETHOS.GUARDAR(
        p_token      => l_token,
        p_id         => TO_NUMBER(:id),
        p_id_origen  => TO_NUMBER(:id_sucursal_origen),
        p_id_destino => TO_NUMBER(:id_sucursal_destino),
        p_items      => :items);');

  handler('transferencias/:id', 'DELETE', '
    PKG_TRANSFERENCIAS_ETHOS.ELIMINAR(p_token => l_token, p_id => TO_NUMBER(:id));');

  handler('transferencias/:id/recibir', 'POST', '
    PKG_TRANSFERENCIAS_ETHOS.RECIBIR(p_token => l_token, p_id => TO_NUMBER(:id));');

  handler('transferencias/historial', 'GET', '
    PKG_TRANSFERENCIAS_ETHOS.HISTORIAL(
        p_token       => l_token,
        p_estado      => :estado,
        p_id_sucursal => TO_NUMBER(:id_sucursal),
        p_desde       => :desde,
        p_hasta       => :hasta);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de transferencias publicados.');
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
    HTP.P('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;
~');
  END preflight;
BEGIN
  preflight('transferencias');
  preflight('transferencias/manuales');
  preflight('transferencias/:id');
  preflight('transferencias/:id/recibir');
  preflight('transferencias/historial');
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
  l_n      PLS_INTEGER;
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_TRANSFERENCIAS_ETHOS' AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_TRANSFERENCIAS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    transferencias ?estado=&id_sucursal=');
    DBMS_OUTPUT.PUT_LINE('       GET    transferencias/manuales ?id_sucursal=&excluir_id=');
    DBMS_OUTPUT.PUT_LINE('       GET    transferencias/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   transferencias');
    DBMS_OUTPUT.PUT_LINE('       PUT    transferencias/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   transferencias/:id/recibir');
    DBMS_OUTPUT.PUT_LINE('       DELETE transferencias/:id');
    DBMS_OUTPUT.PUT_LINE('       GET    transferencias/historial ?estado=&id_sucursal=&desde=&hasta=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_TRANSFERENCIAS_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_TRANSFERENCIAS_ETHOS'';');
  END IF;

  -- El que mueve las existencias al recibir. Sin el, "recibir" marcaria la
  -- transferencia sin mover nada.
  SELECT COUNT(*) INTO l_n FROM user_triggers
   WHERE trigger_name = 'TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS' AND status = 'ENABLED';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS no existe o esta DISABLED:');
    DBMS_OUTPUT.PUT_LINE('        recibir una transferencia no moveria las existencias.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS habilitado.');
  END IF;

  -- `o.status` y no `status`: user_triggers TAMBIEN tiene STATUS (ORA-00918).
  FOR t IN (SELECT o.object_name
              FROM user_triggers tr JOIN user_objects o ON o.object_name = tr.trigger_name
             WHERE tr.table_name IN ('TRANSFERENCIAS', 'TRANSFERENCIAS_DETALLE', 'EXISTENCIAS')
               AND o.object_type = 'TRIGGER'
               AND o.status <> 'VALID') LOOP
    DBMS_OUTPUT.PUT_LINE('[ERROR] Trigger INVALID: ' || t.object_name
                      || '. Todo INSERT/UPDATE de su tabla falla hasta arreglarlo.');
  END LOOP;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_TRANSFERENCIAS_ETHOS no se creo.');
END;
/
