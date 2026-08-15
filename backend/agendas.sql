--------------------------------------------------------------------------------
-- AGENDAS  —  el horario semanal de los facilitadores
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET  agendas         ?anio=&manual=&id_facilitador=&id_institucion=
--                        &turno=&dia=&departamento=&ciudad=&buscar=&estado=
--                        &limite=&pagina=
--   GET  agendas/filtros ?anio=&dia=&departamento=&ciudad=&turno=
--                        &id_facilitador=&id_institucion=&manual=
--
-- El primero es el reporte. El segundo alimenta los combos de la pantalla: los
-- valores que EXISTEN en los datos (años, dias, departamentos, ciudades,
-- turnos, manuales, facilitadores, instituciones), que es lo que en APEX hacian
-- las facetas.
--
-- DEPARTAMENTO Y CIUDAD SALEN DE LA VISTA, POR NOMBRE. V_AGENDA los resuelve con
-- un outer join contra DEPARTAMENTOS y CIUDADES y expone solo `nombre`, no los
-- ids, asi que los filtros comparan texto con UPPER de los dos lados. Pueden ser
-- NULL cuando la institucion no los tiene cargados.
--
-- SOLO LECTURA. La agenda se arma desde POSTULACIONES; esta pantalla la
-- consulta, no la edita.
--
-- CORRER DESPUES de auth.sql (necesita el modulo ORDS 'ethos' y PKG_AUTH_ETHOS
-- para validar el token). NO depende del paquete de evaluaciones ni del de
-- intervenciones.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- DE DONDE SALE, Y QUE REEMPLAZA
--------------------------------------------------------------------------------
--
-- De la vista V_AGENDA, que ya existia en la base. ESTE SCRIPT NO LA CREA NI LA
-- MODIFICA: si algun dia cambia de forma, lo que se rompe es este paquete.
--
-- Es el equivalente de la pagina 30 ("Agendas") de la app APEX 40587, que era un
-- faceted search sobre la misma vista con este WHERE:
--
--   where nvl(estado,'Activo') <> 'Inactivo'
--
-- Se conserva TAL CUAL —ver `estado_ok`— incluido el NVL: una fila sin estado
-- cuenta como activa. El endpoint agrega `?estado=TODOS` para ver tambien las
-- inactivas, que en APEX no se podia.
--
--------------------------------------------------------------------------------
-- LOS DIAS VIENEN COMO "HH:MM, HH:MM" EN UNA SOLA COLUMNA
--------------------------------------------------------------------------------
--
-- Cada dia (LUNES..VIERNES) es un VARCHAR2 con las dos horas separadas por coma:
--
--   '06:40, 07:20'   la clase va de 06:40 a 07:20
--   ','              NO hay clase ese dia   <-- OJO
--
-- **El vacio es una coma sola, no NULL ni cadena vacia.** Es la trampa principal
-- de esta vista: un `dia IS NOT NULL` da TRUE para los cinco dias de todas las
-- filas, y el reporte saldria diciendo que cada facilitador da clases los cinco
-- dias. `f_hay_clase` es la unica forma correcta de preguntarlo.
--
-- '00:00, 00:00' tambien cuenta como SIN HORARIO. Aparece en filas viejas
-- cargadas sin horario real, y mostrarlo como "00:00 a 00:00" se lee como si la
-- clase fuera a medianoche.
--
-- El desarmado en `hora_desde` / `hora_hasta` se hace ACA y no en el front: son
-- dos columnas limpias, y asi el front no tiene que conocer el formato.
--
--------------------------------------------------------------------------------
-- UNA FILA ES UN DIA (verificado sobre los datos, 14/08/2026)
--------------------------------------------------------------------------------
--
-- En la practica cada fila de V_AGENDA tiene UN solo dia con horario y los otros
-- cuatro en ','. Por eso el endpoint expone `dia` / `hora_desde` / `hora_hasta`
-- ya resueltos: el front muestra "Lunes 06:40 a 07:20" sin recorrer cinco
-- columnas.
--
-- Igual NO se asume que sea siempre asi: `f_dias` devuelve TODOS los dias con
-- horario separados por coma, y `dia` es el primero. Si algun dia una fila trae
-- dos, el front lo muestra igual y no se pierde el dato.
--
--------------------------------------------------------------------------------
-- LOS GUIONES SON VACIOS, NO DATOS
--------------------------------------------------------------------------------
--
-- SECCION, ENFASIS e ID_MATERIA usan '-' como marcador de "sin cargar". Se
-- normalizan a NULL con `f_limpio` para que el front decida como mostrarlos, en
-- vez de que aparezca un guion suelto en medio de la tarjeta.
--
-- ID_MATERIA es la excepcion util: viene con el ID CRUDO (50) y no con la
-- descripcion —al reves que ENFASIS, que la vista ya resuelve—. Se resuelve con
-- un LEFT JOIN a MATERIAS. El JOIN es LEFT y no INNER a proposito: una
-- postulacion con una materia borrada tiene que seguir apareciendo en la agenda.
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
   WHERE object_name = 'V_AGENDA'
     AND object_type IN ('VIEW', 'SYNONYM');

  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe V_AGENDA.');
    DBMS_OUTPUT.PUT_LINE('        El paquete no va a compilar. Creala primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   V_AGENDA encontrada.');

    -- DEPARTAMENTO y CIUDAD se agregaron a la vista despues de la primera
    -- version de este script. Sin ellas el paquete no compila, y el error de
    -- Oracle ("identificador no valido") no dice que hay que actualizar la
    -- vista. Este chequeo si.
    SELECT COUNT(*) INTO l_n
      FROM all_tab_columns
     WHERE table_name  = 'V_AGENDA'
       AND column_name IN ('DEPARTAMENTO', 'CIUDAD');

    IF l_n < 2 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] V_AGENDA no tiene DEPARTAMENTO y CIUDAD.');
      DBMS_OUTPUT.PUT_LINE('        Es una version vieja de la vista: actualizala');
      DBMS_OUTPUT.PUT_LINE('        antes de correr esto, o el paquete no compila.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   V_AGENDA trae DEPARTAMENTO y CIUDAD.');
    END IF;
  END IF;

  -- MATERIAS es opcional: si no esta, el LEFT JOIN deja la descripcion en NULL
  -- y el reporte sigue funcionando con el id crudo.
  SELECT COUNT(*) INTO l_n
    FROM all_objects
   WHERE object_name = 'MATERIAS'
     AND object_type IN ('TABLE', 'VIEW', 'SYNONYM');

  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] No existe MATERIAS: la materia sale como id.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   MATERIAS encontrada.');
  END IF;
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_AGENDAS_ETHOS AS

  ------------------------------------------------------------------------------
  -- ESTAS CUATRO FUNCIONES VAN EN LA SPEC A PROPOSITO.
  --
  -- Se usan DENTRO del SELECT de `listar`, y una funcion declarada solo en el
  -- body no es visible para el motor SQL: da PLS-00231 y el paquete no compila.
  -- Es el mismo motivo por el que PKG_INTERVENCIONES_ETHOS publica f_coord y
  -- f_distancia.
  ------------------------------------------------------------------------------

  -- El texto de un dia ('06:40, 07:20') tiene un horario de verdad.
  FUNCTION f_hay_clase(p_dia IN VARCHAR2) RETURN NUMBER DETERMINISTIC;

  -- Una de las dos horas de un dia. 1 = desde, 2 = hasta. NULL si no hay clase.
  FUNCTION f_hora(p_dia IN VARCHAR2, p_cual IN NUMBER) RETURN VARCHAR2 DETERMINISTIC;

  -- Los nombres de los dias con clase, separados por coma. NULL si ninguno.
  FUNCTION f_dias(
      p_lu IN VARCHAR2, p_ma IN VARCHAR2, p_mi IN VARCHAR2,
      p_ju IN VARCHAR2, p_vi IN VARCHAR2
  ) RETURN VARCHAR2 DETERMINISTIC;

  -- '-' y '' pasan a NULL. Todo lo demas se devuelve con TRIM.
  FUNCTION f_limpio(p_texto IN VARCHAR2) RETURN VARCHAR2 DETERMINISTIC;

  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_manual         IN VARCHAR2 DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_turno          IN NUMBER   DEFAULT NULL,
      p_dia            IN VARCHAR2 DEFAULT NULL,
      p_departamento   IN VARCHAR2 DEFAULT NULL,
      p_ciudad         IN VARCHAR2 DEFAULT NULL,
      p_buscar         IN VARCHAR2 DEFAULT NULL,
      p_estado         IN VARCHAR2 DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL,
      p_pagina         IN NUMBER   DEFAULT NULL
  );

  PROCEDURE filtros(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_dia            IN VARCHAR2 DEFAULT NULL,
      p_departamento   IN VARCHAR2 DEFAULT NULL,
      p_ciudad         IN VARCHAR2 DEFAULT NULL,
      p_turno          IN NUMBER   DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_manual         IN VARCHAR2 DEFAULT NULL
  );

END PKG_AGENDAS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_AGENDAS_ETHOS AS

  ------------------------------------------------------------------------------
  -- El tope de filas por pagina.
  --
  -- Mas alto que en evaluaciones (200) porque aca NO hay agrupado por cabecera:
  -- una fila es una fila, y cortar en el medio no parte nada. 500 es un mes de
  -- agenda completo de una institucion grande.
  ------------------------------------------------------------------------------
  c_limite_defecto CONSTANT PLS_INTEGER := 100;
  c_limite_maximo  CONSTANT PLS_INTEGER := 500;

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
  -- Ver la nota larga en intervenciones.sql: emitir los headers dos veces deja
  -- la respuesta ilegible y el front la ve como "sin datos".
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

  -- El error cuando la respuesta YA se abrio y hay un array a medio escribir.
  -- Se cierra el array primero y el objeto despues: al reves APEX_JSON emite
  -- llaves cruzadas y el JSON no parsea.
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
  -- '-' Y '' SON VACIOS.
  --
  -- V_AGENDA usa el guion como marcador de "sin cargar" en SECCION, ENFASIS e
  -- ID_MATERIA. Devolverlo tal cual haria que el front muestre un guion suelto y
  -- que un `if (seccion)` de JavaScript lo tome como valor cargado.
  ------------------------------------------------------------------------------
  FUNCTION f_limpio(p_texto IN VARCHAR2) RETURN VARCHAR2 DETERMINISTIC IS
    l_t VARCHAR2(4000);
  BEGIN
    l_t := TRIM(p_texto);
    IF l_t IS NULL OR l_t = '-' THEN
      RETURN NULL;
    END IF;
    RETURN l_t;
  END f_limpio;

  ------------------------------------------------------------------------------
  -- ¿ESE DIA TIENE CLASE?  1 = si, 0 = no.
  --
  -- Devuelve NUMBER y no BOOLEAN porque se usa dentro del SELECT, y SQL no tiene
  -- tipo booleano: una funcion que devuelva BOOLEAN no se puede llamar desde una
  -- consulta.
  --
  -- Un dia sin clase es la cadena ',' —no NULL, no ''—, y ese es el caso que hay
  -- que atrapar. Tambien se descarta '00:00, 00:00', que son filas viejas sin
  -- horario real cargado.
  --
  -- Se exige que la PRIMERA parte tenga forma de hora en vez de solo mirar si
  -- hay algo distinto de coma: asi una fila con basura ('sin definir') tampoco
  -- cuenta como clase.
  ------------------------------------------------------------------------------
  FUNCTION f_hay_clase(p_dia IN VARCHAR2) RETURN NUMBER DETERMINISTIC IS
    l_desde VARCHAR2(20);
    l_hasta VARCHAR2(20);
  BEGIN
    IF p_dia IS NULL THEN RETURN 0; END IF;

    l_desde := TRIM(REGEXP_SUBSTR(p_dia, '[^,]+', 1, 1));
    l_hasta := TRIM(REGEXP_SUBSTR(p_dia, '[^,]+', 1, 2));

    IF l_desde IS NULL OR NOT REGEXP_LIKE(l_desde, '^\d{1,2}:\d{2}$') THEN
      RETURN 0;
    END IF;

    -- '00:00, 00:00' = sin horario cargado. Con una sola de las dos en 00:00 no
    -- alcanza: una clase que empieza 00:00 y termina 07:20 es dato malo, pero
    -- una que termina 00:00 podria ser un turno noche mal cerrado, y descartarla
    -- escondería la fila. Solo se descarta cuando las DOS estan en cero.
    IF l_desde = '00:00' AND NVL(l_hasta, '00:00') = '00:00' THEN
      RETURN 0;
    END IF;

    RETURN 1;
  END f_hay_clase;

  ------------------------------------------------------------------------------
  -- UNA de las dos horas. 1 = desde, 2 = hasta.
  --
  -- NULL si ese dia no tiene clase, asi el front no tiene que volver a
  -- preguntarlo: si `hora_desde` vino, hay clase.
  --
  -- DEVUELVE SIEMPRE 'HH:MM' CON DOS DIGITOS, y eso NO es cosmetico: el
  -- ORDER BY de `listar` ordena por este texto, y como texto '6:40' es MAYOR
  -- que '13:00' —compara '6' contra '1'—. Una fila cargada sin el cero
  -- adelante saldria al final del reporte sin ningun error a la vista.
  --
  -- El patron de `f_hay_clase` acepta \d{1,2} a proposito (hay datos viejos
  -- cargados asi); el relleno se hace aca, en el unico lugar por donde salen
  -- las horas.
  ------------------------------------------------------------------------------
  FUNCTION f_hora(p_dia IN VARCHAR2, p_cual IN NUMBER) RETURN VARCHAR2 DETERMINISTIC IS
    l_parte VARCHAR2(20);
  BEGIN
    IF f_hay_clase(p_dia) = 0 THEN
      RETURN NULL;
    END IF;

    l_parte := TRIM(REGEXP_SUBSTR(p_dia, '[^,]+', 1, p_cual));

    -- La hora de fin puede faltar ('06:40,'): ahi el front muestra solo la de
    -- inicio, que es mejor que inventar una.
    IF l_parte IS NULL OR NOT REGEXP_LIKE(l_parte, '^\d{1,2}:\d{2}$') THEN
      RETURN NULL;
    END IF;

    -- El cero adelante cuando vino una sola cifra ('6:40' -> '06:40'). Ver la
    -- nota del encabezado: sin esto el ORDER BY manda la fila al final.
    IF INSTR(l_parte, ':') = 2 THEN
      l_parte := '0' || l_parte;
    END IF;

    RETURN l_parte;
  END f_hora;

  ------------------------------------------------------------------------------
  -- LOS DIAS CON CLASE, separados por coma: 'Lunes' o 'Lunes,Miercoles'.
  --
  -- En los datos de hoy siempre da UN dia (ver el encabezado del script), pero
  -- se arma la lista completa igual: si alguna fila trae dos, el front los
  -- muestra los dos en vez de perder uno en silencio.
  --
  -- Sin tildes a proposito: es una clave para comparar y filtrar, no un texto
  -- para mostrar. El front pone 'Miércoles' con tilde en la UI.
  ------------------------------------------------------------------------------
  FUNCTION f_dias(
      p_lu IN VARCHAR2, p_ma IN VARCHAR2, p_mi IN VARCHAR2,
      p_ju IN VARCHAR2, p_vi IN VARCHAR2
  ) RETURN VARCHAR2 DETERMINISTIC IS
    l_out VARCHAR2(200);

    PROCEDURE sumar(p_dia IN VARCHAR2, p_nombre IN VARCHAR2) IS
    BEGIN
      IF f_hay_clase(p_dia) = 1 THEN
        l_out := CASE WHEN l_out IS NULL THEN p_nombre ELSE l_out || ',' || p_nombre END;
      END IF;
    END sumar;
  BEGIN
    sumar(p_lu, 'Lunes');
    sumar(p_ma, 'Martes');
    sumar(p_mi, 'Miercoles');
    sumar(p_ju, 'Jueves');
    sumar(p_vi, 'Viernes');
    RETURN l_out;
  END f_dias;

  ------------------------------------------------------------------------------
  -- LISTAR: el reporte.
  --
  -- EL WHERE DE ESTADO ES EL DE LA PAGINA 30, TAL CUAL:
  --
  --   nvl(estado,'Activo') <> 'Inactivo'
  --
  -- El NVL importa: una fila con el estado sin cargar cuenta como ACTIVA. Si se
  -- cambiara por `estado = 'Activo'`, esas filas desaparecerian del reporte sin
  -- que nadie lo pida.
  --
  -- `?estado=TODOS` apaga el filtro y trae tambien las inactivas. Es lo unico
  -- que este endpoint hace y la pagina de APEX no podia.
  --
  -- EL ORDEN ES POR HORA DE INICIO, y ahi se aparta del reporte original, que
  -- ordenaba por turno y despues por los cinco dias. Ver la nota sobre el
  -- ORDER BY, mas abajo: con el turno primero la lista se leia con el horario
  -- yendo y volviendo. El nombre del facilitador y el id de postulacion cierran
  -- el orden para que no baile entre dos consultas iguales — sin un desempate
  -- estable, la paginacion repetiria o saltearia filas.
  ------------------------------------------------------------------------------
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_manual         IN VARCHAR2 DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_turno          IN NUMBER   DEFAULT NULL,
      p_dia            IN VARCHAR2 DEFAULT NULL,
      p_departamento   IN VARCHAR2 DEFAULT NULL,
      p_ciudad         IN VARCHAR2 DEFAULT NULL,
      p_buscar         IN VARCHAR2 DEFAULT NULL,
      p_estado         IN VARCHAR2 DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL,
      p_pagina         IN NUMBER   DEFAULT NULL
  ) IS
    l_usuario   VARCHAR2(255);
    l_anio      VARCHAR2(4);
    l_manual    VARCHAR2(100);
    l_dia       VARCHAR2(20);
    l_depto     VARCHAR2(200);
    l_ciudad    VARCHAR2(200);
    l_buscar    VARCHAR2(200);
    l_todos     BOOLEAN;
    l_tope      PLS_INTEGER;
    l_pagina    PLS_INTEGER;
    l_offset    PLS_INTEGER;
    l_total     PLS_INTEGER := 0;
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    --------------------------------------------------------------------------
    -- EL AÑO: el pedido, o el LECTIVO ACTIVO. 'TODOS' lo apaga.
    --
    -- Aca SI se usa FN_ANIO_LECTIVO_ACTUAL() —al reves que en intervenciones,
    -- que usa el año del reloj— porque es lo que hacia la faceta P30_ANIO de la
    -- pagina 30: su default era exactamente esa funcion. La agenda es una
    -- operacion del año lectivo, no un historial.
    --
    -- Si no hay año activo, la funcion devuelve NULL y el filtro se apaga solo:
    -- una tabla de configuracion sin cargar no puede dejar el reporte vacio.
    --------------------------------------------------------------------------
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      l_anio := TRIM(p_anio);
    ELSE
      BEGIN
        l_anio := TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
      EXCEPTION
        WHEN OTHERS THEN l_anio := NULL;
      END;
    END IF;

    l_manual := f_limpio(p_manual);
    l_dia    := f_limpio(p_dia);
    -- Departamento y ciudad viajan por NOMBRE y no por id: la vista expone solo
    -- el nombre (`de.nombre`, `ci.nombre`), no las claves. Volver a la
    -- institucion para sacar el id seria un join de mas para el mismo filtro.
    l_depto  := f_limpio(p_departamento);
    l_ciudad := f_limpio(p_ciudad);
    l_buscar := f_limpio(p_buscar);
    l_todos  := (UPPER(TRIM(p_estado)) = 'TODOS');

    l_tope   := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);
    l_pagina := GREATEST(NVL(p_pagina, 1), 1);
    l_offset := (l_pagina - 1) * l_tope;

    --------------------------------------------------------------------------
    -- EL TOTAL SE CUENTA APARTE, ANTES DE ABRIR EL JSON.
    --
    -- Tiene que ser el total SIN paginar: es lo que le dice al front "hay 340,
    -- estas viendo 100". Contarlo despues de abrir la respuesta obligaria a
    -- reescribirlo al final, que APEX_JSON no permite.
    --
    -- Es una segunda pasada sobre la vista, y es aceptable: V_AGENDA son miles
    -- de filas, no cientos de miles. Si algun dia molesta, la salida es un
    -- COUNT(*) OVER () en la consulta principal.
    --------------------------------------------------------------------------
    BEGIN
      SELECT COUNT(*)
        INTO l_total
        FROM v_agenda v
       WHERE (l_todos OR NVL(v.estado, 'Activo') <> 'Inactivo')
         AND (l_anio   IS NULL OR v.anio = l_anio)
         AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
         AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
         AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
         AND (p_turno IS NULL OR v.turno = p_turno)
         AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
         AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
         AND (l_dia IS NULL
              OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                           v.jueves, v.viernes) || ','),
                       UPPER(',' || l_dia || ',')) > 0)
         AND (l_buscar IS NULL
              OR UPPER(v.nombre_facilitador || ' ' || v.nombre_institucion || ' '
                       || v.grado || ' ' || v.nombre_profesor || ' ' || v.manual
                       || ' ' || v.ciudad)
                 LIKE '%' || UPPER(l_buscar) || '%');
    EXCEPTION
      WHEN OTHERS THEN l_total := 0;
    END;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    -- Los filtros TAL COMO SE APLICARON, no como los mando el front. Si el
    -- reporte sale vacio, esto dice contra que se comparo.
    APEX_JSON.WRITE('anio',    l_anio);
    APEX_JSON.WRITE('manual',  l_manual);
    APEX_JSON.WRITE('dia',     l_dia);
    APEX_JSON.WRITE('departamento', l_depto);
    APEX_JSON.WRITE('ciudad',  l_ciudad);
    APEX_JSON.WRITE('estado',  CASE WHEN l_todos THEN 'TODOS' ELSE 'ACTIVOS' END);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_tope);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        SELECT v.id_facilitador,
               v.nombre_facilitador,
               v.id_institucion,
               v.nombre_institucion,
               v.turno,
               v.grado,
               f_limpio(v.seccion)         AS seccion,
               v.nombre_profesor,
               v.id_enfasis,
               f_limpio(v.enfasis)         AS enfasis,
               -- El id crudo, ya limpio del '-'. Se devuelve ademas de la
               -- descripcion por si el front necesita filtrar por el.
               TO_NUMBER(f_limpio(v.id_materia)) AS id_materia,
               m.descripcion               AS materia,
               v.manual,
               v.estado,
               v.id_postulacion,
               v.usuario,
               v.anio,
               -- Donde queda la institucion. Salen de la vista ya resueltos por
               -- outer join contra DEPARTAMENTOS y CIUDADES, asi que pueden ser
               -- NULL si la institucion no los tiene cargados.
               v.departamento,
               v.ciudad,
               -- Los cinco dias, ya desarmados. Ver el encabezado del script.
               f_dias(v.lunes, v.martes, v.miercoles, v.jueves, v.viernes) AS dias,
               f_hora(v.lunes, 1) AS lunes_desde,     f_hora(v.lunes, 2) AS lunes_hasta,
               f_hora(v.martes, 1) AS martes_desde,   f_hora(v.martes, 2) AS martes_hasta,
               f_hora(v.miercoles, 1) AS miercoles_desde,
               f_hora(v.miercoles, 2) AS miercoles_hasta,
               f_hora(v.jueves, 1) AS jueves_desde,   f_hora(v.jueves, 2) AS jueves_hasta,
               f_hora(v.viernes, 1) AS viernes_desde, f_hora(v.viernes, 2) AS viernes_hasta
          FROM v_agenda v
          -- LEFT y no INNER: una postulacion con la materia borrada tiene que
          -- seguir apareciendo en la agenda, con la materia en null.
          --
          -- El TO_NUMBER va sobre f_limpio y no sobre la columna: ID_MATERIA
          -- trae '-' cuando no hay materia, y TO_NUMBER('-') es ORA-01722, que
          -- tumbaria la consulta entera en vez de dejar esa fila sin materia.
          LEFT JOIN materias m ON m.id_materia = TO_NUMBER(f_limpio(v.id_materia))
         WHERE (l_todos OR NVL(v.estado, 'Activo') <> 'Inactivo')
           AND (l_anio   IS NULL OR v.anio = l_anio)
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (p_turno IS NULL OR v.turno = p_turno)
           -- Por NOMBRE, con UPPER de los dos lados: la vista no expone los ids
           -- de departamento ni de ciudad.
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
           -- El dia se compara contra la lista rodeada de comas para que
           -- 'Lunes' no matchee dentro de otro nombre.
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
           -- Mismo criterio que el buscador de la pagina 30 (P30_SEARCH), que
           -- barria facilitador, institucion, grado y los dias. Se cambian los
           -- dias por docente, manual y ciudad: buscar '07:00' no es lo que
           -- nadie hace, y el nombre del docente o de la ciudad si.
           AND (l_buscar IS NULL
                OR UPPER(v.nombre_facilitador || ' ' || v.nombre_institucion || ' '
                         || v.grado || ' ' || v.nombre_profesor || ' ' || v.manual
                         || ' ' || v.ciudad)
                   LIKE '%' || UPPER(l_buscar) || '%')
         --------------------------------------------------------------------
         -- ORDENA POR **HORA DE INICIO**, NO POR TURNO.
         --
         -- El turno estaba primero y era peor: agrupaba las filas en tres
         -- bloques y la hora solo ordenaba DENTRO de cada uno, asi que un 07:00
         -- del turno tarde salia antes que un 13:00 del turno mañana. Leido de
         -- corrido, el horario iba y volvia.
         --
         -- Con la hora primero la lista se lee como una agenda de verdad: de la
         -- primera clase del dia a la ultima, sin importar como este clasificado
         -- el turno. El turno queda como desempate, para las filas que empiezan
         -- a la misma hora.
         --
         -- COALESCE y no los cinco campos sueltos como el reporte de APEX, que
         -- ordenaba por 'LUNES' y dejaba juntas las filas de martes sin criterio:
         -- una fila es un dia, asi que el primer valor no nulo es SU hora.
         --
         -- NULLS LAST: las filas sin horario cargado van al final. Son datos
         -- incompletos y encabezar el reporte con ellas esconderia la primera
         -- clase real debajo.
         --
         -- El orden es sobre el texto 'HH:MM', que para horas de dos digitos
         -- coincide con el orden cronologico ('06:40' < '13:00'). No hace falta
         -- TO_DATE: f_hora ya garantizo el formato, y convertir cada fila seria
         -- un TO_DATE por fila para el mismo resultado.
         --------------------------------------------------------------------
         ORDER BY COALESCE(f_hora(v.lunes, 1), f_hora(v.martes, 1),
                           f_hora(v.miercoles, 1), f_hora(v.jueves, 1),
                           f_hora(v.viernes, 1)) NULLS LAST,
                  v.turno,
                  v.nombre_facilitador,
                  -- Desempate final: sin una columna unica, dos filas iguales en
                  -- todo lo anterior pueden salir en distinto orden en cada
                  -- consulta y la paginacion repetiria o saltearia filas.
                  v.id_postulacion
         OFFSET l_offset ROWS FETCH NEXT l_tope ROWS ONLY
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_postulacion',     r.id_postulacion);
      APEX_JSON.WRITE('id_facilitador',     r.id_facilitador);
      APEX_JSON.WRITE('nombre_facilitador', r.nombre_facilitador);
      APEX_JSON.WRITE('usuario',            r.usuario);
      APEX_JSON.WRITE('id_institucion',     r.id_institucion);
      APEX_JSON.WRITE('nombre_institucion', r.nombre_institucion);
      APEX_JSON.WRITE('turno',              r.turno);
      APEX_JSON.WRITE('grado',              r.grado);
      APEX_JSON.WRITE('seccion',            r.seccion);
      APEX_JSON.WRITE('nombre_profesor',    r.nombre_profesor);
      APEX_JSON.WRITE('id_enfasis',         r.id_enfasis);
      APEX_JSON.WRITE('enfasis',            r.enfasis);
      APEX_JSON.WRITE('id_materia',         r.id_materia);
      APEX_JSON.WRITE('materia',            r.materia);
      APEX_JSON.WRITE('manual',             r.manual);
      APEX_JSON.WRITE('estado',             r.estado);
      APEX_JSON.WRITE('anio',               r.anio);
      APEX_JSON.WRITE('departamento',       r.departamento);
      APEX_JSON.WRITE('ciudad',             r.ciudad);
      -- Los dias con clase, listos para mostrar: 'Lunes' o 'Lunes,Miercoles'.
      APEX_JSON.WRITE('dias',               r.dias);
      -- Y las horas dia por dia, para la grilla semanal. NULL = sin clase.
      APEX_JSON.WRITE('lunes_desde',        r.lunes_desde);
      APEX_JSON.WRITE('lunes_hasta',        r.lunes_hasta);
      APEX_JSON.WRITE('martes_desde',       r.martes_desde);
      APEX_JSON.WRITE('martes_hasta',       r.martes_hasta);
      APEX_JSON.WRITE('miercoles_desde',    r.miercoles_desde);
      APEX_JSON.WRITE('miercoles_hasta',    r.miercoles_hasta);
      APEX_JSON.WRITE('jueves_desde',       r.jueves_desde);
      APEX_JSON.WRITE('jueves_hasta',       r.jueves_hasta);
      APEX_JSON.WRITE('viernes_desde',      r.viernes_desde);
      APEX_JSON.WRITE('viernes_hasta',      r.viernes_hasta);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      -- `p_error_tardio` y NO `p_error`: la respuesta ya se abrio mas arriba.
      p_error_tardio('Error: ' || SQLERRM);
  END listar;

  ------------------------------------------------------------------------------
  -- FILTROS: los valores que EXISTEN en los datos.
  --
  -- Es lo que en APEX hacian las facetas, que se llenaban solas con los valores
  -- presentes. Sin esto el front tendria que ofrecer combos con todos los
  -- facilitadores y todas las instituciones de la base, incluidas las que no
  -- tienen ni una agenda cargada: elegir una daria un reporte vacio.
  --
  -- Van los CUATRO grupos en UNA sola respuesta y no en cuatro endpoints porque
  -- la pantalla los necesita a los cuatro juntos al abrirse: cuatro llamadas
  -- serian cuatro round-trips para pintar una fila de filtros.
  --
  -- SIEMPRE respeta el filtro de estado activo, igual que `listar`: un manual
  -- que solo aparece en filas inactivas no tiene por que ofrecerse.
  --
  ------------------------------------------------------------------------------
  -- LA CASCADA: CADA COMBO SE RECORTA CON LOS **OTROS** FILTROS
  ------------------------------------------------------------------------------
  --
  -- Elegido el martes, el combo de facilitadores ofrece solo a los que dan clase
  -- el martes. Elegido ademas un facilitador, el de instituciones ofrece solo
  -- donde ESE facilitador da clase ese dia. Es lo que hacian las facetas de
  -- APEX, que recalculaban sus conteos con cada seleccion.
  --
  -- **CADA COMBO SE EXCLUYE A SI MISMO DEL FILTRO.** Es la regla que hace que la
  -- cascada funcione y la parte que no es obvia:
  --
  --   El combo de facilitadores NO se filtra por `p_id_facilitador`.
  --
  -- Si se filtrara, al elegir un facilitador la lista quedaria con un solo
  -- elemento —el ya elegido— y no habria forma de cambiarlo sin limpiar el
  -- filtro primero. Lo mismo con institucion y manual. Es el mismo motivo por el
  -- que `anios` ignora `l_anio`, solo que aplicado a los cuatro.
  ------------------------------------------------------------------------------
  PROCEDURE filtros(
      p_token          IN VARCHAR2,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_dia            IN VARCHAR2 DEFAULT NULL,
      p_departamento   IN VARCHAR2 DEFAULT NULL,
      p_ciudad         IN VARCHAR2 DEFAULT NULL,
      p_turno          IN NUMBER   DEFAULT NULL,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_manual         IN VARCHAR2 DEFAULT NULL
  ) IS
    l_usuario VARCHAR2(255);
    l_anio    VARCHAR2(4);
    l_dia     VARCHAR2(20);
    l_depto   VARCHAR2(200);
    l_ciudad  VARCHAR2(200);
    l_manual  VARCHAR2(100);
  BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN;
    END IF;

    -- Mismo criterio de año que `listar`, para que los combos ofrezcan
    -- exactamente lo que el reporte va a poder mostrar.
    IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
      l_anio := NULL;
    ELSIF TRIM(p_anio) IS NOT NULL THEN
      l_anio := TRIM(p_anio);
    ELSE
      BEGIN
        l_anio := TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
      EXCEPTION
        WHEN OTHERS THEN l_anio := NULL;
      END;
    END IF;

    l_dia    := f_limpio(p_dia);
    l_depto  := f_limpio(p_departamento);
    l_ciudad := f_limpio(p_ciudad);
    l_manual := f_limpio(p_manual);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    -- Los filtros TAL COMO SE APLICARON. Si un combo sale vacio, esto dice cual
    -- de los otros lo dejo sin opciones.
    APEX_JSON.WRITE('anio',         l_anio);
    APEX_JSON.WRITE('dia',          l_dia);
    APEX_JSON.WRITE('departamento', l_depto);
    APEX_JSON.WRITE('ciudad',       l_ciudad);
    APEX_JSON.WRITE('turno',        p_turno);
    APEX_JSON.WRITE('manual',       l_manual);

    ----------------------------------------------------------------------------
    -- LOS AÑOS **NO** SE FILTRAN POR NADA.
    --
    -- Ni por año —si se filtrara, la lista tendria un solo elemento y no habria
    -- forma de cambiarlo— ni por el resto de los filtros: el año es el filtro
    -- MAS EXTERNO de la pantalla, el que decide sobre que universo se aplican
    -- los demas. Recortarlo con un dia o un facilitador invertiria la jerarquia
    -- y podria esconder un año entero porque el facilitador elegido no daba
    -- clase en el.
    ----------------------------------------------------------------------------
    APEX_JSON.OPEN_ARRAY('anios');
    FOR r IN (
        SELECT DISTINCT anio
          FROM v_agenda
         WHERE NVL(estado, 'Activo') <> 'Inactivo'
           AND anio IS NOT NULL
         ORDER BY anio DESC
    ) LOOP
      APEX_JSON.WRITE(r.anio);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    ----------------------------------------------------------------------------
    -- LOS DIAS: cuales tienen al menos una clase con los filtros de abajo.
    --
    -- Se calcula con cinco EXISTS y no con un DISTINCT sobre `f_dias` porque una
    -- fila puede tener mas de un dia: el DISTINCT devolveria la combinacion
    -- ('Lunes,Miercoles') como si fuera un valor, y el combo mostraria esa
    -- cadena en vez de los dos dias por separado.
    --
    -- NO se filtra por `l_dia` (ver la nota de la cascada), asi que cambiar de
    -- dia siempre es posible.
    ----------------------------------------------------------------------------
    APEX_JSON.OPEN_ARRAY('dias');
    FOR r IN (
        SELECT d.nombre
          FROM (SELECT 1 AS orden, 'Lunes'     AS nombre FROM dual UNION ALL
                SELECT 2, 'Martes'     FROM dual UNION ALL
                SELECT 3, 'Miercoles'  FROM dual UNION ALL
                SELECT 4, 'Jueves'     FROM dual UNION ALL
                SELECT 5, 'Viernes'    FROM dual) d
         WHERE EXISTS (
                 SELECT 1
                   FROM v_agenda v
                  WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
                    AND (l_anio  IS NULL OR v.anio = l_anio)
                    AND (p_turno IS NULL OR v.turno = p_turno)
                    AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
                    AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
                    AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
                    AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
                    AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
                    AND INSTR(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                            v.jueves, v.viernes) || ',',
                              ',' || d.nombre || ',') > 0)
         ORDER BY d.orden
    ) LOOP
      APEX_JSON.WRITE(r.nombre);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    ----------------------------------------------------------------------------
    -- LOS DEPARTAMENTOS con agenda cargada.
    --
    -- NO se filtra por `l_depto` (se excluye a si mismo) NI por `l_ciudad`, y lo
    -- segundo es lo que no es obvio: la ciudad es MAS especifica que el
    -- departamento, asi que filtrar por ella dejaria un solo departamento —el
    -- que la contiene— y cambiar de departamento seria imposible sin limpiar la
    -- ciudad antes. La jerarquia manda: departamento primero, ciudad despues.
    ----------------------------------------------------------------------------
    APEX_JSON.OPEN_ARRAY('departamentos');
    FOR r IN (
        SELECT DISTINCT v.departamento
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.departamento IS NOT NULL
           AND (l_anio  IS NULL OR v.anio = l_anio)
           AND (p_turno IS NULL OR v.turno = p_turno)
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.departamento
    ) LOOP
      APEX_JSON.WRITE(r.departamento);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    ----------------------------------------------------------------------------
    -- LAS CIUDADES, recortadas por el departamento: es LA cascada geografica.
    --
    -- Elegido un departamento, este combo trae solo sus ciudades. Sin eso, un
    -- combo con todas las ciudades del pais obligaria a buscar la que
    -- corresponde entre cientos, que es justo lo que el departamento vino a
    -- evitar.
    --
    -- Se excluye a si misma (no filtra por `l_ciudad`), como todos los demas.
    ----------------------------------------------------------------------------
    APEX_JSON.OPEN_ARRAY('ciudades');
    FOR r IN (
        SELECT DISTINCT v.ciudad
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.ciudad IS NOT NULL
           AND (l_anio  IS NULL OR v.anio = l_anio)
           AND (p_turno IS NULL OR v.turno = p_turno)
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.ciudad
    ) LOOP
      APEX_JSON.WRITE(r.ciudad);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    ----------------------------------------------------------------------------
    -- LOS TURNOS presentes. Van como numero crudo (1/2/3): la etiqueta la pone
    -- el front, que ya tiene la tabla en `lib/evaluaciones.ts`.
    ----------------------------------------------------------------------------
    APEX_JSON.OPEN_ARRAY('turnos');
    FOR r IN (
        SELECT DISTINCT v.turno
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.turno IS NOT NULL
           AND (l_anio IS NULL OR v.anio = l_anio)
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.turno
    ) LOOP
      APEX_JSON.WRITE(r.turno);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('manuales');
    FOR r IN (
        SELECT DISTINCT v.manual
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.manual IS NOT NULL
           AND (l_anio  IS NULL OR v.anio = l_anio)
           AND (p_turno IS NULL OR v.turno = p_turno)
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.manual
    ) LOOP
      APEX_JSON.WRITE(r.manual);
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Facilitadores e instituciones van como objetos {id, nombre}: el front
    -- filtra por id, no por nombre. Dos facilitadores homonimos son dos filas
    -- distintas y filtrar por texto los mezclaria.
    APEX_JSON.OPEN_ARRAY('facilitadores');
    FOR r IN (
        SELECT DISTINCT v.id_facilitador, v.nombre_facilitador
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.id_facilitador IS NOT NULL
           AND (l_anio  IS NULL OR v.anio = l_anio)
           AND (p_turno IS NULL OR v.turno = p_turno)
           AND (p_id_institucion IS NULL OR v.id_institucion = p_id_institucion)
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.nombre_facilitador
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',     r.id_facilitador);
      APEX_JSON.WRITE('nombre', r.nombre_facilitador);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('instituciones');
    FOR r IN (
        SELECT DISTINCT v.id_institucion, v.nombre_institucion
          FROM v_agenda v
         WHERE NVL(v.estado, 'Activo') <> 'Inactivo'
           AND v.id_institucion IS NOT NULL
           AND (l_anio  IS NULL OR v.anio = l_anio)
           AND (p_turno IS NULL OR v.turno = p_turno)
           AND (p_id_facilitador IS NULL OR v.id_facilitador = p_id_facilitador)
           -- La institucion cuelga de la geografia: elegido un departamento o
           -- una ciudad, solo se ofrecen las de ahi.
           AND (l_depto  IS NULL OR UPPER(v.departamento) = UPPER(l_depto))
           AND (l_ciudad IS NULL OR UPPER(v.ciudad) = UPPER(l_ciudad))
           AND (l_manual IS NULL OR UPPER(v.manual) = UPPER(l_manual))
           AND (l_dia IS NULL
                OR INSTR(UPPER(',' || f_dias(v.lunes, v.martes, v.miercoles,
                                             v.jueves, v.viernes) || ','),
                         UPPER(',' || l_dia || ',')) > 0)
         ORDER BY v.nombre_institucion
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',     r.id_institucion);
      APEX_JSON.WRITE('nombre', r.nombre_institucion);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error_tardio('Error: ' || SQLERRM);
  END filtros;

END PKG_AGENDAS_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) HANDLERS ORDS =======================================================
--------------------------------------------------------------------------------
--
-- Se AGREGAN al modulo 'ethos' que creo auth.sql. Este script NO define el
-- modulo ni habilita el esquema: redefinirlos cambiaria la URL base de todo lo
-- que ya esta publicado.
--
-- OJO CON ORDS.DEFINE_PARAMETER DEL HEADER: si falta, :authorization llega NULL
-- y TODO responde "Token invalido o expirado" aunque el login haya dado un token
-- bueno. Es el error que mas tiempo cuesta. Va UNA VEZ POR HANDLER.
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_ords_modules WHERE name = 'ethos';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe el modulo ORDS ethos. Corre backend/auth.sql.');
    RAISE_APPLICATION_ERROR(-20001, 'Falta el modulo ethos');
  END IF;
END;
/

BEGIN
  ----------------------------------------------------------------------------
  -- agendas  ?anio=&manual=&id_facilitador=&id_institucion=&turno=&dia=
  --          &buscar=&estado=&limite=&pagina=
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'agendas',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'agendas',
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
    PKG_AGENDAS_ETHOS.LISTAR(
        p_token          => l_token,
        p_anio           => :anio,
        p_manual         => :manual,
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_id_institucion => TO_NUMBER(:id_institucion),
        p_turno          => TO_NUMBER(:turno),
        -- El nombre del dia SIN tilde: 'Miercoles'. Ver f_dias.
        p_dia            => :dia,
        -- Por NOMBRE: la vista no expone los ids de departamento ni de ciudad.
        p_departamento   => :departamento,
        p_ciudad         => :ciudad,
        p_buscar         => :buscar,
        p_estado         => :estado,
        p_limite         => TO_NUMBER(:limite),
        p_pagina         => TO_NUMBER(:pagina));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'agendas',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- agendas/filtros  ?anio=
  --
  -- Prioridad 1, MAS ALTA que 'agendas' (0): ORDS evalua por prioridad y sin
  -- esto la ruta con barra podria caer en el handler generico.
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'agendas/filtros',
        p_priority    => 1,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'agendas/filtros',
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
    PKG_AGENDAS_ETHOS.FILTROS(
        p_token          => l_token,
        p_anio           => :anio,
        -- La cascada: cada combo se recorta con los OTROS filtros elegidos.
        -- Ver la nota larga sobre por que cada uno se excluye a si mismo.
        p_dia            => :dia,
        p_departamento   => :departamento,
        p_ciudad         => :ciudad,
        p_turno          => TO_NUMBER(:turno),
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_id_institucion => TO_NUMBER(:id_institucion),
        p_manual         => :manual);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'agendas/filtros',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de agendas publicados.');
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
  preflight('agendas');
  preflight('agendas/filtros');
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
  l_anio   VARCHAR2(4);
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_AGENDAS_ETHOS'
     AND object_type = 'PACKAGE BODY';

  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AGENDAS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET agendas ?anio=&manual=&id_facilitador=&id_institucion=');
    DBMS_OUTPUT.PUT_LINE('                   &turno=&dia=&departamento=&ciudad=&buscar=');
    DBMS_OUTPUT.PUT_LINE('                   &estado=&limite=&pagina=');
    DBMS_OUTPUT.PUT_LINE('       GET agendas/filtros ?anio=&dia=&departamento=&ciudad=');
    DBMS_OUTPUT.PUT_LINE('                           &turno=&id_facilitador=&id_institucion=&manual=');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AGENDAS_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        SELECT * FROM user_errors WHERE name = ''PKG_AGENDAS_ETHOS'';');
    RETURN;
  END IF;

  ------------------------------------------------------------------------------
  -- CUANTAS FILAS VA A DEVOLVER EL REPORTE POR DEFECTO.
  --
  -- Si da 0 y el año activo tiene filas, el problema es el filtro de año. Se
  -- imprimen los dos numeros para poder distinguirlo sin ir a la base.
  ------------------------------------------------------------------------------
  BEGIN
    l_anio := TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('       Año lectivo activo: ' || NVL(l_anio, '(ninguno)'));

    SELECT COUNT(*) INTO l_filas
      FROM v_agenda
     WHERE NVL(estado, 'Activo') <> 'Inactivo';
    DBMS_OUTPUT.PUT_LINE('       Filas activas en V_AGENDA (todos los años): ' || l_filas);

    IF l_anio IS NOT NULL THEN
      SELECT COUNT(*) INTO l_filas
        FROM v_agenda
       WHERE NVL(estado, 'Activo') <> 'Inactivo'
         AND anio = l_anio;
      DBMS_OUTPUT.PUT_LINE('       Filas activas del año ' || l_anio || ': ' || l_filas);
      IF l_filas = 0 THEN
        DBMS_OUTPUT.PUT_LINE('       [AVISO] El reporte va a salir vacio por defecto.');
        DBMS_OUTPUT.PUT_LINE('               Probar con ?anio=TODOS para confirmarlo.');
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] No se pudo contar: ' || SQLERRM);
  END;

  ------------------------------------------------------------------------------
  -- EL DESARMADO DE LOS DIAS, sobre datos reales.
  --
  -- Es la linea que confirma que f_hay_clase esta atrapando bien el ',' vacio.
  -- Si aca aparecieran cinco dias en todas las filas, el filtro esta roto.
  ------------------------------------------------------------------------------
  BEGIN
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('       Distribucion por dia (informativo):');
    FOR r IN (
        SELECT PKG_AGENDAS_ETHOS.F_DIAS(lunes, martes, miercoles, jueves, viernes) AS dias,
               COUNT(*) AS n
          FROM v_agenda
         WHERE NVL(estado, 'Activo') <> 'Inactivo'
         GROUP BY PKG_AGENDAS_ETHOS.F_DIAS(lunes, martes, miercoles, jueves, viernes)
         ORDER BY n DESC
         FETCH FIRST 10 ROWS ONLY
    ) LOOP
      DBMS_OUTPUT.PUT_LINE('         ' || RPAD(NVL(r.dias, '(sin horario)'), 30)
                           || r.n || ' filas');
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('       [AVISO] No se pudo agrupar: ' || SQLERRM);
  END;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_AGENDAS_ETHOS no se creo.');
END;
/
