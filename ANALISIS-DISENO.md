# Oficina Virtual — análisis de diseño y backlog de mejoras (documento vivo)

Fecha: 29 de septiembre de 2026 · Área: Diseño / UX

## Cómo usar este documento

- Cada mejora tiene un **ID** (`A1`, `B3`…) y un **estado**: `pendiente` · `en curso` · `hecha` · `descartada`.
- Para añadir una: agrégala al final de su sección con el siguiente número libre, con evidencia (`archivo:línea` o captura), propuesta, impacto y esfuerzo.
- Impacto: **alto** = cambia cómo se trabaja a diario · **medio** = mejora clara · **bajo** = pulido. Esfuerzo: **S** = CSS o pocas líneas · **M** = una vista · **L** = varias vistas o servidor.

## Alcance y evidencia

- Captura de la Estación (tema crema, escritorio ~1665 px) y lectura completa de `public/` (`index.html`, `style.css`, `app.js`, `core.js`, `views.js`).
- No se probó en navegador en vivo ni en móvil real: los hallazgos de móvil salen del CSS (`@media (max-width: 820px)`).
- Solo documento: no se tocó código.

## Resumen

La metáfora (oficina pixel-art, salas por área, agentes en el pasillo) funciona y tiene identidad. Los problemas son tres, en este orden:

1. **Lo que exige al humano está disperso**: la franja «Necesita atención» ya existe, pero está oculta en escritorio. Además, para responder una consulta hay que cambiar de pestaña.
2. **El espacio está mal repartido**: el mapa se lleva ~75 % del alto aunque esté vacío, y el tablero, los repositorios y las ejecuciones quedan apretados con letra de 7 a 11 px.
3. **El sistema visual no tiene reglas**: 11 tamaños de letra, 6 colores de botón sin jerarquía, tres lenguajes de iconos y 157 estilos en línea en `views.js`.

Hay además 5 fallos concretos de interfaz (sección K) que conviene corregir aunque no se haga nada más.

## Dirección propuesta (referentes)

| Tomar de | Qué | Dónde aplica |
|---|---|---|
| **Linear** (Inbox / Triage) | Una sola cola de «lo que te toca», con acción directa por ítem y atajos de teclado | A1, A2, E2 |
| **GitHub** (checks de PR) | Estado con ícono + texto (✓ / ✗ / ●), agrupado por PR, con el motivo del fallo visible | D1, D2 |
| **Vercel** (deployments) | Tarjeta de despliegue con último deploy, commit, duración y enlace al log | D5 |
| **Gather** (ya es la base) | Mapa como ambiente, pero la información operativa va en paneles, no en el mapa | B1–B5 |
| **Trello / GitHub Projects** | Columnas vacías plegadas; «Hecho» limitado a los últimos N | C1, C2 |

Principio rector: **el mapa comunica estado de un vistazo; las decisiones se toman en paneles con texto legible.**

---

## A. Atención y flujo de decisión

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| A1 | La franja «Necesita atención» existe (`views.js:382-384`), pero se oculta en escritorio: `@media (min-width: 821px) { .attention { display: none } }` (`style.css:676`). En escritorio, lo que te toca queda repartido entre el «!» del escritorio, «1 pend.», la columna Revisión, Bandeja y el punto rojo de Ejecuciones | Quitar esa regla y mostrar la franja arriba del mapa también en escritorio | alto | S | hecha: en la barra superior, junto al logo |
| A2 | La franja no incluye **permisos pendientes** (modo supervisado) ni ejecuciones fallidas de chats; solo toma estados de tareas y chats `esperando` (`views.js:382-383`) | Añadir los permisos con botones Aprobar/Denegar en línea, igual que en Bandeja (`app.js:324`) | alto | M | hecha |
| A3 | Los ítems de la franja solo navegan. La Bandeja sí permite responder y aprobar sin abrir la tarea (`app.js:321-327`) | Acciones rápidas en la franja: «Responder» (abre un campo en línea) y «Aprobar» (abre `approveDialog`) | medio | M | hecha: «✔ Aprobar» en línea; responder abre la tarea con la caja ya visible (E1) |
| A4 | Las burbujas sobre los agentes (`?` espera, `!` revisión, `…` en cola, `Zz` sin cuota; `views.js:221`) no tienen leyenda y usan pixel de 8-9 px (`style.css:327-328`) | Añadir `aria-label`/tooltip con texto («Espera tu respuesta») y una leyenda plegable en el pasillo | medio | S | hecha: leyenda en el pasillo (escritorio) y texto al pasar el mouse |
| A5 | Los avisos de permiso tienen `ms: 0` (`app.js:273`): se acumulan en la esquina hasta que alguien los atiende y tapan el tablero | Tope de 3 avisos visibles y el resto agrupado en «+N en Bandeja» | medio | S | hecha |
| A6 | El contador de Bandeja suma revisiones, pero el título de la pestaña no (`app.js:303-306`). Son dos números distintos para la misma idea | Unificar: el mismo número en campana, título y favicon, o separar visualmente «preguntas» y «revisiones» | bajo | S | hecha |

## B. Estación (mapa)

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| B1 | Reparto fijo 3:1 entre mapa y tablero (`style.css:699` `flex: 3` / `style.css:758` `flex: 1`), aunque las salas estén vacías. Cada sala dibuja siempre 3 escritorios vacíos (`views.js:309`) | Con salas vacías, mostrar «3 libres» en texto y bajar el alto de la fila de salas; reparto 2:1.3 o dinámico según haya tareas activas | alto | S–M | hecha: reparto 2 : 1,3 |
| B2 | Códigos decorativos `[DOC-01]`, `[DEV-02]`, `[CMD-01]` (`views.js:267`) ocupan la placa sin aportar información (en móvil ya se ocultan, `style.css:620`) | Quitarlos también en escritorio | bajo | S | hecha |
| B3 | 5-6 adornos por sala en la franja de pared (`views.js:260-265`), animados (`deco-holo`, `deco-arcade`), compitiendo con la placa y el badge «pend.» | Máximo 2 adornos por sala en escritorio (ya se hace en móvil: `style.css:649`) | medio | S | hecha |
| B4 | La etiqueta del escritorio corta el título en 1 línea a 76 px (`style.css:319`): «Validación», «Laya vs Tr…». Solo se lee con el `title` al pasar el mouse | Mostrar `#id` y agente como primera línea y el título en 2 líneas; ancho 96 px | medio | S | hecha |
| B5 | Movimiento constante: el droide patrulla (`mousePatrol` infinito), los avatares botan (`avatarIdle`), las burbujas saltan (`bob`), las tazas humean, el holo pulsa. Todo compite con los cambios de estado reales | Animar solo lo que cambia: el agente que trabaja y la burbuja que pide algo. El resto, estático. `prefers-reduced-motion` ya está bien resuelto (`style.css:805`); mantenerlo | medio | S | hecha |
| B6 | Pasillo de 120-132 px de alto (`style.css:331, 742`) para 5 avatares con etiquetas de 8-10 px | Bajarlo a ~96 px y subir la letra de estado (ver G1) | bajo | S | hecha: 112 px |
| B7 | Cantina: «Últimas consultas» queda pegado o bajo la placa en la captura; el padding superior del desktop (`style.css:738`) no deja aire | Margen superior para `.room-info` dentro de `.stools` | bajo | S | hecha |
| B8 | El Consejo con sesión previa muestra el resultado pero no ofrece acción; el estado vacío dice «Convoca uno» sin botón (`views.js:328-330`) | Botón «Convocar» en la sala, aunque toda la sala ya sea clicable | bajo | S | hecha |
| B9 | «Más salas (2)» esconde Puente de Mando y Archivos dentro de un modal del mapa (`views.js:355, 591`); el número no dice si alguna sala oculta tiene actividad | Badge de actividad («1 en curso») en el botón; si hay áreas extra con tareas, avisar | bajo | S | hecha |
| B10 | El pasillo (flechas, lámparas, droide) no parece una oficina y los agentes solo decían «Disponible/Trabajando». Cantina y Consejo ocupaban una fila entera del mapa con poca información | **Sala de agentes**: un puesto por agente con monitor del color de su estado, qué hace y en qué tarea («Espera tu respuesta · #4…», «En la Cantina · …», «Sin cuota · vuelve en 2 h») y barra de cuota; tu puesto muestra cuánto tienes por decidir y abre la Bandeja. Cantina y Consejo pasan a «Más salas» (siguen en el dock y el menú) | alto | M | hecha |

## C. Tablero Kanban

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| C1 | 7 columnas siempre del mismo ancho (`minmax(170px, 1fr)`, `style.css:776`), aunque 5 estén vacías («Sin tareas») | Columnas vacías plegadas a una tira vertical de ~40 px con nombre y 0; se expanden al arrastrar encima (`dragover`) | alto | M | hecha |
| C2 | «Completada» acumula todo (25 en la captura) y es la única columna con scroll | Mostrar las últimas 5 y un enlace «Ver las 25» a Archivos → Tareas filtrado | alto | S | hecha |
| C3 | «Esperando» y «Revisión» son la cola del humano, pero su cabecera se ve igual que las demás (`style.css:472`) | Cabecera con color y contador destacados cuando tienen tareas | medio | S | hecha |
| C4 | La tarjeta repite el área tres veces: borde izquierdo con su color, chip con el alias y color de sala (`views.js:166-167`). La prioridad usa otro color más. Hay 4 señales de color en una tarjeta de 60 px | El borde indica **estado de atención** (o prioridad) y el área va solo como chip. Una regla de color por tarjeta | medio | S | hecha |
| C5 | Letra de tarjeta: título 11 px, meta 10 px, chips 9 px con alto de 13 px (`style.css:482-485`) | Título 13 px, meta 11 px, chips 11 px | alto | S | hecha |
| C6 | Solo «En curso» muestra tiempo (`views.js:170`). En Revisión no se sabe cuánto lleva esperando tu aprobación | «hace 4 h» en Revisión y Esperando; en rojo si pasa de 24 h | medio | S | hecha |
| C7 | Soltar en «Atascadas» no cambia nada: mantiene el estado y solo reordena (`views.js:212`). Es un destino que engaña | Marcar la columna como no soltable (sin `.over`) | bajo | S | hecha |
| C8 | «Filtros ↗» (`views.js:423`) no dice que abre el tablero completo | Renombrarlo «Tablero completo ↗» | bajo | S | hecha |
| C9 | Las tarjetas son `div` con `tabindex=0` sin `role` (`views.js:166`). No admiten clic central ni «abrir en pestaña nueva», y moverlas por teclado solo es posible en pantallas táctiles (`.kmove`, `style.css:481`) | Envolver el título en `<a href="#/tarea/N">`; mostrar `.kmove` también en `:focus-within` | medio | S | hecha |
| C10 | «+ Tarea» duplicado (cabecera del tablero `views.js:422` y dock `app.js:97`) | Dejar solo el del dock, o cambiar el del tablero por «+ en este proyecto» cuando hay filtro | bajo | S | hecha |

## D. Repositorios y Ejecuciones (panel lateral)

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| D1 | Ejecuciones lista corridas sueltas: en la captura, «CommandCode #32 Ordenar» aparece 3 veces (`views.js:359`) | Agrupar por tarea o chat: «#32 Ordenar · 3 intentos · último ✗ 37 s» | alto | S | hecha |
| D2 | El estado es un punto de color (`views.js:366`) y no se muestra el motivo de fin (`end_reason`) | Ícono + texto: «✓ listo», «✗ cuota», «✗ error», «● en curso» | alto | S | hecha |
| D3 | Los tokens salen crudos («1.494.167 tok», `views.js:375`) y en 10 px | Formato compacto «1,5 M tok» y costo si existe (`cost_usd`) | bajo | S | hecha |
| D4 | La meta de cada repo son 5 datos en una sola línea de 10 px, con un botón-enlace dentro (`views.js:523`) | Filas cortas: *Sincronía* ↑0 ↓0 · *Local* 3 sin commit [Revisar] · *Ramas* 0 · *Despliega en* VPS | medio | S | hecha |
| D5 | Desplegar es un 🚀 sin texto (`views.js:528`) y usa el amarillo de la acción principal (`.btn.y`), el mismo color que «+ Tarea». La acción más delicada tiene el color más «invitante» | «🚀 Desplegar» con estilo de advertencia (naranja con contorno). Mostrar «último despliegue hace X · commit abc» | alto | S–M | hecha |
| D6 | **El panel se recarga y parpadea con cada refresco del mapa**: `render` reescribe `innerHTML` con «Cargando…» y llama a `loadRepos` (`views.js:400, 440`). El mapa se refresca con cada `task.updated`, `run.started`, etc. (`views.js:275`), lo que dispara consultas git en la máquina por cada evento | Pintar desde el caché `REPOS` al instante y refrescar en segundo plano con un mínimo de 30 s entre consultas (o solo con ⟳) | alto | S | hecha |
| D7 | Ancho fijo de 280 px (`style.css:202, 746`) para repos con ramas, conflictos y botones | 320 px, o un panel «Repositorios» propio a pantalla completa (ver I1) con resumen en la barra | medio | M | hecha: 320 px + vista Repositorios |

## E. Vista de tarea (panel lateral)

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| E1 | **Responder a una consulta exige cambiar de pestaña.** El panel amarillo «El agente espera tu respuesta» muestra la pregunta (`views.js:841`), pero la caja de respuesta solo existe en la pestaña Chat (`views.js:864`). La pestaña por defecto es Consola y además es global (`S.taskTab`, `views.js:817`) | Poner la caja de respuesta (con 🎤) dentro del panel amarillo; o forzar la pestaña Chat cuando el estado es `esperando` | alto | S | hecha |
| E2 | Hasta 10 botones en fila con 6 colores (`views.js:828-837`). «⇄ Pasar a otro» usa el azul por defecto y compite con «▶ Ejecutar» | Una acción principal según el estado (Ejecutar / Aprobar / Responder), 2 secundarias y el resto en un menú «⋯» (Editar, Descomponer, ¿Qué mejorarías?, Eliminar) | alto | M | hecha |
| E3 | 8-10 chips iguales en la cabecera: área, agente, modelo·esfuerzo·modo, prioridad, carpeta, máquina, rama, fecha, autor (`views.js:822-826`) | Línea de metadatos en texto secundario y chip solo para lo que alerta: modo **Editar** (sin sandbox) en naranja y máquina desconectada en rojo | medio | S | hecha |
| E4 | La pestaña elegida se conserva al abrir otra tarea (`S.taskTab` global): abres una tarea nueva y aparece «Historial» | Recordar la pestaña por tarea, o volver a la más útil según el estado | bajo | S | hecha |
| E5 | En el diff, todos los archivos abren expandidos (`<details open>`, `views.js:793`) | Expandir solo los primeros 3; el resto plegados con su +/- visible | bajo | S | hecha |
| E6 | Los paneles de estado usan pixel de 9 px en mayúsculas («RESUMEN DEL AGENTE», `views.js:841-845`) | Inter 600 12 px en mayúsculas (ver G2) | medio | S | hecha |

## F. Otras vistas

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| F1 | Nueva consulta en la Cantina: el mensaje, que es lo principal, va al final, después de agente, modelo, esfuerzo, modo, proyecto, máquina y carpeta (`views.js:976-984`) | Mensaje primero y agente al lado; el resto plegado en «Opciones» con sus valores por defecto visibles | alto | S | hecha |
| F2 | Formulario de tarea con 13 campos a la vista (`views.js:87-108`). «Depende de» es un `<select multiple size=4>` que exige Ctrl+clic | Título, Instrucciones y Agente visibles; lo demás en «Más opciones». Dependencias como lista con casillas y buscador | medio | M | hecha |
| F3 | Convocar al Consejo: tres `<select multiple size=3>` (proyectos, áreas, agentes) (`views.js:1137-1139`) | Casillas o chips seleccionables | medio | S | hecha |
| F4 | El filtro de Archivos tiene un campo libre «estado/tipo» (`views.js:1206`) que obliga a conocer los valores internos | `<select>` con los valores válidos de cada pestaña | bajo | S | hecha |
| F5 | El tema se elige en tres lugares: interruptor del menú (`app.js:109`), Configuración → Apariencia (`views.js:1392`) y Mi perfil (`views.js:1426`). Los nombres tampoco coinciden: «blanco (Hoth)» (`views.js:1100`), «Crema / Hueso (Tatooine)», «crema (Tatooine)» | Dejar el interruptor del menú y Apariencia; quitarlo de Mi perfil; un solo nombre | bajo | S | hecha |
| F6 | Marcación (SICAPE) vive en Mi perfil (`views.js:1453`); no tiene que ver con el perfil | Moverla a su propia entrada del menú o a Puente de Mando | bajo | S | descartada: es del usuario; Mi perfil es razonable |

## G. Sistema visual

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| G1 | 11 tamaños de letra: 7, 8, 9, 10, 11, 12, 13, 14, 16, 17 y 20 px. En producción hay texto de 7 px (`.plaque b` en móvil, `style.css:619`) y 8-9 px (lim-badge, avatar-status, chips) | Escala de 5 tokens: `--fs-xs: 11px`, `--fs-sm: 12px`, `--fs-md: 14px`, `--fs-lg: 16px`, `--fs-xl: 20px`. Nada bajo 11 px (VT323 nunca bajo 16 px) | alto | M | hecha: --fs-xs/sm/md/base (11-14 px); pixel y VT323 aparte |
| G2 | Press Start 2P en `h3` a 9 px (`style.css:80`) y en rótulos de panel a 9 px. Una fuente pixel a 9 px es ilegible | Pixel solo en `h1`, `h2`, nombres de sala y logo, a ≥10 px. `h3` y rótulos en Inter 600 | alto | S | hecha |
| G3 | `.btn` por defecto se pinta de azul holo (`style.css:99`): cualquier botón sin clase parece importante. Hay 6 variantes (azul, y, g, r, o, ghost) sin regla de uso | Jerarquía: **primario** amarillo (1 por vista), **secundario** ghost (defecto), **éxito** verde (aprobar/fusionar), **peligro** rojo (eliminar/abortar), **advertencia** naranja con contorno (desplegar/push). El azul queda como secundario-ghost | alto | M | hecha |
| G4 | Tres lenguajes de iconos: SVG de línea (dock, menú), sprites pixel (mapa) y emoji (🚀 🔍 📁 📅 ⛓ 🖥 📎 🔊 🎤 ⏱ ⎇ 📡) en la interfaz operativa | Pixel para el mundo (mapa), SVG de línea para acciones y controles, emoji solo en contenido (mensajes y títulos del usuario) | medio | M | hecha: iconos de línea en controles y etiquetas; quedan 🎤 del dictado (cambia de estado) y los mensajes de ambiente del mapa |
| G5 | 157 atributos `style="…"` en línea en `views.js` y 17 colores hex fijos (`MON`, lámparas, `#46529a`…); `color:var(--red)` se repite a mano | Clases utilitarias mínimas (`.t-red`, `.t-green`, `.t-orange`, `.mt-10`) y colores de estado como tokens (`--st-en_curso`, etc.) | medio | M | parcial: colores de estado como clases (.t-red…); los márgenes sueltos quedan en línea, moverlos no cambia nada visible |
| G6 | Tres paletas de estado distintas para lo mismo: `MON` del monitor (`views.js:220`), `.st-*` de chips (`style.css:120-123`) y lámparas de consola (`views.js:592`) | Una sola paleta de estado en tokens CSS, usada por los tres | bajo | S | hecha: los sprites leen --green/--yellow… del tema activo |

## H. Accesibilidad

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| H1 | El texto por debajo de 11 px es lo que más afecta la lectura (ver G1). VT323 a 9 px (`.lim-badge`, `style.css:345`) queda en ~5 px de alto real | Cubierto por G1; la cuota del pasillo puede ser una mini barra de 4 px con tooltip | alto | S | hecha |
| H2 | Estado solo por color: puntos de Ejecuciones y `.dot` del Puente | Siempre ícono o texto al lado (D2) | medio | S | hecha |
| H3 | Los permisos llegan como aviso con `aria-live="polite"` (`index.html:18`): un lector de pantalla puede leerlos tarde | Contenedor aparte con `role="alert"` solo para permisos | bajo | S | hecha |
| H4 | Objetivos pequeños: 🔍 en línea con el texto (`views.js:523`), ✕ de Ejecuciones y `.btn.sm` con 4×8 px de padding (`style.css:107`) | Mínimo 24×24 px (WCAG 2.2 AA) | medio | S | hecha |
| H5 | Bien resuelto y a conservar: `:focus-visible` global (`style.css:104`), etiquetas enlazadas con `linkLabels` (`core.js:141`), diálogos nativos, reducción de movimiento | — | — | — | — |

## I. Móvil

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| I1 | En móvil, Repositorios y Ejecuciones desaparecen por completo (`.station-aside { display: none !important }`, `style.css:652`). Desde el celular (el README lo presenta como uso normal vía VPS) no se puede fusionar, hacer push ni desplegar | Vista `#/repos` en el panel lateral, accesible desde el menú y la paleta Ctrl+K; en escritorio la barra lateral queda como resumen | alto | M | hecha: menú → Repositorios |
| I2 | Placa de sala a 7 px, etiquetas de avatar y estado a 8 px (`style.css:619, 637, 646`) | Cubierto por G1 | alto | S | hecha |
| I3 | Kanban a 82 vw por columna (`style.css:672`): 7 deslizamientos para recorrerlo, 5 de ellos a columnas vacías | C1 resuelve la mayor parte; en móvil, además, pestañas por columna con contador | medio | M | hecha: pestañas por columna + desplazamiento por columna |

## J. Rendimiento percibido

| ID | Problema (evidencia) | Propuesta | Impacto | Esf. | Estado |
|---|---|---|---|---|---|
| J1 | Cada refresco del mapa pide 4 endpoints más repos (`views.js:277-282`, `440`) y reescribe todo con `innerHTML`: se pierden el scroll de las columnas del kanban y de la barra lateral, y el foco del teclado | Guardar y restaurar el `scrollTop` de `.kcol-body`, `.station-aside-body` y `.repo-body` (ya existe la idea en `snapshot/restore`, `app.js:241-250`); D6 para repos | alto | S | hecha |
| J2 | `/api/tasks` trae también todas las completadas en cada refresco | Cuando C2 limite Completada a 5, pedir solo las últimas N al servidor | bajo | M | descartada: con cientos de tareas el costo es mínimo; revisar si llegan a miles |

## K. Fallos de interfaz encontrados en la revisión

| ID | Fallo (evidencia) | Arreglo | Esf. | Estado |
|---|---|---|---|---|
| K1 | En Configuración, al elegir un tema, `tb.textContent = 'Tema: …'` **reemplaza el contenido del botón del menú** «Tema oscuro»: se pierden el ícono y el interruptor (`views.js:1575-1576`) | Actualizar solo `aria-checked` del botón, como hace el menú (`app.js:135`) | S | hecha |
| K2 | El manejador de clics del Consejo contiene código copiado de Configuración para temas y avatares, que ahí no existen (`views.js:1089-1113`). Además usa `$(…).forEach` (un solo elemento), que fallaría si se ejecutara | Borrar ese bloque | S | hecha |
| K3 | La barra lateral empieza oculta si no hay ejecuciones recientes (`views.js:380`), y **con ella se oculta Repositorios** (misma `aside`, `views.js:397`). Sin corridas recientes no se ven repos, ramas pendientes ni el botón de desplegar | Decidir la visibilidad por separado, o que el plegado inicial solo aplique a Ejecuciones | S | hecha |
| K4 | El panel de repos parpadea «Cargando…» y consulta git en cada evento del mapa | Ver D6 | S | hecha |
| K5 | `$('#meTheme', el)` apunta a un elemento que ya no existe (`views.js:1517`) | Borrar la línea | S | hecha |

---

## Plan sugerido

**Tanda 1: arreglos rápidos (casi todo CSS o pocas líneas, ~1 sesión)**
K1–K5 · A1 · B2 · B3 · C2 · C5 · C7 · C8 · D1 · D2 · D5 (texto y color) · E1 · G2 · J1

**Tanda 2: estructura (varias vistas)**
G1 (escala tipográfica) · G3 (jerarquía de botones) · B1 (reparto mapa/tablero) · C1 (columnas plegables) · C4 · E2 · E3 · F1 · D6/D7 · I1 (vista Repositorios)

**Tanda 3: pulido y consistencia**
A2–A6 · B4–B9 · C3 · C6 · C9 · C10 · E4–E6 · F2–F6 · G4–G6 · H1–H4 · I3 · J2

## Criterios de aceptación globales

- En la captura de referencia (1665×976), el tablero muestra al menos 2 tarjetas por columna activa sin scroll interno.
- Ningún texto de la interfaz queda por debajo de 11 px (`grep -E "font(-size)?:[^;]*\b([0-9]|10)px"` sin resultados fuera de adornos).
- Responder a un agente que espera se hace sin cambiar de pestaña ni de vista.
- Cualquier estado de ejecución se entiende sin ver colores (texto o ícono).
- Con la barra lateral abierta, un refresco del mapa no produce el parpadeo de «Cargando…» en Repositorios.
