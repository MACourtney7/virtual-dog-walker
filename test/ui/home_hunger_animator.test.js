import { describe, it, expect, vi } from 'vitest';
import {
  HomeHungerAnimator,
  DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS
} from '../../src/ui/home_hunger_animator.js';

function makeStore(hungerInfo) {
  return {
    getHunger: vi.fn(() => hungerInfo)
  };
}

function makeDog() {
  return {
    setHunger: vi.fn(),
    playHungryAnimation: vi.fn()
  };
}

function makeTimers() {
  let nextId = 1;
  const active = new Map();
  const setIntervalFn = vi.fn((fn, ms) => {
    const id = nextId++;
    active.set(id, { fn, ms });
    return id;
  });
  const clearIntervalFn = vi.fn((id) => {
    active.delete(id);
  });
  return { setIntervalFn, clearIntervalFn, active };
}

describe('HomeHungerAnimator', () => {
  it('does nothing while fed', () => {
    const store = makeStore({ isHungry: false });
    const dog = makeDog();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      now: () => 1000
    });

    animator.tick(1000);

    expect(store.getHunger).toHaveBeenCalledWith(1000);
    expect(dog.setHunger).toHaveBeenCalledWith({ isHungry: false });
    expect(dog.playHungryAnimation).not.toHaveBeenCalled();
  });

  it('calls playHungryAnimation when hungry', () => {
    const store = makeStore({ isHungry: true });
    const dog = makeDog();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      now: () => 5000
    });

    animator.tick(5000);

    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);
  });

  it('does not call again before animationIntervalMs elapses', () => {
    const store = makeStore({ isHungry: true });
    const dog = makeDog();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      animationIntervalMs: 1000,
      now: () => 0
    });

    animator.tick(0);
    animator.tick(500);
    animator.tick(999);

    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);
  });

  it('calls again at or after animationIntervalMs', () => {
    const store = makeStore({ isHungry: true });
    const dog = makeDog();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      animationIntervalMs: 1000,
      now: () => 0
    });

    animator.tick(0);
    animator.tick(1000);
    animator.tick(2000);

    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(3);
  });

  it('clears animation schedule when no longer hungry', () => {
    let hungry = true;
    const store = {
      getHunger: vi.fn(() => ({ isHungry: hungry }))
    };
    const dog = makeDog();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      animationIntervalMs: 1000,
      now: () => 0
    });

    animator.tick(0);
    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);

    // Still hungry but within interval: no new call.
    animator.tick(500);
    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);

    // No longer hungry: schedule cleared.
    hungry = false;
    animator.tick(600);
    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);

    // Hungry again: treated as a fresh trigger.
    hungry = true;
    animator.tick(700);
    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(2);
  });

  it('start() twice does not create duplicate intervals', () => {
    const store = makeStore({ isHungry: false });
    const dog = makeDog();
    const timers = makeTimers();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      tickIntervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn
    });

    animator.start();
    animator.start();

    expect(timers.setIntervalFn).toHaveBeenCalledTimes(1);
    expect(timers.active.size).toBe(1);
  });

  it('stop() clears the interval', () => {
    const store = makeStore({ isHungry: false });
    const dog = makeDog();
    const timers = makeTimers();
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      tickIntervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn
    });

    animator.start();
    const id = timers.setIntervalFn.mock.results[0].value;
    animator.stop();

    expect(timers.clearIntervalFn).toHaveBeenCalledWith(id);
    expect(timers.active.size).toBe(0);

    // Safe to call again.
    expect(() => animator.stop()).not.toThrow();
    expect(timers.clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it('missing dog.setHunger or dog.playHungryAnimation does not throw', () => {
    const store = makeStore({ isHungry: true });
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog: {},
      now: () => 0
    });

    expect(() => animator.tick(0)).not.toThrow();
    expect(() => animator.tick(1000)).not.toThrow();
  });

  it('exposes a default animation interval constant', () => {
    expect(DEFAULT_HUNGRY_ANIMATION_INTERVAL_MS).toBe(5000);
  });

  it('prefers setGroomingState/setTirednessState over legacy hooks', () => {
    const store = {
      getHunger: vi.fn(() => ({ isHungry: false })),
      getGrooming: vi.fn(() => ({ needsGrooming: false })),
      getTiredness: vi.fn(() => ({ isTired: false }))
    };
    const dog = {
      setHunger: vi.fn(),
      setGrooming: vi.fn(),
      setTiredness: vi.fn(),
      setGroomingState: vi.fn(),
      setTirednessState: vi.fn()
    };
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      now: () => 0
    });

    animator.tick(0);

    expect(dog.setGroomingState).toHaveBeenCalledWith({ needsGrooming: false });
    expect(dog.setTirednessState).toHaveBeenCalledWith({ isTired: false });
    expect(dog.setGrooming).not.toHaveBeenCalled();
    expect(dog.setTiredness).not.toHaveBeenCalled();
  });

  it('falls back to setGrooming/setTiredness when *State hooks are absent', () => {
    const store = {
      getHunger: vi.fn(() => ({ isHungry: false })),
      getGrooming: vi.fn(() => ({ needsGrooming: false })),
      getTiredness: vi.fn(() => ({ isTired: false }))
    };
    const dog = {
      setHunger: vi.fn(),
      setGrooming: vi.fn(),
      setTiredness: vi.fn()
    };
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      now: () => 0
    });

    animator.tick(0);

    expect(dog.setGrooming).toHaveBeenCalledWith({ needsGrooming: false });
    expect(dog.setTiredness).toHaveBeenCalledWith({ isTired: false });
  });

  it('does not overwrite an active emote reported via getEmoteTimer()', () => {
    const store = makeStore({ isHungry: true });
    const dog = {
      setHunger: vi.fn(),
      playHungryAnimation: vi.fn(),
      getEmoteTimer: vi.fn(() => 1.5)
    };
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      animationIntervalMs: 1000,
      now: () => 0
    });

    animator.tick(0);

    expect(dog.getEmoteTimer).toHaveBeenCalled();
    expect(dog.playHungryAnimation).not.toHaveBeenCalled();
  });

  it('triggers when getEmoteTimer() reports no active emote', () => {
    const store = makeStore({ isHungry: true });
    const dog = {
      setHunger: vi.fn(),
      playHungryAnimation: vi.fn(),
      getEmoteTimer: vi.fn(() => 0)
    };
    const animator = new HomeHungerAnimator({
      dogStateStore: store,
      dog,
      animationIntervalMs: 1000,
      now: () => 0
    });

    animator.tick(0);

    expect(dog.playHungryAnimation).toHaveBeenCalledTimes(1);
  });
});
