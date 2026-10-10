"""Real LiveKit audio -> worker -> caption event -> durable log smoke test.

Supply a mono 16kHz PCM16 WAV. Never prints room invitations or access tokens.
"""
import argparse
import asyncio
import json
import sys
import wave
from pathlib import Path

import httpx
from livekit import rtc


async def run(base, wav_path, language):
    with wave.open(str(wav_path), 'rb') as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        audio = wav.readframes(wav.getnframes())
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(base + '/api/rooms')
        response.raise_for_status()
        created = response.json()
        from urllib.parse import urlparse, parse_qs
        receiver_key = parse_qs(urlparse(created['inviteUrl']).query)['invite'][0]
        room_id = created['roomId']
        output = Path(__file__).resolve().parents[1] / 'worker' / 'test-output'
        output.mkdir(exist_ok=True)
        # Local test handover only; invitations are deliberately kept out of console output.
        (output / f'smoke-room-{language}.json').write_text(json.dumps(created), encoding='utf-8')
        grants = []
        for key in [created['callerAccessKey'], receiver_key]:
            response = await client.post(base + '/api/rooms/join', json={'roomId': room_id, 'accessKey': key})
            response.raise_for_status()
            grants.append(response.json())
        rooms = [rtc.Room(), rtc.Room()]
        events = []
        @rooms[1].on('data_received')
        def received(packet):
            if packet.participant and packet.participant.identity == 'transcriber-' + room_id and packet.topic == 'call-safety.transcription':
                events.append(json.loads(packet.data))
        try:
            sources = []
            for room, grant in zip(rooms, grants):
                await room.connect(grant['serverUrl'], grant['token'])
            for key in [created['callerAccessKey'], receiver_key]:
                response = await client.post(base + '/api/transcription', json={'roomId': room_id, 'accessKey': key, 'language': language})
                response.raise_for_status()
            for room in rooms:
                source = rtc.AudioSource(16000, 1)
                track = rtc.LocalAudioTrack.create_audio_track('smoke-microphone', source)
                options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
                await room.local_participant.publish_track(track, options)
                sources.append(source)
            await asyncio.sleep(2)
            # Sequential speaker turns make attribution easy to assess.
            for speaker, source in zip(('caller', 'receiver'), sources):
                for offset in range(0, len(audio), 640):
                    data = audio[offset:offset + 640].ljust(640, b'\0')
                    await source.capture_frame(rtc.AudioFrame(data, 16000, 1, 320))
                    await asyncio.sleep(0.02)
                for _ in range(50):
                    await source.capture_frame(rtc.AudioFrame(b'\0' * 640, 16000, 1, 320))
                    await asyncio.sleep(0.02)
            log = None
            for _ in range(60):
                response = await client.post(base + '/api/calls/' + room_id, json={'historyKey': grants[0]['historyAccessKey']})
                if response.status_code == 200:
                    log = response.json()
                    if all(any(s['speaker'] == speaker and 'password' in s['english'].lower()
                               for s in log['segments']) for speaker in ('caller', 'receiver')) and all(s['translationStatus'] == 'ready' for s in log['segments']):
                        break
                await asyncio.sleep(2)
            assert log and {'caller', 'receiver'} <= {s['speaker'] for s in log['segments']}, 'Missing speaker captions'
            assert any('password' in s['english'].lower() for s in log['segments']), 'Speech fixture not recognized'
            assert any(s['matches'] for s in log['segments'] if s['speaker'] == 'caller'), 'Caller keyword evidence missing'
            assert not any(s['matches'] for s in log['segments'] if s['speaker'] == 'receiver'), 'Receiver incorrectly flagged as caller'
            assert any(e['type'] == 'segment' for e in events), 'No worker caption events received'
            assert all(s['urdu'] and s['translationStatus'] == 'ready' for s in log['segments']), 'Urdu captions not ready'
            denied = await client.post(base + '/api/calls/' + room_id, json={'historyKey': 'invalid'})
            assert denied.status_code == 403
            print(json.dumps({'language': language, 'audioToCaption': 'passed', 'urduCaptions': 'passed', 'speakerAttribution': 'passed', 'keywordEvidence': 'passed',
                'liveEvents': len(events), 'savedSegments': len(log['segments']), 'historyAuthorization': 'passed',
                'captionLatencyFromSegmentEndSeconds': [round(s['latencyMs'] / 1000, 2) for s in log['segments']],
                'transcripts': [{'speaker': s['speaker'], 'english': s['english'], 'urduStatus': s['translationStatus']} for s in log['segments']]}, ensure_ascii=True))
            (output / f'smoke-log-{language}.json').write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding='utf-8')
        finally:
            for source in sources:
                await source.aclose()
            for room in rooms:
                await room.disconnect()
        for _ in range(30):
            response = await client.post(base + '/api/calls/' + room_id, json={'historyKey': grants[0]['historyAccessKey']})
            if response.status_code == 200 and response.json()['status'] == 'ended':
                (output / f'smoke-log-{language}.json').write_text(json.dumps(response.json(), ensure_ascii=False, indent=2), encoding='utf-8')
                print('Worker released the empty room and finalized its saved call log.')
                break
            await asyncio.sleep(2)
        else:
            raise AssertionError('Worker did not finish after participants left')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3010')
    parser.add_argument('--wav', type=Path, required=True)
    parser.add_argument('--language', choices=['en', 'ur'], default='en')
    args = parser.parse_args()
    asyncio.run(run(args.base.rstrip('/'), args.wav, args.language))
