// Spatial Proximity Clustering & Prominent Glassmorphic Conversation HUD
export const PROXIMITY_RADIUS = 200;

export class ProximityChat {
  /**
   * @param {Object} options
   * @param {number} [options.radius=200] - Proximity threshold in pixels
   * @param {HTMLElement} [options.container] - Parent DOM container
   * @param {Function} [options.onClusterFormed] - Callback when cluster forms (participants)
   * @param {Function} [options.onClusterDissolved] - Callback when cluster dissolves (partingContext)
   * @param {Function} [options.onSendMessage] - Callback when local player sends message (text, activePeers)
   */
  constructor(options = {}) {
    this.radius = typeof options.radius === 'number' ? options.radius : PROXIMITY_RADIUS;
    this.activeCluster = null; // null when solo, or Set of active peer IDs
    this.participants = []; // array of participant objects { id, name, isLocal, toString() }
    this.messages = [];
    this.lastMessage = null;
    this.onClusterFormed = options.onClusterFormed || null;
    this.onClusterDissolved = options.onClusterDissolved || null;
    this.onSendMessage = options.onSendMessage || null;

    this.container = options.container ||
      (typeof document !== 'undefined' ? (document.getElementById('game-container') || document.body) : null);

    this.panel = null;
    this.header = null;
    this.pillsContainer = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.input = null;
    this.sendBtn = null;
    this.emojiBtns = [];

    this.isManuallyHidden = false;
    this.toggleBtn = null;
    this._boundOnToggleClick = null;

    this._boundOnKeyDown = null;
    this._boundOnSendClick = null;
    this._boundEmojiClicks = [];

    this.initHUD();
  }

  /**
   * Initializes HUD DOM elements.
   */
  initHUD() {
    if (typeof document === 'undefined') return;

    // Check if element already exists
    const existingPanel = document.getElementById('proximity-chat-panel');
    if (existingPanel && existingPanel.parentNode) {
      existingPanel.parentNode.removeChild(existingPanel);
    }

    // Build #proximity-chat-panel
    const panel = document.createElement('div');
    panel.id = 'proximity-chat-panel';
    panel.className = 'hidden';

    panel.innerHTML = `
      <div id="proximity-chat-header" class="proximity-chat-header">
        <div class="proximity-header-title">
          <span class="proximity-chat-icon">💬</span>
          <span class="proximity-title-text">Group Chat</span>
          <span class="proximity-badge">🟢 In Range (${this.radius}px)</span>
        </div>
        <div class="proximity-participants" id="proximity-participants">
          <span class="proximity-participants-label">💬 Chat with:</span>
          <div class="proximity-pills-list" id="proximity-pills-list"></div>
        </div>
      </div>

      <div id="proximity-chat-messages" class="proximity-chat-messages"></div>

      <div id="proximity-chat-input-container" class="proximity-chat-input-container">
        <div class="proximity-emoji-bar">
          <button type="button" class="proximity-emoji-btn" data-emoji="👋" title="Wave">👋</button>
          <button type="button" class="proximity-emoji-btn" data-emoji="🐾" title="Paws">🐾</button>
          <button type="button" class="proximity-emoji-btn" data-emoji="❤️" title="Heart">❤️</button>
          <button type="button" class="proximity-emoji-btn" data-emoji="☕" title="Coffee">☕</button>
        </div>
        <div id="proximity-chat-input-bar" class="proximity-input-row">
          <input
            type="text"
            id="proximity-chat-input"
            placeholder="Say something to the group... (Enter to send)"
            maxlength="100"
            autocomplete="off"
          />
          <button type="button" id="proximity-chat-send-btn" class="proximity-send-btn">
            <span>💬 Send</span>
          </button>
        </div>
      </div>
    `;

    if (this.container) {
      this.container.appendChild(panel);
    } else if (document.body) {
      document.body.appendChild(panel);
    }

    this.panel = panel;
    this.header = panel.querySelector('#proximity-chat-header');
    this.pillsContainer = panel.querySelector('#proximity-pills-list');
    this.messagesContainer = panel.querySelector('#proximity-chat-messages');
    this.inputContainer = panel.querySelector('#proximity-chat-input-container');
    this.input = panel.querySelector('#proximity-chat-input');
    this.sendBtn = panel.querySelector('#proximity-chat-send-btn');
    this.emojiBtns = Array.from(panel.querySelectorAll('.proximity-emoji-btn'));

    // Event listeners
    if (this.input) {
      this._boundOnKeyDown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          this._handleInputSubmit();
        }
      };
      this.input.addEventListener('keydown', this._boundOnKeyDown);
      this.input.addEventListener('keyup', (e) => e.stopPropagation());
      this.input.addEventListener('keypress', (e) => e.stopPropagation());
    }

    if (this.sendBtn) {
      this._boundOnSendClick = (e) => {
        e.preventDefault();
        this._handleInputSubmit();
      };
      this.sendBtn.addEventListener('click', this._boundOnSendClick);
    }

    // Check and clean up existing #chat-toggle-btn
    const existingToggle = document.getElementById('chat-toggle-btn');
    if (existingToggle && existingToggle.parentNode) {
      existingToggle.parentNode.removeChild(existingToggle);
    }

    // Build #chat-toggle-btn
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'chat-toggle-btn';
    toggleBtn.className = 'chat-toggle-btn collapsed';
    toggleBtn.setAttribute('type', 'button');
    toggleBtn.setAttribute('aria-label', 'Toggle Chat');
    toggleBtn.setAttribute('title', 'Toggle Chat');
    toggleBtn.innerHTML = '<span class="chat-toggle-icon">💬</span>';

    const parentElem = this.container || document.body;
    if (parentElem) {
      parentElem.appendChild(toggleBtn);
    }
    this.toggleBtn = toggleBtn;

    // Toggle button click handler
    this._boundOnToggleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = this.panel && this.panel.classList.contains('active');
      if (isVisible) {
        this.hideHUD();
        this.isManuallyHidden = true;
      } else {
        this.showHUD();
        this.isManuallyHidden = false;
      }
      if (this.toggleBtn) {
        this.toggleBtn.classList.toggle('active', !this.isManuallyHidden);
        this.toggleBtn.classList.toggle('collapsed', this.isManuallyHidden);
      }
    };
    this.toggleBtn.addEventListener('click', this._boundOnToggleClick);

    for (const btn of this.emojiBtns) {
      const handler = (e) => {
        e.preventDefault();
        const emoji = btn.getAttribute('data-emoji') || btn.textContent.trim();
        if (emoji) {
          this.submitMessage(emoji);
        }
      };
      btn.addEventListener('click', handler);
      this._boundEmojiClicks.push({ btn, handler });
    }
  }

  _handleInputSubmit() {
    if (!this.input) return;
    const text = this.input.value.trim();
    if (text) {
      this.submitMessage(text);
      this.input.value = '';
      this.input.focus();
    }
  }

  /**
   * Submits a message from the local player.
   * @param {string} text
   */
  submitMessage(text) {
    if (!text) return;
    const trimmed = String(text).trim();
    if (!trimmed) return;

    const localP = this.participants.find(p => p.isLocal) || { id: 'local', name: 'You' };
    this.addMessage(localP.id, localP.name, trimmed, true);

    if (typeof this.onSendMessage === 'function') {
      this.onSendMessage(trimmed, this.getActivePeers());
    }
  }

  /**
   * Public API: Append message to active chat thread.
   */
  addMessage(senderId, senderName, text, isLocal = false) {
    const sId = senderId || (isLocal ? 'local' : 'peer');
    const sName = senderName || (isLocal ? 'You' : 'Walker');
    const strText = String(text !== undefined ? text : '');

    const msg = {
      senderId: sId,
      senderName: sName,
      text: strText,
      isLocal: Boolean(isLocal),
      timestamp: Date.now(),
      toString() {
        return this.text;
      }
    };

    this.messages.push(msg);
    this.lastMessage = msg;

    // Auto-unhide logic: If in an active cluster, automatically unhide panel when message is added
    if (this.isClusterActive() || this.activeCluster) {
      const isPanelActive = this.panel && this.panel.classList.contains('active');
      if (this.isManuallyHidden || !isPanelActive) {
        this.showHUD();
        this.isManuallyHidden = false;
      }
    }

    if (this.messagesContainer && typeof document !== 'undefined') {
      const msgEl = document.createElement('div');
      msgEl.className = `proximity-message ${isLocal ? 'local' : 'peer'}`;

      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      msgEl.innerHTML = `
        <div class="proximity-message-header">
          <span class="proximity-message-sender">${this.escapeHTML(msg.senderName)}</span>
          <span class="proximity-message-time">${timeStr}</span>
        </div>
        <div class="proximity-message-text">${this.escapeHTML(msg.text)}</div>
      `;
      this.messagesContainer.appendChild(msgEl);
      this.scrollToBottom();
    }

    return msg;
  }

  /**
   * Adds an in-thread notification message.
   * @param {string} text
   */
  addSystemMessage(text) {
    if (!text) return;
    if (this.messagesContainer && typeof document !== 'undefined') {
      const sysEl = document.createElement('div');
      sysEl.className = 'proximity-message system';
      sysEl.innerHTML = `<span class="proximity-system-text">${this.escapeHTML(text)}</span>`;
      this.messagesContainer.appendChild(sysEl);
      this.scrollToBottom();
    }
  }

  /**
   * Public API: Returns most recent message object or string.
   */
  getLastMessage() {
    return this.lastMessage;
  }

  /**
   * Public API: Returns short summary string of the conversation.
   */
  getSnippet() {
    if (this.lastMessage) {
      const t = typeof this.lastMessage === 'string' ? this.lastMessage : this.lastMessage.text;
      if (t && t.trim().length > 0) {
        return t.trim();
      }
    }
    if (this.participants && this.participants.length > 0) {
      const peers = this.participants.filter(p => !p.isLocal).map(p => p.name);
      if (peers.length > 0) {
        return `Chat with ${peers.join(', ')}`;
      }
    }
    return '';
  }

  /**
   * Public API: Whether a conversation cluster is currently active.
   */
  isClusterActive() {
    return this.activeCluster !== null;
  }

  /**
   * Public API: Returns array of connected remote peer IDs.
   */
  getActivePeers() {
    if (!this.activeCluster) return [];
    if (this.activeCluster instanceof Set) {
      return Array.from(this.activeCluster);
    }
    if (Array.isArray(this.activeCluster)) {
      return [...this.activeCluster];
    }
    return [];
  }

  /**
   * Slides in HUD panel.
   */
  showHUD() {
    if (this.panel) {
      this.panel.classList.remove('hidden');
      this.panel.classList.add('active');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active');
      this.toggleBtn.classList.remove('collapsed');
    }
  }

  openHUD() {
    this.showHUD();
  }

  /**
   * Slides out HUD panel.
   */
  hideHUD() {
    if (this.panel) {
      this.panel.classList.remove('active');
      this.panel.classList.add('hidden');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.remove('active');
      this.toggleBtn.classList.add('collapsed');
    }
  }

  closeHUD() {
    this.hideHUD();
  }

  /**
   * Refreshes participant pills in the header.
   */
  updateParticipantsBadge() {
    if (!this.pillsContainer || typeof document === 'undefined') return;
    this.pillsContainer.innerHTML = '';
    for (const p of this.participants) {
      const pill = document.createElement('span');
      pill.className = `participant-pill ${p.isLocal ? 'local' : 'peer'}`;
      pill.textContent = p.isLocal ? `${p.name} (You)` : p.name;
      this.pillsContainer.appendChild(pill);
    }
  }

  scrollToBottom() {
    if (!this.messagesContainer) return;
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Normalizes remote players map/array into uniform node array.
   * @private
   */
  _extractRemotePlayers(remotePlayersMap) {
    if (!remotePlayersMap) return [];
    const list = [];

    const processEntry = (key, val) => {
      if (val === undefined && key === undefined) return;
      const item = val !== undefined ? val : key;
      if (!item) return;

      const entity = item.owner || item;
      const fallbackId = (key !== undefined && typeof key === 'string') ? key : null;
      const id = item.id || item.peerId || entity.id || fallbackId || `peer-${list.length}`;
      const name = entity.name || item.name || 'Walker';
      const x = typeof entity.x === 'number' ? entity.x : (typeof item.x === 'number' ? item.x : null);
      const y = typeof entity.y === 'number' ? entity.y : (typeof item.y === 'number' ? item.y : null);

      if (x !== null && y !== null && !isNaN(x) && !isNaN(y)) {
        list.push({ id: String(id), name: String(name), x, y, raw: item });
      }
    };

    if (remotePlayersMap instanceof Map) {
      for (const [key, val] of remotePlayersMap.entries()) {
        processEntry(key, val);
      }
    } else if (Array.isArray(remotePlayersMap)) {
      for (let i = 0; i < remotePlayersMap.length; i++) {
        const entry = remotePlayersMap[i];
        if (Array.isArray(entry) && entry.length === 2) {
          processEntry(entry[0], entry[1]);
        } else {
          processEntry(null, entry);
        }
      }
    } else if (typeof remotePlayersMap === 'object') {
      for (const [key, val] of Object.entries(remotePlayersMap)) {
        processEntry(key, val);
      }
    }

    return list;
  }

  /**
   * Evaluates spatial proximity clustering and updates HUD lifecycle.
   * @param {number} dt
   * @param {Object} localOwner
   * @param {Map|Array|Object} remotePlayersMap
   */
  update(dt, localOwner, remotePlayersMap) {
    const wasActive = this.isClusterActive();

    if (!localOwner || typeof localOwner.x !== 'number' || typeof localOwner.y !== 'number') {
      if (wasActive) {
        const partingContext = {
          x: 0,
          y: 0,
          participants: [...this.participants],
          lastMessage: this.lastMessage,
          snippet: this.getSnippet()
        };
        this.hideHUD();
        this.isManuallyHidden = false;
        if (typeof this.onClusterDissolved === 'function') {
          this.onClusterDissolved(partingContext);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
      }
      return;
    }

    const localId = String(localOwner.id || 'local');
    const localName = localOwner.name || 'You';
    const localNode = {
      id: localId,
      name: localName,
      x: localOwner.x,
      y: localOwner.y,
      isLocal: true,
      toString() { return this.name; }
    };

    // Extract remote players and exclude local player ID
    const allRemotes = this._extractRemotePlayers(remotePlayersMap).filter(r => r.id !== localId);

    // Multi-player transitive clustering via BFS from local player
    const connectedRemoteNodes = [];
    const visited = new Set();
    const queue = [localNode];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const rem of allRemotes) {
        if (!visited.has(rem.id)) {
          const dx = current.x - rem.x;
          const dy = current.y - rem.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= this.radius) {
            visited.add(rem.id);
            connectedRemoteNodes.push(rem);
            queue.push(rem);
          }
        }
      }
    }

    if (connectedRemoteNodes.length > 0) {
      const currentPeerIds = new Set(connectedRemoteNodes.map(r => r.id));
      const remoteParticipants = connectedRemoteNodes.map(r => ({
        id: r.id,
        name: r.name,
        isLocal: false,
        toString() { return this.name; }
      }));
      const newParticipants = [localNode, ...remoteParticipants];

      if (!wasActive) {
        // Cluster FORMS: open/slide-in the prominent on-screen HUD if not manually hidden
        this.activeCluster = currentPeerIds;
        this.participants = newParticipants;
        this.updateParticipantsBadge();
        if (!this.isManuallyHidden) {
          this.showHUD();
        }
        if (typeof this.onClusterFormed === 'function') {
          this.onClusterFormed(this.participants);
        }
      } else {
        // Cluster remains ACTIVE: check if active participants changed
        const prevPeerIds = this.activeCluster || new Set();
        const joined = connectedRemoteNodes.filter(r => !prevPeerIds.has(r.id));
        const leftIds = [...prevPeerIds].filter(id => !currentPeerIds.has(id));

        let membershipChanged = false;

        if (joined.length > 0) {
          membershipChanged = true;
          for (const j of joined) {
            this.addSystemMessage(`${j.name} joined the conversation.`);
          }
        }

        if (leftIds.length > 0) {
          membershipChanged = true;
          for (const id of leftIds) {
            const prevP = this.participants.find(p => p.id === id);
            const name = prevP ? prevP.name : 'A player';
            this.addSystemMessage(`${name} left the conversation.`);
          }
        }

        if (membershipChanged) {
          this.activeCluster = currentPeerIds;
          this.participants = newParticipants;
          this.updateParticipantsBadge();
        }
      }
    } else {
      // 0 remote players connected to local player
      if (wasActive) {
        // Cluster DISSOLVES: close/slide-out HUD
        const partingContext = {
          x: localOwner.x,
          y: localOwner.y,
          participants: [...this.participants],
          lastMessage: this.lastMessage,
          snippet: this.getSnippet()
        };
        this.hideHUD();
        this.isManuallyHidden = false;
        if (typeof this.onClusterDissolved === 'function') {
          this.onClusterDissolved(partingContext);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
      }
    }
  }

  /**
   * Public API: Cleans up DOM elements and event listeners.
   */
  destroy() {
    if (this.input && this._boundOnKeyDown) {
      this.input.removeEventListener('keydown', this._boundOnKeyDown);
    }
    if (this.sendBtn && this._boundOnSendClick) {
      this.sendBtn.removeEventListener('click', this._boundOnSendClick);
    }
    for (const { btn, handler } of this._boundEmojiClicks) {
      btn.removeEventListener('click', handler);
    }
    this._boundEmojiClicks = [];

    if (this.toggleBtn && this._boundOnToggleClick) {
      this.toggleBtn.removeEventListener('click', this._boundOnToggleClick);
    }
    this._boundOnToggleClick = null;

    if (this.toggleBtn && this.toggleBtn.parentNode) {
      this.toggleBtn.parentNode.removeChild(this.toggleBtn);
    }
    this.toggleBtn = null;

    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }

    this.panel = null;
    this.header = null;
    this.pillsContainer = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.input = null;
    this.sendBtn = null;
    this.emojiBtns = [];

    this.activeCluster = null;
    this.participants = [];
    this.messages = [];
    this.lastMessage = null;
  }
}

export const ProximityChatManager = ProximityChat;
export default ProximityChat;
