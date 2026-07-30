--------------------------------------------------------------------------------
-- EVALUACIONES_FACILITADORES — migracion + CRUD + listas de valores.
--
-- Ejecutar completo como el DUEÑO DEL ESQUEMA (el mismo que corrio
-- backend/ethos_auth.sql). Idempotente: se puede volver a correr.
--
-- REQUISITOS PREVIOS
--   1. backend/ethos_auth.sql ya corrido -> PKG_AUTH_ETHOS y el modulo ORDS
--      'ethos'. Este script NO define el modulo ni habilita el esquema en ORDS:
--      solo agrega handlers al modulo que ya esta.
--   2. Tablas EVALUACIONES_FACILITADORES (+ su trigger y su tabla _JN),
--      FACILITADORES, INSTITUCIONES, AREAS_EVALUACIONES, EVALUACIONES, CIUDADES
--      y SEQ_AUDITORIA. La seccion 4 verifica y avisa si falta algo.
--
-- ENDPOINTS (base: https://oracleapex.com/ords/<pattern>/ethos/)
--
--   CRUD
--     GET    evaluaciones-facilitadores          listar (filtros + paginado)
--     GET    evaluaciones-facilitadores/:id      obtener uno
--     POST   evaluaciones-facilitadores          insertar
--     PUT    evaluaciones-facilitadores/:id      actualizar
--     DELETE evaluaciones-facilitadores/:id      eliminar
--
--   LISTAS DE VALORES (combos del formulario)
--     GET    listas/facilitadores   ?buscar=&activo=&incluir_id=&limite=
--     GET    listas/instituciones   ?buscar=&estado=&incluir_id=&id_facilitador=&anio=&limite=
--     GET    listas/areas           ?buscar=&limite=
--     GET    listas/evaluaciones    ?id_area=&buscar=&limite=
--     GET    listas/ciudades        ?buscar=&limite=
--
--   Todos protegidos: Authorization: Bearer <token> de auth/login.
--
--------------------------------------------------------------------------------
-- DECISIONES QUE CONVIENE SABER ANTES DE TOCAR ESTO
--
-- 1. FORMA DE LA TABLA QUE ESPERA ESTE SCRIPT (la que ya tenes):
--      PK      ID_EVALUACION_FACILITADOR (identity)
--      ciudad  ID_CIUDAD sola, con FK simple a CIUDADES(ID_CIUDAD).
--              Sin ID_PAIS ni ID_DEPARTAMENTO: son recuperables por join a
--              CIUDADES y el historico viejo sigue en la tabla _JN.
--      textos  ASPECTOS_POSITIVOS y ASPECTOS_MEJORAR son CLOB.
--    La seccion 1 NO recrea nada: verifica y agrega lo que falte (PK, FKs,
--    CHECK, y la columna de la PK en la tabla _JN). Sobre tu tabla actual va a
--    imprimir puro [SKIP], que es lo esperado.
--
-- 2. La seccion 2 vuelve a crear el trigger de bitacora. Es el tuyo, con un solo
--    cambio: la asignacion a :NEW.ID_AUDITORIA ocurre solo en UPDATING. En la
--    rama DELETING escribir :NEW es ORA-04084, y esa rama se activa con
--    cualquier fila que tenga ID_AUDITORIA en NULL. Hoy es codigo muerto porque
--    el INSERT siempre deja valor; si preferis tu version tal cual, salteate
--    esta seccion, el resto del script no depende de ella.
--
-- 3. CLOB en los dos campos de comentarios: el paquete no valida largo (no hay
--    tope de columna) y los devuelve completos en el JSON. El limite real lo
--    pone el bind de ORDS, no la base: si algun dia el front manda mas de 32 KB
--    en un campo, hay que pasar el handler a leer el body como CLOB. Con
--    textareas de formulario no se llega ni cerca.
--
-- 4. CASCADA DEL FORMULARIO: facilitador -> institucion -> ciudad.
--
--    a) GET listas/instituciones?id_facilitador=N devuelve solo las
--       instituciones donde ese facilitador tiene POSTULACIONES. Se resuelve con
--       EXISTS y no con JOIN: un facilitador puede tener varias postulaciones en
--       la misma institucion (materia, turno o año distintos) y un JOIN la
--       repetiria en el combo.
--
--    b) Esa misma lista trae ID_CIUDAD y el nombre de la ciudad de la
--       institucion, para que el front la cargue sin combo aparte.
--       INSTITUCIONES.ID_CIUDAD es NULLABLE: si viene en null el front cae a
--       elegir la ciudad a mano, no puede dejarla vacia porque en
--       EVALUACIONES_FACILITADORES es NOT NULL.
--
--    c) Filtro de año opcional (?anio=, contra POSTULACIONES.ANIO). Sin el
--       parametro no filtra: si filtrara por el lectivo actual por defecto, un
--       facilitador cuyas postulaciones de este año no se cargaron todavia
--       apareceria sin ninguna institucion y el formulario quedaria trabado.
--       Hay FN_ANIO_LECTIVO_ACTUAL() si algun dia se quiere ese default.
--
--    d) La base NO obliga nada de esto: se puede guardar una evaluacion con una
--       institucion donde el facilitador nunca postulo. Es una ayuda de captura,
--       no una regla de integridad. Si tiene que ser regla, va como validacion
--       en INSERTAR/ACTUALIZAR.
--
-- 5. EVALUACIONES tiene ID_AREA, o sea que una evaluacion pertenece a un area.
--    Esta tabla guarda ID_AREA e ID_EVALUACION por separado y NADA en la base
--    impide que se contradigan. El paquete valida que la evaluacion pertenezca
--    al area enviada y responde 400 si no. Por eso el front debe cargar el combo
--    filtrado: GET listas/evaluaciones?id_area=<el elegido>.
--
-- 6. Los combos filtran por vigencia POR DEFECTO:
--      FACILITADORES.ACTIVO = 'SI' / 'NO'  -> por defecto solo 'SI'
--      INSTITUCIONES.ESTADO = 'A' / 'I'    -> por defecto solo 'A'
--    Para traer todo: ?activo=TODOS / ?estado=TODOS. Para un valor puntual:
--    ?activo=NO / ?estado=I.
--    En instituciones el filtro usa NVL(estado,'A'): las filas con ESTADO en
--    null cuentan como activas, si no desaparecerian del combo sin explicacion.
--
--    Y ojo con esto en el FORMULARIO DE EDICION: si una evaluacion vieja apunta
--    a un facilitador que despues se dio de baja, el combo por defecto NO lo
--    trae y el campo se ve vacio. Para eso esta ?incluir_id=<el guardado>: ese
--    id entra siempre, activo o no. El front debe mandarlo al editar.
--
-- 7. ID_AUDITORIA no se acepta del cliente ni entra en el UPDATE. Lo asigna el
--    trigger desde SEQ_AUDITORIA. Mandarlo desde el front seria pisar bitacora.
--
-- 8. Las fechas viajan como texto ISO 'YYYY-MM-DD'. Si el front manda el ISO
--    largo con hora (toISOString()), se toman los primeros 10 caracteres. Se
--    devuelven siempre 'YYYY-MM-DD': nunca se depende del NLS_DATE_FORMAT.
--
-- 9. Los LEFT JOIN del listado son a proposito, incluso para las FK NOT NULL:
--    si un dato quedara huerfano, la fila igual tiene que aparecer (con el
--    nombre en null) en vez de desaparecer del listado sin explicacion.
--
-- 10. Ciudades homonimas: la lista devuelve id_ciudad + nombre, sin el
--    departamento, porque no tengo el DDL de DEPARTAMENTOS y adivinar el nombre
--    de su columna descriptiva rompe la compilacion. Si hay dos ciudades con el
--    mismo nombre en departamentos distintos, en el combo se ven iguales.
--    Pasame el DDL de DEPARTAMENTOS y le agrego el departamento al texto.
--
-- 11. El usuario que queda en la bitacora: el trigger usa
--     NVL(V('APP_USER'), USER) y fuera de APEX V('APP_USER') es NULL, asi que
--     el JN registra el usuario del esquema, no quien uso la app. Este paquete
--     deja el usuario del token en CLIENT_IDENTIFIER; en la seccion 2 esta la
--     linea alternativa lista para usar, comentada, porque cambiar que se
--     registra en la auditoria es una decision tuya, no mia.
--
-- 12. Si ya corriste el ethos_catalogos.sql que te pase antes, quedo obsoleto
--     (esas listas genericas las reemplazan los endpoints listas/* de aca).
--     Para limpiarlo:
--       BEGIN ORDS.DELETE_HANDLER('ethos','catalogos','GET'); END;
--       BEGIN ORDS.DELETE_HANDLER('ethos','catalogos/:nombre','GET'); END;
--       DROP PACKAGE PKG_CATALOGOS_ETHOS;
--------------------------------------------------------------------------------

SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED

--------------------------------------------------------------------------------
-- === 1) ESTRUCTURA: PK, FKs y columna del journal ===========================
--
-- NO borra ni recrea nada: verifica y completa lo que falte. Se puede correr
-- sobre la tabla tal como esta hoy (sin PK) o sobre una recien creada.
--
-- El estado final que deja es este, y es el que conviene usar si preferis
-- recrear la tabla a mano en vez de correr esta seccion:
--
--   CREATE TABLE EVALUACIONES_FACILITADORES (
--     ID_EVALUACION_FACILITADOR NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY
--                               NOT NULL ENABLE,
--     ID_FACILITADOR            NUMBER         NOT NULL ENABLE,
--     ID_INSTITUCION            NUMBER         NOT NULL ENABLE,
--     ID_CIUDAD                 NUMBER         NOT NULL ENABLE,
--     FECHA_DESDE               DATE           NOT NULL ENABLE,
--     FECHA_HASTA               DATE           NOT NULL ENABLE,
--     EVALUADO_POR              VARCHAR2(255)  NOT NULL ENABLE,
--     ID_AREA                   NUMBER         NOT NULL ENABLE,
--     ID_EVALUACION             NUMBER         NOT NULL ENABLE,
--     CALIFICACION_ESTRELLAS    NUMBER,
--     ASPECTOS_POSITIVOS        VARCHAR2(1000),
--     ASPECTOS_MEJORAR          VARCHAR2(1000),
--     CALIFICACION              VARCHAR2(100),
--     ID_AUDITORIA              NUMBER,
--     CHECK (calificacion_estrellas BETWEEN 1 AND 5) ENABLE,
--     CONSTRAINT EVAL_FAC_PK PRIMARY KEY (ID_EVALUACION_FACILITADOR)
--   );
--   + las 5 FKs (facilitador, institucion, ciudad, area, evaluacion)
--
-- Agregar una columna IDENTITY a una tabla con datos es seguro: Oracle numera
-- las filas existentes al vuelo. Nada se pierde.
--------------------------------------------------------------------------------

DECLARE
  l_c PLS_INTEGER;

  PROCEDURE ejecutar(p_sql IN VARCHAR2, p_ok IN VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
    DBMS_OUTPUT.PUT_LINE('[OK]    ' || p_ok);
  END ejecutar;

  FUNCTION hay_columna(p_tabla IN VARCHAR2, p_columna IN VARCHAR2) RETURN BOOLEAN IS
    n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO n
      FROM user_tab_columns
     WHERE table_name = p_tabla AND column_name = p_columna;
    RETURN n > 0;
  END hay_columna;

  FUNCTION hay_constraint(p_nombre IN VARCHAR2) RETURN BOOLEAN IS
    n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO n FROM user_constraints WHERE constraint_name = p_nombre;
    RETURN n > 0;
  END hay_constraint;

  -- Agrega una FK solo si no hay ya una (con cualquier nombre) sobre esa columna.
  PROCEDURE fk(p_nombre IN VARCHAR2, p_columna IN VARCHAR2,
               p_tabla_ref IN VARCHAR2, p_col_ref IN VARCHAR2) IS
    n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO n
      FROM user_constraints c
      JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
     WHERE c.table_name      = 'EVALUACIONES_FACILITADORES'
       AND c.constraint_type = 'R'
       AND cc.column_name    = p_columna;
    IF n > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[SKIP]  Ya hay FK sobre ' || p_columna || '.');
    ELSE
      ejecutar('ALTER TABLE evaluaciones_facilitadores ADD CONSTRAINT ' || p_nombre
               || ' FOREIGN KEY (' || p_columna || ') REFERENCES ' || p_tabla_ref
               || ' (' || p_col_ref || ')',
               'FK ' || p_nombre || ' creada sobre ' || p_columna || '.');
    END IF;
  END fk;
BEGIN
  DBMS_OUTPUT.PUT_LINE('=== 1) Estructura ========================================');

  SELECT COUNT(*) INTO l_c FROM user_tables WHERE table_name = 'EVALUACIONES_FACILITADORES';
  IF l_c = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla EVALUACIONES_FACILITADORES.');
    DBMS_OUTPUT.PUT_LINE('        Creala con el DDL del comentario de arriba y volve a correr.');
    RETURN;
  END IF;

  -- 1.1 La PK. Sin esto el API no puede direccionar una fila y un UPDATE podria
  -- tocar varias: dos evaluaciones del mismo facilitador, misma institucion y
  -- mismo periodo son indistinguibles.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES', 'ID_EVALUACION_FACILITADOR') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD ('
             || 'id_evaluacion_facilitador NUMBER '
             || 'GENERATED BY DEFAULT ON NULL AS IDENTITY)',
             'Columna ID_EVALUACION_FACILITADOR (identity) agregada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  ID_EVALUACION_FACILITADOR ya existia.');
  END IF;

  SELECT COUNT(*) INTO l_c
    FROM user_constraints
   WHERE table_name = 'EVALUACIONES_FACILITADORES' AND constraint_type = 'P';
  IF l_c = 0 THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD CONSTRAINT EVAL_FAC_PK '
             || 'PRIMARY KEY (id_evaluacion_facilitador)',
             'PRIMARY KEY EVAL_FAC_PK creada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La tabla ya tenia PRIMARY KEY.');
  END IF;

  -- 1.2 Las 5 FKs. Si ya las creaste con tus nombres, se saltean.
  fk('EVAL_FAC_FK_FACILITADOR', 'ID_FACILITADOR', 'facilitadores',      'id_facilitador');
  fk('EVAL_FAC_FK_INSTITUCION', 'ID_INSTITUCION', 'instituciones',      'id_institucion');
  fk('EVAL_FAC_FK_CIUDAD',      'ID_CIUDAD',      'ciudades',           'id_ciudad');
  fk('EVAL_FAC_FK_AREA',        'ID_AREA',        'areas_evaluaciones', 'id_area');
  fk('EVAL_FAC_FK_EVALUACION',  'ID_EVALUACION',  'evaluaciones',       'id_evaluacion');

  -- 1.3 El CHECK de las estrellas.
  SELECT COUNT(*) INTO l_c
    FROM user_constraints
   WHERE table_name = 'EVALUACIONES_FACILITADORES'
     AND constraint_type = 'C'
     AND UPPER(search_condition_vc) LIKE '%CALIFICACION_ESTRELLAS%BETWEEN%';
  IF l_c = 0 THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD CONSTRAINT EVAL_FAC_CK_ESTRELLAS '
             || 'CHECK (calificacion_estrellas BETWEEN 1 AND 5)',
             'CHECK de estrellas (1..5) creado.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  El CHECK de estrellas ya existia.');
  END IF;

  -- 1.4 La columna en el journal. El trigger de la seccion 2 vuelve a guardar
  -- que fila cambio; si la columna no esta en la _JN, el trigger no compila.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES_JN', 'ID_EVALUACION_FACILITADOR') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores_jn ADD '
             || '(id_evaluacion_facilitador NUMBER)',
             'Columna ID_EVALUACION_FACILITADOR agregada a la tabla _JN.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La _JN ya tenia ID_EVALUACION_FACILITADOR.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Estructura incompleta: ' || SQLERRM);
    RAISE;
END;
/

--------------------------------------------------------------------------------
-- === 2) TRIGGER DE AUDITORIA ================================================
--
-- El mismo trigger tuyo (ya sin ID_PAIS / ID_DEPARTAMENTO, con la PK de vuelta
-- en el journal) y un unico cambio de fondo:
--
--   la asignacion a :NEW.ID_AUDITORIA ocurre solo en UPDATING.
--
-- En la rama DELETING escribir :NEW da ORA-04084 "cannot change NEW values for
-- this trigger type", y esa rama se activa con cualquier fila que tenga
-- ID_AUDITORIA en NULL. Hoy no pasa porque el INSERT siempre deja valor, pero es
-- una mina esperando una carga masiva que no pase por aca.
--
-- Si preferis tu version tal cual, salteate esta seccion: el resto del script no
-- depende de ella. Las columnas ID_PAIS / ID_DEPARTAMENTO de la tabla _JN se
-- dejan en paz (guardan el historico) y las filas nuevas las dejan en NULL.
--------------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER EVALUACIONES_FACILITADORES_JNTRG
BEFORE INSERT OR UPDATE OR DELETE ON EVALUACIONES_FACILITADORES
FOR EACH ROW
DECLARE
  v_audit_id NUMBER;
BEGIN
  IF INSERTING THEN
    IF :NEW.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO :NEW.ID_AUDITORIA FROM dual;
    END IF;
    v_audit_id := :NEW.ID_AUDITORIA;
  ELSIF UPDATING THEN
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
      :NEW.ID_AUDITORIA := v_audit_id;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  ELSIF DELETING THEN
    -- Sin tocar :NEW: en DELETE no se puede escribir (ORA-04084).
    IF :OLD.ID_AUDITORIA IS NULL THEN
      SELECT SEQ_AUDITORIA.NEXTVAL INTO v_audit_id FROM dual;
    ELSE
      v_audit_id := :OLD.ID_AUDITORIA;
    END IF;
  END IF;

  IF INSERTING THEN
    INSERT INTO EVALUACIONES_FACILITADORES_JN (
      ID_AUDITORIA,
      ID_EVALUACION_FACILITADOR,
      ID_FACILITADOR,
      ID_INSTITUCION,
      ID_CIUDAD,
      FECHA_DESDE,
      FECHA_HASTA,
      EVALUADO_POR,
      ID_AREA,
      ID_EVALUACION,
      CALIFICACION_ESTRELLAS,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      CALIFICACION,
      JN_OPERATION,
      JN_ORACLE_USER,
      JN_DATETIME,
      JN_NOTES,
      JN_APPLN,
      JN_SESSION
    ) VALUES (
      v_audit_id,
      :NEW.ID_EVALUACION_FACILITADOR,
      :NEW.ID_FACILITADOR,
      :NEW.ID_INSTITUCION,
      :NEW.ID_CIUDAD,
      :NEW.FECHA_DESDE,
      :NEW.FECHA_HASTA,
      :NEW.EVALUADO_POR,
      :NEW.ID_AREA,
      :NEW.ID_EVALUACION,
      :NEW.CALIFICACION_ESTRELLAS,
      :NEW.ASPECTOS_POSITIVOS,
      :NEW.ASPECTOS_MEJORAR,
      :NEW.CALIFICACION,
      'INS',
      -- Para que la bitacora guarde el usuario de la app y no el del esquema,
      -- reemplazar por (el paquete deja el usuario en CLIENT_IDENTIFIER):
      --   NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER'), USER))
      NVL(V('APP_USER'), USER),
      SYSDATE,
      NULL,
      SYS_CONTEXT('USERENV', 'MODULE'),
      SYS_CONTEXT('USERENV', 'SESSIONID')
    );
  ELSIF UPDATING THEN
    INSERT INTO EVALUACIONES_FACILITADORES_JN (
      ID_AUDITORIA,
      ID_EVALUACION_FACILITADOR,
      ID_FACILITADOR,
      ID_INSTITUCION,
      ID_CIUDAD,
      FECHA_DESDE,
      FECHA_HASTA,
      EVALUADO_POR,
      ID_AREA,
      ID_EVALUACION,
      CALIFICACION_ESTRELLAS,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      CALIFICACION,
      JN_OPERATION,
      JN_ORACLE_USER,
      JN_DATETIME,
      JN_NOTES,
      JN_APPLN,
      JN_SESSION
    ) VALUES (
      v_audit_id,
      :NEW.ID_EVALUACION_FACILITADOR,
      :NEW.ID_FACILITADOR,
      :NEW.ID_INSTITUCION,
      :NEW.ID_CIUDAD,
      :NEW.FECHA_DESDE,
      :NEW.FECHA_HASTA,
      :NEW.EVALUADO_POR,
      :NEW.ID_AREA,
      :NEW.ID_EVALUACION,
      :NEW.CALIFICACION_ESTRELLAS,
      :NEW.ASPECTOS_POSITIVOS,
      :NEW.ASPECTOS_MEJORAR,
      :NEW.CALIFICACION,
      'UPD',
      NVL(V('APP_USER'), USER),
      SYSDATE,
      NULL,
      SYS_CONTEXT('USERENV', 'MODULE'),
      SYS_CONTEXT('USERENV', 'SESSIONID')
    );
  ELSIF DELETING THEN
    INSERT INTO EVALUACIONES_FACILITADORES_JN (
      ID_AUDITORIA,
      ID_EVALUACION_FACILITADOR,
      ID_FACILITADOR,
      ID_INSTITUCION,
      ID_CIUDAD,
      FECHA_DESDE,
      FECHA_HASTA,
      EVALUADO_POR,
      ID_AREA,
      ID_EVALUACION,
      CALIFICACION_ESTRELLAS,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      CALIFICACION,
      JN_OPERATION,
      JN_ORACLE_USER,
      JN_DATETIME,
      JN_NOTES,
      JN_APPLN,
      JN_SESSION
    ) VALUES (
      v_audit_id,
      :OLD.ID_EVALUACION_FACILITADOR,
      :OLD.ID_FACILITADOR,
      :OLD.ID_INSTITUCION,
      :OLD.ID_CIUDAD,
      :OLD.FECHA_DESDE,
      :OLD.FECHA_HASTA,
      :OLD.EVALUADO_POR,
      :OLD.ID_AREA,
      :OLD.ID_EVALUACION,
      :OLD.CALIFICACION_ESTRELLAS,
      :OLD.ASPECTOS_POSITIVOS,
      :OLD.ASPECTOS_MEJORAR,
      :OLD.CALIFICACION,
      'DEL',
      NVL(V('APP_USER'), USER),
      SYSDATE,
      NULL,
      SYS_CONTEXT('USERENV', 'MODULE'),
      SYS_CONTEXT('USERENV', 'SESSIONID')
    );
  END IF;
END;
/

ALTER TRIGGER EVALUACIONES_FACILITADORES_JNTRG ENABLE;

--------------------------------------------------------------------------------
-- === 3) PAQUETE PKG_EVAL_FACILITADORES_ETHOS ================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_EVAL_FACILITADORES_ETHOS AS

  -- Todos los procedimientos escriben la respuesta HTTP completa (headers +
  -- JSON). El handler ORDS NO debe emitir headers: quedarian duplicados.
  -- Las fechas entran y salen como texto ISO 'YYYY-MM-DD'.

  ----------------------------------------------------------------------------
  -- CRUD
  ----------------------------------------------------------------------------

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
      p_id_ciudad              IN NUMBER,
      p_fecha_desde            IN VARCHAR2,
      p_fecha_hasta            IN VARCHAR2,
      p_evaluado_por           IN VARCHAR2,
      p_id_area                IN NUMBER,
      p_id_evaluacion          IN NUMBER,
      p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN CLOB     DEFAULT NULL,
      p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
      p_calificacion           IN VARCHAR2 DEFAULT NULL);

  PROCEDURE actualizar(
      p_token                  IN VARCHAR2,
      p_id                     IN NUMBER,
      p_id_facilitador         IN NUMBER,
      p_id_institucion         IN NUMBER,
      p_id_ciudad              IN NUMBER,
      p_fecha_desde            IN VARCHAR2,
      p_fecha_hasta            IN VARCHAR2,
      p_evaluado_por           IN VARCHAR2,
      p_id_area                IN NUMBER,
      p_id_evaluacion          IN NUMBER,
      p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN CLOB     DEFAULT NULL,
      p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
      p_calificacion           IN VARCHAR2 DEFAULT NULL);

  PROCEDURE eliminar(
      p_token IN VARCHAR2,
      p_id    IN NUMBER);

  ----------------------------------------------------------------------------
  -- LISTAS DE VALORES
  ----------------------------------------------------------------------------

  -- Un solo punto de entrada. p_nombre: facilitadores | instituciones | areas |
  -- evaluaciones | ciudades. Cada lista usa los parametros que le sirven e
  -- ignora el resto.
  PROCEDURE lista(
      p_token      IN VARCHAR2,
      p_nombre     IN VARCHAR2,
      p_buscar     IN VARCHAR2 DEFAULT NULL,
      p_id_area    IN NUMBER   DEFAULT NULL,
      p_activo     IN VARCHAR2 DEFAULT NULL,
      p_estado     IN VARCHAR2 DEFAULT NULL,
      p_incluir_id IN NUMBER   DEFAULT NULL,
      -- Solo `instituciones`: las del facilitador, via POSTULACIONES.
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      p_anio           IN VARCHAR2 DEFAULT NULL,
      p_limite     IN NUMBER   DEFAULT NULL);

END PKG_EVAL_FACILITADORES_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_EVAL_FACILITADORES_ETHOS AS

  -- Topes de filas. Sin esto un cliente pide 100.000 filas y se lleva la
  -- instancia puesta.
  c_limite_defecto CONSTANT PLS_INTEGER := 50;
  c_limite_maximo  CONSTANT PLS_INTEGER := 200;
  c_lov_defecto    CONSTANT PLS_INTEGER := 100;
  c_lov_maximo     CONSTANT PLS_INTEGER := 500;

  -- Error de validacion. Se atrapa en cada procedimiento y sale como 400.
  e_validacion EXCEPTION;
  g_mensaje    VARCHAR2(400);

  ----------------------------------------------------------------------------
  -- Consulta unica del CRUD, con los nombres resueltos.
  --
  -- La comparten LISTAR (con filtros) y OBTENER (filtrando por p_id): una sola
  -- definicion, imposible que los dos endpoints devuelvan campos distintos.
  --
  -- LEFT JOIN incluso en las FK NOT NULL: si un dato quedara huerfano la fila
  -- tiene que aparecer con el nombre en null, no desaparecer del listado.
  ----------------------------------------------------------------------------
  CURSOR c_eval(
      p_id             NUMBER,
      p_id_facilitador NUMBER,
      p_id_institucion NUMBER,
      p_id_evaluacion  NUMBER,
      p_id_area        NUMBER,
      p_desde          DATE,
      p_hasta          DATE,
      p_buscar         VARCHAR2,
      p_offset         NUMBER,
      p_limite         NUMBER
  ) IS
    SELECT e.id_evaluacion_facilitador,
           e.id_facilitador,
           f.nombre_apellido        AS facilitador,
           e.id_institucion,
           i.nombre                 AS institucion,
           e.id_ciudad,
           c.nombre                 AS ciudad,
           e.fecha_desde,
           e.fecha_hasta,
           e.evaluado_por,
           e.id_area,
           a.descripcion            AS area,
           e.id_evaluacion,
           ev.descripcion           AS evaluacion,
           e.calificacion_estrellas,
           e.aspectos_positivos,
           e.aspectos_mejorar,
           e.calificacion,
           e.id_auditoria
      FROM evaluaciones_facilitadores e
      LEFT JOIN facilitadores      f  ON f.id_facilitador  = e.id_facilitador
      LEFT JOIN instituciones      i  ON i.id_institucion  = e.id_institucion
      LEFT JOIN areas_evaluaciones a  ON a.id_area         = e.id_area
      LEFT JOIN evaluaciones       ev ON ev.id_evaluacion  = e.id_evaluacion
      LEFT JOIN ciudades           c  ON c.id_ciudad       = e.id_ciudad
     WHERE (p_id             IS NULL OR e.id_evaluacion_facilitador = p_id)
       AND (p_id_facilitador IS NULL OR e.id_facilitador = p_id_facilitador)
       AND (p_id_institucion IS NULL OR e.id_institucion = p_id_institucion)
       AND (p_id_evaluacion  IS NULL OR e.id_evaluacion  = p_id_evaluacion)
       AND (p_id_area        IS NULL OR e.id_area        = p_id_area)
       AND (p_desde          IS NULL OR e.fecha_desde   >= p_desde)
       AND (p_hasta          IS NULL OR e.fecha_hasta   <= p_hasta)
       AND (p_buscar         IS NULL
            OR UPPER(e.evaluado_por)    LIKE p_buscar
            OR UPPER(f.nombre_apellido) LIKE p_buscar
            OR UPPER(i.nombre)          LIKE p_buscar)
     ORDER BY e.fecha_desde DESC, e.id_evaluacion_facilitador DESC
     OFFSET p_offset ROWS FETCH NEXT p_limite ROWS ONLY;

------------------------------------------------------------------------------
-- Helpers de respuesta (mismo patron que PKG_AUTH_ETHOS)
------------------------------------------------------------------------------

-- CORS abierto por el unico cliente que pega directo a ORDS: la app Expo de
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
-- respuesta ya esta abierta y el status se pierde (queda 200 con success:false).
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

PROCEDURE p_ok(p_message IN VARCHAR2) IS
BEGIN
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', p_message);
    APEX_JSON.CLOSE_OBJECT;
END p_ok;

-- Traduce los errores de integridad a algo que el usuario entienda. Sin esto,
-- una FK rota le llega al front como "ORA-02291: integrity constraint
-- violated - parent key not found" y no hay nada que hacer con eso.
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

-- Usuario dueño del token, o NULL. Ademas deja el usuario en CLIENT_IDENTIFIER
-- para que quede rastro de quien hizo el DML (ver nota 11 del encabezado).
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
-- JSON.stringify(new Date()), quedandose con la parte de la fecha.
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

-- '%TEXTO%' en mayusculas, o NULL si no hay que filtrar. Se arma una sola vez
-- para no repetir el patron en cada consulta.
FUNCTION f_patron(p_buscar IN VARCHAR2) RETURN VARCHAR2 IS
BEGIN
    RETURN CASE WHEN TRIM(p_buscar) IS NULL
                THEN NULL
                ELSE '%' || UPPER(TRIM(p_buscar)) || '%'
           END;
END f_patron;

FUNCTION f_tope(p_limite IN NUMBER, p_defecto IN PLS_INTEGER, p_maximo IN PLS_INTEGER)
    RETURN PLS_INTEGER IS
    l PLS_INTEGER;
BEGIN
    l := LEAST(NVL(p_limite, p_defecto), p_maximo);
    RETURN CASE WHEN l < 1 THEN p_defecto ELSE l END;
END f_tope;

PROCEDURE exigir(p_condicion IN BOOLEAN, p_mensaje IN VARCHAR2) IS
BEGIN
    IF NOT NVL(p_condicion, FALSE) THEN
        g_mensaje := p_mensaje;
        RAISE e_validacion;
    END IF;
END exigir;

------------------------------------------------------------------------------
-- Validaciones comunes a INSERTAR y ACTUALIZAR. Lanzan e_validacion.
------------------------------------------------------------------------------
PROCEDURE validar(
    p_id_facilitador         IN NUMBER,
    p_id_institucion         IN NUMBER,
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN DATE,
    p_fecha_hasta            IN DATE,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER,
    p_aspectos_positivos     IN CLOB,
    p_aspectos_mejorar       IN CLOB,
    p_calificacion           IN VARCHAR2
) IS
    l_area_de_evaluacion evaluaciones.id_area%TYPE;
BEGIN
    ---------------------------------------------------------------- obligatorios
    exigir(p_id_facilitador IS NOT NULL, 'id_facilitador es obligatorio');
    exigir(p_id_institucion IS NOT NULL, 'id_institucion es obligatorio');
    exigir(p_id_ciudad      IS NOT NULL, 'id_ciudad es obligatorio');
    exigir(p_id_area        IS NOT NULL, 'id_area es obligatorio');
    exigir(p_id_evaluacion  IS NOT NULL, 'id_evaluacion es obligatorio');
    exigir(p_fecha_desde    IS NOT NULL, 'fecha_desde es obligatoria');
    exigir(p_fecha_hasta    IS NOT NULL, 'fecha_hasta es obligatoria');
    exigir(TRIM(p_evaluado_por) IS NOT NULL, 'evaluado_por es obligatorio');

    ---------------------------------------------------------------------- fechas
    exigir(p_fecha_hasta >= p_fecha_desde,
           'fecha_hasta no puede ser anterior a fecha_desde');

    ------------------------------------------------------------ area/evaluacion
    -- Nada en la base impide que id_area e id_evaluacion se contradigan, y una
    -- evaluacion pertenece a un area (EVALUACIONES.ID_AREA).
    BEGIN
        SELECT id_area INTO l_area_de_evaluacion
          FROM evaluaciones
         WHERE id_evaluacion = p_id_evaluacion;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            g_mensaje := 'La evaluacion indicada no existe';
            RAISE e_validacion;
    END;
    exigir(l_area_de_evaluacion = p_id_area,
           'La evaluacion no pertenece al area indicada. Carga el combo con '
           || 'GET listas/evaluaciones?id_area=' || p_id_area);

    ------------------------------------------------------------------- estrellas
    exigir(p_calificacion_estrellas IS NULL
           OR (p_calificacion_estrellas BETWEEN 1 AND 5
               AND p_calificacion_estrellas = TRUNC(p_calificacion_estrellas)),
           'calificacion_estrellas debe ser un entero de 1 a 5');

    --------------------------------------------------------------------- largos
    exigir(LENGTH(p_evaluado_por) <= 255, 'evaluado_por no puede pasar de 255 caracteres');
    exigir(p_calificacion IS NULL OR LENGTH(p_calificacion) <= 100,
           'calificacion no puede pasar de 100 caracteres');
    -- ASPECTOS_POSITIVOS y ASPECTOS_MEJORAR son CLOB: no hay tope que validar.
    -- El limite practico lo pone el bind de ORDS, no la columna (ver nota 3).

    -- La ciudad NO se valida a mano: ahora hay FK simple a CIUDADES(ID_CIUDAD)
    -- y un id inexistente sale como ORA-02291, que p_error_oracle traduce a 400.
END validar;

------------------------------------------------------------------------------
-- Escribe una fila del CRUD como objeto JSON.
-- p_nombre: NULL para un elemento dentro de un array; 'data' para OBTENER.
------------------------------------------------------------------------------
PROCEDURE escribir_fila(p_nombre IN VARCHAR2, p_r IN c_eval%ROWTYPE) IS
BEGIN
    APEX_JSON.OPEN_OBJECT(p_nombre);
    APEX_JSON.WRITE('id_evaluacion_facilitador', p_r.id_evaluacion_facilitador);
    APEX_JSON.WRITE('id_facilitador',            p_r.id_facilitador);
    APEX_JSON.WRITE('facilitador',               p_r.facilitador);
    APEX_JSON.WRITE('id_institucion',            p_r.id_institucion);
    APEX_JSON.WRITE('institucion',               p_r.institucion);
    APEX_JSON.WRITE('id_ciudad',                 p_r.id_ciudad);
    APEX_JSON.WRITE('ciudad',                    p_r.ciudad);
    APEX_JSON.WRITE('fecha_desde',   TO_CHAR(p_r.fecha_desde, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('fecha_hasta',   TO_CHAR(p_r.fecha_hasta, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('evaluado_por',              p_r.evaluado_por);
    APEX_JSON.WRITE('id_area',                   p_r.id_area);
    APEX_JSON.WRITE('area',                      p_r.area);
    APEX_JSON.WRITE('id_evaluacion',             p_r.id_evaluacion);
    APEX_JSON.WRITE('evaluacion',                p_r.evaluacion);
    APEX_JSON.WRITE('calificacion_estrellas',    p_r.calificacion_estrellas);
    APEX_JSON.WRITE('aspectos_positivos',        p_r.aspectos_positivos);
    APEX_JSON.WRITE('aspectos_mejorar',          p_r.aspectos_mejorar);
    APEX_JSON.WRITE('calificacion',              p_r.calificacion);
    -- Solo lectura: lo pone el trigger de auditoria.
    APEX_JSON.WRITE('id_auditoria',              p_r.id_auditoria);
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
    l_usuario VARCHAR2(255);
    l_desde   DATE;
    l_hasta   DATE;
    l_patron  VARCHAR2(300);
    l_limite  PLS_INTEGER;
    l_pagina  PLS_INTEGER;
    l_total   NUMBER;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    l_desde  := f_fecha(p_desde, 'desde');
    l_hasta  := f_fecha(p_hasta, 'hasta');
    l_patron := f_patron(p_buscar);
    l_limite := f_tope(p_limite, c_limite_defecto, c_limite_maximo);
    l_pagina := GREATEST(NVL(p_pagina, 1), 1);

    -- El total va aparte del cursor paginado: el front necesita saber cuantas
    -- paginas hay, no solo las 50 que le tocaron.
    SELECT COUNT(*)
      INTO l_total
      FROM evaluaciones_facilitadores e
      LEFT JOIN facilitadores f ON f.id_facilitador = e.id_facilitador
      LEFT JOIN instituciones i ON i.id_institucion = e.id_institucion
     WHERE (p_id_facilitador IS NULL OR e.id_facilitador = p_id_facilitador)
       AND (p_id_institucion IS NULL OR e.id_institucion = p_id_institucion)
       AND (p_id_evaluacion  IS NULL OR e.id_evaluacion  = p_id_evaluacion)
       AND (p_id_area        IS NULL OR e.id_area        = p_id_area)
       AND (l_desde          IS NULL OR e.fecha_desde   >= l_desde)
       AND (l_hasta          IS NULL OR e.fecha_hasta   <= l_hasta)
       AND (l_patron         IS NULL
            OR UPPER(e.evaluado_por)    LIKE l_patron
            OR UPPER(f.nombre_apellido) LIKE l_patron
            OR UPPER(i.nombre)          LIKE l_patron);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('total',   l_total);
    APEX_JSON.WRITE('pagina',  l_pagina);
    APEX_JSON.WRITE('limite',  l_limite);
    APEX_JSON.OPEN_ARRAY('data');

    FOR r IN c_eval(
        p_id             => NULL,
        p_id_facilitador => p_id_facilitador,
        p_id_institucion => p_id_institucion,
        p_id_evaluacion  => p_id_evaluacion,
        p_id_area        => p_id_area,
        p_desde          => l_desde,
        p_hasta          => l_hasta,
        p_buscar         => l_patron,
        p_offset         => (l_pagina - 1) * l_limite,
        p_limite         => l_limite
    ) LOOP
        escribir_fila(NULL, r);
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
    l_r       c_eval%ROWTYPE;
    l_hay     BOOLEAN;
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

    -- Mismo cursor que el listado, filtrado por id: los dos endpoints devuelven
    -- exactamente los mismos campos.
    OPEN c_eval(p_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 1);
    FETCH c_eval INTO l_r;
    l_hay := c_eval%FOUND;
    CLOSE c_eval;

    IF NOT l_hay THEN
        p_error(404, 'Not Found', 'Evaluacion no encontrada');
        RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    escribir_fila('data', l_r);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        IF c_eval%ISOPEN THEN
            CLOSE c_eval;
        END IF;
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END obtener;

------------------------------------------------------------------------------
-- INSERTAR
------------------------------------------------------------------------------
PROCEDURE insertar(
    p_token                  IN VARCHAR2,
    p_id_facilitador         IN NUMBER,
    p_id_institucion         IN NUMBER,
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN VARCHAR2,
    p_fecha_hasta            IN VARCHAR2,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN CLOB     DEFAULT NULL,
    p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
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

    -- ID_AUDITORIA no se lista a proposito: lo asigna el trigger.
    INSERT INTO evaluaciones_facilitadores (
        id_facilitador, id_institucion, id_ciudad,
        fecha_desde, fecha_hasta, evaluado_por, id_area, id_evaluacion,
        calificacion_estrellas, aspectos_positivos, aspectos_mejorar, calificacion
    ) VALUES (
        p_id_facilitador, p_id_institucion, p_id_ciudad,
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
    p_id_ciudad              IN NUMBER,
    p_fecha_desde            IN VARCHAR2,
    p_fecha_hasta            IN VARCHAR2,
    p_evaluado_por           IN VARCHAR2,
    p_id_area                IN NUMBER,
    p_id_evaluacion          IN NUMBER,
    p_calificacion_estrellas IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN CLOB     DEFAULT NULL,
    p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
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
    -- Para un PATCH habria que distinguir "no vino" de "vino en null", y eso no
    -- se puede con binds simples de ORDS.
    validar(
        p_id_facilitador         => p_id_facilitador,
        p_id_institucion         => p_id_institucion,
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

    -- ID_AUDITORIA fuera del SET: es de la bitacora, no del negocio.
    UPDATE evaluaciones_facilitadores
       SET id_facilitador         = p_id_facilitador,
           id_institucion         = p_id_institucion,
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

    -- El trigger deja la copia en EVALUACIONES_FACILITADORES_JN con 'DEL', asi
    -- que el borrado es fisico pero queda rastro.
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

------------------------------------------------------------------------------
-- LISTAS DE VALORES
--
-- Una por combo del formulario. Todas devuelven {success, lista, limite,
-- data:[...]} y ordenan por el texto que se muestra, no por el ID.
------------------------------------------------------------------------------

-- Dominio: ACTIVO = 'SI' / 'NO'. Por defecto solo los activos, porque un combo
-- no debe ofrecer gente dada de baja.
--
-- p_incluir_id: el id que el formulario ya tiene cargado entra SIEMPRE, aunque
-- este inactivo. Sin esto, editar una evaluacion vieja cuyo facilitador se dio
-- de baja despues muestra el combo en blanco y al guardar se pierde el dato.
PROCEDURE lov_facilitadores(
    p_patron     IN VARCHAR2,
    p_activo     IN VARCHAR2,
    p_incluir_id IN NUMBER,
    p_tope       IN PLS_INTEGER
) IS
    -- 'TODOS' desactiva el filtro; cualquier otro valor filtra por el.
    l_activo VARCHAR2(10) := CASE
                               WHEN p_activo IS NULL THEN 'SI'
                               WHEN UPPER(TRIM(p_activo)) = 'TODOS' THEN NULL
                               ELSE UPPER(TRIM(p_activo))
                             END;
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_facilitador, nombre_apellido, activo
          FROM facilitadores
         WHERE id_facilitador = p_incluir_id
            OR ((p_patron IS NULL OR UPPER(nombre_apellido) LIKE p_patron
                                  OR UPPER(nro_ci)          LIKE p_patron)
                AND (l_activo IS NULL OR UPPER(activo) = l_activo))
         ORDER BY nombre_apellido
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_facilitador',  r.id_facilitador);
        APEX_JSON.WRITE('nombre_apellido', r.nombre_apellido);
        APEX_JSON.WRITE('activo',          r.activo);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_facilitadores;

-- Dominio: ESTADO = 'A' (activa) / 'I' (inactiva). Por defecto solo las activas.
-- p_incluir_id igual que en facilitadores.
--
-- p_id_facilitador: devuelve SOLO las instituciones donde ese facilitador tiene
-- postulaciones (POSTULACIONES.ID_FACILITADOR). Es la cascada del formulario:
-- elegido el facilitador, no tiene sentido ofrecerle instituciones ajenas.
--   * Se usa EXISTS y no un JOIN porque un facilitador puede tener varias
--     postulaciones en la misma institucion (distinta materia, turno o año) y un
--     JOIN la repetiria en el combo.
--   * ID_FACILITADOR es NULLABLE en POSTULACIONES: las postulaciones sin
--     facilitador asignado simplemente no matchean, que es lo correcto.
--
-- p_anio: opcional, contra POSTULACIONES.ANIO (VARCHAR2(4)). Sin el parametro no
-- filtra por año: si filtrara por el lectivo actual por defecto, un facilitador
-- cuyas postulaciones de este año todavia no se cargaron apareceria sin ninguna
-- institucion y el formulario quedaria trabado sin explicacion.
--
-- Devuelve tambien ID_CIUDAD y el nombre de la ciudad para que el front cargue
-- la ciudad solo, sin combo aparte. INSTITUCIONES.ID_CIUDAD es NULLABLE: cuando
-- viene en null, el front tiene que dejar elegir la ciudad a mano.
PROCEDURE lov_instituciones(
    p_patron         IN VARCHAR2,
    p_estado         IN VARCHAR2,
    p_incluir_id     IN NUMBER,
    p_id_facilitador IN NUMBER,
    p_anio           IN VARCHAR2,
    p_tope           IN PLS_INTEGER
) IS
    l_estado VARCHAR2(10) := CASE
                               WHEN p_estado IS NULL THEN 'A'
                               WHEN UPPER(TRIM(p_estado)) = 'TODOS' THEN NULL
                               ELSE UPPER(TRIM(p_estado))
                             END;
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        -- Join por id_ciudad solo: CIUDADES tiene UNIQUE (ID_CIUDAD), asi que
        -- no hace falta arrastrar pais y departamento.
        SELECT i.id_institucion, i.nombre, i.estado, i.id_ciudad,
               c.nombre AS ciudad
          FROM instituciones i
          LEFT JOIN ciudades c ON c.id_ciudad = i.id_ciudad
         -- El incluir_id va PRIMERO en el OR: al editar, la institucion guardada
         -- entra aunque hoy este inactiva o el facilitador ya no postule ahi.
         WHERE i.id_institucion = p_incluir_id
            OR ((p_patron IS NULL OR UPPER(i.nombre) LIKE p_patron)
                -- NVL: hay filas con ESTADO en null y para el negocio esas
                -- cuentan como activas, no como invisibles.
                AND (l_estado IS NULL OR UPPER(NVL(i.estado, 'A')) = l_estado)
                AND (p_id_facilitador IS NULL
                     OR EXISTS (SELECT 1
                                  FROM postulaciones p
                                 WHERE p.id_institucion  = i.id_institucion
                                   AND p.id_facilitador  = p_id_facilitador
                                   AND (p_anio IS NULL OR p.anio = p_anio))))
         ORDER BY i.nombre
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_institucion', r.id_institucion);
        APEX_JSON.WRITE('nombre',         r.nombre);
        APEX_JSON.WRITE('estado',         r.estado);
        -- Para la carga automatica de la ciudad en el front.
        APEX_JSON.WRITE('id_ciudad',      r.id_ciudad);
        APEX_JSON.WRITE('ciudad',         r.ciudad);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_instituciones;

PROCEDURE lov_areas(p_patron IN VARCHAR2, p_tope IN PLS_INTEGER) IS
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_area, descripcion
          FROM areas_evaluaciones
         WHERE (p_patron IS NULL OR UPPER(descripcion) LIKE p_patron)
         ORDER BY descripcion
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_area',     r.id_area);
        APEX_JSON.WRITE('descripcion', r.descripcion);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_areas;

-- Va filtrada por area: la evaluacion pertenece a un area y guardar una
-- combinacion incoherente da 400 al insertar (ver nota 5 del encabezado).
PROCEDURE lov_evaluaciones(p_patron IN VARCHAR2, p_id_area IN NUMBER, p_tope IN PLS_INTEGER) IS
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_evaluacion, id_area, descripcion
          FROM evaluaciones
         WHERE (p_id_area IS NULL OR id_area = p_id_area)
           AND (p_patron  IS NULL OR UPPER(descripcion) LIKE p_patron)
         ORDER BY descripcion
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_evaluacion', r.id_evaluacion);
        APEX_JSON.WRITE('id_area',       r.id_area);
        APEX_JSON.WRITE('descripcion',   r.descripcion);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_evaluaciones;

-- Una sola lista plana: id_ciudad + nombre. Sin pais ni departamento, que ya no
-- se guardan en EVALUACIONES_FACILITADORES.
-- Ojo con las ciudades homonimas de departamentos distintos: en el combo se ven
-- iguales (ver nota 10 del encabezado).
PROCEDURE lov_ciudades(p_patron IN VARCHAR2, p_tope IN PLS_INTEGER) IS
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_ciudad, nombre
          FROM ciudades
         WHERE (p_patron IS NULL OR UPPER(nombre) LIKE p_patron)
         ORDER BY nombre
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_ciudad', r.id_ciudad);
        APEX_JSON.WRITE('nombre',    r.nombre);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_ciudades;

PROCEDURE lista(
    p_token          IN VARCHAR2,
    p_nombre         IN VARCHAR2,
    p_buscar         IN VARCHAR2 DEFAULT NULL,
    p_id_area        IN NUMBER   DEFAULT NULL,
    p_activo         IN VARCHAR2 DEFAULT NULL,
    p_estado         IN VARCHAR2 DEFAULT NULL,
    p_incluir_id     IN NUMBER   DEFAULT NULL,
    p_id_facilitador IN NUMBER   DEFAULT NULL,
    p_anio           IN VARCHAR2 DEFAULT NULL,
    p_limite         IN NUMBER   DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_clave   VARCHAR2(64) := LOWER(TRIM(p_nombre));
    l_patron  VARCHAR2(300);
    l_tope    PLS_INTEGER;
BEGIN
    l_usuario := f_usuario(p_token);
    IF l_usuario IS NULL THEN
        p_error(401, 'Unauthorized', 'Token invalido o expirado');
        RETURN;
    END IF;

    -- El IS NULL va aparte: "NULL NOT IN (...)" da NULL, no TRUE, y el nombre
    -- vacio se colaria hasta el CASE de abajo para morir con CASE_NOT_FOUND (500).
    IF l_clave IS NULL
       OR l_clave NOT IN ('facilitadores', 'instituciones', 'areas', 'evaluaciones', 'ciudades')
    THEN
        p_error(400, 'Bad Request',
                'Lista desconocida. Validas: facilitadores, instituciones, '
                || 'areas, evaluaciones, ciudades');
        RETURN;
    END IF;

    l_patron := f_patron(p_buscar);
    l_tope   := f_tope(p_limite, c_lov_defecto, c_lov_maximo);

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('lista',   l_clave);
    -- Si vuelven exactamente 'limite' filas puede haber mas: que el front lo
    -- sepa y pida con ?buscar= en vez de mostrar una lista incompleta.
    APEX_JSON.WRITE('limite',  l_tope);

    CASE l_clave
      WHEN 'facilitadores' THEN lov_facilitadores(l_patron, p_activo, p_incluir_id, l_tope);
      WHEN 'instituciones' THEN
        lov_instituciones(l_patron, p_estado, p_incluir_id, p_id_facilitador, p_anio, l_tope);
      WHEN 'areas'         THEN lov_areas(l_patron, l_tope);
      WHEN 'evaluaciones'  THEN lov_evaluaciones(l_patron, p_id_area, l_tope);
      WHEN 'ciudades'      THEN lov_ciudades(l_patron, l_tope);
    END CASE;

    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
END lista;

END PKG_EVAL_FACILITADORES_ETHOS;
/

--------------------------------------------------------------------------------
-- === 4) ENDPOINTS ORDS ======================================================
--
-- Se agregan al modulo 'ethos' que ya creo ethos_auth.sql.
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
  BEGIN ORDS.DELETE_HANDLER('ethos', 'listas/:nombre',                 'GET');     EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ORDS.DELETE_HANDLER('ethos', 'listas/:nombre',                 'OPTIONS'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ----------------------------------------------------------------------------
  -- evaluaciones-facilitadores  (coleccion)
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

  ----------------------------------------------------------------------------
  -- listas/:nombre  (listas de valores de los combos)
  --
  --   listas/facilitadores ?buscar=&activo=&incluir_id=&limite=
  --   listas/instituciones ?buscar=&estado=&incluir_id=&id_facilitador=&anio=
  --   listas/areas         ?buscar=&limite=
  --   listas/evaluaciones  ?id_area=&buscar=&limite=
  --   listas/ciudades      ?buscar=&limite=
  ----------------------------------------------------------------------------
  BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ethos',
        p_pattern     => 'listas/:nombre',
        p_priority    => 0,
        p_etag_type   => 'NONE');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_HANDLER(
      p_module_name => 'ethos',
      p_pattern     => 'listas/:nombre',
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
    PKG_EVAL_FACILITADORES_ETHOS.LISTA(
        p_token          => l_token,
        p_nombre         => :nombre,
        p_buscar         => :buscar,
        p_id_area        => TO_NUMBER(:id_area),
        p_activo         => :activo,
        p_estado         => :estado,
        p_incluir_id     => TO_NUMBER(:incluir_id),
        p_id_facilitador => TO_NUMBER(:id_facilitador),
        p_anio           => :anio,
        p_limite         => TO_NUMBER(:limite));
END;
~');

  ORDS.DEFINE_PARAMETER(
      p_module_name        => 'ethos',
      p_pattern            => 'listas/:nombre',
      p_method             => 'GET',
      p_name               => 'Authorization',
      p_bind_variable_name => 'authorization',
      p_source_type        => 'HEADER',
      p_param_type         => 'STRING',
      p_access_method      => 'IN');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de evaluaciones-facilitadores y listas publicados.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudieron publicar los handlers: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        Revisa que el modulo ORDS ethos exista (corre backend/ethos_auth.sql).');
    RAISE;
END;
/

-- Preflight CORS (OPTIONS), en bloque aparte y a prueba de fallos: algunas
-- versiones de ORDS rechazan OPTIONS en p_method. Solo hace falta si algun dia
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
  preflight('listas/:nombre');
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
-- === 5) VERIFICACION ========================================================
-- Imprime el estado de todo lo que este script necesita y la URL base real.
--------------------------------------------------------------------------------

DECLARE
  l_n       NUMBER;
  l_pattern VARCHAR2(200);

  PROCEDURE chequear(p_nombre IN VARCHAR2, p_tipo IN VARCHAR2) IS
    l_c NUMBER;
    l_estado VARCHAR2(20);
  BEGIN
    SELECT COUNT(*), MAX(status) INTO l_c, l_estado
      FROM user_objects
     WHERE object_name = p_nombre
       AND object_type = p_tipo;
    IF l_c = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] Falta ' || p_tipo || ' ' || p_nombre);
    ELSIF l_estado <> 'VALID' THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] ' || RPAD(p_tipo, 9) || ' ' || p_nombre
                           || ' esta ' || l_estado);
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]    ' || RPAD(p_tipo, 9) || ' ' || p_nombre);
    END IF;
  END chequear;
BEGIN
  DBMS_OUTPUT.PUT_LINE('=== 5) Verificacion ======================================');
  chequear('EVALUACIONES_FACILITADORES',        'TABLE');
  chequear('EVALUACIONES_FACILITADORES_JN',     'TABLE');
  chequear('FACILITADORES',                     'TABLE');
  chequear('INSTITUCIONES',                     'TABLE');
  chequear('AREAS_EVALUACIONES',                'TABLE');
  chequear('EVALUACIONES',                      'TABLE');
  chequear('CIUDADES',                          'TABLE');
  chequear('SEQ_AUDITORIA',                     'SEQUENCE');
  -- Si este quedo INVALID, la tabla no acepta DML (ORA-04098).
  chequear('EVALUACIONES_FACILITADORES_JNTRG',  'TRIGGER');
  chequear('PKG_AUTH_ETHOS',                    'PACKAGE');
  chequear('PKG_EVAL_FACILITADORES_ETHOS',      'PACKAGE');

  -- Forma de la tabla. Se chequea por COLUMNA, no por nombre de constraint: los
  -- nombres varian segun quien la creo y no hay que depender de eso.
  SELECT COUNT(*) INTO l_n
    FROM user_constraints
   WHERE table_name = 'EVALUACIONES_FACILITADORES' AND constraint_type = 'P';
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    La tabla tiene PRIMARY KEY.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] Sin PRIMARY KEY: obtener/editar/borrar por id no');
    DBMS_OUTPUT.PUT_LINE('        pueden funcionar. Corre la seccion 1.');
  END IF;

  SELECT COUNT(*) INTO l_n
    FROM user_tab_columns
   WHERE table_name = 'EVALUACIONES_FACILITADORES'
     AND column_name IN ('ID_PAIS', 'ID_DEPARTAMENTO');
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    ID_PAIS / ID_DEPARTAMENTO fuera de la tabla.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[WARN]  Todavia hay ' || l_n || ' columna(s) de la jerarquia vieja.');
    DBMS_OUTPUT.PUT_LINE('        El API las ignora; quedan siempre en NULL.');
  END IF;

  SELECT COUNT(*) INTO l_n
    FROM user_constraints c
    JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
   WHERE c.table_name      = 'EVALUACIONES_FACILITADORES'
     AND c.constraint_type = 'R'
     AND cc.column_name    = 'ID_CIUDAD';
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    FK sobre ID_CIUDAD -> CIUDADES activa.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[WARN]  Falta la FK sobre ID_CIUDAD (mira la seccion 1).');
  END IF;

  -- Errores de compilacion: el fallo mas comun y el mas silencioso.
  SELECT COUNT(*) INTO l_n
    FROM user_errors
   WHERE name IN ('PKG_EVAL_FACILITADORES_ETHOS', 'EVALUACIONES_FACILITADORES_JNTRG');
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[OK]    Paquete y trigger compilaron sin errores.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] Hay ' || l_n || ' error(es) de compilacion:');
    FOR e IN (SELECT name, line, position, text
                FROM user_errors
               WHERE name IN ('PKG_EVAL_FACILITADORES_ETHOS',
                              'EVALUACIONES_FACILITADORES_JNTRG')
               ORDER BY name, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        ' || e.name || ' linea ' || e.line || ','
                           || e.position || ': ' || e.text);
    END LOOP;
  END IF;

  -- Dinamico: si esta version de ORDS no expone estas vistas, un SELECT estatico
  -- rompe la COMPILACION del bloque entero y no se veria ni el chequeo anterior.
  BEGIN
    EXECUTE IMMEDIATE q'~
      SELECT COUNT(*)
        FROM user_ords_handlers h
        JOIN user_ords_templates t ON t.id = h.template_id
       WHERE t.uri_template LIKE 'evaluaciones-facilitadores%'
          OR t.uri_template LIKE 'listas/%'~'
    INTO l_n;
    DBMS_OUTPUT.PUT_LINE('[INFO]  Handlers publicados: ' || l_n
                         || ' (se esperan 6 sin OPTIONS, 9 con)');
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
    DBMS_OUTPUT.PUT_LINE('        GET    listas/facilitadores | instituciones | areas |');
    DBMS_OUTPUT.PUT_LINE('               evaluaciones?id_area=N | ciudades?buscar=asu');
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] El esquema no esta REST-enabled. Corre backend/ethos_auth.sql.');
  END;
END;
/

--------------------------------------------------------------------------------
-- === 6) PRUEBA RAPIDA CON curl ==============================================
--
--   BASE=https://oracleapex.com/ords/fundcarac/ethos
--   TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
--     -d '{"usuario":"joseg","password":"xxx"}' \
--     | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
--   AUTH="Authorization: Bearer $TOKEN"
--
--   # listas de valores (por defecto solo vigentes: ACTIVO='SI', ESTADO='A')
--   curl -s "$BASE/listas/facilitadores?buscar=jose"  -H "$AUTH"
--   curl -s "$BASE/listas/facilitadores?activo=TODOS" -H "$AUTH"
--   curl -s "$BASE/listas/facilitadores?incluir_id=7" -H "$AUTH"   # al editar
--   curl -s "$BASE/listas/instituciones"              -H "$AUTH"
--   curl -s "$BASE/listas/areas"                      -H "$AUTH"
--   curl -s "$BASE/listas/evaluaciones?id_area=1"     -H "$AUTH"
--   curl -s "$BASE/listas/ciudades?buscar=asu"        -H "$AUTH"
--
--   # CRUD
--   curl -s "$BASE/evaluaciones-facilitadores?limite=5" -H "$AUTH"
--
--   curl -s -X POST "$BASE/evaluaciones-facilitadores" -H "$AUTH" \
--     -H "Content-Type: application/json" \
--     -d '{"id_facilitador":1,"id_institucion":1,"id_ciudad":1,
--          "fecha_desde":"2026-07-01","fecha_hasta":"2026-07-15",
--          "evaluado_por":"Jose Galvez","id_area":1,"id_evaluacion":1,
--          "calificacion_estrellas":4,"aspectos_positivos":"Puntual y claro",
--          "aspectos_mejorar":"Cerrar con resumen","calificacion":"Muy bueno"}'
--
--   curl -s -X PUT    "$BASE/evaluaciones-facilitadores/1" -H "$AUTH" \
--        -H "Content-Type: application/json" -d '{...registro completo...}'
--   curl -s -X DELETE "$BASE/evaluaciones-facilitadores/1" -H "$AUTH"
--
-- Si curl funciona y el front no, el problema esta en el proxy o en la URL
-- configurada, no en la base.
--------------------------------------------------------------------------------
