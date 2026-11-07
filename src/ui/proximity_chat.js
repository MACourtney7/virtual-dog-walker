// Spatial Proximity Clustering & Prominent Glassmorphic Conversation HUD
import { ZeroChatWidget } from './zero_chat_widget.js';

export const PROXIMITY_RADIUS = 200;
export const PROXIMITY_JOIN_RADIUS = 160;
export const RETENTION_DURATION_MS = 5 * 60 * 1000; // 300,000 ms (5 minutes)
export const PLAYER_PALETTE = ['#38bdf8', '#4ade80', '#fbbf24', '#fb7185', '#c084fc', '#2dd4bf', '#f97316', '#60a5fa'];

export class ProximityChat {
  /**
   * @param {Object} options
   * @param {number} [options.radius=200] - Leave proximity threshold in pixels
   * @param {number} [options.joinRadius] - Join proximity threshold in pixels (defaults to options.radius if omitted)
   * @param {number} [options.retentionDuration=300000] - Message retention duration in ms
   * @param {HTMLElement} [options.container] - Parent DOM container
   * @param {Function} [options.onClusterFormed] - Callback when cluster forms (participants)
   * @param {Function} [options.onClusterDissolved] - Callback when cluster dissolves (partingContext)
   * @param {Function} [options.onClusterChanged] - Callback when cluster membership updates (activePeerIds)
   * @param {Function} [options.onSendMessage] - Callback when local player sends message (text, activePeers)
   * @param {Function} [options.onBurnMessage] - Callback when message is burned across network (messageUuid)
   * @param {Function} [options.onBurnSession] - Callback when session is burned across network ()
   */
  constructor(options = {}) {
    this.radius = typeof options.radius === 'number' ? options.radius : PROXIMITY_RADIUS;
    this.joinRadius = typeof options.joinRadius === 'number' ? options.joinRadius : this.radius;
    this.retentionDuration = typeof options.retentionDuration === 'number' ? options.retentionDuration : RETENTION_DURATION_MS;
    this.retentionTimer = this.retentionDuration;
    this.departureTimers = new Map(); // peerId -> departureTimestamp (ms)
    this.playerColors = new Map(); // senderId -> colorHex
    this.activeCluster = null; // null when solo, or Set of active peer IDs
    this.participants = []; // array of participant objects { id, name, isLocal, toString() }
    this.messages = [];
    this.lastMessage = null;
    this.onClusterFormed = options.onClusterFormed || null;
    this.onClusterDissolved = options.onClusterDissolved || null;
    this.onClusterChanged = options.onClusterChanged || null;
    this.onSendMessage = options.onSendMessage || null;
    this.onBurnMessage = options.onBurnMessage || null;
    this.onBurnSession = options.onBurnSession || null;

    this.container = options.container ||
      (typeof document !== 'undefined' ? (document.getElementById('game-container') || document.body) : null);

    this.panel = null;
    this.widget = null;
    this.header = null;
    this.pillsContainer = null;
    this.messagesContainer = null;
    this.inputContainer = null;
    this.input = null;
    this.sendBtn = null;
    this.emojiBtns = [];

    this.isManuallyHidden = false;
    this.toggleBtn = null;
    this.unreadBadgeEl = null;
    this.unreadCount = 0;
    this._boundOnToggleClick = null;
    this._boundViewportHandler = null;
    this._boundInputFocus = null;

    this._boundOnKeyDown = null;
    this._boundOnSendClick = null;
    this._boundEmojiClicks = [];
    this._isClearing = false;

    this.initHUD();
  }

  /**
   * Initializes HUD DOM elements and mounts ZeroChatWidget.
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

    /*
      <div id="proximity-chat-header" class="proximity-chat-header">
        <div class="proximity-pills-list" id="proximity-pills-list"></div>
      </div>
      <div id="proximity-chat-messages" class="proximity-chat-messages"></div>
      <div id="proximity-chat-input-container" class="proximity-chat-input-container">
        <!-- Retired quick emoji bar: 👋, 🐾, ❤️, ☕ and send button in Ticket-023 in favor of streamlined text input -->
        <div id="proximity-chat-input-bar" class="proximity-input-row">
          <input
            type="text"
            id="proximity-chat-input"
            placeholder="Say something to the group... (Enter to send)"
            maxlength="100"
            autocomplete="off"
          />
        </div>
      </div>
    */

    if (this.container) {
      this.container.appendChild(panel);
    } else if (document.body) {
      document.body.appendChild(panel);
    }

    this.panel = panel;

    // Instantiate canonical ZeroChatWidget
    this.widget = new ZeroChatWidget({
      container: this.panel,
      mode: 'embedded',
      onSendMessage: (text) => this.sendMessage(text),
      onBurnMessage: (uuid) => {
        this.messages = this.messages.filter(m => (m.messageUuid !== uuid && m.uuid !== uuid && m.id !== uuid));
        if (this.lastMessage && (this.lastMessage.messageUuid === uuid || this.lastMessage.uuid === uuid || this.lastMessage.id === uuid)) {
          this.lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
        }
        if (typeof this.onBurnMessage === 'function') {
          this.onBurnMessage(uuid);
        }
      },
      onBurnSession: () => {
        this.messages = [];
        this.lastMessage = null;
        if (typeof this.onBurnSession === 'function') {
          this.onBurnSession();
        }
      },
      onUnreadCountChange: (count) => {
        this.setUnreadBadge(count);
      }
    });

    this.header = this.widget.header || (this.panel ? this.panel.querySelector('.zero-chat-header') : null);
    if (this.header && !this.header.id) {
      this.header.id = 'proximity-chat-header';
    }
    this.pillsContainer = this.widget.statusEl || (this.panel ? this.panel.querySelector('#proximity-chat-status') : null);
    this.messagesContainer = this.widget.messagesContainer || (this.panel ? this.panel.querySelector('#proximity-chat-messages') : null);
    this.inputContainer = this.widget.form || (this.panel ? this.panel.querySelector('#proximity-chat-form') : null);
    this.input = this.widget.input || (this.panel ? this.panel.querySelector('#proximity-chat-input') : null);
    this.sendBtn = this.widget.sendBtn || (this.panel ? this.panel.querySelector('#proximity-chat-send') : null);
    this.emojiBtns = [];

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
    toggleBtn.innerHTML = `
      <span class="chat-toggle-icon">💬</span>
      <span class="chat-toggle-badge" id="chat-toggle-badge" style="display: none;">0</span>
    `;

    const parentElem = this.container || document.body;
    if (parentElem) {
      parentElem.appendChild(toggleBtn);
    }
    this.toggleBtn = toggleBtn;
    this.unreadBadgeEl = toggleBtn.querySelector('#chat-toggle-badge');

    // Toggle button click handler
    this._boundOnToggleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleVisibility();
    };
    this.toggleBtn.addEventListener('click', this._boundOnToggleClick);

    this.initViewportHandling();
  }

  /**
   * Binds visualViewport event listeners to adapt proximity chat layout for mobile virtual keyboards.
   */
  initViewportHandling() {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    this.updateViewport = () => {
      if (typeof window === 'undefined' || !window.visualViewport) return;
      const vh = window.visualViewport.height;
      const vt = window.visualViewport.offsetTop;
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.style.setProperty('--vdw-viewport-height', `${vh}px`);
        document.documentElement.style.setProperty('--vdw-viewport-top', `${vt}px`);
      }
      if (this.panel && this.panel.classList.contains('active')) {
        this.panel.style.maxHeight = `${Math.min(vh - 24, 520)}px`;
      }
    };

    this._boundViewportHandler = this.updateViewport;
    window.visualViewport.addEventListener('resize', this._boundViewportHandler);
    window.visualViewport.addEventListener('scroll', this._boundViewportHandler);

    if (this.input) {
      this._boundInputFocus = () => {
        setTimeout(() => {
          if (typeof this.updateViewport === 'function') {
            this.updateViewport();
          }
          if (this.input && typeof this.input.scrollIntoView === 'function') {
            this.input.scrollIntoView({ block: 'nearest' });
          }
        }, 150);
      };
      this.input.addEventListener('focus', this._boundInputFocus);
    }

    this.updateViewport();
  }

  _handleInputSubmit() {
    if (!this.input) return;
    const text = this.input.value.trim();
    if (text) {
      this.sendMessage(text);
      this.input.value = '';
      this.input.focus();
    }
  }

  /**
   * Submits a message from the local player (sendMessage implementation).
   * @param {string} text
   */
  sendMessage(text) {
    if (!text) return null;
    const trimmed = String(text).trim();
    if (!trimmed) return null;

    const localP = (this.participants && this.participants.find(p => p.isLocal)) || { id: 'local', name: 'You' };
    const sId = localP.id;
    const sName = localP.name;

    if (!this.playerColors.has(sId)) {
      const color = PLAYER_PALETTE[this.playerColors.size % PLAYER_PALETTE.length];
      this.playerColors.set(sId, color);
    }
    const assignedColor = this.playerColors.get(sId);
    const messageUuid = 'msg-' + Math.random().toString(36).substring(2, 10);

    const msg = {
      senderId: sId,
      senderName: sName,
      name: sName,
      text: trimmed,
      isLocal: true,
      isSelf: true,
      messageUuid,
      timestamp: Date.now(),
      color: assignedColor,
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

    if (typeof this.onSendMessage === 'function') {
      this.onSendMessage(trimmed, this.getActivePeers());
    }

    if (this.widget && typeof this.widget.appendMessage === 'function') {
      return this.widget.appendMessage(msg);
    }

    return msg;
  }

  /**
   * Receives incoming remote message or appends message object.
   * @param {Object|string} msg
   */
  receiveMessage(msg) {
    if (!msg) return null;
    const msgObj = typeof msg === 'object' ? { ...msg } : { text: String(msg) };
    if (!msgObj.senderId) msgObj.senderId = msgObj.isLocal || msgObj.isSelf ? 'local' : 'peer';
    if (!msgObj.name) msgObj.name = msgObj.senderName || (msgObj.isLocal || msgObj.isSelf ? 'You' : 'Walker');
    if (!msgObj.senderName) msgObj.senderName = msgObj.name;
    if (!msgObj.messageUuid) msgObj.messageUuid = msgObj.uuid || msgObj.id || ('msg-' + Math.random().toString(36).substring(2, 10));
    if (!msgObj.timestamp) msgObj.timestamp = Date.now();
    msgObj.isSelf = Boolean(msgObj.isSelf || msgObj.isLocal);
    msgObj.isLocal = msgObj.isSelf;

    if (!this.playerColors.has(msgObj.senderId)) {
      const color = PLAYER_PALETTE[this.playerColors.size % PLAYER_PALETTE.length];
      this.playerColors.set(msgObj.senderId, color);
    }
    msgObj.color = this.playerColors.get(msgObj.senderId);
    msgObj.toString = function () { return this.text; };

    this.messages.push(msgObj);
    this.lastMessage = msgObj;

    // Increment unread count if panel is collapsed/hidden
    if (!this.isVisible()) {
      if (this.widget && typeof this.widget.incrementUnread === 'function') {
        this.widget.incrementUnread();
      } else {
        this.setUnreadBadge(this.unreadCount + 1);
      }
    }

    // Auto-unhide logic: If in an active cluster, automatically unhide panel when message is added
    if (this.isClusterActive() || this.activeCluster) {
      const isPanelActive = this.panel && this.panel.classList.contains('active');
      if (this.isManuallyHidden || !isPanelActive) {
        this.showHUD();
        this.isManuallyHidden = false;
      }
    }

    if (this.widget && typeof this.widget.appendMessage === 'function') {
      return this.widget.appendMessage(msgObj);
    }
    return msgObj;
  }

  /**
   * Public API: Backward-compatible message addition.
   */
  addMessage(senderId, senderName, text, isLocal = false) {
    if (isLocal) {
      return this.sendMessage(text);
    }
    return this.receiveMessage({
      senderId,
      name: senderName,
      senderName,
      text,
      isLocal: false,
      isSelf: false
    });
  }

  /**
   * Submits a message programmatically.
   * @param {string} text
   */
  submitMessage(text) {
    return this.sendMessage(text);
  }

  /**
   * Adds an in-thread notification message.
   * @param {string} text
   */
  addSystemMessage(text) {
    if (!text) return;
    if (this.widget && typeof this.widget.appendMessage === 'function') {
      this.widget.appendMessage({
        senderId: 'system',
        name: 'System',
        text,
        isSelf: false
      });
    }
  }

  /**
   * Burns a specific message by its UUID.
   * @param {string} messageUuid
   */
  burnMessage(messageUuid) {
    if (!messageUuid) return;
    this.messages = this.messages.filter(m => (m.messageUuid !== messageUuid && m.uuid !== messageUuid && m.id !== messageUuid));
    if (this.lastMessage && (this.lastMessage.messageUuid === messageUuid || this.lastMessage.uuid === messageUuid || this.lastMessage.id === messageUuid)) {
      this.lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    }
    if (this.widget && typeof this.widget.dissolveMessageById === 'function') {
      this.widget.dissolveMessageById(messageUuid);
    }
  }

  /**
   * Clears all messages from state and delegates to widget.burnAllMessages().
   */
  clearMessages() {
    this.messages = [];
    this.lastMessage = null;
    if (this._isClearing) return;
    this._isClearing = true;
    try {
      if (this.widget && typeof this.widget.burnAllMessages === 'function') {
        this.widget.burnAllMessages();
      }
    } finally {
      this._isClearing = false;
    }
  }

  /**
   * Public API: Returns most recent message object or string.
   */
  getLastMessage() {
    return this.lastMessage;
  }

  /**
   * Public API: Returns list of messages.
   * @returns {Array<Object>}
   */
  getMessages() {
    return this.messages;
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
   * Public API: Whether the proximity chat panel is currently visible.
   * @returns {boolean}
   */
  isVisible() {
    return Boolean(this.panel && this.panel.classList.contains('active'));
  }

  /**
   * Public API: Toggles visibility between shown and hidden.
   * @param {boolean} [force] - Optional force state
   */
  toggleVisibility(force) {
    const shouldShow = typeof force === 'boolean' ? force : !this.isVisible();
    if (!shouldShow) {
      this.hideHUD();
      this.isManuallyHidden = true;
    } else {
      this.showHUD();
      this.isManuallyHidden = false;
      if (typeof this.updateViewport === 'function') {
        this.updateViewport();
      }
    }
  }

  /**
   * Updates unread badge on #chat-toggle-btn.
   * @param {number} count
   */
  setUnreadBadge(count) {
    this.unreadCount = Math.max(0, count || 0);
    if (!this.unreadBadgeEl) return;
    if (this.unreadCount > 0) {
      this.unreadBadgeEl.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
      this.unreadBadgeEl.style.display = 'inline-flex';
    } else {
      this.unreadBadgeEl.textContent = '0';
      this.unreadBadgeEl.style.display = 'none';
    }
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
    if (typeof this.updateViewport === 'function') {
      this.updateViewport();
    }
    if (this.widget && typeof this.widget.clearUnread === 'function') {
      this.widget.clearUnread();
    } else {
      this.setUnreadBadge(0);
    }
  }

  show() {
    this.showHUD();
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
   * Refreshes participant pills in the header and updates widget peer counter.
   */
  updateParticipantsBadge() {
    if (this.widget && typeof this.widget.setPeers === 'function') {
      const activePeers = this.getActivePeers();
      const peerMeta = {};
      if (this.participants && Array.isArray(this.participants)) {
        for (const p of this.participants) {
          if (!p.isLocal) {
            peerMeta[p.id] = {
              name: p.name,
              color: this.playerColors.get(p.id) || null
            };
          }
        }
      }
      if (peerMeta && Object.keys(peerMeta).length > 0) {
        this.widget.setPeers(activePeers, activePeers.length, peerMeta);
      } else {
        this.widget.setPeers(activePeers, activePeers.length);
      }
    }
    if (!this.pillsContainer || typeof document === 'undefined') return;
    if (this.pillsContainer.id === 'proximity-pills-list') {
      this.pillsContainer.innerHTML = '';
      for (const p of this.participants) {
        const pill = document.createElement('span');
        pill.className = `participant-pill ${p.isLocal ? 'local' : 'peer'}`;
        pill.textContent = p.isLocal ? `${p.name} (You)` : p.name;
        this.pillsContainer.appendChild(pill);
      }
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
   * Supports both update(dt, localOwner, remotePlayers) and update(localOwner, remotePlayers).
   * @param {number|Object} dtOrLocalOwner
   * @param {Object} [localOwnerOrRemote]
   * @param {Map|Array|Object} [remotePlayersMap]
   */
  update(dtOrLocalOwner, localOwnerOrRemote, remotePlayersMap) {
    let dt, localOwner, remotes;
    if (typeof dtOrLocalOwner === 'object' && dtOrLocalOwner !== null && ('x' in dtOrLocalOwner || 'id' in dtOrLocalOwner)) {
      dt = 0;
      localOwner = dtOrLocalOwner;
      remotes = localOwnerOrRemote;
    } else {
      dt = dtOrLocalOwner;
      localOwner = localOwnerOrRemote;
      remotes = remotePlayersMap;
    }

    const wasActive = this.isClusterActive();

    // Expiration check:
    const now = Date.now();
    for (const [peerId, departureTimestamp] of this.departureTimers.entries()) {
      if (now - departureTimestamp >= this.retentionDuration) {
        this.purgePeerMessages(peerId);
      }
    }

    if (!localOwner || typeof localOwner.x !== 'number' || typeof localOwner.y !== 'number') {
      if (wasActive) {
        if (this.activeCluster) {
          for (const peerId of this.activeCluster) {
            this.departureTimers.set(peerId, Date.now());
          }
        }
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
        if (typeof this.onClusterChanged === 'function') {
          this.onClusterChanged([]);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
        if (this.widget && typeof this.widget.setPeers === 'function') {
          this.widget.setPeers([], 0);
        }
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
    const allRemotes = this._extractRemotePlayers(remotes).filter(r => r.id !== localId);

    // Multi-player transitive clustering via BFS from local player
    // Uses joinRadius for newcomer discovery, and leaveRadius (this.radius) for active members
    const connectedRemoteNodes = [];
    const visited = new Set();
    const queue = [localNode];

    const prevActiveIds = this.activeCluster instanceof Set
      ? this.activeCluster
      : (Array.isArray(this.activeCluster) ? new Set(this.activeCluster) : new Set());

    while (queue.length > 0) {
      const current = queue.shift();
      for (const rem of allRemotes) {
        if (!visited.has(rem.id)) {
          const dx = current.x - rem.x;
          const dy = current.y - rem.y;
          const dist = Math.hypot(dx, dy);

          // Apply hysteresis: if peer is already active in cluster, stay in up to this.radius (leave threshold);
          // if newcomer, must be within this.joinRadius to initiate clustering.
          const effectiveThreshold = prevActiveIds.has(rem.id) ? this.radius : this.joinRadius;

          if (dist <= effectiveThreshold) {
            visited.add(rem.id);
            connectedRemoteNodes.push(rem);
            queue.push(rem);
          }
        }
      }
    }

    if (connectedRemoteNodes.length > 0) {
      const currentPeerIds = new Set(connectedRemoteNodes.map(r => r.id));
      Object.defineProperty(currentPeerIds, 'length', {
        get() { return this.size; },
        configurable: true
      });
      const remoteParticipants = connectedRemoteNodes.map(r => ({
        id: r.id,
        name: r.name,
        isLocal: false,
        toString() { return this.name; }
      }));
      const newParticipants = [localNode, ...remoteParticipants];

      // Reconnection / Join:
      for (const peerId of currentPeerIds) {
        if (this.departureTimers.has(peerId)) {
          this.departureTimers.delete(peerId);
        }
      }

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
        if (typeof this.onClusterChanged === 'function') {
          this.onClusterChanged(this.getActivePeers());
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
            this.departureTimers.set(id, Date.now());
            const prevP = this.participants.find(p => p.id === id);
            const name = prevP ? prevP.name : 'A player';
            this.addSystemMessage(`${name} left the conversation.`);
          }
        }

        if (membershipChanged) {
          this.activeCluster = currentPeerIds;
          this.participants = newParticipants;
          this.updateParticipantsBadge();
          if (typeof this.onClusterChanged === 'function') {
            this.onClusterChanged(this.getActivePeers());
          }
        }
      }
    } else {
      // 0 remote players connected to local player
      if (wasActive) {
        if (this.activeCluster) {
          for (const peerId of this.activeCluster) {
            this.departureTimers.set(peerId, Date.now());
          }
        }
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
        if (typeof this.onClusterChanged === 'function') {
          this.onClusterChanged([]);
        }
        this.activeCluster = null;
        this.participants = [];
        this.updateParticipantsBadge();
        if (this.widget && typeof this.widget.setPeers === 'function') {
          this.widget.setPeers([], 0);
        }
      }
    }

    // Expiration check:
    const checkNow = Date.now();
    for (const [peerId, departureTimestamp] of this.departureTimers.entries()) {
      if (checkNow - departureTimestamp >= this.retentionDuration) {
        this.purgePeerMessages(peerId);
      }
    }
  }

  /**
   * Purges messages sent by a departed peer after retention expiration.
   * @param {string} peerId
   */
  purgePeerMessages(peerId) {
    this.messages = this.messages.filter(m => m.senderId !== peerId);
    if (this.lastMessage && this.lastMessage.senderId === peerId) {
      this.lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    }
    if (this.widget && typeof this.widget.burnPeerMessages === 'function') {
      this.widget.burnPeerMessages(peerId);
    }
    if (this.messagesContainer && typeof document !== 'undefined') {
      const toRemove = this.messagesContainer.querySelectorAll(`[data-sender-id="${peerId}"]`);
      toRemove.forEach(el => el.remove());
    }
    this.departureTimers.delete(peerId);
  }

  /**
   * Public API: Cleans up DOM elements and event listeners.
   */
  destroy() {
    if (this.widget && typeof this.widget.destroy === 'function') {
      this.widget.destroy();
    }
    this.widget = null;

    if (this.input && this._boundOnKeyDown) {
      this.input.removeEventListener('keydown', this._boundOnKeyDown);
    }
    if (this.input && this._boundInputFocus) {
      this.input.removeEventListener('focus', this._boundInputFocus);
    }
    this._boundInputFocus = null;

    if (typeof window !== 'undefined' && window.visualViewport && this._boundViewportHandler) {
      window.visualViewport.removeEventListener('resize', this._boundViewportHandler);
      window.visualViewport.removeEventListener('scroll', this._boundViewportHandler);
    }
    this._boundViewportHandler = null;
    this.updateViewport = null;
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

    if (this.departureTimers) {
      this.departureTimers.clear();
    }
    if (this.playerColors) {
      this.playerColors.clear();
    }
  }
}

export const ProximityChatHUD = ProximityChat;
export const ProximityChatManager = ProximityChat;
export default ProximityChat;
