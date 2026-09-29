# Servicio de IA local para la Oficina Virtual (corre en el servidor interno, no en el VPS):
#   POST /transcribe            audio (webm/ogg/wav/mp3…) → {"text"}            Whisper (faster-whisper, CPU)
#   POST /convert?name=x.pdf    PDF/DOCX/XLSX/PPTX/HTML → {"md", "pages", "ocr"}   (PDF escaneado → OCR en español)
#   GET  /voices                → voces de texto a voz disponibles
#   POST /speak                 {"text", "voice", "speed"} → audio WAV   (Piper/Kokoro locales o Chatterbox interno)
#   GET  /health
# Laya (detector de inyección) se probó y se descartó: marcaba como sospechoso casi todo documento formal (tarea #29).
# Todo exige Authorization: Bearer <clave> (IA_API_KEY_FILE). La oficina lo llama desde la PC (agente de campo).
import hashlib, io, json, math, os, pathlib, threading, time, urllib.error, urllib.request, wave
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

KEY = pathlib.Path(os.environ["IA_API_KEY_FILE"]).read_text().strip()
CACHE = pathlib.Path(os.environ.get("IA_CACHE", "/cache")); CACHE.mkdir(parents=True, exist_ok=True)
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
# vocabulario de la oficina: Whisper acierta mejor nombres propios y jerga si se los "sugiere"
WHISPER_PROMPT = os.environ.get("WHISPER_PROMPT", "Oficina Virtual: tarea, proyecto, Cantina, Consejo Jedi, Puente de Mando, Kanban, "
                                "Claude, Codex, Antigravity, CommandCode, agente, desplegar, VPS, worktree, commit, push, sij_ws, Laya.")
THREADS = int(os.environ.get("IA_THREADS", "4"))
CHATTERBOX_URL = os.environ.get("CHATTERBOX_URL")

app = FastAPI()
_whisper, _wlock, _plock = None, threading.Lock(), threading.Lock()


def auth(req: Request):
    if req.headers.get("authorization") != "Bearer " + KEY:
        raise HTTPException(401, "clave inválida")


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS)
    return _whisper


@app.on_event("startup")
def warm():
    threading.Thread(target=whisper, daemon=True).start()  # descarga/carga el modelo sin bloquear /health


@app.get("/health")
def health():
    return {"status": "ok", "whisper": WHISPER_MODEL, "whisper_loaded": _whisper is not None}


@app.post("/transcribe")
async def transcribe(req: Request):
    auth(req)
    audio = await req.body()
    if not audio:
        raise HTTPException(400, "audio vacío")
    t0 = time.time()
    with _wlock:  # ponytail: una transcripción a la vez (CPU); cola si hay muchos usuarios a la vez
        segs, info = whisper().transcribe(io.BytesIO(audio), language="es", initial_prompt=WHISPER_PROMPT, vad_filter=True, beam_size=5)
        text = " ".join(s.text.strip() for s in segs).strip()
    return {"text": text, "seconds": round(info.duration, 1), "ms": int((time.time() - t0) * 1000)}


# ---------- texto → voz: Piper (~0,5 s por frase) y Kokoro (~3 s, más natural según la voz); modelos descargados al primer uso ----------
PIPER = {"piper-claude": ("Claude · México (Piper)", "es_MX/claude/high/es_MX-claude-high"),
         "piper-daniela": ("Daniela · Argentina (Piper)", "es_AR/daniela/high/es_AR-daniela-high"),
         "piper-davefx": ("Dave · España (Piper)", "es_ES/davefx/medium/es_ES-davefx-medium"),
         "piper-ald": ("Ald · México (Piper)", "es_MX/ald/medium/es_MX-ald-medium"),
         "piper-sharvard": ("Sharvard · España (Piper)", "es_ES/sharvard/medium/es_ES-sharvard-medium")}
KOKORO = {"kokoro-dora": ("Dora (Kokoro)", "ef_dora"), "kokoro-alex": ("Alex (Kokoro)", "em_alex"), "kokoro-santa": ("Santa (Kokoro)", "em_santa")}
CHATTERBOX = {"chatterbox-latam": ("Latinoamérica (Chatterbox V3 · lenta en CPU)", None)}
VOICES = CACHE / "voces"; VOICES.mkdir(exist_ok=True)
_voices, _tlock = {}, threading.Lock()


def fetch(url, dest):
    if not dest.exists():
        tmp = dest.with_suffix(".tmp"); urllib.request.urlretrieve(url, tmp); tmp.rename(dest)
    return str(dest)


def voice(vid):
    if vid not in _voices:
        if vid in PIPER:
            from piper import PiperVoice
            base, p = "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/", PIPER[vid][1]
            name = p.split("/")[-1]
            fetch(base + p + ".onnx.json", VOICES / (name + ".onnx.json"))
            _voices[vid] = PiperVoice.load(fetch(base + p + ".onnx", VOICES / (name + ".onnx")))
        elif vid in KOKORO:
            from kokoro_onnx import Kokoro
            rel = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
            _voices[vid] = Kokoro(fetch(rel + "kokoro-v1.0.onnx", VOICES / "kokoro-v1.0.onnx"), fetch(rel + "voices-v1.0.bin", VOICES / "voices-v1.0.bin"))
        else:
            raise HTTPException(400, "voz desconocida: " + vid)
    return _voices[vid]


@app.get("/voices")
def voices(req: Request):
    auth(req)
    return [{"id": k, "label": v[0]} for k, v in {**PIPER, **KOKORO, **CHATTERBOX}.items()]


def synthesize_chatterbox(text, speed):
    # En CPU una frase corta ya tarda decenas de segundos; limitarla evita agotar el RPC de campo.
    if len(text) > 180:
        raise HTTPException(400, "Chatterbox admite hasta 180 caracteres por aviso")
    if not CHATTERBOX_URL:
        raise HTTPException(503, "el servicio Chatterbox no está configurado")
    data = json.dumps({"text": text, "speed": speed}).encode()
    request = urllib.request.Request(CHATTERBOX_URL, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=105) as response:
            wav = response.read(10_000_001)
        if len(wav) > 10_000_000 or not wav.startswith(b"RIFF") or wav[8:12] != b"WAVE":
            raise HTTPException(503, "respuesta de voz Chatterbox inválida")
        return wav
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise HTTPException(503, "la voz Chatterbox no está disponible") from error


def synthesize(text, vid, speed):
    buf = io.BytesIO()
    with _tlock:
        v = voice(vid)
        with wave.open(buf, "wb") as wf:
            if vid in PIPER:
                from piper import SynthesisConfig
                v.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=1 / speed))
            else:
                import numpy as np
                a, sr = v.create(text, voice=KOKORO[vid][1], speed=speed, lang="es")
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
                wf.writeframes((np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


@app.post("/speak")
async def speak(req: Request):
    auth(req)
    b = await req.json()
    text, vid = str(b.get("text", ""))[:1500].strip(), b.get("voice") or "piper-claude"
    try:
        speed = min(max(float(b.get("speed") or 1), 0.5), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "velocidad inválida")
    if not math.isfinite(speed):
        raise HTTPException(400, "velocidad inválida")
    if not text:
        raise HTTPException(400, "texto vacío")
    if vid in CHATTERBOX:
        wav = await run_in_threadpool(synthesize_chatterbox, text, speed)
    else:
        wav = await run_in_threadpool(synthesize, text, vid, speed)
    return Response(wav, media_type="audio/wav")


OFFICE = {".docx", ".xlsx", ".xls", ".pptx", ".html", ".htm"}


def to_markdown(name, data):
    ext = pathlib.Path(name).suffix.lower()
    if ext in OFFICE:
        from markitdown import MarkItDown
        return MarkItDown().convert_stream(io.BytesIO(data), file_extension=ext).text_content, None, False
    if ext != ".pdf":
        raise HTTPException(415, "formato no soportado: " + ext)
    import pymupdf, pymupdf4llm
    doc = pymupdf.open(stream=data, filetype="pdf")
    md = pymupdf4llm.to_markdown(doc, show_progress=False)
    if len(md.strip()) >= 80 * doc.page_count:
        return md, doc.page_count, False
    # casi sin texto: PDF escaneado → OCR en español (Tesseract)
    pages = [p.get_text(textpage=p.get_textpage_ocr(language="spa+eng", dpi=200, full=True)) for p in doc]
    return "\n\n".join(f"<!-- página {i + 1} -->\n{t.strip()}" for i, t in enumerate(pages)), doc.page_count, True


@app.post("/convert")
async def convert(req: Request, name: str = "archivo"):
    auth(req)
    data = await req.body()
    key = hashlib.sha256(data).hexdigest()
    cached = CACHE / (key + ".json")

    def job(res):
        t0 = time.time()
        try:
            with _plock:
                md, pages, ocr = to_markdown(name, data)
            out = json.dumps({"md": md, "pages": pages, "ocr": ocr, "ms": int((time.time() - t0) * 1000)}).encode()
            cached.write_bytes(out)
            res.append(out)
        except HTTPException as e:
            res.append(json.dumps({"error": e.detail}).encode())
        except Exception as e:
            res.append(json.dumps({"error": f"no se pudo convertir: {str(e)[:200]}"}).encode())

    def work():
        # ponytail: espacios mientras trabaja (el JSON sigue siendo válido): fetch de Node corta si pasan 5 min
        # sin cabeceras o sin datos, y un PDF grande escaneado puede tardar más
        if cached.exists():
            yield cached.read_bytes(); return
        res = []
        t = threading.Thread(target=job, args=(res,), daemon=True); t.start()
        while t.is_alive():
            yield b" "
            t.join(20)
        yield res[0]

    return StreamingResponse(work(), media_type="application/json")
