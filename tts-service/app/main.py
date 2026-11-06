import logging
import secrets
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .audio import MAX_SPEED, MIN_SPEED, AudioProcessingError
from .config import Settings, get_settings
from .engine import EmptyAudioError, TtsEngine, UnknownVoiceError
from .voices import Voice

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tts-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = TtsEngine(settings)
    app.state.engine = engine
    # Model load is slow (and may download weights on first run); do it off the event loop.
    await run_in_threadpool(engine.load)
    yield


app = FastAPI(title="VieNeu TTS service", version="0.1.0", lifespan=lifespan)


def get_engine(request: Request) -> TtsEngine:
    engine: TtsEngine = request.app.state.engine
    if not engine.ready:
        raise HTTPException(503, "model is not loaded yet")
    return engine


def require_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_key: Annotated[str | None, Header()] = None,
) -> None:
    if not x_internal_key or not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(401, "invalid internal key")


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str = Field(min_length=1, max_length=100)
    speed: float = Field(1.0, ge=MIN_SPEED, le=MAX_SPEED)
    format: Literal["mp3", "wav"] = "mp3"


@app.get("/health")
def health(request: Request):
    engine: TtsEngine = request.app.state.engine
    return {"status": "ok" if engine.ready else "loading", **engine.info()}


@app.get("/voices", response_model=list[Voice], dependencies=[Depends(require_key)])
def voices(engine: Annotated[TtsEngine, Depends(get_engine)]):
    return engine.voices()


@app.post("/synthesize", dependencies=[Depends(require_key)])
def synthesize(
    req: SynthesizeRequest,
    engine: Annotated[TtsEngine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    # Plain `def`: FastAPI runs it in a worker thread; the engine serializes inference itself.
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is empty")
    if len(text) > settings.max_chars:
        raise HTTPException(400, f"text too long (max {settings.max_chars} chars)")
    try:
        out = engine.synthesize(text, req.voice, req.speed, req.format)
    except UnknownVoiceError as e:
        raise HTTPException(400, str(e)) from e
    except EmptyAudioError as e:
        # Deterministic for this input: 4xx so the gateway does not retry it.
        raise HTTPException(422, str(e)) from e
    except AudioProcessingError as e:
        log.exception("audio post-processing failed")
        raise HTTPException(500, f"audio processing failed: {e}") from e
    return Response(
        content=out.data,
        media_type=out.media_type,
        headers={"X-Audio-Duration": str(out.duration), "X-Sample-Rate": str(out.sample_rate)},
    )
