"""Check a fresh call room dispatches the local transcriber worker."""

import asyncio

import aiohttp
from livekit import rtc


async def main():
    async with aiohttp.ClientSession() as http:
        async with http.post("http://127.0.0.1:3000/api/rooms") as response:
            response.raise_for_status()
            created = await response.json()
        async with http.post("http://127.0.0.1:3000/api/rooms/join", json={
            "roomId": created["roomId"], "accessKey": created["callerAccessKey"],
        }) as response:
            response.raise_for_status()
            joined = await response.json()

    room = rtc.Room()
    await room.connect(joined["serverUrl"], joined["token"])
    try:
        for _ in range(20):
            if room.remote_participants:
                print("Transcription worker joined fresh room")
                return
            await asyncio.sleep(1)
        identities = [participant.identity for participant in room.remote_participants.values()]
        print("No worker in room after 20 seconds; remote participants:", identities)
        raise SystemExit(1)
    finally:
        await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
