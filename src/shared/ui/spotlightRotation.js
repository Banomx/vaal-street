export function initialSpotlights(ids, count = 3) {
  const unique = [...new Set(ids)];
  return { shown: unique.slice(0, count), queue: unique.slice(count), cursor: 0, pinned: [], selected: {} };
}

export function reconcileSpotlights(state, ids) {
  const valid = new Set(ids);
  const shown = state.shown.filter((id) => valid.has(id));
  const queue = [...state.queue.filter((id) => valid.has(id) && !shown.includes(id)),
    ...ids.filter((id) => !state.shown.includes(id) && !state.queue.includes(id))];
  while (shown.length < 3 && queue.length) shown.push(queue.shift());
  return { ...state, shown, queue, cursor: shown.length ? state.cursor % shown.length : 0,
    pinned: state.pinned.filter((id) => shown.includes(id)) };
}

export function promoteSpotlight(state, incoming = state.queue[0]) {
  if (!state.queue.includes(incoming)) return state;
  for (let offset = 0; offset < state.shown.length; offset++) {
    const slot = (state.cursor + offset) % state.shown.length;
    if (state.pinned.includes(state.shown[slot])) continue;
    const shown = [...state.shown];
    const outgoing = shown[slot];
    shown[slot] = incoming;
    return { ...state, shown, queue: [...state.queue.filter((id) => id !== incoming), outgoing],
      cursor: (slot + 1) % shown.length };
  }
  return state;
}
