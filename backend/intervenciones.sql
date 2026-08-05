--------------------------------------------------------------------------------
-- INTERVENCIONES  —  historial de marcaciones de los facilitadores
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  intervenciones  ?anio=&mes=&id_facilitador=&limite=
--
-- UN SOLO ENDPOINT. Devuelve las filas de V_HISTORIAL_INTERVENCIONES tal como
-- las da la consulta de referencia: una fila por marcacion, con los grados
-- agrupados y la diferencia de minutos ya calculada.
--
-- El grafico del inicio se arma en el FRONT agrupando estas filas por
-- facilitador. Es a proposito: son pocas filas por mes, y un endpoint agregado
-- aparte obligaria a mantener el mismo criterio en dos consultas distintas.
--
-- SOLO LECTURA. No hay POST/PUT/DELETE: las intervenciones las carga la app del
-- facilitador, no esta.
--
-- CORRER DESPUES de auth.sql (necesita el modulo ORDS 'ethos' y PKG_AUTH_ETHOS
-- para validar el token). NO depende del paquete de evaluaciones.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- DE DONDE SALEN LOS DATOS
--------------------------------------------------------------------------------
--
-- De la vista V_HISTORIAL_INTERVENCIONES, que ya existia en la base y junta
-- INTERVENCIONES con institucion, facilitador, enfasis y el horario de la clase.
--
-- ESTE SCRIPT NO CREA NI MODIFICA ESA VISTA. Si algun dia cambia de forma, lo
-- que se rompe es este paquete, no al reves.
--
--------------------------------------------------------------------------------
-- DIFERENCIA_MINUTOS: TAL CUAL LA CONSULTA DE REFERENCIA
--------------------------------------------------------------------------------
--
--   ROUND((TO_DATE(HORA_DESDE,'HH24:MI') - TO_DATE(HORA,'HH24:MI')) * 24 * 60, 0) / 60
--
-- OJO CON EL SIGNO Y CON LA UNIDAD, que no son obvios:
--
--   * El minuendo es HORA_DESDE (cuando EMPEZABA la clase) y el sustraendo es
--     HORA (cuando MARCO). O sea que da POSITIVO si llego ANTES y NEGATIVO si
--     llego tarde. Es al reves de lo que sugiere el nombre "atraso".
--   * El `/ 60` final la deja en HORAS, no en minutos, pese al nombre de la
--     columna.
--
-- Se deja EXACTAMENTE asi, con sus dos rarezas, porque es la cuenta que ya se
-- venia usando y cambiarla aca haria que los numeros no coincidan con los que
-- salen de APEX. El front se encarga de interpretarla — ver `intervenciones.ts`.
--
-- El TO_DATE se protege con un CASE + REGEXP_LIKE: si HORA viniera vacia o con
-- basura, ORA-01858 tumba la consulta entera y no hay donde atraparlo dentro de
-- un SELECT. Con el CASE, esas filas salen con NULL y las demas se devuelven.
--
--------------------------------------------------------------------------------
-- EL FILTRO DE MES: POR QUE NO SE COMPARA CONTRA UN NOMBRE FIJO
--------------------------------------------------------------------------------
--
-- V_HISTORIAL_INTERVENCIONES.MES es TEXTO, y no se sabe con que capitalizacion
-- ni con que grafia esta cargado ('Agosto', 'AGOSTO', 'agosto'...). La consulta
-- de referencia tenia comentado `UPPER(MES) = 'Agosto'`, que **nunca hubiera
-- matcheado**: UPPER() devuelve 'AGOSTO' y eso no es igual a 'Agosto'.
--
-- Por eso el filtro NO compara contra un nombre. Usa la FECHA, que es un DATE y
-- no depende de como este escrito el mes:
--
--   EXTRACT(MONTH FROM FECHA) = p_mes
--
-- Es inmune a la capitalizacion, al idioma y a las abreviaturas. La columna MES
-- se sigue devolviendo para mostrar, pero no decide nada.
--
-- Si FECHA no fuera un DATE en la vista, este filtro falla y hay que volver al
-- texto — pero entonces habria que averiguar primero la grafia real con:
--   SELECT DISTINCT mes FROM v_historial_intervenciones;
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
   WHERE object_name = 'V_HISTORIAL_INTERVENCIONES'
     AND object_type IN ('VIEW', 'SYNONYM');

  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe V_HISTORIAL_INTERVENCIONES.');
    DBMS_OUTPUT.PUT_LINE('        El paquete no va a compilar. Creala primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   V_HISTORIAL_INTERVENCIONES encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INTERVENCIONES_ETHOS AS

  -- El historial de marcaciones.
  --
  -- p_anio: 'YYYY'. Sin el, el año en curso. 'TODOS' apaga el filtro.
  -- p_mes:  1..12. Sin el, todo el año.
  -- p_id_facilitador: opcional, para ver el de una sola persona.
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN NUMBER   DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL);

END PKG_INTERVENCIONES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INTERVENCIONES_ETHOS AS

  -- Un mes de marcaciones de todos los facilitadores entra holgado; el tope
  -- esta para que un cliente no se lleve la tabla entera de un pedido.
  c_limite_defecto CONSTANT PLS_INTEGER := 1000;
  c_limite_maximo  CONSTANT PLS_INTEGER := 5000;

  ------------------------------------------------------------------------------
  -- Mismo contrato de respuesta que los otros paquetes, para que el cliente no
  -- tenga que distinguir de donde vino el JSON.
  ------------------------------------------------------------------------------

  PROCEDURE abrir_json IS
  BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Cache-Control: no-store');
    HTP.P('Access-Control-Allow-Origin: *');
    OWA_UTIL.HTTP_HEADER_CLOSE;
  END abrir_json;

  PROCEDURE p_error(p_status IN NUMBER, p_titulo IN VARCHAR2, p_detalle IN VARCHAR2) IS
  BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_titulo, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  END p_error;

  -- El usuario del token, o NULL. Delega en PKG_AUTH_ETHOS: la validacion vive
  -- en UN solo lugar.
  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  ------------------------------------------------------------------------------
  -- LISTAR
  ------------------------------------------------------------------------------
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN NUMBER   DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_anio    VARCHAR2(4);
    l_mes     PLS_INTEGER;
    l_tope    PLS_INTEGER;
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    -- El año: el pedido, o el EN CURSO. 'TODOS' lo apaga.
    --
    -- Se usa el año del reloj y no FN_ANIO_LECTIVO_ACTUAL() a proposito: esto es
    -- un historial de marcaciones, no una operacion del año lectivo, y si el
    -- año lectivo estuviera sin cargar la pantalla quedaria vacia sin motivo.
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      l_anio := TRIM(p_anio);
    ELSE
      l_anio := TO_CHAR(SYSDATE, 'YYYY');
    END IF;

    l_mes  := CASE WHEN p_mes BETWEEN 1 AND 12 THEN p_mes END;
    l_tope := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('mes',     l_mes);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT fecha,
               manual,
               observacion,
               motivo_desarrollo,
               id_indice,
               si_no,
               id_institucion,
               nombre,
               turno,
               LISTAGG(grado, ', ') WITHIN GROUP (ORDER BY grado) AS grado,
               seccion,
               id_enfasis,
               descripcion,
               id_facilitador,
               nombre_facilitador,
               mes,
               MAX(id_intervencion) AS id_intervencion,
               hora,
               hora_desde,
               hora_hasta,
               -- La cuenta de la consulta de referencia, con sus dos rarezas
               -- intactas: signo invertido (positivo = llego antes) y dividida
               -- por 60, o sea en HORAS pese al nombre. Ver el encabezado.
               --
               -- El CASE evita el ORA-01858 de una hora vacia o con basura:
               -- adentro de un SELECT no hay donde atrapar esa excepcion, y sin
               -- esto una sola fila mala tumba la consulta entera.
               CASE
                 WHEN REGEXP_LIKE(TRIM(hora),       '^\d{1,2}:\d{2}$')
                  AND REGEXP_LIKE(TRIM(hora_desde), '^\d{1,2}:\d{2}$')
                 THEN ROUND((TO_DATE(TRIM(hora_desde), 'HH24:MI')
                           - TO_DATE(TRIM(hora),       'HH24:MI')) * 24 * 60, 0) / 60
               END AS diferencia_minutos,
               REPLACE(latitud,  ',', '.') AS latitud,
               REPLACE(longitud, ',', '.') AS longitud,
               ubicacion_insitutcion,
               anio
          FROM v_historial_intervenciones
         WHERE (l_anio IS NULL OR anio = l_anio)
           -- Por la FECHA y no por el texto del mes: MES es VARCHAR2 y no se
           -- sabe con que capitalizacion esta cargado. Ver el encabezado.
           AND (l_mes  IS NULL OR EXTRACT(MONTH FROM fecha) = l_mes)
           AND (p_id_facilitador IS NULL OR id_facilitador = p_id_facilitador)
         GROUP BY fecha, manual, observacion, motivo_desarrollo, id_indice,
                  si_no, id_institucion, nombre, seccion, id_enfasis,
                  descripcion, id_facilitador, mes, hora, nombre_facilitador,
                  latitud, longitud, ubicacion_insitutcion, hora_desde,
                  hora_hasta, anio, turno
         ORDER BY id_intervencion DESC
         FETCH FIRST l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion',   r.id_intervencion);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('hora',              r.hora);
      APEX_JSON.WRITE('hora_desde',        r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',        r.hora_hasta);
      APEX_JSON.WRITE('diferencia_minutos', r.diferencia_minutos);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_facilitador);
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('nombre',            r.nombre);
      APEX_JSON.WRITE('turno',             r.turno);
      APEX_JSON.WRITE('grado',             r.grado);
      APEX_JSON.WRITE('seccion',           r.seccion);
      APEX_JSON.WRITE('id_enfasis',        r.id_enfasis);
      APEX_JSON.WRITE('descripcion',       r.descripcion);
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('id_indice',         r.id_indice);
      APEX_JSON.WRITE('si_no',             r.si_no);
      APEX_JSON.WRITE('observacion',       r.observacion);
      APEX_JSON.WRITE('motivo_desarrollo', r.motivo_desarrollo);
      APEX_JSON.WRITE('mes',               r.mes);
      APEX_JSON.WRITE('anio',              r.anio);
      APEX_JSON.WRITE('latitud',           r.latitud);
      APEX_JSON.WRITE('longitud',          r.longitud);
      APEX_JSON.WRITE('ubicacion_institucion', r.ubicacion_insitutcion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

END PKG_INTERVENCIONES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINT ORDS =======================================================
--
-- Se agrega al modulo 'ethos' que creo auth.sql.
-- El DEFINE_PARAMETER del header Authorization va por CADA handler: si falta,
-- :authorization llega NULL y todo responde "Token invalido".
--------------------------------------------------------------------------------

BEGIN
  -- Se borra tambien 'intervenciones/resumen', que existio en una version
  -- anterior de este script (dos endpoints en vez de uno). Si quedara publicado
  -- apuntaria a un procedimiento que ya no existe y responderia 500.
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_TEMPLATE('ethos', 'intervenciones/resumen');           EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones',         'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones',         'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones',
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
    PKG_INTERVENCIONES_ETHOS.LISTAR(
        p_token          => l_token,
        p_anio           => :anio,
        p_mes            => TO_NUMBER(:mes),
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_limite         => TO_NUMBER(:limite));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handler de intervenciones publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar el handler: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, a prueba de fallos. Solo hace falta si un navegador le pega
-- DIRECTO a ORDS (hoy la web va por su proxy de mismo origen).
BEGIN
  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones',
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
    DBMS_OUTPUT.PUT_LINE('       No es bloqueante: la web va por su proxy de mismo origen.');
END;
/

--------------------------------------------------------------------------------
-- === 4) VERIFICACION ========================================================
--------------------------------------------------------------------------------

DECLARE
  l_estado user_objects.status%TYPE;
  l_filas  PLS_INTEGER;
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_INTERVENCIONES_ETHOS'
     AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INTERVENCIONES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones ?anio=&mes=&id_facilitador=&limite=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_INTERVENCIONES_ETHOS'';');
    RETURN;
  END IF;

  -- Cuantas filas hay para el mes en curso. Si da 0, el grafico va a salir
  -- vacio y NO es un bug del codigo: es que no hay marcaciones cargadas.
  BEGIN
    SELECT COUNT(*) INTO l_filas
      FROM v_historial_intervenciones
     WHERE anio = TO_CHAR(SYSDATE, 'YYYY')
       AND EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM SYSDATE);

    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('       Filas en el mes en curso: ' || l_filas);
    IF l_filas = 0 THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] Sin datos este mes: el grafico va a salir vacio.');
      DBMS_OUTPUT.PUT_LINE('               Para ver que periodos tienen datos:');
      DBMS_OUTPUT.PUT_LINE('               SELECT anio, EXTRACT(MONTH FROM fecha) m, COUNT(*)');
      DBMS_OUTPUT.PUT_LINE('                 FROM v_historial_intervenciones');
      DBMS_OUTPUT.PUT_LINE('                GROUP BY anio, EXTRACT(MONTH FROM fecha)');
      DBMS_OUTPUT.PUT_LINE('                ORDER BY 1 DESC, 2 DESC;');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] No se pudo contar las filas: ' || SQLERRM);
      DBMS_OUTPUT.PUT_LINE('               Puede que FECHA no sea DATE en la vista.');
  END;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS no se creo.');
END;
/
