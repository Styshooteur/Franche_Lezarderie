const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[\p{L} ]+$/u;

const welcomeScreen = document.getElementById('welcome-screen');
const chatScreen = document.getElementById('chat-screen');
const welcomeForm = document.getElementById('welcome-form');
const inviteInput = document.getElementById('invite-input');
const usernameInput = document.getElementById('username-input');
const welcomeError = document.getElementById('welcome-error');
const messagesContainer = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const connectionStatus = document.getElementById('connection-status');
const connectionLabel = document.getElementById('connection-label');
const currentUserLabel = document.getElementById('current-user-label');

let socket = null;
let username = null;

function validateUsername(name) {
  const trimmed = name.trim();
  return (
    trimmed.length >= USERNAME_MIN &&
    trimmed.length <= USERNAME_MAX &&
    USERNAME_REGEX.test(trimmed)
  );
}

function showWelcome() {
  welcomeScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
  inviteInput.focus();
}

function showChat() {
  welcomeScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  if (currentUserLabel) {
    currentUserLabel.textContent = username;
  }
  messageInput.focus();
}

function showWelcomeError(msg) {
  welcomeError.textContent = msg;
  welcomeError.classList.remove('hidden');
}

function hideWelcomeError() {
  welcomeError.classList.add('hidden');
}

function setConnectionState(state) {
  connectionStatus.className = 'status-dot ' + state;
  const labels = {
    connected: 'En ligne',
    reconnecting: 'Reconnexion...',
    disconnected: 'Hors ligne',
  };
  connectionLabel.textContent = labels[state] || state;
}

async function fetchMe() {
  const response = await fetch('/api/me', { credentials: 'same-origin' });
  if (!response.ok) return null;
  const data = await response.json();
  return data.authenticated ? data.username : null;
}

async function joinWithInvite(inviteCode, name) {
  const response = await fetch('/api/join', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode, username: name }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Connexion refusée.');
  }
  return data.username;
}

function initSocket() {
  socket = io({
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => setConnectionState('connected'));
  socket.io.on('reconnect_attempt', () => setConnectionState('reconnecting'));
  socket.on('disconnect', () => setConnectionState('reconnecting'));
  socket.on('connect_error', () => setConnectionState('disconnected'));

  socket.on('history', (payload) => {
    LizardMessages.renderHistory(messagesContainer, payload, username, socket);
  });

  socket.on('chat:lizard:sent', (msg) => {
    LizardMessages.handleSent(messagesContainer, msg, username, socket);
  });

  socket.on('chat:lizard:revealed', (msg) => {
    LizardMessages.handleRevealed(messagesContainer, msg, username);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

welcomeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideWelcomeError();

  const inviteCode = inviteInput.value.trim();
  const name = usernameInput.value.trim();

  if (!inviteCode) {
    showWelcomeError('Entrez le code d\'invitation de la Confrérie.');
    return;
  }

  if (!validateUsername(name)) {
    showWelcomeError(
      'Identité invalide : 3 à 30 caractères, lettres et espaces uniquement.'
    );
    return;
  }

  try {
    username = await joinWithInvite(inviteCode, name);
    LizardMessages.setStoredUsername(username);
    initSocket();
    showChat();
  } catch (error) {
    showWelcomeError(error.message);
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!socket?.connected) return;

  const content = messageInput.value.trim();
  if (!content) return;

  socket.emit('chat:message', { content });
  messageInput.value = '';
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

(async function bootstrap() {
  try {
    const existingUser = await fetchMe();
    if (existingUser) {
      username = existingUser;
      LizardMessages.setStoredUsername(username);
      initSocket();
      showChat();
      return;
    }
  } catch {
    // serveur indisponible
  }
  showWelcome();
})();
