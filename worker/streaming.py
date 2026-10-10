"""Convert streaming STT revisions to the existing per-call caption protocol."""
from uuid import uuid4


class StreamingSegments:
    def __init__(self, base_ms, language='en'):
        if language not in ('en', 'ur'):
            raise ValueError('Streaming captions support English and Urdu')
        self.language = language
        self.base_ms = base_ms
        self.segment_id = str(uuid4())
        self.revision = 0
        self.last_final_end = -1
        self.last_partial = None

    def update(self, text, start, end, final):
        text = text.strip()
        start_ms = self.base_ms + max(0, round(start * 1000))
        end_ms = max(start_ms, self.base_ms + round(end * 1000))
        if final and not text:
            discarded = self.segment_id if self.revision else None
            self.reset()
            return {'discard': discarded} if discarded else None
        if not text or end_ms <= self.last_final_end:
            return None
        partial = (text, start_ms, end_ms)
        if not final and partial == self.last_partial:
            return None
        self.revision += 1
        result = {'segmentId': self.segment_id, 'revision': self.revision,
                  'startMs': start_ms, 'endMs': end_ms, 'final': final,
                  'original': text, 'english': text if self.language == 'en' else '', 'language': self.language,
                  'languageProbability': None}
        self.last_partial = partial
        if final:
            self.last_final_end = end_ms
            self.reset()
        return result

    def reset(self):
        self.segment_id = str(uuid4())
        self.revision = 0
        self.last_partial = None
