--------------------------------------------------------------------------------
-- POSTULANTES_FACILITADORES  —  revisar las postulaciones de facilitadores
--------------------------------------------------------------------------------
--
-- 24/11/2026, pedido de Jose. Pantalla nueva, no viene de APEX: /postulantes
-- (menu Nucleo de Datos), con la ficha en /postulantes/:id.
--
-- !! TABLA COMPARTIDA !!
--
--   POSTULANTES_FACILITADORES la llena OTRA APP sobre la misma base (el
--   formulario JV26 y la app de facilitadores). Este script NO le hace ningun
--   DDL: ni columnas, ni constraints, ni triggers, ni comentarios. Si la tabla
--   no existe, avisa y no crea nada (la estructura es de esa app). Lo unico que
--   agrega es lo del sitio: el paquete PKG_POSTULANTES_FAC_ETHOS y las rutas
--   postulantes* del modulo ORDS ethos. Ver README -> "Una tabla que comparte
--   otra app".
--
-- QUE PUBLICA
--
--   Las rutas son revision-postulantes/*. Una version anterior de este script
--   (24/11/2026) publicaba postulantes/*: el bloque "LIMPIEZA" de abajo las
--   borra, pero SOLO si todos sus handlers llaman a este paquete. Una ruta
--   postulantes* de otro sistema no se toca.
--
--   GET     revision-postulantes?id_anio=  los años lectivos (con cuantas tiene
--                                    cada uno) y las postulaciones del pedido
--                                    (sin id_anio: el vigente)
--   GET     revision-postulantes/:id   la ficha completa
--   PUT     revision-postulantes/:id   la ficha (cuerpo JSON crudo, :body_text:
--                                    AREAS_MINISTERIO es CLOB). Borra de
--                                    Cloudinary, DESPUES del COMMIT, los
--                                    archivos reemplazados o quitados.
--   PUT     revision-postulantes/:id/estado {estado, observacion}: la revision
--   DELETE  revision-postulantes/:id   la postulacion y sus archivos de
--                                    Cloudinary (despues del COMMIT)
--   POST    revision-postulantes/firma la firma para subir un archivo a
--                                    Cloudinary (como facturas: el preset de
--                                    CLOUDINARY_CONFIG, carpeta
--                                    postulaciones-facilitadores)
--
--   No hay alta: las postulaciones llegan por el formulario de la otra app.
--
-- CORRER DESPUES de auth.sql, roles_paginas.sql y cloudinary.sql (el mismo
-- servicio que usan las facturas; no hace falta volver a correrlo).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- VERIFICACION PREVIA (solo lectura, en SQL Commands, ANTES de correrlo):
--
--   -- a) Que el paquete y las rutas no existan ya para otra cosa.
--   SELECT object_name, object_type, status FROM user_objects
--    WHERE object_name = 'PKG_POSTULANTES_FAC_ETHOS';
--   SELECT m.name modulo, t.uri_template
--     FROM user_ords_templates t JOIN user_ords_modules m ON m.id = t.module_id
--    WHERE LOWER(t.uri_template) LIKE '%postulantes%';
--
--   -- b) Lo que la otra app tiene colgado de la tabla: sus triggers saltan
--   --    tambien con lo que guarda el sitio (y el de "aprobar crea el
--   --    facilitador" puede estar ya ahi).
--   SELECT trigger_name, trigger_type, triggering_event, status
--     FROM user_triggers WHERE table_name = 'POSTULANTES_FACILITADORES';
--   SELECT c.table_name hija, c.constraint_name, c.delete_rule
--     FROM user_constraints c JOIN user_constraints p
--       ON p.constraint_name = c.r_constraint_name
--    WHERE p.table_name = 'POSTULANTES_FACILITADORES' AND c.constraint_type = 'R';
--
--   -- c) Como guarda la otra app los dias y la ubicacion (la pantalla los
--   --    escribe igual: dias en MAYUSCULAS sin tilde separados por coma, y
--   --    ubicacion 'lat,lng').
--   SELECT dias_disponibles, ubicacion_domicilio FROM postulantes_facilitadores
--    FETCH FIRST 5 ROWS ONLY;
--
--------------------------------------------------------------------------------
-- LOS ARCHIVOS
--------------------------------------------------------------------------------
--
--   *_URL      Cloudinary: FOTO, CEDULA_FRENTE, CEDULA_DORSO y los documentos
--              de SECUNDARIO, TECNICO, LICENCIATURA y POSGRADO. El sitio los
--              sube, reemplaza y quita. Un enlace NUEVO tiene que ser de
--              nuestro cloud (es_url_propia); uno que no cambia se acepta
--              como venga. Al reemplazar o quitar, el viejo se borra de
--              Cloudinary despues del COMMIT, salvo que otra fila de la tabla
--              lo use. Si Cloudinary falla, se avisa (aviso) y nada mas.
--   *_ARCHIVO  OneDrive: CV, certificado de no agresor y antecedentes judicial
--              y policial. Son enlaces o rutas de texto; el sitio los guarda y
--              los abre, no los sube ni los borra.
--
-- LA REVISION
--
--   ESTADO PENDIENTE / APROBADA / RECHAZADA, con OBSERVACION_ADMIN y
--   FECHA_REVISION (hora de Paraguay; NULL al volver a PENDIENTE). Rechazar
--   pide observacion. Va en su propio PUT: guardar la ficha no la cambia.
--
-- APROBAR PASA EL POSTULANTE A FACILITADORES (TRG_POSTULANTES_FAC_APROBAR)
--
--   24/11/2026, pedido de Jose. Al pasar ESTADO a 'APROBADA' (desde el sitio
--   o desde la otra app: es un trigger de la tabla):
--     - Sin ID_FACILITADOR: si ya hay un facilitador con la misma cedula, se
--       usa ese; si no, se CREA uno nuevo con los datos de la postulacion.
--     - Con ID_FACILITADOR (o encontrado por cedula): se ACTUALIZAN sus datos
--       con los de la postulacion (lo que viene vacio no borra lo que habia).
--     - En los dos casos queda ACTIVO = 'SI', y el id queda en
--       POSTULANTES_FACILITADORES.ID_FACILITADOR.
--     - Los estudios concluidos o en curso se agregan a
--       FACILITADORES_ESTUDIOS (los niveles que ya tenia no se repiten).
--     - USUARIO: el de la postulacion (quien la cargo desde la app), si el
--       facilitador no tiene y ningun otro lo usa (es UNIQUE).
--   Es el UNICO DDL de este script sobre la tabla compartida, y lo pidio Jose.
--   Volver a pendiente o rechazar NO deshace nada.
--
--   LOS VALORES DE LAS LISTAS: FACILITADORES guarda los de las listas de APEX
--   (SI_NO, ESTADO_CIVIL, CON_QUIEN_VIVE, nivel academico), que no estan en el
--   repo. valor_lista() elige, entre los valores que YA HAY en FACILITADORES,
--   el mas usado que coincide con el codigo de la postulacion ('SOLTERO' ->
--   el que contenga SOLTER...); si no hay ninguno, un texto legible. El final
--   del script imprime la equivalencia: revisarla.
--
-- PERMISOS (la pagina de /postulantes)
--
--   GET     solo sesion
--   PUT     PUEDE_ACTUALIZAR (ficha, estado y firma)
--   DELETE  PUEDE_BORRAR
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON
SET DEFINE OFF

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'POSTULANTES_FACILITADORES';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe POSTULANTES_FACILITADORES. La crea la otra app:');
    DBMS_OUTPUT.PUT_LINE('        este script no la crea. El paquete va a quedar INVALID.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   POSTULANTES_FACILITADORES encontrada (no se toca su estructura).');
    FOR t IN (SELECT trigger_name, triggering_event, status FROM user_triggers
               WHERE table_name = 'POSTULANTES_FACILITADORES' ORDER BY trigger_name) LOOP
      DBMS_OUTPUT.PUT_LINE('       trigger de la tabla: ' || t.trigger_name || ' ('
                           || t.triggering_event || ', ' || t.status || ')');
    END LOOP;
  END IF;
  FOR o IN (SELECT 'PKG_AUTH_ETHOS' AS nombre, 'auth.sql' AS script FROM dual
            UNION ALL SELECT 'PKG_ROLES_PAGINAS_ETHOS', 'roles_paginas.sql' FROM dual
            UNION ALL SELECT 'PKG_CLOUDINARY_ETHOS', 'cloudinary.sql' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_objects
     WHERE object_name = o.nombre AND object_type = 'PACKAGE BODY';
    DBMS_OUTPUT.PUT_LINE(CASE WHEN l_n = 0 THEN '[ERROR] Falta ' || o.nombre || ': corre ' || o.script
                              ELSE '[OK]   ' || o.nombre || ' encontrado.' END);
  END LOOP;
END;
/

CREATE OR REPLACE PACKAGE PKG_POSTULANTES_FAC_ETHOS AS

  PROCEDURE listar(p_token IN VARCHAR2, p_id_anio IN VARCHAR2);
  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN VARCHAR2);
  -- p_cuerpo: el JSON de la ficha, crudo (:body_text).
  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_cuerpo IN CLOB);
  PROCEDURE revisar(p_token IN VARCHAR2, p_id IN VARCHAR2,
                    p_estado IN VARCHAR2, p_observacion IN VARCHAR2);
  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);
  PROCEDURE firma(p_token IN VARCHAR2);

  -- Para TRG_POSTULANTES_FAC_APROBAR. El valor de FACILITADORES (o de
  -- FACILITADORES_ESTUDIOS) que corresponde a un codigo de la postulacion.
  -- p_lista: SI_NO, ESTADO_CIVIL, CON_QUIEN_VIVE, TIPO_VEHICULO,
  -- TIPO_FACTURA o NIVEL_ACADEMICO.
  FUNCTION valor_lista(p_lista IN VARCHAR2, p_codigo IN VARCHAR2) RETURN VARCHAR2;
  -- La nacionalidad (texto) de la postulacion -> NACIONALIDADES.ID_NACIONALIDAD.
  FUNCTION id_nacionalidad(p_texto IN VARCHAR2) RETURN NUMBER;

END PKG_POSTULANTES_FAC_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_POSTULANTES_FAC_ETHOS AS

  c_ruta    CONSTANT VARCHAR2(30)  := '/postulantes';
  -- La carpeta de Cloudinary de las postulaciones (Jose, 24/11/2026): la
  -- misma que usa la otra app. El preset es el de CLOUDINARY_CONFIG, como en
  -- facturas.
  c_carpeta CONSTANT VARCHAR2(40)  := 'postulaciones-facilitadores';
  -- Paraguay es UTC-3 todo el año (desde 2024).
  c_desfase CONSTANT NUMBER        := -3 / 24;

  TYPE t_urls IS TABLE OF VARCHAR2(500) INDEX BY PLS_INTEGER;

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

  -- La columna de un ORA-01400/01407/12899: en ("ESQUEMA"."TABLA"."COLUMNA")
  -- es el unico nombre entre comillas seguido de ")" o de un espacio.
  FUNCTION f_columna RETURN VARCHAR2 IS
  BEGIN
    RETURN LOWER(REPLACE(REGEXP_SUBSTR(SQLERRM, '"([A-Z0-9_$#]+)"[ )]', 1, 1, NULL, 1), '_', ' '));
  END f_columna;

  PROCEDURE p_error_oracle IS
  BEGIN
    CASE
      WHEN SQLCODE = -1 THEN
        p_error(409, 'Conflict', 'No se pudo pasar a Facilitadores: ya hay un facilitador con esa '
                || 'c' || UNISTR('\00e9') || 'dula o ese usuario (' || SQLERRM || ')');
      WHEN SQLCODE IN (-1400, -1407) THEN
        p_error(400, 'Bad Request', 'Falta completar: ' || NVL(f_columna, 'un campo obligatorio'));
      WHEN SQLCODE = -12899 THEN
        p_error(400, 'Bad Request', 'Es demasiado largo: ' || NVL(f_columna, 'un campo'));
      WHEN SQLCODE = -2290 THEN
        p_error(400, 'Bad Request', 'Un valor no es de los permitidos (' || SQLERRM || ')');
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request', 'La ciudad, el a' || UNISTR('\00f1') || 'o o el facilitador elegido no existe');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict', 'No se puede eliminar: hay datos que dependen de esta postulaci' || UNISTR('\00f3') || 'n');
      ELSE
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
    END CASE;
  END p_error_oracle;

  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_numero;

  FUNCTION ahora RETURN TIMESTAMP IS
  BEGIN
    RETURN CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) + c_desfase AS TIMESTAMP);
  END ahora;

  FUNCTION exigir(p_token IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_usuario VARCHAR2(255);
    l_pagina  NUMBER;
  BEGIN
    BEGIN
      l_usuario := PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
    EXCEPTION
      WHEN OTHERS THEN l_usuario := NULL;
    END;
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN FALSE;
    END IF;
    IF p_accion <> 'C' THEN
      l_pagina := PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta(c_ruta);
      IF l_pagina IS NULL
         OR PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario, l_pagina, p_accion) <> 'S' THEN
        p_error(403, 'Forbidden', 'No tenes permiso para '
          || CASE p_accion WHEN 'U' THEN 'modificar' ELSE 'eliminar' END
          || ' postulaciones de facilitadores'
          || CASE WHEN l_pagina IS NULL THEN ' (la pantalla todavia no esta dada de alta en Crear paginas)' END);
        RETURN FALSE;
      END IF;
    END IF;
    RETURN TRUE;
  END exigir;

  -- Las 7 columnas de Cloudinary de una fila, en este orden.
  PROCEDURE urls_de(p_id IN NUMBER, p_urls OUT t_urls, p_bloquear IN BOOLEAN DEFAULT FALSE) IS
  BEGIN
    IF p_bloquear THEN
      SELECT foto_url, cedula_frente_url, cedula_dorso_url, secundario_doc_url,
             tecnico_doc_url, licenciatura_doc_url, posgrado_doc_url
        INTO p_urls(1), p_urls(2), p_urls(3), p_urls(4), p_urls(5), p_urls(6), p_urls(7)
        FROM postulantes_facilitadores WHERE id = p_id FOR UPDATE;
    ELSE
      SELECT foto_url, cedula_frente_url, cedula_dorso_url, secundario_doc_url,
             tecnico_doc_url, licenciatura_doc_url, posgrado_doc_url
        INTO p_urls(1), p_urls(2), p_urls(3), p_urls(4), p_urls(5), p_urls(6), p_urls(7)
        FROM postulantes_facilitadores WHERE id = p_id;
    END IF;
  END urls_de;

  -- Borra de Cloudinary un archivo que ya no usa ninguna fila. NULL si quedo
  -- borrado (o no habia nada); si no, el motivo. Despues del COMMIT, nunca lanza.
  FUNCTION limpiar(p_url IN VARCHAR2) RETURN VARCHAR2 IS
    l_n PLS_INTEGER;
  BEGIN
    IF p_url IS NULL THEN RETURN NULL; END IF;
    SELECT COUNT(*) INTO l_n FROM postulantes_facilitadores
     WHERE p_url IN (foto_url, cedula_frente_url, cedula_dorso_url, secundario_doc_url,
                     tecnico_doc_url, licenciatura_doc_url, posgrado_doc_url);
    IF l_n > 0 THEN RETURN NULL; END IF;
    RETURN PKG_CLOUDINARY_ETHOS.borrar(p_url);
  EXCEPTION
    WHEN OTHERS THEN RETURN SQLERRM;
  END limpiar;

  /* ---------------------------------------------------------------------- */
  /* LISTAR                                                                 */
  /* ---------------------------------------------------------------------- */

  PROCEDURE listar(p_token IN VARCHAR2, p_id_anio IN VARCHAR2) IS
    l_anio NUMBER := f_numero(p_id_anio);
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    -- Sin año pedido: el vigente; sin vigente, el mas nuevo.
    IF l_anio IS NULL THEN
      BEGIN
        SELECT id_anio INTO l_anio FROM (
          SELECT id_anio FROM anios_lectivos
           ORDER BY CASE WHEN UPPER(TRIM(estado)) = 'A' THEN 0 ELSE 1 END, anio DESC)
         WHERE ROWNUM = 1;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN l_anio := NULL;
      END;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('id_anio', l_anio);
    APEX_JSON.OPEN_ARRAY('anios');
    FOR a IN (SELECT a.id_anio, a.anio,
                     CASE WHEN UPPER(TRIM(a.estado)) = 'A' THEN 'S' ELSE 'N' END AS es_vigente,
                     (SELECT COUNT(*) FROM postulantes_facilitadores p
                       WHERE p.id_anio = a.id_anio) AS cantidad
                FROM anios_lectivos a ORDER BY a.anio DESC) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id_anio', a.id_anio);
      APEX_JSON.WRITE('anio', a.anio);
      APEX_JSON.WRITE('es_vigente', a.es_vigente);
      APEX_JSON.WRITE('cantidad', a.cantidad);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT p.id, TO_CHAR(p.fecha_registro, 'YYYY-MM-DD HH24:MI') AS registro,
                     p.nombre_completo, p.cedula, p.telefono, p.correo_electronico, p.edad,
                     p.estado, TO_CHAR(p.fecha_revision, 'YYYY-MM-DD HH24:MI') AS revision,
                     p.observacion_admin, p.id_facilitador, f.nombre_apellido AS facilitador,
                     p.usuario, c.nombre AS ciudad, d.nombre AS departamento,
                     p.turno, p.dias_disponibles, p.secundario_estado, p.tecnico_estado,
                     p.licenciatura_estado, p.posgrado_estado,
                     p.foto_url, p.cedula_frente_url, p.cedula_dorso_url, p.secundario_doc_url,
                     p.tecnico_doc_url, p.licenciatura_doc_url, p.posgrado_doc_url,
                     p.cv_archivo, p.certificado_no_agresor_archivo,
                     p.antecedente_judicial_archivo, p.antecedente_policial_archivo
                FROM postulantes_facilitadores p
                LEFT JOIN ciudades c      ON c.id_ciudad = p.id_ciudad
                LEFT JOIN departamentos d ON d.id_departamento = p.id_departamento
                LEFT JOIN facilitadores f ON f.id_facilitador = p.id_facilitador
               WHERE p.id_anio = l_anio
               ORDER BY p.fecha_registro DESC) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('id',                  r.id);
      APEX_JSON.WRITE('fecha_registro',      r.registro);
      APEX_JSON.WRITE('nombre_completo',     r.nombre_completo);
      APEX_JSON.WRITE('cedula',              r.cedula);
      APEX_JSON.WRITE('telefono',            r.telefono);
      APEX_JSON.WRITE('correo_electronico',  r.correo_electronico);
      APEX_JSON.WRITE('edad',                r.edad);
      APEX_JSON.WRITE('estado',              r.estado);
      APEX_JSON.WRITE('fecha_revision',      r.revision);
      APEX_JSON.WRITE('observacion_admin',   r.observacion_admin);
      APEX_JSON.WRITE('id_facilitador',      r.id_facilitador);
      APEX_JSON.WRITE('facilitador',         r.facilitador);
      APEX_JSON.WRITE('usuario',             r.usuario);
      APEX_JSON.WRITE('ciudad',              r.ciudad);
      APEX_JSON.WRITE('departamento',        r.departamento);
      APEX_JSON.WRITE('turno',               r.turno);
      APEX_JSON.WRITE('dias_disponibles',    r.dias_disponibles);
      APEX_JSON.WRITE('secundario_estado',   r.secundario_estado);
      APEX_JSON.WRITE('tecnico_estado',      r.tecnico_estado);
      APEX_JSON.WRITE('licenciatura_estado', r.licenciatura_estado);
      APEX_JSON.WRITE('posgrado_estado',     r.posgrado_estado);
      APEX_JSON.WRITE('foto_url',            r.foto_url);
      APEX_JSON.WRITE('cedula_frente_url',   r.cedula_frente_url);
      APEX_JSON.WRITE('cedula_dorso_url',    r.cedula_dorso_url);
      APEX_JSON.WRITE('secundario_doc_url',  r.secundario_doc_url);
      APEX_JSON.WRITE('tecnico_doc_url',     r.tecnico_doc_url);
      APEX_JSON.WRITE('licenciatura_doc_url', r.licenciatura_doc_url);
      APEX_JSON.WRITE('posgrado_doc_url',    r.posgrado_doc_url);
      APEX_JSON.WRITE('cv_archivo',          r.cv_archivo);
      APEX_JSON.WRITE('certificado_no_agresor_archivo', r.certificado_no_agresor_archivo);
      APEX_JSON.WRITE('antecedente_judicial_archivo',   r.antecedente_judicial_archivo);
      APEX_JSON.WRITE('antecedente_policial_archivo',   r.antecedente_policial_archivo);
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

  PROCEDURE obtener(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id NUMBER := f_numero(p_id);
    l_ok BOOLEAN := FALSE;
  BEGIN
    IF NOT exigir(p_token, 'C') THEN RETURN; END IF;
    FOR r IN (SELECT p.*, a.anio, c.nombre AS ciudad, d.nombre AS departamento,
                     f.nombre_apellido AS facilitador
                FROM postulantes_facilitadores p
                JOIN anios_lectivos a     ON a.id_anio = p.id_anio
                LEFT JOIN ciudades c      ON c.id_ciudad = p.id_ciudad
                LEFT JOIN departamentos d ON d.id_departamento = p.id_departamento
                LEFT JOIN facilitadores f ON f.id_facilitador = p.id_facilitador
               WHERE p.id = l_id) LOOP
      l_ok := TRUE;
      abrir_json;
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('success', TRUE);
      APEX_JSON.OPEN_OBJECT('data');
      APEX_JSON.WRITE('id',                  r.id);
      APEX_JSON.WRITE('fecha_registro',      TO_CHAR(r.fecha_registro, 'YYYY-MM-DD HH24:MI'));
      APEX_JSON.WRITE('correo_electronico',  r.correo_electronico, TRUE);
      APEX_JSON.WRITE('acepta_proceso',      r.acepta_proceso, TRUE);
      APEX_JSON.WRITE('id_anio',             r.id_anio);
      APEX_JSON.WRITE('anio',                r.anio);
      APEX_JSON.WRITE('id_facilitador',      r.id_facilitador, TRUE);
      APEX_JSON.WRITE('facilitador',         r.facilitador, TRUE);
      APEX_JSON.WRITE('id_ciudad',           r.id_ciudad, TRUE);
      APEX_JSON.WRITE('ciudad',              r.ciudad, TRUE);
      APEX_JSON.WRITE('departamento',        r.departamento, TRUE);
      APEX_JSON.WRITE('direccion',           r.direccion, TRUE);
      APEX_JSON.WRITE('ubicacion_domicilio', r.ubicacion_domicilio, TRUE);
      APEX_JSON.WRITE('nombre_completo',     r.nombre_completo, TRUE);
      APEX_JSON.WRITE('cedula',              r.cedula, TRUE);
      APEX_JSON.WRITE('fecha_nacimiento',    TO_CHAR(r.fecha_nacimiento, 'YYYY-MM-DD'), TRUE);
      APEX_JSON.WRITE('edad',                r.edad, TRUE);
      APEX_JSON.WRITE('estado_civil',        r.estado_civil, TRUE);
      APEX_JSON.WRITE('estado_civil_otro',   r.estado_civil_otro, TRUE);
      APEX_JSON.WRITE('vive_con',            r.vive_con, TRUE);
      APEX_JSON.WRITE('hijos',               r.hijos, TRUE);
      APEX_JSON.WRITE('nacionalidad',        r.nacionalidad, TRUE);
      APEX_JSON.WRITE('telefono',            r.telefono, TRUE);
      APEX_JSON.WRITE('talle_remera',        r.talle_remera, TRUE);
      APEX_JSON.WRITE('secundario_estado',   r.secundario_estado, TRUE);
      APEX_JSON.WRITE('secundario_titulo',   r.secundario_titulo, TRUE);
      APEX_JSON.WRITE('tecnico_estado',      r.tecnico_estado, TRUE);
      APEX_JSON.WRITE('tecnico_titulo',      r.tecnico_titulo, TRUE);
      APEX_JSON.WRITE('tecnico_anio',        r.tecnico_anio, TRUE);
      APEX_JSON.WRITE('licenciatura_estado', r.licenciatura_estado, TRUE);
      APEX_JSON.WRITE('licenciatura_titulo', r.licenciatura_titulo, TRUE);
      APEX_JSON.WRITE('licenciatura_anio',   r.licenciatura_anio, TRUE);
      APEX_JSON.WRITE('posgrado_estado',     r.posgrado_estado, TRUE);
      APEX_JSON.WRITE('posgrado_titulo',     r.posgrado_titulo, TRUE);
      APEX_JSON.WRITE('posgrado_anio',       r.posgrado_anio, TRUE);
      APEX_JSON.WRITE('actividad_laboral',   r.actividad_laboral, TRUE);
      APEX_JSON.WRITE('empresa',             r.empresa, TRUE);
      APEX_JSON.WRITE('cargo',               r.cargo, TRUE);
      APEX_JSON.WRITE('movilidad_propia',    r.movilidad_propia, TRUE);
      APEX_JSON.WRITE('tipo_vehiculo',       r.tipo_vehiculo, TRUE);
      APEX_JSON.WRITE('computadora_propia',  r.computadora_propia, TRUE);
      APEX_JSON.WRITE('internet_estable',    r.internet_estable, TRUE);
      APEX_JSON.WRITE('manejo_office',       r.manejo_office, TRUE);
      APEX_JSON.WRITE('dias_disponibles',    r.dias_disponibles, TRUE);
      APEX_JSON.WRITE('turno',               r.turno, TRUE);
      APEX_JSON.WRITE('iglesia_denominacion', r.iglesia_denominacion, TRUE);
      APEX_JSON.WRITE('iglesia_nombre',      r.iglesia_nombre, TRUE);
      APEX_JSON.WRITE('pastor_nombre',       r.pastor_nombre, TRUE);
      APEX_JSON.WRITE('pastor_telefono',     r.pastor_telefono, TRUE);
      APEX_JSON.WRITE('lider_nombre',        r.lider_nombre, TRUE);
      APEX_JSON.WRITE('lider_telefono',      r.lider_telefono, TRUE);
      APEX_JSON.WRITE('bautizado_agua',      r.bautizado_agua, TRUE);
      APEX_JSON.WRITE('areas_ministerio',    r.areas_ministerio, TRUE);
      APEX_JSON.WRITE('banco_nombre',        r.banco_nombre, TRUE);
      APEX_JSON.WRITE('banco_sucursal',      r.banco_sucursal, TRUE);
      APEX_JSON.WRITE('titular_nombre',      r.titular_nombre, TRUE);
      APEX_JSON.WRITE('titular_ci',          r.titular_ci, TRUE);
      APEX_JSON.WRITE('tipo_cuenta',         r.tipo_cuenta, TRUE);
      APEX_JSON.WRITE('numero_cuenta',       r.numero_cuenta, TRUE);
      APEX_JSON.WRITE('factura_tipo',        r.factura_tipo, TRUE);
      APEX_JSON.WRITE('factura_emisor',      r.factura_emisor, TRUE);
      APEX_JSON.WRITE('ruc',                 r.ruc, TRUE);
      APEX_JSON.WRITE('foto_url',            r.foto_url, TRUE);
      APEX_JSON.WRITE('cedula_frente_url',   r.cedula_frente_url, TRUE);
      APEX_JSON.WRITE('cedula_dorso_url',    r.cedula_dorso_url, TRUE);
      APEX_JSON.WRITE('secundario_doc_url',  r.secundario_doc_url, TRUE);
      APEX_JSON.WRITE('tecnico_doc_url',     r.tecnico_doc_url, TRUE);
      APEX_JSON.WRITE('licenciatura_doc_url', r.licenciatura_doc_url, TRUE);
      APEX_JSON.WRITE('posgrado_doc_url',    r.posgrado_doc_url, TRUE);
      APEX_JSON.WRITE('usuario',             r.usuario, TRUE);
      APEX_JSON.WRITE('cv_archivo',          r.cv_archivo, TRUE);
      APEX_JSON.WRITE('certificado_no_agresor_archivo', r.certificado_no_agresor_archivo, TRUE);
      APEX_JSON.WRITE('antecedente_judicial_archivo',   r.antecedente_judicial_archivo, TRUE);
      APEX_JSON.WRITE('antecedente_policial_archivo',   r.antecedente_policial_archivo, TRUE);
      APEX_JSON.WRITE('estado',              r.estado);
      APEX_JSON.WRITE('observacion_admin',   r.observacion_admin, TRUE);
      APEX_JSON.WRITE('fecha_revision',      TO_CHAR(r.fecha_revision, 'YYYY-MM-DD HH24:MI'), TRUE);
      APEX_JSON.CLOSE_OBJECT;
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    IF NOT l_ok THEN
      p_error(404, 'Not Found', 'La postulaci' || UNISTR('\00f3') || 'n no existe');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END obtener;

  /* ---------------------------------------------------------------------- */
  /* GUARDAR                                                                */
  /* ---------------------------------------------------------------------- */

  PROCEDURE guardar(p_token IN VARCHAR2, p_id IN VARCHAR2, p_cuerpo IN CLOB) IS
    l_id     NUMBER := f_numero(p_id);
    j        JSON_OBJECT_T;
    l_viejas t_urls;
    l_nuevas t_urls;
    l_ciudad NUMBER;
    l_pais   NUMBER;
    l_dep    NUMBER;
    l_aviso  VARCHAR2(4000);
    l_motivo VARCHAR2(4000);
    l_fnac   DATE;
    r        postulantes_facilitadores%ROWTYPE;

    -- Texto del JSON, recortado; vacio = NULL.
    FUNCTION s(k IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
      RETURN TRIM(j.get_string(k));
    END s;
    -- Las listas (SI/NO, estados...) siempre en mayusculas, como los CHECK.
    FUNCTION u(k IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
      RETURN UPPER(TRIM(j.get_string(k)));
    END u;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    BEGIN
      j := JSON_OBJECT_T.parse(p_cuerpo);
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'El cuerpo no es un JSON valido'); RETURN;
    END;

    -- Ubicacion: se elige la ciudad; pais y departamento salen de ella (la FK
    -- es a CIUDADES por las tres columnas).
    l_ciudad := f_numero(s('id_ciudad'));
    IF l_ciudad IS NULL THEN
      p_error(400, 'Bad Request', 'Falta la ciudad'); RETURN;
    END IF;
    BEGIN
      SELECT id_pais, id_departamento INTO l_pais, l_dep FROM ciudades WHERE id_ciudad = l_ciudad;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(400, 'Bad Request', 'La ciudad elegida no existe'); RETURN;
    END;

    BEGIN
      l_fnac := TO_DATE(SUBSTR(s('fecha_nacimiento'), 1, 10), 'YYYY-MM-DD');
    EXCEPTION
      WHEN OTHERS THEN
        p_error(400, 'Bad Request', 'La fecha de nacimiento no es valida'); RETURN;
    END;

    -- Los archivos: uno nuevo tiene que ser de nuestro Cloudinary.
    BEGIN
      urls_de(l_id, l_viejas, TRUE);
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La postulaci' || UNISTR('\00f3') || 'n no existe'); RETURN;
    END;
    l_nuevas(1) := s('foto_url');
    l_nuevas(2) := s('cedula_frente_url');
    l_nuevas(3) := s('cedula_dorso_url');
    l_nuevas(4) := s('secundario_doc_url');
    l_nuevas(5) := s('tecnico_doc_url');
    l_nuevas(6) := s('licenciatura_doc_url');
    l_nuevas(7) := s('posgrado_doc_url');
    FOR i IN 1 .. 7 LOOP
      IF l_nuevas(i) IS NOT NULL AND NVL(l_viejas(i), '-') <> l_nuevas(i)
         AND NOT PKG_CLOUDINARY_ETHOS.es_url_propia(l_nuevas(i)) THEN
        ROLLBACK;
        p_error(400, 'Bad Request', 'Los archivos nuevos tienen que estar subidos al Cloudinary del sistema');
        RETURN;
      END IF;
    END LOOP;

    -- Todo se calcula ANTES, en un registro: dentro de un UPDATE no se pueden
    -- usar funciones locales ni privadas del paquete (PLS-00231).
    r.correo_electronico := s('correo_electronico');
    r.id_anio := f_numero(s('id_anio'));
    r.id_facilitador := f_numero(s('id_facilitador'));
    r.id_pais := l_pais;
    r.id_departamento := l_dep;
    r.id_ciudad := l_ciudad;
    r.direccion := s('direccion');
    r.ubicacion_domicilio := s('ubicacion_domicilio');
    r.nombre_completo := s('nombre_completo');
    r.cedula := s('cedula');
    r.fecha_nacimiento := l_fnac;
    r.edad := f_numero(s('edad'));
    r.estado_civil := u('estado_civil');
    r.estado_civil_otro := CASE WHEN u('estado_civil') = 'OTROS' THEN s('estado_civil_otro') END;
    r.vive_con := u('vive_con');
    r.hijos := u('hijos');
    r.nacionalidad := s('nacionalidad');
    r.telefono := s('telefono');
    r.talle_remera := u('talle_remera');
    r.secundario_estado := u('secundario_estado');
    r.secundario_titulo := s('secundario_titulo');
    r.tecnico_estado := u('tecnico_estado');
    r.tecnico_titulo := s('tecnico_titulo');
    r.tecnico_anio := s('tecnico_anio');
    r.licenciatura_estado := u('licenciatura_estado');
    r.licenciatura_titulo := s('licenciatura_titulo');
    r.licenciatura_anio := s('licenciatura_anio');
    r.posgrado_estado := u('posgrado_estado');
    r.posgrado_titulo := s('posgrado_titulo');
    r.posgrado_anio := s('posgrado_anio');
    r.actividad_laboral := u('actividad_laboral');
    r.empresa := s('empresa');
    r.cargo := s('cargo');
    r.movilidad_propia := u('movilidad_propia');
    r.tipo_vehiculo := CASE WHEN u('movilidad_propia') = 'SI' THEN u('tipo_vehiculo') END;
    r.computadora_propia := u('computadora_propia');
    r.internet_estable := u('internet_estable');
    r.manejo_office := u('manejo_office');
    r.dias_disponibles := s('dias_disponibles');
    r.turno := u('turno');
    r.iglesia_denominacion := s('iglesia_denominacion');
    r.iglesia_nombre := s('iglesia_nombre');
    r.pastor_nombre := s('pastor_nombre');
    r.pastor_telefono := s('pastor_telefono');
    r.lider_nombre := s('lider_nombre');
    r.lider_telefono := s('lider_telefono');
    r.bautizado_agua := u('bautizado_agua');
    r.areas_ministerio := j.get_clob('areas_ministerio');
    r.banco_nombre := s('banco_nombre');
    r.banco_sucursal := s('banco_sucursal');
    r.titular_nombre := s('titular_nombre');
    r.titular_ci := s('titular_ci');
    r.tipo_cuenta := s('tipo_cuenta');
    r.numero_cuenta := s('numero_cuenta');
    r.factura_tipo := u('factura_tipo');
    r.factura_emisor := s('factura_emisor');
    r.ruc := s('ruc');
    r.foto_url := l_nuevas(1);
    r.cedula_frente_url := l_nuevas(2);
    r.cedula_dorso_url := l_nuevas(3);
    r.secundario_doc_url := l_nuevas(4);
    r.tecnico_doc_url := l_nuevas(5);
    r.licenciatura_doc_url := l_nuevas(6);
    r.posgrado_doc_url := l_nuevas(7);
    r.cv_archivo := s('cv_archivo');
    r.certificado_no_agresor_archivo := s('certificado_no_agresor_archivo');
    r.antecedente_judicial_archivo := s('antecedente_judicial_archivo');
    r.antecedente_policial_archivo := s('antecedente_policial_archivo');

    UPDATE postulantes_facilitadores SET
      correo_electronico             = r.correo_electronico,
      id_anio                        = r.id_anio,
      id_facilitador                 = r.id_facilitador,
      id_pais                        = r.id_pais,
      id_departamento                = r.id_departamento,
      id_ciudad                      = r.id_ciudad,
      direccion                      = r.direccion,
      ubicacion_domicilio            = r.ubicacion_domicilio,
      nombre_completo                = r.nombre_completo,
      cedula                         = r.cedula,
      fecha_nacimiento               = r.fecha_nacimiento,
      edad                           = r.edad,
      estado_civil                   = r.estado_civil,
      estado_civil_otro              = r.estado_civil_otro,
      vive_con                       = r.vive_con,
      hijos                          = r.hijos,
      nacionalidad                   = r.nacionalidad,
      telefono                       = r.telefono,
      talle_remera                   = r.talle_remera,
      secundario_estado              = r.secundario_estado,
      secundario_titulo              = r.secundario_titulo,
      tecnico_estado                 = r.tecnico_estado,
      tecnico_titulo                 = r.tecnico_titulo,
      tecnico_anio                   = r.tecnico_anio,
      licenciatura_estado            = r.licenciatura_estado,
      licenciatura_titulo            = r.licenciatura_titulo,
      licenciatura_anio              = r.licenciatura_anio,
      posgrado_estado                = r.posgrado_estado,
      posgrado_titulo                = r.posgrado_titulo,
      posgrado_anio                  = r.posgrado_anio,
      actividad_laboral              = r.actividad_laboral,
      empresa                        = r.empresa,
      cargo                          = r.cargo,
      movilidad_propia               = r.movilidad_propia,
      tipo_vehiculo                  = r.tipo_vehiculo,
      computadora_propia             = r.computadora_propia,
      internet_estable               = r.internet_estable,
      manejo_office                  = r.manejo_office,
      dias_disponibles               = r.dias_disponibles,
      turno                          = r.turno,
      iglesia_denominacion           = r.iglesia_denominacion,
      iglesia_nombre                 = r.iglesia_nombre,
      pastor_nombre                  = r.pastor_nombre,
      pastor_telefono                = r.pastor_telefono,
      lider_nombre                   = r.lider_nombre,
      lider_telefono                 = r.lider_telefono,
      bautizado_agua                 = r.bautizado_agua,
      areas_ministerio               = r.areas_ministerio,
      banco_nombre                   = r.banco_nombre,
      banco_sucursal                 = r.banco_sucursal,
      titular_nombre                 = r.titular_nombre,
      titular_ci                     = r.titular_ci,
      tipo_cuenta                    = r.tipo_cuenta,
      numero_cuenta                  = r.numero_cuenta,
      factura_tipo                   = r.factura_tipo,
      factura_emisor                 = r.factura_emisor,
      ruc                            = r.ruc,
      foto_url                       = r.foto_url,
      cedula_frente_url              = r.cedula_frente_url,
      cedula_dorso_url               = r.cedula_dorso_url,
      secundario_doc_url             = r.secundario_doc_url,
      tecnico_doc_url                = r.tecnico_doc_url,
      licenciatura_doc_url           = r.licenciatura_doc_url,
      posgrado_doc_url               = r.posgrado_doc_url,
      cv_archivo                     = r.cv_archivo,
      certificado_no_agresor_archivo = r.certificado_no_agresor_archivo,
      antecedente_judicial_archivo   = r.antecedente_judicial_archivo,
      antecedente_policial_archivo   = r.antecedente_policial_archivo
    WHERE id = l_id;
    COMMIT;

    -- Despues del COMMIT: los archivos reemplazados o quitados se borran de
    -- Cloudinary. Si falla, la ficha ya quedo bien y solo se avisa.
    FOR i IN 1 .. 7 LOOP
      IF l_viejas(i) IS NOT NULL AND NVL(l_nuevas(i), '-') <> l_viejas(i) THEN
        l_motivo := limpiar(l_viejas(i));
        IF l_motivo IS NOT NULL THEN
          l_aviso := SUBSTR(l_aviso || CASE WHEN l_aviso IS NOT NULL THEN '; ' END || l_motivo, 1, 4000);
        END IF;
      END IF;
    END LOOP;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Cambios guardados');
    IF l_aviso IS NOT NULL THEN
      APEX_JSON.WRITE('aviso', 'Algun archivo anterior no se pudo borrar de Cloudinary: ' || l_aviso);
    END IF;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END guardar;

  /* ---------------------------------------------------------------------- */
  /* REVISAR (aprobar / rechazar / volver a pendiente)                      */
  /* ---------------------------------------------------------------------- */

  PROCEDURE revisar(p_token IN VARCHAR2, p_id IN VARCHAR2,
                    p_estado IN VARCHAR2, p_observacion IN VARCHAR2) IS
    l_id     NUMBER := f_numero(p_id);
    l_estado VARCHAR2(20) := UPPER(TRIM(p_estado));
    l_obs    VARCHAR2(32767) := TRIM(p_observacion);
    l_fac    NUMBER;
    l_nombre VARCHAR2(500);
    -- En una variable: una funcion privada no se puede usar en SQL.
    l_ahora  TIMESTAMP := ahora;
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    IF l_estado NOT IN ('PENDIENTE', 'APROBADA', 'RECHAZADA') OR l_estado IS NULL THEN
      p_error(400, 'Bad Request', 'El estado tiene que ser PENDIENTE, APROBADA o RECHAZADA'); RETURN;
    END IF;
    IF l_estado = 'RECHAZADA' AND l_obs IS NULL THEN
      p_error(400, 'Bad Request', 'Para rechazar hace falta el motivo'); RETURN;
    END IF;
    IF LENGTH(l_obs) > 1000 THEN
      p_error(400, 'Bad Request', 'La observaci' || UNISTR('\00f3') || 'n no puede pasar de 1000 caracteres');
      RETURN;
    END IF;

    UPDATE postulantes_facilitadores
       SET estado = l_estado,
           observacion_admin = l_obs,
           fecha_revision = CASE WHEN l_estado = 'PENDIENTE' THEN NULL ELSE l_ahora END
     WHERE id = l_id
    RETURNING id_facilitador INTO l_fac;
    IF SQL%ROWCOUNT = 0 THEN
      ROLLBACK;
      p_error(404, 'Not Found', 'La postulaci' || UNISTR('\00f3') || 'n no existe'); RETURN;
    END IF;
    -- Al aprobar, TRG_POSTULANTES_FAC_APROBAR lo paso a FACILITADORES.
    IF l_estado = 'APROBADA' AND l_fac IS NOT NULL THEN
      SELECT MAX(nombre_apellido) INTO l_nombre FROM facilitadores WHERE id_facilitador = l_fac;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('estado', l_estado);
    APEX_JSON.WRITE('id_facilitador', l_fac);
    APEX_JSON.WRITE('facilitador', l_nombre);
    APEX_JSON.WRITE('message', CASE l_estado WHEN 'APROBADA' THEN 'Postulaci' || UNISTR('\00f3') || 'n aprobada'
                                             WHEN 'RECHAZADA' THEN 'Postulaci' || UNISTR('\00f3') || 'n rechazada'
                                             ELSE 'Volvi' || UNISTR('\00f3') || ' a pendiente' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END revisar;

  /* ---------------------------------------------------------------------- */
  /* ELIMINAR                                                               */
  /* ---------------------------------------------------------------------- */

  PROCEDURE eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id     NUMBER := f_numero(p_id);
    l_urls   t_urls;
    l_aviso  VARCHAR2(4000);
    l_motivo VARCHAR2(4000);
    l_borr   PLS_INTEGER := 0;
  BEGIN
    IF NOT exigir(p_token, 'D') THEN RETURN; END IF;
    IF l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Id invalido'); RETURN;
    END IF;
    BEGIN
      urls_de(l_id, l_urls, TRUE);
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La postulaci' || UNISTR('\00f3') || 'n no existe'); RETURN;
    END;
    DELETE FROM postulantes_facilitadores WHERE id = l_id;
    COMMIT;

    -- Despues del COMMIT: sus archivos se borran de Cloudinary.
    FOR i IN 1 .. 7 LOOP
      IF l_urls(i) IS NOT NULL THEN
        l_motivo := limpiar(l_urls(i));
        IF l_motivo IS NULL THEN
          l_borr := l_borr + 1;
        ELSE
          l_aviso := SUBSTR(l_aviso || CASE WHEN l_aviso IS NOT NULL THEN '; ' END || l_motivo, 1, 4000);
        END IF;
      END IF;
    END LOOP;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Postulaci' || UNISTR('\00f3') || 'n eliminada');
    APEX_JSON.WRITE('archivos_borrados', l_borr);
    IF l_aviso IS NOT NULL THEN
      APEX_JSON.WRITE('aviso', 'Algun archivo no se pudo borrar de Cloudinary: ' || l_aviso);
    END IF;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error_oracle;
  END eliminar;

  /* ---------------------------------------------------------------------- */
  /* FIRMA PARA SUBIR UN ARCHIVO                                            */
  /* ---------------------------------------------------------------------- */

  PROCEDURE firma(p_token IN VARCHAR2) IS
    l_falta VARCHAR2(400);
  BEGIN
    IF NOT exigir(p_token, 'U') THEN RETURN; END IF;
    l_falta := PKG_CLOUDINARY_ETHOS.falta;
    IF l_falta IS NOT NULL THEN
      p_error(503, 'Service Unavailable', l_falta || ': no se pueden subir archivos todavia');
      RETURN;
    END IF;
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    PKG_CLOUDINARY_ETHOS.escribir_firma(c_carpeta);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END firma;

  /* ---------------------------------------------------------------------- */
  /* EL PASAJE A FACILITADORES (lo usa TRG_POSTULANTES_FAC_APROBAR)         */
  /* ---------------------------------------------------------------------- */

  -- Mayusculas, sin tildes y solo letras y numeros: 'Conyuge' con tilde -> 'CONYUGE'.
  FUNCTION norm(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REGEXP_REPLACE(
             TRANSLATE(UPPER(p), UNISTR('\00C1\00C9\00CD\00D3\00DA\00DC\00D1'), 'AEIOUUN'),
             '[^A-Z0-9]', '');
  END norm;

  -- La raiz de un codigo, sin la ultima letra (soltero / soltera...).
  FUNCTION raiz(p IN VARCHAR2) RETURN VARCHAR2 IS
    l VARCHAR2(200) := norm(p);
  BEGIN
    RETURN CASE WHEN LENGTH(l) > 4 THEN SUBSTR(l, 1, LENGTH(l) - 1) ELSE l END;
  END raiz;

  FUNCTION valor_lista(p_lista IN VARCHAR2, p_codigo IN VARCHAR2) RETURN VARCHAR2 IS
    TYPE t_txt IS TABLE OF VARCHAR2(500);
    TYPE t_num IS TABLE OF NUMBER;
    l_cod    VARCHAR2(100) := UPPER(TRIM(p_codigo));
    l_raices t_txt;
    l_vals   t_txt;
    l_cants  t_num;
    l_sql    VARCHAR2(2000);
  BEGIN
    IF l_cod IS NULL THEN RETURN NULL; END IF;

    -- Que se busca en cada valor ya cargado.
    IF p_lista = 'SI_NO' THEN
      l_raices := t_txt(SUBSTR(l_cod, 1, 1));          -- la primera letra: S / N
    ELSIF p_lista = 'NIVEL_ACADEMICO' THEN
      IF l_cod = 'SECUNDARIO' THEN
        l_raices := t_txt('SECUND', 'BACHIL', 'MEDIA');
      ELSIF l_cod = 'TECNICO' THEN
        l_raices := t_txt('TECNIC');
      ELSIF l_cod = 'LICENCIATURA' THEN
        l_raices := t_txt('LICENC', 'UNIVERS');
      ELSIF l_cod = 'POSGRADO' THEN
        l_raices := t_txt('POSGRA', 'POSTGRA', 'MAESTR', 'ESPECIALIZ', 'DOCTOR');
      ELSE
        l_raices := t_txt(raiz(l_cod));
      END IF;
    ELSIF l_cod = 'MOTOCICLETA' THEN
      l_raices := t_txt('MOTO');
    ELSE
      l_raices := t_txt(raiz(l_cod));
    END IF;

    -- Los valores que ya hay, del mas usado al menos.
    l_sql := CASE p_lista
      WHEN 'SI_NO' THEN
        'SELECT v, COUNT(*) FROM (SELECT activo v FROM facilitadores UNION ALL SELECT hijos FROM facilitadores'
        || ' UNION ALL SELECT vehiculo FROM facilitadores UNION ALL SELECT computadora FROM facilitadores'
        || ' UNION ALL SELECT internet FROM facilitadores UNION ALL SELECT office FROM facilitadores'
        || ' UNION ALL SELECT bautizado_agua FROM facilitadores) WHERE v IS NOT NULL GROUP BY v ORDER BY 2 DESC'
      WHEN 'NIVEL_ACADEMICO' THEN
        'SELECT nivel_academico, COUNT(*) FROM facilitadores_estudios WHERE nivel_academico IS NOT NULL'
        || ' GROUP BY nivel_academico ORDER BY 2 DESC'
      WHEN 'ESTADO_CIVIL' THEN
        'SELECT estado_civil, COUNT(*) FROM facilitadores WHERE estado_civil IS NOT NULL'
        || ' GROUP BY estado_civil ORDER BY 2 DESC'
      WHEN 'CON_QUIEN_VIVE' THEN
        'SELECT con_quien_vive, COUNT(*) FROM facilitadores WHERE con_quien_vive IS NOT NULL'
        || ' GROUP BY con_quien_vive ORDER BY 2 DESC'
      WHEN 'TIPO_VEHICULO' THEN
        'SELECT tipo_vehiculo, COUNT(*) FROM facilitadores WHERE tipo_vehiculo IS NOT NULL'
        || ' GROUP BY tipo_vehiculo ORDER BY 2 DESC'
      WHEN 'TIPO_FACTURA' THEN
        'SELECT tipo_factura, COUNT(*) FROM facilitadores WHERE tipo_factura IS NOT NULL'
        || ' GROUP BY tipo_factura ORDER BY 2 DESC'
    END;
    IF l_sql IS NOT NULL THEN
      EXECUTE IMMEDIATE l_sql BULK COLLECT INTO l_vals, l_cants;
      FOR i IN 1 .. l_vals.COUNT LOOP
        FOR j IN 1 .. l_raices.COUNT LOOP
          IF (p_lista = 'SI_NO' AND SUBSTR(norm(l_vals(i)), 1, 1) = l_raices(j))
             OR (p_lista <> 'SI_NO' AND INSTR(norm(l_vals(i)), l_raices(j)) > 0) THEN
            RETURN l_vals(i);
          END IF;
        END LOOP;
      END LOOP;
    END IF;

    -- Nada cargado que coincida: un texto legible.
    RETURN CASE
      WHEN p_lista = 'SI_NO' THEN l_cod
      WHEN l_cod = 'CONYUGE' THEN TO_CHAR(UNISTR('C\00f3nyuge'))
      WHEN l_cod = 'FISICA' THEN TO_CHAR(UNISTR('F\00edsico'))
      WHEN l_cod = 'SECUNDARIO' THEN 'Secundaria'
      WHEN l_cod = 'TECNICO' THEN TO_CHAR(UNISTR('T\00e9cnico superior'))
      ELSE INITCAP(LOWER(REPLACE(l_cod, '_', ' '))) END;
  END valor_lista;

  FUNCTION id_nacionalidad(p_texto IN VARCHAR2) RETURN NUMBER IS
    l_t  VARCHAR2(200) := norm(p_texto);
    l_r  VARCHAR2(200) := raiz(p_texto);
    l_id NUMBER;
  BEGIN
    IF l_t IS NULL THEN RETURN NULL; END IF;
    -- Igual, o que la contenga ('Paraguaya' -> 'Paraguayo/a').
    FOR n IN (SELECT id_nacionalidad, descripcion FROM nacionalidades) LOOP
      IF norm(n.descripcion) = l_t THEN RETURN n.id_nacionalidad; END IF;
      IF l_id IS NULL AND INSTR(norm(n.descripcion), l_r) > 0 THEN l_id := n.id_nacionalidad; END IF;
    END LOOP;
    RETURN l_id;
  END id_nacionalidad;

END PKG_POSTULANTES_FAC_ETHOS;
/

--------------------------------------------------------------------------------
-- LIMPIEZA: las rutas postulantes/* de una version anterior de este script
--------------------------------------------------------------------------------
-- El 24/11/2026 este script publicaba postulantes, postulantes/firma,
-- postulantes/:id y postulantes/:id/estado; ahora son revision-postulantes/*.
-- Se borra cada una SOLO si existe en el modulo ethos y TODOS sus handlers
-- llaman a PKG_POSTULANTES_FAC_ETHOS (o sea, son de aca). Si alguna tiene un
-- handler de otra cosa, no se toca y se avisa.
--------------------------------------------------------------------------------
DECLARE
  l_total  PLS_INTEGER;
  l_nuestr PLS_INTEGER;
BEGIN
  FOR r IN (SELECT 'postulantes' AS p FROM dual
            UNION ALL SELECT 'postulantes/firma' FROM dual
            UNION ALL SELECT 'postulantes/:id' FROM dual
            UNION ALL SELECT 'postulantes/:id/estado' FROM dual) LOOP
    SELECT COUNT(h.id),
           COUNT(CASE WHEN UPPER(DBMS_LOB.SUBSTR(h.source, 4000, 1))
                           LIKE '%PKG_POSTULANTES_FAC_ETHOS%' THEN 1 END)
      INTO l_total, l_nuestr
      FROM user_ords_templates t
      JOIN user_ords_modules m ON m.id = t.module_id
      LEFT JOIN user_ords_handlers h ON h.template_id = t.id
     WHERE m.name = 'ethos' AND t.uri_template = r.p
       AND (h.id IS NULL OR h.method <> 'OPTIONS');
    IF l_total = 0 THEN
      NULL;  -- no existe (o solo tiene el OPTIONS): nada que hacer
    ELSIF l_total = l_nuestr THEN
      FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
                UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
                UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
        BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
      BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
      DBMS_OUTPUT.PUT_LINE('[OK]   Borrada la ruta vieja ' || r.p || ' (era de este script).');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[WARN] La ruta ' || r.p || ' tiene handlers que no son de este '
                           || 'script: no se toca.');
    END IF;
  END LOOP;
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo limpiar las rutas viejas: ' || SQLERRM);
END;
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

  PROCEDURE handler(p_pattern IN VARCHAR2, p_method IN VARCHAR2, p_llamada IN VARCHAR2) IS
  BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ethos',
        p_pattern     => p_pattern,
        p_method      => p_method,
        p_source_type => 'plsql/block',
        p_source      => c_decl || c_token || CHR(10) || p_llamada || CHR(10) || 'END;');
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ethos',
        p_pattern            => p_pattern,
        p_method             => p_method,
        p_name               => 'Authorization',
        p_bind_variable_name => 'authorization',
        p_source_type        => 'HEADER',
        p_param_type         => 'STRING',
        p_access_method      => 'IN');
  END handler;
BEGIN
  FOR r IN (SELECT 'revision-postulantes' AS p FROM dual
            UNION ALL SELECT 'revision-postulantes/firma' FROM dual
            UNION ALL SELECT 'revision-postulantes/:id' FROM dual
            UNION ALL SELECT 'revision-postulantes/:id/estado' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'revision-postulantes',
                       p_priority => 0, p_etag_type => 'NONE');
  -- La ruta fija con mas prioridad que /:id.
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'revision-postulantes/firma',
                       p_priority => 2, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'revision-postulantes/:id',
                       p_priority => 1, p_etag_type => 'NONE');
  ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => 'revision-postulantes/:id/estado',
                       p_priority => 1, p_etag_type => 'NONE');

  handler('revision-postulantes', 'GET', '
    PKG_POSTULANTES_FAC_ETHOS.LISTAR(p_token => l_token, p_id_anio => :id_anio);');
  handler('revision-postulantes/:id', 'GET', '
    PKG_POSTULANTES_FAC_ETHOS.OBTENER(p_token => l_token, p_id => :id);');
  -- El cuerpo crudo: AREAS_MINISTERIO es CLOB y la ficha tiene ~75 campos.
  handler('revision-postulantes/:id', 'PUT', '
    PKG_POSTULANTES_FAC_ETHOS.GUARDAR(p_token => l_token, p_id => :id, p_cuerpo => :body_text);');
  handler('revision-postulantes/:id', 'DELETE', '
    PKG_POSTULANTES_FAC_ETHOS.ELIMINAR(p_token => l_token, p_id => :id);');
  handler('revision-postulantes/:id/estado', 'PUT', '
    PKG_POSTULANTES_FAC_ETHOS.REVISAR(p_token => l_token, p_id => :id,
        p_estado => :estado, p_observacion => :observacion);');
  -- POST y no GET: cada firma es nueva y no se tiene que cachear.
  handler('revision-postulantes/firma', 'POST', '
    PKG_POSTULANTES_FAC_ETHOS.FIRMA(p_token => l_token);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de postulantes publicados.');
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
  preflight('revision-postulantes');
  preflight('revision-postulantes/firma');
  preflight('revision-postulantes/:id');
  preflight('revision-postulantes/:id/estado');
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
  SELECT status INTO l_estado FROM user_objects
   WHERE object_name = 'PKG_POSTULANTES_FAC_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_POSTULANTES_FAC_ETHOS compilado.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_POSTULANTES_FAC_ETHOS quedo INVALID:');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_POSTULANTES_FAC_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_POSTULANTES_FAC_ETHOS no se creo.');
END;
/

--==============================================================================
-- TRG_POSTULANTES_FAC_APROBAR  —  24/11/2026, pedido de Jose
--==============================================================================
--
-- Aprobar una postulacion la pasa a FACILITADORES (ver "APROBAR PASA EL
-- POSTULANTE A FACILITADORES" en el encabezado). BEFORE de fila: asi deja el
-- id en :NEW.ID_FACILITADOR sin volver a tocar la tabla (que estaria mutando).
-- Lee FACILITADORES y NACIONALIDADES, no POSTULANTES_FACILITADORES.
--
-- Va en la misma transaccion que el cambio de estado: si algo falla (una
-- cedula o un usuario repetido, por ejemplo), la postulacion no queda
-- aprobada y el sitio muestra el motivo.
--
-- ANTES DE CORRERLO, la verificacion previa (b) del encabezado: si la otra app
-- ya tiene un trigger que crea el facilitador, este lo duplicaria.
--------------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER trg_postulantes_fac_aprobar
BEFORE UPDATE OF estado ON postulantes_facilitadores
FOR EACH ROW
WHEN (NEW.estado = 'APROBADA' AND (OLD.estado IS NULL OR OLD.estado <> 'APROBADA'))
DECLARE
  l_id      facilitadores.id_facilitador%TYPE := :NEW.id_facilitador;
  l_usuario facilitadores.usuario%TYPE;
  l_nac     NUMBER := PKG_POSTULANTES_FAC_ETHOS.id_nacionalidad(:NEW.nacionalidad);
  l_hoy     DATE   := CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE) - 3 / 24;
  l_area    VARCHAR2(500) := DBMS_LOB.SUBSTR(:NEW.areas_ministerio, 500, 1);
  l_col     VARCHAR2(128);
  l_n       PLS_INTEGER;
  -- Los valores de las listas, calculados ANTES: dentro de un INSERT o un
  -- UPDATE no se puede llamar a una funcion local (PLS-00231).
  l_estado_civil   VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('ESTADO_CIVIL', :NEW.estado_civil);
  l_vive_con       VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('CON_QUIEN_VIVE', :NEW.vive_con);
  l_hijos          VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.hijos);
  l_vehiculo       VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.movilidad_propia);
  l_tipo_vehiculo  VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('TIPO_VEHICULO', :NEW.tipo_vehiculo);
  l_computadora    VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.computadora_propia);
  l_internet       VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.internet_estable);
  l_office         VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.manejo_office);
  l_bautizado      VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('SI_NO', :NEW.bautizado_agua);
  l_tipo_factura   VARCHAR2(200) := PKG_POSTULANTES_FAC_ETHOS.valor_lista('TIPO_FACTURA', :NEW.factura_tipo);

  FUNCTION v(p_lista IN VARCHAR2, p_cod IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_POSTULANTES_FAC_ETHOS.valor_lista(p_lista, p_cod);
  END v;

  -- Un nivel concluido o en curso, si el facilitador no lo tiene.
  PROCEDURE estudio(p_nivel IN VARCHAR2, p_estado IN VARCHAR2,
                    p_titulo IN VARCHAR2, p_anio IN VARCHAR2) IS
    l_nivel facilitadores_estudios.nivel_academico%TYPE;
    l_ya    PLS_INTEGER;
  BEGIN
    IF p_estado IS NULL OR NOT REGEXP_LIKE(p_estado, '^(CONCLUID|CURSANDO)') THEN
      RETURN;
    END IF;
    l_nivel := v('NIVEL_ACADEMICO', p_nivel);
    SELECT COUNT(*) INTO l_ya FROM facilitadores_estudios
     WHERE id_facilitador = l_id AND nivel_academico = l_nivel;
    IF l_ya > 0 THEN RETURN; END IF;
    INSERT INTO facilitadores_estudios (id_facilitador, nivel_academico, titulo, anio)
    VALUES (l_id, l_nivel,
            SUBSTR(p_titulo || CASE WHEN p_estado = 'CURSANDO' THEN ' (cursando)' END, 1, 500),
            SUBSTR(CASE WHEN p_estado = 'CURSANDO' THEN p_anio END, 1, 50));
  END estudio;
BEGIN
  -- Sin facilitador vinculado: quizas ya existe con la misma cedula.
  IF l_id IS NULL AND REGEXP_REPLACE(:NEW.cedula, '[^0-9]', '') IS NOT NULL THEN
    BEGIN
      SELECT id_facilitador INTO l_id FROM facilitadores
       WHERE REGEXP_REPLACE(nro_ci, '[^0-9]', '') = REGEXP_REPLACE(:NEW.cedula, '[^0-9]', '')
         AND ROWNUM = 1;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN l_id := NULL;
    END;
  END IF;

  -- El usuario de la app, si nadie mas lo tiene (FACILITADORES_UK_USUARIO).
  IF :NEW.usuario IS NOT NULL THEN
    SELECT COUNT(*) INTO l_n FROM facilitadores
     WHERE usuario = SUBSTR(:NEW.usuario, 1, 100) AND (l_id IS NULL OR id_facilitador <> l_id);
    IF l_n = 0 THEN
      l_usuario := SUBSTR(:NEW.usuario, 1, 100);
    END IF;
  END IF;

  IF l_id IS NULL THEN
    INSERT INTO facilitadores (
      nombre_apellido, nro_ci, fecha_nacimiento, estado_civil, con_quien_vive, hijos,
      id_nacionalidad, telefono, id_pais, id_departamento, id_ciudad, activo, direccion,
      ubicacion, usuario, email, fecha_ingreso, vehiculo, tipo_vehiculo, computadora,
      internet, office, nombre_iglesia, nombre_pastor, nro_telefono_pastor, nombre_lider,
      nro_telefono_lider, bautizado_agua, area_servicio, nombre_banco, sucursal_banco,
      titular_banco, nro_ci_titular_banco, tipo_cuenta, nro_cuenta, nombre_emisor, ruc,
      tipo_factura)
    VALUES (
      :NEW.nombre_completo, :NEW.cedula, :NEW.fecha_nacimiento,
      l_estado_civil, l_vive_con,
      l_hijos, l_nac, :NEW.telefono, :NEW.id_pais, :NEW.id_departamento,
      :NEW.id_ciudad, 'SI', :NEW.direccion, :NEW.ubicacion_domicilio, l_usuario,
      :NEW.correo_electronico, TRUNC(l_hoy), l_vehiculo,
      l_tipo_vehiculo, l_computadora,
      l_internet, l_office, :NEW.iglesia_nombre,
      :NEW.pastor_nombre, :NEW.pastor_telefono, :NEW.lider_nombre, :NEW.lider_telefono,
      l_bautizado, l_area, :NEW.banco_nombre, :NEW.banco_sucursal,
      :NEW.titular_nombre, :NEW.titular_ci, :NEW.tipo_cuenta, :NEW.numero_cuenta,
      :NEW.factura_emisor, :NEW.ruc, l_tipo_factura)
    RETURNING id_facilitador INTO l_id;
  ELSE
    -- Ya existia: sus datos pasan a ser los de la postulacion; lo que viene
    -- vacio no borra lo que habia. El barrio solo queda si no cambio la ciudad
    -- (la FK es por pais, departamento, ciudad y barrio).
    UPDATE facilitadores SET
      nombre_apellido      = NVL(:NEW.nombre_completo, nombre_apellido),
      nro_ci               = NVL(nro_ci, :NEW.cedula),
      fecha_nacimiento     = NVL(:NEW.fecha_nacimiento, fecha_nacimiento),
      estado_civil         = NVL(l_estado_civil, estado_civil),
      con_quien_vive       = NVL(l_vive_con, con_quien_vive),
      hijos                = NVL(l_hijos, hijos),
      id_nacionalidad      = NVL(l_nac, id_nacionalidad),
      telefono             = NVL(:NEW.telefono, telefono),
      id_barrio            = CASE WHEN id_ciudad = :NEW.id_ciudad THEN id_barrio END,
      id_pais              = NVL(:NEW.id_pais, id_pais),
      id_departamento      = NVL(:NEW.id_departamento, id_departamento),
      id_ciudad            = NVL(:NEW.id_ciudad, id_ciudad),
      activo               = 'SI',
      direccion            = NVL(:NEW.direccion, direccion),
      ubicacion            = NVL(:NEW.ubicacion_domicilio, ubicacion),
      usuario              = NVL(usuario, l_usuario),
      email                = NVL(:NEW.correo_electronico, email),
      vehiculo             = NVL(l_vehiculo, vehiculo),
      tipo_vehiculo        = NVL(l_tipo_vehiculo, tipo_vehiculo),
      computadora          = NVL(l_computadora, computadora),
      internet             = NVL(l_internet, internet),
      office               = NVL(l_office, office),
      nombre_iglesia       = NVL(:NEW.iglesia_nombre, nombre_iglesia),
      nombre_pastor        = NVL(:NEW.pastor_nombre, nombre_pastor),
      nro_telefono_pastor  = NVL(:NEW.pastor_telefono, nro_telefono_pastor),
      nombre_lider         = NVL(:NEW.lider_nombre, nombre_lider),
      nro_telefono_lider   = NVL(:NEW.lider_telefono, nro_telefono_lider),
      bautizado_agua       = NVL(l_bautizado, bautizado_agua),
      area_servicio        = NVL(l_area, area_servicio),
      nombre_banco         = NVL(:NEW.banco_nombre, nombre_banco),
      sucursal_banco       = NVL(:NEW.banco_sucursal, sucursal_banco),
      titular_banco        = NVL(:NEW.titular_nombre, titular_banco),
      nro_ci_titular_banco = NVL(:NEW.titular_ci, nro_ci_titular_banco),
      tipo_cuenta          = NVL(:NEW.tipo_cuenta, tipo_cuenta),
      nro_cuenta           = NVL(:NEW.numero_cuenta, nro_cuenta),
      nombre_emisor        = NVL(:NEW.factura_emisor, nombre_emisor),
      ruc                  = NVL(:NEW.ruc, ruc),
      tipo_factura         = NVL(l_tipo_factura, tipo_factura)
    WHERE id_facilitador = l_id;
  END IF;

  -- DENOMINACION tiene tilde en la tabla: se busca y se escribe aparte, como
  -- en facilitadores.sql (un identificador con tilde se rompe al subir el archivo).
  IF :NEW.iglesia_denominacion IS NOT NULL THEN
    SELECT MAX(column_name) INTO l_col FROM user_tab_columns
     WHERE table_name = 'FACILITADORES' AND column_name LIKE 'DENOMINACI%N';
    IF l_col IS NOT NULL THEN
      EXECUTE IMMEDIATE 'UPDATE facilitadores SET ' || DBMS_ASSERT.ENQUOTE_NAME(l_col, FALSE)
                        || ' = :v WHERE id_facilitador = :i'
        USING :NEW.iglesia_denominacion, l_id;
    END IF;
  END IF;

  estudio('SECUNDARIO',   :NEW.secundario_estado,   :NEW.secundario_titulo,   NULL);
  estudio('TECNICO',      :NEW.tecnico_estado,      :NEW.tecnico_titulo,      :NEW.tecnico_anio);
  estudio('LICENCIATURA', :NEW.licenciatura_estado, :NEW.licenciatura_titulo, :NEW.licenciatura_anio);
  estudio('POSGRADO',     :NEW.posgrado_estado,     :NEW.posgrado_titulo,     :NEW.posgrado_anio);

  :NEW.id_facilitador := l_id;
END trg_postulantes_fac_aprobar;
/

SHOW ERRORS TRIGGER trg_postulantes_fac_aprobar

--------------------------------------------------------------------------------
-- La equivalencia de valores que va a usar el trigger: REVISARLA. A la
-- izquierda el codigo de la postulacion, a la derecha lo que se guarda en
-- FACILITADORES (sale de los valores que ya hay cargados).
--------------------------------------------------------------------------------
DECLARE
  l_estado user_objects.status%TYPE;
  PROCEDURE ver(p_lista IN VARCHAR2, p_cod IN VARCHAR2) IS
  BEGIN
    DBMS_OUTPUT.PUT_LINE('       ' || RPAD(p_lista, 16) || RPAD(p_cod, 14) || '-> '
                         || NVL(PKG_POSTULANTES_FAC_ETHOS.valor_lista(p_lista, p_cod), '(nada)'));
  END ver;
BEGIN
  SELECT status INTO l_estado FROM user_objects
   WHERE object_name = 'TRG_POSTULANTES_FAC_APROBAR' AND object_type = 'TRIGGER';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   TRG_POSTULANTES_FAC_APROBAR: aprobar pasa el postulante a FACILITADORES.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] TRG_POSTULANTES_FAC_APROBAR quedo INVALID:');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'TRG_POSTULANTES_FAC_APROBAR' ORDER BY sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;

  DBMS_OUTPUT.PUT_LINE('[INFO] Equivalencia de valores (revisar):');
  ver('SI_NO', 'SI');
  ver('SI_NO', 'NO');
  FOR c IN (SELECT 'SOLTERO' c FROM dual UNION ALL SELECT 'CASADO' FROM dual
            UNION ALL SELECT 'OTROS' FROM dual) LOOP
    ver('ESTADO_CIVIL', c.c);
  END LOOP;
  FOR c IN (SELECT 'SOLO' c FROM dual UNION ALL SELECT 'PADRES' FROM dual
            UNION ALL SELECT 'CONYUGE' FROM dual UNION ALL SELECT 'OTROS' FROM dual) LOOP
    ver('CON_QUIEN_VIVE', c.c);
  END LOOP;
  ver('TIPO_VEHICULO', 'AUTO');
  ver('TIPO_VEHICULO', 'MOTOCICLETA');
  ver('TIPO_FACTURA', 'VIRTUAL');
  ver('TIPO_FACTURA', 'FISICA');
  FOR c IN (SELECT 'SECUNDARIO' c FROM dual UNION ALL SELECT 'TECNICO' FROM dual
            UNION ALL SELECT 'LICENCIATURA' FROM dual UNION ALL SELECT 'POSGRADO' FROM dual) LOOP
    ver('NIVEL_ACADEMICO', c.c);
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('       Nacionalidad ''Paraguaya'' -> id '
                       || NVL(TO_CHAR(PKG_POSTULANTES_FAC_ETHOS.id_nacionalidad('Paraguaya')), '(ninguna)'));
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] TRG_POSTULANTES_FAC_APROBAR no se creo.');
END;
/
