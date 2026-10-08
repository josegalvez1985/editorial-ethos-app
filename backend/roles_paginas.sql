--------------------------------------------------------------------------------
-- ROLES_PAGINAS + MENU_PAGINAS  —  Menu y permisos de la app nueva
--------------------------------------------------------------------------------
--
-- QUE PUBLICA ESTE SCRIPT
--
--   Menu del usuario
--     GET     menu                          las paginas de MENU_PAGINAS con los
--                                           permisos del usuario del token
--
--   Paginas (MENU_PAGINAS)
--     GET     menu-paginas                  todas, con cuantos permisos tienen
--     POST    menu-paginas                  {menu_principal, nombre_pagina, ruta}
--                                           el numero lo pone el backend (el
--                                           ultimo del menu mas 1); NO crea
--                                           permisos
--     PUT     menu-paginas/:id             {menu_principal, nombre_pagina, ruta}
--     DELETE  menu-paginas/:id              solo si no tiene permisos
--
--   Permisos (ROLES_PAGINAS)
--     GET     roles-paginas?usuario=X       todas las filas, o las de un usuario
--     GET     roles-paginas/usuarios        usuarios del workspace + los que
--                                           tienen filas, con cuantas paginas
--     GET     roles-paginas/paginas         nombre de cada pagina: las de la app
--                                           (MENU_PAGINAS) y las de APEX
--     POST    roles-paginas                 {usuario, pagina, insertar,
--                                            actualizar, borrar, consultar,
--                                            ver_campos}
--     PUT     roles-paginas/:usuario/:pagina   las cinco banderas
--     DELETE  roles-paginas/:usuario/:pagina
--     POST    roles-paginas/copiar          {desde, hacia} las paginas de
--                                           "desde" que "hacia" no tiene
--
-- CORRER DESPUES de auth.sql y menu_paginas.sql (que crea MENU_PAGINAS).
--
--   SQL Workshop -> SQL Scripts -> Upload -> este archivo -> Run
--
-- Idempotente: se puede correr las veces que haga falta.
--
--------------------------------------------------------------------------------
-- EL MODELO (decidido el 08/10/2026)
--------------------------------------------------------------------------------
--
--   ROLES_PAGINAS   los permisos. La MISMA tabla que usa APEX, con APP_ID
--                   siempre 40587. No se toca ni su estructura ni su trigger.
--   MENU_PAGINAS    el menu de la app nueva: a que menu principal va cada
--                   pagina, con que nombre y a que pantalla (RUTA) lleva.
--
-- Una pantalla de la app es una pagina como las de APEX: el mismo APP_PAGE_ID
-- en las dos tablas. El numero de una pagina nueva es el ultimo APP_PAGE_ID de
-- MENU_PAGINAS mas 1, y no cambia nunca. Lo calcula el alta (POST
-- menu-paginas), nadie lo escribe a mano. Hasta el 08/10/2026 era el mayor
-- entre ROLES_PAGINAS, MENU_PAGINAS y las paginas de APEX; ver
-- siguiente_pagina para el unico caso en que no es exactamente el ultimo mas 1.
--
-- El ORDEN del menu es el de los numeros: los menus principales en el orden de
-- su primera pagina, y dentro de cada uno, por numero. No hay columna de orden.
--
--------------------------------------------------------------------------------
-- COMO SE LEE UNA FILA DE ROLES_PAGINAS
--------------------------------------------------------------------------------
--
--   Sin fila         sin acceso
--   'S'              si
--   'N' o NULL       no      (hay filas de ANDRESF con VER_CAMPOS en NULL)
--
-- ESTADISTICA_USER no se lee ni se escribe desde aca: esta vacia en todas las
-- filas y no se sabe que uso tiene en APEX. Un UPDATE no la toca.
--
--------------------------------------------------------------------------------
-- QUIEN PUEDE ADMINISTRAR
--------------------------------------------------------------------------------
--
-- Las dos pantallas de administracion van al principio del menu Administrador
-- (hasta el 08/10/2026 iban en un grupo propio, Administracion):
--
--   /permisos   roles de paginas  (roles-paginas/*)   quien tenga la pagina 2
--                                                     en ROLES_PAGINAS
--   /paginas    crear paginas     (menu-paginas/*)    JOSEG, fijo (administra)
--
-- ROLES DE PAGINAS SALE DE ROLES_PAGINAS (08/10/2026), como en APEX: es la
-- pagina 2, "Roles de Usuarios", y sus filas valen igual que en APEX. Sin
-- PUEDE_CONSULTAR no se ve en el menu ni se abre; cada endpoint pide su
-- accion (consultar, insertar, actualizar, borrar). Sus modales de APEX, la 3
-- (Crear Rol) y la 19 (Copiar Roles), son dialogos de esa pantalla y usan los
-- permisos de la 2. Hasta ese dia era fija para JOSEG y EDGARO.
--
-- OJO: si nadie tiene la 2 habilitada, nadie puede dar permisos desde el
-- sitio. La verificacion del final de este script lo avisa.
--
-- Crear paginas sigue fija: cambiar quien la usa es cambiar `administra` y
-- volver a correr este script.
--
-- `menu` solo exige sesion, y ademas dice si el usuario ve cada una de las dos
-- (admin_permisos por ROLES_PAGINAS, admin_paginas por administra).
--
-- /permisos esta en MENU_PAGINAS como la pagina 2 de APEX. El sitio no la
-- repite en el menu con el nombre de APEX: la muestra como "Roles de paginas".
-- Sus filas de ROLES_PAGINAS NO SE BORRAN: hasta el 08/10/2026 este script las
-- borraba, y le hubiera quitado a medio APEX el acceso a Roles de Usuarios.
--
-- El alta de una pagina la guarda SOLO en MENU_PAGINAS (08/10/2026). Los
-- permisos los da despues el administrador en Roles de paginas, incluidos los
-- de quien la creo: hasta que no tenga fila, la pagina no le aparece en el
-- menu ni a el. Antes el alta le daba todo en 'S' a quien la creaba.
--
--------------------------------------------------------------------------------

SET SERVEROUTPUT ON

--------------------------------------------------------------------------------
-- === 1) VERIFICACION PREVIA =================================================
--------------------------------------------------------------------------------

DECLARE
  l_n PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_n FROM all_objects
   WHERE object_name = 'PKG_AUTH_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] Falta PKG_AUTH_ETHOS. Corre backend/auth.sql primero.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_AUTH_ETHOS encontrado.');
  END IF;

  FOR t IN (SELECT 'ROLES_PAGINAS' AS nombre FROM dual
            UNION ALL SELECT 'MENU_PAGINAS' FROM dual) LOOP
    SELECT COUNT(*) INTO l_n FROM user_tables WHERE table_name = t.nombre;
    IF l_n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('[ERROR] No existe la tabla ' || t.nombre
                           || '. MENU_PAGINAS la crea backend/menu_paginas.sql.');
    ELSE
      DBMS_OUTPUT.PUT_LINE('[OK]   Tabla ' || t.nombre || ' encontrada.');
    END IF;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] ' || SQLERRM);
END;
/

--------------------------------------------------------------------------------
-- === 2) PAQUETE =============================================================
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE PKG_ROLES_PAGINAS_ETHOS AS

  -- La app APEX de ROLES_PAGINAS. Siempre esta.
  c_app_id      CONSTANT NUMBER       := 40587;
  -- Las dos pantallas FIJAS de administracion (ver administra en el body).
  -- /permisos esta en MENU_PAGINAS como la pagina 2 de APEX; /paginas no.
  c_ruta_admin    CONSTANT VARCHAR2(20) := '/permisos';  -- roles de paginas
  c_ruta_paginas  CONSTANT VARCHAR2(20) := '/paginas';   -- crear paginas

  -- 'S' si el usuario tiene la accion sobre la pagina, 'N' si no.
  -- p_accion: 'I' insertar, 'U' actualizar, 'D' borrar, 'C' consultar,
  --           'V' ver campos.
  --
  -- Publica a proposito: es la que van a llamar los demas paquetes cuando cada
  -- endpoint controle permisos en el backend, no solo el menu del front.
  FUNCTION puede(p_usuario IN VARCHAR2, p_pagina IN NUMBER, p_accion IN VARCHAR2)
    RETURN VARCHAR2;

  -- La pagina de una pantalla por su ruta ('/evaluaciones'), o NULL.
  FUNCTION pagina_de_ruta(p_ruta IN VARCHAR2) RETURN NUMBER;

  -- Menu del usuario ----------------------------------------------------------
  PROCEDURE menu(p_token IN VARCHAR2);

  -- Paginas (MENU_PAGINAS) ----------------------------------------------------
  PROCEDURE paginas_listar(p_token IN VARCHAR2);

  PROCEDURE pagina_guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,   -- NULL = alta
    p_menu_principal IN VARCHAR2,
    p_nombre_pagina  IN VARCHAR2,
    p_ruta           IN VARCHAR2);

  PROCEDURE pagina_eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2);

  -- Permisos (ROLES_PAGINAS) --------------------------------------------------
  PROCEDURE listar(p_token IN VARCHAR2, p_usuario IN VARCHAR2);

  PROCEDURE usuarios(p_token IN VARCHAR2);

  PROCEDURE nombres_paginas(p_token IN VARCHAR2);

  PROCEDURE insertar(
    p_token      IN VARCHAR2,
    p_usuario    IN VARCHAR2,
    p_pagina     IN VARCHAR2,
    p_insertar   IN VARCHAR2,
    p_actualizar IN VARCHAR2,
    p_borrar     IN VARCHAR2,
    p_consultar  IN VARCHAR2,
    p_ver_campos IN VARCHAR2);

  PROCEDURE actualizar(
    p_token      IN VARCHAR2,
    p_usuario    IN VARCHAR2,
    p_pagina     IN VARCHAR2,
    p_insertar   IN VARCHAR2,
    p_actualizar IN VARCHAR2,
    p_borrar     IN VARCHAR2,
    p_consultar  IN VARCHAR2,
    p_ver_campos IN VARCHAR2);

  PROCEDURE eliminar(p_token IN VARCHAR2, p_usuario IN VARCHAR2, p_pagina IN VARCHAR2);

  -- La pagina 19 de APEX (Copiar Roles). Ver el body.
  PROCEDURE copiar(p_token IN VARCHAR2, p_desde IN VARCHAR2, p_hacia IN VARCHAR2);

END PKG_ROLES_PAGINAS_ETHOS;
/

CREATE OR REPLACE PACKAGE BODY PKG_ROLES_PAGINAS_ETHOS AS

  -- El mismo workspace que PKG_AUTH_ETHOS. Hace falta para leer las vistas
  -- APEX_WORKSPACE_APEX_USERS y APEX_APPLICATION_PAGES desde ORDS.
  c_workspace CONSTANT VARCHAR2(64) := 'FUNDCARAC';
  -- La cuenta duena del workspace: no se ofrece como usuario (ver usuarios).
  c_cuenta_duena CONSTANT VARCHAR2(64) := 'FUNDACIONCARACTER2024@GMAIL.COM';

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

  PROCEDURE ok(p_mensaje IN VARCHAR2) IS
  BEGIN
    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('message', p_mensaje);
    APEX_JSON.CLOSE_OBJECT;
  END ok;

  FUNCTION f_usuario(p_token IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
  EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
  END f_usuario;

  -- Best-effort: sin esto las vistas APEX_* pueden volver vacias desde ORDS.
  PROCEDURE fijar_workspace IS
  BEGIN
    APEX_UTIL.SET_SECURITY_GROUP_ID(
      p_security_group_id => APEX_UTIL.FIND_SECURITY_GROUP_ID(p_workspace => c_workspace));
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END fijar_workspace;

  -- 'S' o 'N': cualquier otra cosa, NULL incluido, es 'N'.
  -- PRIVADA: no se puede usar adentro de un SELECT/INSERT/UPDATE (PLS-00231).
  -- Se calcula antes, en una variable.
  FUNCTION sn(p_valor IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN UPPER(TRIM(p_valor)) = 'S' THEN 'S' ELSE 'N' END;
  END sn;

  -- Numero entero y positivo, o NULL si no lo es.
  FUNCTION f_numero(p_valor IN VARCHAR2) RETURN NUMBER IS
    l_n NUMBER;
  BEGIN
    l_n := TO_NUMBER(TRIM(p_valor));
    RETURN CASE WHEN l_n > 0 AND l_n = TRUNC(l_n) THEN l_n END;
  EXCEPTION
    WHEN VALUE_ERROR OR INVALID_NUMBER THEN RETURN NULL;
  END f_numero;

  FUNCTION pagina_de_ruta(p_ruta IN VARCHAR2) RETURN NUMBER IS
    l_pagina NUMBER;
  BEGIN
    SELECT app_page_id INTO l_pagina FROM menu_paginas WHERE ruta = p_ruta;
    RETURN l_pagina;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END pagina_de_ruta;

  ------------------------------------------------------------------------------
  -- CREAR PAGINAS ES FIJA: quien la usa NO sale de ROLES_PAGINAS, esta escrito
  -- aca y en ningun otro lado:
  --
  --   'PAGINAS'   crear paginas     (/paginas)    JOSEG
  --
  -- Cambiar quien la usa es cambiar esta funcion y volver a correr el script.
  --
  -- Roles de paginas (/permisos) TAMBIEN era fija, para JOSEG y EDGARO, hasta
  -- el 08/10/2026. Ahora sale de ROLES_PAGINAS, como en APEX: la ve y la usa
  -- quien tiene habilitada su pagina (la 2). Ver exigir.
  ------------------------------------------------------------------------------
  FUNCTION administra(p_usuario IN VARCHAR2, p_que IN VARCHAR2) RETURN BOOLEAN IS
    l_u VARCHAR2(255) := UPPER(p_usuario);
  BEGIN
    RETURN CASE p_que
             WHEN 'PAGINAS'  THEN l_u = 'JOSEG'
             ELSE FALSE
           END;
  END administra;

  FUNCTION puede(p_usuario IN VARCHAR2, p_pagina IN NUMBER, p_accion IN VARCHAR2)
    RETURN VARCHAR2
  IS
    l_r VARCHAR2(1);
  BEGIN
    SELECT CASE UPPER(p_accion)
             WHEN 'I' THEN puede_insertar
             WHEN 'U' THEN puede_actualizar
             WHEN 'D' THEN puede_borrar
             WHEN 'C' THEN puede_consultar
             WHEN 'V' THEN ver_campos
           END
      INTO l_r
      FROM roles_paginas
     WHERE app_id      = c_app_id
       AND app_page_id = p_pagina
       AND app_user_id = UPPER(p_usuario);
    RETURN sn(l_r);
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN 'N';
  END puede;

  -- Si el usuario puede p_accion en Roles de paginas: su fila de ROLES_PAGINAS
  -- para la pagina de /permisos (la 2). Sin fila, o sin esa pagina en el menu,
  -- no puede nada.
  FUNCTION puede_permisos(p_usuario IN VARCHAR2, p_accion IN VARCHAR2) RETURN BOOLEAN IS
    l_pagina NUMBER := pagina_de_ruta(c_ruta_admin);
  BEGIN
    RETURN l_pagina IS NOT NULL AND puede(p_usuario, l_pagina, p_accion) = 'S';
  END puede_permisos;

  ------------------------------------------------------------------------------
  -- Sesion + permiso. Devuelve el usuario, o NULL habiendo ya respondido el
  -- error (401 o 403): el que llama solo hace RETURN.
  --
  --   'PAGINAS'   Crear paginas: fijo, ver administra. p_accion no se usa.
  --   'PERMISOS'  Roles de paginas: p_accion en su pagina de ROLES_PAGINAS
  --               ('C' consultar, 'I' insertar, 'U' actualizar, 'D' borrar),
  --               igual que APEX con la 2 y sus modales 3 y 19.
  ------------------------------------------------------------------------------
  FUNCTION exigir(p_token IN VARCHAR2, p_que IN VARCHAR2, p_accion IN VARCHAR2 DEFAULT 'C')
    RETURN VARCHAR2
  IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado');
      RETURN NULL;
    END IF;
    IF p_que = 'PAGINAS' AND NOT administra(l_usuario, p_que) THEN
      p_error(403, 'Forbidden', 'No tenes permiso para administrar las paginas del menu');
      RETURN NULL;
    END IF;
    IF p_que = 'PERMISOS' AND NOT puede_permisos(l_usuario, p_accion) THEN
      p_error(403, 'Forbidden', 'No tenes permiso para '
        || CASE p_accion WHEN 'I' THEN 'agregar permisos'
                         WHEN 'U' THEN 'modificar permisos'
                         WHEN 'D' THEN 'quitar permisos'
                         ELSE 'ver los permisos' END
        || ' (Roles de paginas en ROLES_PAGINAS)');
      RETURN NULL;
    END IF;
    RETURN l_usuario;
  END exigir;

  -- El numero de una pagina nueva: el ultimo de MENU_PAGINAS mas 1 (ver el
  -- encabezado).
  --
  -- Hasta el 08/10/2026 era el mayor entre ROLES_PAGINAS, MENU_PAGINAS y las
  -- paginas de APEX. Se paso a mirar solo el menu, a pedido.
  --
  -- La unica excepcion: si ese numero ya tiene filas en ROLES_PAGINAS (una
  -- pagina de APEX que no esta en el menu, por ejemplo una que se agregue en el
  -- builder despues), se saltea al siguiente libre. Si no, la pagina nueva
  -- naceria con los permisos de otra pantalla, y Roles de paginas no podria
  -- dar esos permisos porque ya "estan".
  FUNCTION siguiente_pagina RETURN NUMBER IS
    l_id NUMBER;
    l_n  PLS_INTEGER;
  BEGIN
    SELECT NVL(MAX(app_page_id), 0) + 1 INTO l_id FROM menu_paginas;
    LOOP
      SELECT COUNT(*) INTO l_n FROM roles_paginas
       WHERE app_id = c_app_id AND app_page_id = l_id;
      EXIT WHEN l_n = 0;
      l_id := l_id + 1;
    END LOOP;
    RETURN l_id;
  END siguiente_pagina;

  PROCEDURE escribir_permiso(
    p_usuario IN VARCHAR2, p_pagina IN NUMBER,
    p_i IN VARCHAR2, p_u IN VARCHAR2, p_d IN VARCHAR2, p_c IN VARCHAR2, p_v IN VARCHAR2)
  IS
  BEGIN
    APEX_JSON.WRITE('usuario',    p_usuario);
    APEX_JSON.WRITE('pagina',     p_pagina);
    APEX_JSON.WRITE('insertar',   sn(p_i));
    APEX_JSON.WRITE('actualizar', sn(p_u));
    APEX_JSON.WRITE('borrar',     sn(p_d));
    APEX_JSON.WRITE('consultar',  sn(p_c));
    APEX_JSON.WRITE('ver_campos', sn(p_v));
  END escribir_permiso;

  /* ====================================================================== */
  /* MENU DEL USUARIO                                                       */
  /* ====================================================================== */

  ------------------------------------------------------------------------------
  -- TODAS las paginas de MENU_PAGINAS, con los permisos del usuario (todo 'N'
  -- si no tiene fila). Todas y no solo las permitidas: el front necesita saber
  -- que rutas estan controladas para cerrar las que el usuario no puede ver
  -- aunque llegue escribiendo la URL.
  ------------------------------------------------------------------------------
  PROCEDURE menu(p_token IN VARCHAR2) IS
    l_usuario VARCHAR2(255) := f_usuario(p_token);
  BEGIN
    IF l_usuario IS NULL THEN
      p_error(401, 'Unauthorized', 'Token invalido o expirado'); RETURN;
    END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT m.app_page_id, m.menu_principal, m.nombre_pagina, m.ruta,
               p.puede_insertar, p.puede_actualizar, p.puede_borrar,
               p.puede_consultar, p.ver_campos,
               MIN(m.app_page_id) OVER (PARTITION BY m.menu_principal) AS orden_menu
          FROM menu_paginas m
          LEFT JOIN roles_paginas p
            ON p.app_id = c_app_id
           AND p.app_page_id = m.app_page_id
           AND p.app_user_id = UPPER(l_usuario)
         ORDER BY orden_menu, m.app_page_id
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      escribir_permiso(UPPER(l_usuario), r.app_page_id, r.puede_insertar, r.puede_actualizar,
                       r.puede_borrar, r.puede_consultar, r.ver_campos);
      APEX_JSON.WRITE('menu_principal', r.menu_principal);
      APEX_JSON.WRITE('nombre_pagina',  r.nombre_pagina);
      APEX_JSON.WRITE('ruta',           r.ruta);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    -- admin_permisos: si ve Roles de paginas, por ROLES_PAGINAS (puede_permisos).
    -- admin_paginas: Crear paginas, fija (administra).
    APEX_JSON.WRITE('admin_permisos', CASE WHEN puede_permisos(l_usuario, 'C') THEN 'S' ELSE 'N' END);
    APEX_JSON.WRITE('admin_paginas',  CASE WHEN administra(l_usuario, 'PAGINAS')  THEN 'S' ELSE 'N' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END menu;

  /* ====================================================================== */
  /* PAGINAS (MENU_PAGINAS)                                                 */
  /* ====================================================================== */

  PROCEDURE paginas_listar(p_token IN VARCHAR2) IS
  BEGIN
    IF exigir(p_token, 'PAGINAS') IS NULL THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        SELECT m.app_page_id, m.menu_principal, m.nombre_pagina, m.ruta,
               (SELECT COUNT(*) FROM roles_paginas p
                 WHERE p.app_id = c_app_id AND p.app_page_id = m.app_page_id) AS permisos,
               MIN(m.app_page_id) OVER (PARTITION BY m.menu_principal) AS orden_menu
          FROM menu_paginas m
         ORDER BY orden_menu, m.app_page_id
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('pagina',         r.app_page_id);
      APEX_JSON.WRITE('menu_principal', r.menu_principal);
      APEX_JSON.WRITE('nombre_pagina',  r.nombre_pagina);
      APEX_JSON.WRITE('ruta',           r.ruta);
      APEX_JSON.WRITE('permisos',       r.permisos);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END paginas_listar;

  ------------------------------------------------------------------------------
  -- Alta (p_id NULL) o modificacion. En el alta el numero lo pone esta funcion
  -- (el ultimo de MENU_PAGINAS mas 1, ver siguiente_pagina) y la pagina se
  -- guarda SOLO en el menu: los permisos los da despues el administrador en
  -- Roles de paginas (08/10/2026; antes quien la creaba quedaba con todos).
  -- En la modificacion el numero NO cambia: es lo que une la pagina con sus
  -- permisos.
  ------------------------------------------------------------------------------
  PROCEDURE pagina_guardar(
    p_token          IN VARCHAR2,
    p_id             IN VARCHAR2,
    p_menu_principal IN VARCHAR2,
    p_nombre_pagina  IN VARCHAR2,
    p_ruta           IN VARCHAR2)
  IS
    l_yo     VARCHAR2(255);
    -- 32767: un texto mas largo romperia en la declaracion, antes del
    -- EXCEPTION. Los topes reales se validan abajo con mensaje.
    l_menu   VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_menu_principal, '\s+', ' '));
    l_nombre VARCHAR2(32767) := TRIM(REGEXP_REPLACE(p_nombre_pagina, '\s+', ' '));
    l_ruta   VARCHAR2(32767) := LOWER(TRIM(p_ruta));
    l_id     NUMBER := f_numero(p_id);
    l_actual VARCHAR2(200);
    l_n      PLS_INTEGER;
  BEGIN
    l_yo := exigir(p_token, 'PAGINAS');
    IF l_yo IS NULL THEN RETURN; END IF;

    IF p_id IS NOT NULL AND l_id IS NULL THEN
      p_error(400, 'Bad Request', 'Numero de pagina invalido'); RETURN;
    END IF;
    IF l_menu IS NULL OR LENGTH(l_menu) > 100 THEN
      p_error(400, 'Bad Request', 'El menu principal es obligatorio (hasta 100 caracteres)'); RETURN;
    END IF;
    IF l_nombre IS NULL OR LENGTH(l_nombre) > 200 THEN
      p_error(400, 'Bad Request', 'El nombre es obligatorio (hasta 200 caracteres)'); RETURN;
    END IF;
    -- Una ruta de src/routes: empieza con '/', sin espacios ni barra final.
    IF l_ruta IS NULL OR LENGTH(l_ruta) > 200
       OR NOT REGEXP_LIKE(l_ruta, '^/[a-z0-9][a-z0-9/_-]*$') OR l_ruta LIKE '%/' THEN
      p_error(400, 'Bad Request',
              'La ruta tiene que ser como /evaluaciones: empieza con /, en minusculas, '
              || 'sin espacios ni / al final'); RETURN;
    END IF;

    SELECT COUNT(*) INTO l_n FROM menu_paginas
     WHERE ruta = l_ruta AND (l_id IS NULL OR app_page_id <> l_id);
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'Ya hay una pagina con la ruta ' || l_ruta); RETURN;
    END IF;

    IF l_id IS NULL THEN
      -- El bloqueo es para que dos altas a la vez no calculen el mismo numero.
      LOCK TABLE menu_paginas IN EXCLUSIVE MODE;
      l_id := siguiente_pagina;
      INSERT INTO menu_paginas (app_page_id, menu_principal, nombre_pagina, ruta)
      VALUES (l_id, l_menu, l_nombre, l_ruta);
    ELSE
      BEGIN
        SELECT ruta INTO l_actual FROM menu_paginas WHERE app_page_id = l_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          p_error(404, 'Not Found', 'La pagina no existe'); RETURN;
      END;
      UPDATE menu_paginas
         SET menu_principal = l_menu, nombre_pagina = l_nombre, ruta = l_ruta
       WHERE app_page_id = l_id;
    END IF;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('pagina', l_id);
    APEX_JSON.WRITE('message', CASE WHEN p_id IS NULL THEN 'Pagina ' || l_id || ' creada'
                                    ELSE 'Pagina actualizada' END);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      ROLLBACK;
      p_error(409, 'Conflict', 'Ese numero o esa ruta ya estan en uso. Proba de nuevo.');
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END pagina_guardar;

  ------------------------------------------------------------------------------
  -- Solo una pagina sin permisos: borrarla con filas en ROLES_PAGINAS dejaria
  -- esas filas apuntando a nada, y si la pagina vuelve a crearse con otro numero
  -- no las recupera.
  ------------------------------------------------------------------------------
  PROCEDURE pagina_eliminar(p_token IN VARCHAR2, p_id IN VARCHAR2) IS
    l_id   NUMBER := f_numero(p_id);
    l_ruta VARCHAR2(200);
    l_n    PLS_INTEGER;
  BEGIN
    IF exigir(p_token, 'PAGINAS') IS NULL THEN RETURN; END IF;

    BEGIN
      SELECT ruta INTO l_ruta FROM menu_paginas WHERE app_page_id = l_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        p_error(404, 'Not Found', 'La pagina no existe'); RETURN;
    END;

    SELECT COUNT(*) INTO l_n FROM roles_paginas
     WHERE app_id = c_app_id AND app_page_id = l_id;
    IF l_n > 0 THEN
      p_error(409, 'Conflict', 'No se puede eliminar: ' || l_n || ' usuario(s) tienen '
                               || 'permisos sobre ella. Quitalos primero.'); RETURN;
    END IF;

    DELETE FROM menu_paginas WHERE app_page_id = l_id;
    COMMIT;
    ok('Pagina eliminada');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END pagina_eliminar;

  /* ====================================================================== */
  /* PERMISOS (ROLES_PAGINAS)                                               */
  /* ====================================================================== */

  -- Sin paginar: hoy son ~500 filas de pocos bytes.
  PROCEDURE listar(p_token IN VARCHAR2, p_usuario IN VARCHAR2) IS
    l_filtro VARCHAR2(50) := UPPER(TRIM(SUBSTR(p_usuario, 1, 50)));
  BEGIN
    IF exigir(p_token, 'PERMISOS') IS NULL THEN RETURN; END IF;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT * FROM roles_paginas
               WHERE app_id = c_app_id
                 AND (l_filtro IS NULL OR app_user_id = l_filtro)
               ORDER BY app_user_id, app_page_id) LOOP
      APEX_JSON.OPEN_OBJECT;
      escribir_permiso(r.app_user_id, r.app_page_id, r.puede_insertar, r.puede_actualizar,
                       r.puede_borrar, r.puede_consultar, r.ver_campos);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END listar;

  ------------------------------------------------------------------------------
  -- Los del workspace (con nombre) MAS los que tienen filas aunque ya no esten
  -- en el workspace: una fila huerfana tambien se tiene que poder borrar.
  ------------------------------------------------------------------------------
  PROCEDURE usuarios(p_token IN VARCHAR2) IS
  BEGIN
    IF exigir(p_token, 'PERMISOS') IS NULL THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (
        WITH ws AS (
          SELECT UPPER(user_name) AS usuario,
                 TRIM(TRIM(first_name) || ' ' || TRIM(last_name)) AS nombre,
                 'S' AS en_workspace
            FROM apex_workspace_apex_users
           -- La cuenta duena del workspace no es un usuario de la app: APEX
           -- tampoco la ofrecia en Crear Rol (pagina 3). Si tiene filas,
           -- igual aparece por rp, para poder borrarlas.
           WHERE UPPER(user_name) <> c_cuenta_duena
        ),
        rp AS (
          SELECT app_user_id AS usuario, COUNT(*) AS paginas
            FROM roles_paginas
           WHERE app_id = c_app_id
           GROUP BY app_user_id
        )
        SELECT NVL(ws.usuario, rp.usuario) AS usuario,
               ws.nombre,
               NVL(ws.en_workspace, 'N')   AS en_workspace,
               NVL(rp.paginas, 0)          AS paginas
          FROM ws FULL OUTER JOIN rp ON rp.usuario = ws.usuario
         ORDER BY 1
    ) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('usuario',      r.usuario);
      APEX_JSON.WRITE('nombre',       r.nombre);
      APEX_JSON.WRITE('en_workspace', r.en_workspace);
      APEX_JSON.WRITE('paginas',      r.paginas);
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END usuarios;

  ------------------------------------------------------------------------------
  -- El nombre de cada pagina que se puede permisar: las de la app nueva
  -- (MENU_PAGINAS, origen 'app') y las de APEX ('apex'). Si un numero esta en
  -- las dos, manda el de la app. Si la vista de APEX no se puede leer desde
  -- ORDS, vienen solo las de la app.
  ------------------------------------------------------------------------------
  PROCEDURE nombres_paginas(p_token IN VARCHAR2) IS
  BEGIN
    IF exigir(p_token, 'PERMISOS') IS NULL THEN RETURN; END IF;
    fijar_workspace;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('data');
    FOR r IN (SELECT app_page_id, nombre_pagina FROM menu_paginas ORDER BY app_page_id) LOOP
      APEX_JSON.OPEN_OBJECT;
      APEX_JSON.WRITE('pagina', r.app_page_id);
      APEX_JSON.WRITE('nombre', r.nombre_pagina);
      APEX_JSON.WRITE('origen', 'app');
      APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    BEGIN
      FOR r IN (SELECT a.page_id, a.page_name
                  FROM apex_application_pages a
                 WHERE a.application_id = c_app_id
                   -- Como el LOV de la pagina 3 de APEX: sin la 0 (global),
                   -- la 1 (Inicio, libre en el sitio) ni la 9999 en adelante
                   -- (login).
                   AND a.page_id NOT IN (0, 1)
                   AND a.page_id < 9999
                   AND NOT EXISTS (SELECT 1 FROM menu_paginas m
                                    WHERE m.app_page_id = a.page_id)
                 ORDER BY a.page_id) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('pagina', r.page_id);
        APEX_JSON.WRITE('nombre', r.page_name);
        APEX_JSON.WRITE('origen', 'apex');
        APEX_JSON.CLOSE_OBJECT;
      END LOOP;
    EXCEPTION
      WHEN OTHERS THEN NULL;  -- la respuesta ya esta abierta: solo las de la app
    END;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
  END nombres_paginas;

  PROCEDURE insertar(
    p_token      IN VARCHAR2,
    p_usuario    IN VARCHAR2,
    p_pagina     IN VARCHAR2,
    p_insertar   IN VARCHAR2,
    p_actualizar IN VARCHAR2,
    p_borrar     IN VARCHAR2,
    p_consultar  IN VARCHAR2,
    p_ver_campos IN VARCHAR2)
  IS
    l_usuario VARCHAR2(32767) := UPPER(TRIM(p_usuario));
    l_pagina  NUMBER := f_numero(p_pagina);
    -- En variables: sn() es privada y no se puede usar en el INSERT.
    l_i VARCHAR2(1) := sn(p_insertar);
    l_u VARCHAR2(1) := sn(p_actualizar);
    l_d VARCHAR2(1) := sn(p_borrar);
    l_c VARCHAR2(1) := sn(p_consultar);
    l_v VARCHAR2(1) := sn(p_ver_campos);
  BEGIN
    IF exigir(p_token, 'PERMISOS', 'I') IS NULL THEN RETURN; END IF;
    IF l_usuario IS NULL OR LENGTH(l_usuario) > 50 THEN
      p_error(400, 'Bad Request', 'El usuario es obligatorio (hasta 50 caracteres)'); RETURN;
    END IF;
    IF l_pagina IS NULL THEN
      p_error(400, 'Bad Request', 'La pagina tiene que ser un numero entero positivo'); RETURN;
    END IF;
    INSERT INTO roles_paginas (
      app_id, app_page_id, app_user_id,
      puede_insertar, puede_actualizar, puede_borrar, puede_consultar, ver_campos)
    VALUES (c_app_id, l_pagina, l_usuario, l_i, l_u, l_d, l_c, l_v);
    COMMIT;

    ok('Permiso agregado');
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      ROLLBACK;
      p_error(409, 'Conflict', l_usuario || ' ya tiene la pagina ' || l_pagina
                               || '. Modificala en vez de agregarla.');
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END insertar;

  PROCEDURE actualizar(
    p_token      IN VARCHAR2,
    p_usuario    IN VARCHAR2,
    p_pagina     IN VARCHAR2,
    p_insertar   IN VARCHAR2,
    p_actualizar IN VARCHAR2,
    p_borrar     IN VARCHAR2,
    p_consultar  IN VARCHAR2,
    p_ver_campos IN VARCHAR2)
  IS
    l_yo      VARCHAR2(255);
    l_usuario VARCHAR2(32767) := UPPER(TRIM(p_usuario));
    l_pagina  NUMBER := f_numero(p_pagina);
    l_i VARCHAR2(1) := sn(p_insertar);
    l_u VARCHAR2(1) := sn(p_actualizar);
    l_d VARCHAR2(1) := sn(p_borrar);
    l_c VARCHAR2(1) := sn(p_consultar);
    l_v VARCHAR2(1) := sn(p_ver_campos);
  BEGIN
    l_yo := exigir(p_token, 'PERMISOS', 'U');
    IF l_yo IS NULL THEN RETURN; END IF;

    -- ESTADISTICA_USER no se toca: ver el encabezado.
    UPDATE roles_paginas
       SET puede_insertar   = l_i,
           puede_actualizar = l_u,
           puede_borrar     = l_d,
           puede_consultar  = l_c,
           ver_campos       = l_v
     WHERE app_id = c_app_id AND app_page_id = l_pagina AND app_user_id = l_usuario;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'Ese permiso no existe'); RETURN;
    END IF;
    COMMIT;

    ok('Permiso actualizado');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END actualizar;

  PROCEDURE eliminar(p_token IN VARCHAR2, p_usuario IN VARCHAR2, p_pagina IN VARCHAR2) IS
    l_yo      VARCHAR2(255);
    l_usuario VARCHAR2(32767) := UPPER(TRIM(p_usuario));
    l_pagina  NUMBER := f_numero(p_pagina);
  BEGIN
    l_yo := exigir(p_token, 'PERMISOS', 'D');
    IF l_yo IS NULL THEN RETURN; END IF;

    DELETE FROM roles_paginas
     WHERE app_id = c_app_id AND app_page_id = l_pagina AND app_user_id = l_usuario;
    IF SQL%ROWCOUNT = 0 THEN
      p_error(404, 'Not Found', 'Ese permiso no existe'); RETURN;
    END IF;
    COMMIT;

    ok('Permiso quitado');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END eliminar;

  ------------------------------------------------------------------------------
  -- Copiar Roles (la pagina 19 de APEX, que alla es un modal de la 2): le da a
  -- p_hacia las paginas que tiene p_desde y el todavia no, con las mismas cinco
  -- banderas. Las que p_hacia ya tiene NO se tocan, igual que en APEX.
  --
  -- En el sitio no es una pagina aparte: es un dialogo de Roles de paginas, y
  -- lo usa quien administra permisos (exigir PERMISOS), como el resto.
  --
  -- Un solo INSERT ... SELECT y no un loop fila por fila como el de APEX: o
  -- se copian todas o ninguna. ESTADISTICA_USER no se copia (APEX tampoco).
  ------------------------------------------------------------------------------
  PROCEDURE copiar(p_token IN VARCHAR2, p_desde IN VARCHAR2, p_hacia IN VARCHAR2) IS
    l_desde VARCHAR2(32767) := UPPER(TRIM(p_desde));
    l_hacia VARCHAR2(32767) := UPPER(TRIM(p_hacia));
    l_n     PLS_INTEGER;
  BEGIN
    IF exigir(p_token, 'PERMISOS', 'I') IS NULL THEN RETURN; END IF;
    IF l_desde IS NULL OR l_hacia IS NULL THEN
      p_error(400, 'Bad Request', 'Faltan el usuario de origen y el de destino'); RETURN;
    END IF;
    IF LENGTH(l_hacia) > 50 THEN
      p_error(400, 'Bad Request', 'El usuario de destino tiene hasta 50 caracteres'); RETURN;
    END IF;
    IF l_desde = l_hacia THEN
      p_error(400, 'Bad Request', 'El origen y el destino son el mismo usuario'); RETURN;
    END IF;

    INSERT INTO roles_paginas (
      app_id, app_page_id, app_user_id,
      puede_insertar, puede_actualizar, puede_borrar, puede_consultar, ver_campos)
    SELECT a.app_id, a.app_page_id, l_hacia,
           a.puede_insertar, a.puede_actualizar, a.puede_borrar, a.puede_consultar, a.ver_campos
      FROM roles_paginas a
     WHERE a.app_id = c_app_id
       AND a.app_user_id = l_desde
       AND NOT EXISTS (SELECT 1 FROM roles_paginas b
                        WHERE b.app_id = a.app_id
                          AND b.app_page_id = a.app_page_id
                          AND b.app_user_id = l_hacia);
    l_n := SQL%ROWCOUNT;
    COMMIT;

    abrir_json;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('copiadas', l_n);
    APEX_JSON.WRITE('message', l_n || ' pagina(s) copiada(s) de ' || l_desde || ' a ' || l_hacia);
    APEX_JSON.CLOSE_OBJECT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_error(500, 'Internal Server Error', 'Error: ' || SQLERRM);
  END copiar;

END PKG_ROLES_PAGINAS_ETHOS;
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

  c_flags CONSTANT VARCHAR2(400) := '
        p_insertar   => :insertar,
        p_actualizar => :actualizar,
        p_borrar     => :borrar,
        p_consultar  => :consultar,
        p_ver_campos => :ver_campos';

  c_pagina CONSTANT VARCHAR2(400) := '
        p_menu_principal => :menu_principal,
        p_nombre_pagina  => :nombre_pagina,
        p_ruta           => :ruta';

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

  PROCEDURE plantilla(p_pattern IN VARCHAR2, p_priority IN NUMBER) IS
  BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'ethos', p_pattern => p_pattern,
                         p_priority => p_priority, p_etag_type => 'NONE');
  END plantilla;
BEGIN
  -- Se borra todo lo de una version anterior, incluido roles-paginas/mios, que
  -- reemplazo `menu`.
  FOR r IN (SELECT 'menu' AS p FROM dual
            UNION ALL SELECT 'menu-paginas' FROM dual
            UNION ALL SELECT 'menu-paginas/:id' FROM dual
            UNION ALL SELECT 'roles-paginas' FROM dual
            UNION ALL SELECT 'roles-paginas/mios' FROM dual
            UNION ALL SELECT 'roles-paginas/usuarios' FROM dual
            UNION ALL SELECT 'roles-paginas/paginas' FROM dual
            UNION ALL SELECT 'roles-paginas/copiar' FROM dual
            UNION ALL SELECT 'roles-paginas/:usuario/:pagina' FROM dual) LOOP
    FOR m IN (SELECT 'GET' AS v FROM dual UNION ALL SELECT 'POST' FROM dual
              UNION ALL SELECT 'PUT' FROM dual UNION ALL SELECT 'DELETE' FROM dual
              UNION ALL SELECT 'OPTIONS' FROM dual) LOOP
      BEGIN ORDS.DELETE_HANDLER('ethos', r.p, m.v); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    BEGIN ORDS.DELETE_TEMPLATE('ethos', r.p); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- Los literales con mas prioridad que cualquier patron con variables.
  plantilla('menu',                           0);
  plantilla('menu-paginas',                   0);
  plantilla('menu-paginas/:id',               1);
  plantilla('roles-paginas',                  0);
  plantilla('roles-paginas/usuarios',         2);
  plantilla('roles-paginas/paginas',          2);
  plantilla('roles-paginas/copiar',           2);
  plantilla('roles-paginas/:usuario/:pagina', 1);

  handler('menu', 'GET', '
    PKG_ROLES_PAGINAS_ETHOS.MENU(p_token => l_token);');

  handler('menu-paginas', 'GET', '
    PKG_ROLES_PAGINAS_ETHOS.PAGINAS_LISTAR(p_token => l_token);');

  handler('menu-paginas', 'POST', '
    PKG_ROLES_PAGINAS_ETHOS.PAGINA_GUARDAR(
        p_token => l_token,
        p_id    => NULL,' || c_pagina || ');');

  handler('menu-paginas/:id', 'PUT', '
    PKG_ROLES_PAGINAS_ETHOS.PAGINA_GUARDAR(
        p_token => l_token,
        p_id    => :id,' || c_pagina || ');');

  handler('menu-paginas/:id', 'DELETE', '
    PKG_ROLES_PAGINAS_ETHOS.PAGINA_ELIMINAR(p_token => l_token, p_id => :id);');

  handler('roles-paginas/usuarios', 'GET', '
    PKG_ROLES_PAGINAS_ETHOS.USUARIOS(p_token => l_token);');

  handler('roles-paginas/paginas', 'GET', '
    PKG_ROLES_PAGINAS_ETHOS.NOMBRES_PAGINAS(p_token => l_token);');

  handler('roles-paginas/copiar', 'POST', '
    PKG_ROLES_PAGINAS_ETHOS.COPIAR(
        p_token => l_token, p_desde => :desde, p_hacia => :hacia);');

  handler('roles-paginas', 'GET', '
    PKG_ROLES_PAGINAS_ETHOS.LISTAR(p_token => l_token, p_usuario => :usuario);');

  handler('roles-paginas', 'POST', '
    PKG_ROLES_PAGINAS_ETHOS.INSERTAR(
        p_token   => l_token,
        p_usuario => :usuario,
        p_pagina  => :pagina,' || c_flags || ');');

  handler('roles-paginas/:usuario/:pagina', 'PUT', '
    PKG_ROLES_PAGINAS_ETHOS.ACTUALIZAR(
        p_token   => l_token,
        p_usuario => :usuario,
        p_pagina  => :pagina,' || c_flags || ');');

  handler('roles-paginas/:usuario/:pagina', 'DELETE', '
    PKG_ROLES_PAGINAS_ETHOS.ELIMINAR(
        p_token => l_token, p_usuario => :usuario, p_pagina => :pagina);');

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('[OK]   Handlers de menu, menu-paginas y roles-paginas publicados.');
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
  preflight('menu');
  preflight('menu-paginas');
  preflight('menu-paginas/:id');
  preflight('roles-paginas');
  preflight('roles-paginas/usuarios');
  preflight('roles-paginas/paginas');
  preflight('roles-paginas/copiar');
  preflight('roles-paginas/:usuario/:pagina');
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
   WHERE object_name = 'PKG_ROLES_PAGINAS_ETHOS' AND object_type = 'PACKAGE BODY';
  IF l_estado = 'VALID' THEN
    DBMS_OUTPUT.PUT_LINE('[OK]   PKG_ROLES_PAGINAS_ETHOS compilado.');
    DBMS_OUTPUT.PUT_LINE('       GET    menu');
    DBMS_OUTPUT.PUT_LINE('       GET    menu-paginas');
    DBMS_OUTPUT.PUT_LINE('       POST   menu-paginas');
    DBMS_OUTPUT.PUT_LINE('       PUT    menu-paginas/:id');
    DBMS_OUTPUT.PUT_LINE('       DELETE menu-paginas/:id');
    DBMS_OUTPUT.PUT_LINE('       GET    roles-paginas?usuario=');
    DBMS_OUTPUT.PUT_LINE('       GET    roles-paginas/usuarios');
    DBMS_OUTPUT.PUT_LINE('       GET    roles-paginas/paginas');
    DBMS_OUTPUT.PUT_LINE('       POST   roles-paginas');
    DBMS_OUTPUT.PUT_LINE('       PUT    roles-paginas/:usuario/:pagina');
    DBMS_OUTPUT.PUT_LINE('       DELETE roles-paginas/:usuario/:pagina');
    DBMS_OUTPUT.PUT_LINE('       POST   roles-paginas/copiar');
  ELSE
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ROLES_PAGINAS_ETHOS quedo INVALID.');
    FOR e IN (SELECT line, text FROM user_errors
               WHERE name = 'PKG_ROLES_PAGINAS_ETHOS' ORDER BY type, sequence) LOOP
      DBMS_OUTPUT.PUT_LINE('        L' || e.line || ': ' || e.text);
    END LOOP;
  END IF;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    DBMS_OUTPUT.PUT_LINE('[ERROR] PKG_ROLES_PAGINAS_ETHOS no se creo.');
END;
/

-- Quien puede usar Roles de paginas en el sitio (la pagina de /permisos en
-- ROLES_PAGINAS, desde el 08/10/2026). Si no hay nadie, nadie puede dar
-- permisos desde el sitio: hay que cargarlos en APEX (pagina 2).
DECLARE
  l_n PLS_INTEGER := 0;
BEGIN
  FOR r IN (SELECT p.app_user_id, p.puede_insertar, p.puede_actualizar, p.puede_borrar
              FROM roles_paginas p
              JOIN menu_paginas m ON m.app_page_id = p.app_page_id
             WHERE p.app_id = 40587
               AND m.ruta = '/permisos'
               AND p.puede_consultar = 'S'
             ORDER BY p.app_user_id) LOOP
    l_n := l_n + 1;
    DBMS_OUTPUT.PUT_LINE('[OK]   Roles de paginas: ' || RPAD(r.app_user_id, 20)
                         || ' insertar ' || NVL(r.puede_insertar, 'N')
                         || ', actualizar ' || NVL(r.puede_actualizar, 'N')
                         || ', borrar ' || NVL(r.puede_borrar, 'N'));
  END LOOP;
  IF l_n = 0 THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] NADIE tiene Roles de paginas (pagina de /permisos) con '
                         || 'PUEDE_CONSULTAR = S.');
    DBMS_OUTPUT.PUT_LINE('       Nadie va a poder dar permisos desde el sitio. Cargalo en APEX, '
                         || 'pagina 2 (Roles de Usuarios).');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('[WARN] No se pudo revisar quien tiene Roles de paginas: ' || SQLERRM);
END;
/
