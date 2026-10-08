--------------------------------------------------------------------------------
-- MENU_PAGINAS  —  El menu de la app nueva
--------------------------------------------------------------------------------
--
-- QUE HACE ESTE SCRIPT
--
--   1. Crea la tabla MENU_PAGINAS (si no existe). Sin ID_AUDITORIA ni bitacora:
--      se sacaron a pedido el 08/10/2026 (ver mas abajo).
--   2. Carga las pantallas que ya tiene la app, cada una con su numero de
--      pagina. Las que ya estan cargadas (por RUTA) no se tocan.
--   3. Pasa a esos numeros los permisos que se habian cargado en ROLES_PAGINAS
--      con las paginas "virtuales" 1000-1009 (ver mas abajo).
--
-- CORRER DESPUES de auth.sql.
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EL MODELO (decidido el 08/10/2026)
--------------------------------------------------------------------------------
--
--   ROLES_PAGINAS   los permisos, la MISMA tabla que usa APEX. APP_ID es
--                   siempre 40587.
--   MENU_PAGINAS    el menu de la app nueva: a que menu principal va cada
--                   pagina, con que nombre y a que pantalla lleva.
--
-- Una pantalla de la app es una pagina como las de APEX: su APP_PAGE_ID es el
-- mismo en las dos tablas. El menu de un usuario son las filas de MENU_PAGINAS
-- con PUEDE_CONSULTAR = 'S' en ROLES_PAGINAS.
--
-- NUMERO DE UNA PAGINA NUEVA (la que se da de alta desde Crear paginas): el
-- ultimo APP_PAGE_ID de MENU_PAGINAS mas 1, y despues no cambia nunca. Lo
-- calcula siguiente_pagina en roles_paginas.sql (08/10/2026), y el alta no
-- crea permisos: los da el administrador en Roles de paginas.
--
-- La seccion 4 de ESTE script, que es una migracion de una sola vez, usa otro
-- calculo (el mayor entre ROLES_PAGINAS, APEX y MENU_PAGINAS): asi numero las
-- pantallas que el sitio ya tenia, sin chocar con ninguna pagina de APEX. Como
-- no repite las que ya estan, volver a correrlo no cambia ningun numero.
--
-- RUTA es la pantalla de la app (`/evaluaciones`). Tiene que existir en
-- src/routes/: una fila con una ruta que la app no tiene lleva a "no
-- encontrado".
--
--------------------------------------------------------------------------------
-- LAS PAGINAS 1000-1009
--------------------------------------------------------------------------------
--
-- Antes de esta tabla se habian usado numeros "virtuales" desde la 1000 para
-- las pantallas de la app (roles_paginas.sql, misma fecha), y con ellos se
-- cargaron permisos en ROLES_PAGINAS. La seccion 4 los pasa al numero
-- correlativo de cada pantalla con un UPDATE: nadie pierde lo que tenia.
-- Esos numeros quedan fuera del calculo del "ultimo mas 1".
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'ROLES_PAGINAS';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ROLES_PAGINAS.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ROLES_PAGINAS encontrada.');
  END IF;

  -- La primera version de este script le creaba bitacora a MENU_PAGINAS. Sin
  -- la columna ID_AUDITORIA ese trigger queda invalido y TODO insert falla con
  -- ORA-04098: se borra.
  FOR o IN (SELECT object_name, object_type FROM user_objects
             WHERE object_name IN ('AUDITORIA_MENU_PAGINAS', 'MENU_PAGINAS_JN')
               AND object_type IN ('TRIGGER', 'TABLE')
             ORDER BY object_type DESC) LOOP  -- primero el trigger
    BEGIN
      EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' ' || o.object_name;
      DBMS_OUTPUT.PUT_LINE('[OK]   Borrado ' || o.object_type || ' ' || o.object_name
                           || ' (bitacora vieja de MENU_PAGINAS).');
    EXCEPTION
      WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudo borrar ' || o.object_name || ': ' || SQLERRM);
    END;
  END LOOP;
END;
/

--------------------------------------------------------------------------------
-- === 2) TABLA ===============================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = 'MENU_PAGINAS';
  IF l_n > 0 THEN
    DBMS_OUTPUT.PUT_LINE('[SKIP] La tabla MENU_PAGINAS ya existia.');
  ELSE
    EXECUTE IMMEDIATE q'~
      CREATE TABLE menu_paginas (
        app_page_id     NUMBER         NOT NULL,
        menu_principal  VARCHAR2(100)  NOT NULL,
        nombre_pagina   VARCHAR2(200)  NOT NULL,
        ruta            VARCHAR2(200)  NOT NULL,
        CONSTRAINT menu_paginas_pk PRIMARY KEY (app_page_id),
        CONSTRAINT menu_paginas_uk_ruta UNIQUE (ruta),
        CONSTRAINT menu_paginas_ck_ruta CHECK (ruta LIKE '/%')
      )~';
    DBMS_OUTPUT.PUT_LINE('[OK]   Tabla MENU_PAGINAS creada.');
  END IF;
END;
/

-- Fuera del bloque de arriba: se aplican aunque la tabla ya existiera.
COMMENT ON TABLE menu_paginas IS
  'Menu de la app nueva (sitio web). Una fila por pantalla. El menu de un usuario son las filas con PUEDE_CONSULTAR = S en ROLES_PAGINAS.';
COMMENT ON COLUMN menu_paginas.app_page_id IS
  'Numero de pagina. El mismo APP_PAGE_ID de ROLES_PAGINAS (APP_ID 40587). Una pagina nueva es el ultimo numero mas 1 y no cambia nunca.';
COMMENT ON COLUMN menu_paginas.menu_principal IS
  'Grupo del menu en el que aparece: Nucleo de Datos, Operaciones, Reportes y Consultas, Administrador.';
COMMENT ON COLUMN menu_paginas.nombre_pagina IS
  'Texto que se ve en el menu.';
COMMENT ON COLUMN menu_paginas.ruta IS
  'Pantalla de la app a la que lleva, tal como esta en src/routes. Ej.: /evaluaciones. Unica.';

--------------------------------------------------------------------------------
-- === 3) LAS PAGINAS DE APEX, CON SU RUTA EN EL SITIO (08/10/2026) ==========
--------------------------------------------------------------------------------

-- Las del Navigation Menu de la app 40587, con su MISMO numero: asi los
-- permisos que ya tienen en ROLES_PAGINAS valen en el sitio sin tocar nada.
-- Menu principal y nombre son los de APEX (con sus errores de tipeo; se
-- corrigen desde Crear paginas). RUTA es la pantalla que van a tener en el
-- sitio: minusculas, sin acentos, con guiones, y `consulta-` cuando el mismo
-- nombre esta en dos menus.
--
-- No van: la 1 (Inicio, fija en el sitio), los titulos de grupo, y las 18 que
-- son MODALES de otra pagina (3, 5, 7, 9, 11, 13, 15, 18, 19, 21, 22, 27, 29,
-- 32, 33, 35, 37, 42): en el sitio van dentro de la pantalla de su listado y
-- usan los permisos de esa. Sus filas de ROLES_PAGINAS quedan: APEX las usa.
--
-- La 2 (Roles de Usuarios) SI va, con /permisos: en el sitio es "Roles de
-- paginas", la pantalla fija del menu Administrador. Quien la usa en el sitio no
-- sale de ROLES_PAGINAS (ver administra en roles_paginas.sql) y el sitio no la
-- repite en el menu, pero el numero queda registrado como el de las demas.
--
-- `pagina_apex` deja la fila como tiene que quedar desde cualquier estado:
--
--   - si OTRA fila tiene esa ruta (una pantalla del sitio que se cargo con un
--     numero nuevo antes de esto: /sucursales, /agendas, /inventario,
--     /consulta-inventarios), le pasa sus permisos al numero de APEX y la
--     borra. La pantalla migrada usa el numero que tenia en APEX.
--   - si la fila del numero existe, le pone la ruta (nombre y menu no se tocan:
--     se pueden haber corregido desde Crear paginas);
--   - si no existe, la crea.
DECLARE
  PROCEDURE pagina_apex(p_id IN NUMBER, p_menu IN VARCHAR2, p_nombre IN VARCHAR2,
                        p_ruta IN VARCHAR2) IS
    l_otra NUMBER;
    l_n    PLS_INTEGER;
  BEGIN
    BEGIN
      SELECT app_page_id INTO l_otra FROM menu_paginas
       WHERE ruta = p_ruta AND app_page_id <> p_id;
      INSERT INTO roles_paginas (app_id, app_page_id, app_user_id, puede_insertar,
                                 puede_actualizar, puede_borrar, puede_consultar, ver_campos)
      SELECT app_id, p_id, app_user_id, puede_insertar, puede_actualizar, puede_borrar,
             puede_consultar, ver_campos
        FROM roles_paginas r
       WHERE r.app_id = 40587 AND r.app_page_id = l_otra
         AND NOT EXISTS (SELECT 1 FROM roles_paginas x
                          WHERE x.app_id = 40587 AND x.app_page_id = p_id
                            AND x.app_user_id = r.app_user_id);
      DELETE FROM roles_paginas WHERE app_id = 40587 AND app_page_id = l_otra;
      DELETE FROM menu_paginas WHERE app_page_id = l_otra;
      DBMS_OUTPUT.PUT_LINE('[OK]   ' || RPAD(p_ruta, 38) || ' pagina ' || l_otra
                           || ' fusionada en la ' || p_id || ' de APEX');
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;

    UPDATE menu_paginas SET ruta = p_ruta WHERE app_page_id = p_id AND ruta <> p_ruta;
    SELECT COUNT(*) INTO l_n FROM menu_paginas WHERE app_page_id = p_id;
    IF l_n = 0 THEN
      INSERT INTO menu_paginas (app_page_id, menu_principal, nombre_pagina, ruta)
      VALUES (p_id, p_menu, p_nombre, p_ruta);
    END IF;
  END pagina_apex;
BEGIN
  pagina_apex( 2, 'Administrador',               'Roles de Usuarios',                    '/permisos');
  pagina_apex( 4, UNISTR('N\00facleo de Datos'), 'Paises',                               '/paises');
  pagina_apex( 6, UNISTR('N\00facleo de Datos'), 'Departamentos',                        '/departamentos');
  pagina_apex( 8, UNISTR('N\00facleo de Datos'), 'Ciudades',                             '/ciudades');
  pagina_apex(10, UNISTR('N\00facleo de Datos'), 'Barrios',                              '/barrios');
  pagina_apex(12, UNISTR('N\00facleo de Datos'), 'Nacionalidades',                       '/nacionalidades');
  pagina_apex(14, UNISTR('N\00facleo de Datos'), 'Facilitadores',                        '/facilitadores');
  pagina_apex(16, UNISTR('N\00facleo de Datos'), 'Instituciones',                        '/instituciones');
  pagina_apex(17, UNISTR('N\00facleo de Datos'), 'Materias',                             '/materias');
  pagina_apex(20, 'Operaciones',                 'Postulaciones',                        '/postulaciones');
  pagina_apex(23, 'Operaciones',                 'Asignar Facilitador a Institucion',    '/asignar-facilitadores');
  pagina_apex(24, 'Reportes y Consultas',        'Consulta de Postulaciones',            '/consulta-postulaciones');
  pagina_apex(25, 'Operaciones',                 'Intervencciones en el Mapa',           '/mapa-intervenciones');
  pagina_apex(26, UNISTR('N\00facleo de Datos'), 'Enfasis',                              '/enfasis');
  pagina_apex(28, UNISTR('N\00facleo de Datos'), UNISTR('\00cdndices'),                  '/indices');
  pagina_apex(30, 'Reportes y Consultas',        'Agendas',                              '/agendas');
  pagina_apex(31, UNISTR('N\00facleo de Datos'), 'Horarios de Instituciones',            '/horarios-instituciones');
  pagina_apex(34, UNISTR('N\00facleo de Datos'), 'Directores',                           '/directores');
  pagina_apex(36, UNISTR('N\00facleo de Datos'), 'Instituciones y Directores',           '/instituciones-directores');
  pagina_apex(41, UNISTR('N\00facleo de Datos'), 'Docentes',                             '/docentes');
  pagina_apex(44, 'Reportes y Consultas',        'Instituciones y Facilitadores',        '/consulta-instituciones-facilitadores');
  pagina_apex(45, UNISTR('N\00facleo de Datos'), 'Coordinadores',                        '/coordinadores');
  pagina_apex(47, UNISTR('N\00facleo de Datos'), 'Instituciones y Coordinadores',        '/instituciones-coordinadores');
  pagina_apex(49, 'Reportes y Consultas',        'Cantidad de Alumnos por Grado',        '/consulta-alumnos-grado');
  pagina_apex(50, 'Reportes y Consultas',        'Cantidad de Manuales',                 '/consulta-cantidad-manuales');
  pagina_apex(52, 'Reportes y Consultas',        'Intervenciones Realizadas',            '/consulta-intervenciones');
  pagina_apex(53, 'Reportes y Consultas',        'Resumen de Intervenciones',            '/resumen-intervenciones');
  pagina_apex(55, 'Reportes y Consultas',        'Totales por Facilitador',              '/totales-facilitador');
  pagina_apex(57, UNISTR('N\00facleo de Datos'), UNISTR('A\00f1os Lectivos'),            '/anios-lectivos');
  pagina_apex(58, 'Reportes y Consultas',        'Auditoria de Intervenciones',          '/auditoria-intervenciones');
  pagina_apex(61, 'Reportes y Consultas',        'Instituciones',                        '/consulta-instituciones');
  pagina_apex(62, 'Reportes y Consultas',        'Facilitadores',                        '/consulta-facilitadores');
  pagina_apex(67, 'Administrador',               'Usuarios',                             '/usuarios');
  pagina_apex(69, 'Reportes y Consultas',        'Intervenciones no realizadas',         '/intervenciones-no-realizadas');
  pagina_apex(70, UNISTR('N\00facleo de Datos'), 'Feriados Nacioanles',                  '/feriados');
  pagina_apex(72, UNISTR('N\00facleo de Datos'), 'Sucursales',                           '/sucursales');
  pagina_apex(74, 'Operaciones',                 'Inventarios de Manuales',              '/inventario');
  pagina_apex(76, 'Reportes y Consultas',        'Inventerios de Manuales',              '/consulta-inventarios');
  pagina_apex(77, 'Reportes y Consultas',        'Historial de Inventarios de Manuales', '/historial-inventarios');
  pagina_apex(79, UNISTR('N\00facleo de Datos'), 'Etapas',                               '/etapas');
  pagina_apex(81, UNISTR('N\00facleo de Datos'), UNISTR('Areas de Evaluaci\00f3n'),      '/areas-evaluacion');
  pagina_apex(83, UNISTR('N\00facleo de Datos'), 'Evaluaciones',                         '/items-evaluacion');
  pagina_apex(85, UNISTR('N\00facleo de Datos'), 'Escalas de Evaluaciones',              '/escalas-evaluacion');
  pagina_apex(87, 'Reportes y Consultas',        'Monitoreo de Facilitadores',           '/monitoreo-facilitadores');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Paginas de APEX con su ruta en el sitio.');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] Paginas de APEX: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        No quedo nada a medias: se deshizo todo.');
END;
/

--------------------------------------------------------------------------------
-- === 4) LAS PANTALLAS QUE YA TIENE EL SITIO + SUS PERMISOS VIEJOS =========
--------------------------------------------------------------------------------

DECLARE
  -- Mayor numero de pagina en uso, sin las virtuales 1000-1009 (ver encabezado).
  FUNCTION ultima_pagina RETURN NUMBER IS
    l_rp   NUMBER;
    l_mp   NUMBER;
    l_apex NUMBER := 0;
  BEGIN
    SELECT NVL(MAX(app_page_id), 0) INTO l_rp FROM roles_paginas
     WHERE app_id = 40587 AND app_page_id NOT BETWEEN 1000 AND 1009;
    SELECT NVL(MAX(app_page_id), 0) INTO l_mp FROM menu_paginas;
    BEGIN
      SELECT NVL(MAX(page_id), 0) INTO l_apex FROM apex_application_pages
       WHERE application_id = 40587;
    EXCEPTION
      WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo leer APEX_APPLICATION_PAGES: ' || SQLERRM);
    END;
    RETURN GREATEST(l_rp, l_mp, l_apex);
  END ultima_pagina;

  PROCEDURE pantalla(
    p_ruta    IN VARCHAR2,
    p_menu    IN VARCHAR2,
    p_nombre  IN VARCHAR2,
    p_virtual IN NUMBER)  -- el numero 1000+ que tuvo antes, para pasar sus permisos
  IS
    l_pagina NUMBER;
    l_n      PLS_INTEGER;
  BEGIN
    BEGIN
      SELECT app_page_id INTO l_pagina FROM menu_paginas WHERE ruta = p_ruta;
      DBMS_OUTPUT.PUT_LINE('[SKIP] ' || RPAD(p_ruta, 26) || ' ya era la pagina ' || l_pagina);
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        l_pagina := ultima_pagina + 1;
        INSERT INTO menu_paginas (app_page_id, menu_principal, nombre_pagina, ruta)
        VALUES (l_pagina, p_menu, p_nombre, p_ruta);
        DBMS_OUTPUT.PUT_LINE('[OK]   ' || RPAD(p_ruta, 26) || ' -> pagina ' || l_pagina);
    END;

    -- Los permisos que quedaron con el numero virtual pasan al definitivo.
    UPDATE roles_paginas SET app_page_id = l_pagina
     WHERE app_id = 40587 AND app_page_id = p_virtual;
    l_n := SQL%ROWCOUNT;
    IF l_n > 0 THEN
      DBMS_OUTPUT.PUT_LINE('       ' || l_n || ' permiso(s) pasados de la ' || p_virtual
                           || ' a la ' || l_pagina);
    END IF;
  END pantalla;
BEGIN
  -- En el orden en que se ven en el menu. UNISTR en los acentos: el upload de
  -- SQL Scripts puede no respetar la codificacion del archivo.
  pantalla('/sucursales',              UNISTR('N\00facleo de Datos'), 'Sucursales',                 1001);
  pantalla('/evaluaciones',            'Operaciones',                 'Evaluaciones',               1002);
  pantalla('/intervenciones',          'Operaciones',                 'Intervenciones',             1003);
  pantalla('/inventario',              'Operaciones',                 'Inventario de manuales',     1004);
  pantalla('/transferencias',          'Operaciones',                 'Transferencias de manuales', 1005);
  pantalla('/agendas',                 'Reportes y Consultas',        'Agendas',                    1006);
  pantalla('/consulta-inventarios',    'Reportes y Consultas',        'Consulta de inventarios',    1007);
  pantalla('/consulta-transferencias', 'Reportes y Consultas',        'Consulta de transferencias', 1008);
  pantalla('/auditoria',               'Administrador',               UNISTR('Auditor\00eda'),      1009);
  -- Permisos y Paginas del menu NO van aca: son pantallas fijas de
  -- administracion, en el codigo (ver roles_paginas.sql, funcion administra).
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] No se pudieron cargar las pantallas: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('        No quedo nada a medias: se deshizo todo.');
END;
/

--------------------------------------------------------------------------------
-- === 4b) PERMISOS DE LAS PANTALLAS NUEVAS DEL SITIO (08/10/2026) ============
--------------------------------------------------------------------------------

-- Las que el sitio tiene y el menu de APEX no: Evaluaciones, Intervenciones,
-- Transferencias, Consulta de transferencias y Auditoria. Todo en 'S' para
-- JOSEG, EDGARO y VALENTINAS, a pedido. Los demas usuarios las reciben desde
-- Roles de paginas.
--
-- Solo agrega lo que falta: una fila que ya existe no se toca, aunque se le
-- hayan cambiado las banderas despues.
DECLARE
  l_n PLS_INTEGER;
BEGIN
  INSERT INTO roles_paginas (app_id, app_page_id, app_user_id, puede_insertar,
                             puede_actualizar, puede_borrar, puede_consultar, ver_campos)
  SELECT 40587, m.app_page_id, u.usuario, 'S', 'S', 'S', 'S', 'S'
    FROM menu_paginas m
   CROSS JOIN (SELECT 'JOSEG' usuario FROM dual
               UNION ALL SELECT 'EDGARO' FROM dual
               UNION ALL SELECT 'VALENTINAS' FROM dual) u
   WHERE m.ruta IN ('/evaluaciones', '/intervenciones', '/transferencias',
                    '/consulta-transferencias', '/auditoria')
     AND NOT EXISTS (SELECT 1 FROM roles_paginas r
                      WHERE r.app_id = 40587 AND r.app_page_id = m.app_page_id
                        AND r.app_user_id = u.usuario);
  l_n := SQL%ROWCOUNT;
  COMMIT;
  DBMS_OUTPUT.PUT_LINE(CASE WHEN l_n > 0
                            THEN '[OK]   ' || l_n || ' permiso(s) de pantallas nuevas para '
                                 || 'JOSEG, EDGARO y VALENTINAS.'
                            ELSE '[SKIP] JOSEG, EDGARO y VALENTINAS ya tenian las pantallas nuevas.'
                       END);
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('[ERROR] Permisos de las pantallas nuevas: ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 5) VERIFICACION ========================================================
--------------------------------------------------------------------------------

BEGIN
  DBMS_OUTPUT.PUT_LINE('');
  DBMS_OUTPUT.PUT_LINE('MENU_PAGINAS:');
  FOR r IN (SELECT m.app_page_id, m.menu_principal, m.nombre_pagina, m.ruta,
                   (SELECT COUNT(*) FROM roles_paginas p
                     WHERE p.app_id = 40587 AND p.app_page_id = m.app_page_id
                       AND p.puede_consultar = 'S') AS usuarios
              FROM menu_paginas m
             ORDER BY m.app_page_id) LOOP
    DBMS_OUTPUT.PUT_LINE('  ' || LPAD(r.app_page_id, 5) || '  ' || RPAD(r.menu_principal, 22)
                         || RPAD(r.nombre_pagina, 28) || RPAD(r.ruta, 26)
                         || r.usuarios || ' usuario(s)');
  END LOOP;

  FOR r IN (SELECT COUNT(*) AS n FROM roles_paginas
             WHERE app_id = 40587 AND app_page_id BETWEEN 1000 AND 1009) LOOP
    IF r.n > 0 THEN
      DBMS_OUTPUT.PUT_LINE('[WARN] Quedan ' || r.n || ' fila(s) con paginas 1000-1009 en '
                           || 'ROLES_PAGINAS.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   No quedan paginas virtuales 1000-1009 en ROLES_PAGINAS.');
    END IF;
  END LOOP;
END;
/
