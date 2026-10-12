--------------------------------------------------------------------------------
-- INTERVENCIONES  —  historial de marcaciones de los facilitadores
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  intervenciones  ?anio=&mes=&id_facilitador=&limite=
--   GET  intervenciones/por-dia  ?anio=&mes=&si_no=
--   GET  intervenciones/por-dia/detalle  ?anio=&mes=&dia=   (09/10/2026: quien,
--        por facilitador e institucion, al tocar una barra de Actividad)
--   GET  intervenciones/mapa  ?desde=&hasta=&id_facilitador=   (09/10/2026)
--   GET  intervenciones/mapa/facilitadores  ?desde=&hasta=     (09/10/2026)
--
--   Los dos de mapa son la pagina 25 de APEX (/mapa-intervenciones): ver
--   "EL MAPA" en el cuerpo del paquete. Fechas como YYYY-MM-DD.
--
--   GET  intervenciones/realizadas  ?anio=&meses=  o  ?desde=&hasta=&si_no=
--        (12/10/2026: la pagina 52,
--        Intervenciones Realizadas, /consulta-intervenciones). TODAS las
--        marcaciones, no solo las desviadas: ver "REALIZADAS" en el cuerpo.
--
--   GET  intervenciones/resumen-periodo  ?desde=&hasta=&si_no=   (12/10/2026:
--        la pagina 53, Resumen de Intervenciones, /resumen-intervenciones).
--        Lo que se le paga a cada facilitador: ver "RESUMEN_PERIODO".
--        (No confundir con el viejo 'intervenciones/resumen', que se borra.)
--
--   GET  intervenciones/no-realizadas  ?anio=   (12/10/2026: la pagina 69,
--        Intervenciones no realizadas, /intervenciones-no-realizadas). Las
--        NO desarrolladas de un anio o de todos: ver "NO_REALIZADAS".
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
-- EL FILTRO DE MES: LA COLUMNA `MES` NO SIRVE, Y ES UNA TRAMPA
--------------------------------------------------------------------------------
--
-- **NO COMPARAR NUNCA CONTRA LA COLUMNA MES.** Se hizo, costo medio dia de
-- diagnostico el 05/08/2026, y este es el motivo:
--
--   La vista la arma con TO_CHAR(fecha_hora,'Month') SIN NLS_DATE_LANGUAGE, o
--   sea que **hereda el idioma de la sesion que consulta**. Y ahi esta la
--   trampa: las dos sesiones no son la misma.
--
--     * SQL Workshop (APEX) esta en ESPAÑOL  -> 'Agosto'
--     * La sesion de ORDS  esta en INGLES    -> 'August   '
--
--   Entonces la misma consulta corrida a mano devolvia 'Agosto' y parecia sana,
--   mientras el endpoint comparaba contra 'August   ' y no matcheaba ni una
--   fila. El filtro se apagaba en silencio y los graficos salian vacios sin un
--   solo error en el log. Ojo tambien con los ESPACIOS DE RELLENO: 'Month'
--   rellena a 9 caracteres.
--
-- LA SALIDA: sacar el mes de FECHA_HORA, que la vista tambien expone y **si es
-- un DATE de verdad**:
--
--   EXTRACT(MONTH FROM fecha_hora) = 8
--
-- Un numero: sin idioma, sin capitalizacion, sin espacios, sin LIKE. Inmune a
-- que cambie el NLS de cualquiera de las dos sesiones.
--
-- (El comentario viejo decia que EXTRACT tiraba ORA-30076. Era cierto sobre la
-- columna FECHA —esa si es texto formateado— pero no sobre FECHA_HORA, que es
-- otra columna y es DATE. Confundirlas fue parte del problema.)
--
-- `f_mes` solo traduce lo que mande el front —un numero o un nombre en
-- español— a ese 1..12. La columna MES ya no se usa para filtrar nada.
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

  -- La usa resumen_periodo (la pagina 53), llamada dinamico: si falta, el
  -- paquete compila igual y la columna Postulaciones sale vacia.
  SELECT COUNT(*) INTO l_n
    FROM all_objects
   WHERE object_name = 'FN_DETALLE_POSTULACIONES'
     AND object_type IN ('FUNCTION', 'SYNONYM');
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] No existe FN_DETALLE_POSTULACIONES: en el Resumen de');
    DBMS_OUTPUT.PUT_LINE('       Intervenciones la columna Postulaciones va a salir vacia.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   FN_DETALLE_POSTULACIONES encontrada.');
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
  -- p_anio: 'YYYY' como TEXTO ('2026'). Sin el, el año en curso. 'TODOS' apaga
  --         el filtro.
  -- p_mes:  EL NOMBRE DEL MES como TEXTO ('Agosto'), no un numero. Sin el, todo
  --         el año. Ver la nota de arriba sobre el filtro de mes.
  -- p_id_facilitador: opcional, para ver el de una sola persona.
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN VARCHAR2 DEFAULT NULL,
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
  -- p_anio: 'YYYY' como TEXTO ('2026'). Sin el, el año en curso.
  -- p_mes:  EL NOMBRE DEL MES como TEXTO ('Agosto'). Sin el, el mes en curso.
  -- p_si_no: 'SI' / 'NO' para contar solo los indices desarrollados o solo los
  --          que no. Sin el (o con 'TODOS'), cuenta las dos cosas.
  ------------------------------------------------------------------------------
  PROCEDURE por_dia(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN VARCHAR2 DEFAULT NULL,
      p_si_no IN VARCHAR2 DEFAULT NULL);

  -- Quien hizo las intervenciones de UN dia, por facilitador e institucion,
  -- con total / desarrolladas / no desarrolladas. Ver el cuerpo.
  PROCEDURE por_dia_detalle(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN VARCHAR2 DEFAULT NULL,
      p_dia   IN VARCHAR2 DEFAULT NULL);

  -- El mapa de la pagina 25: las marcaciones de un facilitador en el rango.
  PROCEDURE mapa(
      p_token          IN VARCHAR2,
      p_desde          IN VARCHAR2,
      p_hasta          IN VARCHAR2,
      p_id_facilitador IN NUMBER);

  -- Los facilitadores con marcaciones en el rango, con cuantas.
  PROCEDURE mapa_facilitadores(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2);

  -- La pagina 52 (Intervenciones Realizadas): todas las marcaciones de un anio,
  -- de los meses pedidos ('8,9'; sin meses, el anio entero). Con p_desde y
  -- p_hasta, las de ese periodo (la pagina 55). Ver el cuerpo.
  PROCEDURE realizadas(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_meses IN VARCHAR2 DEFAULT NULL,
      p_desde IN VARCHAR2 DEFAULT NULL,
      p_hasta IN VARCHAR2 DEFAULT NULL,
      p_si_no IN VARCHAR2 DEFAULT NULL);

  -- La pagina 53 (Resumen de Intervenciones): las intervenciones de un periodo
  -- que cuentan para el pago, una por clase y dia. Ver el cuerpo.
  PROCEDURE resumen_periodo(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2,
      p_si_no IN VARCHAR2 DEFAULT NULL);

  -- La pagina 69 (Intervenciones no realizadas): las NO desarrolladas de un
  -- anio ('TODOS': de todos). Ver el cuerpo.
  PROCEDURE no_realizadas(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL);

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

  -- El mapa: tope de puntos y de dias por pedido. Un facilitador hace unas
  -- pocas marcaciones por dia; 3000 alcanza para mas de un año.
  c_mapa_limite CONSTANT PLS_INTEGER := 3000;
  c_mapa_dias   CONSTANT PLS_INTEGER := 366;

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
  -- EL NUMERO DE MES (1..12) A PARTIR DE LO QUE MANDE EL FRONT.
  --
  -- ============================================================================
  -- POR QUE NO SE COMPARA CONTRA LA COLUMNA MES: VIENE EN INGLES
  -- ============================================================================
  --
  -- La vista arma MES con TO_CHAR(fecha_hora,'Month') SIN NLS_DATE_LANGUAGE, o
  -- sea que hereda el idioma de la sesion. Y la sesion de ORDS **esta en
  -- ingles**: devuelve 'August   ' —con espacios de relleno—, no 'Agosto'.
  --
  -- Verificado el 05/08/2026 contra el endpoint en produccion. Es lo que dejaba
  -- los graficos vacios, y lo que hacia tan dificil de ver: en SQL Workshop la
  -- sesion SI esta en español, asi que la misma consulta corrida a mano devuelve
  -- 'Agosto' y parece que todo funciona. El idioma dependia de QUIEN preguntaba.
  --
  -- LA SALIDA: no comparar contra esa columna nunca mas. La vista tambien expone
  -- FECHA_HORA, que es un DATE de verdad, y de ahi sale el mes con EXTRACT: un
  -- numero, sin idioma, sin capitalizacion y sin espacios de relleno.
  --
  -- Esta funcion solo traduce lo que mande el front a ese numero. Acepta las dos
  -- formas para no depender de una version puntual del front:
  --
  --   * Un NUMERO ya hecho: '8'.
  --   * El NOMBRE en español: 'Agosto', 'agosto', 'SETIEMBRE'/'SEPTIEMBRE'.
  --
  -- NULL apaga el filtro y devuelve el año entero.
  ------------------------------------------------------------------------------
  FUNCTION f_mes(p_mes IN VARCHAR2) RETURN NUMBER DETERMINISTIC IS
    l_txt VARCHAR2(30) := UPPER(TRIM(p_mes));
    l_num NUMBER;
  BEGIN
    IF l_txt IS NULL THEN RETURN NULL; END IF;

    -- Si ya es un numero, se usa tal cual. El TO_NUMBER va dentro de su propio
    -- bloque porque un texto como 'AGOSTO' lo hace fallar, y eso es normal aca:
    -- significa que el front mando el nombre y hay que seguir al CASE.
    BEGIN
      l_num := TO_NUMBER(l_txt);
      RETURN CASE WHEN l_num BETWEEN 1 AND 12 THEN l_num END;
    EXCEPTION
      WHEN OTHERS THEN NULL; -- no era un numero: sigue abajo
    END;

    -- SETIEMBRE y SEPTIEMBRE: las dos grafias circulan y las dos son correctas.
    RETURN CASE l_txt
             WHEN 'ENERO'      THEN  1  WHEN 'FEBRERO'    THEN  2
             WHEN 'MARZO'      THEN  3  WHEN 'ABRIL'      THEN  4
             WHEN 'MAYO'       THEN  5  WHEN 'JUNIO'      THEN  6
             WHEN 'JULIO'      THEN  7  WHEN 'AGOSTO'     THEN  8
             WHEN 'SETIEMBRE'  THEN  9  WHEN 'SEPTIEMBRE' THEN  9
             WHEN 'OCTUBRE'    THEN 10  WHEN 'NOVIEMBRE'  THEN 11
             WHEN 'DICIEMBRE'  THEN 12
           END;
  END f_mes;

  ------------------------------------------------------------------------------
  -- LISTAR
  ------------------------------------------------------------------------------
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_mes            IN VARCHAR2 DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario  VARCHAR2(255);
    l_anio     VARCHAR2(4);
    l_mes      NUMBER;
    l_tope     PLS_INTEGER;
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

    l_mes  := f_mes(p_mes);
    l_tope := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    -- El mes TAL COMO SE COMPARO ('AGOSTO'), no como lo mando el front
    -- ('Agosto'). Si el grafico sale vacio, esto dice contra que se comparo.
    APEX_JSON.WRITE('mes',     l_mes);
    APEX_JSON.WRITE('umbral_minutos', c_umbral_minutos);
    APEX_JSON.WRITE('umbral_metros',  c_umbral_metros);
    APEX_JSON.WRITE('limite',  l_tope);
    -- Cuantas filas hay a cada lado del filtro. Sin esto, un resultado vacio no
    -- distingue "no hay datos" de "el filtro no matchea", que es exactamente la
    -- duda que costo medio dia el 05/08/2026.
    DECLARE
      l_solo_anio PLS_INTEGER;
      l_solo_mes  PLS_INTEGER;
    BEGIN
      SELECT COUNT(*) INTO l_solo_anio
        FROM v_historial_intervenciones
       WHERE l_anio IS NULL OR anio = l_anio;
      SELECT COUNT(*) INTO l_solo_mes
        FROM v_historial_intervenciones
       WHERE l_mes IS NULL
          OR EXTRACT(MONTH FROM fecha_hora) = l_mes;
      APEX_JSON.WRITE('filas_del_anio', l_solo_anio);
      APEX_JSON.WRITE('filas_del_mes',  l_solo_mes);
    EXCEPTION
      WHEN OTHERS THEN NULL; -- el diagnostico no puede tumbar la respuesta
    END;
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        ----------------------------------------------------------------------
        -- LA DISTANCIA SE CALCULA UNA SOLA VEZ, ACA.
        --
        -- Antes se calculaba DOS veces por fila: una en el SELECT y otra en el
        -- WHERE, cada una con su f_distancia y sus dos f_coord. Como f_coord es
        -- PL/SQL llamada desde SQL, cada invocacion es un context switch entre
        -- los dos motores — el costo real de esta consulta no era la haversine
        -- sino los saltos.
        --
        -- Con el WITH se calcula una vez por fila y despues se filtra sobre la
        -- columna ya calculada. Mismo resultado, la mitad de llamadas.
        --
        -- Las medianas de `ref` siguen calculandose sobre TODA la historia
        -- (71.198 filas al 05/08/2026). Eso es lo proximo a atacar, con una
        -- tabla materializada: la ubicacion de un colegio no cambia entre dos
        -- pedidos y hoy se recalcula en cada uno.
        ----------------------------------------------------------------------
        WITH ref AS (
            SELECT id_institucion,
                   MEDIAN(f_coord(latitud  || ',0', 1)) AS lat,
                   MEDIAN(f_coord(longitud || ',0', 1)) AS lon
              FROM v_historial_intervenciones
             WHERE f_coord(latitud  || ',0', 1) IS NOT NULL
               AND f_coord(longitud || ',0', 1) IS NOT NULL
               -- (0,0) es lo que escribe TRG_INTERV_UBICACION cuando el
               -- facilitador tiene IND_UBICACION_POSTULACION = 'NO'. Meterlo en
               -- la mediana arrastraria el centro al Golfo de Guinea.
               AND NOT (f_coord(latitud  || ',0', 1) = 0
                    AND f_coord(longitud || ',0', 1) = 0)
             GROUP BY id_institucion
        ),
        base AS (
            SELECT v.*,
                   ref.lat AS inst_lat,
                   ref.lon AS inst_lon,
                   -- UNA sola llamada. El WHERE de abajo filtra sobre esto.
                   f_distancia(f_coord(v.latitud  || ',0', 1),
                               f_coord(v.longitud || ',0', 1),
                               ref.lat, ref.lon) AS dist_m,
                   -- Idem: el desvio en MINUTOS, calculado una vez. El CASE
                   -- evita el ORA-01858 de una hora vacia o con basura.
                   CASE
                     WHEN REGEXP_LIKE(TRIM(v.hora),       '^\d{1,2}:\d{2}$')
                      AND REGEXP_LIKE(TRIM(v.hora_desde), '^\d{1,2}:\d{2}$')
                     THEN ROUND((TO_DATE(TRIM(v.hora_desde), 'HH24:MI')
                               - TO_DATE(TRIM(v.hora),       'HH24:MI')) * 24 * 60, 0)
                   END AS desvio_min
              FROM v_historial_intervenciones v
              LEFT JOIN ref ON ref.id_institucion = v.id_institucion
             WHERE (l_anio IS NULL OR v.anio = l_anio)
               ----------------------------------------------------------------
               -- EL MES SALE DE FECHA_HORA, **NO** DE LA COLUMNA MES.
               --
               -- MES es texto generado por la vista con TO_CHAR(...,'Month') sin
               -- NLS, asi que su idioma es el de QUIEN CONSULTA: en la sesion de
               -- ORDS dice 'August   ' y en SQL Workshop 'Agosto'. Comparar
               -- contra eso es comparar contra algo que cambia solo.
               --
               -- FECHA_HORA es un DATE de verdad. EXTRACT devuelve un numero:
               -- sin idioma, sin capitalizacion, sin espacios de relleno.
               ----------------------------------------------------------------
               AND (l_mes IS NULL
                    OR EXTRACT(MONTH FROM v.fecha_hora) = l_mes)
               AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
        )
        SELECT fecha,
               manual,
               observacion,
               motivo_desarrollo,
               id_indice,
               si_no,
               id_institucion,
               nombre,
               turno,
               ----------------------------------------------------------------
               -- ON OVERFLOW TRUNCATE: LO QUE EVITA QUE UN MES GRANDE SE CAIGA.
               --
               -- LISTAGG devuelve VARCHAR2(4000) y al pasarse tira ORA-01489,
               -- que aca adentro NO se puede atrapar: tumba la consulta entera
               -- cuando la respuesta JSON ya esta abierta, y el front lo ve como
               -- "sin datos" en vez de como un error. Un mes chico anda y uno
               -- grande no, sin ninguna pista de por que.
               --
               -- OJO: NO se puede poner DISTINCT junto con ON OVERFLOW —Oracle
               -- no acepta las dos cosas en la misma llamada—. Los grados
               -- repetidos se sacan antes, con el DISTINCT del SELECT de `base`.
               ----------------------------------------------------------------
               LISTAGG(grado, ', ' ON OVERFLOW TRUNCATE '...' WITHOUT COUNT)
                 WITHIN GROUP (ORDER BY grado) AS grado,
               seccion,
               id_enfasis,
               descripcion,
               id_facilitador,
               nombre_facilitador,
               mes,
               MAX(id_intervencion) AS max_id_intervencion,
               hora,
               hora_desde,
               hora_hasta,
               -- El desvio ya calculado en `base`, devuelto CON SUS DOS RAREZAS
               -- INTACTAS para no romper el contrato con el front: signo
               -- invertido (positivo = llego antes) y dividido por 60, o sea en
               -- HORAS pese al nombre. Ver el encabezado y `desvioMinutos()`.
               --
               -- El /60 va aca y no en `base` a proposito: adentro se compara
               -- contra c_umbral_minutos, que esta en minutos.
               desvio_min / 60 AS diferencia_minutos,
               REPLACE(latitud,  ',', '.') AS latitud,
               REPLACE(longitud, ',', '.') AS longitud,
               ubicacion_insitutcion,
               -- Ya vienen de `base`: una fila del grupo alcanza, son iguales
               -- para toda la institucion.
               MAX(inst_lat) AS inst_latitud,
               MAX(inst_lon) AS inst_longitud,
               -- La distancia YA calculada en `base`. Antes se recalculaba aca
               -- con otra llamada a f_distancia + dos a f_coord.
               MAX(dist_m)   AS distancia_metros,
               anio
          FROM base
         ----------------------------------------------------------------------
         -- SOLO LAS MARCACIONES CON ALGUN DESVIO. Dos clases, y basta UNA:
         --
         --   a) HORARIO: se aparta c_umbral_minutos o mas de la hora de clase,
         --      en valor ABSOLUTO (tarde o anticipada).
         --   b) UBICACION: marco a mas de c_umbral_metros de la institucion.
         --
         -- Es un OR y no un AND: los dos graficos del inicio se alimentan de
         -- esta misma consulta, y con AND el de ubicacion solo veria a quien
         -- ademas llego tarde. Cada fila trae los dos datos y cada grafico
         -- filtra el suyo.
         --
         -- Las dos columnas vienen de `base`, ya calculadas. `desvio_min` esta
         -- en MINUTOS ahi adentro, asi que se compara directo contra el umbral
         -- sin el *60 que hacia falta antes.
         --
         -- Las filas sin hora calculable, o sin coordenadas, dan NULL en su lado
         -- del OR y no entran por ahi: de esas no se sabe si hubo desvio, y
         -- afirmarlo seria inventar.
         ----------------------------------------------------------------------
         WHERE ABS(desvio_min) >= c_umbral_minutos
            OR dist_m > c_umbral_metros
         GROUP BY fecha, manual, observacion, motivo_desarrollo,
                  id_indice, si_no, id_institucion, nombre, seccion,
                  id_enfasis, descripcion, id_facilitador, mes, hora,
                  nombre_facilitador, latitud, longitud,
                  ubicacion_insitutcion, hora_desde, hora_hasta, anio,
                  turno, desvio_min
         -- Por el ALIAS del agregado, no repitiendo el MAX(): envolver una
         -- funcion de grupo en otra da ORA-00935 ("demasiados niveles de
         -- anidamiento"). Y el alias se llama `max_id_intervencion` y no
         -- `id_intervencion` justamente para que no se confunda con la columna
         -- cruda que `base` ya trae con ese nombre.
         ORDER BY max_id_intervencion DESC
         FETCH FIRST l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion',   r.max_id_intervencion);
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
      p_mes   IN VARCHAR2 DEFAULT NULL,
      p_si_no IN VARCHAR2 DEFAULT NULL
  ) IS
    l_usuario  VARCHAR2(255);
    l_anio     VARCHAR2(4);
    l_mes      NUMBER;
    l_si_no    VARCHAR2(10);
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    -- EL FILTRO DE DESARROLLO: 'SI', 'NO', o NULL = las dos cosas.
    --
    -- Cualquier otro valor se trata como NULL en vez de rechazarse con un 400:
    -- este es un endpoint de tablero, y un parametro mal escrito tiene que
    -- devolver el grafico completo, no dejar la pantalla en blanco.
    --
    -- SI_NO es texto libre en la vista (sin CHECK ni dominio), asi que la
    -- comparacion de abajo normaliza los DOS lados con UPPER(TRIM(...)): los
    -- datos historicos traen 'Si', 'SI' y ' si '. Comparar contra 'Si' pelado
    -- perderia filas en silencio.
    l_si_no := UPPER(TRIM(p_si_no));
    IF l_si_no NOT IN ('SI', 'NO') THEN
      l_si_no := NULL;
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
    --
    -- El default sale de EXTRACT sobre SYSDATE: un numero, sin pasar por ningun
    -- nombre de mes ni por el NLS de la sesion.
    l_mes := NVL(f_mes(p_mes), EXTRACT(MONTH FROM SYSDATE));

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    -- El mes TAL COMO SE COMPARO ('AGOSTO'), no como lo mando el front.
    APEX_JSON.WRITE('mes',     l_mes);
    -- El filtro TAL COMO SE APLICO: si vino basura, acá sale null y se ve que
    -- no se filtro nada. Sin esto, un valor mal escrito daria el total completo
    -- sin ninguna pista de por que.
    APEX_JSON.WRITE('si_no',   l_si_no);
    -- Contra que se comparo, y cuantas filas hay de cada lado del filtro. Sin
    -- esto, un resultado vacio no distingue "no hay datos" de "el filtro no
    -- matchea", y hay que ir a la base a adivinar cual de las dos es.
    DECLARE
      l_solo_anio PLS_INTEGER;
      l_solo_mes  PLS_INTEGER;
    BEGIN
      SELECT COUNT(*) INTO l_solo_anio
        FROM v_historial_intervenciones
       WHERE l_anio IS NULL OR anio = l_anio;
      SELECT COUNT(*) INTO l_solo_mes
        FROM v_historial_intervenciones
       WHERE l_mes IS NULL
          OR EXTRACT(MONTH FROM fecha_hora) = l_mes;
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
         WHERE (l_anio IS NULL OR anio = l_anio)
           -- Desde FECHA_HORA, igual que en `listar`: los tres graficos tienen
           -- que mirar el mismo periodo o el tablero se contradice a si mismo.
           AND (l_mes IS NULL
                OR EXTRACT(MONTH FROM fecha_hora) = l_mes)
           -- Descarta las fechas mal cargadas ANTES del TO_DATE: adentro de un
           -- SELECT no hay donde atrapar el ORA-01843, y una sola fila con
           -- basura tumbaria la consulta entera.
           AND REGEXP_LIKE(TRIM(fecha), '^\d{2}/\d{2}/\d{4}$')
           -- El filtro de desarrollo. Con l_si_no NULL no filtra nada.
           --
           -- Las filas con SI_NO vacio o ilegible quedan AFUERA cuando el
           -- filtro esta puesto, igual que en el front (`estadoDesarrollo`):
           -- no se sabe de que lado van y contarlas en cualquiera de los dos
           -- grupos inventaria un dato que la base no tiene.
           AND (l_si_no IS NULL OR UPPER(TRIM(si_no)) = l_si_no)
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

  ------------------------------------------------------------------------------
  -- POR_DIA_DETALLE: quien hizo las intervenciones de UN dia (09/10/2026).
  --
  -- Lo que se abre al tocar una barra del grafico de Actividad: por
  -- facilitador e institucion, cuantas en total, cuantas desarrollaron el
  -- indice y cuantas no. MISMA fuente, MISMOS filtros y MISMA forma de contar
  -- que `por_dia` (filas de la vista, fecha validada, SI_NO normalizado), para
  -- que la suma del detalle de un dia de exactamente su barra.
  --
  -- Las tres cuentas vienen juntas: el modal cambia de serie sin otro pedido.
  ------------------------------------------------------------------------------
  PROCEDURE por_dia_detalle(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_mes   IN VARCHAR2 DEFAULT NULL,
      p_dia   IN VARCHAR2 DEFAULT NULL
  ) IS
    l_anio VARCHAR2(4);
    l_mes  NUMBER;
    l_dia  NUMBER;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;
    BEGIN
      l_dia := TO_NUMBER(TRIM(p_dia));
    EXCEPTION
      WHEN OTHERS THEN l_dia := NULL;
    END;
    IF l_dia IS NULL OR l_dia NOT BETWEEN 1 AND 31 OR l_dia <> TRUNC(l_dia) THEN
      p_error(400, 'Bad Request', 'El dia tiene que ser un numero de 1 a 31');
      RETURN;
    END IF;
    -- El periodo, igual que `por_dia`.
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      l_anio := TRIM(p_anio);
    ELSE
      l_anio := TO_CHAR(SYSDATE, 'YYYY');
    END IF;
    l_mes := NVL(f_mes(p_mes), EXTRACT(MONTH FROM SYSDATE));

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio', l_anio);
    APEX_JSON.WRITE('mes',  l_mes);
    APEX_JSON.WRITE('dia',  l_dia);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_facilitador, nombre_facilitador, id_institucion, nombre,
               COUNT(*) AS total,
               SUM(CASE WHEN UPPER(TRIM(si_no)) = 'SI' THEN 1 ELSE 0 END) AS cant_si,
               SUM(CASE WHEN UPPER(TRIM(si_no)) = 'NO' THEN 1 ELSE 0 END) AS cant_no
          FROM v_historial_intervenciones
         WHERE (l_anio IS NULL OR anio = l_anio)
           AND EXTRACT(MONTH FROM fecha_hora) = l_mes
           -- La fecha validada antes de usarla, como en `por_dia`. El dia es
           -- lo que `por_dia` saca con TO_CHAR(TO_DATE(fecha), 'DD').
           AND REGEXP_LIKE(TRIM(fecha), '^\d{2}/\d{2}/\d{4}$')
           AND TO_NUMBER(SUBSTR(TRIM(fecha), 1, 2)) = l_dia
         GROUP BY id_facilitador, nombre_facilitador, id_institucion, nombre
         ORDER BY UPPER(nombre_facilitador), UPPER(nombre)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_facilitador',     r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_facilitador);
      APEX_JSON.WRITE('id_institucion',     r.id_institucion);
      APEX_JSON.WRITE('institucion',        r.nombre);
      APEX_JSON.WRITE('total',              r.total);
      APEX_JSON.WRITE('si',                 r.cant_si);
      APEX_JSON.WRITE('no',                 r.cant_no);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END por_dia_detalle;

  ------------------------------------------------------------------------------
  -- EL MAPA (pagina 25 de APEX, /mapa-intervenciones)  —  09/10/2026
  --
  -- Las marcaciones de UN facilitador en un rango de fechas, para dibujarlas
  -- en el mapa. Lee la TABLA INTERVENCIONES (como el proceso COORDENADAS de
  -- APEX), no la vista: aca interesa cada marcacion, sin agrupar por grado.
  --
  -- Lo que corrige de APEX:
  --   * APEX filtraba con to_date(fecha_hora,'dd/mm/yyyy') sobre un DATE: una
  --     conversion implicita a texto y de vuelta que depende del NLS de la
  --     sesion y puede correr el dia. Aca es un rango sobre el DATE.
  --   * APEX hacia INNER JOIN con INDICES_MANUALES: una marcacion sin indice no
  --     aparecia en el mapa. Aca es LEFT JOIN.
  --
  -- El punto de cada institucion es la MEDIANA de sus propias marcaciones,
  -- igual que en `listar` (UBICACION_INSITUTCION no tiene coordenadas, ver la
  -- nota de f_coord). Solo se calcula para las instituciones del resultado.
  -- La distancia y el umbral de "lejos" son los de `listar` (c_umbral_metros).
  ------------------------------------------------------------------------------
  PROCEDURE mapa(
      p_token          IN VARCHAR2,
      p_desde          IN VARCHAR2,
      p_hasta          IN VARCHAR2,
      p_id_facilitador IN NUMBER
  ) IS
    l_desde DATE;
    l_hasta DATE;
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
    IF l_desde IS NULL OR l_hasta IS NULL OR l_hasta < l_desde THEN
      p_error(400, 'Bad Request', 'El periodo no es valido');
      RETURN;
    END IF;
    IF l_hasta - l_desde > c_mapa_dias THEN
      p_error(400, 'Bad Request', 'El periodo no puede pasar de ' || c_mapa_dias || ' dias');
      RETURN;
    END IF;
    IF p_id_facilitador IS NULL THEN
      p_error(400, 'Bad Request', 'Elegi el facilitador');
      RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('umbral_metros', c_umbral_metros);
    APEX_JSON.WRITE('limite', c_mapa_limite);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH base AS (
            SELECT i.id_intervencion, i.fecha_hora, i.id_institucion, i.manual,
                   i.id_indice, i.observacion,
                   f_coord(i.latitud  || ',0', 1) AS lat,
                   f_coord(i.longitud || ',0', 1) AS lon
              FROM intervenciones i
             WHERE i.id_facilitador = p_id_facilitador
               AND i.fecha_hora >= l_desde
               AND i.fecha_hora <  l_hasta + 1
        ),
        ref AS (
            SELECT id_institucion,
                   MEDIAN(f_coord(latitud  || ',0', 1)) AS lat,
                   MEDIAN(f_coord(longitud || ',0', 1)) AS lon
              FROM intervenciones
             WHERE id_institucion IN (SELECT id_institucion FROM base)
               AND f_coord(latitud  || ',0', 1) IS NOT NULL
               AND f_coord(longitud || ',0', 1) IS NOT NULL
               -- (0,0): sin ubicacion (ver c_umbral_metros).
               AND NOT (f_coord(latitud  || ',0', 1) = 0
                    AND f_coord(longitud || ',0', 1) = 0)
             GROUP BY id_institucion
        )
        SELECT b.id_intervencion,
               TO_CHAR(b.fecha_hora, 'YYYY-MM-DD') AS dia,
               TO_CHAR(b.fecha_hora, 'HH24:MI')    AS hora,
               b.id_institucion, ins.nombre AS institucion,
               b.manual, b.id_indice, im.nro_indice, im.titulo, b.observacion,
               CASE WHEN b.lat = 0 AND b.lon = 0 THEN NULL ELSE b.lat END AS lat,
               CASE WHEN b.lat = 0 AND b.lon = 0 THEN NULL ELSE b.lon END AS lon,
               ref.lat AS inst_lat,
               ref.lon AS inst_lon,
               CASE WHEN b.lat = 0 AND b.lon = 0 THEN NULL
                    ELSE f_distancia(b.lat, b.lon, ref.lat, ref.lon) END AS dist_m
          FROM base b
          LEFT JOIN instituciones ins   ON ins.id_institucion = b.id_institucion
          LEFT JOIN indices_manuales im ON im.id_indice = b.id_indice
          LEFT JOIN ref                 ON ref.id_institucion = b.id_institucion
         ORDER BY b.fecha_hora, b.id_intervencion
         FETCH FIRST c_mapa_limite ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',             r.id_intervencion);
      APEX_JSON.WRITE('dia',            r.dia);
      APEX_JSON.WRITE('hora',           r.hora);
      APEX_JSON.WRITE('id_institucion', r.id_institucion);
      APEX_JSON.WRITE('institucion',    r.institucion);
      APEX_JSON.WRITE('manual',         r.manual);
      APEX_JSON.WRITE('id_indice',      r.id_indice);
      APEX_JSON.WRITE('nro_indice',     r.nro_indice);
      APEX_JSON.WRITE('indice',         r.titulo);
      APEX_JSON.WRITE('observacion',    r.observacion);
      APEX_JSON.WRITE('lat',            r.lat);
      APEX_JSON.WRITE('lng',            r.lon);
      APEX_JSON.WRITE('inst_lat',       r.inst_lat);
      APEX_JSON.WRITE('inst_lng',       r.inst_lon);
      APEX_JSON.WRITE('distancia_metros', ROUND(r.dist_m));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END mapa;

  ------------------------------------------------------------------------------
  -- Los facilitadores con marcaciones en el rango, con cuantas: la lista para
  -- elegir (la LOV P25_ID_FACILITADOR de APEX, con la cantidad agregada).
  ------------------------------------------------------------------------------
  PROCEDURE mapa_facilitadores(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2
  ) IS
    l_desde DATE;
    l_hasta DATE;
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
       OR l_hasta - l_desde > c_mapa_dias THEN
      p_error(400, 'Bad Request', 'El periodo no es valido');
      RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT i.id_facilitador, f.nombre_apellido, COUNT(*) AS cantidad
          FROM intervenciones i
          JOIN facilitadores f ON f.id_facilitador = i.id_facilitador
         WHERE i.fecha_hora >= l_desde
           AND i.fecha_hora <  l_hasta + 1
         GROUP BY i.id_facilitador, f.nombre_apellido
         ORDER BY UPPER(f.nombre_apellido)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_facilitador', r.id_facilitador);
      APEX_JSON.WRITE('nombre',         r.nombre_apellido);
      APEX_JSON.WRITE('cantidad',       r.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END mapa_facilitadores;

  ------------------------------------------------------------------------------
  -- REALIZADAS: la pagina 52 de APEX (Intervenciones Realizadas), 12/10/2026.
  --
  -- TODAS las marcaciones, no solo las desviadas como `listar`: es el reporte
  -- de lo que se hizo. Es la consulta de APEX tal cual:
  --
  --   * El mismo GROUP BY: una fila por marcacion (fecha, hora, facilitador,
  --     institucion, indice...), con MAX(id_intervencion).
  --   * Los grados juntos, como APEX: "Ma\00f1ana-7-A-Enfasis; Tarde-8-B-...".
  --     Con ON OVERFLOW TRUNCATE, por lo mismo que en `listar` (ORA-01489).
  --   * DIFERENCIA en MINUTOS y con el signo de APEX: HORA_DESDE - HORA, o sea
  --     POSITIVO = llego antes y NEGATIVO = llego tarde. Sin el /60 de
  --     `listar`: es la columna "Dif. Min." de APEX. Protegida con el mismo
  --     CASE + REGEXP_LIKE contra horas vacias o con basura.
  --   * El indice resuelto (numero y titulo), que APEX mostraba con una LOV.
  --   * ORDER BY id_intervencion DESC.
  --
  -- p_anio:  'YYYY'. Sin el, el anio en curso.
  -- p_meses: numeros de mes separados por coma ('8,9'). Sin ellos, todo el
  --          anio. Por FECHA_HORA, NUNCA por la columna MES (ver el encabezado).
  --
  -- Ademas devuelve los anios con datos y cuantas filas tiene cada mes del anio,
  -- para los filtros de la pantalla. Tope c_limite_maximo filas: `truncado`
  -- avisa si se corto, para que la pantalla lo diga en vez de mentir.
  --
  -- POR PERIODO (12/10/2026, la pagina 55, Totales por Facilitador): con
  -- p_desde y p_hasta (YYYY-MM-DD, hasta c_mapa_dias dias) se ignoran el anio
  -- y los meses y vienen las marcaciones de ese periodo; `meses` sale vacio.
  -- p_si_no ('Si' / 'No') deja solo las desarrolladas o las no; sin el, las
  -- dos. Es la misma consulta y el mismo GROUP BY que la 55 de APEX usaba para
  -- contar, asi que la cuenta por facilitador sale de estas filas.
  ------------------------------------------------------------------------------
  PROCEDURE realizadas(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL,
      p_meses IN VARCHAR2 DEFAULT NULL,
      p_desde IN VARCHAR2 DEFAULT NULL,
      p_hasta IN VARCHAR2 DEFAULT NULL,
      p_si_no IN VARCHAR2 DEFAULT NULL
  ) IS
    l_anio  VARCHAR2(10) := NVL(TRIM(p_anio), TO_CHAR(SYSDATE, 'YYYY'));
    -- Solo digitos y comas: se compara con INSTR, y una basura no tiene que
    -- poder matchear un mes de casualidad.
    l_meses VARCHAR2(100) := REGEXP_REPLACE(p_meses, '[^0-9,]', '');
    l_desde DATE;
    l_hasta DATE;
    l_si_no VARCHAR2(5) := CASE UPPER(TRIM(p_si_no)) WHEN 'SI' THEN 'SI' WHEN 'NO' THEN 'NO' END;
    l_tope  PLS_INTEGER := c_limite_maximo;
    l_tope1 PLS_INTEGER := c_limite_maximo + 1;
    l_n     PLS_INTEGER := 0;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;
    IF TRIM(p_desde) IS NOT NULL OR TRIM(p_hasta) IS NOT NULL THEN
      -- Por periodo: el anio y los meses no cuentan.
      BEGIN
        l_desde := TO_DATE(SUBSTR(TRIM(p_desde), 1, 10), 'YYYY-MM-DD');
        l_hasta := TO_DATE(SUBSTR(TRIM(p_hasta), 1, 10), 'YYYY-MM-DD');
      EXCEPTION
        WHEN OTHERS THEN
          p_error(400, 'Bad Request', 'Las fechas van como YYYY-MM-DD');
          RETURN;
      END;
      IF l_desde IS NULL OR l_hasta IS NULL OR l_hasta < l_desde
         OR l_hasta - l_desde > c_mapa_dias THEN
        p_error(400, 'Bad Request', 'El periodo no es valido (hasta ' || c_mapa_dias || ' dias)');
        RETURN;
      END IF;
      l_anio  := NULL;
      l_meses := NULL;
    ELSIF NOT REGEXP_LIKE(l_anio, '^\d{4}$') THEN
      p_error(400, 'Bad Request', 'El anio va como YYYY');
      RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('limite',  l_tope);

    -- Los anios con marcaciones, para elegir.
    APEX_JSON.OPEN_ARRAY('anios');
    FOR a IN (SELECT DISTINCT anio FROM v_historial_intervenciones
               WHERE anio IS NOT NULL ORDER BY anio DESC) LOOP
      APEX_JSON.WRITE(a.anio);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Cuantas filas del reporte tiene cada mes del anio (la faceta MES de APEX).
    -- Mismo GROUP BY que el reporte, para que la cuenta coincida con las filas.
    APEX_JSON.OPEN_ARRAY('meses');
    FOR m IN (
        SELECT mes, COUNT(*) AS cantidad
          FROM (SELECT EXTRACT(MONTH FROM MAX(fecha_hora)) AS mes
                  FROM v_historial_intervenciones
                 WHERE anio = l_anio
                 GROUP BY fecha, manual, observacion, motivo_desarrollo, id_indice,
                          si_no, id_institucion, nombre, id_facilitador, hora,
                          nombre_facilitador, hora_desde, hora_hasta, anio)
         GROUP BY mes
         ORDER BY mes
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('mes',      m.mes);
      APEX_JSON.WRITE('cantidad', m.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT v.fecha, v.manual, v.observacion, v.motivo_desarrollo, v.id_indice,
               MAX(im.nro_indice) AS nro_indice,
               MAX(im.titulo)     AS indice_titulo,
               v.si_no, v.id_institucion, v.nombre,
               LISTAGG(DECODE(TO_CHAR(v.turno), '1', TO_CHAR(UNISTR('Ma\00f1ana')),
                                                '2', 'Tarde', 'Noche')
                       || '-' || v.grado || '-' || v.seccion || '-' || v.descripcion,
                       '; ' ON OVERFLOW TRUNCATE '...' WITHOUT COUNT)
                 WITHIN GROUP (ORDER BY v.turno, v.grado, v.seccion) AS grado,
               v.id_facilitador, v.nombre_facilitador,
               MAX(v.id_intervencion) AS max_id_intervencion,
               v.hora, v.hora_desde, v.hora_hasta,
               REPLACE(MAX(v.latitud),  ',', '.') AS latitud,
               REPLACE(MAX(v.longitud), ',', '.') AS longitud,
               CASE
                 WHEN REGEXP_LIKE(TRIM(v.hora),       '^\d{1,2}:\d{2}$')
                  AND REGEXP_LIKE(TRIM(v.hora_desde), '^\d{1,2}:\d{2}$')
                 THEN ROUND((TO_DATE(TRIM(v.hora_desde), 'HH24:MI')
                           - TO_DATE(TRIM(v.hora),       'HH24:MI')) * 24 * 60, 0)
               END AS diferencia,
               EXTRACT(MONTH FROM MAX(v.fecha_hora)) AS mes,
               v.anio
          FROM v_historial_intervenciones v
          LEFT JOIN indices_manuales im ON im.id_indice = v.id_indice
         WHERE (l_anio IS NULL OR v.anio = l_anio)
           -- Por periodo (la 55): por FECHA_HORA, que es DATE.
           AND (l_desde IS NULL
                OR (v.fecha_hora >= l_desde AND v.fecha_hora < l_hasta + 1))
           AND (l_si_no IS NULL OR UPPER(v.si_no) = l_si_no)
           AND (l_meses IS NULL
                OR INSTR(',' || l_meses || ',',
                         ',' || EXTRACT(MONTH FROM v.fecha_hora) || ',') > 0)
         GROUP BY v.fecha, v.manual, v.observacion, v.motivo_desarrollo, v.id_indice,
                  v.si_no, v.id_institucion, v.nombre, v.id_facilitador, v.hora,
                  v.nombre_facilitador, v.hora_desde, v.hora_hasta, v.anio
         ORDER BY max_id_intervencion DESC
         FETCH FIRST l_tope1 ROWS ONLY
    ) LOOP
      -- Se pide uno de mas para saber si hubo corte, y ese no se escribe.
      l_n := l_n + 1;
      EXIT WHEN l_n > l_tope;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion',   r.max_id_intervencion);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('hora',              r.hora);
      APEX_JSON.WRITE('hora_desde',        r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',        r.hora_hasta);
      APEX_JSON.WRITE('diferencia',        r.diferencia);
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('id_indice',         r.id_indice);
      APEX_JSON.WRITE('nro_indice',        r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',     r.indice_titulo);
      APEX_JSON.WRITE('si_no',             r.si_no);
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('institucion',       r.nombre);
      APEX_JSON.WRITE('grado',             r.grado);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('facilitador',       r.nombre_facilitador);
      APEX_JSON.WRITE('observacion',       r.observacion);
      APEX_JSON.WRITE('motivo_desarrollo', r.motivo_desarrollo);
      APEX_JSON.WRITE('latitud',           r.latitud);
      APEX_JSON.WRITE('longitud',          r.longitud);
      APEX_JSON.WRITE('mes',               r.mes);
      APEX_JSON.WRITE('anio',              r.anio);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > l_tope);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END realizadas;

  ------------------------------------------------------------------------------
  -- El texto de las postulaciones de esa clase, con FN_DETALLE_POSTULACIONES
  -- (la funcion que ya usaba APEX en la pagina 53).
  --
  -- SE LLAMA DINAMICO A PROPOSITO: la funcion no esta en ningun script del
  -- repo. Llamada directa, si algun dia no existiera o quedara invalida, el
  -- paquete ENTERO no compilaria y se caerian tambien los graficos del Inicio.
  -- Asi, si falla, la columna sale vacia y lo demas anda.
  ------------------------------------------------------------------------------
  FUNCTION f_detalle_postulacion(
      p_id_facilitador IN NUMBER,
      p_id_institucion IN NUMBER,
      p_dia_hora       IN VARCHAR2) RETURN VARCHAR2
  IS
    l_r VARCHAR2(32767);
  BEGIN
    IF p_dia_hora IS NULL THEN RETURN NULL; END IF;
    EXECUTE IMMEDIATE 'BEGIN :r := FN_DETALLE_POSTULACIONES(:f, :i, :d); END;'
      USING OUT l_r, IN p_id_facilitador, IN p_id_institucion, IN p_dia_hora;
    RETURN SUBSTR(l_r, 1, 4000);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_detalle_postulacion;

  ------------------------------------------------------------------------------
  -- RESUMEN_PERIODO: la pagina 53 de APEX (Resumen de Intervenciones),
  -- 12/10/2026. Lo que se le paga a cada facilitador: las intervenciones del
  -- periodo, desarrolladas o no, contadas como las contaba APEX.
  --
  -- La consulta de APEX tal cual, con dos cambios que no cambian el resultado:
  --
  --   * UNA POR CLASE Y DIA: de las intervenciones de la misma institucion,
  --     facilitador, turno, dia, manual e indice, cuenta solo la ultima
  --     (MAX(id_intervencion)). Es la regla de APEX, y la cuenta del pago.
  --   * El horario de la clase sale de la POSTULACION, el del dia de la semana
  --     de la marcacion. El dia se saca con TRUNC(fecha) - TRUNC(fecha,'IW')
  --     (0 = lunes) y NO con TO_CHAR(...,'DY'), que depende del idioma y en
  --     espanol devuelve 'MIE' con tilde.
  --   * DIFERENCIA en MINUTOS: (fecha + hora de inicio) - marcacion, o sea
  --     POSITIVO = llego antes, como la "Dif. Min." de APEX.
  --   * Las postulaciones de la clase con FN_DETALLE_POSTULACIONES (ver
  --     f_detalle_postulacion) y el dia en letras, como la columna Historial.
  --
  -- p_desde / p_hasta: YYYY-MM-DD, inclusive; hasta c_mapa_dias dias.
  -- p_si_no: 'Si' o 'No' (el radio Desarrollo de APEX). Sin el, los dos.
  --
  -- La institucion y el facilitador NO se filtran aca: la pantalla los elige
  -- sobre lo que llega, con cuantas tiene cada uno. Tope c_limite_maximo filas;
  -- `truncado` avisa si se corto.
  ------------------------------------------------------------------------------
  PROCEDURE resumen_periodo(
      p_token IN VARCHAR2,
      p_desde IN VARCHAR2,
      p_hasta IN VARCHAR2,
      p_si_no IN VARCHAR2 DEFAULT NULL
  ) IS
    l_desde DATE;
    l_hasta DATE;
    l_si_no VARCHAR2(5) := CASE UPPER(TRIM(p_si_no)) WHEN 'SI' THEN 'SI' WHEN 'NO' THEN 'NO' END;
    l_tope  PLS_INTEGER := c_limite_maximo;
    l_tope1 PLS_INTEGER := c_limite_maximo + 1;
    l_n     PLS_INTEGER := 0;
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
       OR l_hasta - l_desde > c_mapa_dias THEN
      p_error(400, 'Bad Request', 'El periodo no es valido (hasta ' || c_mapa_dias || ' dias)');
      RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH base AS (
            SELECT i.id_intervencion, i.id_institucion, i.id_facilitador, i.fecha_hora,
                   i.manual, i.id_indice, i.si_no, i.latitud, i.longitud,
                   -- La hora de inicio y de fin de la clase, del dia de la marcacion.
                   CASE TRUNC(i.fecha_hora) - TRUNC(i.fecha_hora, 'IW')
                     WHEN 0 THEN p.lunes_desde     WHEN 1 THEN p.martes_desde
                     WHEN 2 THEN p.miercoles_desde WHEN 3 THEN p.jueves_desde
                     WHEN 4 THEN p.viernes_desde
                   END AS desde,
                   CASE TRUNC(i.fecha_hora) - TRUNC(i.fecha_hora, 'IW')
                     WHEN 0 THEN p.lunes_hasta     WHEN 1 THEN p.martes_hasta
                     WHEN 2 THEN p.miercoles_hasta WHEN 3 THEN p.jueves_hasta
                     WHEN 4 THEN p.viernes_hasta
                   END AS hasta
              FROM intervenciones i
              LEFT JOIN postulaciones p ON p.id_postulacion = i.id_postulacion
             WHERE i.fecha_hora >= l_desde
               AND i.fecha_hora <  l_hasta + 1
               AND (l_si_no IS NULL OR UPPER(i.si_no) = l_si_no)
               -- Una por clase y dia: la regla de APEX.
               AND i.id_intervencion = (
                     SELECT MAX(a.id_intervencion)
                       FROM intervenciones a
                      WHERE a.id_institucion  = i.id_institucion
                        AND a.id_facilitador  = i.id_facilitador
                        AND a.turno           = i.turno
                        AND TRUNC(a.fecha_hora) = TRUNC(i.fecha_hora)
                        AND a.manual          = i.manual
                        AND a.id_indice       = i.id_indice)
        )
        SELECT b.id_intervencion, b.id_institucion, ins.nombre AS institucion,
               b.id_facilitador, f.nombre_apellido AS facilitador,
               TO_CHAR(b.fecha_hora, 'DD/MM/YYYY') AS fecha,
               TO_CHAR(b.fecha_hora, 'HH24:MI')    AS hora,
               TO_CHAR(b.desde, 'HH24:MI')         AS hora_desde,
               TO_CHAR(b.hasta, 'HH24:MI')         AS hora_hasta,
               ROUND(((TRUNC(b.fecha_hora) + (b.desde - TRUNC(b.desde)))
                      - b.fecha_hora) * 24 * 60, 0) AS diferencia,
               b.manual, b.id_indice, im.nro_indice, im.titulo AS indice_titulo,
               b.si_no,
               -- El dia como lo escribe APEX ('LUNES'): va a FN_DETALLE_POSTULACIONES
               -- pegado a la hora de inicio, y es el texto de la columna Historial.
               TRIM(TO_CHAR(b.fecha_hora, 'DAY', 'NLS_DATE_LANGUAGE=SPANISH')) AS dia,
               REPLACE(b.latitud,  ',', '.') AS latitud,
               REPLACE(b.longitud, ',', '.') AS longitud
          FROM base b
          LEFT JOIN instituciones ins   ON ins.id_institucion = b.id_institucion
          LEFT JOIN facilitadores f     ON f.id_facilitador   = b.id_facilitador
          LEFT JOIN indices_manuales im ON im.id_indice       = b.id_indice
         ORDER BY b.fecha_hora DESC
         FETCH FIRST l_tope1 ROWS ONLY
    ) LOOP
      -- Se pide uno de mas para saber si hubo corte, y ese no se escribe.
      l_n := l_n + 1;
      EXIT WHEN l_n > l_tope;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion', r.id_intervencion);
      APEX_JSON.WRITE('id_institucion',  r.id_institucion);
      APEX_JSON.WRITE('institucion',     r.institucion);
      APEX_JSON.WRITE('id_facilitador',  r.id_facilitador);
      APEX_JSON.WRITE('facilitador',     r.facilitador);
      APEX_JSON.WRITE('fecha',           r.fecha);
      APEX_JSON.WRITE('hora',            r.hora);
      APEX_JSON.WRITE('hora_desde',      r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',      r.hora_hasta);
      APEX_JSON.WRITE('diferencia',      r.diferencia);
      APEX_JSON.WRITE('manual',          r.manual);
      APEX_JSON.WRITE('id_indice',       r.id_indice);
      APEX_JSON.WRITE('nro_indice',      r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',   r.indice_titulo);
      APEX_JSON.WRITE('si_no',           r.si_no);
      APEX_JSON.WRITE('dia',             r.dia);
      APEX_JSON.WRITE('postulaciones',
          f_detalle_postulacion(r.id_facilitador, r.id_institucion,
                                CASE WHEN r.hora_desde IS NOT NULL
                                     THEN r.dia || r.hora_desde END));
      APEX_JSON.WRITE('latitud',         r.latitud);
      APEX_JSON.WRITE('longitud',        r.longitud);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > l_tope);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END resumen_periodo;

  ------------------------------------------------------------------------------
  -- NO_REALIZADAS: la pagina 69 de APEX (Intervenciones no realizadas),
  -- 12/10/2026. Las marcaciones con el indice NO desarrollado.
  --
  -- La consulta de APEX tal cual:
  --
  --   * NVL(si_no, 'Si') = 'No': sin dato cuenta como desarrollada.
  --   * Su GROUP BY, que es MAS FINO que el de `realizadas`: separa por turno,
  --     seccion y enfasis (y por las coordenadas), y junta solo los grados de
  --     cada uno ("7, 8"). Por eso no se reusa `realizadas`, que junta todo en
  --     un texto: aca turno, grado y seccion son columnas.
  --   * El indice resuelto (numero y titulo) y el mes de FECHA_HORA.
  --   * ORDER BY id_intervencion DESC.
  --
  -- p_anio: 'YYYY' (sin el, el anio en curso) o 'TODOS'. APEX traia todo;
  -- aca se pide por anio. Devuelve tambien los anios que tienen alguna.
  -- Tope c_limite_maximo filas, con `truncado`.
  ------------------------------------------------------------------------------
  PROCEDURE no_realizadas(
      p_token IN VARCHAR2,
      p_anio  IN VARCHAR2 DEFAULT NULL
  ) IS
    l_anio  VARCHAR2(10);
    l_tope  PLS_INTEGER := c_limite_maximo;
    l_tope1 PLS_INTEGER := c_limite_maximo + 1;
    l_n     PLS_INTEGER := 0;
  BEGIN
    IF f_usuario(p_token) IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSE
      l_anio := NVL(TRIM(p_anio), TO_CHAR(SYSDATE, 'YYYY'));
      IF NOT REGEXP_LIKE(l_anio, '^\d{4}$') THEN
        p_error(400, 'Bad Request', 'El anio va como YYYY o TODOS');
        RETURN;
      END IF;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('anios');
    FOR a IN (SELECT DISTINCT anio FROM v_historial_intervenciones
               WHERE anio IS NOT NULL AND NVL(si_no, 'Si') = 'No'
               ORDER BY anio DESC) LOOP
      APEX_JSON.WRITE(a.anio);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT v.fecha, v.manual, v.observacion, v.motivo_desarrollo, v.id_indice,
               MAX(im.nro_indice) AS nro_indice,
               MAX(im.titulo)     AS indice_titulo,
               v.id_institucion, v.nombre, v.turno,
               LISTAGG(v.grado, ', ' ON OVERFLOW TRUNCATE '...' WITHOUT COUNT)
                 WITHIN GROUP (ORDER BY v.grado) AS grado,
               v.seccion, v.id_enfasis, v.descripcion,
               v.id_facilitador, v.nombre_facilitador,
               MAX(v.id_intervencion) AS max_id_intervencion,
               v.hora, v.hora_desde, v.hora_hasta,
               EXTRACT(MONTH FROM MAX(v.fecha_hora)) AS mes,
               v.anio
          FROM v_historial_intervenciones v
          LEFT JOIN indices_manuales im ON im.id_indice = v.id_indice
         WHERE NVL(v.si_no, 'Si') = 'No'
           AND (l_anio IS NULL OR v.anio = l_anio)
         GROUP BY v.fecha, v.manual, v.observacion, v.motivo_desarrollo, v.id_indice,
                  v.si_no, v.id_institucion, v.nombre, v.seccion, v.id_enfasis,
                  v.descripcion, v.id_facilitador, v.hora, v.nombre_facilitador,
                  v.latitud, v.longitud, v.hora_desde, v.hora_hasta, v.anio, v.turno
         ORDER BY max_id_intervencion DESC
         FETCH FIRST l_tope1 ROWS ONLY
    ) LOOP
      -- Se pide una de mas para saber si hubo corte, y esa no se escribe.
      l_n := l_n + 1;
      EXIT WHEN l_n > l_tope;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_intervencion',   r.max_id_intervencion);
      APEX_JSON.WRITE('fecha',             r.fecha);
      APEX_JSON.WRITE('hora',              r.hora);
      APEX_JSON.WRITE('hora_desde',        r.hora_desde);
      APEX_JSON.WRITE('hora_hasta',        r.hora_hasta);
      APEX_JSON.WRITE('manual',            r.manual);
      APEX_JSON.WRITE('id_indice',         r.id_indice);
      APEX_JSON.WRITE('nro_indice',        r.nro_indice);
      APEX_JSON.WRITE('indice_titulo',     r.indice_titulo);
      APEX_JSON.WRITE('observacion',       r.observacion);
      APEX_JSON.WRITE('motivo_desarrollo', r.motivo_desarrollo);
      APEX_JSON.WRITE('id_institucion',    r.id_institucion);
      APEX_JSON.WRITE('institucion',       r.nombre);
      APEX_JSON.WRITE('turno',             r.turno);
      APEX_JSON.WRITE('grado',             r.grado);
      APEX_JSON.WRITE('seccion',           r.seccion);
      APEX_JSON.WRITE('id_enfasis',        r.id_enfasis);
      APEX_JSON.WRITE('enfasis',           r.descripcion);
      APEX_JSON.WRITE('id_facilitador',    r.id_facilitador);
      APEX_JSON.WRITE('facilitador',       r.nombre_facilitador);
      APEX_JSON.WRITE('mes',               r.mes);
      APEX_JSON.WRITE('anio',              r.anio);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.WRITE('truncado', l_n > l_tope);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END no_realizadas;

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
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/por-dia/detalle', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/por-dia/detalle', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/mapa', 'GET');        EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/mapa', 'OPTIONS');    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/mapa/facilitadores', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/mapa/facilitadores', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/realizadas', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/realizadas', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen-periodo', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/resumen-periodo', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/no-realizadas', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'intervenciones/no-realizadas', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

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
        -- El mes viaja como TEXTO ('Agosto'), sin TO_NUMBER: la columna MES de
        -- la vista es texto y se compara contra ella directo.
        p_mes            => :mes,
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
  -- intervenciones/por-dia  ?anio=&mes=&si_no=
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
        -- Idem `listar`: el mes es TEXTO ('Agosto').
        p_mes   => :mes,
        -- 'SI' / 'NO'. Sin el, cuenta las dos cosas.
        p_si_no => :si_no);
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

  ----------------------------------------------------------------------------
  -- intervenciones/por-dia/detalle  ?anio=&mes=&dia=
  -- Prioridad 2: mas especifica que por-dia (1).
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/por-dia/detalle',
        p_priority    => 2,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/por-dia/detalle',
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
    PKG_INTERVENCIONES_ETHOS.POR_DIA_DETALLE(
        p_token => l_token,
        p_anio  => :anio,
        p_mes   => :mes,
        p_dia   => :dia);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/por-dia/detalle',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- intervenciones/mapa y intervenciones/mapa/facilitadores (la pagina 25).
  -- La mas larga con mas prioridad, por lo mismo que por-dia.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/mapa',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/mapa',
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
    PKG_INTERVENCIONES_ETHOS.MAPA(
        p_token          => l_token,
        p_desde          => :desde,
        p_hasta          => :hasta,
        p_id_facilitador => TO_NUMBER(:id_facilitador));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/mapa',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/mapa/facilitadores',
        p_priority    => 2,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/mapa/facilitadores',
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
    PKG_INTERVENCIONES_ETHOS.MAPA_FACILITADORES(
        p_token => l_token,
        p_desde => :desde,
        p_hasta => :hasta);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/mapa/facilitadores',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- intervenciones/realizadas  ?anio=&meses=  o  ?desde=&hasta=&si_no=  (52 y 55)
  -- Prioridad 1, mas alta que 'intervenciones' (0), por lo mismo que por-dia.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/realizadas',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/realizadas',
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
    PKG_INTERVENCIONES_ETHOS.REALIZADAS(
        p_token => l_token,
        p_anio  => :anio,
        -- Numeros de mes separados por coma ('8,9'). Sin ellos, todo el anio.
        p_meses => :meses,
        -- Por periodo (la pagina 55): YYYY-MM-DD. Con ellos no cuentan anio ni meses.
        p_desde => :desde,
        p_hasta => :hasta,
        p_si_no => :si_no);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/realizadas',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- intervenciones/resumen-periodo  ?desde=&hasta=&si_no=   (la pagina 53)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/resumen-periodo',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/resumen-periodo',
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
    PKG_INTERVENCIONES_ETHOS.RESUMEN_PERIODO(
        p_token => l_token,
        p_desde => :desde,
        p_hasta => :hasta,
        -- 'Si' / 'No'. Sin el, los dos.
        p_si_no => :si_no);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/resumen-periodo',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- intervenciones/no-realizadas  ?anio=   (la pagina 69)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'intervenciones/no-realizadas',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'intervenciones/no-realizadas',
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
    PKG_INTERVENCIONES_ETHOS.NO_REALIZADAS(
        p_token => l_token,
        -- 'YYYY' o 'TODOS'. Sin el, el anio en curso.
        p_anio  => :anio);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'intervenciones/no-realizadas',
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
  preflight('intervenciones/por-dia/detalle');
  preflight('intervenciones/mapa');
  preflight('intervenciones/mapa/facilitadores');
  preflight('intervenciones/realizadas');
  preflight('intervenciones/resumen-periodo');
  preflight('intervenciones/no-realizadas');
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
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/por-dia/detalle ?anio=&mes=&dia=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/mapa ?desde=&hasta=&id_facilitador=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/mapa/facilitadores ?desde=&hasta=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/realizadas ?anio=&meses= o ?desde=&hasta=&si_no=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/resumen-periodo ?desde=&hasta=&si_no=');
    DBMS_OUTPUT.PUT_LINE('       GET intervenciones/no-realizadas ?anio=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INTERVENCIONES_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_INTERVENCIONES_ETHOS'';');
    RETURN;
  END IF;

  ------------------------------------------------------------------------------
  -- EN QUE IDIOMA VE LA COLUMNA MES **ESTA** SESION.
  --
  -- Es la linea que hubiera ahorrado medio dia el 05/08/2026. La vista genera
  -- MES sin NLS, asi que su idioma es el de quien pregunta: corriendo este
  -- script desde SQL Workshop probablemente diga 'Agosto', y el mismo dato leido
  -- por ORDS decia 'August   '.
  --
  -- Si abajo ves nombres en ingles, NO es un problema — el paquete ya no usa esa
  -- columna para filtrar, justamente por esto. Se imprime como recordatorio de
  -- que ese texto no es confiable.
  ------------------------------------------------------------------------------
  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('       Columna MES tal como la ve ESTA sesion (informativo):');
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
  DBMS_OUTPUT.PUT_LINE('       (el paquete NO filtra por esta columna: usa'
                       || ' EXTRACT(MONTH FROM fecha_hora))');

  -- Cuantas superan el umbral en el mes en curso. Si da 0, el grafico va a
  -- salir vacio y NO es un bug: o no hay marcaciones, o todas fueron puntuales.
  BEGIN
    SELECT COUNT(*) INTO l_filas
      FROM v_historial_intervenciones
     WHERE anio = TO_CHAR(SYSDATE, 'YYYY')
       -- Por FECHA_HORA, igual que el paquete. Filtrar aca por la columna MES
       -- haria que este chequeo mienta: daria OK en SQL Workshop (español) sobre
       -- un filtro que en ORDS (ingles) no matchea nada.
       AND EXTRACT(MONTH FROM fecha_hora) = EXTRACT(MONTH FROM SYSDATE)
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
      DBMS_OUTPUT.PUT_LINE('               O no hay marcaciones cargadas, o todas cayeron');
      DBMS_OUTPUT.PUT_LINE('               dentro de los 15 minutos. Ya NO puede ser la');
      DBMS_OUTPUT.PUT_LINE('               grafia de MES: el filtro va por FECHA_HORA.');
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
