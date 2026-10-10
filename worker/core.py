"""Provider-independent segmentation, contextual phrase matching and durable call logs."""
import json
import re
import sqlite3
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def keyword_matches(segments):
    """Limited, explainable rules; never a fraud probability or a crime determination."""
    caller = [s for s in segments if s['speaker'] == 'caller' and s['final']][-8:]
    if not caller:
        return []
    latest = caller[-1]
    matches = []
    patterns = {
        'credential_request': r'\b(?:tell|give|send|share|read|provide|confirm)\b.{0,55}\b(?:otp|pin|password|verification code|one.time (?:code|password)|bank details)\b',
        'payment_request': r'\b(?:send|transfer|pay|deposit)\b.{0,50}\b(?:money|cash|rupees|rs\.?|payment|ransom|me|\d+)\b',
        'impersonation': r'\b(?:i am|i.m|we are|calling)\b.{0,40}\b(?:bank|police|government|support|officer)\b',
        'pressure': r'\b(?:account.{0,20}(?:blocked|closed)|right now|immediately|urgent|within.{0,12}minutes)\b',
        'threat': r'\b(?:i|we)\s+(?:will|are going to|shall)\s+(?:hurt|kill|harm|shoot|attack)\b.{0,40}',
        'private_information_threat': r'\b(?:publish|release|leak|expose)\b.{0,45}\b(?:photos|pictures|videos|private|secrets)\b',
        'kidnapping_claim': r'\b(?:we have|i have|kidnapped|holding)\b.{0,45}\b(?:brother|sister|child|son|daughter|father|mother|family|hostage)\b',
        'coercion': r'\b(?:do not|don.t|must not|never)\s+(?:hang up|contact|tell|call)\b.{0,35}',
    }
    # Exclude advice and reported/fictional speech per sentence; a later direct
    # request in the same utterance is still considered.
    harmless = r'\b(?:(?:never|do not|don.t)\s+(?:share|give|send|tell|provide|read)|otp expired|movie|film|story|if someone|if a caller|he said|she said|they said)\b'
    # Urdu uses Unicode word boundaries too: standalone پن must not match اپنا.
    # Keep actual recognized wording, including common Whisper password spellings.
    urdu_credential = r'\b(?:او\s*ٹی\s*پی|اوٹیپی|OTP|پن|پاس\s*ور[ڈدٹ]|پاسورڈ|خفیہ\s*کوڈ)\b'
    urdu_request = r'\b(?:بتا(?:ئیں|ؤ|و|نا|دیں)?|دیں|بھیج(?:یں|و|نا)?|شیئر|پڑھ(?:یں|و)?|فراہم)\b'
    urdu_patterns = {
        'credential_request': rf'{urdu_credential}.{{0,35}}{urdu_request}|{urdu_request}.{{0,35}}{urdu_credential}',
        'payment_request': r'(?:پیسے|رقم|روپے|تاوان).{0,35}(?:بھیج|ادا|دیں|دو|منتقل|جمع)|(?:بھیج|منتقل|ادا).{0,35}(?:پیسے|رقم|روپے|تاوان)',
        'impersonation': r'(?:میں|ہم).{0,45}(?:بینک|پولیس|افسر|سرکاری).{0,20}(?:سے|ہوں|ہیں)',
        'pressure': r'(?:اکاؤنٹ|اکاونٹ|اکانٹ|کھاتہ).{0,25}(?:بند|بلاک|منجمد)|(?:فوراً|فوری|ابھی|جلدی)',
        'threat': r'(?:مار|قتل).{0,12}(?:دوں|دیں|کریں|کروں)|نقصان.{0,12}(?:پہنچاؤں|پہنچائیں)',
        'private_information_threat': r'(?:تصویر|ویڈیو|راز).{0,35}(?:نشر|شائع|لیک|وائرل)|(?:نشر|شائع|لیک|وائرل).{0,35}(?:تصویر|ویڈیو|راز)',
        'kidnapping_claim': r'(?:بھائی|بہن|بیٹا|بیٹی|بچہ|بچے|والد|والدہ).{0,35}(?:ہمارے پاس|میرے پاس|اغوا|یرغمال)',
        'coercion': r'(?:فون|کال).{0,12}(?:بند|کاٹ).{0,8}(?:مت|نہ)|(?:کسی|گھر|خاندان).{0,25}(?:بتا|رابطہ).{0,10}(?:مت|نہ)|(?:مت|نہ).{0,8}(?:بتا|رابطہ)',
    }
    urdu_harmless = r'(?:مت|نہ)\s*(?:بتا|دیں|بھیج|شیئر|کریں)|(?:بتا|دیں|بھیج|شیئر).{0,8}(?:مت|نہیں)|(?:فلم|کہانی|ڈرامہ)|اگر\s*کوئی'
    evidence = {}
    for segment in caller:
        text = segment.get('english', '')
        for sentence in re.split(r'(?<=[.!?])\s+', text):
            if re.search(harmless, sentence, re.I):
                continue
            for category, pattern in patterns.items():
                hit = re.search(pattern, sentence, re.I)
                if hit:
                    evidence.setdefault(category, []).append((segment, hit.group(0), 'en'))
        if segment.get('language') == 'ur':
            for sentence in re.split(r'(?<=[۔؟.!?])\s*', segment.get('original', '')):
                for category, pattern in urdu_patterns.items():
                    if category != 'coercion' and re.search(urdu_harmless, sentence):
                        continue
                    hit = re.search(pattern, sentence, re.I)
                    if hit:
                        evidence.setdefault(category, []).append((segment, hit.group(0), 'ur'))
    # Connect a direct request split by a pause: "Tell me your" -> "OTP now".
    # Evidence in each emitted match still quotes exact text from its segment.
    pieces = [s for s in caller[-3:] if latest['startMs'] - s['endMs'] <= 60000
              and not re.search(harmless, s.get('english', ''), re.I)]
    if len(pieces) > 1 and pieces[-1]['segmentId'] == latest['segmentId']:
        combined = ' '.join(s['english'] for s in pieces)
        latest_start = len(combined) - len(latest['english'])
        for category, pattern in patterns.items():
            for hit in re.finditer(pattern, combined, re.I):
                if hit.start() < latest_start < hit.end():
                    quote = latest['english'][:hit.end() - latest_start]
                    evidence.setdefault(category, []).append((latest, quote, 'en'))
    # Context must be recent in actual call time, not merely the last N entries.
    recent = {k: [(s, quote, lang) for s, quote, lang in v if latest['startMs'] - s['endMs'] <= 60000]
              for k, v in evidence.items()}
    recent = {k: v for k, v in recent.items() if v}
    categories = set(recent)
    allowed = {'credential_request', 'threat', 'kidnapping_claim'}
    if 'payment_request' in categories and categories & {'threat', 'private_information_threat', 'kidnapping_claim'}:
        allowed |= {'payment_request', 'private_information_threat'}
    if 'credential_request' in categories or ('payment_request' in categories and 'impersonation' in categories):
        allowed |= {'impersonation', 'pressure', 'payment_request'}
    if categories & {'threat', 'kidnapping_claim', 'private_information_threat'}:
        allowed.add('coercion')
    for category in sorted(categories & allowed):
        for segment, quote, lang in recent[category]:
            # Emit only matches in this segment; earlier context supports them.
            if segment['segmentId'] == latest['segmentId']:
                matches.append({'category': category, 'evidence': quote, 'evidenceLanguage': lang,
                                'segmentId': segment['segmentId'],
                                'contextSegmentIds': sorted({s['segmentId'] for v in recent.values() for s, _, _ in v})})
    return matches


class UtteranceBuffer:
    """20ms VAD frames, 200ms pre-roll, 600ms silence endpoint; bounded memory."""
    def __init__(self, max_seconds=10, interim_seconds=1.5):
        self.pre = deque(maxlen=10)
        self.frames = []
        self.silence = 0
        self.voiced = 0
        self.samples = 0
        self.start_sample = 0
        self.max_frames = int(max_seconds * 50)
        self.interim_frames = int(interim_seconds * 50)
        self.last_interim = 0

    def feed(self, frame, speech):
        self.samples += 320
        if not self.frames:
            if not speech:
                self.pre.append(frame)
                return None
            self.frames = list(self.pre)
            self.pre.clear()
            self.start_sample = self.samples - 320 * (len(self.frames) + 1)
        self.frames.append(frame)
        self.voiced += int(speech)
        self.silence = 0 if speech else self.silence + 1
        if self.silence >= 30 or len(self.frames) >= self.max_frames:
            return self.flush()
        if self.voiced >= 15 and len(self.frames) - self.last_interim >= self.interim_frames:
            self.last_interim = len(self.frames)
            return (b''.join(self.frames), self.start_sample, self.samples, False)
        return None

    def flush(self):
        result = (b''.join(self.frames), self.start_sample, self.samples, True) if self.voiced >= 15 else None
        self.frames = []
        self.silence = self.voiced = self.last_interim = 0
        return result


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.lock = threading.RLock()
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS calls (room_id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
                ended_at TEXT, status TEXT NOT NULL, message TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS segments (room_id TEXT NOT NULL, segment_id TEXT NOT NULL,
                start_ms INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(room_id,segment_id));
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, room_id TEXT NOT NULL,
                timestamp TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL);
        ''')
        self.db.commit()

    def start(self, room_id):
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO calls VALUES (?,?,NULL,'connecting','Connecting transcription worker')", (room_id, now()))
            self.db.execute("UPDATE calls SET ended_at=NULL WHERE room_id=?", (room_id,))

    def status(self, room_id, status, message):
        with self.lock, self.db:
            self.db.execute('UPDATE calls SET status=?, message=? WHERE room_id=?', (status, message, room_id))
            self.db.execute('INSERT INTO events(room_id,timestamp,status,message) VALUES (?,?,?,?)', (room_id, now(), status, message))
            if status == 'ended':
                self.db.execute('UPDATE calls SET ended_at=? WHERE room_id=?', (now(), room_id))

    def save(self, segment):
        if not segment['final']:
            return
        with self.lock, self.db:
            self.db.execute('''INSERT INTO segments VALUES (?,?,?,?,?)
                ON CONFLICT(room_id,segment_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload
                WHERE excluded.revision > segments.revision''',
                (segment['roomId'], segment['segmentId'], segment['startMs'], segment['revision'], json.dumps(segment, ensure_ascii=False)))

    def get(self, room_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM calls WHERE room_id=?', (room_id,)).fetchone()
            if not row:
                return None
            segments = [json.loads(r[0]) for r in self.db.execute('SELECT payload FROM segments WHERE room_id=? ORDER BY start_ms,segment_id', (room_id,))]
            events = [{'timestamp': t, 'status': s, 'message': m} for t, s, m in self.db.execute('SELECT timestamp,status,message FROM events WHERE room_id=? ORDER BY id', (room_id,))]
            return {'roomId': row[0], 'startedAt': row[1], 'endedAt': row[2], 'status': row[3], 'message': row[4], 'segments': segments, 'events': events}

    def recover(self):
        with self.lock, self.db:
            rows = self.db.execute("SELECT room_id FROM calls WHERE status != 'ended'").fetchall()
            for (room_id,) in rows:
                self.finish_pending(room_id)
                self.status(room_id, 'ended', 'Worker restarted; previous call processing stopped. Saved transcripts retained.')

    def finish_pending(self, room_id):
        for segment in self.get(room_id)['segments']:
            if segment.get('translationStatus') == 'pending':
                segment.update(translationStatus='unavailable', revision=segment['revision'] + 1)
                self.save(segment)
