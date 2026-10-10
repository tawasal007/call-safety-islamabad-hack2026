"""Configure local worker without printing or replacing existing credentials."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parent.parent
path = root / '.env.local'
text = path.read_text(encoding='utf-8') if path.exists() else ''
existing = {line.split('=', 1)[0].strip() for line in text.splitlines() if '=' in line and not line.lstrip().startswith('#')}
values = {'TRANSCRIPTION_WORKER_URL': 'http://127.0.0.1:8001',
          'TRANSCRIPTION_WORKER_SECRET': secrets.token_hex(32),
          'WHISPER_MODEL': 'small', 'WHISPER_DEVICE': 'cpu', 'WHISPER_COMPUTE_TYPE': 'int8',
          'URDU_TRANSLATION_BACKEND': 'local',
          'ENGLISH_STT_BACKEND': 'livekit', 'URDU_STT_BACKEND': 'livekit',
          'LIVEKIT_STT_MODEL': 'deepgram/nova-3', 'TEXT_TRANSLATION_BACKEND': 'livekit',
          'LIVEKIT_TRANSLATION_MODEL': 'google/gemini-3.1-flash-lite'}
new = [f'{key}={value}' for key, value in values.items() if key not in existing]
if new:
    with path.open('a', encoding='utf-8') as output:
        output.write('\n# Local transcription worker\n' + '\n'.join(new) + '\n')
print('Local transcription settings configured. Existing values preserved; secrets not displayed.')
