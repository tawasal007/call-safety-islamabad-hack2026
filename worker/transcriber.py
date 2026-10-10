"""Silent, two-speaker LiveKit transcriber. Run: python worker/transcriber.py dev"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent, AgentServer, AgentSession, AutoSubscribe, JobContext,
    StopResponse, cli, inference, llm, room_io, utils,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
logger = logging.getLogger("call-transcriber")
logging.getLogger("livekit.agents").setLevel(logging.INFO)


async def save_segment(room_id: str, speaker: str, text: str) -> None:
    secret = os.environ.get("TRANSCRIPT_WORKER_SECRET", "")
    app_url = os.environ.get("TRANSCRIPT_APP_URL", "http://127.0.0.1:3000").rstrip("/")
    if len(secret) < 32:
        logger.error("TRANSCRIPT_WORKER_SECRET is missing; transcript cannot be saved")
        return
    payload = {
        "roomId": room_id, "id": str(uuid.uuid4()), "speaker": speaker,
        "text": text, "at": datetime.now(timezone.utc).isoformat(),
    }
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for attempt in range(3):
            try:
                async with session.post(
                    f"{app_url}/api/internal/transcripts",
                    json=payload,
                    headers={"Authorization": f"Bearer {secret}"},
                ) as response:
                    if response.status == 200:
                        return
                    logger.error("Transcript save failed (%s): %s", response.status, await response.text())
                    if response.status < 500:
                        return
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                logger.warning("Transcript save attempt %s failed: %s", attempt + 1, exc)
            await asyncio.sleep(attempt + 1)
    logger.error("Transcript segment could not be persisted for room %s", room_id)


class Transcriber(Agent):
    def __init__(self, room_id: str, participant_identity: str):
        super().__init__(instructions="Transcribe only.", stt=inference.STT("deepgram/nova-3"))
        self.room_id = room_id
        self.participant_identity = participant_identity

    async def on_user_turn_completed(self, chat_ctx: llm.ChatContext, new_message: llm.ChatMessage):
        text = (new_message.text_content or "").strip()
        speaker = "caller" if self.participant_identity.startswith("caller-") else "receiver"
        if text:
            logger.info("saving final %s transcript segment", speaker)
            await save_segment(self.room_id, speaker, text)
        raise StopResponse()


class MultiUserTranscriber:
    def __init__(self, ctx: JobContext):
        self.ctx = ctx
        self.sessions: dict[str, AgentSession] = {}
        self.starting: set[str] = set()
        self.tasks: set[asyncio.Task] = set()

    def on_connected(self, participant: rtc.RemoteParticipant):
        identity = participant.identity
        if not (identity.startswith("caller-") or identity.startswith("receiver-")):
            return
        if identity in self.sessions or identity in self.starting:
            return
        self.starting.add(identity)
        task = asyncio.create_task(self.start_session(participant))
        self.tasks.add(task)
        task.add_done_callback(self.session_started)

    def session_started(self, task: asyncio.Task):
        self.tasks.discard(task)
        try:
            identity, session = task.result()
            self.starting.discard(identity)
            if identity in self.ctx.room.remote_participants:
                self.sessions[identity] = session
            else:
                close_task = asyncio.create_task(self.close_session(session))
                self.tasks.add(close_task)
                close_task.add_done_callback(self.tasks.discard)
        except Exception:
            logger.exception("Could not start a participant transcription session")

    async def start_session(self, participant: rtc.RemoteParticipant):
        identity = participant.identity
        session = AgentSession()
        await session.start(
            agent=Transcriber(self.ctx.room.name, identity),
            room=self.ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=True, text_output=True, audio_output=False,
                participant_identity=identity, text_input=False,
            ),
        )
        return identity, session

    def on_disconnected(self, participant: rtc.RemoteParticipant):
        self.starting.discard(participant.identity)
        session = self.sessions.pop(participant.identity, None)
        if session:
            task = asyncio.create_task(self.close_session(session))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

    async def close_session(self, session: AgentSession):
        try:
            await session.drain()
        except RuntimeError:
            # LiveKit closes the session itself when its participant leaves first.
            pass
        await session.aclose()

    async def aclose(self):
        await utils.aio.cancel_and_wait(*self.tasks)
        await asyncio.gather(*(self.close_session(session) for session in self.sessions.values()))
        self.ctx.room.off("participant_connected", self.on_connected)
        self.ctx.room.off("participant_disconnected", self.on_disconnected)


server = AgentServer()


@server.rtc_session(agent_name="call-transcriber")
async def entrypoint(ctx: JobContext):
    transcriber = MultiUserTranscriber(ctx)
    ctx.room.on("participant_connected", transcriber.on_connected)
    ctx.room.on("participant_disconnected", transcriber.on_disconnected)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    for participant in ctx.room.remote_participants.values():
        transcriber.on_connected(participant)
    ctx.add_shutdown_callback(transcriber.aclose)


if __name__ == "__main__":
    cli.run_app(server)
