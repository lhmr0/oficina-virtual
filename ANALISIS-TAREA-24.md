# Oficina Virtual — mejoras de rendimiento, reanudación y Cantina

Fecha: 27 de septiembre de 2026 · Tarea #24 · Área: Análisis
**Estado: los 8 hallazgos están implementados** (Cantina = opción A, carpeta fija `D:\cantina`). Ver «Implementación» al final.

Complementa `ANALISIS-MEJORAS.md` (tarea #17). De aquel informe ya están resueltos: rutas reales en descargas (`sandboxEntry`), adjuntos por ID, `seq` en eventos del worker, `orphans` para máquinas sin respuesta, borradores de la bandeja y contador de fallos de `test.js`.

## Evidencia

- Revisión de `runner.js`, `host.js`, `hostops.js`, `worker.js`, `server.js`, `status.js` y vistas.
- Consulta **de solo lectura** a la base de producción (VPS, 128 ejecuciones del 24 al 28 de septiembre). No se modificó nada en el servidor.

| Agente | Runs | Duración media | Máx. | Tokens registrados | Costo registrado |
|---|---|---|---|---|---|
| Antigravity | 65 | 346 s | 1394 s | 1 064 M | $156,38 |
| Claude | 29 | 203 s | 1360 s | 45 M | $48,81 |
| Codex | 23 | 168 s | 1133 s | 59 M | $0,85 |
| Command Code | 11 | 36 s | 302 s | 4 M | $1,29 |

Fin de turno: listo 57 · sin_marcador 21 (16 %) · consulta 18 · interrumpido 10 · abortado 9 · error 6 · cuota 6.
Espera en cola: media 4 s (no es un cuello de botella). Datos en disco: BD 1,8 MB, logs 1,5 MB (sin problema).

## Hallazgos priorizados

### 1. Bug — las conversaciones de tarea quedan en `en_curso` para siempre (esfuerzo bajo)

`finishConv` solo actualiza `conversations.status` cuando **no** es tarea (`runner.js:419-421`); `start` la pone en `en_curso` (`runner.js:308`). Al reiniciar, `recover()` (`runner.js:782-785`) toma todas esas conversaciones terminadas como interrumpidas e inserta «El servidor se reinició…».
**Evidencia:** 56 avisos de reinicio en producción frente a solo 10 ejecuciones realmente interrumpidas; la conversación 9 acumula 10 avisos falsos. Hoy todas las conversaciones de tarea terminadas figuran como `esperando`.
**Propuesta:** en la rama de tarea de `finishConv`, poner la conversación en `inactiva` (o `esperando` si hubo consulta). Una línea más una prueba: correr una tarea con el agente falso, llamar `recover()` y comprobar que no se agrega el aviso.

### 2. Métrica errónea — Codex y Antigravity informan tokens acumulados del hilo (esfuerzo bajo)

En cada `--resume`/`--conversation`, el uso que devuelven Codex (`turn.completed`) y Antigravity (`result.usage`) crece de forma monótona: Codex 6,6 M → 9,4 M → 11 M → 13,4 M → 15,5 M; Antigravity 12 M → 20 M → 28 M → … → 75 M en 10 turnos. Claude y Command Code no se comportan así. `runner.js:113` y `runner.js:157` guardan esa cifra como consumo del turno.
**Impacto:** tokens y costos de esos agentes quedan inflados (Antigravity: la conversación 9 suma 433 M, cuando el total real ronda los 76 M). Esto afecta a las tarjetas del Puente, los límites manuales (`status.js:67-70`), el Consejo y la comparación de rendimiento entre agentes.
**Propuesta:** guardar el delta: `consumo del turno = reportado − reportado en el turno anterior de la misma sesión`. Basta con recordar la última cifra acumulada por conversación (una columna `conversations.usage_cum` o un campo JSON) y reiniciarla cuando cambie el `session_id`. Antes de hacerlo, confirmar con una sesión manual de cada CLI; también se pueden corregir los datos históricos con la misma resta.

### 3. Reanudación — nada se reanuda solo tras un reinicio del servidor (esfuerzo medio)

`recover()` deja las tareas en `esperando` y pide al usuario que responda «continúa». Cada despliegue interrumpe lo que esté en cola, aunque `deploy-vps.sh` espera a que terminen las ejecuciones. El `session_id` se conserva, así que reanudar es barato (`--resume`).
**Propuesta:** al liberar el huérfano de una tarea (`release`, `runner.js:765`), es decir, cuando la máquina confirma que el proceso anterior terminó, relanzarla una sola vez con `runTaskBg(id, null, { text: 'El servidor se reinició a mitad del turno; revisa el estado real y continúa donde quedaste.' })`. Aplicarlo también a las tareas que estaban `en_cola` sin run. No hacerlo en la Cantina: ahí basta el aviso actual.
**Riesgo:** reanudar en bucle si la tarea provoca el reinicio. Se mitiga con un único intento por arranque (se reutiliza `item.retried` / `attempts`).

### 4. Reanudación — una tarea sin cuota no vuelve sola cuando la cuota se reinicia (esfuerzo bajo)

`quotaTick` (`runner.js:502-509`) reactiva al agente, pero sus tareas siguen en `pausada_cuota`, salvo que el área tenga relevo automático.
**Propuesta:** en `quotaTick`, para cada tarea `pausada_cuota` con ese `agent_id` y sin relevo asignado, ejecutar `runTaskBg(id, null, { text: 'Tu cuota se reinició; continúa donde quedaste.' })`. La sesión y el checkpoint ya existen.

### 5. Reanudación — el 16 % de los turnos terminan sin marcador (esfuerzo bajo)

Un turno `sin_marcador` deja la tarea en `esperando` y notifica al usuario (`runner.js:623-624`). Casos: Codex 8, Antigravity 7, Claude 3 y Command Code 3.
**Propuesta:** la primera vez, antes de molestar al usuario, lanzar un turno automático con `REMINDER` («termina con [[LISTO]] o [[CONSULTA]]»). Es un turno corto porque la sesión está caliente. Si vuelve a terminar sin marcador, se consulta al usuario como hoy.

### 6. Rendimiento — cada turno vuelve a descargar todos los adjuntos (esfuerzo bajo)

`start()` llama a `putFiles` con **todos** los adjuntos en cada turno (`runner.js:285-287`), y `putFiles` (`hostops.js:466-489`) descarga del VPS y reescribe cada archivo, aunque su nombre ya lleve el ID del adjunto, que es inmutable.
**Propuesta:** si `f.id` existe y `dest` ya existe con `size === f.size`, omitir la descarga. Como el nombre incluye el ID, ya no existe el riesgo de «mismo nombre y tamaño» de la tarea #17.

### 7. Cantina — carpeta fija frente al sandbox aislado (decisión del usuario)

Hoy la conversación usa `folder_path`, que es opcional (Examinar, o la carpeta por defecto del proyecto). Si no hay carpeta, usa `data/sandbox/conv-<id>` en la máquina. En producción, las 6 consultas rápidas se hicieron sin carpeta.
Además hay un **hueco actual**: las conversaciones de la Cantina no pasan `lock` (`server.js:470` y `server.js:484`, `runTurn` sin `lock`). Dos chats en modo edición sobre la misma carpeta, o un chat y una tarea sin worktree sobre esa carpeta, pueden escribir a la vez.
Opciones:
- **A. Carpeta fija configurable:** ajuste `cantina_folder` por máquina, por ejemplo `C:\Cantina`. Se usa cuando el chat no indica otra carpeta. Los archivos persisten entre chats y son fáciles de encontrar. Exige un bloqueo por ruta (`path-<máquina>-<ruta normalizada>`) compartido con `staticLock`; si no, los chats paralelos chocan.
- **B. Mantener el sandbox por chat y mostrarlo:** botón «Abrir carpeta» y ruta visible en el chat, reutilizando `listFiles` y `readFileB64`. Conserva el aislamiento y es más barato.
- En ambos casos conviene añadir el bloqueo por ruta a los chats con `folder_path` en modo edición.

### 8. Medición — lo que falta para comparar el rendimiento por ejecución (esfuerzo bajo, P2)

Ya se registran la duración, los tokens, el costo, el `diff_stat` y la tasa de éxito por agente (`status.js:72-97`). Faltan:
- `tokens_cache`: se calcula (`st.tcache`) pero no se guarda. Muestra el aprovechamiento de caché y hace auditable el costo estimado.
- Tiempo hasta la primera salida del CLI (arranque y autenticación), para distinguir un CLI lento de una tarea larga.
- La tasa de éxito cuenta `sin_marcador` como éxito (`status.js:75`); conviene separarla.
No hace falta añadir índices por ahora: con este volumen, las consultas de `status.js` son triviales.

## Orden sugerido

1. Hallazgos 1 y 2: son bugs y corrigen los datos en los que se basa todo lo demás.
2. Hallazgos 6, 4 y 5: pequeños y con efecto inmediato.
3. Hallazgo 3: reanudación tras reinicio, con prueba de reinicio simulado usando el agente falso.
4. Hallazgo 7, según la decisión sobre la Cantina, más el bloqueo por ruta.
5. Hallazgo 8.

Cada cambio de lógica debe llevar su prueba en `test.js` y terminar con `node --no-warnings test.js` → `TODO OK`. Ninguna propuesta requiere dependencias npm.

## Implementación

| # | Cambio | Dónde |
|---|---|---|
| 1 | La conversación de tarea pasa a `inactiva`/`esperando` al terminar el turno | `runner.js` `finishConv` |
| 2 | `cumulative` en Codex/Antigravity: se guarda el delta usando `conversations.usage_cum`; migración única de datos históricos (`mig_usage_delta`, costo prorrateado) que siembra las sesiones abiertas | `runner.js`, `db.js` |
| 3 | `recover()` reanuda sola cada tarea cortada (la cola espera a que la máquina confirme el fin del proceso anterior); con 2 cortes seguidos pide al usuario | `runner.js` |
| 4 | `quotaTick` reanuda las tareas `pausada_cuota` del agente que vuelve | `runner.js` |
| 5 | `sin_marcador`: un turno automático de recordatorio; el reintento por error de red ya no se repite en bucle (`item.retried` nunca se asignaba) | `runner.js` |
| 6 | Solo se entregan los adjuntos nuevos del turno (si la sesión se pierde, se reenvían todos) | `runner.js` |
| 7 | Carpeta fija de la Cantina por máquina (`D:\cantina`, `OFICINA_CANTINA` / `worker.json` `cantina`; si no existe el disco, sandbox). Bloqueo por ruta compartido entre tareas sin worktree y chats en modo edición (`dir-…`, `cantina-…`) | `hostops.js`, `host.js`, `worker.js`, `runner.js` |
| 8 | `runs.tokens_cache` y `runs.first_out_at`; columnas «Arranque» y «Caché» en Historial → Ejecuciones; la tasa de éxito ya no cuenta `sin_marcador` | `runner.js`, `server.js`, `status.js`, `public/views.js` |

Pruebas nuevas en `test.js`: cuota reiniciada, recordatorio sin marcador, delta y migración, Cantina fija con bloqueo, estado de la conversación de tarea y reanudación tras reinicio (incluido el tope de 2 cortes).
