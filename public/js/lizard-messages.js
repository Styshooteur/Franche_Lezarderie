const LizardMessages = (() => {
  const TRANSIT_MS = 10 * 60 * 1000;
  const TICK_MS = 1000;

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

  function buildPendingHtml(msg, status) {
    const readyHint =
      status === 'ready'
        ? '<p class="lizard-ready-hint">Cliquer pour révéler</p>'
        : '';

    return `
      <div class="message-header">
        <span class="message-author">${escapeHtml(msg.username)}</span>
        <time class="message-time">${formatTime(msg.created_at)}</time>
      </div>
      <p class="message-content lizard-placeholder">${escapeHtml(placeholderText(msg))}</p>
      <div class="lizard-progress${status === 'ready' ? ' lizard-progress-ready' : ''}" aria-hidden="true">
        <div class="lizard-progress-fill"></div>
      </div>
      ${readyHint}
    `;
  }

  function markReady(el) {
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

  function updateProgressElement(el, createdAt) {
    const ratio = getRemainingRatio(createdAt);
    const fill = el.querySelector('.lizard-progress-fill');
    if (fill) {
      fill.style.width = `${ratio * 100}%`;
    }

    if (ratio <= 0) {
      markReady(el);
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
    el.innerHTML = buildRevealedHtml(msg);
    tracked.delete(el);
  }

  function mountMessage(container, msg, currentUsername, socket, options = {}) {
    const { scroll = true } = options;
    const existing = container.querySelector(`[data-id="${msg.id}"]`);

    if (existing) {
      if (msg.status === 'revealed' || msg.content) {
        revealElement(existing, msg, msg.username === currentUsername);
      } else {
        updateProgressElement(existing, msg.created_at);
      }
      return existing;
    }

    const isOwn = msg.username === currentUsername;
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
      el.innerHTML = buildPendingHtml(msg, status);

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

      if (status === 'ready') {
        markReady(el);
      } else {
        tracked.set(el, msg.created_at);
        updateProgressElement(el, msg.created_at);
        ensureTick();
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

    container.innerHTML = '';
    tracked.clear();
    messages.forEach((msg) => {
      mountMessage(container, msg, currentUsername, socket, { scroll: false });
    });
    container.scrollTop = container.scrollHeight;
    ensureTick();
  }

  function handleSent(container, msg, currentUsername, socket) {
    mountMessage(container, msg, currentUsername, socket);
  }

  function handleRevealed(container, msg, currentUsername) {
    const el = container.querySelector(`[data-id="${msg.id}"]`);
    if (el) {
      revealElement(el, msg, msg.username === currentUsername);
      return;
    }
    mountMessage(container, msg, currentUsername, null);
  }

  function tick() {
    if (tracked.size === 0) {
      stopTick();
      return;
    }

    for (const [el, createdAt] of [...tracked.entries()]) {
      if (!el.isConnected) {
        tracked.delete(el);
        continue;
      }
      updateProgressElement(el, createdAt);
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
    renderHistory,
    handleSent,
    handleRevealed,
    stopTick,
  };
})();
