/**
 * @deprecated Deprecated as of ticket-018: Tombstone dropping mechanism removed.
 */
export class ChatTombstone {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.depthY = y + 8;
    this.text = options.text || options.snippet || '';
    this.participants = options.participants || [];
    this.maxLifespan = options.lifespan !== undefined ? options.lifespan : 10.0;
    this.lifespan = this.maxLifespan;
    this.alpha = 1.0;
    this.isDead = true;
  }

  update(dt) {
    return false;
  }

  draw(ctx) {}
}
