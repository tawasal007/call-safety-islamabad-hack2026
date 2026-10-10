import os
import asyncio
import secrets
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
os.environ['TRANSCRIPTION_WORKER_SECRET'] = secrets.token_hex(32)
os.environ['CALL_LOG_DB'] = str(root / 'test-output' / ('service-' + str(uuid4()) + '.sqlite3'))
from fastapi.testclient import TestClient
import server


class FakeSession:
    starts = 0
    def __init__(self, room_id):
        self.room_id = room_id
        self.languages = {'caller': 'auto', 'receiver': 'auto'}
        self.closing = False
        self.audio_tracks = {}
        server.store.start(room_id)

    async def start(self):
        FakeSession.starts += 1
        server.store.status(self.room_id, 'active', 'Test worker')

    async def close(self):
        self.closing = True
        server.sessions.pop(self.room_id, None)

    async def set_language(self, role, language):
        self.languages[role] = language


async def no_warmup():
    pass


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.headers = {'Authorization': 'Bearer ' + server.SECRET}
        self.patch_session = patch.object(server, 'CallSession', FakeSession)
        self.patch_warmup = patch.object(server.engine, 'warmup', no_warmup)
        self.patch_session.start()
        self.patch_warmup.start()
        self.client = TestClient(server.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.patch_session.stop()
        self.patch_warmup.stop()

    def test_all_worker_endpoints_require_authentication(self):
        for path in ('/health', '/calls/anything'):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post('/sessions', json={'roomId': 'bad'}).status_code, 401)

    def test_duplicate_start_reuses_worker_and_languages_remain_separate(self):
        room_id = 'call-' + str(uuid4())
        before = FakeSession.starts
        for role, language in (('caller', 'ur'), ('receiver', 'ur'), ('caller', 'en')):
            result = self.client.post('/sessions', headers=self.headers, json={'roomId': room_id, 'role': role, 'language': language})
            self.assertEqual(result.status_code, 200)
        self.assertEqual(FakeSession.starts, before + 1)
        self.assertEqual(server.sessions[room_id].languages, {'caller': 'en', 'receiver': 'ur'})
        self.assertEqual(self.client.get('/calls/' + room_id, headers=self.headers).status_code, 200)

    def test_invalid_room_role_and_language_rejected(self):
        valid = {'roomId': 'call-' + str(uuid4()), 'role': 'caller', 'language': 'en'}
        for key, value in (('roomId', '../secret'), ('role', 'worker'), ('language', 'bad'), ('language', 'pa')):
            self.assertEqual(self.client.post('/sessions', headers=self.headers, json={**valid, key: value}).status_code, 422)


class EngineTests(unittest.TestCase):
    def test_provisional_urdu_does_not_delay_final_speech_with_translation(self):
        calls = []
        class Model:
            def transcribe(self, audio, **kwargs):
                calls.append(kwargs['task'])
                part = SimpleNamespace(text='اپنا پاس ورڈ بتائیں', no_speech_prob=.1, avg_logprob=-.2)
                return iter([part]), SimpleNamespace(language='ur', language_probability=1)
        engine = server.Engine()
        engine.model = Model()
        result = engine._recognize(b'\0' * 32000, 'ur', False)
        self.assertEqual(calls, ['transcribe'])
        self.assertEqual(result['english'], '')
        self.assertIn('پاس ورڈ', result['original'])
        self.assertIsNone(result['languageProbability'])

    def test_auto_urdu_is_decoded_in_urdu_script_despite_hindi_probability(self):
        calls = []
        class Model:
            def detect_language(self, audio):
                return 'hi', .9, [('hi', .9), ('ur', .08), ('en', .02)]
            def transcribe(self, audio, **kwargs):
                calls.append(kwargs)
                text = 'اپنا پاس ورڈ بتائیں' if kwargs['task'] == 'transcribe' else 'Tell me your password.'
                part = SimpleNamespace(text=text, no_speech_prob=.1, avg_logprob=-.2)
                return iter([part]), SimpleNamespace(language='ur', language_probability=1)
        engine = server.Engine()
        engine.model = Model()
        result = engine._recognize(b'\0' * 32000, 'auto', True)
        self.assertEqual(result['language'], 'ur')
        self.assertEqual(result['languageProbability'], .08)
        self.assertEqual([c['language'] for c in calls], ['ur', 'ur'])
        self.assertEqual([c['task'] for c in calls], ['transcribe', 'translate'])
        self.assertIn('پاس ورڈ', result['original'])

    def test_speech_model_filters_silence_hallucination(self):
        class Model:
            def transcribe(self, audio, **kwargs):
                part = SimpleNamespace(text='Thank you for watching', no_speech_prob=.95, avg_logprob=-2)
                return iter([part]), SimpleNamespace(language='en', language_probability=1)
        engine = server.Engine()
        engine.model = Model()
        self.assertIsNone(engine._recognize(b'\0' * 32000, 'en', True))


class StreamRelayTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, fail=False):
        class Audio:
            count = 0
            closed = False
            def __aiter__(self):
                return self
            async def __anext__(self):
                if fail:
                    await asyncio.sleep(10)
                if self.count == 100:
                    raise StopAsyncIteration
                self.count += 1
                return SimpleNamespace(frame=object())
            async def aclose(self):
                self.closed = True

        class Speech:
            frames = 0
            closed = False
            def __init__(self):
                self.ended = asyncio.Event()
            def __aiter__(self):
                return self
            async def __anext__(self):
                if fail:
                    raise ConnectionError('Synthetic disconnect')
                await self.ended.wait()
                raise StopAsyncIteration
            def push_frame(self, frame):
                self.frames += 1
            def end_input(self):
                self.ended.set()
            async def aclose(self):
                self.closed = True

        audio, speech = Audio(), Speech()
        session = server.CallSession('call-' + str(uuid4()))
        session.status = AsyncMock()
        session.publish = AsyncMock()
        session.audio_tracks['test'] = (SimpleNamespace(sid='test'), 'caller')
        model = SimpleNamespace(stream=lambda **kwargs: speech)
        with patch.object(server.rtc, 'AudioStream', return_value=audio), patch.object(server.engine, 'stt', model):
            # The result reader lasts for the whole stream. Waiting for both
            # tasks per frame would throttle audio to 5fps and cause drops.
            await asyncio.wait_for(session.capture_streaming(SimpleNamespace(sid='test'), 'caller'), 1)
        self.assertTrue(audio.closed and speech.closed)
        self.assertFalse(session.streams)
        return session, speech

    async def test_audio_relay_does_not_wait_for_recognition_per_frame(self):
        session, speech = await self.exercise()
        self.assertEqual(speech.frames, 100)
        self.assertEqual(session.stream_stats['caller']['audioFrames'], 100)

    async def test_provider_disconnect_is_visible_and_cleans_up_for_retry(self):
        session, speech = await self.exercise(fail=True)
        self.assertIn('caller', session.stream_errors)
        self.assertEqual(session.status.call_args.args[0], 'unavailable')
        self.assertIn('Retry', session.status.call_args.args[1])


class TranslationTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, fail=False):
        session = server.CallSession('call-' + str(uuid4()))
        session.publish = AsyncMock()
        original = 'مجھے اپنا پاس ورڈ بتائیں'
        await session.emit_segment({'segmentId': str(uuid4()), 'revision': 1, 'final': True,
            'startMs': 0, 'endMs': 1000, 'original': original, 'english': '', 'language': 'ur'}, 'caller')
        first = server.store.get(session.room_id)['segments'][0]
        self.assertEqual(first['urdu'], original)
        self.assertEqual(first['english'], '')
        self.assertEqual(first['translationStatus'], 'pending')
        self.assertTrue(first['matches'], 'Source evidence must not wait for translation')
        translator = AsyncMock(return_value='Tell me your password.')
        if fail:
            translator.side_effect = ConnectionError('Synthetic translation failure')
        with patch.object(server.engine, 'text_translate', translator):
            task = asyncio.create_task(session.translate())
            await asyncio.wait_for(session.translation_queue.join(), 1)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        result = server.store.get(session.room_id)['segments'][0]
        self.assertEqual(result['urdu'], original)
        self.assertEqual(result['original'], original)
        self.assertEqual(result['segmentId'], first['segmentId'])
        self.assertEqual(result['revision'], 2)
        self.assertTrue(result['matches'])
        translator.assert_awaited_once_with(original, 'ur', 'en')
        return result

    async def test_urdu_is_published_saved_and_matched_before_english_translation(self):
        result = await self.exercise()
        self.assertEqual(result['english'], 'Tell me your password.')
        self.assertEqual(result['translationStatus'], 'ready')

    async def test_translation_failure_preserves_urdu_and_exposes_unavailability(self):
        result = await self.exercise(fail=True)
        self.assertEqual(result['english'], '')
        self.assertEqual(result['translationStatus'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
