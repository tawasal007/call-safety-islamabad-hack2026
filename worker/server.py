"""Silent LiveKit caption service. Run ONE uvicorn worker; persist data on a volume."""
import asyncio
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import numpy as np
import aiohttp
import webrtcvad
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from faster_whisper import WhisperModel
from livekit import api, rtc
from livekit.agents import inference, stt, APIConnectOptions
from pydantic import BaseModel, Field

from core import Store, UtteranceBuffer, keyword_matches, now
from streaming import StreamingSegments
from text_translation import LiveKitTranslator

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / '.env.local')
load_dotenv(ROOT / '.env', override=True)
SECRET = os.getenv('TRANSCRIPTION_WORKER_SECRET', '')
if len(SECRET) < 32:
    raise RuntimeError('Set TRANSCRIPTION_WORKER_SECRET to a random secret of at least 32 characters.')
store = Store(os.getenv('CALL_LOG_DB', str(ROOT / 'data' / 'calls.sqlite3')))
sessions = {}
start_lock = asyncio.Lock()


def authorize(authorization: str = Header(default='')):
    if not hmac.compare_digest(authorization, 'Bearer ' + SECRET):
        raise HTTPException(401, 'Unauthorized')


class StartRequest(BaseModel):
    roomId: str = Field(pattern=r'^call-[0-9a-f-]{36}$')
    role: str = Field(pattern=r'^(caller|receiver)$')
    language: str = Field(default='en', pattern=r'^(auto|en|ur)$')


class Engine:
    def __init__(self):
        self.model = None
        self.model_lock = asyncio.Lock()
        self.translator_lock = asyncio.Lock()
        self.tokenizer = self.translator = None
        self.error = None
        self.translation_error = None
        self.translation_retry_at = 0
        self.device = os.getenv('WHISPER_DEVICE', 'cpu')
        self.model_name = os.getenv('WHISPER_MODEL', 'small')
        if self.model_name.endswith('.en') or 'turbo' in self.model_name.lower():
            raise RuntimeError('Choose a multilingual translation-capable Whisper model: small, medium or large-v3.')
        self.translation_backend = os.getenv('URDU_TRANSLATION_BACKEND', 'local')
        self.english_backend = os.getenv('ENGLISH_STT_BACKEND', 'livekit')
        if self.english_backend not in ('livekit', 'whisper'):
            raise RuntimeError('ENGLISH_STT_BACKEND must be livekit or whisper')
        self.streaming_model = os.getenv('LIVEKIT_STT_MODEL', 'deepgram/nova-3')
        self.http = self.stt = None
        self.urdu_backend = os.getenv('URDU_STT_BACKEND', self.english_backend)
        if self.urdu_backend not in ('livekit', 'whisper'):
            raise RuntimeError('URDU_STT_BACKEND must be livekit or whisper')
        self.text_backend = os.getenv('TEXT_TRANSLATION_BACKEND', 'livekit' if 'livekit' in (self.english_backend, self.urdu_backend) else self.translation_backend)
        if self.text_backend not in ('livekit', 'local', 'disabled'):
            raise RuntimeError('TEXT_TRANSLATION_BACKEND must be livekit, local or disabled')
        self.cloud_translator = None

    async def open_streaming(self):
        if 'livekit' in (self.english_backend, self.urdu_backend):
            self.http = aiohttp.ClientSession()
            self.stt = inference.STT(model=self.streaming_model, language='en', sample_rate=16000,
                http_session=self.http, extra_kwargs={'interim_results': True, 'endpointing': 300,
                    'punctuate': True, 'smart_format': True, 'no_delay': True})
        if self.text_backend == 'livekit':
            self.cloud_translator = LiveKitTranslator(os.getenv('LIVEKIT_TRANSLATION_MODEL', 'google/gemini-3.1-flash-lite'))

    async def close_streaming(self):
        if self.stt:
            await self.stt.aclose()
        if self.http:
            await self.http.close()
        if self.cloud_translator:
            await self.cloud_translator.aclose()

    def streams_language(self, language):
        return (language == 'en' and self.english_backend == 'livekit' or
                language == 'ur' and self.urdu_backend == 'livekit')

    def load(self):
        if self.model_name.endswith('.en') or 'turbo' in self.model_name.lower():
            raise RuntimeError('Translation-capable multilingual Whisper model required')
        self.model = WhisperModel(self.model_name, device=self.device,
            compute_type=os.getenv('WHISPER_COMPUTE_TYPE', 'int8' if self.device == 'cpu' else 'float16'),
            download_root=str(ROOT / 'models'), cpu_threads=int(os.getenv('WHISPER_CPU_THREADS', '4')))

    async def warmup(self):
        try:
            async with self.model_lock:
                await asyncio.to_thread(self.load)
        except Exception as exc:
            self.error = type(exc).__name__

    async def recognize(self, pcm, language, final):
        async with self.model_lock:
            if self.model is None:
                raise RuntimeError('Speech model unavailable; check worker setup and model download.')
            return await asyncio.to_thread(self._recognize, pcm, language, final)

    def _recognize(self, pcm, language, final):
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        detected_probability = None  # explicit selection is not measured confidence
        if language == 'auto':
            _, _, probabilities = self.model.detect_language(audio)
            # Constrain detection to the supported languages, decoding Urdu in
            # Urdu script even when acoustically similar Hindi ranks higher.
            language, detected_probability = max(
                ((lang, probability) for lang, probability in probabilities if lang in ('en', 'ur')),
                key=lambda pair: pair[1])
        def decode(task, lang):
            parts, info = self.model.transcribe(audio, language=None if lang == 'auto' else lang,
                task=task, beam_size=5 if final else 1, condition_on_previous_text=False,
                vad_filter=True, no_speech_threshold=0.6, hallucination_silence_threshold=1.0)
            parts = [s for s in parts if s.no_speech_prob < 0.7 and s.avg_logprob > -1.5]
            return ' '.join(s.text.strip() for s in parts).strip(), info
        original, info = decode('transcribe', language)
        if not original:
            return None
        source = language if language != 'auto' else info.language
        if source not in ('en', 'ur'):
            raise RuntimeError('Supported caption languages are English and Urdu. Select the spoken language explicitly.')
        # Show provisional Urdu immediately. Repeated translation of a growing
        # utterance competes with final decoding on CPU and delays both speakers.
        english = original if source == 'en' else decode('translate', source)[0] if final else ''
        return {'original': original, 'english': english, 'language': source,
                'languageProbability': round(detected_probability, 3) if detected_probability is not None else None}

    def _urdu(self, english):
        return self._text_translate(english, 'en', 'ur')

    def _text_translate(self, text, source, target):
        if self.text_backend == 'disabled' or self.translation_backend == 'disabled':
            raise RuntimeError('Text translation disabled')
        if self.translator is None:
            import torch
            torch.set_num_threads(int(os.getenv('TRANSLATION_CPU_THREADS', '2')))
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            model = os.getenv('URDU_TRANSLATION_MODEL', 'facebook/nllb-200-distilled-600M')
            # Prefer cached files: avoid network checks on every worker restart.
            def load(cls, **kwargs):
                try:
                    return cls.from_pretrained(model, cache_dir=str(ROOT / 'models'), local_files_only=True, **kwargs)
                except OSError:
                    return cls.from_pretrained(model, cache_dir=str(ROOT / 'models'), **kwargs)
            self.tokenizer = load(AutoTokenizer, src_lang='eng_Latn')
            self.translator = load(AutoModelForSeq2SeqLM, use_safetensors=False)
            self.translator.eval()
        import torch
        torch.set_num_threads(int(os.getenv('TRANSLATION_CPU_THREADS', '2')))
        with torch.inference_mode():
            codes = {'en': 'eng_Latn', 'ur': 'urd_Arab'}
            self.tokenizer.src_lang = codes[source]
            inputs = self.tokenizer(text, return_tensors='pt', truncation=True, max_length=512)
            output = self.translator.generate(**inputs,
                forced_bos_token_id=self.tokenizer.convert_tokens_to_ids(codes[target]), max_new_tokens=256, num_beams=2)
        return self.tokenizer.batch_decode(output, skip_special_tokens=True)[0]

    async def urdu(self, english):
        return await self.text_translate(english, 'en', 'ur')

    async def text_translate(self, text, source, target):
        if self.text_backend == 'disabled':
            raise RuntimeError('Text translation disabled')
        if self.text_backend == 'livekit':
            if not self.cloud_translator:
                raise RuntimeError('LiveKit text translation not initialized')
            try:
                result = await self.cloud_translator.translate(text, source, target)
                self.translation_error = None
                return result
            except Exception as exc:
                self.translation_error = type(exc).__name__
                raise
        async with self.translator_lock:
            if time.monotonic() < self.translation_retry_at:
                raise RuntimeError('Urdu translation temporarily unavailable')
            try:
                result = await asyncio.to_thread(self._text_translate, text, source, target)
                self.translation_error = None
                self.translation_retry_at = 0
                return result
            except Exception as exc:
                self.translation_error = type(exc).__name__
                self.translation_retry_at = time.monotonic() + 60
                raise


engine = Engine()


class CallSession:
    def __init__(self, room_id):
        self.room_id = room_id
        self.room = rtc.Room()
        self.languages = {'caller': 'en', 'receiver': 'en'}
        self.queue = asyncio.PriorityQueue(maxsize=24)
        self.queue_sequence = 0
        self.final_queued = set()
        self.translation_queue = asyncio.Queue(maxsize=32)
        self.tracks = {}
        self.audio_tracks = {}
        self.stream_errors = set()
        self.stream_stats = {}
        self.streams = {}
        self.partial_pending = set()
        self.closing = False
        self.grace = None
        self.consumer = self.translations = self.heartbeat = None
        store.start(room_id)
        log = store.get(room_id)
        self.history = log['segments'][-16:]
        self.epoch = datetime.fromisoformat(log['startedAt']).timestamp()

    async def status(self, status, message):
        store.status(self.room_id, status, message)
        await self.publish({'type': 'status', 'roomId': self.room_id, 'status': status,
                            'message': message, 'timestamp': now()})

    async def publish(self, payload):
        if self.room.isconnected():
            try:
                await self.room.local_participant.publish_data(json.dumps(payload, ensure_ascii=False).encode(),
                    reliable=True, topic='call-safety.transcription')
            except Exception:
                # SQLite remains authoritative for recovery; no transcript in console logs.
                pass

    async def start(self):
        @self.room.on('track_subscribed')
        def subscribed(track, publication, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO and publication.source == rtc.TrackSource.SOURCE_MICROPHONE:
                role = self.role(participant.identity)
                if role and track.sid not in self.tracks:
                    self.audio_tracks[track.sid] = (track, role)
                    self.tracks[track.sid] = asyncio.create_task(self.capture(track, role))

        @self.room.on('track_unsubscribed')
        def unsubscribed(track, publication, participant):
            self.audio_tracks.pop(track.sid, None)
            task = self.tracks.get(track.sid)
            if task:
                task.cancel()  # capture owns the stream and closes it exactly once

        @self.room.on('participant_connected')
        def connected(participant):
            if self.role(participant.identity) and self.grace:
                self.grace.cancel()
                self.grace = None

        @self.room.on('participant_disconnected')
        def disconnected(participant):
            if self.role(participant.identity) and not any(self.role(p.identity) for p in self.room.remote_participants.values()):
                self.schedule_close(12)

        @self.room.on('disconnected')
        def room_disconnected(*_):
            if not self.closing:
                self.schedule_close(0)

        token = (api.AccessToken().with_identity('transcriber-' + self.room_id).with_name('Caption worker')
                 .with_grants(api.VideoGrants(room_join=True, room=self.room_id,
                     can_subscribe=True, can_publish=False, can_publish_data=True)).to_jwt())
        await self.room.connect(os.environ['LIVEKIT_URL'], token, options=rtc.RoomOptions(auto_subscribe=True))
        self.consumer = asyncio.create_task(self.process())
        self.translations = [asyncio.create_task(self.translate()) for _ in range(2)]
        self.heartbeat = asyncio.create_task(self.health_loop())
        self.schedule_close(45)  # release a worker if browser never connects
        await self.status('connecting', 'Waiting for microphone audio')

    async def set_language(self, role, language):
        previous = self.languages[role]
        self.languages[role] = language
        if previous != language:
            for sid, (track, speaker) in list(self.audio_tracks.items()):
                if speaker == role and sid in self.tracks:
                    task = self.tracks[sid]
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                    if not self.closing and sid in self.audio_tracks:
                        self.tracks[sid] = asyncio.create_task(self.capture(track, role))

    def role(self, identity):
        return next((r for r in ('caller', 'receiver') if identity == r + '-' + self.room_id), None)

    def schedule_close(self, seconds):
        if self.grace:
            self.grace.cancel()
        async def later():
            await asyncio.sleep(seconds)
            if not any(self.role(p.identity) for p in self.room.remote_participants.values()):
                await self.close()
        self.grace = asyncio.create_task(later())

    async def health_loop(self):
        while not self.closing:
            await asyncio.sleep(5)
            local_needed = any(not engine.streams_language(lang) for lang in self.languages.values())
            if self.stream_errors:
                await self.publish({'type': 'status', 'roomId': self.room_id, 'status': 'unavailable',
                    'message': 'Live transcription disconnected. Use Retry service to reconnect; audio continues.', 'timestamp': now()})
            elif local_needed and engine.error:
                await self.status('unavailable', 'Speech model failed to load. Restart worker after fixing model setup.')
            elif local_needed and engine.model is None:
                await self.status('connecting', 'Downloading/loading speech model. Audio call continues.')
            elif not self.queue.empty():
                await self.publish({'type': 'status', 'roomId': self.room_id, 'status': 'processing',
                                    'message': 'Processing speech', 'timestamp': now()})
            else:
                await self.publish({'type': 'status', 'roomId': self.room_id,
                    'status': store.get(self.room_id)['status'],
                    'message': store.get(self.room_id)['message'], 'timestamp': now()})

    async def capture(self, track, role):
        if engine.streams_language(self.languages[role]):
            await self.capture_streaming(track, role)
            return
        await self.capture_whisper(track, role)

    async def capture_streaming(self, track, role):
        audio = rtc.AudioStream(track, sample_rate=16000, num_channels=1, frame_size_ms=20, capacity=100)
        self.streams[track.sid] = audio
        language = self.languages[role]
        speech = engine.stt.stream(language=language, conn_options=APIConnectOptions(max_retry=2, retry_interval=.5, timeout=8))
        segments = StreamingSegments(int((time.time() - self.epoch) * 1000), language)
        self.stream_errors.discard(role)
        stats = self.stream_stats[role] = {'audioFrames': 0, 'speechEvents': 0}

        async def collect():
            async for event in speech:
                stats['speechEvents'] += 1
                if event.type not in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
                    continue
                if not event.alternatives:
                    continue
                data = event.alternatives[0]
                segment = segments.update(data.text, data.start_time, data.end_time,
                                          event.type == stt.SpeechEventType.FINAL_TRANSCRIPT)
                if segment and 'discard' in segment:
                    await self.publish({'type': 'discard', 'roomId': self.room_id, 'segmentId': segment['discard']})
                elif segment:
                    await self.emit_segment(segment, role)
                    if store.get(self.room_id)['status'] != 'active':
                        await self.status('active', 'Streaming English and Urdu captions for each speaker')

        reader = asyncio.create_task(collect())
        read_task = None
        try:
            await self.status('active', 'Streaming English and Urdu captions for each speaker')
            iterator = audio.__aiter__()
            read_task = asyncio.create_task(iterator.__anext__())
            while not self.closing:
                done, _ = await asyncio.wait({read_task, reader}, timeout=.2,
                                             return_when=asyncio.FIRST_COMPLETED)
                if reader in done:
                    await reader
                    raise RuntimeError('Streaming recognizer stopped')
                if read_task in done:
                    try:
                        event = read_task.result()
                    except StopAsyncIteration:
                        break
                    speech.push_frame(event.frame)
                    stats['audioFrames'] += 1
                    read_task = asyncio.create_task(iterator.__anext__())
                else:
                    # Mute stops incoming frames. Silence lets the provider
                    # finalize the last words and keeps the connection alive.
                    speech.push_frame(rtc.AudioFrame(b'\0' * 6400, 16000, 1, 3200))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.stream_errors.add(role)
            await self.status('unavailable', f'Live transcription failed ({type(exc).__name__}). Retry service; audio continues.')
        finally:
            if read_task:
                read_task.cancel()
                await asyncio.gather(read_task, return_exceptions=True)
            try:
                if not reader.done():
                    speech.end_input()
                    await asyncio.wait_for(asyncio.shield(reader), 8)
            except Exception:
                pass
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
            if segments.revision:
                await self.publish({'type': 'discard', 'roomId': self.room_id, 'segmentId': segments.segment_id})
            await speech.aclose()
            await audio.aclose()
            if track.sid not in self.audio_tracks:
                self.stream_errors.discard(role)
            self.streams.pop(track.sid, None)
            self.tracks.pop(track.sid, None)

    async def capture_whisper(self, track, role):
        stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1, frame_size_ms=20, capacity=100)
        self.streams[track.sid] = stream
        vad = webrtcvad.Vad(2)
        buffer = UtteranceBuffer(max_seconds=float(os.getenv('MAX_UTTERANCE_SECONDS', '10')))
        base_ms = int((time.time() - self.epoch) * 1000)
        stream_started = time.monotonic()
        segment_id = str(uuid4())
        revision = 0

        async def enqueue(result):
            nonlocal segment_id, revision
            if result is None:
                return
            pcm, start, end, final = result
            revision += 1
            item = {'pcm': pcm, 'role': role, 'language': self.languages[role], 'segmentId': segment_id,
                    'revision': revision, 'startMs': base_ms + start // 16, 'endMs': base_ms + end // 16, 'final': final}
            if not final and (segment_id in self.partial_pending or self.queue.qsize() > 2):
                return
            try:
                self.queue_sequence += 1
                self.queue.put_nowait((0 if final else 1, self.queue_sequence, item))
                if final:
                    self.final_queued.add(segment_id)
                if not final:
                    self.partial_pending.add(segment_id)
            except asyncio.QueueFull:
                await self.status('degraded', 'Speech processing overloaded; a caption segment was dropped. Audio continues.')
            if final:
                segment_id, revision = str(uuid4()), 0
        try:
            await self.status('active' if engine.model else 'connecting', 'Listening to caller and receiver microphones' if engine.model else 'Loading speech model')
            iterator = stream.__aiter__()
            read_task = asyncio.create_task(iterator.__anext__())
            pending = b''
            while not self.closing:
                done, _ = await asyncio.wait({read_task}, timeout=0.8)
                if not done:
                    # Mute stops incoming frames; finalize speech before the pause.
                    await enqueue(buffer.flush())
                    buffer.samples = max(buffer.samples, int((time.monotonic() - stream_started) * 16000))
                    continue
                try:
                    event = read_task.result()
                except StopAsyncIteration:
                    break
                pending += bytes(event.frame.data)
                while len(pending) >= 640:
                    frame, pending = pending[:640], pending[640:]
                    await enqueue(buffer.feed(frame, vad.is_speech(frame, 16000)))
                read_task = asyncio.create_task(iterator.__anext__())
        finally:
            if 'read_task' in locals() and not read_task.done():
                read_task.cancel()
                await asyncio.gather(read_task, return_exceptions=True)
            await enqueue(buffer.flush())
            await stream.aclose()
            self.streams.pop(track.sid, None)
            self.tracks.pop(track.sid, None)

    async def process(self):
        while True:
            _, _, item = await self.queue.get()
            try:
                if not item['final'] and item['segmentId'] in self.final_queued:
                    self.partial_pending.discard(item['segmentId'])
                    self.final_queued.discard(item['segmentId'])
                    continue
                # Hold a bounded backlog while the initial model download completes.
                while engine.model is None and engine.error is None and not self.closing:
                    await asyncio.sleep(0.25)
                result = await engine.recognize(item['pcm'], item['language'], item['final'])
                self.partial_pending.discard(item['segmentId'])
                if not result:
                    if item['final']:
                        await self.publish({'type': 'discard', 'roomId': self.room_id, 'segmentId': item['segmentId']})
                    continue
                segment = {k: v for k, v in item.items() if k not in ('pcm', 'role', 'language')}
                segment.update(result)
                await self.emit_segment(segment, item['role'], recognizer='whisper/' + engine.model_name)
                if store.get(self.room_id)['status'] not in ('degraded', 'active'):
                    store.status(self.room_id, 'active', 'Listening to caller and receiver microphones')
            except Exception:
                self.partial_pending.discard(item['segmentId'])
                await self.status('degraded', 'Speech processing failed for a segment. Audio continues; check worker model/runtime.')
            finally:
                if item['final'] and item['segmentId'] not in self.partial_pending:
                    self.final_queued.discard(item['segmentId'])
                self.queue.task_done()

    async def emit_segment(self, segment, role, recognizer=None):
        segment.update(roomId=self.room_id, speaker=role, timestamp=now(),
            latencyMs=max(0, int((time.time() - self.epoch) * 1000) - segment['endMs']),
            recognizer=recognizer or 'livekit/' + engine.streaming_model,
            urdu=segment['original'] if segment['language'] == 'ur' else None,
            translationStatus='ready' if segment['language'] == 'ur' and segment['english'] else 'pending', matches=[])
        if segment['final']:
            self.history.append(segment)
            self.history = self.history[-16:]
            segment['matches'] = keyword_matches(self.history) if role == 'caller' else []
            store.save(segment)
        await self.publish({'type': 'segment', 'roomId': self.room_id, 'segment': segment})
        if segment['final'] and segment['translationStatus'] == 'pending':
            try:
                self.translation_queue.put_nowait(segment.copy())
            except asyncio.QueueFull:
                segment.update(translationStatus='unavailable', revision=segment['revision'] + 1)
                store.save(segment)
                await self.publish({'type': 'segment', 'roomId': self.room_id, 'segment': segment})

    async def translate(self):
        while True:
            segment = await self.translation_queue.get()
            try:
                started = time.monotonic()
                if segment['language'] == 'ur':
                    segment['english'] = await engine.text_translate(segment['original'], 'ur', 'en')
                else:
                    segment['urdu'] = await engine.urdu(segment['english'])
                segment['translationStatus'] = 'ready'
                segment['translationLatencyMs'] = round((time.monotonic() - started) * 1000)
            except Exception:
                segment['translationStatus'] = 'unavailable'
            finally:
                segment['revision'] += 1
                self.history = [segment if s['segmentId'] == segment['segmentId'] else s for s in self.history]
                if segment['speaker'] == 'caller':
                    context = [s for s in self.history if s['segmentId'] != segment['segmentId'] and s['startMs'] <= segment['startMs']]
                    segment['matches'] = keyword_matches(context + [segment])
                store.save(segment)
                await self.publish({'type': 'segment', 'roomId': self.room_id, 'segment': segment})
                self.translation_queue.task_done()

    async def close(self):
        if self.closing:
            return
        self.closing = True
        tracks = list(self.tracks.values())
        for task in tracks:
            task.cancel()
        await asyncio.gather(*tracks, return_exceptions=True)
        try:
            await asyncio.wait_for(self.queue.join(), timeout=30)
            await asyncio.wait_for(self.translation_queue.join(), timeout=10)
        except asyncio.TimeoutError:
            await self.status('degraded', 'Call ended before queued captions/translations completed.')
        tasks = [t for t in (self.consumer, self.heartbeat) if t] + (self.translations or [])
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for segment in store.get(self.room_id)['segments']:
            if segment['translationStatus'] == 'pending':
                segment.update(translationStatus='unavailable', revision=segment['revision'] + 1)
                store.save(segment)
                await self.publish({'type': 'segment', 'roomId': self.room_id, 'segment': segment})
        await self.status('ended', 'Call finished. Finalized captions saved separately for this call.')
        await self.room.disconnect()
        if sessions.get(self.room_id) is self:
            sessions.pop(self.room_id, None)


@asynccontextmanager
async def lifespan(app):
    store.recover()
    await engine.open_streaming()
    warmup = asyncio.create_task(engine.warmup())
    yield
    await asyncio.gather(*(s.close() for s in list(sessions.values())), return_exceptions=True)
    warmup.cancel()
    await asyncio.gather(warmup, return_exceptions=True)
    await engine.close_streaming()


app = FastAPI(lifespan=lifespan, dependencies=[Depends(authorize)])


@app.get('/health')
async def health():
    return {'ready': engine.stt is not None if engine.english_backend == 'livekit' else engine.model is not None,
            'englishBackend': engine.english_backend, 'streamingModel': engine.streaming_model,
            'urduBackend': engine.urdu_backend, 'textTranslationBackend': engine.text_backend,
            'streamingConfigured': engine.stt is not None, 'localModelReady': engine.model is not None, 'model': engine.model_name,
            'sessions': {room: s.stream_stats for room, s in sessions.items() if hasattr(s, 'stream_stats')},
            'device': engine.device, 'error': engine.error, 'translationBackend': engine.translation_backend,
            'translationError': engine.translation_error}


@app.post('/sessions')
async def start_session(body: StartRequest):
    async with start_lock:
        session = sessions.get(body.roomId)
        if session and session.closing:
            raise HTTPException(409, 'Previous worker is finishing this call. Retry shortly.')
        if session is None:
            if len(sessions) >= int(os.getenv('MAX_ACTIVE_CALLS', '4')):
                raise HTTPException(503, 'Transcription capacity reached. Audio call remains available.')
            session = CallSession(body.roomId)
            session.languages[body.role] = body.language
            sessions[body.roomId] = session
            try:
                await asyncio.wait_for(session.start(), timeout=15)
            except Exception:
                await session.close()
                raise HTTPException(503, 'Worker could not connect to LiveKit. Check worker credentials.')
        await session.set_language(body.role, body.language)
        for sid, (track, role) in list(session.audio_tracks.items()):
            if role == body.role and sid not in session.tracks and not session.closing:
                session.tracks[sid] = asyncio.create_task(session.capture(track, role))
        return {'roomId': body.roomId, 'workerIdentity': 'transcriber-' + body.roomId, 'status': store.get(body.roomId)['status']}


@app.get('/calls/{room_id}')
async def get_call(room_id: str):
    log = store.get(room_id)
    if log is None:
        raise HTTPException(404, 'No saved call log yet.')
    return log
