const SEND_BUTTON_ICON =
  '<img src="/img/lizard-send.png" alt="" class="lizard-icon" aria-hidden="true">';
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[\p{L} ]+$/u;
const MAX_PANELS = 6;

const panelsGrid = document.getElementById('panels-grid');
const addPanelBtn = document.getElementById('add-panel-btn');
const demoMessagesBtn = document.getElementById('demo-messages-btn');
const testInviteInput = document.getElementById('test-invite-input');

const panels = [];

function validateUsername(name) {
  const trimmed = name.trim();
  return (
    trimmed.length >= USERNAME_MIN &&
    trimmed.length <= USERNAME_MAX &&
    USERNAME_REGEX.test(trimmed)
  );
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function joinWithInvite(inviteCode, username) {
  const response = await fetch('/api/join', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode, username }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Connexion refusée.');
  }
  return data.username;
}

function createPanel(initialName = '') {
  if (panels.length >= MAX_PANELS) return;

  const panelEl = document.createElement('section');
  panelEl.className = 'test-panel';
  panelEl.innerHTML = `
    <header class="test-panel-header">
      <input type="text" class="text-input test-panel-name" maxlength="30" placeholder="Identité" value="${escapeHtml(initialName)}">
      <div class="test-panel-actions">
        <span class="status-dot disconnected test-panel-status" title="Hors ligne"></span>
        <button type="button" class="btn btn-send test-panel-connect">Connecter</button>
        <button type="button" class="btn btn-send test-panel-window" title="Ouvrir dans une fenêtre séparée">↗</button>
        <button type="button" class="btn btn-send test-panel-remove" title="Retirer">×</button>
      </div>
    </header>
    <main class="test-panel-messages messages-container" role="log"></main>
    <form class="test-panel-form chat-form">
      <textarea class="text-input message-input test-panel-input" maxlength="500" rows="1" placeholder="Message..." disabled></textarea>
      <button type="submit" class="btn btn-send btn-icon" disabled aria-label="Envoyer">
        ${SEND_BUTTON_ICON}
      </button>
    </form>
  `;

  panelsGrid.appendChild(panelEl);

  const panel = {
    el: panelEl,
    username: null,
    pendingSentContent: null,
    socket: null,
    nameInput: panelEl.querySelector('.test-panel-name'),
    statusDot: panelEl.querySelector('.test-panel-status'),
    connectBtn: panelEl.querySelector('.test-panel-connect'),
    windowBtn: panelEl.querySelector('.test-panel-window'),
    removeBtn: panelEl.querySelector('.test-panel-remove'),
    messagesEl: panelEl.querySelector('.test-panel-messages'),
    form: panelEl.querySelector('.test-panel-form'),
    messageInput: panelEl.querySelector('.test-panel-input'),
    sendBtn: panelEl.querySelector('.test-panel-form button'),
  };

  panel.connectBtn.addEventListener('click', () => connectPanel(panel));
  panel.windowBtn.addEventListener('click', () => openInWindow(panel));
  panel.removeBtn.addEventListener('click', () => removePanel(panel));
  panel.form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(panel);
  });
  panel.messageInput.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.shiftKey) {
      e.preventDefault();
      const field = e.currentTarget;
      const start = field.selectionStart;
      const end = field.selectionEnd;
      const value = field.value;
      field.value = `${value.slice(0, start)}\n${value.slice(end)}`;
      field.selectionStart = field.selectionEnd = start + 1;
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      panel.form.requestSubmit();
    }
  });
  panel.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectPanel(panel);
    }
  });

  panels.push(panel);
  updateToolbarState();
  return panel;
}

function updateToolbarState() {
  addPanelBtn.disabled = panels.length >= MAX_PANELS;
}

function setPanelStatus(panel, state) {
  panel.statusDot.className = `status-dot test-panel-status ${state}`;
  panel.statusDot.title = {
    connected: 'Connecté',
    reconnecting: 'Reconnexion...',
    disconnected: 'Hors ligne',
  }[state] || state;
}

async function connectPanel(panel) {
  const name = panel.nameInput.value.trim();
  const inviteCode = testInviteInput?.value.trim() || '';

  if (!inviteCode) {
    testInviteInput?.focus();
    return;
  }

  if (!validateUsername(name)) {
    panel.nameInput.focus();
    return;
  }

  if (panel.socket) {
    panel.socket.disconnect();
    panel.socket = null;
  }

  try {
    const returnedUsername = await joinWithInvite(inviteCode, name);
    panel.username = returnedUsername;
    LizardMessages.setStoredUsername(returnedUsername);
  } catch (error) {
    setPanelStatus(panel, 'disconnected');
    alert(error.message);
    return;
  }

  panel.nameInput.disabled = true;
  panel.connectBtn.textContent = 'Reconnecter';
  panel.messageInput.disabled = false;
  panel.sendBtn.disabled = false;
  panel.messagesEl.innerHTML = '';

  panel.socket = io({
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  panel.socket.on('connect', () => setPanelStatus(panel, 'connected'));
  panel.socket.io.on('reconnect_attempt', () => setPanelStatus(panel, 'reconnecting'));
  panel.socket.on('disconnect', () => setPanelStatus(panel, 'reconnecting'));
  panel.socket.on('connect_error', () => setPanelStatus(panel, 'disconnected'));

  panel.socket.on('history', (payload) => {
    LizardMessages.renderHistory(panel.messagesEl, payload, panel.username, panel.socket);
  });

  panel.socket.on('chat:lizard:sent', (msg) => {
    const sentContent =
      panel.pendingSentContent && msg.username === panel.username
        ? panel.pendingSentContent
        : null;
    panel.pendingSentContent = null;
    LizardMessages.handleSent(panel.messagesEl, msg, panel.username, panel.socket, sentContent);
  });

  panel.socket.on('chat:lizard:revealed', (msg) => {
    LizardMessages.handleRevealed(panel.messagesEl, msg, panel.username);
    panel.messagesEl.scrollTop = panel.messagesEl.scrollHeight;
  });
}

function sendMessage(panel) {
  if (!panel.socket?.connected || !panel.username) return;
  const content = panel.messageInput.value.trim();
  if (!content) return;
  panel.pendingSentContent = content;
  panel.socket.emit('chat:message', { content });
  panel.messageInput.value = '';
}

function openInWindow(panel) {
  const name = panel.nameInput.value.trim();
  if (!validateUsername(name)) return;
  window.open('/', '_blank', 'width=440,height=780,menubar=no,toolbar=no');
}

function removePanel(panel) {
  panel.socket?.disconnect();
  panel.el.remove();
  const index = panels.indexOf(panel);
  if (index !== -1) panels.splice(index, 1);
  updateToolbarState();
}

function sendDemoMessages() {
  const demoLines = [
    'Le signal est faible ce soir…',
    'J\'ai reçu ton message. On se retrouve au point de rendez-vous.',
    'Quelqu\'un d\'autre est en ligne ?',
  ];

  panels.forEach((panel, i) => {
    if (!panel.socket?.connected || !panel.username) return;
    const content = demoLines[i % demoLines.length];
    setTimeout(() => {
      panel.socket.emit('chat:message', { content });
    }, i * 400);
  });
}

addPanelBtn.addEventListener('click', () => createPanel());
demoMessagesBtn.addEventListener('click', sendDemoMessages);

createPanel('Élodie du Nord');
