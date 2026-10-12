--------------------------------------------------------------------------------
-- AUDITORIA DE INTERVENCIONES  —  la bitacora INTERVENCIONES_JN
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a la pagina 58 de APEX (Auditoria de Intervenciones,
-- /auditoria-intervenciones): quien inserto, modifico o borro cada
-- intervencion, con todos sus datos tal como quedaron en la bitacora.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  auditoria-intervenciones  ?desde=&hasta=
--        Las filas de INTERVENCIONES_JN cuya fecha de auditoria (JN_DATETIME,
--        corrida a la hora de Paraguay) cae en el periodo: YYYY-MM-DD,
--        inclusive, hasta 366 dias. El usuario y la operacion los elige la
--        pantalla sobre lo que llega, con cuantos tiene cada uno.
--
-- SOLO LECTURA.
--
-- CORRER DESPUES de auth.sql (modulo ORDS 'ethos' y PKG_AUTH_ETHOS).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- POR QUE UN PAQUETE APARTE
--------------------------------------------------------------------------------
--
-- Un script y un paquete por tabla (README -> "Pasar una pagina de APEX"). Y
-- ademas aisla el riesgo: la consulta nombra columnas de INTERVENCIONES_JN; si
-- un dia esa bitacora cambiara, no compilaria SOLO este paquete, y no el de
-- Auditoria (auditoria.sql) ni el de los graficos del Inicio (intervenciones.sql).
--
--------------------------------------------------------------------------------
-- LAS HORAS: JN_DATETIME ES LA HORA DEL SERVIDOR (UTC), NO LA DE PARAGUAY
--------------------------------------------------------------------------------
--
-- Igual que en auditoria.sql: los triggers graban SYSDATE, que en
-- oracleapex.com es UTC. Se devuelve corrida a Paraguay (UTC-3) y el filtro
-- desde/hasta se corre al reves. APEX mostraba la hora del servidor tal cual.
-- c_desfase tiene que ser el MISMO que el de auditoria.sql: si uno cambia, el
-- otro tambien.
--
-- FECHA_HORA (la hora de la intervencion) NO se corre: esa columna ya la graba
-- TRG_INTERVENCIONES_SET_FECHA en hora de Paraguay.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n
    FROM all_objects
   WHERE object_name = 'INTERVENCIONES_JN'
     AND object_type IN ('TABLE', 'VIEW', 'SYNONYM');
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe INTERVENCIONES_JN: el paquete no va a compilar.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   INTERVENCIONES_JN encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_AUDITORIA_INTERV_ETHOS AS

  -- La bitacora de intervenciones de un periodo. Ver el cuerpo.
  PROCEDURE listar(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2);

END PKG_AUDITORIA_INTERV_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_AUDITORIA_INTERV_ETHOS AS

  -- Hora del servidor -> hora de Paraguay. El mismo de auditoria.sql.
  c_desfase CONSTANT NUMBER := -3 / 24;

  -- El periodo mas largo que se acepta, y el tope de filas por pedido.
  c_dias_max   CONSTANT PLS_INTEGER := 366;
  c_limite_max CONSTANT PLS_INTEGER := 20000;

  PROCEDURE abrir_json IS
  BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Cache-Control: no-store');
    HTP.P('Access-Control-Allow-Origin: *');
    OWA_UTIL.HTTP_HEADER_CLOSE;
  END abrir_json;

  -- Solo ANTES de abrir la respuesta: emite los headers.
  PROCEDURE p_error(p_status IN NUMBER, p_titulo IN VARCHAR2, p_detalle IN VARCHAR2) IS
  BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_titulo, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  END p_error;

  -- Cuando la respuesta YA se abrio y el array 'data' quedo a medio escribir:
  -- lo cierra para que el JSON parsee, con el error real en `message`.
  PROCEDURE p_error_tardio(p_detalle IN VARCHAR2) IS
  BEGIN
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END p_error_tardio;

  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  ------------------------------------------------------------------------------
  -- LISTAR: la consulta de la pagina 58 de APEX, con los ids resueltos.
  --
  --   * Las mismas columnas de INTERVENCIONES_JN. Lo que APEX mostraba con una
  --     LOV (institucion, indice, enfasis, facilitador) viene con su nombre;
  --     el turno viaja como numero y el front lo nombra.
  --   * El nombre de quien hizo el cambio, si JN_ORACLE_USER es el usuario de
  --     un facilitador (la LOV P58_USUARIO de APEX: nombre -> usuario).
  --   * JN_DATETIME corrida a Paraguay (ver el encabezado).
  --   * ORDER BY id_intervencion DESC, como APEX; y adentro, la mas nueva
  --     primero.
  ------------------------------------------------------------------------------
  PROCEDURE listar(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2
  ) IS
    l_desde DATE;
    l_hasta DATE;
    l_n     PLS_INTEGER := 0;
    l_tope1 PLS_INTEGER := c_limite_max + 1;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;
    BEGIN
      l_desde := TO_DATE(SUBSTR(TRIM(p_desde), 1, 10), 'YYYY-MM-DD');
      l_hasta := TO_DATE(SUBSTR(TRIM(p_hasta), 1, 10), 'YYYY-MM-DD');
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'Las fechas van como YYYY-MM-DD');
        RETURN;
    END;
    IF l_desde IS NULL OR l_hasta IS NULL OR l_hasta < l_desde
       OR l_hasta - l_desde > c_dias_max THEN
      p_error(400, 'Bad Request', 'El periodo no es valido (hasta ' || c_dias_max || ' dias)');
      RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('limite',  c_limite_max);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT j.id_auditoria, j.jn_operation, j.jn_oracle_user,
               TO_CHAR(CAST(j.jn_datetime AS DATE) + c_desfase, 'DD/MM/YYYY HH24:MI:SS') AS fecha_auditoria,
               TO_CHAR(CAST(j.jn_datetime AS DATE) + c_desfase, 'YYYYMMDDHH24MISS')      AS orden_auditoria,
               (SELECT MAX(fu.nombre_apellido) FROM facilitadores fu
                 WHERE UPPER(fu.usuario) = UPPER(j.jn_oracle_user)) AS nombre_usuario,
               j.id_institucion, ins.nombre AS institucion,
               j.id_indice, im.nro_indice, im.titulo AS indice_titulo,
               j.si_no, j.grado, j.id_enfasis, e.descripcion AS enfasis,
               j.motivo_desarrollo, j.seccion, j.turno,
               j.id_facilitador, f.nombre_apellido AS facilitador,
               TO_CHAR(j.fecha_hora, 'DD/MM/YYYY HH24:MI:SS') AS fecha_intervencion,
               j.manual,
               REPLACE(j.latitud,  ',', '.') AS latitud,
               REPLACE(j.longitud, ',', '.') AS longitud,
               j.observacion, j.id_intervencion, j.id_postulacion, j.usuario
          FROM intervenciones_jn j
          LEFT JOIN instituciones ins   ON ins.id_institucion = j.id_institucion
          LEFT JOIN indices_manuales im ON im.id_indice       = j.id_indice
          LEFT JOIN enfasis e           ON e.id_enfasis       = j.id_enfasis
          LEFT JOIN facilitadores f     ON f.id_facilitador   = j.id_facilitador
         -- El periodo es en hora de Paraguay: se corre al reves para comparar
         -- contra JN_DATETIME, que esta en la del servidor.
         WHERE j.jn_datetime >= l_desde - c_desfase
           AND j.jn_datetime <  l_hasta + 1 - c_desfase
         ORDER BY j.id_intervencion DESC, j.jn_datetime DESC
         FETCH FIRST l_tope1 ROWS ONLY
    ) LOOP
      -- Se pide una de mas para saber si hubo corte, y esa no se escribe.
      l_n := l_n + 1;
      EXIT WHEN l_n > c_limite_max;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_auditoria',       r.id_auditoria);
      APEX_JSON.WRITE('operacion',          r.jn_operation);
      APEX_JSON.WRITE('usuario',            r.jn_oracle_user);
      APEX_JSON.WRITE('nombre_usuario',     r.nombre_usuario);
      APEX_JSON.WRITE('fecha_auditoria',    r.fecha_auditoria);
      APEX_JSON.WRITE('orden_auditoria',    r.orden_auditoria);
      APEX_JSON.WRITE('id_institucion',     r.id_institucion);
      APEX_JSON.WRITE('institucion',        r.institucion);
      APEX_JSON.WRITE('id_indice',          r.id_indice);
      APEX_JSON.WRITE('nro_indice',         r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',      r.indice_titulo);
      APEX_JSON.WRITE('si_no',              r.si_no);
      APEX_JSON.WRITE('grado',              r.grado);
      APEX_JSON.WRITE('id_enfasis',         r.id_enfasis);
      APEX_JSON.WRITE('enfasis',            r.enfasis);
      APEX_JSON.WRITE('motivo_desarrollo',  r.motivo_desarrollo);
      APEX_JSON.WRITE('seccion',            r.seccion);
      APEX_JSON.WRITE('turno',              r.turno);
      APEX_JSON.WRITE('id_facilitador',     r.id_facilitador);
      APEX_JSON.WRITE('facilitador',        r.facilitador);
      APEX_JSON.WRITE('fecha_intervencion', r.fecha_intervencion);
      APEX_JSON.WRITE('manual',             r.manual);
      APEX_JSON.WRITE('latitud',            r.latitud);
      APEX_JSON.WRITE('longitud',           r.longitud);
      APEX_JSON.WRITE('observacion',        r.observacion);
      APEX_JSON.WRITE('id_intervencion',    r.id_intervencion);
      APEX_JSON.WRITE('id_postulacion',     r.id_postulacion);
      APEX_JSON.WRITE('usuario_facilitador', r.usuario);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > c_limite_max);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END listar;

END PKG_AUDITORIA_INTERV_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINT ORDS =======================================================
--
-- Se agrega al modulo 'ethos' que creo auth.sql. El DEFINE_PARAMETER del header
-- Authorization va por CADA handler: si falta, :authorization llega NULL y todo
-- responde "Token invalido".
--------------------------------------------------------------------------------

BEGIN
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auditoria-intervenciones', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'auditoria-intervenciones', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'auditoria-intervenciones',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auditoria-intervenciones',
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
    PKG_AUDITORIA_INTERV_ETHOS.LISTAR(
        p_token => l_token,
        p_desde => :desde,
        p_hasta => :hasta);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'auditoria-intervenciones',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handler auditoria-intervenciones publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar el handler: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, APARTE y a prueba de fallos, como en los otros scripts.
--
-- OJO (12/10/2026): este ORDS RECHAZA el metodo OPTIONS en DEFINE_HANDLER
-- (ORA-02290, ORDS_HANDLERS_MD_CK). Ponerlo en el bloque de arriba tumbaba
-- todo el bloque con ROLLBACK y el GET quedaba SIN publicar. Aca, si falla,
-- solo avisa: no es bloqueante, porque el CORS lo resuelve el modulo.
BEGIN
  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'auditoria-intervenciones',
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
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Preflight OPTIONS no se pudo publicar: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('       No es bloqueante.');
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
   WHERE object_name = 'PKG_AUDITORIA_INTERV_ETHOS'
     AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUDITORIA_INTERV_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET auditoria-intervenciones ?desde=&hasta=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AUDITORIA_INTERV_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_AUDITORIA_INTERV_ETHOS'';');
    RETURN;
  END IF;

  SELECT COUNT(*) INTO l_n FROM intervenciones_jn
   WHERE jn_datetime >= TRUNC(SYSDATE, 'MM');
  DBMS_OUTPUT.PUT_LINE('       Movimientos de este mes en INTERVENCIONES_JN: ' || l_n);
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AUDITORIA_INTERV_ETHOS no se creo.');
END;
/
