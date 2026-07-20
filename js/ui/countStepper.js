/**
 * countStepper.js — the shared − [have/needed] + control (v0.9.2).
 *
 * One counter, one source of truth: every stepper reads and writes
 * profile.inventory[itemId], so ticking a bolt on the Hideout shopping
 * list, a quest card's hand-in, or the Needed Items page all move the
 * same number. Rendered inline wherever collectible items appear.
 */
import { el } from "./dom.js";
import { update } from "../core/store.js";

/**
 * @param {string} itemId
 * @param {number} have    current collected count (caller reads profile.inventory)
 * @param {number} needed  target count for this context
 * @param {Function} rerender  called after every change
 * @param {{compact?: boolean, fir?: boolean}} opts  compact shrinks paddings
 *   for dense lists; fir appends a found-in-raid marker to the badge title.
 */
export function countStepper(itemId, have, needed, rerender, { compact = false, fir = false } = {}) {
  const setCount = async (n) => {
    const clamped = Math.max(0, n);
    await update((p) => {
      p.inventory = p.inventory ?? {};
      if (clamped === 0) delete p.inventory[itemId];
      else p.inventory[itemId] = clamped;
    });
    rerender();
  };
  const done = have >= needed;
  const pad = compact ? "1px 8px" : "2px 10px";
  return el("span", { style: "display:inline-flex;align-items:center;gap:5px;white-space:nowrap" },
    el("button", { class: "btn btn--ghost", title: "Decrease", style: `padding:${pad}`,
      disabled: have <= 0 ? "" : null,
      onclick: (e) => { e.stopPropagation(); setCount(have - 1); } }, "\u2212"),
    el("span", { class: `badge ${done ? "badge--ok" : "badge--brass"}`,
      style: "min-width:56px;text-align:center",
      title: fir ? "have / needed (found in raid)" : "have / needed" },
      `${have} / ${needed}`),
    el("button", { class: "btn btn--ghost", title: "Increase", style: `padding:${pad}`,
      onclick: (e) => { e.stopPropagation(); setCount(have + 1); } }, "+"),
  );
}
