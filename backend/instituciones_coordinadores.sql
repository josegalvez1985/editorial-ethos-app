--------------------------------------------------------------------------------
-- INSTITUCIONES_COORDNADORES  —  quien coordina en cada institucion
--------------------------------------------------------------------------------
--
-- OJO CON LOS NOMBRES: la tabla se llama INSTITUCIONES_COORDNADORES (sin la I
-- de COORDINADORES) y su PK ID_INSTITUION_COORDINADOR (sin la C de
-- INSTITUCION). Asi estan en la base; este archivo y el endpoint usan el
-- nombre bien escrito, y el SQL el de la base.
--
-- El gemelo de instituciones_directores.sql: una fila por coordinador +
-- institucion + periodo (y tipo, nivel, turno). La persona esta en
-- COORDINADORES: ver coordinadores.sql.
--
-- Reemplaza en el sitio al IG "Coordinadores" de la pestana Autoridades del
-- modal 21 de APEX. En el sitio es la pestana Autoridades de
-- /instituciones/:id. La pagina 47 (Instituciones y Coordinadores,
-- /instituciones-coordinadores) es de esta misma tabla: cuando se haga, usa
-- este backend.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     instituciones-coordinadores?id_institucion=  las de una institucion
--                                                        (sin el parametro: todas)
--   GET     instituciones-coordinadores/opciones         tipo, nivel, turno y
--                                                        estado (listas de APEX)
--   POST    instituciones-coordinadores      {id_institucion, id_coordinador,
--                                             periodo, tipo_coordinador, nivel,
--                                             turno, estado, nro_telefono} -> {id}
--   PUT     instituciones-coordinadores/:id  lo mismo
--   DELETE  instituciones-coordinadores/:id
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql y coordinadores.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- DISTINTO DE INSTITUCIONES_DIRECTORES (verificado el 09/10/2026)
--------------------------------------------------------------------------------
--
--   ID_COORDINADOR    NULLABLE en la tabla (APEX ofrecia "Sin Coordinador").
--                     Aca es OBLIGATORIO al guardar: una fila sin persona no
--                     dice nada. Las que ya estan sin persona se listan igual.
--   TIPO_COORDINADOR  VARCHAR2(400), lista de APEX (el "cargo" de esta tabla).
--   PERIODO           VARCHAR2(50) y NULLABLE (en directores es 200 y
--                     obligatorio). La pantalla propone el anio igual.
--   ESTADO            VARCHAR2(20) y NULLABLE.
--   NRO_TELEFONO      CHAR(200): Oracle lo RELLENA con espacios hasta 200. Se
--                     lee con TRIM; sin eso la pantalla recibe el numero con
--                     ~190 espacios atras.
--
-- El ESTADO de estas filas tambien lo cambia TRG_UPD_ESTADO_INSTITUCIONES al
-- cambiar el de la institucion (ver instituciones.sql).
--
--------------------------------------------------------------------------------
-- PERMISOS, REPETIDOS
--------------------------------------------------------------------------------
--
--   - GET pide solo sesion.
--   - Escribir lo puede quien puede MODIFICAR instituciones (/instituciones, la
--     16) —el IG estaba en el modal 21— o quien tenga la accion en
--     /instituciones-coordinadores (la 47).
--   - La misma persona en la misma institucion con el mismo periodo, tipo,
--     nivel y turno: 409.
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
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'backend/roles_paginas.sql' FROM dual
            UNION ALL SELECT 'PKG_COORDINADORES_ETHOS', 'backend/coordinadores.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = 'PACKAGE BODY';
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'INSTITUCIONES_COORDNADORES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla INSTITUCIONES_COORDNADORES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla INSTITUCIONES_COORDNADORES encontrada.');
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'INSTITUCIONES_COORDNADORES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    SELECT COUNT(*) INTO l_n FROM instituciones_coordnadores WHERE id_coordinador IS NULL;
    IF l_n > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[WARN] ' || l_n || ' fila(s) sin coordinador: se listan como '
                           || '"Sin coordinador" y piden elegir uno al editarlas.');
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_INST_COORDINADORES_ETHOS AS

  -- Las de una institucion; sin p_id_institucion, todas.
  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion.
  PROCEDURE guardar(
    p_token            IN VARCHAR2,
    p_id               IN VARCHAR2,
    p_id_institucion   IN VARCHAR2,
    p_id_coordinador   IN VARCHAR2,
    p_periodo          IN VARCHAR2,
    p_tipo_coordinador IN VARCHAR2,
    p_nivel            IN VARCHAR2,
    p_turno            IN VARCHAR2,
    p_estado           IN VARCHAR2,
    p_nro_telefono     IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

END PKG_INST_COORDINADORES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_INST_COORDINADORES_ETHOS AS

  c_ruta       CONSTANT VARCHAR2(40) := '/instituciones-coordinadores';
  c_ruta_ficha CONSTANT VARCHAR2(40) := '/instituciones';
  c_app_id     CONSTANT NUMBER       := 40587;
  c_workspace  CONSTANT VARCHAR2(64) := 'FUNDCARAC';

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
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La institucion o el coordinador elegido no existe');
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

  -- Si el usuario puede p_accion en la pagina de p_ruta. Sin pagina, no.
  FUNCTION puede(p_usuario IN VARCHAR2, p_ruta IN VARCHAR2, p_accion IN VARCHAR2)
    RETURN BOOLEAN IS
    l_pagina NUMBER;
  BEGIN
    l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta(p_ruta);
    RETURN l_pagina IS NOT NULL
       AND PKG_ROLES_PAGINAS_ETHOS.puede(p_usuario, l_pagina, p_accion) = 'S';
  EXCEPTION
    WHEN OTHERS THEN RETURN FALSE;
  END puede;

  -- Sesion + permiso (ver el encabezado). 'C' pide solo sesion.
  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    IF p_accion = 'C'
       OR puede(l_usuario, c_ruta_ficha, 'U')
       OR puede(l_usuario, c_ruta, p_accion) THEN
      RETURN TRUE;
    END IF;
    p_error(403, 'Forbidden', 'No tenes permiso para modificar los coordinadores de las instituciones');
    RETURN FALSE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  -- Mismo orden y forma que instituciones_directores.sql: `rol` es el tipo.
  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2) IS
    l_inst NUMBER := f_numero(p_id_institucion);
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    IF p_id_institucion IS NOT NULL AND l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'Id de institucion invalido'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT ic.id_instituion_coordinador AS id, ic.periodo, ic.id_institucion,
               i.nombre AS institucion,
               ic.id_coordinador, c.nombre_apellido AS coordinador, c.nro_ci AS coordinador_ci,
               TRIM(c.nro_telefono) AS coordinador_telefono,
               ic.tipo_coordinador, ic.nivel, ic.turno, ic.estado,
               CASE WHEN UPPER(TRIM(ic.estado)) = 'A' THEN 'S' ELSE 'N' END AS es_activo,
               -- CHAR(200): ver el encabezado.
               TRIM(ic.nro_telefono) AS nro_telefono
          FROM instituciones_coordnadores ic
          JOIN instituciones i      ON i.id_institucion = ic.id_institucion
          LEFT JOIN coordinadores c ON c.id_coordinador = ic.id_coordinador
         WHERE l_inst IS NULL OR ic.id_institucion = l_inst
         ORDER BY CASE WHEN UPPER(TRIM(ic.estado)) = 'A' THEN 0 ELSE 1 END,
                  ic.periodo DESC NULLS LAST, UPPER(c.nombre_apellido)
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',               r.id);
      APEX_JSON.WRITE('periodo',          r.periodo);
      APEX_JSON.WRITE('id_institucion',   r.id_institucion);
      APEX_JSON.WRITE('institucion',      r.institucion);
      APEX_JSON.WRITE('id_persona',       r.id_coordinador);
      APEX_JSON.WRITE('persona',          r.coordinador);
      APEX_JSON.WRITE('persona_ci',       r.coordinador_ci);
      APEX_JSON.WRITE('persona_telefono', r.coordinador_telefono);
      APEX_JSON.WRITE('rol',              r.tipo_coordinador);
      APEX_JSON.WRITE('nivel',            r.nivel);
      APEX_JSON.WRITE('turno',            r.turno);
      APEX_JSON.WRITE('estado',           r.estado);
      APEX_JSON.WRITE('es_activo',        r.es_activo);
      APEX_JSON.WRITE('nro_telefono',     r.nro_telefono);
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

  -- Igual que en facilitadores.sql (ver escribir_lista ahi).
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

  -- Los ids son los de las listas del IG "Coordinadores" del modal 21.
  PROCEDURE opciones(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    escribir_lista('rol', NULL, 69209470633545987386,
      'SELECT DISTINCT tipo_coordinador FROM instituciones_coordnadores'
      || ' WHERE tipo_coordinador IS NOT NULL ORDER BY 1');
    escribir_lista('nivel', NULL, 68826020180609557379,
      'SELECT DISTINCT nivel FROM instituciones_coordnadores WHERE nivel IS NOT NULL ORDER BY 1');
    escribir_lista('turno', NULL, 74775417278992928888,
      'SELECT DISTINCT turno FROM instituciones_coordnadores WHERE turno IS NOT NULL ORDER BY 1');
    escribir_lista('estado', 'ACTIVO_INACTIVO', 11839528633369166338,
      'SELECT DISTINCT estado FROM instituciones_coordnadores WHERE estado IS NOT NULL ORDER BY 1');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(
    p_token            IN VARCHAR2,
    p_id               IN VARCHAR2,
    p_id_institucion   IN VARCHAR2,
    p_id_coordinador   IN VARCHAR2,
    p_periodo          IN VARCHAR2,
    p_tipo_coordinador IN VARCHAR2,
    p_nivel            IN VARCHAR2,
    p_turno            IN VARCHAR2,
    p_estado           IN VARCHAR2,
    p_nro_telefono     IN VARCHAR2)
  IS
    -- 32767: ver sucursales.sql. Los topes reales se validan abajo.
    l_periodo VARCHAR2(32767) := TRIM(p_periodo);
    l_tipo    VARCHAR2(32767) := TRIM(p_tipo_coordinador);
    l_nivel   VARCHAR2(32767) := TRIM(p_nivel);
    l_turno   VARCHAR2(32767) := TRIM(p_turno);
    l_estado  VARCHAR2(32767) := TRIM(p_estado);
    l_tel     VARCHAR2(32767) := TRIM(p_nro_telefono);
    l_id      NUMBER := f_numero(p_id);
    l_inst    NUMBER := f_numero(p_id_institucion);
    l_coord   NUMBER := f_numero(p_id_coordinador);
    l_n       PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    -- Obligatorio aca aunque la tabla lo deje en NULL: ver el encabezado.
    IF l_coord IS NULL THEN
      p_error(400, 'Bad Request', 'El coordinador es obligatorio'); RETURN;
    END IF;
    IF LENGTH(l_periodo) > 50 THEN
      p_error(400, 'Bad Request', 'El periodo no puede pasar de 50 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_estado) > 20 THEN
      p_error(400, 'Bad Request', 'El estado no es valido'); RETURN;
    END IF;
    IF LENGTH(l_tipo) > 400 THEN
      p_error(400, 'Bad Request', 'El tipo no puede pasar de 400 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_nivel) > 50 OR LENGTH(l_turno) > 50 THEN
      p_error(400, 'Bad Request', 'Nivel y turno no pueden pasar de 50 caracteres'); RETURN;
    END IF;
    IF LENGTH(l_tel) > 200 THEN
      p_error(400, 'Bad Request', 'El telefono no puede pasar de 200 caracteres'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM instituciones_coordnadores
     WHERE id_institucion = l_inst AND id_coordinador = l_coord
       AND NVL(periodo, '~')          = NVL(l_periodo, '~')
       AND NVL(tipo_coordinador, '~') = NVL(l_tipo, '~')
       AND NVL(nivel, '~')            = NVL(l_nivel, '~')
       AND NVL(turno, '~')            = NVL(l_turno, '~')
       AND (l_id IS NULL OR id_instituion_coordinador <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict',
              'Ese coordinador ya figura en la institucion con el mismo periodo, tipo, '
              || 'nivel y turno'); RETURN;
    END IF;

    IF l_id IS NULL THEN
      INSERT INTO instituciones_coordnadores (
        id_institucion, id_coordinador, tipo_coordinador, estado, nivel, turno,
        periodo, nro_telefono)
      VALUES (
        l_inst, l_coord, l_tipo, l_estado, l_nivel, l_turno, l_periodo, l_tel)
      RETURNING id_instituion_coordinador INTO l_id;
    ELSE
      UPDATE instituciones_coordnadores
         SET id_institucion = l_inst, id_coordinador = l_coord,
             tipo_coordinador = l_tipo, estado = l_estado, nivel = l_nivel,
             turno = l_turno, periodo = l_periodo, nro_telefono = l_tel
       WHERE id_instituion_coordinador = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'La fila no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Coordinador agregado'
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
    l_id NUMBER := f_numero(p_id);
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;

    DELETE FROM instituciones_coordnadores WHERE id_instituion_coordinador = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'La fila no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Coordinador quitado de la institucion');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

END PKG_INST_COORDINADORES_ETHOS;
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

  c_campos CONSTANT VARCHAR2(600) := '
        p_id_institucion => :id_institucion, p_id_coordinador => :id_coordinador,
        p_periodo => :periodo, p_tipo_coordinador => :tipo_coordinador,
        p_nivel => :nivel, p_turno => :turno, p_estado => :estado,
        p_nro_telefono => :nro_telefono);';

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
  FOR r IN (SELECT 'instituciones-coordinadores' AS p FROM dual
            UNION ALL SELECT 'instituciones-coordinadores/opciones' FROM dual
            UNION ALL SELECT 'instituciones-coordinadores/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones-coordinadores',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La literal antes que :id, como en facilitadores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones-coordinadores/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'instituciones-coordinadores/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('instituciones-coordinadores', 'GET', '
    PKG_INST_COORDINADORES_ETHOS.LISTAR(p_token => l_token, p_id_institucion => :id_institucion);');

  handler('instituciones-coordinadores/opciones', 'GET', '
    PKG_INST_COORDINADORES_ETHOS.OPCIONES(p_token => l_token);');

  handler('instituciones-coordinadores', 'POST', '
    PKG_INST_COORDINADORES_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('instituciones-coordinadores/:id', 'PUT', '
    PKG_INST_COORDINADORES_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('instituciones-coordinadores/:id', 'DELETE', '
    PKG_INST_COORDINADORES_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de instituciones-coordinadores publicados.');
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
  preflight('instituciones-coordinadores');
  preflight('instituciones-coordinadores/opciones');
  preflight('instituciones-coordinadores/:id');
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
   WHERE object_name = 'PKG_INST_COORDINADORES_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_INST_COORDINADORES_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    instituciones-coordinadores?id_institucion=');
    DBMS_OUTPUT.PUT_LINE('       GET    instituciones-coordinadores/opciones');
    DBMS_OUTPUT.PUT_LINE('       POST   instituciones-coordinadores');
    DBMS_OUTPUT.PUT_LINE('       PUT    instituciones-coordinadores/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE instituciones-coordinadores/:id');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INST_COORDINADORES_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_INST_COORDINADORES_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_INST_COORDINADORES_ETHOS no se creo.');
END;
/
