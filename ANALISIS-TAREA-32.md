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