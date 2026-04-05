const USER_ID = window.__USER_ID__;
const USERNAME = window.__USERNAME__;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let ws = null;
let pc = null;
let localStream = null;
let sessionId = null;
let partnerId = null;
let currentRole = null;
let isSearching = false;

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const waitingOverlay = document.getElementById('waiting-overlay');
const messagesArea = document.getElementById('messages-area');
const chatInput = document.getElementById('chat-input');
const btnNext = document.getElementById('btn-next');
const btnLeave = document.getElementById('btn-leave');
const btnSend = document.getElementById('btn-send');

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.className = 'status-dot ' + state;
}

function showWaiting(show) {
  waitingOverlay.style.display = show ? 'flex' : 'none';
  isSearching = show;
}

function addMessage(text, type = 'system') {
  const div = document.createElement('div');
  div.className = 'message ' + type;
  div.textContent = text;
  messagesArea.appendChild(div);
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

async function initLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (e) {
    addMessage('Kamera yoki mikrofonga ruxsat berilmadi', 'system');
  }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/${USER_ID}`);

  ws.onopen = () => {
    setStatus('Ulandi', 'connected');
  };

  ws.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    await handleSignal(data);
  };

  ws.onclose = () => {
    setStatus('Uzilib qoldi', 'disconnected');
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

async function handleSignal(data) {
  switch (data.type) {
    case 'waiting':
      showWaiting(true);
      setStatus('Hamkor qidirilmoqda...', 'searching');
      break;

    case 'matched':
      showWaiting(false);
      partnerId = data.partner_id;
      currentRole = data.role;
      setStatus('Hamkor topildi!', 'connected');
      addMessage('Yangi hamkor bilan ulandi', 'system');

      try {
        const res = await fetch('/api/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partner_id: partnerId })
        });
        const sData = await res.json();
        sessionId = sData.session_id;
      } catch {}

      await createPeerConnection();
      if (currentRole === 'caller') {
        await createOffer();
      }
      break;

    case 'offer':
      if (!pc) await createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', sdp: answer });
      break;

    case 'answer':
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
      break;

    case 'ice_candidate':
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {}
      }
      break;

    case 'chat_message':
      addMessage(data.text, 'theirs');
      break;

    case 'partner_left':
      addMessage('Hamkor chiqib ketdi', 'system');
      setStatus('Hamkor uzilib qoldi', 'disconnected');
      cleanupPeer();
      if (sessionId) {
        await fetch(`/api/session/${sessionId}/end`, { method: 'POST' });
        sessionId = null;
      }
      partnerId = null;
      break;
  }
}

async function createPeerConnection() {
  cleanupPeer();
  pc = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    document.getElementById('remote-placeholder').style.display = 'none';
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal({ type: 'ice_candidate', candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setStatus('Video ulandi', 'connected');
    } else if (pc.connectionState === 'failed') {
      setStatus('Video ulanmadi', 'disconnected');
    }
  };
}

async function createOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type: 'offer', sdp: offer });
}

function cleanupPeer() {
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
  remoteVideo.srcObject = null;
  document.getElementById('remote-placeholder').style.display = 'flex';
}

function sendSignal(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function startSearch() {
  if (isSearching) return;
  if (pc) {
    await leaveRoom();
  }
  messagesArea.innerHTML = '';
  sendSignal({ type: 'join_queue' });
}

async function leaveRoom() {
  sendSignal({ type: 'leave' });
  cleanupPeer();
  if (sessionId) {
    await fetch(`/api/session/${sessionId}/end`, { method: 'POST' });
    sessionId = null;
  }
  partnerId = null;
  setStatus('Chat yakunlandi', 'disconnected');
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !partnerId) return;

  addMessage(text, 'mine');
  sendSignal({ type: 'chat_message', text });

  if (sessionId) {
    fetch(`/api/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    }).catch(() => {});
  }

  chatInput.value = '';
}

btnNext.addEventListener('click', startSearch);
btnLeave.addEventListener('click', async () => {
  await leaveRoom();
  showWaiting(false);
  isSearching = false;
  window.location.href = '/dashboard';
});

btnSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await leaveRoom();
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

async function init() {
  await initLocalStream();
  connectWS();
  setTimeout(() => {
    startSearch();
  }, 1000);
}

init();
