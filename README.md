# ★ Oficina Virtual

Oficina 8-bit (estilo galáctico) para asignar tareas a agentes de IA — **Claude, Codex, Antigravity y CommandCode** — por proyecto y área, verlas trabajar en tiempo real y no perder nada si un agente se queda sin cuota.

## Arrancar

```
iniciar.bat
```
o `node --no-warnings server.js` y abre http://127.0.0.1:4242. El primer ingreso crea al **Comandante** (admin).

Requisitos: Node 22+, git, y los CLIs de los agentes instalados y con sesión iniciada (`claude`, `codex`, `agy`, `commandcode`). Sin dependencias npm.

## Qué hay

| Sección | Para qué |
|---|---|
| **Estación** | Mapa de la oficina: cada área es una sala; los droides trabajan en escritorios, piden ayuda con "?" y duermen (Zz) sin cuota. |
| **Proyectos** | Con carpetas locales (una o varias, git opcional) o solo de registro. Estado, avance, métricas. |
| **Kanban** | Por proyecto. Arrastra a "En curso" para ejecutar. |
| **Tarea** | Agente + modelo + esfuerzo + modo, consola en vivo, chat con el agente, diff, ejecuciones, relevos, historial de cambios. |
| **Cantina** | Consultas rápidas sin proyecto; multi-turno, cambio de agente a mitad, convertir en tarea/proyecto. |
| **Consejo Jedi** | Informe de lo hecho → uno o varios agentes proponen mejoras por "lentes" → tablero de propuestas → tareas. |
| **Archivos Jedi** | Historial de chats, tareas, ejecuciones, relevos, notificaciones, bitácora, consejos, papelera. Búsqueda global y CSV. |
| **Puente de Mando** | Estado de todo: versión y salud de cada agente, límites (los que informa el CLI + medidos + manuales), procesos, carpetas git, sistema. Orden 66. |
| **Configuración** | Agentes (comando, modelos, esfuerzos, concurrencia, patrones de cuota), áreas y cadena de relevo, usuarios/roles, límites, automatización, plantillas, perfil. |

## Cómo trabaja un agente

1. Cada tarea con carpeta git corre en su propio **worktree** (`<repo>/.oficina-worktrees/task-N`, rama `oficina/task-N-…`), así varios agentes trabajan en paralelo sin pisarse. Sin git: corre en la carpeta (una tarea a la vez). Sin carpeta: en `data/sandbox/task-N`.
2. El agente mantiene `.oficina/progreso.md` y termina cada turno con `[[CONSULTA]]` (te pregunta → notificación) o `[[LISTO]]` (pasa a Revisión).
3. Al responder se **reanuda la misma sesión** del CLI. Al aprobar puedes fusionar la rama.
4. Si se agota la cuota: checkpoint git + snapshot de relevo; eliges quién continúa (o relevo automático por la cadena del área).
5. Modo **supervisado** (Claude): cada permiso que pide aparece en vivo para aprobar/denegar.

⚠ En modo *Editar* los agentes auto-aceptan cambios dentro de su carpeta de trabajo.

## Datos

Todo vive en `data/` (SQLite `oficina.db`, logs de ejecución, sandbox, respaldos diarios). Variables: `OFICINA_PORT` (4242), `OFICINA_DATA`, `OFICINA_NO_TOAST`.

## Pruebas

```
node --no-warnings test.js
```
Recorre el flujo completo con agentes falsos (auth, roles, proyectos, cola, consultas, cuota y relevo, git, cantina, consejo, puente, recuperación).
