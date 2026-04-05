let usernameTimer = null;
let usernameAvailable = false;

function showAlert(msg, type = 'error') {
  const existing = document.querySelector('.alert');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = msg;
  const form = document.querySelector('form');
  form.prepend(div);
}

function setHint(fieldId, msg, type) {
  const hint = document.getElementById(fieldId + '-hint');
  const input = document.getElementById(fieldId);
  if (!hint) return;
  hint.textContent = msg;
  hint.className = 'field-hint ' + type;
  input.className = input.className.replace(/\b(error|success)\b/g, '').trim();
  if (type === 'error') input.classList.add('error');
  if (type === 'success') input.classList.add('success');
}

async function checkUsername(val) {
  if (val.length < 3) {
    setHint('username', 'Kamida 3 ta belgi', 'error');
    usernameAvailable = false;
    return;
  }
  setHint('username', 'Tekshirilmoqda...', 'loading');
  try {
    const res = await fetch(`/api/check-username/${encodeURIComponent(val)}`);
    const data = await res.json();
    if (data.available) {
      setHint('username', '✓ Bu username bo\'sh', 'success');
      usernameAvailable = true;
    } else {
      setHint('username', '✗ Bu username band', 'error');
      usernameAvailable = false;
    }
  } catch {
    setHint('username', 'Tekshirib bo\'lmadi', 'error');
    usernameAvailable = false;
  }
}

const usernameInput = document.getElementById('username');
if (usernameInput) {
  usernameInput.addEventListener('input', (e) => {
    clearTimeout(usernameTimer);
    const val = e.target.value.trim();
    if (!val) { setHint('username', '', ''); return; }
    usernameTimer = setTimeout(() => checkUsername(val), 400);
  });
}

const registerForm = document.getElementById('register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = registerForm.querySelector('button[type=submit]');

    const first_name = document.getElementById('first_name').value.trim();
    const last_name = document.getElementById('last_name').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirm_password = document.getElementById('confirm_password').value;

    if (!first_name || !last_name) { showAlert('Ism va familiyani kiriting'); return; }
    if (!usernameAvailable) { showAlert('Username mavjud emas yoki band'); return; }
    if (password.length < 6) { showAlert('Parol kamida 6 ta belgidan iborat bo\'lishi kerak'); return; }
    if (password !== confirm_password) { showAlert('Parollar mos kelmadi'); return; }

    btn.disabled = true;
    btn.textContent = 'Yuklanmoqda...';

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name, last_name, username, password, confirm_password })
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        showAlert(data.detail || 'Xatolik yuz berdi');
        btn.disabled = false;
        btn.textContent = 'Ro\'yxatdan o\'tish';
      }
    } catch {
      showAlert('Ulanishda xatolik');
      btn.disabled = false;
      btn.textContent = 'Ro\'yxatdan o\'tish';
    }
  });
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type=submit]');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) { showAlert('Barcha maydonlarni to\'ldiring'); return; }

    btn.disabled = true;
    btn.textContent = 'Yuklanmoqda...';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        showAlert(data.detail || 'Noto\'g\'ri ma\'lumotlar');
        btn.disabled = false;
        btn.textContent = 'Kirish';
      }
    } catch {
      showAlert('Ulanishda xatolik');
      btn.disabled = false;
      btn.textContent = 'Kirish';
    }
  });
}