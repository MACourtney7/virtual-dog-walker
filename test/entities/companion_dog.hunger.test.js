import { describe, it, expect, vi } from 'vitest';
import { CompanionDog } from '../../src/entities/companion_dog.js';

function makeDog() {
  // No owner => off-leash roaming; construction must not require a game loop.
  return new CompanionDog(100, 100, null);
}

describe('CompanionDog hunger state', () => {
  it('setHunger({ isHungry: true }) flips dog.isHungry', () => {
    const dog = makeDog();
    expect(dog.isHungry).toBe(false);
    dog.setHunger({ isHungry: true });
    expect(dog.isHungry).toBe(true);
    expect(dog.hunger).toEqual({ isHungry: true });
  });

  it('setHunger({ isHungry: false }) clears it', () => {
    const dog = makeDog();
    dog.setHunger({ isHungry: true });
    dog.setHunger({ isHungry: false });
    expect(dog.isHungry).toBe(false);
  });

  it('setHunger(undefined) does not throw and clears state', () => {
    const dog = makeDog();
    dog.setHunger({ isHungry: true });
    expect(() => dog.setHunger(undefined)).not.toThrow();
    expect(dog.isHungry).toBe(false);
    expect(dog.hunger).toBeNull();
  });

  it('setHunger is idempotent', () => {
    const dog = makeDog();
    dog.setHunger({ isHungry: true });
    dog.setHunger({ isHungry: true });
    expect(dog.isHungry).toBe(true);
  });
});

describe('CompanionDog animation hooks', () => {
  it('playHungryAnimation invokes the emote/cue system', () => {
    const dog = makeDog();
    const spy = vi.spyOn(dog, 'setEmote');
    const result = dog.playHungryAnimation();
    expect(result).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(dog.emoteBubble).toBe('🍖');
  });

  it('playFeedReaction invokes the emote/cue system', () => {
    const dog = makeDog();
    const spy = vi.spyOn(dog, 'setEmote');
    const result = dog.playFeedReaction();
    expect(result).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(dog.emoteBubble).toBe('❤️');
  });

  it('animation hooks are guarded when dependencies are unavailable', () => {
    const dog = makeDog();
    // Force the emote system to throw to prove the guard swallows it.
    dog.setEmote = () => { throw new Error('boom'); };
    expect(() => dog.playHungryAnimation()).not.toThrow();
    expect(() => dog.playFeedReaction()).not.toThrow();
    expect(dog.playHungryAnimation()).toBe(false);
    expect(dog.playFeedReaction()).toBe(false);
  });
});

describe('CompanionDog setDogStateStore', () => {
  function makeStore(initial) {
    let snapshot = initial;
    const listeners = new Set();
    return {
      getSnapshot: () => snapshot,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      emit: (next) => {
        snapshot = next;
        for (const fn of listeners) fn(snapshot);
      },
      listenerCount: () => listeners.size
    };
  }

  it('subscribes and syncs immediately from getSnapshot', () => {
    const dog = makeDog();
    const store = makeStore({ hunger: { isHungry: true } });
    dog.setDogStateStore(store);
    expect(store.listenerCount()).toBe(1);
    expect(dog.isHungry).toBe(true);
  });

  it('syncs immediately from getHunger when getSnapshot is absent', () => {
    const dog = makeDog();
    const store = {
      getHunger: () => ({ isHungry: true }),
      subscribe: () => () => {}
    };
    dog.setDogStateStore(store);
    expect(dog.isHungry).toBe(true);
  });

  it('subsequent store notifications update dog hunger', () => {
    const dog = makeDog();
    const store = makeStore({ hunger: { isHungry: false } });
    dog.setDogStateStore(store);
    expect(dog.isHungry).toBe(false);
    store.emit({ hunger: { isHungry: true } });
    expect(dog.isHungry).toBe(true);
    store.emit({ hunger: { isHungry: false } });
    expect(dog.isHungry).toBe(false);
  });

  it('accepts a bare hunger object from the store', () => {
    const dog = makeDog();
    const store = makeStore({ isHungry: true });
    dog.setDogStateStore(store);
    expect(dog.isHungry).toBe(true);
  });

  it('unsubscribe/cleanup does not throw', () => {
    const dog = makeDog();
    const store = makeStore({ hunger: { isHungry: true } });
    const unsub = dog.setDogStateStore(store);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(store.listenerCount()).toBe(0);
  });

  it('does not throw for null or malformed stores', () => {
    const dog = makeDog();
    expect(() => dog.setDogStateStore(null)).not.toThrow();
    expect(() => dog.setDogStateStore(undefined)).not.toThrow();
    expect(() => dog.setDogStateStore({})).not.toThrow();
    expect(() => dog.setDogStateStore({ subscribe: () => { throw new Error('x'); } })).not.toThrow();
  });

  it('replacing the store tears down the previous subscription', () => {
    const dog = makeDog();
    const first = makeStore({ hunger: { isHungry: true } });
    const second = makeStore({ hunger: { isHungry: false } });
    dog.setDogStateStore(first);
    expect(first.listenerCount()).toBe(1);
    dog.setDogStateStore(second);
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
    expect(dog.isHungry).toBe(false);
  });
});
