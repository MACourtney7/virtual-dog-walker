// Leash length constraints and owner hold-up logic.
//
// The leash is a hard tether: the owner may never be further than
// MAX_LEASH_LENGTH from the dog while the dog is on-leash. When the dog is
// force-stopped (pooping on leash) the owner is frozen in place too.

export const MAX_LEASH_LENGTH = 52.5;

// Returns true when the owner must be force-stopped because the dog is
// currently pooping while attached to the leash.
export function isOwnerFrozen(dog) {
  return Boolean(dog && dog.isOnLeash && dog.isPooping);
}

// Clamp the owner position so it stays within `maxLen` of the dog.
// Returns the original ownerPos object when already within range.
export function clampOwnerToLeash(ownerPos, dogPos, maxLen = MAX_LEASH_LENGTH) {
  if (!ownerPos || !dogPos) return ownerPos;

  const dx = ownerPos.x - dogPos.x;
  const dy = ownerPos.y - dogPos.y;
  const dist = Math.hypot(dx, dy);

  if (!isFinite(dist) || dist <= maxLen) return ownerPos;

  // dist === 0 cannot exceed maxLen (unless maxLen < 0), but guard anyway.
  if (dist === 0) {
    return { x: dogPos.x, y: dogPos.y };
  }

  return {
    x: dogPos.x + (dx / dist) * maxLen,
    y: dogPos.y + (dy / dist) * maxLen
  };
}
