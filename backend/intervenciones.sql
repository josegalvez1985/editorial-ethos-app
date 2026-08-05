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
-- EL FILTRO DE MES: EL PROBLEMA MAS MOLESTO DE ESTE SCRIPT
--------------------------------------------------------------------------------
--
-- Ninguna de las dos columnas obvias sirve directamente:
--
--   * MES es TEXTO y no se sabe con que grafia esta cargado ('Agosto',
--     'AGOSTO', 'agosto', 'AGO'...). La consulta de referencia tenia comentado
--     `UPPER(MES) = 'Agosto'`, que **nunca hubiera matcheado**: UPPER() devuelve
--     'AGOSTO' y eso no es igual a 'Agosto'. Comparar contra un nombre fijo es
--     exactamente el bug que dejaba el grafico vacio.
--
--   * FECHA **no es un DATE** en esta vista: viene formateada como texto. Un
--     EXTRACT(MONTH FROM fecha) tira ORA-30076 y el paquete no compila. (Se
--     intento y fallo — 05/08/2026.)
--
-- LA SALIDA: comparar contra el NOMBRE DEL MES, pero generandolo desde Oracle en
-- vez de escribirlo a mano, y normalizando los dos lados.
--
--   UPPER(TRIM(mes)) LIKE UPPER(nombre_del_mes) || '%'
--
-- Con `nombre_del_mes` sacado de TO_CHAR(fecha_del_mes, 'MONTH'). Tres detalles
-- que hacen que esto aguante lo que la vista tenga cargado:
--
--   1. Los DOS lados van en UPPER: inmune a la capitalizacion.
--   2. LIKE con '%' al final: matchea igual si la vista guarda abreviaturas
--      ('AGO' no matchea 'AGOSTO', pero 'AGOSTO' si matchea 'AGO%'... por eso el
--      patron se arma con el mas corto — ver f_patron_mes).
--   3. El nombre se genera con NLS_DATE_LANGUAGE='SPANISH' explicito, no
--      heredado de la sesion: en ORDS no esta garantizado, y el dia que viniera
--      en ingles el filtro dejaria de matchear en silencio.
--
-- SI AUN ASI NO MATCHEA, mirar que hay cargado de verdad:
--   SELECT DISTINCT mes FROM v_historial_intervenciones;
-- y ajustar f_patron_mes.
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

  ------------------------------------------------------------------------------
  -- ESTAS DOS FUNCIONES VAN EN LA SPEC A PROPOSITO.
  --
  -- Se usan DENTRO del SELECT de `listar`, y una funcion declarada solo en el
  -- body no es visible para el motor SQL: da PLS-00231 y el paquete no compila.
  -- (Ya paso una vez con el calculo del atraso, que termino escrito inline.)
  --
  -- Aca no se puede hacer inline: el parseo de "lat,lng" y la formula de
  -- haversine son demasiado largos para repetirlos en tres columnas del SELECT.
  -- Publicarlas es el precio de poder usarlas.
  ------------------------------------------------------------------------------

  ------------------------------------------------------------------------------
  -- SE USA SOBRE LATITUD Y LONGITUD, **NO** SOBRE UBICACION_INSITUTCION.
  --
  -- La distincion importa: LATITUD/LONGITUD (donde marco el facilitador) SI son
  -- coordenadas reales, pero UBICACION_INSITUTCION guarda URLs de Google Maps
  -- acortadas ("goo.gl/maps/13AsVP8dTyfy6xgg6") y hasta links que no son mapas
  -- ("datos.mec.gov.py/id/instituciones/6737"). Esas URLs son identificadores
  -- OPACOS: las coordenadas las resuelve el servidor de Google al seguir la
  -- redireccion, no estan en el texto, y desde SQL eso es imposible.
  -- INSTITUCIONES.UBICACION es otro VARCHAR2 igual (verificado 05/08/2026).
  --
  -- Por eso el punto de referencia de cada institucion NO sale de esa columna:
  -- se DEDUCE de la mediana de sus propias marcaciones. Ver el LEFT JOIN `ref`
  -- en `listar`.
  ------------------------------------------------------------------------------

  -- Una coordenada de un texto "lat,lng". p_cual: 1 = latitud, 2 = longitud.
  -- NULL si el texto no tiene esa forma (una URL, por ejemplo).
  FUNCTION f_coord(p_texto IN VARCHAR2, p_cual IN NUMBER) RETURN NUMBER DETERMINISTIC;

  -- Distancia en METROS entre dos puntos. NULL si falta alguna coordenada.
  FUNCTION f_distancia(
      p_lat1 IN NUMBER, p_lon1 IN NUMBER,
      p_lat2 IN NUMBER, p_lon2 IN NUMBER) RETURN NUMBER DETERMINISTIC;

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

  ------------------------------------------------------------------------------
  -- CUANTAS INTERVENCIONES HUBO CADA DIA DEL MES.
  --
  -- Alimenta el grafico de actividad diaria: el dia en el eje X y la cantidad en
  -- el Y. Es un endpoint aparte de `listar` porque cuenta TODAS las
  -- intervenciones, no solo las desviadas — son dos preguntas distintas sobre la
  -- misma tabla y mezclarlas daria un grafico que miente.
  --
  -- p_anio: 'YYYY'. Sin el, el año en curso.
  -- p_mes:  1..12. Sin el, el mes en curso.
  ------------------------------------------------------------------------------
  PROCEDURE por_dia(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN NUMBER   DEFAULT NULL);

END PKG_INTERVENCIONES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INTERVENCIONES_ETHOS AS

  ------------------------------------------------------------------------------
  -- EL TOPE DE FILAS, Y POR QUE ES ALTO
  --
  -- Se pide UN MES ENTERO, del dia 1 al ultimo. El tope existe solo para que un
  -- cliente no se lleve la tabla entera de un pedido, NO para paginar.
  --
  -- OJO: si un mes llegara a superar el tope, el FETCH FIRST + ORDER BY
  -- id_intervencion DESC se queda con los ID MAS ALTOS — o sea, **se perderian
  -- los primeros dias del mes**, en silencio y sin que la pantalla lo note.
  --
  -- Por eso el defecto es holgado. Con el filtro de 15+ minutos ya aplicado,
  -- un mes real deja muy por debajo de esto; si algun dia se acercara, hay que
  -- paginar de verdad y no subir el numero.
  ------------------------------------------------------------------------------
  c_limite_defecto CONSTANT PLS_INTEGER := 5000;
  c_limite_maximo  CONSTANT PLS_INTEGER := 20000;

  ------------------------------------------------------------------------------
  -- SOLO SE DEVUELVEN LAS MARCACIONES QUE SE APARTAN MAS DE ESTO DEL HORARIO.
  --
  -- En valor absoluto: 15 minutos tarde y 15 minutos antes entran las dos. Una
  -- marcacion dentro de esa franja es "llego en horario" y no aporta al analisis
  -- de puntualidad, que es de lo que trata esta pantalla.
  --
  -- OJO CON LA CONSECUENCIA: el promedio que calcula el front NO es el atraso
  -- promedio de todas las clases, sino el de las clases DESVIADAS. Un
  -- facilitador puntual no aparece en el grafico en vez de aparecer con una
  -- barra en cero.
  ------------------------------------------------------------------------------
  c_umbral_minutos CONSTANT PLS_INTEGER := 15;

  ------------------------------------------------------------------------------
  -- Y LAS QUE MARCARON A MAS DE ESTO DE LA INSTITUCION (en METROS).
  --
  -- 1 km. Es holgado a proposito: el GPS de un telefono tiene un error de
  -- decenas de metros bajo techo, y las coordenadas de la institucion son un
  -- punto —no el perimetro del predio—. Un umbral de 200 m marcaria como
  -- infraccion a quien esta parado en el patio del fondo.
  --
  -- NO cuenta como fuera de rango: la marcacion sin coordenadas, la que tiene
  -- la ubicacion de la institucion sin cargar, y la que quedo en (0,0) —que es
  -- lo que escribe TRG_INTERV_UBICACION cuando el facilitador tiene
  -- IND_UBICACION_POSTULACION = 'NO'—. En los tres casos NO SE SABE donde
  -- marco, y "no se sabe" no es "marco lejos".
  ------------------------------------------------------------------------------
  c_umbral_metros CONSTANT PLS_INTEGER := 1000;

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

  ------------------------------------------------------------------------------
  -- OJO: SOLO SE PUEDE LLAMAR **ANTES** DE HABER ABIERTO LA RESPUESTA.
  --
  -- Emite los headers, asi que si el procedimiento ya hizo `abrir_json` esto los
  -- emite POR SEGUNDA VEZ y la respuesta sale corrupta: el cliente recibe algo
  -- que no es JSON valido y lo ve como "sin datos", ocultando el error real.
  --
  -- Por eso los EXCEPTION de `listar` y `por_dia` NO llaman aca cuando ya
  -- empezaron a escribir: usan `p_error_tardio`, que cierra el JSON abierto.
  ------------------------------------------------------------------------------
  PROCEDURE p_error(p_status IN NUMBER, p_titulo IN VARCHAR2, p_detalle IN VARCHAR2) IS
  BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_titulo, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  END p_error;

  ------------------------------------------------------------------------------
  -- El error cuando la respuesta YA se abrio y hay un array a medio escribir.
  --
  -- No toca los headers —ya salieron— y cierra lo que quedo abierto para que el
  -- JSON sea parseable. `success` va en false y `message` trae el ORA real, que
  -- es lo unico que permite diagnosticar sin adivinar.
  --
  -- Se cierra el array primero y el objeto despues, en ese orden: al reves
  -- APEX_JSON emite llaves cruzadas y el JSON tampoco parsea.
  ------------------------------------------------------------------------------
  PROCEDURE p_error_tardio(p_detalle IN VARCHAR2) IS
  BEGIN
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_detalle);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN NULL; -- si ni eso se puede, no hay nada mas que hacer
  END p_error_tardio;

  -- El usuario del token, o NULL. Delega en PKG_AUTH_ETHOS: la validacion vive
  -- en UN solo lugar.
  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  ------------------------------------------------------------------------------
  -- UNA COORDENADA de un texto "lat,lng". 1 = latitud, 2 = longitud.
  --
  -- Devuelve NULL en vez de fallar cuando el texto no tiene esa forma: hay
  -- filas con la ubicacion vacia, con una direccion escrita a mano o con una
  -- URL, y ninguna de esas debe tumbar la consulta entera.
  --
  -- DOS DETALLES QUE IMPORTAN EN PARAGUAY:
  --
  --   * Las coordenadas son NEGATIVAS (lat ~-25, lng ~-57), asi que el patron
  --     acepta el signo. Sin el, el TO_NUMBER fallaria en todas las filas.
  --   * El separador decimal puede ser coma o punto segun como se cargo. Se
  --     normaliza a punto y se fuerza NLS_NUMERIC_CHARACTERS, porque la sesion
  --     de ORDS puede tener la coma como decimal y ahi "−25.26" no parsea.
  --
  -- Se valida ANTES de convertir y no con un EXCEPTION alrededor del TO_NUMBER
  -- porque esto corre por fila dentro de un SELECT: una excepcion por fila es
  -- cara, y el REGEXP descarta la basura sin llegar a intentarlo.
  ------------------------------------------------------------------------------
  FUNCTION f_coord(p_texto IN VARCHAR2, p_cual IN NUMBER) RETURN NUMBER DETERMINISTIC IS
    l_limpio VARCHAR2(200);
    l_parte  VARCHAR2(100);
  BEGIN
    IF p_texto IS NULL THEN RETURN NULL; END IF;

    -- Se sacan espacios y se unifica el decimal a punto.
    l_limpio := REPLACE(TRIM(p_texto), ' ', '');

    -- Tiene que ser exactamente "numero,numero". Si la ubicacion es una
    -- direccion o una URL, esto no matchea y devuelve NULL.
    IF NOT REGEXP_LIKE(l_limpio, '^-?\d+([.,]\d+)?,-?\d+([.,]\d+)?$') THEN
      RETURN NULL;
    END IF;

    -- OJO: la coma separa los dos valores Y puede ser el decimal. Se parte por
    -- la coma que tiene un signo o digito a cada lado y que NO esta dentro de
    -- un decimal — en la practica, la del medio. Como el patron de arriba ya
    -- garantizo la forma, alcanza con tomar la ULTIMA coma para la longitud
    -- cuando hay decimales con coma.
    IF INSTR(l_limpio, '.') > 0 THEN
      -- Decimales con punto: la unica coma es el separador.
      l_parte := REGEXP_SUBSTR(l_limpio, '[^,]+', 1, p_cual);
    ELSE
      -- Decimales con coma: hay 3 comas ("−25,26,−57,57"). La 2a separa.
      l_parte := CASE p_cual
                   WHEN 1 THEN REGEXP_SUBSTR(l_limpio, '^-?\d+,\d+')
                   ELSE        REGEXP_SUBSTR(l_limpio, '-?\d+,\d+$')
                 END;
      l_parte := REPLACE(l_parte, ',', '.');
    END IF;

    IF l_parte IS NULL THEN RETURN NULL; END IF;
    RETURN TO_NUMBER(REPLACE(l_parte, ',', '.'), '999999D999999999',
                     'NLS_NUMERIC_CHARACTERS=''.,''');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_coord;

  ------------------------------------------------------------------------------
  -- DISTANCIA EN METROS entre dos puntos (formula de haversine).
  --
  -- Se usa haversine y no la distancia euclidea de las coordenadas porque un
  -- grado de longitud mide distinto segun la latitud: a −25° un grado de
  -- longitud son ~101 km y uno de latitud ~110 km. Restarlas como si fueran
  -- planas daria un error de ~10% en el eje este-oeste, y con un umbral de 1 km
  -- eso son 100 metros de margen — suficiente para clasificar mal una marcacion.
  --
  -- Radio terrestre: 6.371.000 m (radio medio).
  --
  -- Devuelve NULL si falta cualquiera de las cuatro coordenadas: "no se sabe"
  -- no es lo mismo que "distancia cero".
  ------------------------------------------------------------------------------
  FUNCTION f_distancia(
      p_lat1 IN NUMBER, p_lon1 IN NUMBER,
      p_lat2 IN NUMBER, p_lon2 IN NUMBER) RETURN NUMBER DETERMINISTIC IS
    c_radio  CONSTANT NUMBER := 6371000;
    c_rad    CONSTANT NUMBER := 0.017453292519943295; -- pi/180
    l_dlat   NUMBER;
    l_dlon   NUMBER;
    l_a      NUMBER;
  BEGIN
    IF p_lat1 IS NULL OR p_lon1 IS NULL OR p_lat2 IS NULL OR p_lon2 IS NULL THEN
      RETURN NULL;
    END IF;

    -- Una coordenada fuera de rango es dato basura, no un punto lejano.
    IF ABS(p_lat1) > 90 OR ABS(p_lat2) > 90
       OR ABS(p_lon1) > 180 OR ABS(p_lon2) > 180 THEN
      RETURN NULL;
    END IF;

    -- (0,0) es el "null island": el trigger TRG_INTERV_UBICACION escribe 0/0
    -- cuando el facilitador tiene IND_UBICACION_POSTULACION = 'NO'. Esas
    -- marcaciones NO tienen ubicacion real y contarlas como "a 6.000 km" seria
    -- inventar una infraccion.
    IF (p_lat1 = 0 AND p_lon1 = 0) OR (p_lat2 = 0 AND p_lon2 = 0) THEN
      RETURN NULL;
    END IF;

    l_dlat := (p_lat2 - p_lat1) * c_rad;
    l_dlon := (p_lon2 - p_lon1) * c_rad;

    l_a := SIN(l_dlat/2) * SIN(l_dlat/2)
         + COS(p_lat1 * c_rad) * COS(p_lat2 * c_rad)
         * SIN(l_dlon/2) * SIN(l_dlon/2);

    RETURN ROUND(c_radio * 2 * ATAN2(SQRT(l_a), SQRT(1 - l_a)));
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_distancia;

  ------------------------------------------------------------------------------
  -- El patron para comparar contra la columna MES (que es TEXTO).
  --
  -- Devuelve las TRES primeras letras del nombre del mes en español y en
  -- mayusculas, con '%' al final: 'AGO%', 'SET%', 'DIC%'...
  --
  -- Tres letras y no el nombre entero a proposito: asi matchea tanto 'AGOSTO'
  -- como 'Agosto' como una eventual abreviatura 'Ago'. El unico caso que se
  -- pierde es 'SETIEMBRE' vs 'SEPTIEMBRE' — las dos empiezan con 'SE', pero la
  -- tercera letra difiere ('T' vs 'P'), asi que ese mes se trata aparte.
  --
  -- El nombre se genera con NLS_DATE_LANGUAGE explicito y NO se hereda de la
  -- sesion: en ORDS no esta garantizado, y con la sesion en ingles esto
  -- devolveria 'AUG%' y no matchearia nada, en silencio.
  ------------------------------------------------------------------------------
  FUNCTION f_patron_mes(p_mes IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    IF p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12 THEN
      RETURN NULL; -- no filtra por mes
    END IF;
    ----------------------------------------------------------------------------
    -- LOS NOMBRES VAN CABLEADOS, NO GENERADOS CON TO_CHAR.
    --
    -- Antes esto salia de TO_CHAR(fecha,'MONTH','NLS_DATE_LANGUAGE=SPANISH').
    -- Dependia de que la sesion de ORDS aceptara ese NLS y de que el TO_DATE del
    -- literal no chocara con el NLS_DATE_FORMAT — y si algo de eso fallaba, el
    -- EXCEPTION que habia devolvia NULL EN SILENCIO. Con el patron en NULL el
    -- filtro se apaga y la consulta trae otra cosa, sin ningun error visible.
    --
    -- Tres letras y LIKE: matchea 'AGOSTO', 'Agosto', 'agosto' y una eventual
    -- abreviatura 'Ago'. Setiembre va con dos ('SE%') porque circulan las dos
    -- grafias y difieren en la tercera letra.
    ----------------------------------------------------------------------------
    RETURN CASE p_mes
             WHEN  1 THEN 'ENE%'  WHEN  2 THEN 'FEB%'
             WHEN  3 THEN 'MAR%'  WHEN  4 THEN 'ABR%'
             WHEN  5 THEN 'MAY%'  WHEN  6 THEN 'JUN%'
             WHEN  7 THEN 'JUL%'  WHEN  8 THEN 'AGO%'
             WHEN  9 THEN 'SE%'   WHEN 10 THEN 'OCT%'
             WHEN 11 THEN 'NOV%'  WHEN 12 THEN 'DIC%'
           END;
  END f_patron_mes;

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
    l_patron  VARCHAR2(20);
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

    l_patron := f_patron_mes(p_mes);
    l_tope   := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('mes',     p_mes);
    -- Para poder diagnosticar sin adivinar: si el grafico sale vacio, esto dice
    -- contra que se comparo la columna MES.
    APEX_JSON.WRITE('patron_mes', l_patron);
    APEX_JSON.WRITE('umbral_minutos', c_umbral_minutos);
    APEX_JSON.WRITE('umbral_metros',  c_umbral_metros);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT fecha,
               manual,
               observacion,
               motivo_desarrollo,
               id_indice,
               si_no,
               -- Calificado: `ref` tambien tiene id_institucion (ORA-00918).
               v.id_institucion,
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
               -- Las coordenadas de la institucion, DEDUCIDAS. Ver `ref`.
               MAX(ref.lat) AS inst_latitud,
               MAX(ref.lon) AS inst_longitud,
               --------------------------------------------------------------
               -- DISTANCIA en METROS entre donde marco y donde debia marcar.
               --
               -- NULL si falta alguna de las cuatro coordenadas: es "no se
               -- sabe", y un 0 diria "marco en el lugar exacto", que es una
               -- afirmacion que el dato no respalda.
               --------------------------------------------------------------
               -- Las coordenadas de la marcacion pasan por f_coord, que valida
               -- el formato antes de convertir. Un TO_NUMBER crudo sobre
               -- LATITUD tumbaria la consulta entera con una sola fila que
               -- tenga texto. Se le pasa "lat,lng" armado para reusar el parseo.
               f_distancia(
                   f_coord(latitud || ',0', 1),
                   f_coord(longitud || ',0', 1),
                   MAX(ref.lat), MAX(ref.lon)) AS distancia_metros,
               anio
          FROM v_historial_intervenciones v
          ------------------------------------------------------------------
          -- LA UBICACION DE CADA INSTITUCION, DEDUCIDA DE SUS PROPIAS
          -- MARCACIONES.
          --
          -- POR QUE NO SE LEE DE UNA COLUMNA: UBICACION_INSITUTCION guarda
          -- URLs de Google Maps acortadas ("goo.gl/maps/13AsVP8dTyfy6xgg6") y
          -- hasta links que no son mapas ("datos.mec.gov.py/..."). Son
          -- identificadores OPACOS: las coordenadas las resuelve el servidor de
          -- Google al seguir la redireccion, no estan en el texto. Y
          -- INSTITUCIONES.UBICACION es otro VARCHAR2 del mismo tipo, sin
          -- LATITUD/LONGITUD (verificado el 05/08/2026).
          --
          -- LA SALIDA: el punto de referencia es la MEDIANA de las coordenadas
          -- de todas las marcaciones de esa institucion. Si la mayoria marca en
          -- el colegio —y los datos lo confirman: dos marcaciones del mismo
          -- colegio caen a 0 y 23 metros una de otra— esa mediana ES el
          -- colegio, y quien se aleje un kilometro salta solo.
          --
          -- MEDIANA Y NO PROMEDIO, que es la decision que hace que esto
          -- funcione: un facilitador que marca a 40 km corre el promedio varios
          -- kilometros y termina tapando su propia infraccion. La mediana lo
          -- ignora mientras sea minoria.
          --
          -- SE CALCULA SOBRE TODA LA HISTORIA, no sobre el mes filtrado: mas
          -- muestras dan un centro mas estable, y la ubicacion de un colegio no
          -- cambia mes a mes.
          --
          -- LIMITE CONOCIDO: una institucion con UNA sola marcacion tiene
          -- mediana igual a esa marcacion, o sea distancia 0. No se puede
          -- detectar nada ahi, y es correcto: con un solo punto no hay
          -- referencia contra la cual comparar. Se vuelve util solo cuando hay
          -- varias.
          ------------------------------------------------------------------
          LEFT JOIN (
              SELECT id_institucion,
                     MEDIAN(f_coord(latitud  || ',0', 1)) AS lat,
                     MEDIAN(f_coord(longitud || ',0', 1)) AS lon
                FROM v_historial_intervenciones
               WHERE f_coord(latitud  || ',0', 1) IS NOT NULL
                 AND f_coord(longitud || ',0', 1) IS NOT NULL
                 -- (0,0) es lo que escribe TRG_INTERV_UBICACION cuando el
                 -- facilitador tiene IND_UBICACION_POSTULACION = 'NO'. Meterlo
                 -- en la mediana arrastraria el centro al Golfo de Guinea.
                 AND NOT (f_coord(latitud  || ',0', 1) = 0
                      AND f_coord(longitud || ',0', 1) = 0)
               GROUP BY id_institucion
          ) ref ON ref.id_institucion = v.id_institucion
         WHERE (l_anio IS NULL OR anio = l_anio)
           ------------------------------------------------------------------
           -- EL MES ENTERO, del dia 1 al ultimo.
           --
           -- Se compara contra el TEXTO de la columna MES, asi que TODAS las
           -- filas de ese mes entran sin importar el dia: no hay ningun corte
           -- por fecha en esta consulta.
           --
           -- No se puede usar EXTRACT(MONTH FROM fecha) —FECHA no es DATE en
           -- esta vista y tira ORA-30076—, y por eso tampoco se arma un rango
           -- BETWEEN primer_dia AND ultimo_dia: no habria con que compararlo.
           ------------------------------------------------------------------
           AND (l_patron IS NULL OR UPPER(TRIM(mes)) LIKE l_patron)
           AND (p_id_facilitador IS NULL OR id_facilitador = p_id_facilitador)
           ------------------------------------------------------------------
           -- SOLO LAS MARCACIONES CON ALGUN DESVIO. Dos clases, y basta UNA:
           --
           --   a) HORARIO: se aparta c_umbral_minutos o mas de la hora de
           --      clase, en valor ABSOLUTO (tarde o anticipada).
           --   b) UBICACION: marco a mas de c_umbral_metros de la institucion.
           --
           -- Es un OR y no un AND: los dos graficos del inicio se alimentan de
           -- esta misma consulta, y con AND el de ubicacion solo veria a quien
           -- ademas llego tarde. Cada fila trae los dos datos y cada grafico
           -- filtra el suyo.
           --
           -- El *60 del inciso (a) deshace el /60 de DIFERENCIA_MINUTOS, que
           -- pese al nombre esta en HORAS (ver el encabezado). Sin eso,
           -- comparar contra 15 exigiria 15 HORAS de desvio.
           --
           -- Las filas sin hora calculable, o sin coordenadas, dan NULL en su
           -- lado del OR y no entran por ahi: de esas no se sabe si hubo
           -- desvio, y afirmarlo seria inventar.
           ------------------------------------------------------------------
           AND (
                 ABS(
                   CASE
                     WHEN REGEXP_LIKE(TRIM(hora),       '^\d{1,2}:\d{2}$')
                      AND REGEXP_LIKE(TRIM(hora_desde), '^\d{1,2}:\d{2}$')
                     THEN ROUND((TO_DATE(TRIM(hora_desde), 'HH24:MI')
                               - TO_DATE(TRIM(hora),       'HH24:MI')) * 24 * 60, 0)
                   END
                 ) >= c_umbral_minutos
                 OR f_distancia(
                      f_coord(v.latitud  || ',0', 1),
                      f_coord(v.longitud || ',0', 1),
                      ref.lat, ref.lon) > c_umbral_metros
               )
         -- Todo calificado con `v.`: `id_institucion` existe tambien en `ref` y
         -- sin el alias Oracle no sabe cual es (ORA-00918, columna ambigua).
         GROUP BY v.fecha, v.manual, v.observacion, v.motivo_desarrollo,
                  v.id_indice, v.si_no, v.id_institucion, v.nombre, v.seccion,
                  v.id_enfasis, v.descripcion, v.id_facilitador, v.mes, v.hora,
                  v.nombre_facilitador, v.latitud, v.longitud,
                  v.ubicacion_insitutcion, v.hora_desde, v.hora_hasta, v.anio,
                  v.turno
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
      -- Las coordenadas de la institucion ya parseadas, y la distancia. El
      -- front arma con esto el link de Google Maps sin volver a parsear nada.
      APEX_JSON.WRITE('inst_latitud',      r.inst_latitud);
      APEX_JSON.WRITE('inst_longitud',     r.inst_longitud);
      APEX_JSON.WRITE('distancia_metros',  r.distancia_metros);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      -- `p_error_tardio` y NO `p_error`: la respuesta ya se abrio mas arriba, y
      -- emitir los headers de nuevo la dejaria ilegible — el front lo veria como
      -- "sin datos" en vez de mostrar el error.
      p_error_tardio('Error: ' || SQLERRM);
  END listar;

  ------------------------------------------------------------------------------
  -- POR_DIA: cuantas intervenciones hubo cada dia del mes.
  --
  -- CUENTA TODAS, no solo las desviadas. Es la diferencia con `listar`: este
  -- grafico responde "cuanta actividad hubo", no "quien se porto mal". Filtrar
  -- por desvio daria un grafico de actividad que en realidad muestra
  -- infracciones — el mismo dibujo significando otra cosa.
  --
  -- EL DIA SALE DE UN TO_DATE, NO DE SUBSTR.
  --   FECHA es VARCHAR2 con formato 'DD/MM/YYYY'. Se podria sacar el dia con
  --   SUBSTR(fecha,1,2), pero el TO_DATE ademas VALIDA: una fila con la fecha
  --   mal cargada revienta el TO_DATE en vez de sumar silenciosamente al dia
  --   equivocado. El CASE + REGEXP de abajo la descarta antes de llegar ahi.
  --
  -- EL ORDEN ES NUMERICO POR DIA.
  --   La consulta de referencia ordenaba por MIN(FECHA), que sobre un VARCHAR2
  --   es orden ALFABETICO: '01/08' < '02/08' funciona por casualidad dentro de
  --   un mes, pero es fragil. Se ordena por el numero de dia, que es lo que
  --   quiere el eje X.
  --
  -- DIAS SIN ACTIVIDAD: no aparecen. Un sabado sin clases no es un cero que haya
  -- que dibujar, y rellenar el mes completo con ceros aplastaria la escala del
  -- grafico. El front decide si los muestra.
  ------------------------------------------------------------------------------
  PROCEDURE por_dia(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_anio    VARCHAR2(4);
    l_patron  VARCHAR2(20);
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    -- Mismo criterio que `listar`, para que los tres graficos del inicio miren
    -- siempre el mismo periodo.
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      l_anio := TRIM(p_anio);
    ELSE
      l_anio := TO_CHAR(SYSDATE, 'YYYY');
    END IF;

    -- Sin mes explicito, el mes en curso: un grafico "por dia" de un año entero
    -- tendria 365 barras y no significaria nada.
    l_patron := f_patron_mes(NVL(p_mes, EXTRACT(MONTH FROM SYSDATE)));

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('mes',     NVL(p_mes, EXTRACT(MONTH FROM SYSDATE)));
    -- Contra que se comparo, y cuantas filas hay de cada lado del filtro. Sin
    -- esto, un resultado vacio no distingue "no hay datos" de "el filtro no
    -- matchea", y hay que ir a la base a adivinar cual de las dos es.
    APEX_JSON.WRITE('patron_mes', l_patron);
    DECLARE
      l_solo_anio PLS_INTEGER;
      l_solo_mes  PLS_INTEGER;
    BEGIN
      SELECT COUNT(*) INTO l_solo_anio
        FROM v_historial_intervenciones
       WHERE l_anio IS NULL OR anio = l_anio;
      SELECT COUNT(*) INTO l_solo_mes
        FROM v_historial_intervenciones
       WHERE l_patron IS NULL OR UPPER(TRIM(mes)) LIKE l_patron;
      APEX_JSON.WRITE('filas_del_anio', l_solo_anio);
      APEX_JSON.WRITE('filas_del_mes',  l_solo_mes);
    EXCEPTION
      WHEN OTHERS THEN NULL; -- el diagnostico no puede tumbar la respuesta
    END;
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT TO_NUMBER(TO_CHAR(TO_DATE(fecha, 'DD/MM/YYYY'), 'DD')) AS dia,
               COUNT(*) AS cantidad
          FROM v_historial_intervenciones
         WHERE (l_anio   IS NULL OR anio = l_anio)
           AND (l_patron IS NULL OR UPPER(TRIM(mes)) LIKE l_patron)
           -- Descarta las fechas mal cargadas ANTES del TO_DATE: adentro de un
           -- SELECT no hay donde atrapar el ORA-01843, y una sola fila con
           -- basura tumbaria la consulta entera.
           AND REGEXP_LIKE(TRIM(fecha), '^\d{2}/\d{2}/\d{4}$')
         GROUP BY TO_CHAR(TO_DATE(fecha, 'DD/MM/YYYY'), 'DD')
         ORDER BY 1
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('dia',      r.dia);
      APEX_JSON.WRITE('cantidad', r.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      -- Mismo motivo que en `listar`: la respuesta ya esta abierta.
      p_error_tardio('Error: ' || SQLERRM);
  END por_dia;

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
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/por-dia', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/por-dia', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

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

  ----------------------------------------------------------------------------
  -- intervenciones/por-dia  ?anio=&mes=
  --
  -- Prioridad 1, MAS ALTA que 'intervenciones' (0): ORDS evalua por prioridad y
  -- sin esto la ruta con barra podria caer en el handler generico.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/por-dia',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/por-dia',
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
    PKG_INTERVENCIONES_ETHOS.POR_DIA(
        p_token => l_token,
        p_anio  => :anio,
        p_mes   => TO_NUMBER(:mes));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/por-dia',
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
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo publicar el handler: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/auth.sql).');
    RAISE;
END;
/

-- Preflight CORS, a prueba de fallos. Solo hace falta si un navegador le pega
-- DIRECTO a ORDS (hoy la web va por su proxy de mismo origen).
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
  preflight('intervenciones/por-dia');
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

  -- Que grafias de MES hay cargadas de verdad. Es LA pregunta cuando el grafico
  -- sale vacio: el filtro compara contra texto y hay que ver contra que.
  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('       Valores de MES en la vista:');
  FOR r IN (
      SELECT anio, mes, COUNT(*) AS n
        FROM v_historial_intervenciones
       GROUP BY anio, mes
       ORDER BY anio DESC, n DESC
       FETCH FIRST 12 ROWS ONLY
  ) LOOP
    DBMS_OUTPUT.PUT_LINE('         ' || r.anio || '  ' || RPAD(NVL(r.mes, '(null)'), 14)
                         || r.n || ' filas');
  END LOOP;

  -- Cuantas superan el umbral en el mes en curso. Si da 0, el grafico va a
  -- salir vacio y NO es un bug: o no hay marcaciones, o todas fueron puntuales.
  BEGIN
    SELECT COUNT(*) INTO l_filas
      FROM v_historial_intervenciones
     WHERE anio = TO_CHAR(SYSDATE, 'YYYY')
       AND UPPER(TRIM(mes)) LIKE
           UPPER(SUBSTR(TO_CHAR(SYSDATE, 'MONTH', 'NLS_DATE_LANGUAGE=SPANISH'), 1, 3)) || '%'
       AND ABS(
             CASE
               WHEN REGEXP_LIKE(TRIM(hora),       '^\d{1,2}:\d{2}$')
                AND REGEXP_LIKE(TRIM(hora_desde), '^\d{1,2}:\d{2}$')
               THEN ROUND((TO_DATE(TRIM(hora_desde), 'HH24:MI')
                         - TO_DATE(TRIM(hora),       'HH24:MI')) * 24 * 60, 0)
             END
           ) >= 15;

    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('       Marcaciones del mes en curso con 15+ min de desvio: ' || l_filas);
    IF l_filas = 0 THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] El grafico va a salir vacio para este mes.');
      DBMS_OUTPUT.PUT_LINE('               Puede ser que no haya datos, que la grafia de MES');
      DBMS_OUTPUT.PUT_LINE('               no matchee (mirar la lista de arriba), o que todas');
      DBMS_OUTPUT.PUT_LINE('               las marcaciones hayan sido puntuales.');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] No se pudo contar: ' || SQLERRM);
  END;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS no se creo.');
END;
/
