from pydantic import BaseModel
from typing import Optional

class UserRegister(BaseModel):
    first_name: str
    last_name: str
    username: str
    password: str
    confirm_password: str

class UserLogin(BaseModel):
    username: str
    password: str

class TokenData(BaseModel):
    user_id: int
    username: str