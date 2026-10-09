--------------------------------------------------------------------------------
-- ANIOS_LECTIVOS  —  el año lectivo activo como dato, no como convencion
--------------------------------------------------------------------------------
--
-- QUE HACE ESTE SCRIPT
--
--   1. Crea ANIOS_LECTIVOS si no existe (idempotente: se puede correr de nuevo).
--   2. (Re)crea FN_ANIO_LECTIVO_ACTUAL, que resuelve el año vigente leyendo esa
--      tabla.
--   3. (Desde el 09/10/2026) El ABM de la pantalla /anios-lectivos: paquete
--      PKG_ANIOS_LECTIVOS_ETHOS y los endpoints anios-lectivos[/:id]. Ver "ABM
--      DE AÑOS LECTIVOS" al final.
--
-- CORRER **ANTES** de evaluaciones_facilitadores.sql: el paquete de
-- evaluaciones llama a la funcion, y si no existe no compila.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
--------------------------------------------------------------------------------
-- POR QUE LA FUNCION SE (RE)CREA ACA
--------------------------------------------------------------------------------
--
-- FN_ANIO_LECTIVO_ACTUAL ya existia en la base —la usa el trigger
-- TRG_POSTULACIONES_SET_ANIO para completar POSTULACIONES.ANIO— pero su fuente
-- NO estaba en el repositorio: vivia solo en Oracle. Eso significa que nadie
-- podia leer, revisar ni reproducir su criterio desde el codigo.
--
-- Al ponerla aca queda versionada. El CREATE OR REPLACE la pisa con esta
-- version, asi que **el criterio de abajo pasa a ser el unico**. Si la que
-- estaba en la base decidia distinto (por ejemplo, por SYSDATE contra el rango
-- en vez de por ESTADO), el cambio afecta tambien a las postulaciones nuevas.
-- Es lo buscado —un solo criterio para todo el sistema— pero conviene saberlo
-- antes de correrlo, no despues.
--
--------------------------------------------------------------------------------
-- EL CRITERIO: manda ESTADO, no la fecha
--------------------------------------------------------------------------------
--
-- El año activo es el que tiene ESTADO = 'A'. NO se elige por SYSDATE contra
-- FECHA_DESDE/FECHA_HASTA, y la diferencia importa:
--
--   * El año lectivo se cierra administrativamente, no en la fecha exacta en la
--     que termina. Entre que se acaba el año y se abre el siguiente hay semanas
--     de carga y cierre; por rango de fechas, ahi no habria NINGUN año activo y
--     los combos del formulario quedarian vacios sin explicacion.
--
--   * Con ESTADO, quien administra decide cuando cambia. Es un dato que se
--     edita, no una consecuencia del reloj.
--
-- FECHA_DESDE/FECHA_HASTA quedan como informacion del periodo (y sirven para
-- reportes), pero no deciden cual esta vigente.
--
-- SI HAY VARIOS CON ESTADO 'A': gana el ANIO mas alto. No deberia pasar —abajo
-- se crea un indice unico que lo impide— pero el ORDER BY esta igual para que
-- la funcion sea determinista en una base que ya venga con dos activos.
--
-- SI NO HAY NINGUNO: devuelve NULL. **No cae al año del sistema.** Un
-- EXTRACT(YEAR FROM SYSDATE) de consuelo daria un año que quizas no existe en
-- la tabla, y el error saldria mucho despues, como "no hay instituciones",
-- imposible de rastrear. NULL hace que el llamador decida, y los combos estan
-- escritos para no filtrar por año cuando esto es NULL.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON
SET DEFINE OFF

DECLARE
  -- OJO CON EL ORDEN: en PL/SQL las variables van ANTES que los subprogramas.
  -- Declarar `l_existe` despues de PROCEDURE ejecutar da PLS-00103 ("se ha
  -- encontrado el simbolo L_EXISTE cuando se esperaba begin/function/procedure").
  l_existe PLS_INTEGER;

  ----------------------------------------------------------------------------
  -- Ejecuta DDL tolerando "ya existe". Mismo helper que usa el script de
  -- evaluaciones: correr el script dos veces no puede romper nada.
  ----------------------------------------------------------------------------
  PROCEDURE ejecutar(p_sql IN VARCHAR2, p_ignorar IN VARCHAR2 DEFAULT NULL) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
    DBMS_OUTPUT.PUT_LINE('  OK   ' || SUBSTR(p_sql, 1, 90));
  EXCEPTION
    WHEN OTHERS THEN
      -- -955 objeto ya existe | -1430 columna ya existe | -2260 ya tiene PK
      -- -1408 ya indexada     | -955 indice/constraint duplicado
      -- -2261 esa columna ya tiene una UNIQUE/PK con OTRO nombre (09/10/2026:
      --       la base ya traia una UNIQUE sobre ANIO y el bloque cortaba ahi,
      --       sin crear el indice de "un solo activo")
      IF SQLCODE IN (-955, -1430, -2260, -2261, -1408, -1442, -2275) THEN
        DBMS_OUTPUT.PUT_LINE('  skip ' || SUBSTR(p_sql, 1, 60) || ' (ya estaba)');
      ELSIF p_ignorar IS NOT NULL AND INSTR(SQLERRM, p_ignorar) > 0 THEN
        DBMS_OUTPUT.PUT_LINE('  skip ' || SUBSTR(p_sql, 1, 60));
      ELSE
        DBMS_OUTPUT.PUT_LINE('  FALLO ' || SUBSTR(p_sql, 1, 70));
        DBMS_OUTPUT.PUT_LINE('        ' || SQLERRM);
        RAISE;
      END IF;
  END ejecutar;
BEGIN
  DBMS_OUTPUT.PUT_LINE('--- ANIOS_LECTIVOS ---');

  ----------------------------------------------------------------------------
  -- 1. La tabla
  ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO l_existe
    FROM user_tables WHERE table_name = 'ANIOS_LECTIVOS';

  IF l_existe = 0 THEN
    ejecutar(
      'CREATE TABLE anios_lectivos ('
      || ' id_anio     NUMBER GENERATED ALWAYS AS IDENTITY'
      || '             MINVALUE 1 INCREMENT BY 1 START WITH 1 NOCACHE NOT NULL,'
      || ' anio        NUMBER(4,0)    NOT NULL,'
      || ' descripcion VARCHAR2(100)  NOT NULL,'
      -- 'A' activo / 'I' inactivo. DEFAULT 'A' igual que en el DDL original.
      || ' estado      VARCHAR2(10)   DEFAULT ''A'','
      || ' fecha_desde DATE           NOT NULL,'
      || ' fecha_hasta DATE           NOT NULL,'
      || ' CONSTRAINT anios_lectivos_pk PRIMARY KEY (id_anio))');
  ELSE
    DBMS_OUTPUT.PUT_LINE('  skip CREATE TABLE anios_lectivos (ya estaba)');
  END IF;

  ----------------------------------------------------------------------------
  -- 2. Un año no se puede cargar dos veces
  ----------------------------------------------------------------------------
  ejecutar('ALTER TABLE anios_lectivos ADD CONSTRAINT anios_lectivos_uk_anio '
           || 'UNIQUE (anio)');

  ----------------------------------------------------------------------------
  -- 3. UN SOLO AÑO ACTIVO A LA VEZ
  ----------------------------------------------------------------------------
  -- Indice unico FUNCIONAL: indexa el ANIO solo cuando ESTADO = 'A' y NULL en
  -- el resto de las filas. Oracle no indexa las claves enteramente nulas, asi
  -- que los años inactivos ni entran al indice: pueden ser todos los que sean.
  --
  -- Es la unica forma de expresar "solo una fila activa" sin un trigger. Un
  -- CHECK no puede mirar otras filas, y un trigger de tabla se choca con la
  -- mutating table.
  --
  -- Efecto practico: activar un año nuevo OBLIGA a desactivar el anterior en la
  -- misma transaccion. Es deliberado — dos años activos dejarian a los combos
  -- decidiendo por su cuenta cual usar.
  ejecutar('CREATE UNIQUE INDEX anios_lectivos_ux_activo '
           || 'ON anios_lectivos (CASE WHEN UPPER(estado) = ''A'' THEN 1 END)');

  ----------------------------------------------------------------------------
  -- 4. Busquedas por año
  ----------------------------------------------------------------------------
  ejecutar('CREATE INDEX anios_lectivos_ix_anio ON anios_lectivos (anio)');

  DBMS_OUTPUT.PUT_LINE('Tabla lista.');
END;
/

--------------------------------------------------------------------------------
-- FN_ANIO_LECTIVO_ACTUAL
--------------------------------------------------------------------------------
-- Devuelve el ANIO vigente como NUMBER, o NULL si no hay ninguno activo.
--
-- DETERMINISTIC a proposito NO: lee una tabla que cambia. Marcarla como tal
-- dejaria a Oracle cachear el resultado dentro de una consulta y un cambio de
-- año no se veria hasta reconectar.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_anio_lectivo_actual
  RETURN NUMBER
IS
  l_anio anios_lectivos.anio%TYPE;
BEGIN
  -- ORDER BY defensivo: con el indice unico de arriba no puede haber dos
  -- activos, pero si la tabla ya venia con dos, que elija siempre el mismo.
  SELECT anio
    INTO l_anio
    FROM (SELECT anio
            FROM anios_lectivos
           WHERE UPPER(TRIM(estado)) = 'A'
           ORDER BY anio DESC)
   WHERE ROWNUM = 1;

  RETURN l_anio;
EXCEPTION
  -- Sin año activo devolvemos NULL en vez de propagar. Los combos leen esto
  -- como "no filtres por año" y siguen andando; que se rompa el formulario
  -- entero porque falta una fila de configuracion seria peor.
  WHEN NO_DATA_FOUND THEN
    RETURN NULL;
END fn_anio_lectivo_actual;
/

SHOW ERRORS FUNCTION fn_anio_lectivo_actual

--------------------------------------------------------------------------------
-- Verificacion
--------------------------------------------------------------------------------
SET SERVEROUTPUT ON
DECLARE
  l_total   PLS_INTEGER;
  l_activos PLS_INTEGER;
  l_actual  NUMBER;
BEGIN
  SELECT COUNT(*) INTO l_total   FROM anios_lectivos;
  SELECT COUNT(*) INTO l_activos FROM anios_lectivos WHERE UPPER(TRIM(estado)) = 'A';
  l_actual := fn_anio_lectivo_actual();

  DBMS_OUTPUT.PUT_LINE('----------------------------------------------------');
  DBMS_OUTPUT.PUT_LINE('Años cargados : ' || l_total);
  DBMS_OUTPUT.PUT_LINE('Activos       : ' || l_activos);
  DBMS_OUTPUT.PUT_LINE('Año vigente   : ' || NVL(TO_CHAR(l_actual), '(ninguno)'));
  DBMS_OUTPUT.PUT_LINE('----------------------------------------------------');

  IF l_total = 0 THEN
    DBMS_OUTPUT.PUT_LINE('FALTA CARGAR EL AÑO LECTIVO. Sin una fila activa, el');
    DBMS_OUTPUT.PUT_LINE('combo de instituciones no filtra por año. Ejemplo:');
    DBMS_OUTPUT.PUT_LINE(' ');
    DBMS_OUTPUT.PUT_LINE('  INSERT INTO anios_lectivos');
    DBMS_OUTPUT.PUT_LINE('    (anio, descripcion, estado, fecha_desde, fecha_hasta)');
    DBMS_OUTPUT.PUT_LINE('  VALUES');
    DBMS_OUTPUT.PUT_LINE('    (2026, ''Año lectivo 2026'', ''A'',');
    DBMS_OUTPUT.PUT_LINE('     DATE ''2026-02-01'', DATE ''2026-11-30'');');
    DBMS_OUTPUT.PUT_LINE('  COMMIT;');
  ELSIF l_activos = 0 THEN
    DBMS_OUTPUT.PUT_LINE('OJO: hay años cargados pero NINGUNO con ESTADO = ''A''.');
    DBMS_OUTPUT.PUT_LINE('El combo de instituciones no va a filtrar por año.');
  ELSIF l_activos > 1 THEN
    -- Con el indice unico esto es inalcanzable, salvo que el indice no se haya
    -- podido crear justamente porque ya habia dos activos.
    DBMS_OUTPUT.PUT_LINE('OJO: hay ' || l_activos || ' años activos. Deberia haber uno.');
    DBMS_OUTPUT.PUT_LINE('Revisá si anios_lectivos_ux_activo se llego a crear.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('OK. Seguí con evaluaciones_facilitadores.sql');
  END IF;
END;
/


--==============================================================================
-- ABM DE AÑOS LECTIVOS (pagina 57 de APEX y su modal 59)  —  09/10/2026
--==============================================================================
--
-- Reemplaza en el sitio a la pagina 57 (Anios Lectivos, un IG sobre
-- ANIOS_LECTIVOS) y a su modal 59 (Crea Anio Lectivo). La 59 NO es una pagina
-- en el sitio: es el dialogo de la pantalla /anios-lectivos, con los permisos
-- de la 57.
--
-- QUE PUBLICA
--
--   GET     anios-lectivos        todos, del mas nuevo al mas viejo, con cual
--                                 es el vigente y que datos tiene cada anio
--   POST    anios-lectivos        {anio, descripcion, estado, fecha_desde,
--                                  fecha_hasta} -> {id_anio}
--   PUT     anios-lectivos/:id    lo mismo
--   DELETE  anios-lectivos/:id    solo si no es el vigente y nada lo usa
--
--   Fechas como 'YYYY-MM-DD' (lo que da un <input type="date">).
--
-- NECESITA auth.sql y roles_paginas.sql (permisos). En una instalacion nueva,
-- donde este script corre 2do, el paquete queda INVALID hasta que existan:
-- volver a correr este script despues de roles_paginas.sql. La tabla y la
-- funcion de arriba no dependen de nada.
--
--------------------------------------------------------------------------------
-- REGLAS
--------------------------------------------------------------------------------
--
--   - ESTADO 'A' = el anio vigente (ver "EL CRITERIO" arriba). Guardar un anio
--     como 'A' DESACTIVA al que lo era, en la misma transaccion: el indice
--     unico no deja dos activos, y asi "hacer vigente" es un solo paso.
--   - ANIO entero de 4 cifras, sin repetir (409).
--   - FECHA_DESDE <= FECHA_HASTA, las dos obligatorias.
--   - ESTADO solo 'A' o 'I' (la lista ACTIVO_INACTIVO). Vacio = 'I'.
--   - El vigente no se borra: hay que activar otro antes. Sin anio vigente los
--     combos dejan de filtrar por anio y las pantallas que cargan "el anio
--     actual" (horarios, pre-horarios) avisan que no hay.
--
--------------------------------------------------------------------------------
-- EN USO
--------------------------------------------------------------------------------
--
-- Nada tiene FK a ANIOS_LECTIVOS: POSTULACIONES, PRE_HORARIOS y
-- HORARIO_INSTITUCIONES guardan el ANIO como texto. Se buscan en
-- USER_TAB_COLUMNS todas las tablas con una columna ANIO (salvo esta y las
-- _JN) y se cuenta cuantas filas tiene cada anio. Un anio con datos:
--
--   - no se borra (409), y
--   - no cambia de numero (409): sus datos quedarian colgados del anio viejo.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   GET     solo sesion.
--   POST    PUEDE_INSERTAR   en la pagina de /anios-lectivos (la 57)
--   PUT     PUEDE_ACTUALIZAR
--   DELETE  PUEDE_BORRAR
--
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_ANIOS_LECTIVOS_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  -- p_id NULL = alta.
  PROCEDURE guardar(
    p_token       IN VARCHAR2,
    p_id          IN VARCHAR2,
    p_anio        IN VARCHAR2,
    p_descripcion IN VARCHAR2,
    p_estado      IN VARCHAR2,
    p_desde       IN VARCHAR2,
    p_hasta       IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_ANIOS_LECTIVOS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_ANIOS_LECTIVOS_ETHOS AS

  c_ruta  CONSTANT VARCHAR2(20) := '/anios-lectivos';
  c_largo CONSTANT PLS_INTEGER  := 100;

  -- Por tabla, cuantas filas tiene cada anio (la clave es el anio como texto).
  TYPE t_cuentas IS TABLE OF PLS_INTEGER INDEX BY VARCHAR2(40);
  TYPE t_hija IS RECORD (tabla VARCHAR2(128), cuentas t_cuentas);
  TYPE t_hijas IS TABLE OF t_hija INDEX BY PLS_INTEGER;

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
        p_error(409, 'Conflict', 'Ya existe ese ' || UNISTR('a\00f1o') || ' lectivo');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
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

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' la accion en la
  -- pagina de /anios-lectivos. FALSE = ya respondio el error.
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
      IF l_pagina IS NULL
         OR PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para '
          || CASE p_accion WHEN 'I' THEN 'agregar'
                           WHEN 'U' THEN 'modificar'
                           ELSE 'eliminar' END
          || ' ' || UNISTR('a\00f1os') || ' lectivos');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  ------------------------------------------------------------------------------
  -- Las tablas con columna ANIO y cuantas filas tiene cada anio. Ver "EN USO".
  ------------------------------------------------------------------------------
  PROCEDURE cargar_hijas(p_hijas OUT t_hijas) IS
    TYPE t_txt IS TABLE OF VARCHAR2(40);
    TYPE t_nums IS TABLE OF NUMBER;
    l_anios t_txt;
    l_cnts  t_nums;
    l_i     PLS_INTEGER := 0;
  BEGIN
    FOR f IN (
        SELECT c.table_name
          FROM user_tab_columns c
          JOIN user_tables t ON t.table_name = c.table_name
         WHERE c.column_name = 'ANIO'
           AND c.table_name <> 'ANIOS_LECTIVOS'
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
         ORDER BY 1
    ) LOOP
      l_i := l_i + 1;
      p_hijas(l_i).tabla := f.table_name;
      EXECUTE IMMEDIATE
        'SELECT TRIM(TO_CHAR(anio)), COUNT(*) FROM '
        || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
        || ' WHERE anio IS NOT NULL GROUP BY TRIM(TO_CHAR(anio))'
        BULK COLLECT INTO l_anios, l_cnts;
      FOR j IN 1 .. l_anios.COUNT LOOP
        p_hijas(l_i).cuentas(l_anios(j)) := l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_hijas;

  -- "12 en POSTULACIONES, 3 en PRE_HORARIOS", o NULL si nada lo usa.
  FUNCTION f_usos(p_hijas IN t_hijas, p_anio IN NUMBER) RETURN VARCHAR2 IS
    l_txt VARCHAR2(4000);
    l_k   VARCHAR2(40) := TO_CHAR(p_anio);
  BEGIN
    FOR i IN 1 .. p_hijas.COUNT LOOP
      IF p_hijas(i).cuentas.EXISTS(l_k) THEN
        l_txt := l_txt || CASE WHEN l_txt IS NOT NULL THEN ', ' END
                 || p_hijas(i).cuentas(l_k) || ' en ' || p_hijas(i).tabla;
      END IF;
    END LOOP;
    RETURN l_txt;
  END f_usos;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_hijas t_hijas;
    l_k     VARCHAR2(40);
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_hijas(l_hijas);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('actual', fn_anio_lectivo_actual());
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT id_anio, anio, descripcion, estado,
                     TO_CHAR(fecha_desde, 'YYYY-MM-DD') AS desde,
                     TO_CHAR(fecha_hasta, 'YYYY-MM-DD') AS hasta,
                     CASE WHEN UPPER(TRIM(estado)) = 'A' THEN 'S' ELSE 'N' END AS es_vigente
                FROM anios_lectivos
               ORDER BY anio DESC) LOOP
      l_k := TO_CHAR(r.anio);
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_anio',     r.id_anio);
      APEX_JSON.WRITE('anio',        r.anio);
      APEX_JSON.WRITE('descripcion', r.descripcion);
      APEX_JSON.WRITE('estado',      r.estado);
      APEX_JSON.WRITE('es_vigente',  r.es_vigente);
      APEX_JSON.WRITE('fecha_desde', r.desde);
      APEX_JSON.WRITE('fecha_hasta', r.hasta);
      APEX_JSON.OPEN_ARRAY('usos');
      FOR i IN 1 .. l_hijas.COUNT LOOP
        IF l_hijas(i).cuentas.EXISTS(l_k) THEN
          APEX_JSON.OPEN_OBJECT;
          APEX_JSON.WRITE('tabla',    l_hijas(i).tabla);
          APEX_JSON.WRITE('cantidad', l_hijas(i).cuentas(l_k));
          APEX_JSON.CLOSE_OBJECT;
        END IF;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;
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
    p_token       IN VARCHAR2,
    p_id          IN VARCHAR2,
    p_anio        IN VARCHAR2,
    p_descripcion IN VARCHAR2,
    p_estado      IN VARCHAR2,
    p_desde       IN VARCHAR2,
    p_hasta       IN VARCHAR2)
  IS
    -- 32767: ver materias.sql. El tope real se valida abajo con mensaje.
    l_desc     VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_descripcion, '\s+', ' '));
    l_estado   VARCHAR2(10)    := NVL(UPPER(TRIM(SUBSTR(p_estado, 1, 10))), 'I');
    l_id       NUMBER := f_numero(p_id);
    l_anio     NUMBER := f_numero(p_anio);
    l_desde    DATE   := f_fecha(p_desde);
    l_hasta    DATE   := f_fecha(p_hasta);
    l_anterior anios_lectivos.anio%TYPE;
    l_vigente  anios_lectivos.anio%TYPE;
    l_hijas    t_hijas;
    l_usos     VARCHAR2(4000);
    l_n        PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    IF l_anio IS NULL OR l_anio < 1900 OR l_anio > 2999 THEN
      p_error(400, 'Bad Request', 'El ' || UNISTR('a\00f1o') || ' tiene que ser un numero de 4 cifras');
      RETURN;
    END IF;
    IF l_desc IS NULL THEN
      p_error(400, 'Bad Request', 'La descripcion es obligatoria'); RETURN;
    END IF;
    IF LENGTH(l_desc) > c_largo THEN
      p_error(400, 'Bad Request', 'La descripcion no puede pasar de ' || c_largo || ' caracteres');
      RETURN;
    END IF;
    IF l_estado NOT IN ('A', 'I') THEN
      p_error(400, 'Bad Request', 'El estado tiene que ser A (activo) o I (inactivo)'); RETURN;
    END IF;
    IF l_desde IS NULL OR l_hasta IS NULL THEN
      p_error(400, 'Bad Request', 'Las fechas desde y hasta son obligatorias'); RETURN;
    END IF;
    IF l_desde > l_hasta THEN
      p_error(400, 'Bad Request', 'La fecha desde no puede ser posterior a la fecha hasta'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM anios_lectivos
     WHERE anio = l_anio AND (l_id IS NULL OR id_anio <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'El ' || UNISTR('a\00f1o') || ' ' || l_anio || ' ya esta cargado'); RETURN;
    END IF;

    IF l_id IS NOT NULL THEN
      BEGIN
        SELECT anio INTO l_anterior FROM anios_lectivos WHERE id_anio = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'El ' || UNISTR('a\00f1o') || ' lectivo no existe'); RETURN;
      END;
      -- Un anio con datos no cambia de numero: quedarian colgados del viejo.
      IF l_anterior <> l_anio THEN
        cargar_hijas(l_hijas);
        l_usos := f_usos(l_hijas, l_anterior);
        IF l_usos IS NOT NULL THEN
          p_error(409, 'Conflict', 'El ' || UNISTR('a\00f1o') || ' ' || l_anterior
                  || ' ya tiene datos (' || l_usos || '): no se puede cambiar el numero');
          RETURN;
        END IF;
      END IF;
    END IF;

    -- Vigente: primero se desactiva el que lo era (el indice unico no deja
    -- dos activos ni por un instante).
    IF l_estado = 'A' THEN
      BEGIN
        SELECT anio INTO l_vigente FROM anios_lectivos
         WHERE UPPER(TRIM(estado)) = 'A' AND (l_id IS NULL OR id_anio <> l_id)
           AND ROWNUM = 1;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN l_vigente := NULL;
      END;
      UPDATE anios_lectivos SET estado = 'I'
       WHERE UPPER(TRIM(estado)) = 'A' AND (l_id IS NULL OR id_anio <> l_id);
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO anios_lectivos (anio, descripcion, estado, fecha_desde, fecha_hasta)
      VALUES (l_anio, l_desc, l_estado, l_desde, l_hasta)
      RETURNING id_anio INTO l_id;
    ELSE
      UPDATE anios_lectivos
         SET anio = l_anio, descripcion = l_desc, estado = l_estado,
             fecha_desde = l_desde, fecha_hasta = l_hasta
       WHERE id_anio = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_anio', l_id);
    -- El que dejo de ser vigente, si hubo: la pantalla lo avisa.
    APEX_JSON.WRITE('desactivado', l_vigente);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN UNISTR('A\00f1o') || ' lectivo creado'
                                    ELSE 'Cambios guardados' END);
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
    l_id     NUMBER := f_numero(p_id);
    l_anio   anios_lectivos.anio%TYPE;
    l_estado anios_lectivos.estado%TYPE;
    l_hijas  t_hijas;
    l_usos   VARCHAR2(4000);
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    BEGIN
      SELECT anio, estado INTO l_anio, l_estado FROM anios_lectivos WHERE id_anio = l_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'El ' || UNISTR('a\00f1o') || ' lectivo no existe'); RETURN;
    END;
    IF UPPER(TRIM(l_estado)) = 'A' THEN
      p_error(409, 'Conflict', 'Es el ' || UNISTR('a\00f1o') || ' vigente: activa otro antes de eliminarlo');
      RETURN;
    END IF;
    cargar_hijas(l_hijas);
    l_usos := f_usos(l_hijas, l_anio);
    IF l_usos IS NOT NULL THEN
      p_error(409, 'Conflict', 'No se puede eliminar: el ' || UNISTR('a\00f1o') || ' ' || l_anio
              || ' tiene datos (' || l_usos || ')');
      RETURN;
    END IF;

    DELETE FROM anios_lectivos WHERE id_anio = l_id;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', UNISTR('A\00f1o') || ' lectivo eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_ANIOS_LECTIVOS_ETHOS;
/

--------------------------------------------------------------------------------
-- ENDPOINTS ORDS
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

  c_campos CONSTANT VARCHAR2(300) := '
        p_anio => :anio, p_descripcion => :descripcion, p_estado => :estado,
        p_desde => :fecha_desde, p_hasta => :fecha_hasta);';

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
  FOR r IN (SELECT 'anios-lectivos' AS p FROM dual
            UNION ALL SELECT 'anios-lectivos/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'anios-lectivos',
                       p_priority => 0, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'anios-lectivos/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('anios-lectivos', 'GET', '
    PKG_ANIOS_LECTIVOS_ETHOS.LISTAR(p_token => l_token);');

  handler('anios-lectivos', 'POST', '
    PKG_ANIOS_LECTIVOS_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('anios-lectivos/:id', 'PUT', '
    PKG_ANIOS_LECTIVOS_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('anios-lectivos/:id', 'DELETE', '
    PKG_ANIOS_LECTIVOS_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de anios-lectivos publicados.');
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
  preflight('anios-lectivos');
  preflight('anios-lectivos/:id');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Preflight OPTIONS no se pudo publicar: ' || SQLERRM);
END;
/

DECLARE
  l_estado user_objects.status%TYPE;
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_ANIOS_LECTIVOS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_ANIOS_LECTIVOS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    anios-lectivos');
    DBMS_OUTPUT.PUT_LINE('       POST   anios-lectivos');
    DBMS_OUTPUT.PUT_LINE('       PUT    anios-lectivos/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE anios-lectivos/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ANIOS_LECTIVOS_ETHOS quedo INVALID.');
    DBMS_OUTPUT.PUT_LINE('        Si falta PKG_ROLES_PAGINAS_ETHOS, corre roles_paginas.sql y este de nuevo.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_ANIOS_LECTIVOS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ANIOS_LECTIVOS_ETHOS no se creo.');
END;
/
