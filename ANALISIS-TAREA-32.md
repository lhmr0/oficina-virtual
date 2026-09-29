# Oficina Virtual — micro en la barra inferior (órdenes por voz)

Fecha: 29 de septiembre de 2026 · Tarea #32 · Área: Desarrollo
**Estado: implementado y probado** (`node --no-warnings test.js` → TODO OK).

## Resumen

Se añadió un **micro 🎤 en el dock inferior** que permite ejecutar acciones de la oficina solo con la
voz: crear tareas (proyecto, título, agente y área), lanzar consultas a la Cantina, navegar a las
secciones y buscar en el historial. El audio se transcribe con el **Whisper que ya corre en el
servidor 91** (`deploy/ia`, servicio `oficina-ia`) y la interpretación de la orden es **determinista
por reglas** sobre el vocabulario cerrado de la oficina, con una **tarjeta de confirmación** antes de
ejecutar nada.

**Conclusión del análisis:** para el alcance pedido **no hace falta un modelo de lenguaje local**.
El único modelo que se necesita (reconocimiento de voz) ya está desplegado en el 91. La comprensión de
la orden se resuelve con reglas + confirmación, sin RAM ni latencia extra. Al final se deja la receta
por si más adelante se quiere dictado totalmente libre.

## Cómo funciona

1. **🎤 en el dock** (solo aparece si `OFICINA_IA_URL` está configurado y el navegador puede grabar).
2. Pulsar → grabar; volver a pulsar → parar. El audio va a `POST /api/transcribe`, que lo reenvía al
   servicio de IA por una PC conectada (el VPS no ve la red interna; la PC sí).
3. El texto se interpreta con `public/voz.js` (`parseVoz`) contra los proyectos, agentes y áreas reales.
4. Se muestra una **tarjeta editable** con lo entendido y el botón de acción:
   - **Tarea** → proyecto, área, agente, título, instrucciones y «Ejecutar al crear».
   - **Chat** → agente, proyecto de contexto y mensaje → Cantina.
   - **Ir** → salta a la sección dicha (cantina, kanban, puente, consejo, archivos…).
   - **Buscar** → abre la búsqueda del historial con el texto dictado.
   - Si no se reconoce la orden, deja **crear tarea** o **enviar a la Cantina** con lo dictado.
5. Las tareas creadas por voz llevan la marca de dictado, así el agente sabe que el texto puede tener
   errores de transcripción (mismo aviso que el dictado en los cuadros de texto).

Ejemplos que entiende: «crea una tarea en el proyecto Oficina Virtual titulada arreglar el login para
el agente Codex», «nueva tarea en Solo notas: comprar pan», «abre la cantina», «muéstrame el kanban»,
«pregúntale a Claude si el servidor está en línea», «busca dictado por voz».

## Qué se tocó

| Archivo | Cambio |
|---|---|
| `public/voz.js` | **Nuevo.** Intérprete de órdenes (puro, sin DOM): reglas y extracción de proyecto/agente/área/título. |
| `public/core.js` | Helpers reutilizables `startRecording`, `stopRecording`, `isRecording` y `transcribir`; el dictado de los cuadros de texto los reutiliza. |
| `public/app.js` | Icono de micro, botón 🎤 en el dock y su cableado. |
| `public/views.js` | Panel `vozForm` y tarjeta de confirmación `pintarOrden`. |
| `server.js` | `POST /api/tasks` añade el aviso de dictado al `prompt` cuando llega `voz: true`. |
| `test-frontend.js` | Pruebas del intérprete (tarea, ir, chat, buscar y texto sin orden). |
| `test.js` | Prueba: una tarea creada por voz avisa al agente. |

## Análisis: ¿hace falta un modelo local?

La función tiene dos partes bien distintas:

1. **Voz → texto (STT).** Necesita un modelo, y ya está desplegado: `faster-whisper`
   (`large-v3-turbo`, español) en el contenedor `oficina-ia` del **servidor 91**, con tope de 4 CPU y
   6 GB. La oficina ya lo usaba para el dictado en los cuadros de texto; aquí solo se reutiliza. **No
   hay que desplegar nada nuevo.**

2. **Texto → acción (comprensión de la orden).** Aquí la pregunta es si hace falta un LLM local.
   Para el alcance pedido **no**: las órdenes son sobre un vocabulario cerrado y conocido (las
   secciones, los nombres de los proyectos, los agentes y las áreas ya están en la base de datos).
   Unas reglas deterministas lo resuelven sin coste, y una **pantalla de confirmación** cubre el caso
   de que la transcripción o la interpretación se equivoquen. Ventajas frente a un LLM:

   - **Sin RAM ni CPU extra** en el 91 (el STT ya consume; un LLM competiría por los mismos recursos).
   - **Latencia casi nula** y respuesta predecible.
   - **Probable** con pruebas automáticas (el intérprete es una función pura).
   - **Sin coste** de tokens y sin enviar nada a terceros.

   Cuándo sí convendría un LLM local: si se quiere dictado **totalmente libre** (frases largas,
   paráfrasis muy variadas, varias acciones en una misma orden) sin pasar por la tarjeta. Hoy siguen
   existiendo dos salidas sin LLM: la tarjeta siempre deja **crear la tarea** o **enviar el texto a un
   agente de la oficina** (Claude/Codex/…), que ya interpreta lenguaje natural y cobra su cuota.

### Si algún día se quiere el LLM local (opcional, no desplegado)

Receta para añadirlo al `oficina-ia` del servidor 91 sin romper lo actual:

- Añadir un servicio con **Ollama** o **llama.cpp** al `deploy/ia/compose.yaml`, con tope de CPU/RAM
  (`cpus`, `mem_limit`) y `restart: unless-stopped`, como ya tiene el servicio `ia`.
- Modelo recomendado, en español y que devuelva JSON: `Qwen2.5-3B-Instruct` (~2,5 GB en Q4) o `7B`
  (~5 GB). Con 4 hilos basta para clasificar una orden corta.
- Endpoint nuevo `POST /orden` en `deploy/ia/app.py` que devuelva **JSON** con
  `{accion, proyecto, agente, area, titulo, texto}` a partir de un prompt que incluya la lista de
  proyectos y agentes. Se activa con `OFICINA_IA_LLM=1`; si está apagado, la oficina sigue con reglas.
- En el cliente, si `parseVoz` no reconoce la orden (`accion: null`), pedir el fallback al servicio.

No se desplegó porque, para las órdenes actuales, las reglas + confirmación bastan y no añaden carga
al servidor. Queda como mejora futura.

## Pruebas

- `node --no-warnings test.js` → **TODO OK** (incluye las dos pruebas nuevas).
- `test-frontend.js` cubre el intérprete con ejemplos reales; `test.js` comprueba que una tarea
  creada con `voz: true` recibe el aviso de dictado.
- El botón solo aparece con el servicio de IA configurado; sin él, la oficina queda igual que antes.
## Comportamiento observado en la captura (prueba real) y corrección

En la captura, el dictado «Crea una tarea en el proyecto Oficina Virtual … no se encuentra el modelo
Sonnet 5.5 …» se interpretó como **Buscar** en vez de tarea. Causa: el intérprete buscaba los verbos
en cualquier parte del texto y evaluaba «buscar» antes que «tarea», así que la palabra «encuentra»
dentro de la frase activaba Buscar (y la tarjeta de búsqueda mostraba casi todo el dictado).

Corregido en `public/voz.js`: el verbo de la orden se detecta **al inicio** de la frase (una orden
puede mencionar «encuentra» o «consulta» por dentro), «tarea/misión» tiene prioridad y el título se
acota a 90 caracteres y nunca queda vacío. La frase exacta de la captura queda como prueba de
regresión en `test-frontend.js`.

Conclusión actualizada: las órdenes cortas y bien formadas («abre la cantina», «busca dictado por
voz», «crea una tarea en el proyecto X titulada Y para el agente Z») se resuelven bien con reglas; una
**orden larga y libre** como este dictado real deja un título que hay que editar a mano. Ese es
justamente el caso donde un LLM local (o mandar el texto a un agente) aportaría valor. La tarjeta de
confirmación evita que una interpretación errónea se ejecute sola.
## Segunda captura: campos del formulario y reparto título/descripción

Observado: al crear una tarea por voz, la tarjeta mostraba solo proyecto/área/agente/título/
instrucciones y «Ejecutar al crear», sin el resto de campos del formulario real (plantilla, carpeta,
prioridad, fecha límite, ejecutor, dependencias, adjuntos, modo, modelo/esfuerzo); y el título
absorbía parte de la descripción.

Corregido:
- La orden de tarea ya no usa una tarjeta propia: abre el **formulario real «Nueva tarea»**
  (`taskForm`) con proyecto, área, agente, título e instrucciones prellenados y la marca de voz. Así
  aparecen todos los campos y la experiencia es la de siempre.
- El intérprete separa título y descripción: reconoce «con el título … / la descripción sea …» y, si no
  hay marcadores, usa la primera frase como título (acotado a 90 caracteres) y el resto como
  descripción (antes tropezaba con decimales tipo «5.5»).
## Verificación tras el push (integración en master) — hallazgo importante

Estado verificado:
- Rama `oficina/task-32-ordenar` (HEAD 72c4631): árbol limpio y **con todo** (fix 1 «tarea vs
  buscar» + fix 2 «formulario completo + título/descripción»). `node --no-warnings test.js` -> TODO OK.
- No hay remotos git (`git remote -v` vacío): el «push» es la integración interna de la oficina en
  `master`.
- `master` (27e78bf) integró las tareas #29/#33/#34 y, al resolver el conflicto, **renombró mi
  intérprete** `public/voz.js` -> `public/ordenes.js` y dejó el nombre `public/voz.js` para OTRA
  función de voz (avisos hablados: `announce`/responder hablando, con `public/comandos.js`).

Consecuencia (el punto que pediste verificar):
- `master:public/ordenes.js` es mi intérprete **en la versión de 48ba3af**: trae el fix 1
  (`const arranque`) pero **NO** el fix 2 (no tiene `separar` ni `descripcion`).
- `master:public/views.js` sigue con la tarjeta mínima de tarea (sin `taskForm` completo ni marca
  `voz`). Es decir: en `master` **persiste lo que reportaste** (faltan campos y mal reparto
  título/descripción).
- Si se fusiona mi rama tal cual, habrá conflicto en `public/voz.js` (yo lo tengo ahí; master lo usa
  para la otra función) y el fix 2 no entrará solo: hay que llevarlo a `public/ordenes.js`.

Recomendación: alinear la rama con el layout de `master` (mi intérprete como `public/ordenes.js` y
`voz.js` reservado para la otra función) y apuntar el import de `views.js` a `ordenes.js`. Así el
merge conserva las dos funciones de voz y no se pierde el fix 2.

Despliegue: el VPS corre el contenido de 48ba3af (solo mi función de voz, sin fix 2); la otra función
de voz todavía no está desplegada. El script despliega el HEAD de este worktree (la rama).