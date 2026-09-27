# Oficina Virtual — análisis y mejoras propuestas

Fecha: 26 de septiembre de 2026 · Tarea #17 · Área: Análisis

## Resumen

La aplicación ya cubre el ciclo completo de trabajo: asignación, ejecución aislada, consultas, revisión, relevo y recuperación. La mejora de mayor valor es reforzar la fiabilidad de ese ciclo: proteger borradores, reconocer ejecuciones remotas sin respuesta y asegurar que adjuntos y eventos se procesen correctamente.

Se recomienda empezar por la fidelidad del resultado de las pruebas y la contención de archivos descargables; seguir con borradores, adjuntos y desconexiones. No hace falta cambiar de framework ni incorporar dependencias npm para estas propuestas.

## Alcance y evidencia

- Revisión estática de `server.js`, `db.js`, `runner.js`, `host.js`, `hostops.js`, `worker.js`, `status.js`, `council.js`, frontend y pruebas, repartida entre revisiones de backend y frontend.
- Ejecutado `node --no-warnings test.js` con Node **v22.19.0**: **TODO OK**, código de salida **0**. Incluye agentes falsos y un worker de prueba con datos temporales.
- Los hallazgos siguientes proceden del código; no se reprodujeron fallos en producción ni se realizaron pruebas interactivas de navegador. Pasar la suite actual no valida los escenarios nuevos propuestos.
- Solo se añadieron documentos. No se modificó lógica, no se añadieron dependencias y no se realizó despliegue ni push.

Las referencias de línea corresponden al código revisado. P1 = siguiente tanda de correcciones; P2 = mejora posterior. El esfuerzo es relativo: bajo = localizado; medio = varios flujos y pruebas; alto = coordinación entre servidor y worker.

## Fortalezas que conviene conservar

- Separación entre servidor, coordinación de agentes y operaciones en la máquina ejecutora.
- Worktrees por tarea, checkpoints y contexto de relevo documentados en README y cubiertos por la suite.
- SQLite con WAL y respaldos mediante `VACUUM INTO` (`db.js:12`, `status.js:195`).
- Pruebas integradas con agentes falsos, roles, cuota, reconexión y recuperación.
- Escape HTML centralizado, protección frente a respuestas de navegación obsoletas y recuperación de datos tras reconectar SSE (`public/app.js:222`, `public/app.js:273`).

## Mejoras priorizadas

### 1. P1 — Hacer fiable el resultado final de las pruebas

**Evidencia:** el bloque inicial de autenticación captura errores y solo los imprime (`test.js:60-76`). El contador `failed` se crea después (`test.js:82`); `TODO OK` y el código de salida dependen de ese contador (`test.js:645-646`).

**Impacto:** un fallo de ese bloque puede quedar fuera del resultado final si las pruebas posteriores pasan. En la ejecución realizada, el bloque de autenticación sí pasó.

**Propuesta:** integrar el bloque inicial en el mismo mecanismo de contabilización que el resto y garantizar salida distinta de cero ante errores de preparación.

**Aceptación:** introducir deliberadamente una aserción fallida de autenticación en una copia temporal de la suite: debe terminar con código no cero y sin `TODO OK`. La suite sin esa alteración debe seguir pasando.

**Esfuerzo:** bajo.

### 2. P1 — Validar el destino real de los archivos descargables

**Evidencia:** `readFileB64` comprueba un prefijo de ruta y después usa `statSync` y `readFileSync` (`hostops.js:128-133`), que siguen enlaces. La descarga se expone por el endpoint de archivos de tarea (`server.js:330-333`).

**Riesgo condicionado:** si existe un enlace dentro del sandbox que apunta fuera, la comprobación textual no garantiza que los bytes leídos pertenezcan al sandbox. No se ha probado una explotación ni acceso a archivos sensibles.

**Propuesta:** comprobar la pertenencia de la ruta real al directorio permitido y aplicar una política explícita sobre enlaces tanto al listar como al descargar. Reutilizar los criterios de normalización existentes; contemplar cambios del enlace entre validación y lectura.

**Aceptación:** con archivos sintéticos, permitir un archivo normal y rechazar `..`, enlaces y junctions hacia fuera. Ejecutar los casos de enlaces en plataformas que los permitan y registrar cualquier omisión de plataforma.

**Esfuerzo:** medio.

### 3. P1 — Preservar respuestas y adjuntos durante los refrescos

**Evidencia:** la bandeja sustituye su HTML completo al actualizar (`public/app.js:303`, `public/app.js:315`), también cada minuto (`public/app.js:340`). El panel captura valores antes de esperar una carga y luego reemplaza su DOM (`public/app.js:217-224`). La restauración trata los campos de archivo como cadenas (`public/app.js:236-242`).

**Impacto:** una respuesta de bandeja puede desaparecer; escribir durante una carga puede terminar restaurando un texto anterior. Reemplazar los selectores de archivos pierde la selección y restaurarles un valor no vacío puede generar una excepción.

**Propuesta:** conservar borradores por tarea/conversación y por URL de respuesta de bandeja; actualizar secciones sin reconstruir formularios activos. Mantener los controles de archivos vivos y excluirlos de la restauración de cadenas.

**Aceptación:** escribir durante una respuesta HTTP demorada, recibir eventos SSE y esperar el refresco periódico: conservar texto, foco y selección. Seleccionar un adjunto antes de refrescar y comprobar que sigue disponible para enviar.

**Esfuerzo:** medio.

### 4. P1 — Evitar reutilizar un adjunto distinto por tener igual tamaño

**Evidencia:** `putFiles` omite la escritura cuando ya hay un archivo con el mismo nombre y tamaño (`hostops.js:354-363`).

**Impacto:** dos adjuntos con nombre y longitud iguales pero contenido diferente pueden entregar al agente los bytes anteriores. También pueden colisionar nombres al normalizarlos.

**Propuesta:** identificar el archivo materializado mediante el ID del adjunto o un hash de contenido y definir cómo se presentan versiones con el mismo nombre al agente.

**Aceptación:** cargar dos archivos de igual nombre y tamaño, con contenidos sintéticos diferentes; cada referencia debe resolver al contenido correcto. Incluir colisiones tras normalizar nombres.

**Esfuerzo:** bajo a medio.

### 5. P1 — Acotar la espera cuando desaparece la máquina ejecutora

**Evidencia:** el timeout solicita `killRun`, pero la ejecución continúa esperando `exit` (`runner.js:338-344`). `runOp` convierte errores de comunicación en `false` (`host.js:65`). Al desconectar se rechazan RPC pendientes, pero no se cierran las ejecuciones activas; `hello` las reconcilia cuando vuelve la máquina (`host.js:88-115`).

**Impacto:** si la máquina no vuelve ni entrega `exit`, una ejecución puede permanecer activa y ocupar capacidad después del timeout. La recuperación al reconectar ya existe; falta acotar la espera sin reconexión.

**Propuesta:** registrar pérdida de comunicación y un plazo de reconciliación. Separar el cupo de ejecución del bloqueo de carpeta y de tarea/conversación, actualmente asociados a `active` (`runner.js:193-221`). Tras agotar el plazo, liberar el cupo lógico y conservar de forma persistente esos bloqueos y el estado de proceso desconocido hasta reconciliar. Antes de reanudar o relevar, comprobar que no siga ejecutándose en la máquina para evitar dos agentes escribiendo sobre la misma tarea. No presentar una solicitud de cancelación como confirmación de proceso terminado.

**Aceptación:** iniciar una ejecución remota, interrumpir la conexión sin enviar `exit`, superar el plazo y verificar el estado y la capacidad. Encolar otra tarea en la misma carpeta sin worktrees: debe seguir bloqueada, incluso tras reiniciar el servidor. Reconectar con el proceso aún vivo y comprobar que no se inicia un duplicado; liberar bloqueos solo tras confirmar terminación.

**Esfuerzo:** alto.

### 6. P2 — Hacer idempotente la recepción de eventos del worker

**Evidencia:** el worker reintenta un lote hasta recibir respuesta (`worker.js:35-41`); el receptor entrega cada evento sin identificador de deduplicación (`host.js:124-126`). La cola de salida está en memoria.

**Riesgo:** si el servidor procesa un lote y se pierde la respuesta, el reintento puede repetir logs o efectos del parser mientras siga registrado el manejador. Si el worker termina antes de enviar, sus eventos pendientes se pierden.

**Propuesta:** numerar eventos por ejecución, confirmar recepción y descartar duplicados; posteriormente persistir pendientes si se necesita recuperación tras reiniciar el worker. Definir límites de almacenamiento y orden de entrega.

**Aceptación:** procesar un lote, simular pérdida de la respuesta y reenviarlo; cada evento debe aplicarse una sola vez. Probar reinicio con eventos pendientes si se añade persistencia.

**Esfuerzo:** medio a alto.

### 7. P2 — Completar la navegación por teclado

**Evidencia:** el selector de carpetas navega mediante `div` con manejadores de clic (`public/core.js:170-174`); hay patrones semejantes en proyectos y bandeja (`public/views.js:521`, `public/views.js:535`, `public/app.js:327`).

**Propuesta:** usar enlaces para navegar y botones para acciones, conservando el estilo 8-bit y los listeners externos compatibles con CSP.

**Aceptación:** elegir carpeta, abrir proyecto y responder una consulta con Tab y Enter, con foco visible y nombres accesibles. Comprobar en navegador; añadir solo `role` no proporciona interacción de teclado.

**Esfuerzo:** bajo a medio.

### 8. P2 — Limitar el crecimiento de la consola en pantalla

**Evidencia:** las vistas de tarea y Cantina añaden líneas al DOM sin recorte (`public/views.js:681`, `public/views.js:836`).

**Riesgo:** ejecuciones extensas acumulan nodos y trabajo de renderizado. La magnitud del coste requiere medición; no se afirma una degradación medida.

**Propuesta:** mostrar una ventana limitada de líneas, agrupar inserciones y permitir consultar las anteriores. Respetar el desplazamiento cuando el usuario lee arriba.

**Aceptación:** emitir 10 000 líneas sintéticas; el DOM debe mantenerse dentro del límite definido, sin perder acceso al historial ni forzar saltos de desplazamiento.

**Esfuerzo:** medio.

## Orden de trabajo sugerido

1. **Confianza en la validación:** mejora 1; después usar esa suite como base para todas las correcciones.
2. **Protección de datos y trabajo del usuario:** mejoras 2, 3 y 4, en cambios pequeños con sus regresiones.
3. **Ejecución remota:** mejora 5 y luego 6, probando cortes de red y reconexión con procesos vivos.
4. **Uso cotidiano y sesiones largas:** mejoras 7 y 8.

La suite comprueba sintaxis del frontend (`test.js:86-89`), pero no ejecuta los flujos DOM anteriores. Extraer funciones de estado permite probarlas con `node:assert` sin dependencias; complementar con pasos reproducibles en navegador para archivos, foco y teclado. Cada cambio de lógica debe agregar o ajustar una prueba y terminar con `node --no-warnings test.js` en `TODO OK`.

Como mantenimiento posterior, separar secciones de rutas y vistas cuando una corrección lo requiera. Evitar una reorganización amplia antes de cubrir estos escenarios: el valor inmediato está en corregir comportamientos concretos.
