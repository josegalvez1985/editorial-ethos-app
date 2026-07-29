--------------------------------------------------------------------------------
-- EVALUACIONES_FACILITADORES — paquete CRUD + endpoints ORDS en un archivo.
--
-- Ejecutar completo como el DUEÑO DEL ESQUEMA (el mismo que corrió
-- backend/ethos_auth.sql). Idempotente: se puede volver a correr.
--
-- REQUISITOS PREVIOS
--   1. backend/ethos_auth.sql ya corrido  -> PKG_AUTH_ETHOS y el módulo ORDS
--      'ethos' tienen que existir. Este script NO define el módulo ni habilita
--      el esquema en ORDS: solo agrega handlers al módulo que ya está.
--   2. Tabla EVALUACIONES_FACILITADORES con su trigger EVALUACIONES_FACILITADORES_JNTRG,
--      la tabla de journal EVALUACIONES_FACILITADORES_JN y SEQ_AUDITORIA.
--      La sección 3 lo verifica y avisa si falta algo.
--
-- ENDPOINTS (base: https://oracleapex.com/ords/<pattern>/ethos/)
--
--   GET    evaluaciones-facilitadores            listar (filtros + paginado)
--   GET    evaluaciones-facilitadores/:id        obtener uno
--   POST   evaluaciones-facilitadores            insertar
--   PUT    evaluaciones-facilitadores/:id        actualizar
--   DELETE evaluaciones-facilitadores/:id        eliminar
--
--   Todos protegidos: Authorization: Bearer <token> de auth/login.
--
-- DECISIONES QUE CONVIENE SABER ANTES DE TOCAR ESTO
--
--   * ID_AUDITORIA no se acepta del cliente ni se actualiza. Lo asigna el
--     trigger desde SEQ_AUDITORIA. Mandarlo desde el front sería pisar la
--     bitácora.
--
--   * La FK a CIUDADES es compuesta (ID_PAIS, ID_DEPARTAMENTO, ID_CIUDAD) y dos
--     de esas columnas son NULLABLE. Oracle NO valida una FK compuesta si
--     alguna columna viene NULL: se podría guardar un ID_CIUDAD que no existe
--     con tal de dejar el país en NULL. Por eso el paquete exige las tres
--     juntas y responde 400 si falta una. Es validación de aplicación, no de
--     base: si mañana entra data por otra vía, ese agujero sigue ahí. La forma
--     de cerrarlo de verdad es poner ID_PAIS e ID_DEPARTAMENTO NOT NULL.
--
--   * Las fechas viajan como texto ISO 'YYYY-MM-DD' en el JSON. Si el front
--     manda un ISO completo con hora (toISOString()), se toman los primeros 10
--     caracteres. Se devuelven siempre como 'YYYY-MM-DD': nunca se depende del
--     NLS_DATE_FORMAT del servidor.
--
--   * Las validaciones de largo (EVALUADO_POR 255, ASPECTOS_* 1000,
--     CALIFICACION 100) y de estrellas (1..5) están duplicadas acá a propósito.
--     La base ya las tiene, pero un ORA-12899 o un ORA-02290 en crudo le llega
--     al usuario como "Error: ORA-...". Mejor un 400 que se entienda.
--
--   * LISTAR devuelve solo columnas de esta tabla, sin joins a FACILITADORES,
--     INSTITUCIONES, AREAS_EVALUACIONES, EVALUACIONES ni CIUDADES: no tengo el
--     DDL de esas tablas y adivinar el nombre de la columna descriptiva rompería
--     la compilación. Donde van esos joins está marcado con "-- JOIN:".
--
--   * El usuario que queda en la bitácora: el trigger usa
--     NVL(V('APP_USER'), USER). Fuera de APEX, V('APP_USER') es NULL, así que
--     el JN va a registrar el usuario del esquema, no quién usó la app. Este
--     paquete deja el usuario del token en CLIENT_IDENTIFIER; para que aparezca
--     en la bitácora hay que cambiar esa línea del trigger por:
--       NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER'), USER))
--
--   * Ojo con el trigger tal como está: en la rama DELETE, si
--     :OLD.ID_AUDITORIA es NULL intenta asignar :NEW.ID_AUDITORIA, y :NEW no se
--     puede escribir cuando el trigger dispara por DELETE (ORA-04084). Hoy es
--     código muerto porque el INSERT siempre deja ID_AUDITORIA con valor, pero
--     si alguna vez hay filas viejas con ID_AUDITORIA NULL, borrarlas va a
--     fallar. No lo toco acá porque el trigger es tuyo.
--------------------------------------------------------------------------------

SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED

--------------------------------------------------------------------------------
-- === 1) PAQUETE PKG_EVAL_FACILITADORES_ETHOS ===============================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_EVAL_FACILITADORES_ETHOS AS

  -- Todas las fechas entran y salen como texto ISO 'YYYY-MM-DD'.
  -- Todos los procedimientos escriben la respuesta HTTP completa (headers +
  -- JSON). El handler ORDS no debe emitir headers: quedarían duplicados.

  -- Listado con filtros opcionales. p_pagina es 1-based.
  PROCEDURE listar(
      p_token          IN VARCHAR2,
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_id_institucion IN NUMBER   DEFAULT NULL,
      p_id_evaluacion  IN NUMBER   DEFAULT NULL,
      p_id_area        IN NUMBER   DEFAULT NULL,
      p_desde          IN VARCHAR2 DEFAULT NULL,
      p_hasta          IN VARCHAR2 DEFAULT NULL,
      p_buscar         IN VARCHAR2 DEFAULT NULL,
      p_limite         IN NUMBER   DEFAULT NULL,
      p_pagina         IN NUMBER   DEFAULT NULL);

  PROCEDURE obtener(
      p_token IN VARCHAR2,
      p_id    IN NUMBER);

  PROCEDURE insertar(
      p_token                  IN VARCHAR2,
      p_id_facilitador         IN NUMBER,
      p_id_institucion         IN NUMBER,
      p_id_pais                IN NUMBER,
      p_id_departamento        IN NUMBER,
      p_id_ciudad              IN NUMBER,
      p_fecha_desde            IN VARCHAR2,
      p_fecha_hasta            IN VARCHAR2,
      p_evaluado_por           IN VARCHAR2,
      p_id_area                IN NUMBER,
      p_id_evaluacion          IN NUMBER,
      p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN VARCHAR2 DEFAULT NULL,
      p_aspectos_mejorar       IN VARCHAR2 DEFAULT NULL,
      p_calificacion           IN VARCHAR2 DEFAULT NULL);

  PROCEDURE actualizar(
      p_token                  IN VARCHAR2,
      p_id                     IN NUMBER,
      p_id_facilitador         IN NUMBER,
      p_id_institucion         IN NUMBER,
      p_id_pais                IN NUMBER,
      p_id_departamento        IN NUMBER,
      p_id_ciudad              IN NUMBER,
      p_fecha_desde            IN VARCHAR2,
      p_fecha_hasta            IN VARCHAR2,
      p_evaluado_por           IN VARCHAR2,
      p_id_area                IN NUMBER,
      p_id_evaluacion          IN NUMBER,
      p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN VARCHAR2 DEFAULT NULL,
      p_aspectos_mejorar       IN VARCHAR2 DEFAULT NULL,
      p_calificacion           IN VARCHAR2 DEFAULT NULL);

  PROCEDURE eliminar(
      p_token IN VARCHAR2,
      p_id    IN NUMBER);

END PKG_EVAL_FACILITADORES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_EVAL_FACILITADORES_ETHOS AS

  -- Tope de filas por página. Sin esto, un cliente pide 100.000 filas y se
  -- lleva la instancia puesta.
  c_limite_defecto CONSTANT PLS_INTEGER := 50;
  c_limite_maximo  CONSTANT PLS_INTEGER := 200;

  -- Error de validación. Se atrapa en cada procedimiento y sale como 400.
  e_validacion EXCEPTION;
  g_mensaje    VARCHAR2(400);

------------------------------------------------------------------------------
-- Helpers de respuesta (mismo patrón que PKG_AUTH_ETHOS)
------------------------------------------------------------------------------

-- CORS abierto por el único cliente que pega directo a ORDS: la app Expo de
-- mobile/. El sitio web va por su proxy server-side y no lo necesita.
PROCEDURE abrir_json IS
BEGIN
    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    HTP.P('Access-Control-Allow-Origin: *');
    HTP.P('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    HTP.P('Access-Control-Allow-Headers: Authorization, Content-Type');
    HTP.P('Access-Control-Max-Age: 86400');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END abrir_json;

-- OJO con el orden: STATUS_LINE va ANTES de MIME_HEADER. Si se invierte, la
-- respuesta ya está abierta y el status se pierde (queda 200 con success:false).
PROCEDURE p_error(
    p_status  IN NUMBER,
    p_reason  IN VARCHAR2,
    p_message IN VARCHAR2
) IS
BEGIN
    OWA_UTIL.STATUS_LINE(p_status, p_reason, FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', FALSE);
    APEX_JSON.WRITE('message', p_message);
    APEX_JSON.CLOSE_OBJECT;
END p_error;

PROCEDURE p_ok(p_message IN VARCHAR2, p_status IN NUMBER DEFAULT NULL) IS
BEGIN
    IF p_status IS NOT NULL THEN
        OWA_UTIL.STATUS_LINE(p_status, 'Created', FALSE);
    END IF;
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', p_message);
    APEX_JSON.CLOSE_OBJECT;
END p_ok;

-- Traduce los errores de integridad a algo que el usuario entienda.
-- Sin esto, una FK rota le llega al front como "ORA-02291: integrity
-- constraint violated - parent key not found" y no hay nada que hacer con eso.
PROCEDURE p_error_oracle IS
BEGIN
    CASE
      WHEN SQLCODE = -2291 THEN
        p_error(400, 'Bad Request',
                'Alguna referencia no existe (facilitador, institucion, area, '
                || 'evaluacion o ciudad). Verifica los IDs enviados.');
      WHEN SQLCODE = -2292 THEN
        p_error(409, 'Conflict',
                'No se puede eliminar: hay registros que dependen de esta evaluacion');
      WHEN SQLCODE = -2290 THEN
        p_error(400, 'Bad Request',
                'Un valor viola una restriccion de la tabla (revisa las estrellas: 1 a 5)');
      WHEN SQLCODE IN (-1438, -12899) THEN
        p_error(400, 'Bad Request', 'Un texto excede el largo permitido');
      WHEN SQLCODE = -1400 THEN
        p_error(400, 'Bad Request', 'Falta un campo obligatorio');
      ELSE
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
    END CASE;
END p_error_oracle;

------------------------------------------------------------------------------
-- Helpers de datos
------------------------------------------------------------------------------

-- Usuario dueño del token, o NULL. Además deja el usuario en CLIENT_IDENTIFIER
-- para que quede rastro de quién hizo el DML (ver nota del encabezado).
FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
    l_usuario VARCHAR2(255);
BEGIN
    l_usuario := PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
    IF l_usuario IS NOT NULL THEN
        BEGIN
            DBMS_SESSION.SET_IDENTIFIER(SUBSTR(l_usuario, 1, 64));
        EXCEPTION
            WHEN OTHERS THEN NULL;  -- sin permiso: no vale tumbar la request
        END;
    END IF;
    RETURN l_usuario;
END f_usuario;

-- Texto ISO -> DATE. Acepta 'YYYY-MM-DD' y el ISO largo con hora que emite
-- JSON.stringify(new Date()), quedándose con la parte de la fecha.
FUNCTION f_fecha(p_texto IN VARCHAR2, p_campo IN VARCHAR2) RETURN DATE IS
BEGIN
    IF p_texto IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN TO_DATE(SUBSTR(TRIM(p_texto), 1, 10), 'YYYY-MM-DD');
EXCEPTION
    WHEN OTHERS THEN
        g_mensaje := p_campo || ' no tiene formato de fecha valido (YYYY-MM-DD)';
        RAISE e_validacion;
END f_fecha;

PROCEDURE exigir(p_condicion IN BOOLEAN, p_mensaje IN VARCHAR2) IS
BEGIN
    IF NOT NVL(p_condicion, FALSE) THEN
        g_mensaje := p_mensaje;
        RAISE e_validacion;
    END IF;
END exigir;

-- Reglas comunes a INSERTAR y ACTUALIZAR. Lanza e_validacion con el motivo.
PROCEDURE validar(
    p_id_facilitador         IN NUMBER,
    p_id_institucion         IN NUMBER,
    p_id_pais                IN NUMBER,
    p_id_departamento        IN NUMBER,
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN DATE,
    p_fecha_hasta            IN DATE,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER,
    p_aspectos_positivos     IN VARCHAR2,
    p_aspectos_mejorar       IN VARCHAR2,
    p_calificacion           IN VARCHAR2
) IS
BEGIN
    exigir(p_id_facilitador IS NOT NULL, 'id_facilitador es obligatorio');
    exigir(p_id_institucion IS NOT NULL, 'id_institucion es obligatorio');
    exigir(p_id_area        IS NOT NULL, 'id_area es obligatorio');
    exigir(p_id_evaluacion  IS NOT NULL, 'id_evaluacion es obligatorio');
    exigir(p_fecha_desde    IS NOT NULL, 'fecha_desde es obligatoria');
    exigir(p_fecha_hasta    IS NOT NULL, 'fecha_hasta es obligatoria');
    exigir(TRIM(p_evaluado_por) IS NOT NULL, 'evaluado_por es obligatorio');

    -- La FK a CIUDADES es compuesta y Oracle no la valida si algo viene NULL.
    -- O van las tres, o ninguna sirve de nada.
    exigir(p_id_ciudad IS NOT NULL, 'id_ciudad es obligatorio');
    exigir(p_id_pais IS NOT NULL AND p_id_departamento IS NOT NULL,
           'id_pais e id_departamento son obligatorios junto con id_ciudad: '
           || 'sin ellos la base no puede validar que la ciudad exista');

    exigir(p_fecha_hasta >= p_fecha_desde,
           'fecha_hasta no puede ser anterior a fecha_desde');

    exigir(p_calificacion_estrellas IS NULL
           OR (p_calificacion_estrellas BETWEEN 1 AND 5
               AND p_calificacion_estrellas = TRUNC(p_calificacion_estrellas)),
           'calificacion_estrellas debe ser un entero de 1 a 5');

    exigir(LENGTH(p_evaluado_por) <= 255, 'evaluado_por no puede pasar de 255 caracteres');
    exigir(p_aspectos_positivos IS NULL OR LENGTH(p_aspectos_positivos) <= 1000,
           'aspectos_positivos no puede pasar de 1000 caracteres');
    exigir(p_aspectos_mejorar IS NULL OR LENGTH(p_aspectos_mejorar) <= 1000,
           'aspectos_mejorar no puede pasar de 1000 caracteres');
    exigir(p_calificacion IS NULL OR LENGTH(p_calificacion) <= 100,
           'calificacion no puede pasar de 100 caracteres');
END validar;

-- Escribe una fila como objeto JSON. Lo comparten LISTAR y OBTENER para que no
-- se desincronicen los nombres de campo.
--
-- Parámetros escalares y no un %ROWTYPE: asignar el registro de un cursor
-- (SELECT *) a una variable %ROWTYPE es un tipo distinto para PL/SQL y según la
-- versión falla con PLS-00382. Así compila siempre.
--
-- p_nombre: NULL para un elemento dentro de un array; 'data' para el objeto
-- único de OBTENER.
PROCEDURE escribir_fila(
    p_nombre                   IN VARCHAR2,
    p_id_evaluacion_facilitador IN NUMBER,
    p_id_facilitador           IN NUMBER,
    p_id_institucion           IN NUMBER,
    p_id_pais                  IN NUMBER,
    p_id_departamento          IN NUMBER,
    p_id_ciudad                IN NUMBER,
    p_fecha_desde              IN DATE,
    p_fecha_hasta              IN DATE,
    p_evaluado_por             IN VARCHAR2,
    p_id_area                  IN NUMBER,
    p_id_evaluacion            IN NUMBER,
    p_calificacion_estrellas   IN NUMBER,
    p_aspectos_positivos       IN VARCHAR2,
    p_aspectos_mejorar         IN VARCHAR2,
    p_calificacion             IN VARCHAR2,
    p_id_auditoria             IN NUMBER
) IS
BEGIN
    APEX_JSON.OPEN_OBJECT(p_nombre);
    APEX_JSON.WRITE('id_evaluacion_facilitador', p_id_evaluacion_facilitador);
    APEX_JSON.WRITE('id_facilitador',            p_id_facilitador);
    APEX_JSON.WRITE('id_institucion',            p_id_institucion);
    APEX_JSON.WRITE('id_pais',                   p_id_pais);
    APEX_JSON.WRITE('id_departamento',           p_id_departamento);
    APEX_JSON.WRITE('id_ciudad',                 p_id_ciudad);
    APEX_JSON.WRITE('fecha_desde',   TO_CHAR(p_fecha_desde, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('fecha_hasta',   TO_CHAR(p_fecha_hasta, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('evaluado_por',              p_evaluado_por);
    APEX_JSON.WRITE('id_area',                   p_id_area);
    APEX_JSON.WRITE('id_evaluacion',             p_id_evaluacion);
    APEX_JSON.WRITE('calificacion_estrellas',    p_calificacion_estrellas);
    APEX_JSON.WRITE('aspectos_positivos',        p_aspectos_positivos);
    APEX_JSON.WRITE('aspectos_mejorar',          p_aspectos_mejorar);
    APEX_JSON.WRITE('calificacion',              p_calificacion);
    -- Solo lectura: lo pone el trigger de auditoría.
    APEX_JSON.WRITE('id_auditoria',              p_id_auditoria);
    -- JOIN: acá van nombre_facilitador, nombre_institucion, nombre_ciudad,
    -- descripcion_area y descripcion_evaluacion cuando se agreguen los joins.
    APEX_JSON.CLOSE_OBJECT;
END escribir_fila;

------------------------------------------------------------------------------
-- LISTAR
------------------------------------------------------------------------------
PROCEDURE listar(
    p_token          IN VARCHAR2,
    p_id_facilitador IN NUMBER   DEFAULT NULL,
    p_id_institucion IN NUMBER   DEFAULT NULL,
    p_id_evaluacion  IN NUMBER   DEFAULT NULL,
    p_id_area        IN NUMBER   DEFAULT NULL,
    p_desde          IN VARCHAR2 DEFAULT NULL,
    p_hasta          IN VARCHAR2 DEFAULT NULL,
    p_buscar         IN VARCHAR2 DEFAULT NULL,
    p_limite         IN NUMBER   DEFAULT NULL,
    p_pagina         IN NUMBER   DEFAULT NULL
) IS
    l_usuario  VARCHAR2(255);
    l_desde    DATE;
    l_hasta    DATE;
    l_buscar   VARCHAR2(255);
    l_limite   PLS_INTEGER;
    l_pagina   PLS_INTEGER;
    l_offset   PLS_INTEGER;
    l_total    NUMBER;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    l_desde  := f_fecha(p_desde, 'desde');
    l_hasta  := f_fecha(p_hasta, 'hasta');
    l_limite := LEAST(NVL(p_limite, c_limite_defecto), c_limite_maximo);
    IF l_limite < 1 THEN
        l_limite := c_limite_defecto;
    END IF;
    l_pagina := GREATEST(NVL(p_pagina, 1), 1);
    l_offset := (l_pagina - 1) * l_limite;

    -- El '%' se arma acá y no en el SQL para no repetir el patrón en dos sitios.
    l_buscar := CASE WHEN TRIM(p_buscar) IS NULL
                     THEN NULL
                     ELSE '%' || UPPER(TRIM(p_buscar)) || '%'
                END;

    SELECT COUNT(*)
      INTO l_total
      FROM evaluaciones_facilitadores
     WHERE (p_id_facilitador IS NULL OR id_facilitador = p_id_facilitador)
       AND (p_id_institucion IS NULL OR id_institucion = p_id_institucion)
       AND (p_id_evaluacion  IS NULL OR id_evaluacion  = p_id_evaluacion)
       AND (p_id_area        IS NULL OR id_area        = p_id_area)
       AND (l_desde          IS NULL OR fecha_desde   >= l_desde)
       AND (l_hasta          IS NULL OR fecha_hasta   <= l_hasta)
       AND (l_buscar         IS NULL OR UPPER(evaluado_por) LIKE l_buscar);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_limite);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN (
        -- JOIN: agregar acá los LEFT JOIN a FACILITADORES, INSTITUCIONES,
        -- CIUDADES, AREAS_EVALUACIONES y EVALUACIONES, y sus columnas al SELECT
        -- (hay que dejar de usar %ROWTYPE en ese momento).
        SELECT *
          FROM evaluaciones_facilitadores
         WHERE (p_id_facilitador IS NULL OR id_facilitador = p_id_facilitador)
           AND (p_id_institucion IS NULL OR id_institucion = p_id_institucion)
           AND (p_id_evaluacion  IS NULL OR id_evaluacion  = p_id_evaluacion)
           AND (p_id_area        IS NULL OR id_area        = p_id_area)
           AND (l_desde          IS NULL OR fecha_desde   >= l_desde)
           AND (l_hasta          IS NULL OR fecha_hasta   <= l_hasta)
           AND (l_buscar         IS NULL OR UPPER(evaluado_por) LIKE l_buscar)
         ORDER BY fecha_desde DESC, id_evaluacion_facilitador DESC
         OFFSET l_offset ROWS FETCH NEXT l_limite ROWS ONLY
    ) LOOP
        escribir_fila(
            p_nombre                    => NULL,
            p_id_evaluacion_facilitador => r.id_evaluacion_facilitador,
            p_id_facilitador            => r.id_facilitador,
            p_id_institucion            => r.id_institucion,
            p_id_pais                   => r.id_pais,
            p_id_departamento           => r.id_departamento,
            p_id_ciudad                 => r.id_ciudad,
            p_fecha_desde               => r.fecha_desde,
            p_fecha_hasta               => r.fecha_hasta,
            p_evaluado_por              => r.evaluado_por,
            p_id_area                   => r.id_area,
            p_id_evaluacion             => r.id_evaluacion,
            p_calificacion_estrellas    => r.calificacion_estrellas,
            p_aspectos_positivos        => r.aspectos_positivos,
            p_aspectos_mejorar          => r.aspectos_mejorar,
            p_calificacion              => r.calificacion,
            p_id_auditoria              => r.id_auditoria);
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN e_validacion THEN
        p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END listar;

------------------------------------------------------------------------------
-- OBTENER
------------------------------------------------------------------------------
PROCEDURE obtener(
    p_token IN VARCHAR2,
    p_id    IN NUMBER
) IS
    l_usuario VARCHAR2(255);
    l_fila    EVALUACIONES_FACILITADORES%ROWTYPE;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    IF p_id IS NULL THEN
        p_error(400, 'Bad Request', 'id_evaluacion_facilitador es obligatorio');
        RETURN;
    END IF;

    BEGIN
        SELECT * INTO l_fila
          FROM evaluaciones_facilitadores
         WHERE id_evaluacion_facilitador = p_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_error(404, 'Not Found', 'Evaluacion no encontrada');
            RETURN;
    END;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    escribir_fila(
        p_nombre                    => 'data',
        p_id_evaluacion_facilitador => l_fila.id_evaluacion_facilitador,
        p_id_facilitador            => l_fila.id_facilitador,
        p_id_institucion            => l_fila.id_institucion,
        p_id_pais                   => l_fila.id_pais,
        p_id_departamento           => l_fila.id_departamento,
        p_id_ciudad                 => l_fila.id_ciudad,
        p_fecha_desde               => l_fila.fecha_desde,
        p_fecha_hasta               => l_fila.fecha_hasta,
        p_evaluado_por              => l_fila.evaluado_por,
        p_id_area                   => l_fila.id_area,
        p_id_evaluacion             => l_fila.id_evaluacion,
        p_calificacion_estrellas    => l_fila.calificacion_estrellas,
        p_aspectos_positivos        => l_fila.aspectos_positivos,
        p_aspectos_mejorar          => l_fila.aspectos_mejorar,
        p_calificacion              => l_fila.calificacion,
        p_id_auditoria              => l_fila.id_auditoria);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END obtener;

------------------------------------------------------------------------------
-- INSERTAR
------------------------------------------------------------------------------
PROCEDURE insertar(
    p_token                  IN VARCHAR2,
    p_id_facilitador         IN NUMBER,
    p_id_institucion         IN NUMBER,
    p_id_pais                IN NUMBER,
    p_id_departamento        IN NUMBER,
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN VARCHAR2,
    p_fecha_hasta            IN VARCHAR2,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN VARCHAR2 DEFAULT NULL,
    p_aspectos_mejorar       IN VARCHAR2 DEFAULT NULL,
    p_calificacion           IN VARCHAR2 DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_desde   DATE;
    l_hasta   DATE;
    l_id      evaluaciones_facilitadores.id_evaluacion_facilitador%TYPE;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    l_desde := f_fecha(p_fecha_desde, 'fecha_desde');
    l_hasta := f_fecha(p_fecha_hasta, 'fecha_hasta');

    validar(
        p_id_facilitador         => p_id_facilitador,
        p_id_institucion         => p_id_institucion,
        p_id_pais                => p_id_pais,
        p_id_departamento        => p_id_departamento,
        p_id_ciudad              => p_id_ciudad,
        p_fecha_desde            => l_desde,
        p_fecha_hasta            => l_hasta,
        p_evaluado_por           => p_evaluado_por,
        p_id_area                => p_id_area,
        p_id_evaluacion          => p_id_evaluacion,
        p_calificacion_estrellas => p_calificacion_estrellas,
        p_aspectos_positivos     => p_aspectos_positivos,
        p_aspectos_mejorar       => p_aspectos_mejorar,
        p_calificacion           => p_calificacion);

    -- ID_AUDITORIA no se lista a propósito: lo asigna el trigger.
    INSERT INTO evaluaciones_facilitadores (
        id_facilitador, id_institucion, id_pais, id_departamento, id_ciudad,
        fecha_desde, fecha_hasta, evaluado_por, id_area, id_evaluacion,
        calificacion_estrellas, aspectos_positivos, aspectos_mejorar, calificacion
    ) VALUES (
        p_id_facilitador, p_id_institucion, p_id_pais, p_id_departamento, p_id_ciudad,
        l_desde, l_hasta, TRIM(p_evaluado_por), p_id_area, p_id_evaluacion,
        p_calificacion_estrellas, p_aspectos_positivos, p_aspectos_mejorar, p_calificacion
    ) RETURNING id_evaluacion_facilitador INTO l_id;

    COMMIT;

    OWA_UTIL.STATUS_LINE(201, 'Created', FALSE);
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', 'Evaluacion creada');
    APEX_JSON.WRITE('id_evaluacion_facilitador', l_id);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN e_validacion THEN
        ROLLBACK;
        p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
        ROLLBACK;
        p_error_oracle;
END insertar;

------------------------------------------------------------------------------
-- ACTUALIZAR
------------------------------------------------------------------------------
PROCEDURE actualizar(
    p_token                  IN VARCHAR2,
    p_id                     IN NUMBER,
    p_id_facilitador         IN NUMBER,
    p_id_institucion         IN NUMBER,
    p_id_pais                IN NUMBER,
    p_id_departamento        IN NUMBER,
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN VARCHAR2,
    p_fecha_hasta            IN VARCHAR2,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN VARCHAR2 DEFAULT NULL,
    p_aspectos_mejorar       IN VARCHAR2 DEFAULT NULL,
    p_calificacion           IN VARCHAR2 DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_desde   DATE;
    l_hasta   DATE;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    IF p_id IS NULL THEN
        p_error(400, 'Bad Request', 'id_evaluacion_facilitador es obligatorio');
        RETURN;
    END IF;

    l_desde := f_fecha(p_fecha_desde, 'fecha_desde');
    l_hasta := f_fecha(p_fecha_hasta, 'fecha_hasta');

    -- Update completo (PUT), no parcial: el front manda el registro entero.
    -- Si algún día se quiere PATCH, hay que decidir por campo entre "no vino" y
    -- "vino en null", y eso no se puede con binds simples de ORDS.
    validar(
        p_id_facilitador         => p_id_facilitador,
        p_id_institucion         => p_id_institucion,
        p_id_pais                => p_id_pais,
        p_id_departamento        => p_id_departamento,
        p_id_ciudad              => p_id_ciudad,
        p_fecha_desde            => l_desde,
        p_fecha_hasta            => l_hasta,
        p_evaluado_por           => p_evaluado_por,
        p_id_area                => p_id_area,
        p_id_evaluacion          => p_id_evaluacion,
        p_calificacion_estrellas => p_calificacion_estrellas,
        p_aspectos_positivos     => p_aspectos_positivos,
        p_aspectos_mejorar       => p_aspectos_mejorar,
        p_calificacion           => p_calificacion);

    -- ID_AUDITORIA fuera del SET: es de la bitácora, no del negocio.
    UPDATE evaluaciones_facilitadores
       SET id_facilitador         = p_id_facilitador,
           id_institucion         = p_id_institucion,
           id_pais                = p_id_pais,
           id_departamento        = p_id_departamento,
           id_ciudad              = p_id_ciudad,
           fecha_desde            = l_desde,
           fecha_hasta            = l_hasta,
           evaluado_por           = TRIM(p_evaluado_por),
           id_area                = p_id_area,
           id_evaluacion          = p_id_evaluacion,
           calificacion_estrellas = p_calificacion_estrellas,
           aspectos_positivos     = p_aspectos_positivos,
           aspectos_mejorar       = p_aspectos_mejorar,
           calificacion           = p_calificacion
     WHERE id_evaluacion_facilitador = p_id;

    IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'Evaluacion no encontrada');
        RETURN;
    END IF;

    COMMIT;
    p_ok('Evaluacion actualizada');
EXCEPTION
    WHEN e_validacion THEN
        ROLLBACK;
        p_error(400, 'Bad Request', g_mensaje);
    WHEN OTHERS THEN
        ROLLBACK;
        p_error_oracle;
END actualizar;

------------------------------------------------------------------------------
-- ELIMINAR
------------------------------------------------------------------------------
PROCEDURE eliminar(
    p_token IN VARCHAR2,
    p_id    IN NUMBER
) IS
    l_usuario VARCHAR2(255);
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    IF p_id IS NULL THEN
        p_error(400, 'Bad Request', 'id_evaluacion_facilitador es obligatorio');
        RETURN;
    END IF;

    -- El trigger deja la copia en EVALUACIONES_FACILITADORES_JN con 'DEL', así
    -- que el borrado es físico pero queda rastro.
    DELETE FROM evaluaciones_facilitadores
     WHERE id_evaluacion_facilitador = p_id;

    IF SQL%ROWCOUNT = 0 THEN
        ROLLBACK;
        p_error(404, 'Not Found', 'Evaluacion no encontrada');
        RETURN;
    END IF;

    COMMIT;
    p_ok('Evaluacion eliminada');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_error_oracle;
END eliminar;

END PKG_EVAL_FACILITADORES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 2) ENDPOINTS ORDS =====================================================
--
-- Se agregan al módulo 'ethos' que ya creó ethos_auth.sql.
-- Igual que en auth/*: el PAQUETE emite MIME_HEADER/HTTP_HEADER_CLOSE, el
-- handler NO. Headers duplicados = respuesta corrupta.
--
-- El DEFINE_PARAMETER del header Authorization va por CADA handler, no por
-- template. Si falta, :authorization llega NULL y todo responde
-- "Token invalido o expirado" aunque el login haya dado un token bueno.
--------------------------------------------------------------------------------

BEGIN
  -- Borrado previo: DEFINE_HANDLER falla si el handler ya existe.
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores',     'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores',     'POST');    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores',     'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores/:id', 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores/:id', 'PUT');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores/:id', 'DELETE');  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'evaluaciones-facilitadores/:id', 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ----------------------------------------------------------------------------
  -- evaluaciones-facilitadores  (colección)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'evaluaciones-facilitadores',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- GET: los filtros llegan como query string y ORDS los bindea por nombre.
  --   ?id_facilitador=&id_institucion=&id_evaluacion=&id_area=
  --   &desde=YYYY-MM-DD&hasta=YYYY-MM-DD&buscar=&limite=&pagina=
  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'evaluaciones-facilitadores',
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
    PKG_EVAL_FACILITADORES_ETHOS.LISTAR(
        p_token          => l_token,
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_id_institucion => TO_NUMBER(:id_institucion),
        p_id_evaluacion  => TO_NUMBER(:id_evaluacion),
        p_id_area        => TO_NUMBER(:id_area),
        p_desde          => :desde,
        p_hasta          => :hasta,
        p_buscar         => :buscar,
        p_limite         => TO_NUMBER(:limite),
        p_pagina         => TO_NUMBER(:pagina));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'evaluaciones-facilitadores',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  -- POST: ORDS auto-bindea los campos del JSON PLANO del body.
  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'evaluaciones-facilitadores',
      p_method      => 'POST',
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
    PKG_EVAL_FACILITADORES_ETHOS.INSERTAR(
        p_token                  => l_token,
        p_id_facilitador         => TO_NUMBER(:id_facilitador),
        p_id_institucion         => TO_NUMBER(:id_institucion),
        p_id_pais                => TO_NUMBER(:id_pais),
        p_id_departamento        => TO_NUMBER(:id_departamento),
        p_id_ciudad              => TO_NUMBER(:id_ciudad),
        p_fecha_desde            => :fecha_desde,
        p_fecha_hasta            => :fecha_hasta,
        p_evaluado_por           => :evaluado_por,
        p_id_area                => TO_NUMBER(:id_area),
        p_id_evaluacion          => TO_NUMBER(:id_evaluacion),
        p_calificacion_estrellas => TO_NUMBER(:calificacion_estrellas),
        p_aspectos_positivos     => :aspectos_positivos,
        p_aspectos_mejorar       => :aspectos_mejorar,
        p_calificacion           => :calificacion);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'evaluaciones-facilitadores',
      p_method             => 'POST',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ----------------------------------------------------------------------------
  -- evaluaciones-facilitadores/:id  (registro)
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'evaluaciones-facilitadores/:id',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'evaluaciones-facilitadores/:id',
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
    PKG_EVAL_FACILITADORES_ETHOS.OBTENER(
        p_token => l_token,
        p_id    => TO_NUMBER(:id));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'evaluaciones-facilitadores/:id',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'evaluaciones-facilitadores/:id',
      p_method      => 'PUT',
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
    PKG_EVAL_FACILITADORES_ETHOS.ACTUALIZAR(
        p_token                  => l_token,
        p_id                     => TO_NUMBER(:id),
        p_id_facilitador         => TO_NUMBER(:id_facilitador),
        p_id_institucion         => TO_NUMBER(:id_institucion),
        p_id_pais                => TO_NUMBER(:id_pais),
        p_id_departamento        => TO_NUMBER(:id_departamento),
        p_id_ciudad              => TO_NUMBER(:id_ciudad),
        p_fecha_desde            => :fecha_desde,
        p_fecha_hasta            => :fecha_hasta,
        p_evaluado_por           => :evaluado_por,
        p_id_area                => TO_NUMBER(:id_area),
        p_id_evaluacion          => TO_NUMBER(:id_evaluacion),
        p_calificacion_estrellas => TO_NUMBER(:calificacion_estrellas),
        p_aspectos_positivos     => :aspectos_positivos,
        p_aspectos_mejorar       => :aspectos_mejorar,
        p_calificacion           => :calificacion);
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'evaluaciones-facilitadores/:id',
      p_method             => 'PUT',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'evaluaciones-facilitadores/:id',
      p_method      => 'DELETE',
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
    PKG_EVAL_FACILITADORES_ETHOS.ELIMINAR(
        p_token => l_token,
        p_id    => TO_NUMBER(:id));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'evaluaciones-facilitadores/:id',
      p_method             => 'DELETE',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de evaluaciones-facilitadores publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudieron publicar los handlers: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/ethos_auth.sql).');
    RAISE;
END;
/

-- Preflight CORS (OPTIONS), en bloque aparte y a prueba de fallos: algunas
-- versiones de ORDS rechazan OPTIONS en p_method. Solo hace falta si algún día
-- un navegador le pega DIRECTO a ORDS (hoy la web va por su proxy).
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
  preflight('evaluaciones-facilitadores');
  preflight('evaluaciones-facilitadores/:id');
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Preflight OPTIONS publicado.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[WARN] Esta version de ORDS no acepta handlers OPTIONS: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('       No bloquea nada con la arquitectura actual.');
END;
/

--------------------------------------------------------------------------------
-- === 3) VERIFICACION =======================================================
-- Imprime el estado de todo lo que este script necesita y la URL base real.
--------------------------------------------------------------------------------

DECLARE
  l_n       NUMBER;
  l_pattern VARCHAR2(200);

  PROCEDURE chequear_objeto(p_nombre IN VARCHAR2, p_tipo IN VARCHAR2) IS
    l_c NUMBER;
  BEGIN
    SELECT COUNT(*) INTO l_c
      FROM user_objects
     WHERE object_name = p_nombre
       AND object_type = p_tipo;
    IF l_c > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[OK]    ' || p_tipo || ' ' || p_nombre);
    ELSE
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || p_tipo || ' ' || p_nombre);
    END IF;
  END chequear_objeto;
BEGIN
  DBMS_OUTPUT.PUT_LINE('--- Dependencias ------------------------------------------');
  chequear_objeto('EVALUACIONES_FACILITADORES',       'TABLE');
  chequear_objeto('EVALUACIONES_FACILITADORES_JN',    'TABLE');
  chequear_objeto('SEQ_AUDITORIA',                   'SEQUENCE');
  chequear_objeto('EVALUACIONES_FACILITADORES_JNTRG','TRIGGER');
  chequear_objeto('PKG_AUTH_ETHOS',                  'PACKAGE');
  chequear_objeto('PKG_EVAL_FACILITADORES_ETHOS',    'PACKAGE');

  -- Objetos con errores de compilación: es el fallo más común y el más silencioso.
  SELECT COUNT(*) INTO l_n
    FROM user_errors
   WHERE name IN ('PKG_EVAL_FACILITADORES_ETHOS');
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    PKG_EVAL_FACILITADORES_ETHOS compilo sin errores.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_EVAL_FACILITADORES_ETHOS tiene ' || l_n || ' error(es):');
    FOR e IN (SELECT line, position, text
                FROM user_errors
               WHERE name = 'PKG_EVAL_FACILITADORES_ETHOS'
               ORDER BY sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        linea ' || e.line || ',' || e.position || ': ' || e.text);
    END LOOP;
  END IF;

  DBMS_OUTPUT.PUT_LINE('--- Endpoints ---------------------------------------------');
  -- Dinámico: si esta version de ORDS no expone estas vistas, un SELECT estatico
  -- rompe la COMPILACION del bloque entero y no se veria ni el chequeo anterior.
  BEGIN
    EXECUTE IMMEDIATE q'~
      SELECT COUNT(*)
        FROM user_ords_handlers h
        JOIN user_ords_templates t ON t.id = h.template_id
       WHERE t.uri_template LIKE 'evaluaciones-facilitadores%'~'
    INTO l_n;
    DBMS_OUTPUT.PUT_LINE('[INFO]  Handlers publicados: ' || l_n
                         || ' (se esperan 5 sin OPTIONS, 7 con)');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('[SKIP]  No se pudo leer el catalogo de ORDS: ' || SQLERRM);
  END;

  BEGIN
    SELECT pattern INTO l_pattern FROM user_ords_schemas WHERE ROWNUM = 1;
    DBMS_OUTPUT.PUT_LINE('[INFO]  URL BASE: https://oracleapex.com/ords/' || l_pattern || '/ethos/');
    DBMS_OUTPUT.PUT_LINE('        GET    evaluaciones-facilitadores?limite=20&pagina=1');
    DBMS_OUTPUT.PUT_LINE('        GET    evaluaciones-facilitadores/1');
    DBMS_OUTPUT.PUT_LINE('        POST   evaluaciones-facilitadores');
    DBMS_OUTPUT.PUT_LINE('        PUT    evaluaciones-facilitadores/1');
    DBMS_OUTPUT.PUT_LINE('        DELETE evaluaciones-facilitadores/1');
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] El esquema no esta REST-enabled. Corre backend/ethos_auth.sql.');
  END;
END;
/

--------------------------------------------------------------------------------
-- === 4) PRUEBA RAPIDA CON curl =============================================
--
--   TOKEN=$(curl -s -X POST "https://oracleapex.com/ords/fundcarac/ethos/auth/login" \
--     -H "Content-Type: application/json" \
--     -d '{"usuario":"joseg","password":"xxx"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
--
--   # listar
--   curl -s "https://oracleapex.com/ords/fundcarac/ethos/evaluaciones-facilitadores?limite=5" \
--     -H "Authorization: Bearer $TOKEN"
--
--   # insertar
--   curl -s -X POST "https://oracleapex.com/ords/fundcarac/ethos/evaluaciones-facilitadores" \
--     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
--     -d '{"id_facilitador":1,"id_institucion":1,"id_pais":1,"id_departamento":1,
--          "id_ciudad":1,"fecha_desde":"2026-07-01","fecha_hasta":"2026-07-15",
--          "evaluado_por":"Jose Galvez","id_area":1,"id_evaluacion":1,
--          "calificacion_estrellas":4,"aspectos_positivos":"Puntual y claro",
--          "aspectos_mejorar":"Cerrar con resumen","calificacion":"Muy bueno"}'
--
--   # actualizar / eliminar
--   curl -s -X PUT    ".../evaluaciones-facilitadores/1" -H "Authorization: Bearer $TOKEN" ...
--   curl -s -X DELETE ".../evaluaciones-facilitadores/1" -H "Authorization: Bearer $TOKEN"
--
-- Si curl funciona y el front no, el problema esta en el proxy o en la URL
-- configurada, no en la base.
--------------------------------------------------------------------------------
