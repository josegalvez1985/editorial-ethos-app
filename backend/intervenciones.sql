--------------------------------------------------------------------------------
-- INTERVENCIONES  —  puntualidad de los facilitadores
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  intervenciones/resumen  ?anio=&mes=
--        Una fila POR FACILITADOR con su atraso promedio del mes. Alimenta el
--        grafico de barras del inicio.
--
--   GET  intervenciones          ?anio=&mes=&id_facilitador=
--        El detalle: una fila por marcacion, con la hora marcada, la hora de
--        clase y la diferencia. Alimenta el modal que se abre al tocar una barra.
--
-- Los dos son de SOLO LECTURA. No hay POST/PUT/DELETE: las intervenciones las
-- carga la app del facilitador, no esta.
--
-- CORRER DESPUES de ethos_auth.sql (necesita el modulo ORDS 'ethos' y
-- PKG_AUTH_ETHOS para validar el token). NO depende del paquete de evaluaciones.
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
-- LA CUENTA DEL ATRASO, QUE ES LO UNICO NO OBVIO
--------------------------------------------------------------------------------
--
-- DIFERENCIA = hora en que MARCO - hora en que EMPEZABA la clase, en minutos.
--
--   marco 07:40, clase 07:30  ->  +10  (llego 10 tarde)
--   marco 07:25, clase 07:30  ->   -5  (llego 5 antes)
--
-- Las dos columnas son VARCHAR2 con formato 'HH24:MI', asi que hay que pasarlas
-- por TO_DATE para restarlas. TO_DATE sin fecha las ubica a las dos en el mismo
-- dia, que es lo que se quiere: solo interesa la hora.
--
-- TRES DECISIONES TOMADAS (05/08/2026), las tres a pedido:
--
-- 1. **Los negativos cuentan como CERO.** Se mide atraso, no adelanto. Sin esto,
--    alguien que un dia llega 20 antes y otro 20 tarde promedia 0 y parece
--    puntual cuando en realidad es irregular. GREATEST(x, 0) lo resuelve.
--
-- 2. **La barra es el PROMEDIO, no la suma.** Un facilitador con 20 clases y
--    otro con 3 tienen que ser comparables; la suma castigaria al que mas
--    trabaja. AVG responde "quien llega mas tarde por clase", que es la pregunta.
--
-- 3. **Se cuentan las marcaciones, no los grados.** La consulta original hacia
--    LISTAGG(GRADO) agrupando por hora: una marcacion que cubre 7mo y 8vo es UNA
--    llegada, no dos. Aca se replica ese agrupado ANTES de promediar (ver la
--    subconsulta `por_marcacion`), o un facilitador que da dos grados a la misma
--    hora pesaria el doble que uno que da uno solo.
--
-- FILAS QUE SE DESCARTAN: las que no tienen HORA o HORA_DESDE cargada, y las que
-- no parsean como 'HH24:MI'. Sin hora no hay atraso que calcular, y meterlas
-- como 0 diria "llego puntual", que es una afirmacion que el dato no respalda.
--
--------------------------------------------------------------------------------
-- EL MES: TEXTO EN ESPAÑOL, NO NUMERO
--------------------------------------------------------------------------------
--
-- V_HISTORIAL_INTERVENCIONES.MES viene como texto ('Agosto', 'agosto'...), no
-- como 1..12. El filtro compara en MAYUSCULAS por eso mismo.
--
-- El front manda el mes en numero —es lo unico estable entre idiomas y locales—
-- y ACA se traduce a nombre. Hacerlo al reves obligaria al navegador a acertar
-- el mismo idioma y capitalizacion que tiene la vista, que es fragil.
--
-- Se traduce con una tabla fija y no con TO_CHAR(..., 'MONTH'): TO_CHAR depende
-- de NLS_DATE_LANGUAGE de la sesion, que en ORDS no esta garantizado, y el dia
-- que la sesion venga en ingles el filtro dejaria de matchear en silencio.
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
    FROM user_views
   WHERE view_name = 'V_HISTORIAL_INTERVENCIONES';

  IF l_n = 0 THEN
    -- Puede ser una vista de otro esquema con sinonimo: se avisa, no se corta.
    SELECT COUNT(*) INTO l_n
      FROM all_objects
     WHERE object_name = 'V_HISTORIAL_INTERVENCIONES'
       AND object_type IN ('VIEW', 'SYNONYM');
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe V_HISTORIAL_INTERVENCIONES.');
      DBMS_OUTPUT.PUT_LINE('        El paquete no va a compilar. Creala primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   V_HISTORIAL_INTERVENCIONES visible (otro esquema o sinonimo).');
    END IF;
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   V_HISTORIAL_INTERVENCIONES encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INTERVENCIONES_ETHOS AS

  -- Atraso promedio por facilitador. Para el grafico de barras del inicio.
  -- p_anio: 'YYYY'. Sin el, el año lectivo activo (FN_ANIO_LECTIVO_ACTUAL).
  -- p_mes:  1..12. Sin el, TODO el año.
  PROCEDURE resumen(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN NUMBER   DEFAULT NULL);

  -- El detalle de las marcaciones. Para el modal.
  -- p_id_facilitador es OBLIGATORIO: sin el serian miles de filas y ninguna
  -- pantalla las pide todas juntas.
  PROCEDURE detalle(
      p_token          IN VARCHAR2,
      p_id_facilitador IN NUMBER,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN NUMBER   DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL);

END PKG_INTERVENCIONES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INTERVENCIONES_ETHOS AS

  c_limite_defecto CONSTANT PLS_INTEGER := 100;
  c_limite_maximo  CONSTANT PLS_INTEGER := 500;

  ------------------------------------------------------------------------------
  -- Utilidades. Mismo contrato de respuesta que PKG_EVAL_FACILITADORES_ETHOS,
  -- para que el cliente no tenga que distinguir de que paquete vino el JSON.
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

  -- El usuario del token, o NULL. Delega en PKG_AUTH_ETHOS: la validacion del
  -- token vive en UN solo lugar. Mismo patron que PKG_EVAL_FACILITADORES_ETHOS.
  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
    l_usuario VARCHAR2(255);
  BEGIN
    l_usuario := PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
    RETURN l_usuario;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  ------------------------------------------------------------------------------
  -- El año a filtrar: el pedido, o el lectivo activo.
  --
  -- 'TODOS' apaga el filtro. Si no hay año activo cargado, FN_ANIO_LECTIVO_ACTUAL
  -- devuelve NULL y esto tampoco filtra — mismo criterio que los combos del
  -- formulario: una tabla de configuracion sin cargar no puede dejar una
  -- pantalla vacia y sin explicacion.
  ------------------------------------------------------------------------------
  FUNCTION f_anio(p_anio IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      RETURN NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      RETURN TRIM(p_anio);
    ELSE
      RETURN TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
    END IF;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL; -- sin año activo: no filtra
  END f_anio;

  ------------------------------------------------------------------------------
  -- El nombre del mes en español, para comparar contra V_...MES, que es texto.
  --
  -- Tabla fija y NO TO_CHAR(fecha,'MONTH'): ese depende de NLS_DATE_LANGUAGE de
  -- la sesion, y en ORDS no esta garantizado. El dia que la sesion viniera en
  -- ingles, el filtro dejaria de matchear sin dar error.
  ------------------------------------------------------------------------------
  FUNCTION f_mes(p_mes IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    IF p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 THEN
      RETURN NULL; -- no filtra por mes
    END IF;
    RETURN CASE p_mes
             WHEN  1 THEN 'ENERO'      WHEN  2 THEN 'FEBRERO'
             WHEN  3 THEN 'MARZO'      WHEN  4 THEN 'ABRIL'
             WHEN  5 THEN 'MAYO'       WHEN  6 THEN 'JUNIO'
             WHEN  7 THEN 'JULIO'      WHEN  8 THEN 'AGOSTO'
             WHEN  9 THEN 'SETIEMBRE'  WHEN 10 THEN 'OCTUBRE'
             WHEN 11 THEN 'NOVIEMBRE'  WHEN 12 THEN 'DICIEMBRE'
           END;
  END f_mes;

  /*
   * NOTA PARA QUIEN VENGA A TOCAR ESTO
   *
   * Aca habia una funcion `f_atraso(hora, hora_desde)` que se llamaba DENTRO del
   * SELECT. Oracle la rechaza: PLS-00231, "la funcion no se puede utilizar en
   * SQL" — una funcion privada del body no es visible para el motor SQL.
   *
   * La cuenta quedo INLINE en las dos consultas. Si hay que cambiar el criterio
   * del atraso, hay que tocarlo en LOS DOS lugares (resumen y detalle).
   *
   * La expresion es:
   *
   *   GREATEST(ROUND((TO_DATE(hora,'HH24:MI') - TO_DATE(hora_desde,'HH24:MI'))
   *                  * 24 * 60), 0)
   *
   * envuelta en un CASE que exige que las dos horas matcheen 'HH:MM' o 'H:MM'.
   * Esa validacion reemplaza al EXCEPTION que tenia la funcion: en SQL no hay
   * donde atrapar el ORA-01858 de un TO_DATE con basura, asi que las filas con
   * formato invalido se descartan ANTES de intentar convertirlas.
   *
   * Las que no pasan dan NULL, no 0: un 0 diria "llego puntual", que el dato no
   * respalda. AVG ignora los NULL, asi que no ensucian el promedio.
   *
   * Para alternativas a futuro: se podria declarar la funcion en la SPEC (las
   * publicas si son visibles desde SQL) o marcarla DETERMINISTIC, pero eso la
   * expone como parte del contrato del paquete para algo que es un detalle
   * interno de dos consultas.
   */

  ------------------------------------------------------------------------------
  -- RESUMEN: una fila por facilitador, ordenada de mayor a menor atraso.
  ------------------------------------------------------------------------------
  PROCEDURE resumen(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_anio    VARCHAR2(4);
    l_mes     VARCHAR2(20);
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    l_anio := f_anio(p_anio);
    l_mes  := f_mes(p_mes);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', l_anio);
    APEX_JSON.WRITE('mes',  l_mes);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT id_facilitador,
               nombre_facilitador,
               ROUND(AVG(atraso), 1) AS promedio,
               MAX(atraso)           AS peor,
               COUNT(*)              AS marcaciones,
               -- Cuantas de esas llegadas fueron tarde de verdad. Da contexto:
               -- "8 min de promedio" no es lo mismo con 2 atrasos que con 20.
               COUNT(CASE WHEN atraso > 0 THEN 1 END) AS con_atraso
          FROM (
              -- UNA FILA POR MARCACION, no por grado.
              -- Una marcacion que cubre 7mo y 8vo es una sola llegada; sin este
              -- agrupado pesaria el doble en el promedio. Es el mismo criterio
              -- del GROUP BY de la consulta original.
              SELECT v.id_facilitador,
                     MAX(v.nombre_facilitador) AS nombre_facilitador,
                     -- El atraso, INLINE: una funcion del body no se puede usar
                     -- en SQL (PLS-00231). El CASE valida el formato antes de
                     -- convertir; sin el, una hora con basura tira ORA-01858 y
                     -- en SQL no hay donde atraparlo.
                     MAX(CASE
                           WHEN TRIM(v.hora)       IS NOT NULL
                            AND TRIM(v.hora_desde) IS NOT NULL
                            AND REGEXP_LIKE(TRIM(v.hora),       '^\d{1,2}:\d{2}$')
                            AND REGEXP_LIKE(TRIM(v.hora_desde), '^\d{1,2}:\d{2}$')
                           THEN GREATEST(
                                  ROUND((TO_DATE(TRIM(v.hora),       'HH24:MI')
                                       - TO_DATE(TRIM(v.hora_desde), 'HH24:MI')) * 24 * 60),
                                  0)
                         END) AS atraso
                FROM v_historial_intervenciones v
               WHERE (l_anio IS NULL OR v.anio = l_anio)
                 AND (l_mes  IS NULL OR UPPER(TRIM(v.mes)) = l_mes)
                 AND v.id_facilitador IS NOT NULL
               GROUP BY v.id_facilitador, v.fecha, v.hora, v.hora_desde,
                        v.id_institucion, v.turno
          ) por_marcacion
         -- Las que no se pudieron calcular no entran (hora vacia o con formato
         -- invalido): contarlas como 0 diria "llego puntual", que el dato no
         -- respalda.
         WHERE atraso IS NOT NULL
         GROUP BY id_facilitador, nombre_facilitador
         -- De mayor a menor atraso, que es como se lee el grafico.
         ORDER BY promedio DESC, marcaciones DESC
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_facilitador',     r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_facilitador);
      APEX_JSON.WRITE('promedio',           r.promedio);
      APEX_JSON.WRITE('peor',               r.peor);
      APEX_JSON.WRITE('marcaciones',        r.marcaciones);
      APEX_JSON.WRITE('con_atraso',         r.con_atraso);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END resumen;

  ------------------------------------------------------------------------------
  -- DETALLE: las marcaciones de UN facilitador. Alimenta el modal.
  --
  -- Replica el LISTAGG(GRADO) de la consulta original: una marcacion que cubre
  -- varios grados sale como una fila con "7mo, 8vo", no como dos filas.
  ------------------------------------------------------------------------------
  PROCEDURE detalle(
      p_token          IN VARCHAR2,
      p_id_facilitador IN NUMBER,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN NUMBER   DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_anio    VARCHAR2(4);
    l_mes     VARCHAR2(20);
    l_tope    PLS_INTEGER;
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    IF p_id_facilitador IS NULL THEN
      p_error(400, 'Bad Request', 'intervenciones requiere id_facilitador');
      RETURN;
    END IF;

    l_anio := f_anio(p_anio);
    l_mes  := f_mes(p_mes);
    l_tope := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT MAX(v.id_intervencion) AS id_intervencion,
               v.fecha,
               v.hora,
               v.hora_desde,
               v.hora_hasta,
               -- Misma cuenta que en `resumen`, inline por el mismo motivo
               -- (PLS-00231). Si cambia el criterio, tocar los DOS lugares.
               MAX(CASE
                     WHEN TRIM(v.hora)       IS NOT NULL
                      AND TRIM(v.hora_desde) IS NOT NULL
                      AND REGEXP_LIKE(TRIM(v.hora),       '^\d{1,2}:\d{2}$')
                      AND REGEXP_LIKE(TRIM(v.hora_desde), '^\d{1,2}:\d{2}$')
                     THEN GREATEST(
                            ROUND((TO_DATE(TRIM(v.hora),       'HH24:MI')
                                 - TO_DATE(TRIM(v.hora_desde), 'HH24:MI')) * 24 * 60),
                            0)
                   END) AS atraso,
               v.id_institucion,
               MAX(v.nombre)   AS institucion,
               v.turno,
               -- Los grados de esa marcacion, juntos: es UNA llegada.
               LISTAGG(v.grado, ', ') WITHIN GROUP (ORDER BY v.grado) AS grado,
               v.seccion,
               MAX(v.descripcion) AS enfasis,
               MAX(v.manual)      AS manual,
               v.si_no,
               MAX(v.observacion)        AS observacion,
               MAX(v.motivo_desarrollo)  AS motivo_desarrollo,
               v.mes,
               v.anio,
               -- La coma decimal rompe el parseo en JS: se normaliza a punto.
               REPLACE(MAX(v.latitud),  ',', '.') AS latitud,
               REPLACE(MAX(v.longitud), ',', '.') AS longitud,
               MAX(v.ubicacion_insitutcion) AS ubicacion_institucion
          FROM v_historial_intervenciones v
         WHERE v.id_facilitador = p_id_facilitador
           AND (l_anio IS NULL OR v.anio = l_anio)
           AND (l_mes  IS NULL OR UPPER(TRIM(v.mes)) = l_mes)
         GROUP BY v.fecha, v.hora, v.hora_desde, v.hora_hasta,
                  v.id_institucion, v.turno, v.seccion, v.si_no, v.mes, v.anio
         -- La ultima marcacion primero: es lo que se quiere ver al abrir.
         ORDER BY id_intervencion DESC
         FETCH FIRST l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion', r.id_intervencion);
      APEX_JSON.WRITE('fecha',           r.fecha);
      APEX_JSON.WRITE('hora',            r.hora);
      APEX_JSON.WRITE('hora_desde',      r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',      r.hora_hasta);
      APEX_JSON.WRITE('atraso',          r.atraso);
      APEX_JSON.WRITE('id_institucion',  r.id_institucion);
      APEX_JSON.WRITE('institucion',     r.institucion);
      APEX_JSON.WRITE('turno',           r.turno);
      APEX_JSON.WRITE('grado',           r.grado);
      APEX_JSON.WRITE('seccion',         r.seccion);
      APEX_JSON.WRITE('enfasis',         r.enfasis);
      APEX_JSON.WRITE('manual',          r.manual);
      APEX_JSON.WRITE('si_no',           r.si_no);
      APEX_JSON.WRITE('observacion',        r.observacion);
      APEX_JSON.WRITE('motivo_desarrollo',  r.motivo_desarrollo);
      APEX_JSON.WRITE('mes',             r.mes);
      APEX_JSON.WRITE('anio',            r.anio);
      APEX_JSON.WRITE('latitud',         r.latitud);
      APEX_JSON.WRITE('longitud',        r.longitud);
      APEX_JSON.WRITE('ubicacion_institucion', r.ubicacion_institucion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END detalle;

END PKG_INTERVENCIONES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINTS ORDS ======================================================
--
-- Se agregan al modulo 'ethos' que creo ethos_auth.sql.
-- El DEFINE_PARAMETER del header Authorization va por CADA handler: si falta,
-- :authorization llega NULL y todo responde "Token invalido".
--------------------------------------------------------------------------------

BEGIN
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones',         'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones',         'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ----------------------------------------------------------------------------
  -- intervenciones/resumen  ?anio=&mes=
  --
  -- El template va con prioridad 1, MAS ALTA que 'intervenciones' (0): ORDS
  -- evalua por prioridad y sin esto 'intervenciones/resumen' podria caer en el
  -- handler generico.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/resumen',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/resumen',
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
    PKG_INTERVENCIONES_ETHOS.RESUMEN(
        p_token => l_token,
        p_anio  => :anio,
        p_mes   => TO_NUMBER(:mes));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/resumen',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- intervenciones  ?id_facilitador=&anio=&mes=&limite=
  ----------------------------------------------------------------------------
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
    PKG_INTERVENCIONES_ETHOS.DETALLE(
        p_token          => l_token,
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_anio           => :anio,
        p_mes            => TO_NUMBER(:mes),
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
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de intervenciones publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudieron publicar los handlers: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/ethos_auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, a prueba de fallos: algunas versiones de ORDS rechazan
-- OPTIONS en p_method. Solo hace falta si un navegador le pega DIRECTO a ORDS.
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
  preflight('intervenciones');
  preflight('intervenciones/resumen');
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
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_INTERVENCIONES_ETHOS'
     AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INTERVENCIONES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/resumen ?anio=&mes=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones         ?id_facilitador=&anio=&mes=&limite=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        Mira los errores con:');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_INTERVENCIONES_ETHOS'';');
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS no se creo.');
END;
/
