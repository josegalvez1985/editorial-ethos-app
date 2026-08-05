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
--     GET    listas/postulaciones   ?id_facilitador=&id_institucion=&anio=&dia=&limite=
--            Por defecto SOLO las del dia de HOY (lunes..viernes). ?dia=TODOS
--            las trae todas; ?dia=3 fuerza el miercoles.
--     GET    listas/manuales        ?buscar=&limite=
--     GET    listas/indices         ?manual=&buscar=&limite=
--     GET    listas/directores      ?id_institucion=&estado=&limite=
--            La direccion de UNA institucion (id_institucion OBLIGATORIO).
--            Por defecto solo ESTADO='A'; ?estado=TODOS trae el historico.
--            Es informativa: NO se guarda nada de esto en la evaluacion.
--     GET    listas/indice-siguiente ?id_postulacion=   (OBLIGATORIO)
--            El indice que le toca desarrollar a esa postulacion: el posterior
--            al ultimo con SI_NO='Si' en INTERVENCIONES, dentro del mismo
--            manual. Devuelve UN objeto con `estado` = PENDIENTE / SIN_INICIAR
--            / FINALIZADO. Es el unico endpoint de listas/ que no da un array.
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
--      textos  ASPECTOS_POSITIVOS, ASPECTOS_MEJORAR y OBSERVACION_ADMIN son CLOB.
--              Los dos primeros son del evaluador; OBSERVACION_ADMIN es la nota
--              de quien revisa despues. Los tres son opcionales.
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
--    c) Filtro de año contra POSTULACIONES.ANIO. **Por defecto usa el AÑO
--       LECTIVO ACTIVO** (FN_ANIO_LECTIVO_ACTUAL, que lee ANIOS_LECTIVOS con
--       ESTADO='A'); ?anio=TODOS lo apaga y ?anio=2025 fuerza uno.
--
--       Antes el default era NO filtrar, por miedo a que un facilitador sin
--       postulaciones cargadas quedara sin instituciones. Se invirtio a pedido
--       el 04/08/2026: una evaluacion es siempre del año en curso. El miedo se
--       cubre por otro lado — si no hay año activo cargado, la funcion devuelve
--       NULL y el filtro se apaga solo.
--
--       El mismo filtro aplica a listas/facilitadores: ademas de ACTIVO='SI',
--       tiene que tener una postulacion en el año vigente.
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
--     ESCALA    NUMBER,
--     ASPECTOS_POSITIVOS        CLOB,
--     ASPECTOS_MEJORAR          CLOB,
--     OBSERVACION_ADMIN         CLOB,
--     IND_CERRADO               VARCHAR2(1),   -- 'S' / 'N', NULL = abierta
--     ID_POSTULACION            NUMBER,        -- FK a POSTULACIONES
--     ID_AUDITORIA              NUMBER,
--     CHECK (escala BETWEEN 1 AND 5) ENABLE,
--     CONSTRAINT EVAL_FAC_PK PRIMARY KEY (ID_EVALUACION_FACILITADOR)
--   );
--   + las 6 FKs (facilitador, institucion, ciudad, area, evaluacion, escala)
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

  -- 1.2 Las 6 FKs. Si ya las creaste con tus nombres, se saltean.
  fk('EVAL_FAC_FK_FACILITADOR', 'ID_FACILITADOR', 'facilitadores',      'id_facilitador');
  fk('EVAL_FAC_FK_INSTITUCION', 'ID_INSTITUCION', 'instituciones',      'id_institucion');
  fk('EVAL_FAC_FK_CIUDAD',      'ID_CIUDAD',      'ciudades',           'id_ciudad');
  fk('EVAL_FAC_FK_AREA',        'ID_AREA',        'areas_evaluaciones', 'id_area');
  fk('EVAL_FAC_FK_EVALUACION',  'ID_EVALUACION',  'evaluaciones',       'id_evaluacion');
  -- ESCALA apunta a ESCALAS_EVALUACIONES.ESCALA, que es UNIQUE (no la PK, que es
  -- ID_ESCALA). Un valor que no este en esa tabla sale como ORA-02291.
  fk('EVAL_FAC_FK_ESCALA',      'ESCALA',         'escalas_evaluaciones', 'escala');

  -- 1.3 El CHECK del rango de ESCALA.
  --
  -- OJO: el CHECK dice 1..5 pero ESCALAS_EVALUACIONES tiene ESCALA de 1 a 12. Con
  -- este rango, las filas 6..12 de esa tabla son inalcanzables: solo se pueden
  -- guardar escalas 1..5, que segun los datos cargados son 'Deficiente' (1-3) y
  -- 'Aceptable' (4-5). 'Bueno' y 'Excelente' NO se pueden guardar.
  -- Esta anotado en README.md; hay que decidir si se amplia el CHECK a 1..12 o si
  -- se recargan los datos de ESCALAS_EVALUACIONES con 5 niveles.
  SELECT COUNT(*) INTO l_c
    FROM user_constraints
   WHERE table_name = 'EVALUACIONES_FACILITADORES'
     AND constraint_type = 'C'
     AND UPPER(search_condition_vc) LIKE '%ESCALA%';
  IF l_c = 0 THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD CONSTRAINT EVAL_FAC_CK_ESCALA '
             || 'CHECK (escala BETWEEN 1 AND 5)',
             'CHECK de ESCALA (1..5) creado.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  El CHECK de ESCALA ya existia.');
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

  -- 1.5 OBSERVACION_ADMIN, en las DOS tablas.
  --
  -- Es la nota de quien revisa la evaluacion despues de cargada, aparte de los
  -- dos campos de aspectos (que son del evaluador). CLOB por consistencia con
  -- esos dos: una observacion puede ser larga y no hay razon para cortarla.
  --
  -- Va acá y no como DDL suelto porque este script tiene que poder correr contra
  -- una base donde la columna ya existe (la de produccion la tiene) y contra una
  -- recien creada. El IF la hace idempotente en los dos casos.
  --
  -- OJO CON EL ORDEN: primero la _JN. El trigger de la seccion 2 la escribe, y
  -- si la tabla de journal no la tiene, no compila.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES_JN', 'OBSERVACION_ADMIN') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores_jn ADD (observacion_admin CLOB)',
             'Columna OBSERVACION_ADMIN agregada a la tabla _JN.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La _JN ya tenia OBSERVACION_ADMIN.');
  END IF;

  IF NOT hay_columna('EVALUACIONES_FACILITADORES', 'OBSERVACION_ADMIN') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD (observacion_admin CLOB)',
             'Columna OBSERVACION_ADMIN agregada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  OBSERVACION_ADMIN ya existia.');
  END IF;

  -- 1.6 IND_CERRADO: 'S' cerrada / 'N' abierta.
  --
  -- Una evaluacion cerrada NO se edita ni se borra: INSERTAR la deja abierta,
  -- ACTUALIZAR y ELIMINAR responden 409 si ya lo esta. Se reabre con el mismo
  -- PUT mandando ind_cerrado='N'.
  --
  -- SIN DEFAULT y NULLABLE a proposito: las filas ya cargadas quedan en NULL y
  -- ponerles un DEFAULT no las tocaria igual. Todo el codigo lee
  -- NVL(ind_cerrado,'N'), asi que NULL == abierta y no hay que backfillear nada.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES_JN', 'IND_CERRADO') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores_jn ADD (ind_cerrado VARCHAR2(1))',
             'Columna IND_CERRADO agregada a la tabla _JN.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La _JN ya tenia IND_CERRADO.');
  END IF;

  IF NOT hay_columna('EVALUACIONES_FACILITADORES', 'IND_CERRADO') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD (ind_cerrado VARCHAR2(1))',
             'Columna IND_CERRADO agregada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  IND_CERRADO ya existia.');
  END IF;

  -- El CHECK del dominio. Acepta NULL (= abierta, ver arriba).
  SELECT COUNT(*) INTO l_c
    FROM user_constraints
   WHERE table_name = 'EVALUACIONES_FACILITADORES'
     AND constraint_type = 'C'
     AND UPPER(search_condition_vc) LIKE '%IND_CERRADO%';
  IF l_c = 0 THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD CONSTRAINT EVAL_FAC_CK_CERRADO '
             || 'CHECK (ind_cerrado IS NULL OR ind_cerrado IN (''S'',''N''))',
             'CHECK de IND_CERRADO (S/N) creado.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  El CHECK de IND_CERRADO ya existia.');
  END IF;

  -- 1.7 ID_POSTULACION: que postulacion origino la evaluacion.
  --
  -- POSTULACIONES es la tabla que une facilitador + institucion + año, asi que
  -- guardar su id ata la evaluacion a un hecho concreto en vez de a tres campos
  -- sueltos que podrian no corresponderse entre si.
  --
  -- NULLABLE: el paquete la resuelve sola al guardar, y cuando no puede
  -- —no hay postulacion, o hay varias en la misma institucion— deja NULL en vez
  -- de inventar una. Las filas viejas tampoco la tienen.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES_JN', 'ID_POSTULACION') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores_jn ADD (id_postulacion NUMBER)',
             'Columna ID_POSTULACION agregada a la tabla _JN.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La _JN ya tenia ID_POSTULACION.');
  END IF;

  IF NOT hay_columna('EVALUACIONES_FACILITADORES', 'ID_POSTULACION') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD (id_postulacion NUMBER)',
             'Columna ID_POSTULACION agregada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  ID_POSTULACION ya existia.');
  END IF;

  fk('EVAL_FAC_FK_POSTULACION', 'ID_POSTULACION', 'postulaciones', 'id_postulacion');

  -- 1.8 ID_INDICE: que contenido del manual se dio en la clase evaluada.
  --
  -- FK a INDICES_MANUALES, que es un catalogo de (MANUAL, NRO_INDICE, TITULO).
  -- Esa tabla NO tiene relacion con POSTULACIONES: el indice no se deduce de la
  -- clase, lo ELIGE el evaluador. Por eso vive aca y no alla.
  --
  -- NULLABLE: las filas ya cargadas no lo tienen y el campo es opcional en el
  -- formulario — una evaluacion sin indice indicado sigue siendo valida.
  --
  -- MISMO ORDEN QUE ARRIBA: primero la _JN, que el trigger de la seccion 2
  -- escribe y no compila si le falta la columna.
  IF NOT hay_columna('EVALUACIONES_FACILITADORES_JN', 'ID_INDICE') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores_jn ADD (id_indice NUMBER)',
             'Columna ID_INDICE agregada a la tabla _JN.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  La _JN ya tenia ID_INDICE.');
  END IF;

  IF NOT hay_columna('EVALUACIONES_FACILITADORES', 'ID_INDICE') THEN
    ejecutar('ALTER TABLE evaluaciones_facilitadores ADD (id_indice NUMBER)',
             'Columna ID_INDICE agregada.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[SKIP]  ID_INDICE ya existia.');
  END IF;

  fk('EVAL_FAC_FK_INDICE', 'ID_INDICE', 'indices_manuales', 'id_indice');
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
      ESCALA,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      OBSERVACION_ADMIN,
      IND_CERRADO,
      ID_POSTULACION,
      ID_INDICE,
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
      :NEW.ESCALA,
      :NEW.ASPECTOS_POSITIVOS,
      :NEW.ASPECTOS_MEJORAR,
      :NEW.OBSERVACION_ADMIN,
      :NEW.IND_CERRADO,
      :NEW.ID_POSTULACION,
      :NEW.ID_INDICE,
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
      ESCALA,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      OBSERVACION_ADMIN,
      IND_CERRADO,
      ID_POSTULACION,
      ID_INDICE,
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
      :NEW.ESCALA,
      :NEW.ASPECTOS_POSITIVOS,
      :NEW.ASPECTOS_MEJORAR,
      :NEW.OBSERVACION_ADMIN,
      :NEW.IND_CERRADO,
      :NEW.ID_POSTULACION,
      :NEW.ID_INDICE,
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
      ESCALA,
      ASPECTOS_POSITIVOS,
      ASPECTOS_MEJORAR,
      OBSERVACION_ADMIN,
      IND_CERRADO,
      ID_POSTULACION,
      ID_INDICE,
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
      :OLD.ESCALA,
      :OLD.ASPECTOS_POSITIVOS,
      :OLD.ASPECTOS_MEJORAR,
      :OLD.OBSERVACION_ADMIN,
      :OLD.IND_CERRADO,
      :OLD.ID_POSTULACION,
      :OLD.ID_INDICE,
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
      p_escala IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN CLOB     DEFAULT NULL,
      p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
      -- SIN p_ind_cerrado: una evaluacion nace ABIERTA y no hay forma de pedir
      -- lo contrario. Se cierra despues, con ACTUALIZAR.
      p_observacion_admin      IN CLOB     DEFAULT NULL,
      -- La postulacion que se esta evaluando, elegida en el front
      -- (GET listas/postulaciones). OPCIONAL: si no viene, se resuelve sola con
      -- f_postulacion(), que da NULL cuando hay mas de una candidata.
      p_id_postulacion         IN NUMBER   DEFAULT NULL,
      -- El indice del manual dado en la clase. Lo elige el evaluador
      -- (GET listas/indices). Opcional.
      p_id_indice              IN NUMBER   DEFAULT NULL);

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
      p_escala IN NUMBER   DEFAULT NULL,
      p_aspectos_positivos     IN CLOB     DEFAULT NULL,
      p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
      p_observacion_admin      IN CLOB     DEFAULT NULL,
      p_ind_cerrado            IN VARCHAR2 DEFAULT NULL,
      -- Igual que en INSERTAR. Ver el UPDATE: al no venir se recalcula, que es
      -- lo que corresponde si cambiaron el facilitador o la institucion.
      p_id_postulacion         IN NUMBER   DEFAULT NULL,
      p_id_indice              IN NUMBER   DEFAULT NULL);

  PROCEDURE eliminar(
      p_token IN VARCHAR2,
      p_id    IN NUMBER);

  ----------------------------------------------------------------------------
  -- LISTAS DE VALORES
  ----------------------------------------------------------------------------

  -- Un solo punto de entrada. p_nombre: facilitadores | instituciones | areas |
  -- evaluaciones | ciudades | postulaciones | directores. Cada lista usa los
  -- parametros que le sirven e ignora el resto.
  PROCEDURE lista(
      p_token      IN VARCHAR2,
      p_nombre     IN VARCHAR2,
      p_buscar     IN VARCHAR2 DEFAULT NULL,
      p_id_area    IN NUMBER   DEFAULT NULL,
      p_activo     IN VARCHAR2 DEFAULT NULL,
      -- `directores`: 'A' (por defecto) / 'TODOS' / el valor crudo.
      p_estado     IN VARCHAR2 DEFAULT NULL,
      p_incluir_id IN NUMBER   DEFAULT NULL,
      -- `instituciones`: las del facilitador, via POSTULACIONES.
      -- `postulaciones`: junto con p_id_institucion, las que se muestran.
      p_id_facilitador IN NUMBER   DEFAULT NULL,
      -- `postulaciones` y `directores`: la institucion. Obligatoria en las dos.
      p_id_institucion IN NUMBER   DEFAULT NULL,
      -- Solo `indice-siguiente`: la postulacion sobre la que se calcula el
      -- avance del manual. Obligatoria.
      p_id_postulacion IN NUMBER   DEFAULT NULL,
      -- Solo `postulaciones`: dia de la semana (1=lunes..5=viernes). Sin el
      -- parametro usa HOY; 'TODOS' lo apaga.
      p_dia            IN VARCHAR2 DEFAULT NULL,
      -- Solo `indices`: filtra por manual (la cascada Manual -> Indice).
      p_manual         IN VARCHAR2 DEFAULT NULL,
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
           e.escala,
           e.aspectos_positivos,
           e.aspectos_mejorar,
           e.observacion_admin,
           -- NVL: las filas cargadas antes de que existiera la columna tienen
           -- NULL, y para el negocio eso es "abierta".
           NVL(e.ind_cerrado, 'N')  AS ind_cerrado,
           e.id_postulacion,
           -- El indice del manual, resuelto: al editar, el formulario tiene que
           -- poder mostrar "Manual X - 3. Titulo" sin volver a pedir el catalogo.
           e.id_indice,
           im.manual                AS manual,
           im.nro_indice            AS nro_indice,
           im.titulo                AS indice_titulo,
           e.id_auditoria
      FROM evaluaciones_facilitadores e
      LEFT JOIN facilitadores      f  ON f.id_facilitador  = e.id_facilitador
      LEFT JOIN instituciones      i  ON i.id_institucion  = e.id_institucion
      LEFT JOIN indices_manuales   im ON im.id_indice      = e.id_indice
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
                'Un valor viola una restriccion de la tabla (revisa escala: 1 a 5)');
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

-- DECLARACION ADELANTADA. `anio_a_filtrar` vive abajo, con las listas de
-- valores —que es donde se usa el resto de las veces— pero `f_postulacion`, que
-- viene a continuacion, tambien la necesita. Sin esta linea el body no compila:
-- PL/SQL resuelve los subprogramas en orden de aparicion (PLS-00313).
--
-- La alternativa era mover la funcion entera aca arriba, pero queda mejor cerca
-- de los combos, que son su motivo de existir.
FUNCTION anio_a_filtrar(p_anio IN VARCHAR2) RETURN VARCHAR2;

------------------------------------------------------------------------------
-- La postulacion que corresponde a esta evaluacion, o NULL.
--
-- POSTULACIONES es lo que une facilitador + institucion + año, asi que guardar
-- su id ata la evaluacion a un hecho concreto en vez de a tres campos sueltos.
-- El front NO la manda: se resuelve aca y se guarda sola.
--
-- DEVUELVE NULL EN VEZ DE ADIVINAR cuando:
--
--   * No hay ninguna. El facilitador puede estar evaluado en una institucion
--     donde este año no postulo (una suplencia, una carga vieja). La evaluacion
--     se guarda igual — esto es trazabilidad, no una regla de integridad.
--   * Hay VARIAS. Un facilitador puede tener dos postulaciones en la misma
--     institucion por materia, turno o seccion distinta. Elegir una al azar
--     seria peor que no elegir: quedaria un dato que parece cierto y no lo es.
--
-- Si mas adelante se quiere resolver la ambiguedad, el camino es un combo en el
-- front (GET listas/postulaciones) y que el id venga en el JSON, no adivinar.
------------------------------------------------------------------------------
FUNCTION f_postulacion(
    p_id_facilitador IN NUMBER,
    p_id_institucion IN NUMBER
) RETURN NUMBER IS
    l_id   NUMBER;
    l_anio VARCHAR2(4) := anio_a_filtrar(NULL);  -- el año lectivo activo
BEGIN
    IF p_id_facilitador IS NULL OR p_id_institucion IS NULL THEN
        RETURN NULL;
    END IF;

    -- Sin año activo cargado no se filtra por año: con varios años de
    -- postulaciones eso da casi siempre "varias", y ahi cae en NULL igual.
    SELECT id_postulacion
      INTO l_id
      FROM postulaciones
     WHERE id_facilitador = p_id_facilitador
       AND id_institucion = p_id_institucion
       AND (l_anio IS NULL OR anio = l_anio);

    RETURN l_id;
EXCEPTION
    -- Las dos ramas son deliberadas y significan lo mismo: no se puede afirmar
    -- cual es. TOO_MANY_ROWS NO es un error a reportar — es el caso normal de un
    -- facilitador con dos materias en el mismo colegio.
    WHEN NO_DATA_FOUND  THEN RETURN NULL;
    WHEN TOO_MANY_ROWS  THEN RETURN NULL;
END f_postulacion;

------------------------------------------------------------------------------
-- La postulacion DEFINITIVA de una evaluacion: la que eligio el usuario si vino,
-- la deducida si no.
--
-- Desde el 05/08/2026 el front puede mandar `id_postulacion` (lo elige de las
-- tarjetas que muestra GET listas/postulaciones). Eso RESUELVE la ambiguedad que
-- f_postulacion() no puede: cuando hay varias en la misma institucion, decide
-- una persona en vez de quedar en NULL.
--
-- f_postulacion() NO se borra y sigue siendo el camino por defecto: las filas ya
-- cargadas, un POST hecho a mano y cualquier cliente viejo no mandan el campo.
--
-- SE VALIDA QUE CORRESPONDA. El id llega del cliente, asi que podria apuntar a
-- la postulacion de otro facilitador o de otra institucion — por error o a
-- proposito. Si no pertenece al par que se esta guardando, se IGNORA y se cae a
-- la deduccion. No es un 400: el dato es accesorio (trazabilidad, no integridad)
-- y rechazar la evaluacion entera por eso seria desproporcionado.
------------------------------------------------------------------------------
FUNCTION f_postulacion_final(
    p_id_postulacion IN NUMBER,
    p_id_facilitador IN NUMBER,
    p_id_institucion IN NUMBER
) RETURN NUMBER IS
    l_existe PLS_INTEGER;
BEGIN
    IF p_id_postulacion IS NULL THEN
        RETURN f_postulacion(p_id_facilitador, p_id_institucion);
    END IF;

    SELECT COUNT(*)
      INTO l_existe
      FROM postulaciones
     WHERE id_postulacion = p_id_postulacion
       AND id_facilitador = p_id_facilitador
       AND id_institucion = p_id_institucion;

    -- El que mando el front, solo si de verdad es de este facilitador en esta
    -- institucion. Si no, la deduccion de siempre.
    RETURN CASE WHEN l_existe > 0 THEN p_id_postulacion
                ELSE f_postulacion(p_id_facilitador, p_id_institucion)
           END;
END f_postulacion_final;

------------------------------------------------------------------------------
-- Si la evaluacion esta cerrada. NULL cuenta como ABIERTA: las filas cargadas
-- antes de que existiera la columna no tienen valor y no pueden quedar trabadas.
------------------------------------------------------------------------------
FUNCTION f_cerrada(p_id IN NUMBER) RETURN BOOLEAN IS
    l_ind evaluaciones_facilitadores.ind_cerrado%TYPE;
BEGIN
    SELECT NVL(ind_cerrado, 'N')
      INTO l_ind
      FROM evaluaciones_facilitadores
     WHERE id_evaluacion_facilitador = p_id;
    RETURN UPPER(l_ind) = 'S';
EXCEPTION
    -- No existe: que el 404 lo tire quien corresponda, no esta funcion.
    WHEN NO_DATA_FOUND THEN RETURN FALSE;
END f_cerrada;

------------------------------------------------------------------------------
-- Normaliza el indicador a 'S' / 'N'. Cualquier cosa que no sea 'S' es 'N':
-- el CHECK de la tabla solo acepta esos dos valores y un ORA-02290 por un
-- 'si' minuscula o un 'X' seria un error feo de diagnosticar desde el front.
------------------------------------------------------------------------------
FUNCTION f_sn(p_valor IN VARCHAR2) RETURN VARCHAR2 IS
BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_valor)) = 'S' THEN 'S' ELSE 'N' END;
END f_sn;

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
    p_escala IN NUMBER,
    p_aspectos_positivos     IN CLOB,
    p_aspectos_mejorar       IN CLOB
) IS
    l_area_de_evaluacion evaluaciones.id_area%TYPE;
BEGIN
    ---------------------------------------------------------------- obligatorios
    -- ID_AREA e ID_EVALUACION NO estan aca: son NULLABLE en la tabla desde el
    -- 04/08/2026 y opcionales aca. Ver "cabecera sin detalle" mas abajo.
    exigir(p_id_facilitador IS NOT NULL, 'id_facilitador es obligatorio');
    exigir(p_id_institucion IS NOT NULL, 'id_institucion es obligatorio');
    exigir(p_id_ciudad      IS NOT NULL, 'id_ciudad es obligatorio');
    exigir(p_fecha_desde    IS NOT NULL, 'fecha_desde es obligatoria');
    exigir(p_fecha_hasta    IS NOT NULL, 'fecha_hasta es obligatoria');
    exigir(TRIM(p_evaluado_por) IS NOT NULL, 'evaluado_por es obligatorio');

    ---------------------------------------------------------------------- fechas
    exigir(p_fecha_hasta >= p_fecha_desde,
           'fecha_hasta no puede ser anterior a fecha_desde');

    ------------------------------------------------------- cabecera sin detalle
    -- Una fila con las dos columnas en NULL es una CABECERA SOLA: la evaluacion
    -- se cargo con facilitador, institucion y periodo, pero todavia sin items.
    -- Se completa despues agregando areas, que reemplazan esta fila por una por
    -- detalle.
    --
    -- LOS DOS O NINGUNO. Un area sin evaluacion, o al reves, no es ninguna de
    -- las dos cosas: ni cabecera limpia ni detalle completo, y ensucia el
    -- agrupado sin significar nada.
    exigir((p_id_area IS NULL) = (p_id_evaluacion IS NULL),
           'id_area e id_evaluacion van juntos: los dos o ninguno');

    ------------------------------------------------------------ area/evaluacion
    -- Solo si vinieron. Nada en la base impide que se contradigan, y una
    -- evaluacion pertenece a un area (EVALUACIONES.ID_AREA).
    IF p_id_evaluacion IS NOT NULL THEN
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
    END IF;

    ---------------------------------------------------------------------- escala
    -- ESCALA reemplazo a CALIFICACION_ESTRELLAS: mismo rango 1..5 en el CHECK,
    -- pero ahora con FK a ESCALAS_EVALUACIONES.ESCALA.
    --
    -- OJO con lo que manda el front hoy: cada fila es un DETALLE (un area + una
    -- evaluacion) y la estrella es una sola, marcada o no. Manda 1 cuando esta
    -- marcada y NO manda el campo cuando no lo esta (NULL). El 0 no se usa
    -- porque el CHECK de la tabla lo rechaza. La calificacion del conjunto sale
    -- de CONTAR las filas con 1 y buscar ese numero en ESCALAS_EVALUACIONES.
    -- Nada de eso lo valida la base: es convencion del cliente.
    --
    -- El rango del CHECK (1..5) no alcanza para los 12 niveles de
    -- ESCALAS_EVALUACIONES. Ver la nota de la seccion 1.3 y README.md.
    exigir(p_escala IS NULL
           OR (p_escala BETWEEN 1 AND 5
               AND p_escala = TRUNC(p_escala)),
           'escala debe ser un entero de 1 a 5');

    -- Una cabecera sola no puede traer estrella: la escala califica UN item, y
    -- ahi no hay item. Sin esto, esa fila entraria al conteo de marcadas y le
    -- inventaria una calificacion a una evaluacion vacia.
    exigir(p_id_evaluacion IS NOT NULL OR p_escala IS NULL,
           'No se puede marcar la escala sin un item: falta id_area/id_evaluacion');

    --------------------------------------------------------------------- largos
    exigir(LENGTH(p_evaluado_por) <= 255, 'evaluado_por no puede pasar de 255 caracteres');
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
    APEX_JSON.WRITE('escala',    p_r.escala);
    APEX_JSON.WRITE('aspectos_positivos',        p_r.aspectos_positivos);
    APEX_JSON.WRITE('aspectos_mejorar',          p_r.aspectos_mejorar);
    -- Nota de quien revisa, aparte de los dos campos del evaluador.
    APEX_JSON.WRITE('observacion_admin',         p_r.observacion_admin);
    -- 'S' / 'N'. Ya viene con NVL desde el SELECT: nunca sale null.
    APEX_JSON.WRITE('ind_cerrado',               p_r.ind_cerrado);
    -- La postulacion elegida en las tarjetas (o la deducida, si no eligieron).
    APEX_JSON.WRITE('id_postulacion',            p_r.id_postulacion);
    -- El indice del manual que se dio en la clase. Los tres campos de al lado
    -- son del catalogo, solo para mostrar: el que se guarda es el id.
    APEX_JSON.WRITE('id_indice',                 p_r.id_indice);
    APEX_JSON.WRITE('manual',                    p_r.manual);
    APEX_JSON.WRITE('nro_indice',                p_r.nro_indice);
    APEX_JSON.WRITE('indice_titulo',             p_r.indice_titulo);
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
    p_escala IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN CLOB     DEFAULT NULL,
    p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
    -- SIN p_ind_cerrado: ver el INSERT de mas abajo. Nace abierta y punto.
    p_observacion_admin      IN CLOB     DEFAULT NULL,
    p_id_postulacion         IN NUMBER   DEFAULT NULL,
    p_id_indice              IN NUMBER   DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_desde   DATE;
    l_hasta   DATE;
    l_id      evaluaciones_facilitadores.id_evaluacion_facilitador%TYPE;
    -- Se resuelve ANTES del INSERT, no adentro: una funcion privada del package
    -- body NO se puede llamar desde una sentencia SQL (PLS-00231). Solo las
    -- declaradas en la SPEC son visibles para el motor SQL, y f_postulacion es
    -- interna a proposito.
    l_postulacion NUMBER;
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
        p_escala => p_escala,
        p_aspectos_positivos     => p_aspectos_positivos,
        p_aspectos_mejorar       => p_aspectos_mejorar);

    -- Fuera del INSERT: ver la declaracion de l_postulacion (PLS-00231).
    -- La que eligio el usuario, o la deducida si no mando ninguna.
    l_postulacion := f_postulacion_final(p_id_postulacion, p_id_facilitador, p_id_institucion);

    -- ID_AUDITORIA no se lista a proposito: lo asigna el trigger.
    --
    -- ID_POSTULACION tampoco lo manda el front: lo resolvio f_postulacion() en
    -- la linea de arriba, y vale NULL si no habia una sola candidata clara.
    INSERT INTO evaluaciones_facilitadores (
        id_facilitador, id_institucion, id_ciudad,
        fecha_desde, fecha_hasta, evaluado_por, id_area, id_evaluacion,
        escala, aspectos_positivos, aspectos_mejorar, observacion_admin,
        ind_cerrado, id_postulacion, id_indice
    ) VALUES (
        p_id_facilitador, p_id_institucion, p_id_ciudad,
        l_desde, l_hasta, TRIM(p_evaluado_por), p_id_area, p_id_evaluacion,
        p_escala, p_aspectos_positivos, p_aspectos_mejorar, p_observacion_admin,
        -- SIEMPRE 'N': una evaluacion NACE ABIERTA.
        --
        -- No hay parametro para pedir lo contrario, y es deliberado: cerrar algo
        -- que todavia no existe no significa nada, y aceptarlo dejaria una fila
        -- bloqueada de entrada que habria que reabrir para poder completar. Se
        -- cierra despues, con un PUT.
        --
        -- El front tampoco ofrece el check en el alta, pero eso es la UI. El que
        -- manda es este literal: un POST a mano con "ind_cerrado":"S" en el JSON
        -- tiene que dar exactamente el mismo resultado.
        -- El indice va tal cual: es una FK a un catalogo, asi que si el id no
        -- existe la propia constraint lo rechaza. No hay nada que deducir.
        'N', l_postulacion, p_id_indice
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
    p_escala IN NUMBER   DEFAULT NULL,
    p_aspectos_positivos     IN CLOB     DEFAULT NULL,
    p_aspectos_mejorar       IN CLOB     DEFAULT NULL,
    p_observacion_admin      IN CLOB     DEFAULT NULL,
    p_ind_cerrado            IN VARCHAR2 DEFAULT NULL,
    p_id_postulacion         IN NUMBER   DEFAULT NULL,
    p_id_indice              IN NUMBER   DEFAULT NULL
) IS
    l_usuario VARCHAR2(255);
    l_desde   DATE;
    l_hasta   DATE;
    -- Las dos se resuelven ANTES del UPDATE: una funcion privada del package
    -- body no se puede llamar desde SQL (PLS-00231). Ver insertar().
    l_cerrado     VARCHAR2(1);
    l_postulacion NUMBER;
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

    l_cerrado := f_sn(p_ind_cerrado);

    -- EL CANDADO. Una evaluacion cerrada no se edita.
    --
    -- La UNICA operacion que se le acepta es REABRIRLA (ind_cerrado='N'). Sin
    -- esa salida, cerrar seria irreversible desde la app y habria que entrar a
    -- APEX para corregir un clic.
    --
    -- OJO CON LA CONDICION: se rechaza cuando la fila esta cerrada Y el PUT la
    -- deja cerrada. Escrita al reves —rechazar solo si viene 'S'— un PUT con
    -- ind_cerrado='S' y los demas campos cambiados pasaria por el candado y
    -- editaria una evaluacion cerrada, que es justo lo que hay que impedir.
    --
    -- Reabrir y editar en la misma llamada SI funciona (llega 'N', el candado no
    -- salta) y esta bien: el front manda el registro completo, asi que reabrir es
    -- un PUT con el resto de los campos como estaban.
    IF f_cerrada(p_id) AND l_cerrado = 'S' THEN
        p_error(409, 'Conflict',
                'La evaluacion esta cerrada. Reabrila para poder editarla.');
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
        p_escala => p_escala,
        p_aspectos_positivos     => p_aspectos_positivos,
        p_aspectos_mejorar       => p_aspectos_mejorar);

    -- Fuera del UPDATE: ver la declaracion de l_postulacion (PLS-00231).
    -- La que eligio el usuario, o la deducida si no mando ninguna.
    l_postulacion := f_postulacion_final(p_id_postulacion, p_id_facilitador, p_id_institucion);

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
           escala = p_escala,
           aspectos_positivos     = p_aspectos_positivos,
           aspectos_mejorar       = p_aspectos_mejorar,
           observacion_admin      = p_observacion_admin,
           ind_cerrado            = l_cerrado,
           -- Se recalcula: si cambiaron el facilitador o la institucion, la
           -- postulacion anterior ya no corresponde. Resuelta arriba, fuera del
           -- UPDATE (PLS-00231).
           id_postulacion         = l_postulacion,
           id_indice              = p_id_indice
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

    -- El mismo candado que en ACTUALIZAR: una evaluacion cerrada no se borra.
    -- Aca no hay excepcion posible —borrar no admite un "pero reabrila"—, asi
    -- que hay que reabrirla con un PUT y recien despues borrarla.
    --
    -- OJO: el front borra una evaluacion con N llamadas, una por detalle. Si
    -- alguna fila del grupo esta cerrada, ese DELETE falla y la evaluacion queda
    -- a medias. Es el mismo problema que ya tiene el borrado sin transaccion
    -- (ver PENDIENTES.md); por eso el front no ofrece borrar lo que esta cerrado.
    IF f_cerrada(p_id) THEN
        p_error(409, 'Conflict',
                'La evaluacion esta cerrada. Reabrila para poder eliminarla.');
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

------------------------------------------------------------------------------
-- Resuelve el año por el que filtran los combos.
--
--   p_anio NULL      -> el año lectivo activo (ANIOS_LECTIVOS.ESTADO = 'A')
--   p_anio 'TODOS'   -> NULL, o sea: no filtrar
--   p_anio '2026'    -> ese
--
-- Devolver NULL significa SIEMPRE "no filtres por año", y por eso el caso de
-- "no hay año activo cargado" cae ahi: es preferible un combo con datos de mas
-- a un combo vacio que nadie sabe por que esta vacio.
--
-- El TO_CHAR es obligatorio: POSTULACIONES.ANIO es VARCHAR2(4) y la funcion
-- devuelve NUMBER. Comparar los dos sin convertir hace que Oracle convierta la
-- COLUMNA a numero, y ahi se pierde el indice IDX_POST_INST_FAC_ANIO — ademas
-- de reventar con ORA-01722 si alguna fila tiene texto que no es un año.
------------------------------------------------------------------------------
FUNCTION anio_a_filtrar(p_anio IN VARCHAR2) RETURN VARCHAR2 IS
    l_anio NUMBER;
BEGIN
    IF p_anio IS NOT NULL THEN
        IF UPPER(TRIM(p_anio)) = 'TODOS' THEN
            RETURN NULL;
        END IF;
        RETURN TRIM(p_anio);
    END IF;

    l_anio := fn_anio_lectivo_actual();
    RETURN CASE WHEN l_anio IS NULL THEN NULL ELSE TO_CHAR(l_anio) END;
END anio_a_filtrar;

-- Dominio: ACTIVO = 'SI' / 'NO'. Por defecto solo los activos, porque un combo
-- no debe ofrecer gente dada de baja.
--
-- p_incluir_id: el id que el formulario ya tiene cargado entra SIEMPRE, aunque
-- este inactivo. Sin esto, editar una evaluacion vieja cuyo facilitador se dio
-- de baja despues muestra el combo en blanco y al guardar se pierde el dato.
--
-- FILTRO POR AÑO LECTIVO: ademas de estar activo, el facilitador tiene que
-- tener al menos una POSTULACION en el año vigente. Si no, el combo ofrece
-- gente que este año no trabaja — sigue activa en la ficha, pero no esta dando
-- clases, y evaluarla no tiene sentido.
--
--   * EXISTS y no JOIN: un facilitador tiene varias postulaciones por año
--     (materias, turnos, instituciones) y un JOIN lo repetiria en el combo.
--   * Si no hay año activo cargado, anio_a_filtrar devuelve NULL y este filtro
--     se apaga solo: vuelven a salir todos los activos.
--   * ?anio=TODOS lo apaga explicitamente.
PROCEDURE lov_facilitadores(
    p_patron     IN VARCHAR2,
    p_activo     IN VARCHAR2,
    p_incluir_id IN NUMBER,
    p_anio       IN VARCHAR2,
    p_tope       IN PLS_INTEGER
) IS
    -- 'TODOS' desactiva el filtro; cualquier otro valor filtra por el.
    l_activo VARCHAR2(10) := CASE
                               WHEN p_activo IS NULL THEN 'SI'
                               WHEN UPPER(TRIM(p_activo)) = 'TODOS' THEN NULL
                               ELSE UPPER(TRIM(p_activo))
                             END;
    l_anio VARCHAR2(4) := anio_a_filtrar(p_anio);
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_facilitador, nombre_apellido, activo
          FROM facilitadores f
         WHERE f.id_facilitador = p_incluir_id
            OR ((p_patron IS NULL OR UPPER(f.nombre_apellido) LIKE p_patron
                                  OR UPPER(f.nro_ci)          LIKE p_patron)
                AND (l_activo IS NULL OR UPPER(f.activo) = l_activo)
                AND (l_anio IS NULL
                     OR EXISTS (SELECT 1
                                  FROM postulaciones p
                                 WHERE p.id_facilitador = f.id_facilitador
                                   AND p.anio           = l_anio)))
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
-- p_anio: contra POSTULACIONES.ANIO (VARCHAR2(4)).
--
--   SIN el parametro se usa EL AÑO LECTIVO ACTIVO (FN_ANIO_LECTIVO_ACTUAL, que
--   lee ANIOS_LECTIVOS.ESTADO = 'A'). Antes el default era "no filtrar por
--   año", y eso mezclaba en el combo las instituciones de todos los años en los
--   que el facilitador alguna vez postulo. Se cambio a pedido: una evaluacion
--   es siempre del año en curso.
--
--   Para desactivarlo explicitamente: ?anio=TODOS.
--
--   SI NO HAY AÑO ACTIVO cargado, la funcion devuelve NULL y esto NO filtra por
--   año — se comporta como antes. Es a proposito: una tabla de configuracion sin
--   cargar no puede dejar el formulario sin instituciones y sin explicacion.
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
    -- NULL = no filtrar por año. Se resuelve UNA vez y no dentro del SELECT:
    -- adentro, la funcion se evaluaria por fila candidata.
    l_anio VARCHAR2(4) := anio_a_filtrar(p_anio);
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
                                   AND (l_anio IS NULL OR p.anio = l_anio))))
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

------------------------------------------------------------------------------
-- La direccion de UNA institucion: quien la dirige, con su cargo y telefono.
--
-- Es 100% INFORMATIVO. No se guarda nada en EVALUACIONES_FACILITADORES: la
-- tarjeta del formulario lo muestra para que el evaluador sepa con quien hablar
-- al llegar. Por eso no hay FK ni columna ID_DIRECTOR en la evaluacion.
--
-- DEVUELVE TODAS LAS FILAS ACTIVAS, NO UNA.
--   INSTITUCIONES_DIRECTORES tiene una fila por PERIODO + NIVEL + TURNO, y una
--   institucion puede tener a la vez un director de la manana en Escolar Basica
--   y otro de la tarde en Media, los dos con ESTADO = 'A'. Quedarse con uno solo
--   escondia al que si correspondia, sin avisar. El front las lista todas.
--
-- p_estado: 'A' por defecto (el dominio de ESTADO es texto libre VARCHAR2(20),
--   pero los datos usan 'A' = activo). 'TODOS' lo apaga, para ver el historico.
--
-- NO filtra por PERIODO. PERIODO es un VARCHAR2(50) sin dominio —no es el año
-- lectivo ni tiene FK a ANIOS_LECTIVOS—, asi que no hay forma segura de decir
-- cual es "el actual". El ESTADO es lo unico confiable, y por eso es el filtro.
-- El PERIODO viaja igual, para que la tarjeta lo pueda mostrar.
--
-- ORDER BY: el periodo mas reciente primero (DESC, alfabetico sobre el texto),
-- y dentro de el por nombre. Asi lo vigente queda arriba aunque se pidan todos.
--
-- El telefono sale de la fila de INSTITUCIONES_DIRECTORES —es el de esa persona
-- EN ESA institucion— y cae al de DIRECTORES cuando no esta cargado: la ficha
-- del director es el respaldo, no al reves.
------------------------------------------------------------------------------
PROCEDURE lov_directores(
    p_id_institucion IN NUMBER,
    p_estado         IN VARCHAR2,
    p_tope           IN PLS_INTEGER
) IS
    l_estado VARCHAR2(20) := CASE
                               WHEN p_estado IS NULL THEN 'A'
                               WHEN UPPER(TRIM(p_estado)) = 'TODOS' THEN NULL
                               ELSE UPPER(TRIM(p_estado))
                             END;
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT idr.id_periodo, idr.periodo, idr.id_director,
               d.nombre_apellido, idr.cargo, idr.nivel, idr.turno, idr.estado,
               -- El de la institucion manda; el de la ficha es el respaldo.
               NVL(idr.nro_telefono, d.nro_telefono) AS nro_telefono
          FROM instituciones_directores idr
          JOIN directores d ON d.id_director = idr.id_director
         WHERE idr.id_institucion = p_id_institucion
           AND (l_estado IS NULL OR UPPER(TRIM(idr.estado)) = l_estado)
         ORDER BY idr.periodo DESC, d.nombre_apellido
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_periodo',      r.id_periodo);
        APEX_JSON.WRITE('periodo',         r.periodo);
        APEX_JSON.WRITE('id_director',     r.id_director);
        APEX_JSON.WRITE('nombre_apellido', r.nombre_apellido);
        APEX_JSON.WRITE('cargo',           r.cargo);
        APEX_JSON.WRITE('nivel',           r.nivel);
        APEX_JSON.WRITE('turno',           r.turno);
        APEX_JSON.WRITE('estado',          r.estado);
        APEX_JSON.WRITE('nro_telefono',    r.nro_telefono);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_directores;

------------------------------------------------------------------------------
-- Los manuales, sin repetir. Es el primer combo de la cascada Manual -> Indice.
--
-- INDICES_MANUALES no tiene tabla de manuales: MANUAL es un VARCHAR2(100) de la
-- propia fila. El DISTINCT ES el catalogo — no hay otro lado de donde sacarlo.
--
-- Se devuelve el texto como `id` ademas de como `manual`: el front normaliza
-- todos los combos a { id, texto } y necesita ALGO en id. Es el unico LOV cuyo
-- identificador es texto, y por eso no entra en `lista()` como los demas.
------------------------------------------------------------------------------
PROCEDURE lov_manuales(p_patron IN VARCHAR2, p_tope IN PLS_INTEGER) IS
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT DISTINCT manual
          FROM indices_manuales
         WHERE (p_patron IS NULL OR UPPER(manual) LIKE p_patron)
         ORDER BY manual
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('manual', r.manual);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_manuales;

------------------------------------------------------------------------------
-- Los indices de un manual. Segundo combo de la cascada.
--
-- p_manual filtra por el manual elegido. SIN el parametro devuelve los de todos
-- los manuales, que es util para el buscador pero no para la cascada.
--
-- ORDER BY nro_indice: es el orden del manual impreso, que es como el evaluador
-- lo tiene delante. Alfabetico por titulo no le serviria a nadie.
------------------------------------------------------------------------------
PROCEDURE lov_indices(
    p_patron IN VARCHAR2,
    p_manual IN VARCHAR2,
    p_tope   IN PLS_INTEGER
) IS
BEGIN
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT id_indice, nro_indice, titulo, manual
          FROM indices_manuales
         WHERE (p_manual IS NULL OR manual = p_manual)
           -- Busca por titulo O por numero: "3" tiene que encontrar el indice 3.
           AND (p_patron IS NULL
                OR UPPER(titulo) LIKE p_patron
                OR TO_CHAR(nro_indice) LIKE p_patron)
         ORDER BY manual, nro_indice
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_indice',  r.id_indice);
        APEX_JSON.WRITE('nro_indice', r.nro_indice);
        APEX_JSON.WRITE('titulo',     r.titulo);
        APEX_JSON.WRITE('manual',     r.manual);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_indices;

------------------------------------------------------------------------------
-- EL SIGUIENTE INDICE A DESARROLLAR en una postulacion.
--
-- Devuelve UN objeto (no un array): el indice que le toca a esa clase segun lo
-- que el facilitador ya registro en INTERVENCIONES. El formulario de evaluacion
-- lo muestra como campo de solo lectura — no se elige, se deduce.
--
-- LA REGLA, en dos pasos:
--   1. Ultimo desarrollado = el NRO_INDICE mas alto con SI_NO = 'Si' en las
--      INTERVENCIONES de ESA postulacion.
--   2. El siguiente = el NRO_INDICE inmediato posterior DENTRO DEL MISMO MANUAL.
--
-- POR QUE SOLO 'Si':
--   SI_NO = 'No' significa que el indice NO se desarrollo (y por eso el trigger
--   TRG_INTERV_SINO_MOTIVO exige MOTIVO_DESARROLLO). Ese indice sigue PENDIENTE:
--   contarlo como avance lo saltearia para siempre. Es el mismo criterio de
--   TRG_INTERV_FINALIZA_POST, que exige 'Si' para dar la postulacion por
--   terminada. UPPER() porque el dominio es VARCHAR2(50) libre y hay 'Si'/'SI'.
--
-- POR QUE POR POSTULACION Y NO POR FACILITADOR:
--   El manual avanza clase a clase. Un facilitador con 7mo y 8vo en el mismo
--   colegio lleva DOS avances distintos; cruzarlos haria que una clase empuje a
--   la otra. ID_POSTULACION es el grado y seccion concretos, que es la unidad
--   real. Coincide con TRG_INTERV_FINALIZA_POST, que tambien razona por
--   postulacion.
--
-- EL MANUAL SALE DE LA ULTIMA INTERVENCION, no de un parametro: es el que esa
-- clase viene desarrollando. Sin intervenciones previas no hay manual del cual
-- deducir nada, y ahi devuelve el objeto vacio (ver abajo).
--
-- LOS TRES CASOS, que el front distingue por `estado`:
--   'PENDIENTE'  hay siguiente indice: se devuelve con sus datos.
--   'SIN_INICIAR' la postulacion no tiene ninguna intervencion con 'Si'. No se
--                 asume el indice 1: el manual no se sabe. El front deja el
--                 campo vacio en vez de proponer algo inventado.
--   'FINALIZADO' el ultimo 'Si' ya era el indice mas alto del manual. No queda
--                siguiente — es el estado que TRG_INTERV_FINALIZA_POST marca en
--                POSTULACIONES.ESTADO.
------------------------------------------------------------------------------
PROCEDURE indice_siguiente(p_id_postulacion IN NUMBER) IS
    l_manual      indices_manuales.manual%TYPE;
    l_nro_ultimo  indices_manuales.nro_indice%TYPE;
    l_id_indice   indices_manuales.id_indice%TYPE;
    l_nro_indice  indices_manuales.nro_indice%TYPE;
    l_titulo      indices_manuales.titulo%TYPE;
    l_estado      VARCHAR2(20);
BEGIN
    -- 1) El ultimo indice EFECTIVAMENTE desarrollado en esta postulacion.
    --    Se ordena por NRO_INDICE y no por FECHA_HORA: si se cargaron fuera de
    --    orden, lo que manda es el orden del manual, no el de tipeo.
    BEGIN
        SELECT im.manual, im.nro_indice
          INTO l_manual, l_nro_ultimo
          FROM intervenciones i
          JOIN indices_manuales im ON im.id_indice = i.id_indice
         WHERE i.id_postulacion = p_id_postulacion
           AND UPPER(TRIM(i.si_no)) = 'SI'
         ORDER BY im.nro_indice DESC
         FETCH FIRST 1 ROW ONLY;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            l_manual := NULL;
    END;

    IF l_manual IS NULL THEN
        l_estado := 'SIN_INICIAR';
    ELSE
        -- 2) El inmediato siguiente DEL MISMO MANUAL. Se toma el menor mayor al
        --    ultimo y no "ultimo + 1": los NRO_INDICE pueden tener huecos.
        BEGIN
            SELECT id_indice, nro_indice, titulo
              INTO l_id_indice, l_nro_indice, l_titulo
              FROM indices_manuales
             WHERE manual = l_manual
               AND nro_indice > l_nro_ultimo
             ORDER BY nro_indice
             FETCH FIRST 1 ROW ONLY;
            l_estado := 'PENDIENTE';
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                l_estado := 'FINALIZADO';
        END;
    END IF;

    -- Objeto y no array: es UN indice o ninguno. `data` igual para que el front
    -- lea todas las respuestas del paquete de la misma forma.
    APEX_JSON.OPEN_OBJECT('data');
    APEX_JSON.WRITE('estado',          l_estado);
    APEX_JSON.WRITE('manual',          l_manual);
    -- El ultimo desarrollado viaja para que la UI pueda explicar de donde sale
    -- la propuesta ("sigue al indice 7") en vez de mostrar un numero solo.
    APEX_JSON.WRITE('nro_ultimo',      l_nro_ultimo);
    APEX_JSON.WRITE('id_indice',       l_id_indice);
    APEX_JSON.WRITE('nro_indice',      l_nro_indice);
    APEX_JSON.WRITE('titulo',          l_titulo);
    APEX_JSON.CLOSE_OBJECT;
END indice_siguiente;

------------------------------------------------------------------------------
-- Las postulaciones de UN facilitador en UNA institucion. Alimenta las tarjetas
-- que el front muestra despues de elegir la institucion, para que el evaluador
-- diga CUAL de todas esta evaluando.
--
-- Es la lista que el comentario de f_postulacion() dejaba anotada como la salida
-- correcta a la ambiguedad: cuando hay varias candidatas, la elige una persona
-- en vez de adivinarla el backend.
--
-- LOS DOS PARAMETROS SON OBLIGATORIOS. Sin ellos la consulta devolveria las
-- postulaciones de toda la base: son ~8.000 filas y ninguna significa nada fuera
-- del par facilitador+institucion. El dispatcher corta con un 400 antes.
--
-- ── EL GRADO NO ES UNA COLUMNA ───────────────────────────────────────────────
--
-- POSTULACIONES no tiene un campo "grado": tiene TRECE columnas numericas —"2",
-- "3", "4".."9", "1M".."3M"— donde **la que esta cargada indica el grado y su
-- valor es la matricula**. Una fila con "7"=20 es "7mo grado, 20 alumnos".
--
-- Los nombres son identificadores que empiezan con digito, asi que van SIEMPRE
-- entre comillas dobles. Sin ellas, Oracle lee p."4" como el numero 4 y falla
-- con ORA-00923.
--
-- El orden del CASE importa: es el orden en que se muestran los grados. Va de
-- menor a mayor y no en el orden fisico de la tabla, donde "2" y "3" quedaron
-- despues de SECCION.
--
-- ── SER/HACER/TENER/... SON OTRO EJE ─────────────────────────────────────────
--
-- Las otras siete columnas (SER, HACER, TENER, CARACTER, VISION, CORAJE,
-- LIDERAZGO) traen el MISMO numero que la del grado. Son el programa, no el
-- grado, y por eso salen en un campo aparte en vez de mezclarse con el.
------------------------------------------------------------------------------
PROCEDURE lov_postulaciones(
    p_id_facilitador IN NUMBER,
    p_id_institucion IN NUMBER,
    p_anio           IN VARCHAR2,
    p_dia            IN VARCHAR2,
    p_tope           IN PLS_INTEGER
) IS
    -- NULL = no filtrar por año. Se resuelve UNA vez y no dentro del SELECT:
    -- adentro, la funcion se evaluaria por fila candidata.
    l_anio VARCHAR2(4) := anio_a_filtrar(p_anio);

    ----------------------------------------------------------------------------
    -- EL DIA DE LA SEMANA. Por defecto, HOY.
    --
    -- Una evaluacion se carga el dia que se observa la clase, asi que lo util es
    -- ver solo las postulaciones que ese facilitador tiene ESE dia. Un
    -- facilitador con clases lunes, miercoles y viernes mostraba tres tarjetas
    -- donde solo una podia ser la correcta.
    --
    -- 1=lunes .. 5=viernes, NULL = no filtrar. Se calcula con TRUNC(fecha)-TRUNC(
    -- fecha,'IW'), que da los dias transcurridos desde el lunes de esa semana:
    -- es INDEPENDIENTE de NLS_TERRITORY, a diferencia de TO_CHAR(...,'D'), que
    -- arranca en domingo o en lunes segun la configuracion de la sesion. Ese
    -- detalle es el que haria que el filtro corriera un dia en otra instancia.
    --
    -- ?dia=TODOS lo apaga; ?dia=1..5 fuerza uno (para probar sin esperar al
    -- miercoles).
    ----------------------------------------------------------------------------
    l_dia PLS_INTEGER;
BEGIN
    IF UPPER(TRIM(p_dia)) = 'TODOS' THEN
        l_dia := NULL;
    ELSIF TRIM(p_dia) IS NOT NULL THEN
        -- Si viene basura, el filtro se apaga en vez de tirar 500.
        BEGIN
            l_dia := TO_NUMBER(TRIM(p_dia));
        EXCEPTION
            WHEN VALUE_ERROR THEN l_dia := NULL;
        END;
    ELSE
        l_dia := TRUNC(SYSDATE) - TRUNC(SYSDATE, 'IW') + 1;
    END IF;

    -- SABADO (6) y DOMINGO (7): no hay clases, y filtrar dejaria la lista vacia
    -- sin explicacion. Se muestran todas — es mejor que el evaluador elija entre
    -- varias a que crea que el facilitador no tiene ninguna.
    IF l_dia NOT BETWEEN 1 AND 5 THEN
        l_dia := NULL;
    END IF;
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT p.id_postulacion,
               p.seccion,
               p.turno,
               p.observacion,
               p.estado,
               p.anio,
               -- Cual de las trece columnas esta cargada.
               CASE
                 WHEN p."2"  IS NOT NULL THEN '2do'
                 WHEN p."3"  IS NOT NULL THEN '3ro'
                 WHEN p."4"  IS NOT NULL THEN '4to'
                 WHEN p."5"  IS NOT NULL THEN '5to'
                 WHEN p."6"  IS NOT NULL THEN '6to'
                 WHEN p."7"  IS NOT NULL THEN '7mo'
                 WHEN p."8"  IS NOT NULL THEN '8vo'
                 WHEN p."9"  IS NOT NULL THEN '9no'
                 WHEN p."1M" IS NOT NULL THEN '1ro Media'
                 WHEN p."2M" IS NOT NULL THEN '2do Media'
                 WHEN p."3M" IS NOT NULL THEN '3ro Media'
               END AS grado,
               -- El valor de esa misma columna: la matricula.
               COALESCE(p."2", p."3", p."4", p."5", p."6", p."7", p."8", p."9",
                        p."1M", p."2M", p."3M") AS alumnos,
               -- El segundo eje. Mismo criterio: el que este cargado.
               CASE
                 WHEN p.ser       IS NOT NULL THEN 'Ser'
                 WHEN p.hacer     IS NOT NULL THEN 'Hacer'
                 WHEN p.tener     IS NOT NULL THEN 'Tener'
                 WHEN p.caracter  IS NOT NULL THEN 'Caracter'
                 WHEN p.vision    IS NOT NULL THEN 'Vision'
                 WHEN p.coraje    IS NOT NULL THEN 'Coraje'
                 WHEN p.liderazgo IS NOT NULL THEN 'Liderazgo'
               END AS programa,
               -- DOCENTES manda; NOMBRE_PROFESOR es el respaldo para las filas
               -- donde ID_DOCENTE quedo en null (es NULLABLE y hay filas asi).
               COALESCE(d.nombre_apellido, p.nombre_profesor) AS docente,
               p.telefono,
               e.descripcion AS enfasis,
               m.descripcion AS materia,
               -- HORARIO. Son cinco pares de columnas (LUNES_DESDE/HASTA ..
               -- VIERNES_DESDE/HASTA), una por dia de clase.
               --
               -- SOLO GUARDAN LA HORA: el trigger TRG_POSTULACIONES_SET_FEC_HORA
               -- reescribe la fecha al 01/01/2025 en cada INSERT y UPDATE, asi que
               -- la parte de fecha no significa nada. Por eso sale con TO_CHAR
               -- 'HH24:MI' y no como fecha: mandar el DATE crudo haria que el front
               -- mostrara un 01/01/2025 que confunde.
               --
               -- Se arma el texto ACA y no en el front porque son diez columnas: el
               -- JSON llevaria diez campos que el front tendria que volver a juntar,
               -- repitiendo esta misma logica.
               TRIM(
                 CASE WHEN p.lunes_desde IS NOT NULL THEN
                   'Lun ' || TO_CHAR(p.lunes_desde, 'HH24:MI')
                   || NVL2(p.lunes_hasta, '-' || TO_CHAR(p.lunes_hasta, 'HH24:MI'), '') || ' '
                 END
                 || CASE WHEN p.martes_desde IS NOT NULL THEN
                   'Mar ' || TO_CHAR(p.martes_desde, 'HH24:MI')
                   || NVL2(p.martes_hasta, '-' || TO_CHAR(p.martes_hasta, 'HH24:MI'), '') || ' '
                 END
                 || CASE WHEN p.miercoles_desde IS NOT NULL THEN
                   'Mie ' || TO_CHAR(p.miercoles_desde, 'HH24:MI')
                   || NVL2(p.miercoles_hasta, '-' || TO_CHAR(p.miercoles_hasta, 'HH24:MI'), '') || ' '
                 END
                 || CASE WHEN p.jueves_desde IS NOT NULL THEN
                   'Jue ' || TO_CHAR(p.jueves_desde, 'HH24:MI')
                   || NVL2(p.jueves_hasta, '-' || TO_CHAR(p.jueves_hasta, 'HH24:MI'), '') || ' '
                 END
                 || CASE WHEN p.viernes_desde IS NOT NULL THEN
                   'Vie ' || TO_CHAR(p.viernes_desde, 'HH24:MI')
                   || NVL2(p.viernes_hasta, '-' || TO_CHAR(p.viernes_hasta, 'HH24:MI'), '') || ' '
                 END
               ) AS horario,
               --------------------------------------------------------------
               -- EL SIGUIENTE INDICE A DESARROLLAR en esta postulacion.
               --
               -- Va en la tarjeta, debajo del programa: el evaluador elige la
               -- clase VIENDO que indice le toca, sin tener que seleccionarla
               -- primero para enterarse.
               --
               -- La regla, en dos pasos:
               --   1. el ultimo indice con SI_NO='Si' en INTERVENCIONES de ESTA
               --      postulacion (el ultimo efectivamente desarrollado),
               --   2. el inmediato siguiente DENTRO DEL MISMO MANUAL.
               --
               -- Solo cuentan los 'Si': un indice marcado 'No' no se dio —por
               -- eso TRG_INTERV_SINO_MOTIVO le exige MOTIVO_DESARROLLO— y sigue
               -- pendiente, asi que se vuelve a proponer. Mismo criterio que
               -- TRG_INTERV_FINALIZA_POST, que exige 'Si' para finalizar.
               --
               -- Se ordena por NRO_INDICE y no por FECHA_HORA: si se cargaron
               -- fuera de orden, manda el orden del manual, no el de tipeo.
               --
               -- Es un subquery escalar por fila y no un JOIN porque devuelve
               -- UNA fila o ninguna, y un JOIN con el ultimo/siguiente exigiria
               -- dos niveles de agregacion sobre la lista entera. Son pocas
               -- postulaciones por facilitador+institucion (el tope las acota),
               -- asi que el costo es despreciable y usa IDX_INTERV_POSTULACION.
               --------------------------------------------------------------
               (SELECT sig.id_indice
                  FROM indices_manuales sig
                 WHERE sig.manual = ult.manual
                   AND sig.nro_indice > ult.nro_indice
                 ORDER BY sig.nro_indice
                 FETCH FIRST 1 ROW ONLY) AS id_indice_sig,
               (SELECT sig.nro_indice
                  FROM indices_manuales sig
                 WHERE sig.manual = ult.manual
                   AND sig.nro_indice > ult.nro_indice
                 ORDER BY sig.nro_indice
                 FETCH FIRST 1 ROW ONLY) AS nro_indice_sig,
               (SELECT sig.titulo
                  FROM indices_manuales sig
                 WHERE sig.manual = ult.manual
                   AND sig.nro_indice > ult.nro_indice
                 ORDER BY sig.nro_indice
                 FETCH FIRST 1 ROW ONLY) AS titulo_indice_sig,
               -- El manual que esta clase viene desarrollando, y el ultimo
               -- indice dado. Viajan para que la tarjeta pueda explicar de
               -- donde sale la propuesta en vez de mostrar un numero suelto.
               ult.manual     AS manual_indice,
               ult.nro_indice AS nro_indice_ultimo
          FROM postulaciones p
          -- El ultimo indice desarrollado, por postulacion. OUTER APPLY y no
          -- LEFT JOIN: lleva FETCH FIRST, que un JOIN no admite. Sin filas
          -- (clase sin intervenciones) devuelve NULL y la tarjeta no muestra
          -- indice, que es lo correcto: sin intervenciones no se sabe ni el
          -- manual, asi que cualquier propuesta seria inventada.
          OUTER APPLY (
              SELECT im.manual, im.nro_indice
                FROM intervenciones i
                JOIN indices_manuales im ON im.id_indice = i.id_indice
               WHERE i.id_postulacion = p.id_postulacion
                 AND UPPER(TRIM(i.si_no)) = 'SI'
               ORDER BY im.nro_indice DESC
               FETCH FIRST 1 ROW ONLY
          ) ult
          -- Los tres LEFT y no INNER: las tres FK son NULLABLE, y una
          -- postulacion sin enfasis cargado tiene que aparecer igual.
          LEFT JOIN docentes d ON d.id_docente   = p.id_docente
          LEFT JOIN enfasis  e ON e.id_enfasis   = p.id_enfasis
          LEFT JOIN materias m ON m.id_materia   = p.id_materia
         WHERE p.id_facilitador = p_id_facilitador
           AND p.id_institucion = p_id_institucion
           AND (l_anio IS NULL OR p.anio = l_anio)
           -- El dia de la semana. Se mira _DESDE y no _HASTA: una postulacion
           -- con horario cargado siempre tiene el desde, y el hasta puede faltar.
           AND (l_dia IS NULL
                OR (l_dia = 1 AND p.lunes_desde     IS NOT NULL)
                OR (l_dia = 2 AND p.martes_desde    IS NOT NULL)
                OR (l_dia = 3 AND p.miercoles_desde IS NOT NULL)
                OR (l_dia = 4 AND p.jueves_desde    IS NOT NULL)
                OR (l_dia = 5 AND p.viernes_desde   IS NOT NULL))
         -- Por grado y seccion: es como el evaluador las tiene en la cabeza.
         -- NULLS LAST deja al final las que no tienen grado cargado.
         ORDER BY p.turno, p.seccion NULLS LAST, p.id_postulacion
         FETCH FIRST p_tope ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('id_postulacion', r.id_postulacion);
        APEX_JSON.WRITE('grado',          r.grado);
        APEX_JSON.WRITE('alumnos',        r.alumnos);
        APEX_JSON.WRITE('seccion',        r.seccion);
        -- El numero crudo. La etiqueta ("Mañana"/"Tarde"/"Noche") la pone el
        -- front: TURNO no tiene tabla ni FK, asi que el dominio esta cableado en
        -- los dos lados. Anotado en PENDIENTES.md.
        APEX_JSON.WRITE('turno',          r.turno);
        APEX_JSON.WRITE('programa',       r.programa);
        APEX_JSON.WRITE('docente',        r.docente);
        APEX_JSON.WRITE('telefono',       r.telefono);
        APEX_JSON.WRITE('enfasis',        r.enfasis);
        APEX_JSON.WRITE('materia',        r.materia);
        -- "Lun 07:30-09:00 Mie 10:00-11:30", o NULL si no cargaron horario.
        APEX_JSON.WRITE('horario',        r.horario);
        APEX_JSON.WRITE('observacion',    r.observacion);
        APEX_JSON.WRITE('estado',         r.estado);
        APEX_JSON.WRITE('anio',           r.anio);
        -- El indice que le toca a esta clase. Los tres van juntos o los tres en
        -- null: si no hay siguiente (clase sin intervenciones, o manual
        -- terminado) la tarjeta no muestra la linea.
        APEX_JSON.WRITE('id_indice',      r.id_indice_sig);
        APEX_JSON.WRITE('nro_indice',     r.nro_indice_sig);
        APEX_JSON.WRITE('indice_titulo',  r.titulo_indice_sig);
        -- Contexto de la propuesta: de que manual sale y a que indice sigue.
        APEX_JSON.WRITE('manual',         r.manual_indice);
        APEX_JSON.WRITE('nro_indice_ultimo', r.nro_indice_ultimo);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
END lov_postulaciones;

PROCEDURE lista(
    p_token          IN VARCHAR2,
    p_nombre         IN VARCHAR2,
    p_buscar         IN VARCHAR2 DEFAULT NULL,
    p_id_area        IN NUMBER   DEFAULT NULL,
    p_activo         IN VARCHAR2 DEFAULT NULL,
    p_estado         IN VARCHAR2 DEFAULT NULL,
    p_incluir_id     IN NUMBER   DEFAULT NULL,
    p_id_facilitador IN NUMBER   DEFAULT NULL,
    p_id_institucion IN NUMBER   DEFAULT NULL,
    p_id_postulacion IN NUMBER   DEFAULT NULL,
    p_dia            IN VARCHAR2 DEFAULT NULL,
    p_manual         IN VARCHAR2 DEFAULT NULL,
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
       OR l_clave NOT IN ('facilitadores', 'instituciones', 'areas', 'evaluaciones',
                          'ciudades', 'postulaciones', 'manuales', 'indices',
                          'directores', 'indice-siguiente')
    THEN
        p_error(400, 'Bad Request',
                'Lista desconocida. Validas: facilitadores, instituciones, '
                || 'areas, evaluaciones, ciudades, postulaciones, manuales, '
                || 'indices, directores, indice-siguiente');
        RETURN;
    END IF;

    -- `indice-siguiente` se calcula SOBRE una postulacion: sin ella no hay nada
    -- que deducir. Es la unica "lista" que devuelve un objeto y no un array.
    IF l_clave = 'indice-siguiente' AND p_id_postulacion IS NULL THEN
        p_error(400, 'Bad Request', 'listas/indice-siguiente requiere id_postulacion');
        RETURN;
    END IF;

    -- `postulaciones` EXIGE el par facilitador+institucion. Sin filtrar
    -- devolveria las ~8.000 filas de la tabla, y ninguna significa nada fuera de
    -- ese par. Es un 400 y no una lista vacia: una lista vacia se confundiria con
    -- "este facilitador no postulo aca".
    IF l_clave = 'postulaciones'
       AND (p_id_facilitador IS NULL OR p_id_institucion IS NULL)
    THEN
        p_error(400, 'Bad Request',
                'listas/postulaciones requiere id_facilitador e id_institucion');
        RETURN;
    END IF;

    -- `directores` exige la institucion, por el mismo motivo: la direccion de
    -- todas las instituciones juntas no es una lista que nadie pida, y sin
    -- filtro se llevaria el tope entero de filas.
    IF l_clave = 'directores' AND p_id_institucion IS NULL THEN
        p_error(400, 'Bad Request', 'listas/directores requiere id_institucion');
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
      WHEN 'facilitadores' THEN
        lov_facilitadores(l_patron, p_activo, p_incluir_id, p_anio, l_tope);
      WHEN 'instituciones' THEN
        lov_instituciones(l_patron, p_estado, p_incluir_id, p_id_facilitador, p_anio, l_tope);
      WHEN 'areas'         THEN lov_areas(l_patron, l_tope);
      WHEN 'evaluaciones'  THEN lov_evaluaciones(l_patron, p_id_area, l_tope);
      WHEN 'ciudades'      THEN lov_ciudades(l_patron, l_tope);
      WHEN 'postulaciones' THEN
        -- Sin l_patron: no se busca por texto. Son pocas por facilitador e
        -- institucion, y el front las muestra todas como tarjetas.
        lov_postulaciones(p_id_facilitador, p_id_institucion, p_anio, p_dia, l_tope);
      WHEN 'manuales'      THEN lov_manuales(l_patron, l_tope);
      WHEN 'indices'       THEN lov_indices(l_patron, p_manual, l_tope);
      WHEN 'directores'    THEN
        -- Sin l_patron: son una o dos por institucion y se muestran todas.
        lov_directores(p_id_institucion, p_estado, l_tope);
      WHEN 'indice-siguiente' THEN
        -- Sin tope: devuelve UN objeto, no una lista.
        indice_siguiente(p_id_postulacion);
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
        p_escala => TO_NUMBER(:escala),
        p_aspectos_positivos     => :aspectos_positivos,
        p_aspectos_mejorar       => :aspectos_mejorar,
        -- Sin :ind_cerrado. El POST crea la evaluacion ABIERTA siempre; si el
        -- JSON trae el campo, ORDS lo bindea y nadie lo lee. Ver INSERTAR.
        p_observacion_admin      => :observacion_admin,
        -- La postulacion elegida en las tarjetas del front. Opcional: sin ella
        -- el paquete la deduce como siempre.
        p_id_postulacion         => TO_NUMBER(:id_postulacion),
        p_id_indice              => TO_NUMBER(:id_indice));
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
        p_escala => TO_NUMBER(:escala),
        p_aspectos_positivos     => :aspectos_positivos,
        p_aspectos_mejorar       => :aspectos_mejorar,
        p_observacion_admin      => :observacion_admin,
        p_ind_cerrado            => :ind_cerrado,
        p_id_postulacion         => TO_NUMBER(:id_postulacion),
        p_id_indice              => TO_NUMBER(:id_indice));
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
  --   listas/postulaciones ?id_facilitador=&id_institucion=&anio=   (los dos ids
  --                        son OBLIGATORIOS: sin ellos responde 400)
  --   listas/directores    ?id_institucion=&estado=&limite=   (id_institucion
  --                        OBLIGATORIO: sin el responde 400)
  --   listas/indice-siguiente ?id_postulacion=   (OBLIGATORIO. Devuelve UN
  --                        objeto, no un array)
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
        p_id_institucion => TO_NUMBER(:id_institucion),
        p_id_postulacion => TO_NUMBER(:id_postulacion),
        p_dia            => :dia,
        p_manual         => :manual,
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
--          "escala":1,"aspectos_positivos":"Puntual y claro",
--          "aspectos_mejorar":"Cerrar con resumen",
--          "observacion_admin":"Revisado por coordinacion"}'
--
--   Cada POST carga UN detalle (un area + una evaluacion + su estrella). Una
--   evaluacion completa son varios POST, uno por detalle, repitiendo la cabecera.
--
--   curl -s -X PUT    "$BASE/evaluaciones-facilitadores/1" -H "$AUTH" \
--        -H "Content-Type: application/json" -d '{...registro completo...}'
--   curl -s -X DELETE "$BASE/evaluaciones-facilitadores/1" -H "$AUTH"
--
-- Si curl funciona y el front no, el problema esta en el proxy o en la URL
-- configurada, no en la base.
--------------------------------------------------------------------------------
