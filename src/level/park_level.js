// Parallax Park Level & Environment World
import { Platform, PlatformType } from '../engine/physics.js';
import { Collectible, CollectibleType } from '../entities/collectibles.js';
import { Squirrel, MudPuddle, GoalGate } from '../entities/hazards.js';

export class ParkLevel {
  constructor() {
    this.width = 3600;
    this.height = 720;

    this.platforms = [];
    this.collectibles = [];
    this.squirrels = [];
    this.mudPuddles = [];
    this.goalGate = null;

    this.buildLevel();
  }

  buildLevel() {
    // 1. Ground Platforms
    this.platforms.push(new Platform(0, 580, 800, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(860, 580, 750, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(1680, 580, 800, 140, PlatformType.SOLID));
    this.platforms.push(new Platform(2540, 580, 1060, 140, PlatformType.SOLID));

    // 2. Elevated Park Benches & Wooden Bridges (One-Way Ledges)
    // Section 1: Intro garden benches
    this.platforms.push(new Platform(240, 480, 110, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(420, 400, 130, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(620, 460, 120, 16, PlatformType.ONE_WAY));

    // Section 2: Wooden Footbridge over gap
    this.platforms.push(new Platform(780, 520, 120, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(940, 440, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1140, 370, 150, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1340, 440, 130, 16, PlatformType.ONE_WAY));

    // Section 3: High Stone Garden Walls & Pergolas
    this.platforms.push(new Platform(1540, 510, 100, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1750, 450, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(1960, 360, 160, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(2180, 300, 140, 16, PlatformType.ONE_WAY)); // High ear-flutter reach!
    this.platforms.push(new Platform(2380, 420, 120, 16, PlatformType.ONE_WAY));

    // Section 4: Final Sprint towards the Dog Park
    this.platforms.push(new Platform(2680, 470, 130, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(2880, 410, 140, 16, PlatformType.ONE_WAY));
    this.platforms.push(new Platform(3100, 460, 120, 16, PlatformType.ONE_WAY));

    // 3. Golden Bone Collectible Trails
    // Ground trail
    [150, 190, 290, 330, 700, 740, 1020, 1060, 1420, 1460, 2600, 2640].forEach(x => {
      this.collectibles.push(new Collectible(x, 545, CollectibleType.BONE));
    });

    // High arcs requiring Ear-Flap Flutter!
    this.collectibles.push(new Collectible(480, 350, CollectibleType.BONE));
    this.collectibles.push(new Collectible(1210, 320, CollectibleType.BONE));
    this.collectibles.push(new Collectible(2030, 310, CollectibleType.BONE));
    this.collectibles.push(new Collectible(2245, 250, CollectibleType.BONE)); // Apex bone

    // Special Treats: Tennis Ball for speed boosts
    this.collectibles.push(new Collectible(560, 545, CollectibleType.TENNIS_BALL));
    this.collectibles.push(new Collectible(1820, 410, CollectibleType.TENNIS_BALL));

    // Sausage treat
    this.collectibles.push(new Collectible(1210, 545, CollectibleType.SAUSAGE));

    // 4. Critters & Hazards
    this.squirrels.push(new Squirrel(460, 380));
    this.squirrels.push(new Squirrel(1190, 350));
    this.squirrels.push(new Squirrel(2010, 340));

    this.mudPuddles.push(new MudPuddle(500, 574, 90));
    this.mudPuddles.push(new MudPuddle(1880, 574, 110));

    // 5. Goal: The Grand Dog Park Gate
    this.goalGate = new GoalGate(3400, 490);
  }

  drawBackground(ctx, cameraX, viewWidth, viewHeight) {
    // 1. Sky Gradient
    const sky = ctx.createLinearGradient(0, 0, 0, viewHeight);
    sky.addColorStop(0, '#38bdf8');
    sky.addColorStop(0.55, '#bae6fd');
    sky.addColorStop(1, '#e0f2fe');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // 2. Far Clouds (Parallax Factor 0.1)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    const cloudOffset = cameraX * 0.1;
    for (let i = 0; i < 8; i++) {
      const cx = (i * 500 - cloudOffset) % (this.width * 0.4);
      const drawX = cx < -200 ? cx + viewWidth + 400 : cx;
      this.drawCloud(ctx, drawX, 80 + (i % 3) * 35, 70 + (i % 2) * 25);
    }
    ctx.restore();

    // 3. Distant Rolling Green Hills (Parallax Factor 0.3)
    ctx.save();
    ctx.fillStyle = '#86efac';
    const hillOffset = cameraX * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, viewHeight);
    for (let x = 0; x <= viewWidth; x += 60) {
      const worldX = x + hillOffset;
      const hillY = 380 + Math.sin(worldX * 0.003) * 60 + Math.cos(worldX * 0.007) * 30;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(viewWidth, viewHeight);
    ctx.fill();
    ctx.restore();

    // 4. Midground Park Trees & Fences (Parallax Factor 0.6)
    ctx.save();
    ctx.fillStyle = '#4ade80';
    const treeOffset = cameraX * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, viewHeight);
    for (let x = 0; x <= viewWidth; x += 40) {
      const worldX = x + treeOffset;
      const midY = 460 + Math.sin(worldX * 0.006) * 45;
      ctx.lineTo(x, midY);
    }
    ctx.lineTo(viewWidth, viewHeight);
    ctx.fill();
    ctx.restore();
  }

  drawCloud(ctx, x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.35, 0, Math.PI * 2);
    ctx.arc(x + size * 0.25, y - size * 0.12, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.55, y, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlatforms(ctx) {
    for (const plat of this.platforms) {
      if (plat.type === PlatformType.SOLID) {
        // Lush Grass Top & Earth Base
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(plat.x, plat.y, plat.width, 14);

        ctx.fillStyle = '#78350f';
        ctx.fillRect(plat.x, plat.y + 14, plat.width, plat.height - 14);

        // Grassy blade fringe
        ctx.fillStyle = '#16a34a';
        for (let bx = plat.x; bx < plat.x + plat.width; bx += 8) {
          ctx.fillRect(bx, plat.y - 2, 4, 3);
        }
      } else {
        // Wooden Footbridge / Park Bench Ledge
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 4);
        ctx.fill();

        ctx.fillStyle = '#d97706';
        ctx.fillRect(plat.x + 3, plat.y + 2, plat.width - 6, 4);

        // Bench wooden slats
        ctx.fillStyle = '#78350f';
        for (let lx = plat.x + 12; lx < plat.x + plat.width - 12; lx += 20) {
          ctx.fillRect(lx, plat.y, 2, plat.height);
        }
      }
    }

    // Mud puddles
    for (const mud of this.mudPuddles) {
      mud.draw(ctx);
    }

    // Goal Gate
    if (this.goalGate) {
      this.goalGate.draw(ctx);
    }
  }
}
