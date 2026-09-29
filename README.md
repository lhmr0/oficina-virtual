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
| **Estación** | Mapa de la oficina (estilo Gather): cada área es una sala con escritorios; los droides trabajan, piden ayuda con "?", esperan revisión con "!" y duermen (Zz) sin cuota. Cantina, Consejo, Puente y Archivos también son salas. Todo lo demás se abre en un panel lateral sobre el mapa; dock inferior y buscador **Ctrl+K**. |
| **Proyectos** | Con carpetas locales (una o varias, git opcional) o solo de registro. Estado, avance, métricas. |
| **Kanban** | Por proyecto o de todos los proyectos. Arrastra a "En curso" para ejecutar. |
| **Tarea** | Agente + modelo + esfuerzo + modo, consola en vivo, chat con el agente, diff, ejecuciones, relevos, historial de cambios. |
| **Cantina** | Consultas rápidas sin proyecto; multi-turno, cambio de agente a mitad, convertir en tarea/proyecto. Sin carpeta elegida trabajan en la carpeta fija `D:\cantina` de la máquina (`OFICINA_CANTINA` o `"cantina"` en `worker.json`; vacío = sandbox por chat); los chats en modo *Editar* sobre la misma carpeta van de a uno. |
| **Consejo Jedi** | Informe de lo hecho → uno o varios agentes proponen mejoras por "lentes" → tablero de propuestas → tareas. |
| **Archivos Jedi** | Historial de chats, tareas, ejecuciones, relevos, notificaciones, bitácora, consejos, papelera. Búsqueda global y CSV. |
| **Puente de Mando** | Estado de todo: versión y salud de cada agente, límites (los que informa el CLI + medidos + manuales), procesos, carpetas git, sistema. Orden 66. |
| **Configuración** | Máquinas (agentes de campo), agentes (comando, modelos, **precios por modelo** en USD/1M tokens tomados de las páginas oficiales, esfuerzos, concurrencia, patrones de cuota), áreas y cadena de relevo, usuarios/roles, límites, automatización, plantillas, perfil. |

## Cómo trabaja un agente

1. Cada tarea con carpeta git corre en su propio **worktree** (`<repo>/.oficina-worktrees/task-N`, rama `oficina/task-N-…`), así varios agentes trabajan en paralelo sin pisarse. Sin git: corre en la carpeta (una tarea a la vez). Sin carpeta: en `data/sandbox/task-N`.
2. El agente mantiene `.oficina/progreso.md` y termina cada turno con `[[CONSULTA]]` (te pregunta → notificación) o `[[LISTO]]` (pasa a Revisión).
3. Al responder se **reanuda la misma sesión** del CLI. Al aprobar puedes fusionar la rama.
4. Si se agota la cuota: checkpoint git + snapshot de relevo; eliges quién continúa (o relevo automático por la cadena del área).
5. Modo **supervisado** (Claude): cada permiso que pide aparece en vivo para aprobar/denegar.

⚠ En modo *Editar* los agentes trabajan sin pedir permiso y sin sandbox (Claude `bypassPermissions`, Codex `--dangerously-bypass-approvals-and-sandbox`, agy `--dangerously-skip-permissions`, CommandCode `auto-accept`): pueden ejecutar comandos, hacer push y desplegar con tus credenciales, igual que tu CLI. *Plan* es solo lectura; *Supervisado* (Claude) te pide cada permiso.

## En el VPS con la PC como ejecutora (acceso desde cualquier lado)

```
Celular / laptop ──HTTPS──► VPS ua.csjla.pe (web, BD, login Google, cola)
                                  ▲
                    conexión SALIENTE HTTPS (sin abrir puertos)
                                  │
                     PC ── worker.js (agente de campo): Claude/Codex/agy/CommandCode, git, archivos
```
- Si la PC está apagada, las tareas quedan **en cola** y arrancan solas cuando el agente se reconecta.
- El agente de campo solo lanza `claude`, `codex`, `agy` y CommandCode, y solo trabaja en carpetas dentro de `roots` (worker.json).
- Adjuntos: se suben al VPS y el agente los baja a `.oficina/adjuntos/` de la carpeta de trabajo antes del turno.

### 1. Google SSO (una vez)
1. https://console.cloud.google.com → crea un proyecto (ej. "Oficina Virtual").
2. **Google Auth Platform → Branding / Audiencia**: tipo **Externo**, estado **Prueba**; en *Usuarios de prueba* agrega los correos permitidos.
3. **Clientes → Crear cliente → Aplicación web**
   - Orígenes autorizados: `https://ua.csjla.pe`
   - URI de redirección: `https://ua.csjla.pe/api/auth/google/callback`
4. Copia el ID y el secreto **directamente** en el VPS: `ssh vps` → `nano ~/oficina/.env` → `GOOGLE_CLIENT_ID=…` y `GOOGLE_CLIENT_SECRET=…`.

`~/oficina/.env` (permisos 600):
```
OFICINA_AUTH=google
OFICINA_PUBLIC_URL=https://ua.csjla.pe
OFICINA_ALLOWED_EMAILS=correo1@…,correo2@…
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```
Solo los correos de `OFICINA_ALLOWED_EMAILS` entran (verificados por Google); no existe login por contraseña en este modo.

### 2. Apache (requiere sudo, una vez)
```
sudo cp /etc/apache2/sites-available/ua.csjla.pe-le-ssl.conf /etc/apache2/sites-available/ua.csjla.pe-le-ssl.conf.bak-proyecto_sea
sudo cp ~/oficina/app/deploy/ua.csjla.pe-le-ssl.conf /etc/apache2/sites-available/ua.csjla.pe-le-ssl.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

### 3. Desplegar / actualizar
Desde la PC (sube el último commit, reconstruye y reinicia el contenedor `oficina-virtual` en 127.0.0.1:4242):
```
bash deploy/deploy-vps.sh
```

### 4. Agente de campo en la PC
- Token: Configuración → Máquinas → *Generar token*, o en el VPS `docker run --rm -v ~/oficina/data:/data oficina-virtual node server.js crear-maquina "PC"`.
- `worker.json` junto a `worker.js`: `{"url": "https://ua.csjla.pe", "token": "…", "roots": ["C:\\Users\\TU_USUARIO"]}` (no se sube a git).
- Probar: `node worker.js` · Dejarlo siempre activo: `powershell -ExecutionPolicy Bypass -File instalar-agente.ps1` (tarea al iniciar sesión, log en `worker.log`).
- La PC no debe suspenderse si quieres trabajar desde fuera.

### 5. Actualización diaria de CLIs y modelos en la PC
Para mantener actualizados automáticamente los 4 CLIs (`claude`, `codex`, `agy`, `commandcode`) y sincronizar todos los modelos y esfuerzos de razonamiento en la base de datos de la Oficina Virtual:

- **Ejecutar manualmente ahora**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\actualizar-diario.ps1
  ```
  o doble clic en `actualizar-diario.bat`.
- **Programar ejecución diaria automática** (tarea programada de Windows a las 03:00 AM):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\actualizar-diario.ps1 -InstalarTarea -Hora "03:00"
  ```
- **Desinstalar la tarea programada**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\actualizar-diario.ps1 -DesinstalarTarea
  ```
- El registro de cada ejecución queda guardado en `actualizar.log`.

### 6. Servicio de IA local (opcional): dictado por voz y adjuntos → texto
Contenedor `oficina-ia` en un servidor de la red interna (`deploy/ia/`, sin GPU):
- **🎤 Dictado** en la Cantina, las respuestas y la tarea nueva (Whisper `large-v3-turbo`, español, ~0,4 s por segundo de audio). Al agente se le avisa que el texto viene de un dictado. **🔊** lee en voz alta las respuestas de los agentes (voz del navegador).
- **🎤 Órdenes por voz** desde el dock inferior: crea tareas (proyecto, título, agente y área), lanza consultas a la Cantina, navega a una sección y busca en el historial. La orden se interpreta con reglas (`public/ordenes.js`) y se confirma en pantalla antes de ejecutar. Detalle en `ANALISIS-TAREA-32.md`.
- **Adjuntos PDF/Office → `<adjunto>.md`** (tablas incluidas; OCR en español para los escaneados), que el agente lee en vez del original.

Instalar: copiar `deploy/ia` al servidor como `~/oficina-ia`, crear `secrets/api_key` y ejecutar `docker compose up -d --build`. En la oficina: `OFICINA_IA_URL=http://<servidor>:8010` y `OFICINA_IA_KEY=<clave>`. Las llamadas salen desde el agente de campo (la PC ve la red interna y el VPS no). Sin estas variables, la función queda apagada. Si el servicio cae, todo sigue como antes.

## Datos

Todo vive en `data/` (SQLite `oficina.db`, logs de ejecución, sandbox, respaldos diarios). Variables: `OFICINA_PORT` (4242), `OFICINA_DATA`, `OFICINA_BIND`, `OFICINA_LOCAL_EXEC` (0 = no ejecutar agentes en el servidor), `OFICINA_AUTH` (password|google), `OFICINA_PUBLIC_URL`, `OFICINA_ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OFICINA_NO_TOAST`, `OFICINA_CANTINA`.

## Pruebas

```
node --no-warnings test.js
```
Recorre el flujo completo con agentes falsos (auth, roles, proyectos, cola, consultas, cuota y relevo, git, cantina, consejo, puente, recuperación).
