--------------------------------------------------------------------------------
-- HORARIO_INSTITUCIONES  —  el horario de cada institucion, por anio
--------------------------------------------------------------------------------
--
-- Los bloques horarios de una institucion (turno, hora de inicio y de fin), por
-- anio lectivo. Es lo que el PDF de postulaciones (pagina 60 de APEX) imprime
-- como "Horarios".
--
-- Reemplaza en el sitio al modal 33 de APEX (Horarios), que se abria con el
-- boton "Horario IE" del 21. En el sitio es la pestana Horario de
-- /instituciones/:id, con los permisos de la 16. La pagina 31 (Horarios de
-- Instituciones, /horarios-instituciones) es de esta misma tabla: cuando se
-- haga, usa este backend.
--
-- QUE PUBLICA ESTE SCRIPT
--
--   GET     horario-instituciones?id_institucion=  los bloques de una institucion,
--                                                  de TODOS los anios (sin el
--                                                  parametro: de todas)
--   GET     horario-instituciones/opciones         los turnos (lista de APEX)
--   POST    horario-instituciones           {id_institucion, turno, hora_inicio,
--                                            hora_fin, observacion, anio} -> {id}
--   PUT     horario-instituciones/:id       lo mismo
--   DELETE  horario-instituciones/:id
--   POST    horario-instituciones/copiar    {id_institucion, desde} copia los
--                                           bloques del anio `desde` al anio
--                                           lectivo actual
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql y anios_lectivos.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EL ANIO   <-- distinto de APEX
--------------------------------------------------------------------------------
--
-- ANIO (VARCHAR2(16)) lo completa un trigger con el anio lectivo activo si
-- viene vacio. Hay DOS que hacen lo mismo (TRG_ANIO_LECTIVO y
-- TRG_HORARIO_INSTITUCIONES_SET_ANIO, verificado el 09/10/2026): no molestan,
-- no se tocan.
--
-- El modal 33 mostraba los bloques de TODOS los anios mezclados, pero el PDF de
-- la 60 imprime solo los del anio elegido. La pantalla los separa por anio, abre
-- en el actual, y si el actual esta vacio ofrece copiar el de otro anio (POST
-- copiar), que en APEX era volver a cargarlo a mano. Copiar se niega si el anio
-- actual ya tiene bloques: duplicaria el horario.
--
-- Un alta puede mandar `anio` (cargar un anio que no es el actual); sin `anio`
-- lo pone el trigger. Una modificacion sin `anio` lo deja como estaba.
--
--------------------------------------------------------------------------------
-- HORAS Y TOTAL
--------------------------------------------------------------------------------
--
-- HORA_INICIO y HORA_FIN son DATE; solo importa la hora. Se guardan sobre el
-- 01/01/2025, la misma fecha que usa TRG_POSTULACIONES_SET_FEC_HORA en
-- POSTULACIONES. Viajan como 'HH:MM' (24 h). Las cargadas desde APEX tienen
-- otra fecha (la que ponia el IG): por eso todo se compara y ordena por
-- TO_CHAR(..., 'HH24:MI'), nunca por la fecha.
--
-- TOTAL (VARCHAR2(20)) es la duracion 'HH:MM'. En APEX la calculaba un
-- JavaScript del IG; aca la calcula el backend al guardar, y la hora de fin
-- tiene que ser posterior a la de inicio (APEX la dejaba en 00:00).
--
-- TURNO es NUMBER (1 manana, 2 tarde, 3 noche, segun la lista de APEX): el
-- mismo dominio que POSTULACIONES.TURNO, NO el texto de las autoridades.
--
--------------------------------------------------------------------------------
-- PERMISOS
--------------------------------------------------------------------------------
--
--   - GET pide solo sesion.
--   - Escribir lo puede quien puede MODIFICAR instituciones (/instituciones, la
--     16) —el modal 33 colgaba del 21— o quien tenga la accion en
--     /horarios-instituciones (la 31). Copiar es insertar.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'PACKAGE BODY' AS tipo,
                   'backend/auth.sql' AS script FROM dual
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'PACKAGE BODY',
                   'backend/roles_paginas.sql' FROM dual
            UNION ALL SELECT 'FN_ANIO_LECTIVO_ACTUAL', 'FUNCTION',
                   'backend/anios_lectivos.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM all_objects
     WHERE object_name = o.nombre AND object_type = o.tipo;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || o.nombre || '. Corre ' || o.script || ' primero.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || o.nombre || ' encontrado.');
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'HORARIO_INSTITUCIONES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla HORARIO_INSTITUCIONES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla HORARIO_INSTITUCIONES encontrada.');
    FOR tr IN (SELECT trigger_name, triggering_event FROM user_triggers
                WHERE table_name = 'HORARIO_INSTITUCIONES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger ' || tr.trigger_name || ' (' || tr.triggering_event || ')');
    END LOOP;
    SELECT COUNT(*) INTO l_n FROM horario_instituciones WHERE anio IS NULL;
    IF l_n > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[WARN] ' || l_n || ' bloque(s) sin ANIO: la pantalla los muestra '
                           || 'aparte y se pueden copiar al actual.');
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

CREATE OR REPLACE PACKAGE PKG_HORARIO_INST_ETHOS AS

  -- Los de una institucion (todos los anios); sin p_id_institucion, todos.
  PROCEDURE listar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2);

  PROCEDURE opciones(p_token IN VARCHAR2);

  -- Alta (p_id NULL) o modificacion. Horas 'HH:MM'.
  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_id_institucion IN VARCHAR2,
    p_turno          IN VARCHAR2,
    p_hora_inicio    IN VARCHAR2,
    p_hora_fin       IN VARCHAR2,
    p_observacion    IN VARCHAR2,
    p_anio           IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- Los bloques del anio p_desde (NULL = los sin anio) al anio lectivo actual.
  PROCEDURE copiar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_desde IN VARCHAR2);

END PKG_HORARIO_INST_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_HORARIO_INST_ETHOS AS

  c_ruta       CONSTANT VARCHAR2(40) := '/horarios-instituciones';
  c_ruta_ficha CONSTANT VARCHAR2(40) := '/instituciones';
  c_app_id     CONSTANT NUMBER       := 40587;
  c_workspace  CONSTANT VARCHAR2(64) := 'FUNDCARAC';
  -- La fecha sobre la que se guardan las horas (ver el encabezado).
  c_fecha      CONSTANT VARCHAR2(10) := '01/01/2025';

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
        p_error(400, 'Bad Request', 'La institucion elegida no existe');
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

  -- 'HH:MM' (24 h) sobre c_fecha, o NULL si no es una hora valida.
  FUNCTION f_hora(p_txt IN VARCHAR2) RETURN DATE IS
    l_t VARCHAR2(4000) := TRIM(p_txt);
  BEGIN
    IF l_t IS NULL OR NOT REGEXP_LIKE(l_t, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$') THEN
      RETURN NULL;
    END IF;
    RETURN TO_DATE(c_fecha || ' ' || l_t, 'DD/MM/YYYY HH24:MI');
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_hora;

  FUNCTION f_anio RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(FN_ANIO_LECTIVO_ACTUAL());
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_anio;

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
    p_error(403, 'Forbidden', 'No tenes permiso para modificar el horario de las instituciones');
    RETURN FALSE;
  END exigir;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

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
    APEX_JSON.WRITE('anio_actual', f_anio);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT h.id_hora, h.id_institucion, i.nombre AS institucion, h.turno,
               TO_CHAR(h.hora_inicio, 'HH24:MI') AS hora_inicio,
               TO_CHAR(h.hora_fin, 'HH24:MI')    AS hora_fin,
               h.total, h.observacion, h.anio
          FROM horario_instituciones h
          JOIN instituciones i ON i.id_institucion = h.id_institucion
         WHERE l_inst IS NULL OR h.id_institucion = l_inst
         ORDER BY h.anio DESC NULLS LAST, h.turno,
                  TO_CHAR(h.hora_inicio, 'HH24:MI'), TO_CHAR(h.hora_fin, 'HH24:MI')
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',             r.id_hora);
      APEX_JSON.WRITE('id_institucion', r.id_institucion);
      APEX_JSON.WRITE('institucion',    r.institucion);
      APEX_JSON.WRITE('turno',          r.turno);
      APEX_JSON.WRITE('hora_inicio',    r.hora_inicio);
      APEX_JSON.WRITE('hora_fin',       r.hora_fin);
      APEX_JSON.WRITE('total',          r.total);
      APEX_JSON.WRITE('observacion',    r.observacion);
      APEX_JSON.WRITE('anio',           r.anio);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  /* ---------------------------------------------------------------------- */
  /* OPCIONES                                                               */
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

  -- La lista de turnos del IG del modal 33 (la misma de POSTULACIONES.TURNO).
  PROCEDURE opciones(p_token IN VARCHAR2) IS
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('anio_actual', f_anio);
    escribir_lista('turno', NULL, 86501754240348596707,
      'SELECT TO_CHAR(turno) FROM (SELECT DISTINCT turno FROM horario_instituciones'
      || ' WHERE turno IS NOT NULL) ORDER BY turno');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END opciones;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_id_institucion IN VARCHAR2,
    p_turno          IN VARCHAR2,
    p_hora_inicio    IN VARCHAR2,
    p_hora_fin       IN VARCHAR2,
    p_observacion    IN VARCHAR2,
    p_anio           IN VARCHAR2)
  IS
    l_obs   VARCHAR2(32767) := TRIM(p_observacion);
    l_anio  VARCHAR2(32767) := TRIM(p_anio);
    l_id    NUMBER := f_numero(p_id);
    l_inst  NUMBER := f_numero(p_id_institucion);
    l_turno NUMBER := f_numero(p_turno);
    l_ini   DATE   := f_hora(p_hora_inicio);
    l_fin   DATE   := f_hora(p_hora_fin);
    l_min   PLS_INTEGER;
    l_total VARCHAR2(20);
  BEGIN
    IF NOT exigir(p_token, CASE WHEN p_id IS NULL THEN 'I' ELSE 'U' END) THEN RETURN; END IF;
    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    IF l_turno IS NULL THEN
      p_error(400, 'Bad Request', 'El turno es obligatorio'); RETURN;
    END IF;
    IF l_ini IS NULL OR l_fin IS NULL THEN
      p_error(400, 'Bad Request', 'La hora de inicio y la de fin son obligatorias (HH:MM)'); RETURN;
    END IF;
    IF l_fin <= l_ini THEN
      p_error(400, 'Bad Request', 'La hora de fin tiene que ser posterior a la de inicio'); RETURN;
    END IF;
    IF LENGTH(l_obs) > 2000 THEN
      p_error(400, 'Bad Request', 'La observacion no puede pasar de 2000 caracteres'); RETURN;
    END IF;
    IF l_anio IS NOT NULL AND NOT REGEXP_LIKE(l_anio, '^[0-9]{4}$') THEN
      p_error(400, 'Bad Request', 'El ' || UNISTR('a\00f1o') || ' no es valido'); RETURN;
    END IF;

    -- La duracion 'HH:MM' (ver el encabezado).
    l_min   := ROUND((l_fin - l_ini) * 24 * 60);
    l_total := LPAD(TRUNC(l_min / 60), 2, '0') || ':' || LPAD(MOD(l_min, 60), 2, '0');

    IF l_id IS NULL THEN
      -- Sin anio, lo pone el trigger (el lectivo actual).
      INSERT INTO horario_instituciones (
        turno, id_institucion, hora_inicio, hora_fin, observacion, total, anio)
      VALUES (
        l_turno, l_inst, l_ini, l_fin, l_obs, l_total, l_anio)
      RETURNING id_hora INTO l_id;
    ELSE
      UPDATE horario_instituciones
         SET turno = l_turno, id_institucion = l_inst, hora_inicio = l_ini,
             hora_fin = l_fin, observacion = l_obs, total = l_total,
             anio = NVL(l_anio, anio)
       WHERE id_hora = l_id;
      IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'El bloque no existe'); RETURN;
      END IF;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id', l_id);
    APEX_JSON.WRITE('total', l_total);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Bloque agregado'
                                    ELSE 'Bloque actualizado' END);
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

    DELETE FROM horario_instituciones WHERE id_hora = l_id;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'El bloque no existe'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Bloque eliminado');
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* COPIAR UN ANIO AL ACTUAL                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE copiar(p_token IN VARCHAR2, p_id_institucion IN VARCHAR2, p_desde IN VARCHAR2) IS
    l_inst  NUMBER := f_numero(p_id_institucion);
    l_desde VARCHAR2(4000) := TRIM(p_desde);
    l_hacia VARCHAR2(16) := f_anio;
    l_n     PLS_INTEGER;
  BEGIN
    IF NOT exigir(p_token, 'I') THEN RETURN; END IF;
    IF l_inst IS NULL THEN
      p_error(400, 'Bad Request', 'La institucion es obligatoria'); RETURN;
    END IF;
    IF l_hacia IS NULL THEN
      p_error(409, 'Conflict', 'No hay un ' || UNISTR('a\00f1o') || ' lectivo activo (ver ANIOS_LECTIVOS)'); RETURN;
    END IF;
    IF l_desde = l_hacia THEN
      p_error(400, 'Bad Request', 'El ' || UNISTR('a\00f1o') || ' de origen es el actual'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM horario_instituciones
     WHERE id_institucion = l_inst AND anio = l_hacia;
    IF l_n > 0 THEN
      p_error(409, 'Conflict',
              'El horario de ' || l_hacia || ' ya tiene bloques: copiar los duplicaria'); RETURN;
    END IF;

    INSERT INTO horario_instituciones (
      turno, id_institucion, hora_inicio, hora_fin, observacion, total, anio)
    SELECT turno, id_institucion, hora_inicio, hora_fin, observacion, total, l_hacia
      FROM horario_instituciones
     WHERE id_institucion = l_inst
       AND (anio = l_desde OR (l_desde IS NULL AND anio IS NULL));
    l_n := SQL%ROWCOUNT;
    IF l_n = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'No hay bloques en ese ' || UNISTR('a\00f1o') || ' para copiar'); RETURN;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('copiados', l_n);
    APEX_JSON.WRITE('anio', l_hacia);
    APEX_JSON.WRITE('message', l_n || ' bloque(s) copiados a ' || l_hacia);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END copiar;

END PKG_HORARIO_INST_ETHOS;
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
        p_id_institucion => :id_institucion, p_turno => :turno,
        p_hora_inicio => :hora_inicio, p_hora_fin => :hora_fin,
        p_observacion => :observacion, p_anio => :anio);';

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
  FOR r IN (SELECT 'horario-instituciones' AS p FROM dual
            UNION ALL SELECT 'horario-instituciones/opciones' FROM dual
            UNION ALL SELECT 'horario-instituciones/copiar' FROM dual
            UNION ALL SELECT 'horario-instituciones/:id' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'horario-instituciones',
                       p_priority => 0, p_etag_type => 'NONE');
  -- Las literales antes que :id, como en facilitadores.sql.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'horario-instituciones/opciones',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'horario-instituciones/copiar',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'horario-instituciones/:id',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('horario-instituciones', 'GET', '
    PKG_HORARIO_INST_ETHOS.LISTAR(p_token => l_token, p_id_institucion => :id_institucion);');

  handler('horario-instituciones/opciones', 'GET', '
    PKG_HORARIO_INST_ETHOS.OPCIONES(p_token => l_token);');

  handler('horario-instituciones', 'POST', '
    PKG_HORARIO_INST_ETHOS.GUARDAR(p_token => l_token, p_id => NULL,' || c_campos);

  handler('horario-instituciones/:id', 'PUT', '
    PKG_HORARIO_INST_ETHOS.GUARDAR(p_token => l_token, p_id => :id,' || c_campos);

  handler('horario-instituciones/:id', 'DELETE', '
    PKG_HORARIO_INST_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');

  handler('horario-instituciones/copiar', 'POST', '
    PKG_HORARIO_INST_ETHOS.COPIAR(
        p_token => l_token, p_id_institucion => :id_institucion, p_desde => :desde);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de horario-instituciones publicados.');
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
  preflight('horario-instituciones');
  preflight('horario-instituciones/opciones');
  preflight('horario-instituciones/copiar');
  preflight('horario-instituciones/:id');
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
   WHERE object_name = 'PKG_HORARIO_INST_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_HORARIO_INST_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    horario-instituciones?id_institucion=');
    DBMS_OUTPUT.PUT_LINE('       GET    horario-instituciones/opciones');
    DBMS_OUTPUT.PUT_LINE('       POST   horario-instituciones');
    DBMS_OUTPUT.PUT_LINE('       PUT    horario-instituciones/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE horario-instituciones/:id');
    DBMS_OUTPUT.PUT_LINE('       POST   horario-instituciones/copiar');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_HORARIO_INST_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_HORARIO_INST_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_HORARIO_INST_ETHOS no se creo.');
END;
/
