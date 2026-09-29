"""Síntesis Chatterbox Multilingual V3 aislada; accesible solo desde Docker Compose."""
import io, logging, math, pathlib, threading, wave

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

REFERENCE = pathlib.Path(__file__).with_name("referencia-latam.wav")
app = FastAPI()
_model = None
_error = None
_busy = threading.Lock()


class Speech(BaseModel):
    text: str
    speed: float = 1


def load_model():
    global _model, _error
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        model = ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model="v3")
        model.prepare_conditionals(str(REFERENCE))
        _model = model
    except Exception:
        _error = "No se pudo cargar Chatterbox V3"
        logging.exception(_error)


@app.on_event("startup")
def warm():
    threading.Thread(target=load_model, daemon=True).start()


@app.get("/health")
def health():
    return {"ready": _model is not None, "error": _error}


@app.post("/speak")
def speak(body: Speech):
    text = body.text.strip()
    if not text or len(text) > 180:
        raise HTTPException(400, "la voz Chatterbox requiere entre 1 y 180 caracteres")
    if not math.isfinite(body.speed) or not 0.5 <= body.speed <= 2:
        raise HTTPException(400, "velocidad inválida")
    if _model is None:
        raise HTTPException(503, _error or "la voz Chatterbox se está cargando")
    if not _busy.acquire(timeout=30):
        raise HTTPException(503, "la cola de voz Chatterbox está ocupada")
    try:
        import librosa
        audio = _model.generate(text, language_id="es").squeeze().detach().cpu().numpy()
        if body.speed != 1:
            audio = librosa.effects.time_stretch(audio, rate=body.speed)
        peak = np.max(np.abs(audio))
        if peak > 0.95:
            audio = audio * (0.95 / peak)
        pcm = (audio * 32767).astype("<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(_model.sr)
            wav.writeframes(pcm.tobytes())
        return Response(buf.getvalue(), media_type="audio/wav")
    except Exception:
        logging.exception("Fallo al sintetizar con Chatterbox")
        raise HTTPException(503, "no se pudo sintetizar la voz Chatterbox")
    finally:
        _busy.release()
