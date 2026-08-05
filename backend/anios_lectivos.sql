--------------------------------------------------------------------------------
-- ANIOS_LECTIVOS  —  el año lectivo activo como dato, no como convencion
--------------------------------------------------------------------------------
--
-- QUE HACE ESTE SCRIPT
--
--   1. Crea ANIOS_LECTIVOS si no existe (idempotente: se puede correr de nuevo).
--   2. (Re)crea FN_ANIO_LECTIVO_ACTUAL, que resuelve el año vigente leyendo esa
--      tabla.
--
-- CORRER **ANTES** de ethos_evaluaciones_facilitadores.sql: el paquete de
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
      IF SQLCODE IN (-955, -1430, -2260, -1408, -1442, -2275) THEN
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
    DBMS_OUTPUT.PUT_LINE('OK. Seguí con ethos_evaluaciones_facilitadores.sql');
  END IF;
END;
/
