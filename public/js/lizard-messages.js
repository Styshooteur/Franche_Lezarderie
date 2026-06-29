const LizardMessages = (() => {
  const TRANSIT_MS = 10 * 60 * 1000;
  const TICK_MS = 1000;
  const SENT_IDS_KEY = 'lizard_sent_in_transit';
  const USERNAME_KEY = 'lizard_username';

  let serverOffset = 0;
  let tickTimer = null;
  const tracked = new Map();

  function setServerTime(isoString) {
    serverOffset = new Date(isoString).getTime() - Date.now();
  }

  function now() {
    return Date.now() + serverOffset;
  }

  function parseCreatedAt(dateString) {
    if (dateString.includes('T')) {
      return new Date(dateString).getTime();
    }
    return new Date(dateString.replace(' ', 'T')).getTime();
  }

  function formatTime(dateString) {
    const date = new Date(parseCreatedAt(dateString));
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getRemainingRatio(createdAt) {
    const deliveryAt = parseCreatedAt(createdAt) + TRANSIT_MS;
    const remaining = deliveryAt - now();
    return Math.max(0, Math.min(1, remaining / TRANSIT_MS));
  }

  function getEffectiveStatus(msg) {
    if (msg.status === 'revealed') return 'revealed';
    if (msg.status === 'ready') return 'ready';
    return getRemainingRatio(msg.created_at) <= 0 ? 'ready' : 'transit';
  }

  function getStoredUsername() {
    try {
      return localStorage.getItem(USERNAME_KEY) || '';
    } catch {
      return '';
    }
  }

  function setStoredUsername(name) {
    try {
      if (name) {
        localStorage.setItem(USERNAME_KEY, name);
      }
    } catch {
      // stockage indisponible
    }
  }

  function usernamesMatch(a, b) {
    if (!a || !b) return false;
    return a.trim() === b.trim();
  }

  function isOwnMessage(msg, currentUsername) {
    const author = msg.username;
    const stored = getStoredUsername();
    return (
      usernamesMatch(author, currentUsername) ||
      usernamesMatch(author, stored)
    );
  }

  function loadSentInTransitIds() {
    try {
      const raw = localStorage.getItem(SENT_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(Number).filter((id) => id > 0) : [];
    } catch {
      return [];
    }
  }

  function saveSentInTransitIds(ids) {
    localStorage.setItem(SENT_IDS_KEY, JSON.stringify([...new Set(ids)]));
  }

  function rememberSentInTransit(messageId) {
    const ids = loadSentInTransitIds();
    if (!ids.includes(messageId)) {
      ids.push(messageId);
      saveSentInTransitIds(ids);
    }
  }

  function forgetSentInTransit(messageId) {
    const ids = loadSentInTransitIds().filter((id) => id !== messageId);
    saveSentInTransitIds(ids);
  }

  function isSenderInTransit(msg, currentUsername) {
    if (msg.status === 'revealed' || msg.content) return false;
    if (getEffectiveStatus(msg) !== 'transit') return false;
    if (!isOwnMessage(msg, currentUsername)) return false;
    return true;
  }

  function placeholderText(msg) {
    return `[${msg.username}] a envoyé un lézard messager`;
  }

  function buildRevealedHtml(msg) {
    return `
      <div class="message-header">
        <span class="message-author">${escapeHtml(msg.username)}</span>
        <time class="message-time">${formatTime(msg.created_at)}</time>
      </div>
      <p class="message-content">${escapeHtml(msg.content)}</p>
    `;
  }

  function buildPendingHtml(msg, status, options = {}) {
    const { showProgress = true, showReadyHint = status === 'ready' } = options;

    const progressHtml = showProgress
      ? `<div class="lizard-progress${status === 'ready' ? ' lizard-progress-ready' : ''}" aria-hidden="true">
        <div class="lizard-progress-fill"></div>
      </div>`
      : '';

    const readyHint = showReadyHint
      ? '<p class="lizard-ready-hint">Cliquer pour révéler</p>'
      : '';

    return `
      <div class="message-header">
        <span class="message-author">${escapeHtml(msg.username)}</span>
        <time class="message-time">${formatTime(msg.created_at)}</time>
      </div>
      <p class="message-content lizard-placeholder">${escapeHtml(placeholderText(msg))}</p>
      ${progressHtml}
      ${readyHint}
    `;
  }

  function markReady(el) {
    if (el.dataset.senderOwn === 'true') return;
    el.classList.remove('lizard-sender-transit');
    el.classList.add('lizard-ready');
    el.dataset.status = 'ready';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    const progress = el.querySelector('.lizard-progress');
    progress?.classList.add('lizard-progress-ready');

    if (!el.querySelector('.lizard-ready-hint')) {
      const hintEl = document.createElement('p');
      hintEl.className = 'lizard-ready-hint';
      hintEl.textContent = 'Cliquer pour révéler';
      el.appendChild(hintEl);
    }
  }

  function clearSenderTransitVisual(el) {
    el.classList.remove('lizard-sender-transit');
    delete el.dataset.senderOwn;
    el.querySelector('.lizard-progress')?.remove();
    el.querySelector('.lizard-ready-hint')?.remove();
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.classList.remove('lizard-ready');
    el.dataset.status = 'ready';
  }

  function updateProgressElement(el, createdAt, senderOwn = false) {
    const ratio = getRemainingRatio(createdAt);
    const fill = el.querySelector('.lizard-progress-fill');
    if (fill) {
      fill.style.width = `${ratio * 100}%`;
    }

    if (ratio <= 0) {
      if (senderOwn) {
        clearSenderTransitVisual(el);
        forgetSentInTransit(Number(el.dataset.id));
      } else {
        markReady(el);
      }
      tracked.delete(el);
      return 'ready';
    }

    el.dataset.status = 'transit';
    return 'transit';
  }

  function revealElement(el, msg, isOwn) {
    el.className = `message ${isOwn ? 'own' : 'other'} lizard-revealed`;
    el.dataset.status = 'revealed';
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.classList.remove('lizard-sender-transit', 'lizard-ready');
    el.innerHTML = buildRevealedHtml(msg);
    tracked.delete(el);
    if (isOwn) {
      forgetSentInTransit(Number(msg.id));
    }
  }

  function attachRevealHandlers(el, msg, socket, isOwn) {
    const onReveal = () => {
      if (el.dataset.status !== 'ready') return;
      if (!socket?.connected) return;
      socket.emit('chat:lizard:reveal', { messageId: msg.id });
    };

    el.addEventListener('click', onReveal);
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onReveal();
    });

    if (!isOwn) {
      return;
    }

    el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }

  function mountMessage(container, msg, currentUsername, socket, options = {}) {
    const { scroll = true } = options;
    const existing = container.querySelector(`[data-id="${msg.id}"]`);
    const isOwn = isOwnMessage(msg, currentUsername);
    const senderTransit = isSenderInTransit(msg, currentUsername);

    if (existing) {
      if (msg.status === 'revealed' || msg.content) {
        revealElement(existing, msg, isOwn);
      } else if (senderTransit) {
        existing.classList.add('own', 'lizard-sender-transit');
        existing.classList.remove('other');
        existing.dataset.senderOwn = 'true';
        updateProgressElement(existing, msg.created_at, true);
        if (!tracked.has(existing)) {
          tracked.set(existing, { createdAt: msg.created_at, senderOwn: true });
          ensureTick();
        }
      } else {
        const senderOwn = existing.dataset.senderOwn === 'true';
        updateProgressElement(existing, msg.created_at, senderOwn);
      }
      return existing;
    }

    const el = document.createElement('article');
    el.className = `message ${isOwn ? 'own' : 'other'}`;
    el.dataset.id = msg.id;
    el.dataset.createdAt = msg.created_at;

    if (msg.status === 'revealed' || msg.content) {
      el.classList.add('lizard-revealed');
      el.dataset.status = 'revealed';
      el.innerHTML = buildRevealedHtml(msg);
    } else {
      const status = getEffectiveStatus(msg);

      el.classList.add('lizard-pending');
      el.dataset.status = status;

      if (senderTransit) {
        el.classList.add('lizard-sender-transit');
        el.dataset.senderOwn = 'true';
        rememberSentInTransit(msg.id);
        el.innerHTML = buildPendingHtml(msg, status, {
          showProgress: true,
          showReadyHint: false,
        });
      } else if (isOwn && status === 'ready') {
        el.innerHTML = buildPendingHtml(msg, status, {
          showProgress: false,
          showReadyHint: false,
        });
        forgetSentInTransit(msg.id);
      } else {
        el.innerHTML = buildPendingHtml(msg, status, {
          showProgress: true,
          showReadyHint: status === 'ready',
        });
      }

      attachRevealHandlers(el, msg, socket, isOwn);

      if (senderTransit && status === 'transit') {
        tracked.set(el, { createdAt: msg.created_at, senderOwn: true });
        updateProgressElement(el, msg.created_at, true);
        ensureTick();
      } else if (!isOwn && status === 'transit') {
        tracked.set(el, { createdAt: msg.created_at, senderOwn: false });
        updateProgressElement(el, msg.created_at, false);
        ensureTick();
      } else if (!isOwn && status === 'ready') {
        markReady(el);
      }
    }

    container.appendChild(el);

    if (scroll) {
      container.scrollTop = container.scrollHeight;
    }

    return el;
  }

  function renderHistory(container, payload, currentUsername, socket) {
    const messages = Array.isArray(payload) ? payload : payload.messages;
    if (payload?.serverTime) {
      setServerTime(payload.serverTime);
    }

    const sentIds = new Set(loadSentInTransitIds());

    container.innerHTML = '';
    tracked.clear();
    messages.forEach((msg) => {
      const isOwn = isOwnMessage(msg, currentUsername);
      if (
        isOwn &&
        msg.status !== 'revealed' &&
        !msg.content &&
        (sentIds.has(msg.id) || getEffectiveStatus(msg) === 'transit')
      ) {
        rememberSentInTransit(msg.id);
      }
      mountMessage(container, msg, currentUsername, socket, { scroll: false });
    });
    container.scrollTop = container.scrollHeight;
    ensureTick();
  }

  function handleSent(container, msg, currentUsername, socket) {
    if (isOwnMessage(msg, currentUsername)) {
      rememberSentInTransit(msg.id);
    }
    mountMessage(container, msg, currentUsername, socket);
  }

  function handleRevealed(container, msg, currentUsername) {
    const el = container.querySelector(`[data-id="${msg.id}"]`);
    if (el) {
      revealElement(el, msg, isOwnMessage(msg, currentUsername));
      return;
    }
    mountMessage(container, msg, currentUsername, null);
  }

  function tick() {
    if (tracked.size === 0) {
      stopTick();
      return;
    }

    for (const [el, entry] of [...tracked.entries()]) {
      if (!el.isConnected) {
        tracked.delete(el);
        continue;
      }
      updateProgressElement(el, entry.createdAt, entry.senderOwn);
    }
  }

  function ensureTick() {
    if (tickTimer || tracked.size === 0) return;
    tickTimer = setInterval(tick, TICK_MS);
  }

  function stopTick() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  return {
    setServerTime,
    setStoredUsername,
    renderHistory,
    handleSent,
    handleRevealed,
    stopTick,
  };
})();
