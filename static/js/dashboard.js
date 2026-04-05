async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const history = await res.json();
    const list = document.getElementById('history-list');

    if (!history.length) {
      list.innerHTML = '<div class="empty-state">Hali hech qanday suhbat yo\'q</div>';
      return;
    }

    list.innerHTML = history.map(h => {
      const date = new Date(h.started_at);
      const formatted = date.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const initial = h.partner_first_name ? h.partner_first_name[0].toUpperCase() : '?';
      return `
        <div class="history-item">
          <div class="history-item-left">
            <div class="avatar">${initial}</div>
            <div>
              <div class="history-partner">${h.partner_first_name} (@${h.partner_username})</div>
              <div class="history-time">${formatted}</div>
            </div>
          </div>
          <div class="history-meta">${h.ended_at ? 'Tugagan' : 'Faol'}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('history-list').innerHTML = '<div class="empty-state">Tarix yuklanmadi</div>';
  }
}

async function loadOnlineCount() {
  try {
    const res = await fetch('/api/online-count');
    const data = await res.json();
    const el = document.getElementById('online-count');
    if (el) el.textContent = data.count;
  } catch {}
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

loadHistory();
loadOnlineCount();
setInterval(loadOnlineCount, 5000);

document.getElementById('logout-btn')?.addEventListener('click', logout);