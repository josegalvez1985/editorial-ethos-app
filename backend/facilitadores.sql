--------------------------------------------------------------------------------
-- FACILITADORES  —  ABM de facilitadores con su ficha completa (Nucleo de Datos)
--------------------------------------------------------------------------------
--
-- Reemplaza en el sitio a estas paginas de APEX, todas con los permisos de la
-- 14 (los modales NO son paginas en el sitio):
--
--   14  Facilitadores          el listado                 /facilitadores
--   15  Crear Facilitador      la ficha                   /facilitadores/:id
--   63  Nominado por           FACILITADORES_NOMINADO              secciones
--   64  Referencias Personales FACILITADORES_REFERENCIA_PERSONAL   de la
--   65  Niveles Academico      FACILITADORES_ESTUDIOS              misma
--   66  Situacion Laboral      FACILITADORES_LABORAL               ficha
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     facilitadores            el listado (datos de la tarjeta)
--   GET     facilitadores/opciones   los valores de las listas (SI_NO, estado
--                                    civil, con quien vive, nivel academico,
--                                    tipo de factura)
--   GET     facilitadores/:id        la ficha completa, con sus 4 listas y en
--                                    que tablas se usa
--   POST    facilitadores            {datos}  -> {id_facilitador}
--   PUT     facilitadores/:id        {datos}
--   DELETE  facilitadores/:id        solo si nada lo usa
--
-- CORRER DESPUES de auth.sql y roles_paginas.sql (permisos). La pantalla lee
-- tambien GET nacionalidades, ciudades y barrios: conviene tener corridos
-- nacionalidades.sql, ciudades.sql y barrios.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- LA FICHA VIAJA ENTERA, EN UN SOLO CAMPO `datos`   <-- distinto de APEX
--------------------------------------------------------------------------------
--
-- ORDS bindea solo los campos ESCALARES del body (ver inventarios.sql), y la
-- ficha tiene ~45 campos y 4 listas. Por eso el front manda un unico campo
-- `datos` con el JSON de la ficha como TEXTO, y aca se lee con APEX_JSON.
--
-- Las 4 listas se guardan JUNTO con la ficha, en la misma transaccion: las
-- filas con id se actualizan, las sin id se insertan y las que ya no vienen se
-- borran. En APEX eran 4 modales que solo andaban con el facilitador ya
-- guardado; aca se pueden cargar desde el alta.
--
--------------------------------------------------------------------------------
-- UBICACION: SE ELIGE LA CIUDAD (Y EL BARRIO); EL RESTO SALE DE AHI
--------------------------------------------------------------------------------
--
-- La tabla guarda ID_PAIS, ID_DEPARTAMENTO, ID_CIUDAD e ID_BARRIO, todas
-- opcionales. En APEX se elegian las cuatro sueltas. Aca se elige la ciudad y,
-- si se quiere, un barrio DE ESA CIUDAD; el departamento sale de la ciudad y el
-- pais del departamento, como en ciudades.sql y barrios.sql. Sin ciudad, las
-- cuatro quedan vacias.
--
--------------------------------------------------------------------------------
-- LAS LISTAS DE VALORES SALEN DE APEX
--------------------------------------------------------------------------------
--
-- SI_NO, ESTADO_CIVIL, CON_QUIEN_VIVE y la de nivel academico son listas
-- compartidas de la app APEX. No adivino sus valores: GET facilitadores/opciones
-- los lee de APEX_APPLICATION_LOV_ENTRIES. Si una lista es dinamica (una
-- consulta) y no tiene entradas fijas, cae a los valores que ya hay cargados en
-- la tabla. TIPO_FACTURA era estatica en el form: Fisico / Virtual.
--
-- "Activo" en el listado: es_activo = 'S' si ACTIVO empieza con S (S, Si, Si
-- con tilde): sirve cualquiera sea el valor que guarda la lista SI_NO.
--
--------------------------------------------------------------------------------
-- LA COLUMNA "DENOMINACION" TIENE TILDE
--------------------------------------------------------------------------------
--
-- El form de APEX la llama DENOMINACION con O acentuada. Un identificador con
-- tilde en este archivo puede romperse al subirlo (el upload no siempre respeta
-- la codificacion), asi que se busca en USER_TAB_COLUMNS (LIKE 'DENOMINACI%N')
-- y se lee y escribe con SQL dinamico, aparte del resto. Si no existe, se
-- ignora.
--
--------------------------------------------------------------------------------
-- EN USO, PERMISOS, ID NUEVO
--------------------------------------------------------------------------------
--
--   - "En uso": las FK de una columna que apuntan a FACILITADORES (salvo las
--     _JN y las 4 tablas de la ficha, que se borran con el facilitador).
--   - GET pide solo sesion (otros combos usan la lista); POST/PUT/DELETE piden
--     insertar/actualizar/borrar en la pagina de /facilitadores (la 14).
--   - Los ID los pone cada tabla (identity o trigger); si no (ORA-01400), el
--     mayor mas 1 con la tabla bloqueada.
--   - Nro de CI repetido: se rechaza en un alta, o al cambiarle la CI a uno.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'backend/auth.sql' AS script FROM dual
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'backend/roles_paginas.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = 'PACKAGE BODY';
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  FOR t IN (SELECT 'FACILITADORES' AS tabla FROM dual
            UNION ALL SELECT 'FACILITADORES_NOMINADO' FROM dual
            UNION ALL SELECT 'FACILITADORES_REFERENCIA_PERSONAL' FROM dual
            UNION ALL SELECT 'FACILITADORES_ESTUDIOS' FROM dual
            UNION ALL SELECT 'FACILITADORES_LABORAL' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.tabla;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.tabla || '.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.tabla || ' encontrada.');
      -- Un trigger de bitacora escrito a mano puede tener el ORA-04084 en
      -- DELETE que tenia SUCURSALES_JNTRG. Se listan para saber cuales hay.
      FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                  WHERE table_name = t.tabla ORDER BY trigger_name) LOOP
        DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
      END LOOP;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_tab_columns
   WHERE table_name = 'FACILITADORES' AND column_name LIKE 'DENOMINACI%N';
  DBMS_OUTPUT.PUT_LINE(CASE WHEN l_n = 1 THEN '[OK]   Columna de denominacion encontrada.'
                            ELSE '[WARN] No encontre la columna DENOMINACION: se ignora.' END);
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_FACILITADORES_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  PROCEDURE ficha(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- p_id NULL = alta. p_datos: el JSON de la ficha (ver el encabezado).
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_datos IN CLOB);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_FACILITADORES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_FACILITADORES_ETHOS AS

  c_ruta      CONSTANT VARCHAR2(20) := '/facilitadores';
  c_app_id    CONSTANT NUMBER       := 40587;
  c_workspace CONSTANT VARCHAR2(64) := 'FUNDCARAC';

  TYPE t_cuentas IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
  TYPE t_hija IS RECORD (tabla VARCHAR2(128), cuentas t_cuentas);
  TYPE t_hijas IS TABLE OF t_hija INDEX BY PLS_INTEGER;

  -- Un dato invalido de la ficha: g_msg dice cual.
  e_dato EXCEPTION;
  g_msg  VARCHAR2(400);

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
        p_error(409, 'Conflict', 'Ya existe un registro con esos datos');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La nacionalidad, la ciudad o el barrio elegido no existe');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay registros que usan este facilitador');
      WHEN SQLCODE IN (-12899, -1401) THEN
        p_error(400, 'Bad Request', 'Un dato es mas largo de lo que admite la tabla: ' || SQLERRM);
      WHEN SQLCODE = -4084 THEN
        p_error(500, 'Internal Server Error',
                'Un trigger de bitacora asigna :NEW en un DELETE (ORA-04084). Hay que '
                || 'corregirlo, como SUCURSALES_JNTRG en sucursales.sql.');
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

  PROCEDURE fijar_workspace IS
  BEGIN
    APEX_UTIL.SET_SECURITY_GROUP_ID(
      p_security_group_id => APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => c_workspace));
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END fijar_workspace;

  -- Entero positivo, o NULL.
  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_numero;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. 'C' pide solo sesion; 'I', 'U', 'D' piden la accion en la
  -- pagina de /facilitadores. FALSE = ya respondio el error.
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
          || ' facilitadores');
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  -- La columna de la denominacion (con tilde), o NULL si no esta.
  FUNCTION col_denominacion RETURN VARCHAR2 IS
    l_col VARCHAR2(128);
  BEGIN
    SELECT column_name INTO l_col FROM user_tab_columns
     WHERE table_name = 'FACILITADORES' AND column_name LIKE 'DENOMINACI%N'
       AND ROWNUM = 1;
    RETURN l_col;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END col_denominacion;

  /* ---------------------------------------------------------------------- */
  /* EN USO                                                                 */
  /* ---------------------------------------------------------------------- */

  -- Las tablas con FK de una columna hacia FACILITADORES (salvo las _JN y las
  -- 4 de la ficha), y cuantas filas de cada una usan cada facilitador. Si
  -- p_id viene, cuenta solo ese.
  PROCEDURE cargar_hijas(p_hijas OUT t_hijas, p_id IN NUMBER DEFAULT NULL) IS
    TYPE t_nums IS TABLE OF NUMBER;
    l_ids  t_nums;
    l_cnts t_nums;
    l_i    PLS_INTEGER := 0;
    l_col  VARCHAR2(200);
  BEGIN
    FOR f IN (
        SELECT c.table_name, cc.column_name
          FROM user_constraints c
          JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
         WHERE c.constraint_type = 'R'
           AND c.r_constraint_name IN (SELECT constraint_name FROM user_constraints
                                        WHERE table_name = 'FACILITADORES'
                                          AND constraint_type IN ('P', 'U'))
           AND c.table_name NOT LIKE '%\_JN' ESCAPE '\'
           AND c.table_name NOT IN ('FACILITADORES_NOMINADO', 'FACILITADORES_REFERENCIA_PERSONAL',
                                    'FACILITADORES_ESTUDIOS', 'FACILITADORES_LABORAL')
           AND (SELECT COUNT(*) FROM user_cons_columns x
                 WHERE x.constraint_name = c.constraint_name) = 1
         ORDER BY c.table_name
    ) LOOP
      l_i := l_i + 1;
      p_hijas(l_i).tabla := f.table_name;
      l_col := DBMS_ASSERT.ENQUOTE_NAME(f.column_name, FALSE);
      IF p_id IS NULL THEN
        EXECUTE IMMEDIATE
          'SELECT ' || l_col || ', COUNT(*) FROM ' || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
          || ' WHERE ' || l_col || ' IS NOT NULL GROUP BY ' || l_col
          BULK COLLECT INTO l_ids, l_cnts;
      ELSE
        EXECUTE IMMEDIATE
          'SELECT ' || l_col || ', COUNT(*) FROM ' || DBMS_ASSERT.ENQUOTE_NAME(f.table_name, FALSE)
          || ' WHERE ' || l_col || ' = :id GROUP BY ' || l_col
          BULK COLLECT INTO l_ids, l_cnts USING p_id;
      END IF;
      FOR j IN 1 .. l_ids.COUNT LOOP
        p_hijas(l_i).cuentas(l_ids(j)) := l_cnts(j);
      END LOOP;
    END LOOP;
  END cargar_hijas;

  PROCEDURE escribir_usos(p_hijas IN t_hijas, p_id IN NUMBER) IS
  BEGIN
    APEX_JSON.OPEN_ARRAY('usos');
    FOR i IN 1 .. p_hijas.COUNT LOOP
      IF p_hijas(i).cuentas.EXISTS(p_id) THEN
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('tabla',    p_hijas(i).tabla);
        APEX_JSON.WRITE('cantidad', p_hijas(i).cuentas(p_id));
        APEX_JSON.CLOSE_OBJECT;
      END IF;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
  END escribir_usos;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2) IS
    l_hijas t_hijas;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    cargar_hijas(l_hijas);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT f.id_facilitador, f.nombre_apellido, f.nro_ci, f.telefono, f.email,
                     f.usuario, f.activo,
                     CASE WHEN UPPER(SUBSTR(TRIM(f.activo), 1, 1)) = 'S' THEN 'S' ELSE 'N' END
                       AS es_activo,
                     c.nombre AS ciudad, d.nombre AS departamento, b.nombre AS barrio,
                     n.descripcion AS nacionalidad
                FROM facilitadores f
                LEFT JOIN ciudades c       ON c.id_ciudad = f.id_ciudad
                LEFT JOIN departamentos d  ON d.id_departamento = c.id_departamento
                LEFT JOIN barrios b        ON b.id_barrio = f.id_barrio
                LEFT JOIN nacionalidades n ON n.id_nacionalidad = f.id_nacionalidad
               ORDER BY UPPER(f.nombre_apellido)) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_facilitador',  r.id_facilitador);
      APEX_JSON.WRITE('nombre_apellido', r.nombre_apellido);
      APEX_JSON.WRITE('nro_ci',          r.nro_ci);
      APEX_JSON.WRITE('telefono',        r.telefono);
      APEX_JSON.WRITE('email',           r.email);
      APEX_JSON.WRITE('usuario',         r.usuario);
      APEX_JSON.WRITE('activo',          r.activo);
      APEX_JSON.WRITE('es_activo',       r.es_activo);
      APEX_JSON.WRITE('ciudad',          r.ciudad);
      APEX_JSON.WRITE('departamento',    r.departamento);
      APEX_JSON.WRITE('barrio',          r.barrio);
      APEX_JSON.WRITE('nacionalidad',    r.nacionalidad);
      escribir_usos(l_hijas, r.id_facilitador);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* OPCIONES (las listas de valores de APEX)                               */
  /* ---------------------------------------------------------------------- */

  ------------------------------------------------------------------------------
  -- Una lista: las entradas fijas de la LOV compartida p_lov (por nombre), o
  -- las de la LOV con id p_lov_id, o si no tiene, los valores distintos que
  -- devuelve p_respaldo. Dinamico: las vistas de APEX cambian de version en
  -- version, y si una columna no esta, cae al respaldo en vez de no compilar.
  ------------------------------------------------------------------------------
  PROCEDURE escribir_lista(
    p_clave    IN VARCHAR2,
    p_lov      IN VARCHAR2,
    p_lov_id   IN NUMBER,
    p_respaldo IN VARCHAR2)
  IS
    TYPE t_txt IS TABLE OF VARCHAR2(4000);
    l_mostrar t_txt := t_txt();
    l_valor   t_txt := t_txt();
  BEGIN
    BEGIN
      EXECUTE IMMEDIATE
        'SELECT e.display_value, e.return_value FROM apex_application_lov_entries e'
        || ' WHERE e.application_id = :app AND (e.list_of_values_name = :n'
        || '   OR e.list_of_values_name = (SELECT l.list_of_values_name FROM apex_application_lovs l'
        || '                                WHERE l.application_id = :app2 AND l.lov_id = :id))'
        || ' ORDER BY e.display_sequence'
        BULK COLLECT INTO l_mostrar, l_valor USING c_app_id, p_lov, c_app_id, p_lov_id;
    EXCEPTION
      WHEN OTHERS THEN l_mostrar.DELETE; l_valor.DELETE;
    END;
    IF l_valor.COUNT = 0 AND p_respaldo IS NOT NULL THEN
      EXECUTE IMMEDIATE p_respaldo BULK COLLECT INTO l_valor;
      l_mostrar := l_valor;
    END IF;

    APEX_JSON.OPEN_ARRAY(p_clave);
    FOR i IN 1 .. l_valor.COUNT LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('valor',   l_valor(i));
      APEX_JSON.WRITE('mostrar', NVL(l_mostrar(i), l_valor(i)));
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
  END escribir_lista;

  PROCEDURE opciones(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    escribir_lista('si_no', 'SI_NO', NULL,
      'SELECT v FROM (SELECT activo v FROM facilitadores UNION SELECT hijos FROM facilitadores)'
      || ' WHERE v IS NOT NULL ORDER BY v DESC');
    escribir_lista('estado_civil', 'ESTADO_CIVIL', 85623227703633446595,
      'SELECT DISTINCT estado_civil FROM facilitadores WHERE estado_civil IS NOT NULL ORDER BY 1');
    escribir_lista('con_quien_vive', 'CON_QUIEN_VIVE', 85622781255852441279,
      'SELECT DISTINCT con_quien_vive FROM facilitadores WHERE con_quien_vive IS NOT NULL ORDER BY 1');
    escribir_lista('nivel_academico', NULL, 127448866430241937472,
      'SELECT DISTINCT nivel_academico FROM facilitadores_estudios'
      || ' WHERE nivel_academico IS NOT NULL ORDER BY 1');
    -- Estatica en el form de APEX (P15_TIPO_FACTURA). TO_CHAR: UNISTR devuelve
    -- NVARCHAR2 y el UNION con un VARCHAR2 da ORA-12704.
    APEX_JSON.OPEN_ARRAY('tipo_factura');
    FOR v IN (SELECT TO_CHAR(UNISTR('F\00edsico')) AS v FROM dual
              UNION ALL SELECT 'Virtual' FROM dual) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('valor', v.v);
      APEX_JSON.WRITE('mostrar', v.v);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* FICHA                                                                  */
  /* ---------------------------------------------------------------------- */

  PROCEDURE ficha(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id    NUMBER := f_numero(p_id);
    l_hijas t_hijas;
    l_col   VARCHAR2(128) := col_denominacion;
    l_den   VARCHAR2(4000);
    l_n     PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de facilitador invalido'); RETURN;
    END IF;
    SELECT COUNT(*) INTO l_n FROM facilitadores WHERE id_facilitador = l_id;
    IF l_n = 0 THEN
      p_error(404, 'Not Found', 'El facilitador no existe'); RETURN;
    END IF;
    IF l_col IS NOT NULL THEN
      EXECUTE IMMEDIATE 'SELECT ' || DBMS_ASSERT.ENQUOTE_NAME(l_col, FALSE)
                        || ' FROM facilitadores WHERE id_facilitador = :id'
        INTO l_den USING l_id;
    END IF;
    cargar_hijas(l_hijas, l_id);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    FOR r IN (SELECT f.*, c.nombre AS ciudad_nombre, d.nombre AS departamento_nombre,
                     b.nombre AS barrio_nombre
                FROM facilitadores f
                LEFT JOIN ciudades c      ON c.id_ciudad = f.id_ciudad
                LEFT JOIN departamentos d ON d.id_departamento = c.id_departamento
                LEFT JOIN barrios b       ON b.id_barrio = f.id_barrio
               WHERE f.id_facilitador = l_id) LOOP
      APEX_JSON.OPEN_OBJECT('data');
      APEX_JSON.WRITE('id_facilitador',            r.id_facilitador);
      APEX_JSON.WRITE('usuario',                   r.usuario);
      APEX_JSON.WRITE('nombre_apellido',           r.nombre_apellido);
      APEX_JSON.WRITE('nro_ci',                    r.nro_ci);
      APEX_JSON.WRITE('fecha_nacimiento',          TO_CHAR(r.fecha_nacimiento, 'YYYY-MM-DD'));
      APEX_JSON.WRITE('estado_civil',              r.estado_civil);
      APEX_JSON.WRITE('con_quien_vive',            r.con_quien_vive);
      APEX_JSON.WRITE('hijos',                     r.hijos);
      APEX_JSON.WRITE('id_nacionalidad',           r.id_nacionalidad);
      APEX_JSON.WRITE('id_ciudad',                 r.id_ciudad);
      APEX_JSON.WRITE('ciudad',                    r.ciudad_nombre);
      APEX_JSON.WRITE('departamento',              r.departamento_nombre);
      APEX_JSON.WRITE('id_barrio',                 r.id_barrio);
      APEX_JSON.WRITE('barrio',                    r.barrio_nombre);
      APEX_JSON.WRITE('fecha_ingreso',             TO_CHAR(r.fecha_ingreso, 'YYYY-MM-DD'));
      APEX_JSON.WRITE('telefono',                  r.telefono);
      APEX_JSON.WRITE('activo',                    r.activo);
      APEX_JSON.WRITE('direccion',                 r.direccion);
      APEX_JSON.WRITE('ubicacion',                 r.ubicacion);
      APEX_JSON.WRITE('email',                     r.email);
      APEX_JSON.WRITE('observacion',               r.observacion);
      APEX_JSON.WRITE('vehiculo',                  r.vehiculo);
      APEX_JSON.WRITE('tipo_vehiculo',             r.tipo_vehiculo);
      APEX_JSON.WRITE('computadora',               r.computadora);
      APEX_JSON.WRITE('internet',                  r.internet);
      APEX_JSON.WRITE('office',                    r.office);
      APEX_JSON.WRITE('denominacion',              l_den);
      APEX_JSON.WRITE('nombre_iglesia',            r.nombre_iglesia);
      APEX_JSON.WRITE('nombre_pastor',             r.nombre_pastor);
      APEX_JSON.WRITE('nro_telefono_pastor',       r.nro_telefono_pastor);
      APEX_JSON.WRITE('nombre_lider',              r.nombre_lider);
      APEX_JSON.WRITE('nro_telefono_lider',        r.nro_telefono_lider);
      APEX_JSON.WRITE('bautizado_agua',            r.bautizado_agua);
      APEX_JSON.WRITE('area_servicio',             r.area_servicio);
      APEX_JSON.WRITE('nombre_banco',              r.nombre_banco);
      APEX_JSON.WRITE('sucursal_banco',            r.sucursal_banco);
      APEX_JSON.WRITE('titular_banco',             r.titular_banco);
      APEX_JSON.WRITE('nro_ci_titular_banco',      r.nro_ci_titular_banco);
      APEX_JSON.WRITE('tipo_cuenta',               r.tipo_cuenta);
      APEX_JSON.WRITE('nro_cuenta',                r.nro_cuenta);
      APEX_JSON.WRITE('nombre_emisor',             r.nombre_emisor);
      APEX_JSON.WRITE('ruc',                       r.ruc);
      APEX_JSON.WRITE('tipo_factura',              r.tipo_factura);
      APEX_JSON.WRITE('credencial',                r.credencial);
      APEX_JSON.WRITE('ind_ubicacion_postulacion', r.ind_ubicacion_postulacion);
      escribir_usos(l_hijas, l_id);

      APEX_JSON.OPEN_ARRAY('nominados');
      FOR x IN (SELECT id_nominado, tipo_relacion, nombre_apellido, nro_telefono
                  FROM facilitadores_nominado WHERE id_facilitador = l_id ORDER BY id_nominado) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id', x.id_nominado);
        APEX_JSON.WRITE('tipo_relacion', x.tipo_relacion);
        APEX_JSON.WRITE('nombre_apellido', x.nombre_apellido);
        APEX_JSON.WRITE('nro_telefono', x.nro_telefono);
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;

      APEX_JSON.OPEN_ARRAY('referencias');
      FOR x IN (SELECT id_referencia, tipo_relacion, nombre_apellido, nro_telefono
                  FROM facilitadores_referencia_personal WHERE id_facilitador = l_id
                 ORDER BY id_referencia) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id', x.id_referencia);
        APEX_JSON.WRITE('tipo_relacion', x.tipo_relacion);
        APEX_JSON.WRITE('nombre_apellido', x.nombre_apellido);
        APEX_JSON.WRITE('nro_telefono', x.nro_telefono);
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;

      APEX_JSON.OPEN_ARRAY('estudios');
      FOR x IN (SELECT id_estudio, nivel_academico, titulo, anio
                  FROM facilitadores_estudios WHERE id_facilitador = l_id ORDER BY id_estudio) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id', x.id_estudio);
        APEX_JSON.WRITE('nivel_academico', x.nivel_academico);
        APEX_JSON.WRITE('titulo', x.titulo);
        APEX_JSON.WRITE('anio', x.anio);
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;

      APEX_JSON.OPEN_ARRAY('laborales');
      FOR x IN (SELECT id_laboral, empresa, cargo, anio
                  FROM facilitadores_laboral WHERE id_facilitador = l_id ORDER BY id_laboral) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id', x.id_laboral);
        APEX_JSON.WRITE('empresa', x.empresa);
        APEX_JSON.WRITE('cargo', x.cargo);
        APEX_JSON.WRITE('anio', x.anio);
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
      APEX_JSON.CLOSE_ARRAY;
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END ficha;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  -- Un texto de la ficha: TRIM, tope de largo y obligatorio. p0 completa el
  -- %d de las rutas de las listas ('nominados[%d].nombre_apellido').
  FUNCTION txt(
    p_v        IN APEX_JSON.T_VALUES,
    p_path     IN VARCHAR2,
    p_etiqueta IN VARCHAR2,
    p_largo    IN PLS_INTEGER,
    p_req      IN BOOLEAN  DEFAULT FALSE,
    p0         IN VARCHAR2 DEFAULT NULL) RETURN VARCHAR2
  IS
    l_t VARCHAR2(32767);
  BEGIN
    l_t := TRIM(APEX_JSON.GET_VARCHAR2(p_path => p_path, p0 => p0, p_values => p_v));
    IF l_t IS NULL AND p_req THEN
      g_msg := p_etiqueta || ' es obligatorio'; RAISE e_dato;
    END IF;
    IF LENGTH(l_t) > p_largo THEN
      g_msg := p_etiqueta || ' no puede pasar de ' || p_largo || ' caracteres'; RAISE e_dato;
    END IF;
    RETURN l_t;
  END txt;

  FUNCTION fecha(
    p_v IN APEX_JSON.T_VALUES, p_path IN VARCHAR2, p_etiqueta IN VARCHAR2,
    p_req IN BOOLEAN DEFAULT FALSE) RETURN DATE
  IS
    l_t VARCHAR2(100) := txt(p_v, p_path, p_etiqueta, 10, p_req);
  BEGIN
    RETURN CASE WHEN l_t IS NOT NULL THEN TO_DATE(l_t, 'YYYY-MM-DD') END;
  EXCEPTION
    WHEN e_dato THEN RAISE;
    WHEN OTHERS THEN
      g_msg := p_etiqueta || ' no es una fecha valida'; RAISE e_dato;
  END fecha;

  FUNCTION num(p_v IN APEX_JSON.T_VALUES, p_path IN VARCHAR2, p0 IN VARCHAR2 DEFAULT NULL)
    RETURN NUMBER IS
  BEGIN
    RETURN f_numero(APEX_JSON.GET_VARCHAR2(p_path => p_path, p0 => p0, p_values => p_v));
  END num;

  ------------------------------------------------------------------------------
  -- Las 4 listas de la ficha: las que vienen con id se actualizan (si son de
  -- este facilitador), las sin id se insertan, y las que no vienen se borran.
  ------------------------------------------------------------------------------
  PROCEDURE guardar_listas(p_v IN APEX_JSON.T_VALUES, p_id IN NUMBER) IS
    l_ids  sys.odcinumberlist;
    l_x    NUMBER;
    l_a    VARCHAR2(4000);
    l_b    VARCHAR2(4000);
    l_c    VARCHAR2(4000);
    l_nuevo NUMBER;

    -- Los id que vienen en la lista p_lista (los ya guardados).
    FUNCTION ids(p_lista IN VARCHAR2) RETURN sys.odcinumberlist IS
      l_r sys.odcinumberlist := sys.odcinumberlist();
      l_i NUMBER;
    BEGIN
      FOR i IN 1 .. NVL(APEX_JSON.GET_COUNT(p_path => p_lista, p_values => p_v), 0) LOOP
        l_i := num(p_v, p_lista || '[%d].id', i);
        IF l_i IS NOT NULL THEN l_r.EXTEND; l_r(l_r.COUNT) := l_i; END IF;
      END LOOP;
      RETURN l_r;
    END ids;
  BEGIN
    -- Nominado por / Referencias personales: misma forma.
    FOR t IN 1 .. 2 LOOP
      DECLARE
        l_lista VARCHAR2(20) := CASE t WHEN 1 THEN 'nominados' ELSE 'referencias' END;
        l_que   VARCHAR2(40) := CASE t WHEN 1 THEN 'Nominado por' ELSE 'Referencia personal' END;
      BEGIN
        l_ids := ids(l_lista);
        IF t = 1 THEN
          DELETE FROM facilitadores_nominado
           WHERE id_facilitador = p_id
             AND id_nominado NOT IN (SELECT column_value FROM TABLE(l_ids));
        ELSE
          DELETE FROM facilitadores_referencia_personal
           WHERE id_facilitador = p_id
             AND id_referencia NOT IN (SELECT column_value FROM TABLE(l_ids));
        END IF;
        FOR i IN 1 .. NVL(APEX_JSON.GET_COUNT(p_path => l_lista, p_values => p_v), 0) LOOP
          l_x := num(p_v, l_lista || '[%d].id', i);
          l_a := txt(p_v, l_lista || '[%d].tipo_relacion', l_que || ': la relacion', 50, TRUE, i);
          l_b := txt(p_v, l_lista || '[%d].nombre_apellido', l_que || ': el nombre', 500, TRUE, i);
          l_c := txt(p_v, l_lista || '[%d].nro_telefono', l_que || ': el telefono', 100, FALSE, i);
          IF t = 1 THEN
            IF l_x IS NOT NULL THEN
              UPDATE facilitadores_nominado
                 SET tipo_relacion = l_a, nombre_apellido = l_b, nro_telefono = l_c
               WHERE id_nominado = l_x AND id_facilitador = p_id;
            ELSE
              BEGIN
                INSERT INTO facilitadores_nominado (id_facilitador, tipo_relacion, nombre_apellido, nro_telefono)
                VALUES (p_id, l_a, l_b, l_c);
              EXCEPTION
                WHEN OTHERS THEN
                  IF SQLCODE <> -1400 OR INSTR(SQLERRM, '"ID_NOMINADO"') = 0 THEN RAISE; END IF;
                  LOCK TABLE facilitadores_nominado IN EXCLUSIVE MODE;
                  SELECT NVL(MAX(id_nominado), 0) + 1 INTO l_nuevo FROM facilitadores_nominado;
                  INSERT INTO facilitadores_nominado
                    (id_nominado, id_facilitador, tipo_relacion, nombre_apellido, nro_telefono)
                  VALUES (l_nuevo, p_id, l_a, l_b, l_c);
              END;
            END IF;
          ELSE
            IF l_x IS NOT NULL THEN
              UPDATE facilitadores_referencia_personal
                 SET tipo_relacion = l_a, nombre_apellido = l_b, nro_telefono = l_c
               WHERE id_referencia = l_x AND id_facilitador = p_id;
            ELSE
              BEGIN
                INSERT INTO facilitadores_referencia_personal
                  (id_facilitador, tipo_relacion, nombre_apellido, nro_telefono)
                VALUES (p_id, l_a, l_b, l_c);
              EXCEPTION
                WHEN OTHERS THEN
                  IF SQLCODE <> -1400 OR INSTR(SQLERRM, '"ID_REFERENCIA"') = 0 THEN RAISE; END IF;
                  LOCK TABLE facilitadores_referencia_personal IN EXCLUSIVE MODE;
                  SELECT NVL(MAX(id_referencia), 0) + 1 INTO l_nuevo FROM facilitadores_referencia_personal;
                  INSERT INTO facilitadores_referencia_personal
                    (id_referencia, id_facilitador, tipo_relacion, nombre_apellido, nro_telefono)
                  VALUES (l_nuevo, p_id, l_a, l_b, l_c);
              END;
            END IF;
          END IF;
        END LOOP;
      END;
    END LOOP;

    -- Estudios.
    l_ids := ids('estudios');
    DELETE FROM facilitadores_estudios
     WHERE id_facilitador = p_id
       AND id_estudio NOT IN (SELECT column_value FROM TABLE(l_ids));
    FOR i IN 1 .. NVL(APEX_JSON.GET_COUNT(p_path => 'estudios', p_values => p_v), 0) LOOP
      l_x := num(p_v, 'estudios[%d].id', i);
      l_a := txt(p_v, 'estudios[%d].nivel_academico', 'Estudios: el nivel', 200, TRUE, i);
      l_b := txt(p_v, 'estudios[%d].titulo', 'Estudios: el titulo', 2000, FALSE, i);
      l_c := txt(p_v, 'estudios[%d].anio', 'Estudios: el anio', 200, FALSE, i);
      IF l_x IS NOT NULL THEN
        UPDATE facilitadores_estudios
           SET nivel_academico = l_a, titulo = l_b, anio = l_c
         WHERE id_estudio = l_x AND id_facilitador = p_id;
      ELSE
        BEGIN
          INSERT INTO facilitadores_estudios (id_facilitador, nivel_academico, titulo, anio)
          VALUES (p_id, l_a, l_b, l_c);
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE <> -1400 OR INSTR(SQLERRM, '"ID_ESTUDIO"') = 0 THEN RAISE; END IF;
            LOCK TABLE facilitadores_estudios IN EXCLUSIVE MODE;
            SELECT NVL(MAX(id_estudio), 0) + 1 INTO l_nuevo FROM facilitadores_estudios;
            INSERT INTO facilitadores_estudios (id_estudio, id_facilitador, nivel_academico, titulo, anio)
            VALUES (l_nuevo, p_id, l_a, l_b, l_c);
        END;
      END IF;
    END LOOP;

    -- Situacion laboral.
    l_ids := ids('laborales');
    DELETE FROM facilitadores_laboral
     WHERE id_facilitador = p_id
       AND id_laboral NOT IN (SELECT column_value FROM TABLE(l_ids));
    FOR i IN 1 .. NVL(APEX_JSON.GET_COUNT(p_path => 'laborales', p_values => p_v), 0) LOOP
      l_x := num(p_v, 'laborales[%d].id', i);
      l_a := txt(p_v, 'laborales[%d].empresa', 'Situacion laboral: la empresa', 800, TRUE, i);
      l_b := txt(p_v, 'laborales[%d].cargo', 'Situacion laboral: el cargo', 800, FALSE, i);
      l_c := txt(p_v, 'laborales[%d].anio', 'Situacion laboral: el anio', 200, FALSE, i);
      IF l_x IS NOT NULL THEN
        UPDATE facilitadores_laboral
           SET empresa = l_a, cargo = l_b, anio = l_c
         WHERE id_laboral = l_x AND id_facilitador = p_id;
      ELSE
        BEGIN
          INSERT INTO facilitadores_laboral (id_facilitador, empresa, cargo, anio)
          VALUES (p_id, l_a, l_b, l_c);
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE <> -1400 OR INSTR(SQLERRM, '"ID_LABORAL"') = 0 THEN RAISE; END IF;
            LOCK TABLE facilitadores_laboral IN EXCLUSIVE MODE;
            SELECT NVL(MAX(id_laboral), 0) + 1 INTO l_nuevo FROM facilitadores_laboral;
            INSERT INTO facilitadores_laboral (id_laboral, id_facilitador, empresa, cargo, anio)
            VALUES (l_nuevo, p_id, l_a, l_b, l_c);
        END;
      END IF;
    END LOOP;
  END guardar_listas;

  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_datos IN CLOB) IS
    v        APEX_JSON.T_VALUES;
    l_id     NUMBER := f_numero(p_id);
    l_n      PLS_INTEGER;
    l_ci_ant VARCHAR2(400);
    l_col    VARCHAR2(128) := col_denominacion;

    l_nombre VARCHAR2(500);   l_ci      VARCHAR2(100);  l_usuario VARCHAR2(100);
    l_fnac   DATE;            l_fing    DATE;
    l_ecivil VARCHAR2(200);   l_vive    VARCHAR2(200);  l_hijos   VARCHAR2(20);
    l_nac    NUMBER;          l_ciudad  NUMBER;         l_barrio  NUMBER;
    l_dep    NUMBER;          l_pais    NUMBER;
    l_tel    VARCHAR2(500);   l_activo  VARCHAR2(20);   l_dir     VARCHAR2(1000);
    l_ubic   VARCHAR2(1000);  l_email   VARCHAR2(500);  l_obs     VARCHAR2(1000);
    l_veh    VARCHAR2(20);    l_tveh    VARCHAR2(100);  l_compu   VARCHAR2(20);
    l_inet   VARCHAR2(20);    l_office  VARCHAR2(20);   l_den     VARCHAR2(200);
    l_igl    VARCHAR2(200);   l_pastor  VARCHAR2(200);  l_tpastor VARCHAR2(100);
    l_lider  VARCHAR2(200);   l_tlider  VARCHAR2(100);  l_baut    VARCHAR2(20);
    l_area   VARCHAR2(500);   l_banco   VARCHAR2(200);  l_sucb    VARCHAR2(200);
    l_titu   VARCHAR2(200);   l_citit   VARCHAR2(50);   l_tcta    VARCHAR2(100);
    l_cta    VARCHAR2(100);   l_emisor  VARCHAR2(200);  l_ruc     VARCHAR2(50);
    l_tfac   VARCHAR2(50);    l_cred    VARCHAR2(20);   l_indub   VARCHAR2(20);
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de facilitador invalido'); RETURN;
    END IF;
    BEGIN
      APEX_JSON.PARSE(v, p_datos);
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'Los datos de la ficha no son un JSON valido'); RETURN;
    END;

    l_nombre  := REGEXP_REPLACE(txt(v, 'nombre_apellido', 'El nombre y apellido', 500, TRUE), ' {2,}', ' ');
    l_ci      := txt(v, 'nro_ci', 'El nro. de CI', 100, TRUE);
    l_usuario := UPPER(txt(v, 'usuario', 'El usuario', 100));
    l_fnac    := fecha(v, 'fecha_nacimiento', 'La fecha de nacimiento', TRUE);
    l_fing    := fecha(v, 'fecha_ingreso', 'La fecha de ingreso');
    l_ecivil  := txt(v, 'estado_civil', 'El estado civil', 200, TRUE);
    l_vive    := txt(v, 'con_quien_vive', 'Con quien vive', 200, TRUE);
    l_hijos   := txt(v, 'hijos', 'Hijos', 20, TRUE);
    l_nac     := num(v, 'id_nacionalidad');
    l_ciudad  := num(v, 'id_ciudad');
    l_barrio  := num(v, 'id_barrio');
    l_tel     := txt(v, 'telefono', 'El telefono', 500, TRUE);
    l_activo  := txt(v, 'activo', 'Activo', 20, TRUE);
    l_dir     := txt(v, 'direccion', 'La direccion', 1000, TRUE);
    l_ubic    := txt(v, 'ubicacion', 'La ubicacion', 1000);
    l_email   := txt(v, 'email', 'El email', 500);
    l_obs     := txt(v, 'observacion', 'La observacion', 1000);
    l_veh     := txt(v, 'vehiculo', 'Vehiculo', 20);
    l_tveh    := txt(v, 'tipo_vehiculo', 'El tipo de vehiculo', 100);
    l_compu   := txt(v, 'computadora', 'Computadora', 20);
    l_inet    := txt(v, 'internet', 'Internet', 20);
    l_office  := txt(v, 'office', 'Office', 20);
    l_den     := txt(v, 'denominacion', 'La denominacion', 200);
    l_igl     := txt(v, 'nombre_iglesia', 'La iglesia', 200);
    l_pastor  := txt(v, 'nombre_pastor', 'El pastor', 200);
    l_tpastor := txt(v, 'nro_telefono_pastor', 'El telefono del pastor', 100);
    l_lider   := txt(v, 'nombre_lider', 'El lider', 200);
    l_tlider  := txt(v, 'nro_telefono_lider', 'El telefono del lider', 100);
    l_baut    := txt(v, 'bautizado_agua', 'Bautizado en agua', 20);
    l_area    := txt(v, 'area_servicio', 'El area de servicio', 500);
    l_banco   := txt(v, 'nombre_banco', 'El banco', 200);
    l_sucb    := txt(v, 'sucursal_banco', 'La sucursal del banco', 200);
    l_titu    := txt(v, 'titular_banco', 'El titular', 200);
    l_citit   := txt(v, 'nro_ci_titular_banco', 'La CI del titular', 50);
    l_tcta    := txt(v, 'tipo_cuenta', 'El tipo de cuenta', 100);
    l_cta     := txt(v, 'nro_cuenta', 'El nro. de cuenta', 100);
    l_emisor  := txt(v, 'nombre_emisor', 'El nombre del emisor', 200);
    l_ruc     := txt(v, 'ruc', 'El RUC', 50);
    l_tfac    := txt(v, 'tipo_factura', 'El tipo de facturacion', 50);
    l_cred    := txt(v, 'credencial', 'Credencial', 20);
    l_indub   := txt(v, 'ind_ubicacion_postulacion', 'Solicita ubicacion', 20);

    IF l_nac IS NULL THEN
      p_error(400, 'Bad Request', 'La nacionalidad es obligatoria'); RETURN;
    END IF;

    -- Ubicacion (ver el encabezado): la ciudad manda; el barrio, si viene,
    -- tiene que ser de esa ciudad. Solo barrio: la ciudad sale del barrio.
    IF l_barrio IS NOT NULL THEN
      BEGIN
        SELECT id_ciudad INTO l_n FROM barrios WHERE id_barrio = l_barrio;
        IF l_ciudad IS NULL THEN
          l_ciudad := l_n;
        ELSIF l_ciudad <> l_n THEN
          p_error(400, 'Bad Request', 'El barrio elegido no es de esa ciudad'); RETURN;
        END IF;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'El barrio elegido no existe'); RETURN;
      END;
    END IF;
    IF l_ciudad IS NOT NULL THEN
      BEGIN
        SELECT c.id_departamento, d.id_pais INTO l_dep, l_pais
          FROM ciudades c LEFT JOIN departamentos d ON d.id_departamento = c.id_departamento
         WHERE c.id_ciudad = l_ciudad;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(400, 'Bad Request', 'La ciudad elegida no existe'); RETURN;
      END;
    END IF;

    -- CI repetida: en un alta, o si se la cambia.
    IF l_id IS NOT NULL THEN
      BEGIN
        SELECT nro_ci INTO l_ci_ant FROM facilitadores WHERE id_facilitador = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'El facilitador no existe'); RETURN;
      END;
    END IF;
    IF l_id IS NULL OR NVL(l_ci_ant, '~') <> l_ci THEN
      FOR r IN (SELECT nombre_apellido FROM facilitadores
                 WHERE TRIM(nro_ci) = l_ci AND (l_id IS NULL OR id_facilitador <> l_id)
                   AND ROWNUM = 1) LOOP
        p_error(409, 'Conflict', 'La CI ' || l_ci || ' ya es de ' || r.nombre_apellido); RETURN;
      END LOOP;
    END IF;

    IF l_id IS NULL THEN
      BEGIN
        INSERT INTO facilitadores (
          usuario, nombre_apellido, nro_ci, fecha_nacimiento, estado_civil, con_quien_vive, hijos,
          id_nacionalidad, id_pais, id_departamento, id_ciudad, id_barrio, fecha_ingreso, telefono,
          activo, direccion, ubicacion, email, observacion, vehiculo, tipo_vehiculo, computadora,
          internet, office, nombre_iglesia, nombre_pastor, nro_telefono_pastor, nombre_lider,
          nro_telefono_lider, bautizado_agua, area_servicio, nombre_banco, sucursal_banco,
          titular_banco, nro_ci_titular_banco, tipo_cuenta, nro_cuenta, nombre_emisor, ruc,
          tipo_factura, credencial, ind_ubicacion_postulacion)
        VALUES (
          l_usuario, l_nombre, l_ci, l_fnac, l_ecivil, l_vive, l_hijos,
          l_nac, l_pais, l_dep, l_ciudad, l_barrio, l_fing, l_tel,
          l_activo, l_dir, l_ubic, l_email, l_obs, l_veh, l_tveh, l_compu,
          l_inet, l_office, l_igl, l_pastor, l_tpastor, l_lider,
          l_tlider, l_baut, l_area, l_banco, l_sucb,
          l_titu, l_citit, l_tcta, l_cta, l_emisor, l_ruc,
          l_tfac, l_cred, l_indub)
        RETURNING id_facilitador INTO l_id;
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLCODE <> -1400 OR INSTR(SQLERRM, '"ID_FACILITADOR"') = 0 THEN RAISE; END IF;
          LOCK TABLE facilitadores IN EXCLUSIVE MODE;
          SELECT NVL(MAX(id_facilitador), 0) + 1 INTO l_id FROM facilitadores;
          INSERT INTO facilitadores (
            id_facilitador,
            usuario, nombre_apellido, nro_ci, fecha_nacimiento, estado_civil, con_quien_vive, hijos,
            id_nacionalidad, id_pais, id_departamento, id_ciudad, id_barrio, fecha_ingreso, telefono,
            activo, direccion, ubicacion, email, observacion, vehiculo, tipo_vehiculo, computadora,
            internet, office, nombre_iglesia, nombre_pastor, nro_telefono_pastor, nombre_lider,
            nro_telefono_lider, bautizado_agua, area_servicio, nombre_banco, sucursal_banco,
            titular_banco, nro_ci_titular_banco, tipo_cuenta, nro_cuenta, nombre_emisor, ruc,
            tipo_factura, credencial, ind_ubicacion_postulacion)
          VALUES (
            l_id,
            l_usuario, l_nombre, l_ci, l_fnac, l_ecivil, l_vive, l_hijos,
            l_nac, l_pais, l_dep, l_ciudad, l_barrio, l_fing, l_tel,
            l_activo, l_dir, l_ubic, l_email, l_obs, l_veh, l_tveh, l_compu,
            l_inet, l_office, l_igl, l_pastor, l_tpastor, l_lider,
            l_tlider, l_baut, l_area, l_banco, l_sucb,
            l_titu, l_citit, l_tcta, l_cta, l_emisor, l_ruc,
            l_tfac, l_cred, l_indub);
      END;
    ELSE
      UPDATE facilitadores SET
        usuario = l_usuario, nombre_apellido = l_nombre, nro_ci = l_ci,
        fecha_nacimiento = l_fnac, estado_civil = l_ecivil, con_quien_vive = l_vive,
        hijos = l_hijos, id_nacionalidad = l_nac, id_pais = l_pais,
        id_departamento = l_dep, id_ciudad = l_ciudad, id_barrio = l_barrio,
        fecha_ingreso = l_fing, telefono = l_tel, activo = l_activo, direccion = l_dir,
        ubicacion = l_ubic, email = l_email, observacion = l_obs, vehiculo = l_veh,
        tipo_vehiculo = l_tveh, computadora = l_compu, internet = l_inet, office = l_office,
        nombre_iglesia = l_igl, nombre_pastor = l_pastor, nro_telefono_pastor = l_tpastor,
        nombre_lider = l_lider, nro_telefono_lider = l_tlider, bautizado_agua = l_baut,
        area_servicio = l_area, nombre_banco = l_banco, sucursal_banco = l_sucb,
        titular_banco = l_titu, nro_ci_titular_banco = l_citit, tipo_cuenta = l_tcta,
        nro_cuenta = l_cta, nombre_emisor = l_emisor, ruc = l_ruc, tipo_factura = l_tfac,
        credencial = l_cred, ind_ubicacion_postulacion = l_indub
       WHERE id_facilitador = l_id;
    END IF;

    -- La denominacion, aparte (columna con tilde: ver el encabezado).
    IF l_col IS NOT NULL THEN
      EXECUTE IMMEDIATE 'UPDATE facilitadores SET ' || DBMS_ASSERT.ENQUOTE_NAME(l_col, FALSE)
                        || ' = :v WHERE id_facilitador = :id' USING l_den, l_id;
    END IF;

    guardar_listas(v, l_id);
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_facilitador', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Facilitador creado'
                                    ELSE 'Facilitador actualizado' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN e_dato THEN
      ROLLBACK;
      p_error(400, 'Bad Request', g_msg);
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  -- Solo si nada lo usa (fuera de su ficha). Sus 4 listas se borran con el.
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id    NUMBER := f_numero(p_id);
    l_hijas t_hijas;
    l_usos  VARCHAR2(4000);
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id de facilitador invalido'); RETURN;
    END IF;

    cargar_hijas(l_hijas, l_id);
    FOR i IN 1 .. l_hijas.COUNT LOOP
      IF l_hijas(i).cuentas.EXISTS(l_id) THEN
        l_usos := l_usos || CASE WHEN l_usos IS NOT NULL THEN ', ' END
                  || l_hijas(i).cuentas(l_id) || ' en ' || LOWER(l_hijas(i).tabla);
      END IF;
    END LOOP;
    IF l_usos IS NOT NULL THEN
      p_error(409, 'Conflict', 'No se puede eliminar: se usa (' || l_usos || ')'); RETURN;
    END IF;

    DELETE FROM facilitadores_nominado            WHERE id_facilitador = l_id;
    DELETE FROM facilitadores_referencia_personal WHERE id_facilitador = l_id;
    DELETE FROM facilitadores_estudios            WHERE id_facilitador = l_id;
    DELETE FROM facilitadores_laboral             WHERE id_facilitador = l_id;
    DELETE FROM facilitadores                     WHERE id_facilitador = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'El facilitador no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Facilitador eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_FACILITADORES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 3) ENDPOINTS ORDS ======================================================
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
BEGIN
  FOR r IN (SELECT 'facilitadores' AS p FROM dual
            UNION ALL SELECT 'facilitadores/opciones' FROM dual
            UNION ALL SELECT 'facilitadores/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facilitadores',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La literal antes que :id, como en roles_paginas.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facilitadores/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'facilitadores/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('facilitadores', 'GET', '
    PKG_FACILITADORES_ETHOS.LISTAR(p_token => l_token);');

  handler('facilitadores/opciones', 'GET', '
    PKG_FACILITADORES_ETHOS.OPCIONES(p_token => l_token);');

  handler('facilitadores/:id', 'GET', '
    PKG_FACILITADORES_ETHOS.FICHA(p_token => l_token, p_id => :id);');

  handler('facilitadores', 'POST', '
    PKG_FACILITADORES_ETHOS.GUARDAR(p_token => l_token, p_id => NULL, p_datos => :datos);');

  handler('facilitadores/:id', 'PUT', '
    PKG_FACILITADORES_ETHOS.GUARDAR(p_token => l_token, p_id => :id, p_datos => :datos);');

  handler('facilitadores/:id', 'DELETE', '
    PKG_FACILITADORES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de facilitadores publicados.');
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
  preflight('facilitadores');
  preflight('facilitadores/opciones');
  preflight('facilitadores/:id');
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
BEGIN
  SELECT status INTO l_estado
    FROM user_objects
   WHERE object_name = 'PKG_FACILITADORES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_FACILITADORES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    facilitadores');
    DBMS_OUTPUT.PUT_LINE('       GET    facilitadores/opciones');
    DBMS_OUTPUT.PUT_LINE('       GET    facilitadores/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   facilitadores');
    DBMS_OUTPUT.PUT_LINE('       PUT    facilitadores/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE facilitadores/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_FACILITADORES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_FACILITADORES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_FACILITADORES_ETHOS no se creo.');
END;
/
