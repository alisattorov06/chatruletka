import json
import asyncio
from typing import Dict, Optional
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.waiting_queue: list = []
        self.rooms: Dict[str, Dict] = {}
        self.user_rooms: Dict[int, str] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: int):
        self.active_connections.pop(user_id, None)
        if user_id in self.waiting_queue:
            self.waiting_queue.remove(user_id)

    async def send_to_user(self, user_id: int, data: dict):
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_text(json.dumps(data))
            except:
                pass

    async def add_to_queue(self, user_id: int) -> Optional[str]:
        if user_id in self.user_rooms:
            await self.leave_room(user_id)

        if user_id in self.waiting_queue:
            return None

        if self.waiting_queue:
            partner_id = self.waiting_queue.pop(0)
            if partner_id == user_id:
                if self.waiting_queue:
                    partner_id = self.waiting_queue.pop(0)
                else:
                    self.waiting_queue.append(user_id)
                    return None

            room_id = f"room_{min(user_id, partner_id)}_{max(user_id, partner_id)}_{id(asyncio.get_event_loop())}"
            self.rooms[room_id] = {"users": [user_id, partner_id]}
            self.user_rooms[user_id] = room_id
            self.user_rooms[partner_id] = room_id

            await self.send_to_user(user_id, {"type": "matched", "room_id": room_id, "partner_id": partner_id, "role": "caller"})
            await self.send_to_user(partner_id, {"type": "matched", "room_id": room_id, "partner_id": user_id, "role": "callee"})
            return room_id
        else:
            self.waiting_queue.append(user_id)
            await self.send_to_user(user_id, {"type": "waiting"})
            return None

    async def leave_room(self, user_id: int):
        room_id = self.user_rooms.get(user_id)
        if room_id and room_id in self.rooms:
            room = self.rooms[room_id]
            for uid in room["users"]:
                if uid != user_id:
                    await self.send_to_user(uid, {"type": "partner_left"})
                self.user_rooms.pop(uid, None)
            del self.rooms[room_id]

    async def relay_signal(self, user_id: int, data: dict):
        room_id = self.user_rooms.get(user_id)
        if room_id and room_id in self.rooms:
            for uid in self.rooms[room_id]["users"]:
                if uid != user_id:
                    await self.send_to_user(uid, data)

    def get_online_count(self) -> int:
        return len(self.active_connections)

manager = ConnectionManager()