--------------------------------------------------------------------------------
-- INTERVENCIONES CRUD  —  carga manual de intervenciones atrasadas
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     intervenciones-crud            ?anio=&mes=&id_facilitador=&id_institucion=
--                                          &buscar=&limite=&pagina=
--   GET     intervenciones-crud/:id
--   POST    intervenciones-crud
--   PUT     intervenciones-crud/:id
--   DELETE  intervenciones-crud/:id
--
-- ES UN MODULO APARTE DE `intervenciones` (el de los graficos), a proposito:
-- aquel es SOLO LECTURA y devuelve las marcaciones DESVIADAS de una vista.
-- Este escribe sobre la tabla INTERVENCIONES y devuelve TODAS las filas.
-- Mezclarlos haria que el endpoint de los graficos tenga que distinguir "todas"
-- de "solo las desviadas" segun quien pregunte.
--
-- CORRER DESPUES de auth.sql (necesita el modulo ORDS 'ethos' y PKG_AUTH_ETHOS).
-- NO depende del paquete de evaluaciones ni del de intervenciones.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- LA POSTULACION ES EL EJE. DE ELLA SALEN SEIS CAMPOS.
--------------------------------------------------------------------------------
--
-- ID_POSTULACION es NOT NULL con FK, y una postulacion YA SABE de que clase se
-- trata. Por eso el front manda UN id y el backend deriva:
--
--   ID_INSTITUCION, ID_FACILITADOR, TURNO, GRADO, SECCION, ID_ENFASIS
--
-- Pedirlos por separado permitiria guardar una intervencion cuya institucion no
-- sea la de su propia postulacion. Derivarlos lo hace imposible por construccion.
--
-- GRADO se deriva distinto que los otros cinco: POSTULACIONES tiene UNA COLUMNA
-- POR GRADO ("4","5",..,"3M") con la matricula adentro, no una columna "grado".
-- f_grado_postulacion() devuelve la primera con valor. Si una postulacion cubre
-- varios grados, el front tiene que mandar `p_grado` explicito.
--
--------------------------------------------------------------------------------
-- USUARIO: VA EL DEL FACILITADOR, NO EL DEL OPERADOR
--------------------------------------------------------------------------------
--
-- INTERVENCIONES.USUARIO es NOT NULL y lo lee TRG_INTERV_UBICACION para buscar
-- en FACILITADORES por USUARIO **e** ID_FACILITADOR juntos. Si se guardara el
-- usuario de quien carga, ese SELECT no encontraria la fila, el trigger caeria
-- en su WHEN NO_DATA_FOUND y asumiria 'SI' — o sea, no respetaria la preferencia
-- de ubicacion del facilitador real.
--
-- Por eso lo deriva el backend de FACILITADORES.USUARIO. Y como esa columna es
-- NULLABLE, puede no haber: ahi el INSERT fallaria con ORA-01400 crudo. Se
-- valida antes y se responde un mensaje que dice que hacer.
--
--------------------------------------------------------------------------------
-- LOS CINCO TRIGGERS QUE YA ESTAN EN LA TABLA. NINGUNO SE TOCA.
--------------------------------------------------------------------------------
--
--   AUDITORIA_INTERVENCIONES     -> escribe INTERVENCIONES_JN en cada operacion
--   TRG_INTERVENCIONES_SET_ANIO  -> ANIO = FN_ANIO_LECTIVO_ACTUAL() si viene NULL
--   TRG_INTERVENCIONES_SET_FECHA -> FECHA_HORA = SYSDATE-3h si viene NULL
--   TRG_INTERV_SINO_MOTIVO       -> SI limpia el motivo; NO lo exige (ORA-20001)
--   TRG_INTERV_UBICACION         -> LAT/LON a '0' si el facilitador tiene
--                                   IND_UBICACION_POSTULACION = 'NO'
--   TRG_INTERV_FINALIZA_POST     -> marca la POSTULACION como 'Finalizado' al
--                                   cargar el ultimo indice del manual con 'Si'
--
-- DOS CONSECUENCIAS QUE IMPORTAN PARA LA CARGA ATRASADA:
--
--   1. FECHA_HORA se manda SIEMPRE. El trigger solo la pone si viene NULL, y
--      para una intervencion atrasada la fecha de hoy seria incorrecta.
--
--   2. TRG_INTERV_FINALIZA_POST **no tiene vuelta atras**. Borrar la
--      intervencion que finalizo una postulacion NO la reabre. `eliminar`
--      detecta ese caso y lo INFORMA en la respuesta (postulacion_finalizada),
--      para que el front lo avise. No se revierte solo: decidirlo es del
--      usuario, no de este paquete.
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

  SELECT COUNT(*) INTO l_n FROM all_tables WHERE table_name = 'INTERVENCIONES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla INTERVENCIONES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla INTERVENCIONES encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INTERV_CRUD_ETHOS AS

  -- Lista paginada. Todos los filtros son opcionales.
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN VARCHAR2 DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_buscar         IN VARCHAR2 DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL,
      p_pagina         IN NUMBER   DEFAULT NULL);

  -- Una intervencion, con todo lo que el formulario necesita para editarla.
  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN NUMBER);

  -- Alta. Devuelve el id generado.
  PROCEDURE insertar(
      p_token             IN VARCHAR2,
      p_id_postulacion    IN NUMBER,
      p_id_indice         IN NUMBER,
      p_si_no             IN VARCHAR2,
      p_fecha_hora        IN VARCHAR2 DEFAULT NULL, -- 'DD/MM/YYYY HH24:MI'
      p_motivo_desarrollo IN VARCHAR2 DEFAULT NULL,
      p_observacion       IN VARCHAR2 DEFAULT NULL,
      p_latitud           IN VARCHAR2 DEFAULT NULL,
      p_longitud          IN VARCHAR2 DEFAULT NULL,
      p_grado             IN VARCHAR2 DEFAULT NULL,
      p_seccion           IN VARCHAR2 DEFAULT NULL);

  -- Modificacion. Mismos campos que el alta.
  PROCEDURE actualizar(
      p_token             IN VARCHAR2,
      p_id                IN NUMBER,
      p_id_postulacion    IN NUMBER,
      p_id_indice         IN NUMBER,
      p_si_no             IN VARCHAR2,
      p_fecha_hora        IN VARCHAR2 DEFAULT NULL,
      p_motivo_desarrollo IN VARCHAR2 DEFAULT NULL,
      p_observacion       IN VARCHAR2 DEFAULT NULL,
      p_latitud           IN VARCHAR2 DEFAULT NULL,
      p_longitud          IN VARCHAR2 DEFAULT NULL,
      p_grado             IN VARCHAR2 DEFAULT NULL,
      p_seccion           IN VARCHAR2 DEFAULT NULL);

  -- Baja. Informa si la fila habia finalizado su postulacion.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER);

END PKG_INTERV_CRUD_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INTERV_CRUD_ETHOS AS

  c_limite_defecto CONSTANT PLS_INTEGER := 50;
  c_limite_maximo  CONSTANT PLS_INTEGER := 500;

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

  -- Traduce los ORA a algo accionable. Sin esto el front recibe
  -- "ORA-02291: integrity constraint violated" y no hay nada que hacer con eso.
  --
  -- El -20001 es el de TRG_INTERV_SINO_MOTIVO: su mensaje ya esta escrito para
  -- el usuario, asi que se reenvia tal cual en vez de reemplazarlo.
  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -20001 THEN
        p_error(400, 'Bad Request',
                REGEXP_REPLACE(SQLERRM, '^ORA-[0-9]+: ', ''));
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request',
                'Alguna referencia no existe (postulacion, indice, facilitador, '
                || 'institucion o enfasis). Verifica los datos enviados.');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict',
                'No se puede eliminar: hay registros que dependen de esta intervencion');
      WHEN SQLCODE = -1400 THEN
        p_error(400, 'Bad Request', 'Falta un campo obligatorio');
      WHEN SQLCODE IN (-1438, -12899) THEN
        p_error(400, 'Bad Request', 'Un texto excede el largo permitido');
      WHEN SQLCODE = -1861 THEN
        p_error(400, 'Bad Request', 'La fecha debe venir como DD/MM/YYYY HH24:MI');
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

  /* ---------------------------------------------------------------------- */
  /* Derivaciones desde la postulacion                                      */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- EL GRADO DE UNA POSTULACION.
  --
  -- POSTULACIONES no tiene una columna "grado": tiene UNA COLUMNA POR GRADO
  -- ("2","3","4",..,"9","1M","2M","3M") y adentro va la MATRICULA de ese grado.
  -- Una postulacion con 25 en la columna "7" es una clase de 7mo con 25 alumnos.
  --
  -- Esto devuelve el nombre de la primera columna con valor, que es lo que
  -- INTERVENCIONES.GRADO guarda como texto ('7º', '1M'...).
  --
  -- LIMITE CONOCIDO: si una postulacion tiene varias columnas cargadas, devuelve
  -- solo la primera. Por eso `insertar` acepta p_grado explicito: el front, que
  -- muestra la tarjeta con todos los grados, puede decir cual es.
  ------------------------------------------------------------------------------
  FUNCTION f_grado_postulacion(p_id_postulacion IN NUMBER) RETURN VARCHAR2 IS
    l_grado VARCHAR2(5);
  BEGIN
    SELECT CASE
             WHEN "2"  IS NOT NULL THEN '2º'
             WHEN "3"  IS NOT NULL THEN '3º'
             WHEN "4"  IS NOT NULL THEN '4º'
             WHEN "5"  IS NOT NULL THEN '5º'
             WHEN "6"  IS NOT NULL THEN '6º'
             WHEN "7"  IS NOT NULL THEN '7º'
             WHEN "8"  IS NOT NULL THEN '8º'
             WHEN "9"  IS NOT NULL THEN '9º'
             WHEN "1M" IS NOT NULL THEN '1M'
             WHEN "2M" IS NOT NULL THEN '2M'
             WHEN "3M" IS NOT NULL THEN '3M'
           END
      INTO l_grado
      FROM postulaciones
     WHERE id_postulacion = p_id_postulacion;
    RETURN l_grado;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END f_grado_postulacion;

  ------------------------------------------------------------------------------
  -- EL MANUAL AL QUE PERTENECE UN INDICE.
  --
  -- INTERVENCIONES.MANUAL es NOT NULL y **redundante**: se puede deducir del
  -- ID_INDICE, porque INDICES_MANUALES.MANUAL ya lo dice. Se deriva en vez de
  -- pedirlo para que no puedan quedar inconsistentes — y porque
  -- TRG_INTERV_FINALIZA_POST compara :NEW.MANUAL contra el manual del indice: si
  -- no coincidieran, ese trigger no detectaria nunca el ultimo indice.
  ------------------------------------------------------------------------------
  FUNCTION f_manual_indice(p_id_indice IN NUMBER) RETURN VARCHAR2 IS
    l_manual VARCHAR2(100);
  BEGIN
    SELECT manual INTO l_manual
      FROM indices_manuales WHERE id_indice = p_id_indice;
    RETURN l_manual;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END f_manual_indice;

  ------------------------------------------------------------------------------
  -- Valida y deriva TODO lo que sale de la postulacion y del indice.
  --
  -- Se hace en un solo lugar porque `insertar` y `actualizar` necesitan
  -- exactamente lo mismo, y tenerlo duplicado es como se desincronizan.
  --
  -- Levanta e_validacion con un mensaje en g_mensaje. Nunca deja que el error
  -- llegue como ORA crudo: cada caso tiene su explicacion.
  ------------------------------------------------------------------------------
  PROCEDURE derivar(
      p_id_postulacion IN  NUMBER,
      p_id_indice      IN  NUMBER,
      p_si_no          IN  VARCHAR2,
      o_id_facilitador OUT NUMBER,
      o_id_institucion OUT NUMBER,
      o_turno          OUT NUMBER,
      o_id_enfasis     OUT NUMBER,
      o_seccion        OUT VARCHAR2,
      o_usuario        OUT VARCHAR2,
      o_manual         OUT VARCHAR2) IS
  BEGIN
    IF p_id_postulacion IS NULL THEN
      g_mensaje := 'id_postulacion es obligatorio'; RAISE e_validacion;
    END IF;
    IF p_id_indice IS NULL THEN
      g_mensaje := 'id_indice es obligatorio'; RAISE e_validacion;
    END IF;
    IF UPPER(TRIM(p_si_no)) NOT IN ('SI', 'NO') THEN
      g_mensaje := 'si_no debe ser Si o No'; RAISE e_validacion;
    END IF;

    -- La postulacion, con el usuario del facilitador ya unido.
    BEGIN
      SELECT p.id_facilitador, p.id_institucion, p.turno, p.id_enfasis,
             p.seccion, f.usuario
        INTO o_id_facilitador, o_id_institucion, o_turno, o_id_enfasis,
             o_seccion, o_usuario
        FROM postulaciones p
        JOIN facilitadores f ON f.id_facilitador = p.id_facilitador
       WHERE p.id_postulacion = p_id_postulacion;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        -- Dos causas y conviene separarlas: o la postulacion no existe, o existe
        -- pero no tiene facilitador (ID_FACILITADOR es NULLABLE en POSTULACIONES).
        DECLARE l_n PLS_INTEGER;
        BEGIN
          SELECT COUNT(*) INTO l_n FROM postulaciones
           WHERE id_postulacion = p_id_postulacion;
          IF l_n = 0 THEN
            g_mensaje := 'La postulacion ' || p_id_postulacion || ' no existe';
          ELSE
            g_mensaje := 'La postulacion ' || p_id_postulacion
                      || ' no tiene facilitador asignado';
          END IF;
        END;
        RAISE e_validacion;
    END;

    -- USUARIO es NOT NULL en INTERVENCIONES pero NULLABLE en FACILITADORES.
    -- Sin esto el INSERT falla con un ORA-01400 que no dice donde esta el
    -- problema real, que es la ficha del facilitador.
    IF o_usuario IS NULL THEN
      g_mensaje := 'El facilitador de esa postulacion no tiene USUARIO cargado '
                || 'en su ficha. Cargalo antes de registrar intervenciones.';
      RAISE e_validacion;
    END IF;

    o_manual := f_manual_indice(p_id_indice);
    IF o_manual IS NULL THEN
      g_mensaje := 'El indice ' || p_id_indice || ' no existe'; RAISE e_validacion;
    END IF;
  END derivar;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN VARCHAR2 DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_buscar         IN VARCHAR2 DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL,
      p_pagina         IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_tope    PLS_INTEGER;
    l_pagina  PLS_INTEGER;
    l_offset  PLS_INTEGER;
    l_mes     NUMBER;
    l_patron  VARCHAR2(500);
    l_total   PLS_INTEGER;
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    l_tope   := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);
    l_pagina := GREATEST(NVL(p_pagina, 1), 1);
    l_offset := (l_pagina - 1) * l_tope;
    l_patron := CASE WHEN TRIM(p_buscar) IS NOT NULL
                     THEN '%' || UPPER(TRIM(p_buscar)) || '%' END;

    -- El mes por NUMERO, desde FECHA_HORA. Nunca por el nombre del mes: ver la
    -- nota del encabezado de backend/intervenciones.sql — la columna MES de la
    -- vista viene en el idioma de la sesion y comparar contra ella no es fiable.
    BEGIN
      l_mes := TO_NUMBER(TRIM(p_mes));
      IF l_mes NOT BETWEEN 1 AND 12 THEN l_mes := NULL; END IF;
    EXCEPTION
      WHEN OTHERS THEN
        l_mes := CASE UPPER(TRIM(p_mes))
                   WHEN 'ENERO' THEN 1       WHEN 'FEBRERO' THEN 2
                   WHEN 'MARZO' THEN 3       WHEN 'ABRIL' THEN 4
                   WHEN 'MAYO' THEN 5        WHEN 'JUNIO' THEN 6
                   WHEN 'JULIO' THEN 7       WHEN 'AGOSTO' THEN 8
                   WHEN 'SETIEMBRE' THEN 9   WHEN 'SEPTIEMBRE' THEN 9
                   WHEN 'OCTUBRE' THEN 10    WHEN 'NOVIEMBRE' THEN 11
                   WHEN 'DICIEMBRE' THEN 12
                 END;
    END;

    SELECT COUNT(*) INTO l_total
      FROM intervenciones i
      JOIN facilitadores f ON f.id_facilitador = i.id_facilitador
      JOIN instituciones ins ON ins.id_institucion = i.id_institucion
     WHERE (p_anio IS NULL OR i.anio = TRIM(p_anio))
       AND (l_mes IS NULL OR EXTRACT(MONTH FROM i.fecha_hora) = l_mes)
       AND (p_id_facilitador IS NULL OR i.id_facilitador = p_id_facilitador)
       AND (p_id_institucion IS NULL OR i.id_institucion = p_id_institucion)
       AND (l_patron IS NULL
            OR UPPER(f.nombre_apellido) LIKE l_patron
            OR UPPER(ins.nombre) LIKE l_patron
            OR UPPER(i.manual) LIKE l_patron);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT i.id_intervencion, i.id_facilitador, f.nombre_apellido,
               i.id_institucion, ins.nombre AS institucion,
               i.id_postulacion, i.turno, i.grado, i.seccion,
               i.id_enfasis, e.descripcion AS enfasis,
               i.manual, i.id_indice, im.nro_indice, im.titulo AS indice_titulo,
               i.si_no, i.motivo_desarrollo, i.observacion,
               TO_CHAR(i.fecha_hora, 'DD/MM/YYYY') AS fecha,
               TO_CHAR(i.fecha_hora, 'HH24:MI')    AS hora,
               i.latitud, i.longitud, i.anio
          FROM intervenciones i
          JOIN facilitadores f    ON f.id_facilitador  = i.id_facilitador
          JOIN instituciones ins  ON ins.id_institucion = i.id_institucion
          LEFT JOIN indices_manuales im ON im.id_indice = i.id_indice
          LEFT JOIN enfasis e     ON e.id_enfasis      = i.id_enfasis
         WHERE (p_anio IS NULL OR i.anio = TRIM(p_anio))
           AND (l_mes IS NULL OR EXTRACT(MONTH FROM i.fecha_hora) = l_mes)
           AND (p_id_facilitador IS NULL OR i.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR i.id_institucion = p_id_institucion)
           AND (l_patron IS NULL
                OR UPPER(f.nombre_apellido) LIKE l_patron
                OR UPPER(ins.nombre) LIKE l_patron
                OR UPPER(i.manual) LIKE l_patron)
         ORDER BY i.fecha_hora DESC, i.id_intervencion DESC
         OFFSET l_offset ROWS FETCH NEXT l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion',   r.id_intervencion);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_apellido);
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('institucion',       r.institucion);
      APEX_JSON.WRITE('id_postulacion',    r.id_postulacion);
      APEX_JSON.WRITE('turno',             r.turno);
      APEX_JSON.WRITE('grado',             r.grado);
      APEX_JSON.WRITE('seccion',           r.seccion);
      APEX_JSON.WRITE('id_enfasis',        r.id_enfasis);
      APEX_JSON.WRITE('enfasis',           r.enfasis);
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('id_indice',         r.id_indice);
      APEX_JSON.WRITE('nro_indice',        r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',     r.indice_titulo);
      APEX_JSON.WRITE('si_no',             r.si_no);
      APEX_JSON.WRITE('motivo_desarrollo', r.motivo_desarrollo);
      APEX_JSON.WRITE('observacion',       r.observacion);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('hora',              r.hora);
      APEX_JSON.WRITE('latitud',           r.latitud);
      APEX_JSON.WRITE('longitud',          r.longitud);
      APEX_JSON.WRITE('anio',              r.anio);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* OBTENER                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN NUMBER) IS
    l_usuario VARCHAR2(255);
    l_n       PLS_INTEGER := 0;
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF p_id IS NULL THEN
      p_error(400, 'Bad Request', 'id es obligatorio'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM intervenciones WHERE id_intervencion = p_id;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'Intervencion no encontrada'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_OBJECT('data');

    FOR r IN (
        SELECT i.id_intervencion, i.id_facilitador, f.nombre_apellido,
               i.id_institucion, ins.nombre AS institucion,
               i.id_postulacion, i.turno, i.grado, i.seccion,
               i.id_enfasis, e.descripcion AS enfasis,
               i.manual, i.id_indice, im.nro_indice, im.titulo AS indice_titulo,
               i.si_no, i.motivo_desarrollo, i.observacion,
               TO_CHAR(i.fecha_hora, 'DD/MM/YYYY') AS fecha,
               TO_CHAR(i.fecha_hora, 'HH24:MI')    AS hora,
               i.latitud, i.longitud, i.anio
          FROM intervenciones i
          JOIN facilitadores f    ON f.id_facilitador  = i.id_facilitador
          JOIN instituciones ins  ON ins.id_institucion = i.id_institucion
          LEFT JOIN indices_manuales im ON im.id_indice = i.id_indice
          LEFT JOIN enfasis e     ON e.id_enfasis      = i.id_enfasis
         WHERE i.id_intervencion = p_id
    ) LOOP
      APEX_JSON.WRITE('id_intervencion',   r.id_intervencion);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_apellido);
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('institucion',       r.institucion);
      APEX_JSON.WRITE('id_postulacion',    r.id_postulacion);
      APEX_JSON.WRITE('turno',             r.turno);
      APEX_JSON.WRITE('grado',             r.grado);
      APEX_JSON.WRITE('seccion',           r.seccion);
      APEX_JSON.WRITE('id_enfasis',        r.id_enfasis);
      APEX_JSON.WRITE('enfasis',           r.enfasis);
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('id_indice',         r.id_indice);
      APEX_JSON.WRITE('nro_indice',        r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',     r.indice_titulo);
      APEX_JSON.WRITE('si_no',             r.si_no);
      APEX_JSON.WRITE('motivo_desarrollo', r.motivo_desarrollo);
      APEX_JSON.WRITE('observacion',       r.observacion);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('hora',              r.hora);
      APEX_JSON.WRITE('latitud',           r.latitud);
      APEX_JSON.WRITE('longitud',          r.longitud);
      APEX_JSON.WRITE('anio',              r.anio);
    END LOOP;

    APEX_JSON.CLOSE_OBJECT;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END obtener;

  /* ---------------------------------------------------------------------- */
  /* INSERTAR                                                               */
  /* ---------------------------------------------------------------------- */

  PROCEDURE insertar(
      p_token             IN VARCHAR2,
      p_id_postulacion    IN NUMBER,
      p_id_indice         IN NUMBER,
      p_si_no             IN VARCHAR2,
      p_fecha_hora        IN VARCHAR2 DEFAULT NULL,
      p_motivo_desarrollo IN VARCHAR2 DEFAULT NULL,
      p_observacion       IN VARCHAR2 DEFAULT NULL,
      p_latitud           IN VARCHAR2 DEFAULT NULL,
      p_longitud          IN VARCHAR2 DEFAULT NULL,
      p_grado             IN VARCHAR2 DEFAULT NULL,
      p_seccion           IN VARCHAR2 DEFAULT NULL
  ) IS
    l_login          VARCHAR2(255);
    l_id             NUMBER;
    l_id_facilitador NUMBER;
    l_id_institucion NUMBER;
    l_turno          NUMBER;
    l_id_enfasis     NUMBER;
    l_seccion        VARCHAR2(5);
    l_usuario_fac    VARCHAR2(100);
    l_manual         VARCHAR2(100);
    l_fecha          DATE;
  BEGIN
    l_login := f_usuario(p_token);
    IF l_login IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    derivar(p_id_postulacion, p_id_indice, p_si_no,
            l_id_facilitador, l_id_institucion, l_turno, l_id_enfasis,
            l_seccion, l_usuario_fac, l_manual);

    -- LA FECHA SE MANDA SIEMPRE que venga: TRG_INTERVENCIONES_SET_FECHA solo
    -- actua si es NULL, y para una carga atrasada la fecha de hoy es incorrecta.
    -- Sin fecha, se deja que el trigger ponga la de hoy (alta del dia).
    IF TRIM(p_fecha_hora) IS NOT NULL THEN
      l_fecha := TO_DATE(TRIM(p_fecha_hora), 'DD/MM/YYYY HH24:MI');
    END IF;

    INSERT INTO intervenciones (
        id_facilitador, usuario, fecha_hora, manual, latitud, longitud,
        observacion, id_indice, si_no, id_institucion, turno, id_postulacion,
        grado, seccion, id_enfasis, motivo_desarrollo)
    VALUES (
        l_id_facilitador,
        l_usuario_fac,                       -- el del FACILITADOR, ver encabezado
        l_fecha,                             -- NULL -> lo pone el trigger
        l_manual,                            -- derivado del indice
        -- LATITUD/LONGITUD son NOT NULL. Sin coordenadas va '0'/'0', que es lo
        -- mismo que escribe TRG_INTERV_UBICACION y que f_distancia lee como
        -- "no se sabe" — asi una carga manual no inventa una infraccion de
        -- ubicacion en el grafico.
        NVL(TRIM(p_latitud),  '0'),
        NVL(TRIM(p_longitud), '0'),
        p_observacion,
        p_id_indice,
        INITCAP(TRIM(p_si_no)),              -- 'Si'/'No': TRG_INTERV_SINO_MOTIVO
                                             -- compara con UPPER, pero la tabla
                                             -- guarda 'Si' en todo lo ya cargado
        l_id_institucion,
        l_turno,
        p_id_postulacion,
        NVL(TRIM(p_grado), f_grado_postulacion(p_id_postulacion)),
        NVL(TRIM(p_seccion), l_seccion),
        l_id_enfasis,
        p_motivo_desarrollo)
    RETURNING id_intervencion INTO l_id;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_intervencion', l_id);
    APEX_JSON.WRITE('message', 'Intervencion registrada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END insertar;

  /* ---------------------------------------------------------------------- */
  /* ACTUALIZAR                                                             */
  /* ---------------------------------------------------------------------- */

  PROCEDURE actualizar(
      p_token             IN VARCHAR2,
      p_id                IN NUMBER,
      p_id_postulacion    IN NUMBER,
      p_id_indice         IN NUMBER,
      p_si_no             IN VARCHAR2,
      p_fecha_hora        IN VARCHAR2 DEFAULT NULL,
      p_motivo_desarrollo IN VARCHAR2 DEFAULT NULL,
      p_observacion       IN VARCHAR2 DEFAULT NULL,
      p_latitud           IN VARCHAR2 DEFAULT NULL,
      p_longitud          IN VARCHAR2 DEFAULT NULL,
      p_grado             IN VARCHAR2 DEFAULT NULL,
      p_seccion           IN VARCHAR2 DEFAULT NULL
  ) IS
    l_login          VARCHAR2(255);
    l_id_facilitador NUMBER;
    l_id_institucion NUMBER;
    l_turno          NUMBER;
    l_id_enfasis     NUMBER;
    l_seccion        VARCHAR2(5);
    l_usuario_fac    VARCHAR2(100);
    l_manual         VARCHAR2(100);
    l_fecha          DATE;
    l_n              PLS_INTEGER;
  BEGIN
    l_login := f_usuario(p_token);
    IF l_login IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF p_id IS NULL THEN
      p_error(400, 'Bad Request', 'id es obligatorio'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM intervenciones WHERE id_intervencion = p_id;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'Intervencion no encontrada'); RETURN;
    END IF;

    derivar(p_id_postulacion, p_id_indice, p_si_no,
            l_id_facilitador, l_id_institucion, l_turno, l_id_enfasis,
            l_seccion, l_usuario_fac, l_manual);

    -- En el UPDATE la fecha NO tiene trigger de respaldo: TRG_INTERVENCIONES_SET_FECHA
    -- es BEFORE INSERT. Si viene vacia se deja la que ya tenia.
    IF TRIM(p_fecha_hora) IS NOT NULL THEN
      l_fecha := TO_DATE(TRIM(p_fecha_hora), 'DD/MM/YYYY HH24:MI');
    END IF;

    UPDATE intervenciones
       SET id_facilitador    = l_id_facilitador,
           usuario           = l_usuario_fac,
           fecha_hora        = NVL(l_fecha, fecha_hora),
           manual            = l_manual,
           latitud           = NVL(TRIM(p_latitud),  latitud),
           longitud          = NVL(TRIM(p_longitud), longitud),
           observacion       = p_observacion,
           id_indice         = p_id_indice,
           si_no             = INITCAP(TRIM(p_si_no)),
           id_institucion    = l_id_institucion,
           turno             = l_turno,
           id_postulacion    = p_id_postulacion,
           grado             = NVL(TRIM(p_grado), f_grado_postulacion(p_id_postulacion)),
           seccion           = NVL(TRIM(p_seccion), l_seccion),
           id_enfasis        = l_id_enfasis,
           motivo_desarrollo = p_motivo_desarrollo
     WHERE id_intervencion = p_id;

    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Intervencion actualizada');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_validacion THEN
      ROLLBACK;
      p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END actualizar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- BORRA, Y AVISA SI DEJO UNA POSTULACION FINALIZADA SIN VUELTA ATRAS.
  --
  -- TRG_INTERV_FINALIZA_POST es AFTER INSERT OR UPDATE: marca la postulacion
  -- como 'Finalizado' cuando se carga el ultimo indice del manual con 'Si'.
  -- **No hay trigger inverso**: borrar esa intervencion NO reabre la postulacion.
  --
  -- Este procedimiento NO la reabre solo —seria decidir por el usuario sobre
  -- otra tabla— pero SI detecta el caso y lo devuelve en `postulacion_finalizada`
  -- para que el front lo avise. Sin eso, el estado quedaria mal en silencio.
  ------------------------------------------------------------------------------
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN NUMBER) IS
    l_login       VARCHAR2(255);
    l_n           PLS_INTEGER;
    l_id_post     NUMBER;
    l_id_indice   NUMBER;
    l_si_no       VARCHAR2(50);
    l_manual      VARCHAR2(100);
    l_ultimo      NUMBER;
    l_estado      VARCHAR2(50);
    l_finalizo    BOOLEAN := FALSE;
  BEGIN
    l_login := f_usuario(p_token);
    IF l_login IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;
    IF p_id IS NULL THEN
      p_error(400, 'Bad Request', 'id es obligatorio'); RETURN;
    END IF;

    BEGIN
      SELECT id_postulacion, id_indice, si_no, manual
        INTO l_id_post, l_id_indice, l_si_no, l_manual
        FROM intervenciones WHERE id_intervencion = p_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'Intervencion no encontrada'); RETURN;
    END;

    -- ¿Esta fila es la que finalizo la postulacion? Mismo criterio que el
    -- trigger: el indice mas alto del manual, con 'Si'.
    IF UPPER(TRIM(l_si_no)) = 'SI' THEN
      BEGIN
        SELECT id_indice INTO l_ultimo
          FROM indices_manuales
         WHERE manual = l_manual
         ORDER BY nro_indice DESC
         FETCH FIRST 1 ROW ONLY;

        SELECT estado INTO l_estado
          FROM postulaciones WHERE id_postulacion = l_id_post;

        l_finalizo := (l_ultimo = l_id_indice AND l_estado = 'Finalizado');
      EXCEPTION
        WHEN NO_DATA_FOUND THEN l_finalizo := FALSE;
      END;
    END IF;

    DELETE FROM intervenciones WHERE id_intervencion = p_id;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Intervencion eliminada');
    -- El front usa esto para mostrar la advertencia. `id_postulacion` viaja
    -- para que pueda nombrarla en el aviso.
    APEX_JSON.WRITE('postulacion_finalizada', l_finalizo);
    APEX_JSON.WRITE('id_postulacion', l_id_post);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_INTERV_CRUD_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINTS ORDS ======================================================
--
-- Se agregan al modulo 'ethos' que creo auth.sql.
-- El DEFINE_PARAMETER del header Authorization va por CADA handler: si falta,
-- :authorization llega NULL y todo responde "Token invalido".
--------------------------------------------------------------------------------

DECLARE
  -- El bloque que extrae el token del header. Es identico en los cinco
  -- handlers, asi que se arma una vez: copiarlo cinco veces es como se
  -- desincronizan.
  c_token CONSTANT VARCHAR2(400) := '
    l_token := :authorization;
    IF l_token IS NOT NULL THEN
        l_pos := INSTR(UPPER(l_token), ''BEARER '');
        IF l_pos > 0 THEN
            l_token := TRIM(SUBSTR(l_token, l_pos + 7));
        END IF;
    END IF;';

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
BEGIN
  -- Idempotencia: se borra lo que hubiera de una corrida anterior.
  FOR r IN (SELECT 'intervenciones-crud' AS p FROM dual
            UNION ALL SELECT 'intervenciones-crud/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ----------------------------------------------------------------------------
  -- intervenciones-crud   (coleccion)
  ----------------------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud',
      p_priority    => 0,
      p_etag_type   => 'NONE');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud',
      p_method      => 'GET',
      p_source_type => 'plsql/block',
      p_source      => 'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN'
                    || c_token || '
    PKG_INTERV_CRUD_ETHOS.LISTAR(
        p_token          => l_token,
        p_anio           => :anio,
        p_mes            => :mes,
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_id_institucion => TO_NUMBER(:id_institucion),
        p_buscar         => :buscar,
        p_limite         => TO_NUMBER(:limite),
        p_pagina         => TO_NUMBER(:pagina));
END;');
  auth_param('intervenciones-crud', 'GET');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud',
      p_method      => 'POST',
      p_source_type => 'plsql/block',
      p_source      => 'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN'
                    || c_token || '
    PKG_INTERV_CRUD_ETHOS.INSERTAR(
        p_token             => l_token,
        p_id_postulacion    => TO_NUMBER(:id_postulacion),
        p_id_indice         => TO_NUMBER(:id_indice),
        p_si_no             => :si_no,
        p_fecha_hora        => :fecha_hora,
        p_motivo_desarrollo => :motivo_desarrollo,
        p_observacion       => :observacion,
        p_latitud           => :latitud,
        p_longitud          => :longitud,
        p_grado             => :grado,
        p_seccion           => :seccion);
END;');
  auth_param('intervenciones-crud', 'POST');

  ----------------------------------------------------------------------------
  -- intervenciones-crud/:id   (item)
  --
  -- Prioridad 1, MAS ALTA que la coleccion: ORDS evalua por prioridad y sin
  -- esto la ruta con :id podria caer en el handler de la coleccion.
  ----------------------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud/:id',
      p_priority    => 1,
      p_etag_type   => 'NONE');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud/:id',
      p_method      => 'GET',
      p_source_type => 'plsql/block',
      p_source      => 'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN'
                    || c_token || '
    PKG_INTERV_CRUD_ETHOS.OBTENER(p_token => l_token, p_id => TO_NUMBER(:id));
END;');
  auth_param('intervenciones-crud/:id', 'GET');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud/:id',
      p_method      => 'PUT',
      p_source_type => 'plsql/block',
      p_source      => 'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN'
                    || c_token || '
    PKG_INTERV_CRUD_ETHOS.ACTUALIZAR(
        p_token             => l_token,
        p_id                => TO_NUMBER(:id),
        p_id_postulacion    => TO_NUMBER(:id_postulacion),
        p_id_indice         => TO_NUMBER(:id_indice),
        p_si_no             => :si_no,
        p_fecha_hora        => :fecha_hora,
        p_motivo_desarrollo => :motivo_desarrollo,
        p_observacion       => :observacion,
        p_latitud           => :latitud,
        p_longitud          => :longitud,
        p_grado             => :grado,
        p_seccion           => :seccion);
END;');
  auth_param('intervenciones-crud/:id', 'PUT');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones-crud/:id',
      p_method      => 'DELETE',
      p_source_type => 'plsql/block',
      p_source      => 'DECLARE l_token VARCHAR2(256); l_pos PLS_INTEGER; BEGIN'
                    || c_token || '
    PKG_INTERV_CRUD_ETHOS.ELIMINAR(p_token => l_token, p_id => TO_NUMBER(:id));
END;');
  auth_param('intervenciones-crud/:id', 'DELETE');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de intervenciones-crud publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS. Solo hace falta si un navegador le pega DIRECTO a ORDS (hoy
-- la web va por su proxy de mismo origen, pero el APK va directo).
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
  preflight('intervenciones-crud');
  preflight('intervenciones-crud/:id');
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
   WHERE object_name = 'PKG_INTERV_CRUD_ETHOS' AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INTERV_CRUD_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    intervenciones-crud ?anio=&mes=&id_facilitador=');
    DBMS_OUTPUT.PUT_LINE('       GET    intervenciones-crud/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   intervenciones-crud');
    DBMS_OUTPUT.PUT_LINE('       PUT    intervenciones-crud/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE intervenciones-crud/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERV_CRUD_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_INTERV_CRUD_ETHOS'';');
    RETURN;
  END IF;

  -- Facilitadores sin USUARIO: no se les puede cargar una intervencion, porque
  -- INTERVENCIONES.USUARIO es NOT NULL y sale de ahi. Mejor saberlo ahora que
  -- descubrirlo con un error a mitad de la carga.
  SELECT COUNT(*) INTO l_n FROM facilitadores WHERE usuario IS NULL;
  DBMS_OUTPUT.PUT_LINE('');
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('       [AVISO] ' || l_n || ' facilitador(es) SIN USUARIO cargado.');
    DBMS_OUTPUT.PUT_LINE('               No se les puede registrar intervenciones hasta');
    DBMS_OUTPUT.PUT_LINE('               completar FACILITADORES.USUARIO. Para verlos:');
    DBMS_OUTPUT.PUT_LINE('               SELECT id_facilitador, nombre_apellido FROM facilitadores');
    DBMS_OUTPUT.PUT_LINE('                WHERE usuario IS NULL;');
  ELSE
    DBMS_OUTPUT.PUT_LINE('       [OK] Todos los facilitadores tienen USUARIO cargado.');
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERV_CRUD_ETHOS no se creo.');
END;
/
