// 2D Kinematic Physics & Collision Engine for Ziggy Platformer

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  length() {
    return Math.hypot(this.x, this.y);
  }
}

export class AABB {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  get left() { return this.x; }
  get right() { return this.x + this.width; }
  get top() { return this.y; }
  get bottom() { return this.y + this.height; }

  intersects(other) {
    return (
      this.left < other.right &&
      this.right > other.left &&
      this.top < other.bottom &&
      this.bottom > other.top
    );
  }
}

export const PlatformType = {
  SOLID: 'solid',
  ONE_WAY: 'one_way'
};

export class Platform extends AABB {
  constructor(x, y, width, height, type = PlatformType.SOLID) {
    super(x, y, width, height);
    this.type = type;
  }
}

export class KinematicBody {
  constructor(x, y, width, height) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.size = new Vector2(width, height);
    this.gravity = 1100; // px/s²
    this.maxFallSpeed = 700;

    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.coyoteMax = 0.12; // 120ms grace after leaving ledge
    this.jumpBufferTimer = 0;
    this.jumpBufferMax = 0.12;

    this.facing = 1; // 1 = right, -1 = left
    this.passThroughTimer = 0; // Drop down through one-way ledges
  }

  get aabb() {
    return new AABB(this.pos.x, this.pos.y, this.size.x, this.size.y);
  }

  queueJump() {
    this.jumpBufferTimer = this.jumpBufferMax;
  }

  dropThrough() {
    this.passThroughTimer = 0.25;
  }

  executeJump(force = 500) {
    this.vel.y = -force;
    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
  }

  cutJump(cutFactor = 0.45) {
    if (this.vel.y < -50) {
      this.vel.y *= cutFactor;
    }
  }

  update(dt, platforms = []) {
    // Timers
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= dt;
    if (this.passThroughTimer > 0) this.passThroughTimer -= dt;

    if (this.isGrounded) {
      this.coyoteTimer = this.coyoteMax;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // Buffered jump trigger
    if (this.jumpBufferTimer > 0 && (this.isGrounded || this.coyoteTimer > 0)) {
      this.executeJump();
    }

    // Apply gravity
    this.vel.y = Math.min(this.vel.y + this.gravity * dt, this.maxFallSpeed);

    const prevY = this.pos.y;
    const prevBottom = prevY + this.size.height;

    // Horizontal Movement & Collisions
    this.pos.x += this.vel.x * dt;
    let box = this.aabb;
    for (const plat of platforms) {
      if (plat.type === PlatformType.SOLID && box.intersects(plat)) {
        if (this.vel.x > 0) {
          this.pos.x = plat.left - this.size.x;
        } else if (this.vel.x < 0) {
          this.pos.x = plat.right;
        }
        this.vel.x = 0;
        box = this.aabb;
      }
    }

    // Vertical Movement & Collisions
    this.pos.y += this.vel.y * dt;
    this.isGrounded = false;
    box = this.aabb;

    for (const plat of platforms) {
      if (plat.type === PlatformType.SOLID) {
        if (box.intersects(plat)) {
          if (this.vel.y > 0) { // Landing on top
            this.pos.y = plat.top - this.size.height;
            this.vel.y = 0;
            this.isGrounded = true;
          } else if (this.vel.y < 0) { // Bonking ceiling
            this.pos.y = plat.bottom;
            this.vel.y = 0;
          }
          box = this.aabb;
        }
      } else if (plat.type === PlatformType.ONE_WAY && this.passThroughTimer <= 0) {
        // Only collide if falling and was above the top in previous step
        if (this.vel.y >= 0 && prevBottom <= plat.top + 4 && box.intersects(plat)) {
          this.pos.y = plat.top - this.size.height;
          this.vel.y = 0;
          this.isGrounded = true;
          box = this.aabb;
        }
      }
    }
  }
}
