import json
import os
from fastapi import FastAPI, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
import aiosqlite

from .database import init_db, get_db, DB_PATH
from .models import UserRegister, UserLogin
from .auth import hash_password, verify_password, create_token, get_current_user, get_current_user_optional
from .websocket_manager import manager

BASE_DIR = os.path.dirname(os.path.dirname(__file__))

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

@app.get("/", response_class=HTMLResponse)
async def root(request: Request, user=Depends(get_current_user_optional)):
    if user:
        return RedirectResponse("/dashboard")
    return RedirectResponse("/login")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user=Depends(get_current_user_optional)):
    if user:
        return RedirectResponse("/dashboard")
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request, user=Depends(get_current_user_optional)):
    if user:
        return RedirectResponse("/dashboard")
    return templates.TemplateResponse("register.html", {"request": request})

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request, user=Depends(get_current_user)):
    return templates.TemplateResponse("dashboard.html", {"request": request, "user": user})

@app.get("/chat", response_class=HTMLResponse)
async def chat_page(request: Request, user=Depends(get_current_user)):
    return templates.TemplateResponse("chat.html", {"request": request, "user": user})

@app.post("/api/register")
async def register(data: UserRegister):
    if data.password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Parollar mos kelmadi")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Parol kamida 6 ta belgidan iborat bo'lishi kerak")
    if len(data.username) < 3:
        raise HTTPException(status_code=400, detail="Username kamida 3 ta belgidan iborat bo'lishi kerak")

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        existing = await db.execute("SELECT id FROM users WHERE username = ?", (data.username,))
        if await existing.fetchone():
            raise HTTPException(status_code=400, detail="Bu username band")

        hashed = hash_password(data.password)
        cursor = await db.execute(
            "INSERT INTO users (first_name, last_name, username, password_hash) VALUES (?, ?, ?, ?)",
            (data.first_name, data.last_name, data.username, hashed)
        )
        await db.commit()
        user_id = cursor.lastrowid

    token = create_token(user_id, data.username)
    response = JSONResponse({"success": True, "message": "Muvaffaqiyatli ro'yxatdan o'tildi"})
    response.set_cookie("access_token", token, httponly=True, max_age=86400)
    return response

@app.post("/api/login")
async def login(data: UserLogin):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM users WHERE username = ?", (data.username,))
        user = await cursor.fetchone()

    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Noto'g'ri username yoki parol")

    token = create_token(user["id"], user["username"])
    response = JSONResponse({"success": True, "message": "Muvaffaqiyatli kirildi"})
    response.set_cookie("access_token", token, httponly=True, max_age=86400)
    return response

@app.post("/api/logout")
async def logout():
    response = JSONResponse({"success": True})
    response.delete_cookie("access_token")
    return response

@app.get("/api/check-username/{username}")
async def check_username(username: str):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT id FROM users WHERE username = ?", (username,))
        exists = await cursor.fetchone()
    return {"available": not exists}

@app.get("/api/me")
async def get_me(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT id, first_name, last_name, username, created_at FROM users WHERE id = ?", (user["user_id"],))
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    return dict(row)

@app.get("/api/history")
async def get_history(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT cs.id, cs.started_at, cs.ended_at,
                   u1.username as user1_username, u1.first_name as user1_first,
                   u2.username as user2_username, u2.first_name as user2_first
            FROM chat_sessions cs
            JOIN users u1 ON cs.user1_id = u1.id
            JOIN users u2 ON cs.user2_id = u2.id
            WHERE cs.user1_id = ? OR cs.user2_id = ?
            ORDER BY cs.started_at DESC
            LIMIT 20
        """, (user["user_id"], user["user_id"]))
        sessions = await cursor.fetchall()

    result = []
    for s in sessions:
        s = dict(s)
        if s["user1_username"] == user["username"]:
            partner = s["user2_username"]
            partner_first = s["user2_first"]
        else:
            partner = s["user1_username"]
            partner_first = s["user1_first"]
        result.append({
            "id": s["id"],
            "partner_username": partner,
            "partner_first_name": partner_first,
            "started_at": s["started_at"],
            "ended_at": s["ended_at"]
        })
    return result

@app.get("/api/online-count")
async def online_count():
    return {"count": manager.get_online_count()}

@app.post("/api/session/start")
async def start_session(data: dict, user=Depends(get_current_user)):
    user2_id = data.get("partner_id")
    if not user2_id:
        raise HTTPException(status_code=400, detail="Partner ID required")
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO chat_sessions (user1_id, user2_id) VALUES (?, ?)",
            (user["user_id"], user2_id)
        )
        await db.commit()
        return {"session_id": cursor.lastrowid}

@app.post("/api/session/{session_id}/end")
async def end_session(session_id: int, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE chat_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ? AND (user1_id = ? OR user2_id = ?)",
            (session_id, user["user_id"], user["user_id"])
        )
        await db.commit()
    return {"success": True}

@app.post("/api/session/{session_id}/message")
async def save_message(session_id: int, data: dict, user=Depends(get_current_user)):
    content = data.get("content", "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Bo'sh xabar")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO messages (session_id, sender_id, content) VALUES (?, ?, ?)",
            (session_id, user["user_id"], content)
        )
        await db.commit()
    return {"success": True}

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int):
    await manager.connect(websocket, user_id)
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "join_queue":
                await manager.add_to_queue(user_id)
            elif msg_type == "leave":
                await manager.leave_room(user_id)
            elif msg_type in ("offer", "answer", "ice_candidate", "chat_message"):
                await manager.relay_signal(user_id, data)
    except WebSocketDisconnect:
        await manager.leave_room(user_id)
        manager.disconnect(user_id)
    except Exception:
        await manager.leave_room(user_id)
        manager.disconnect(user_id)

@app.get("/health")
async def health():
    return {"status": "ok"}
