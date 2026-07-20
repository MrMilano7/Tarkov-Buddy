/**
 * dom.js — small DOM utilities shared by all pages.
 */

/**
 * Create an element.
 * el("div", { class: "panel", onclick: fn }, child1, "text", ...)
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/** Format a number as roubles: 1250000 -> "₽ 1,250,000" */
export function roubles(n) {
  return `\u20BD ${Number(n).toLocaleString("en-US")}`;
}

/** Show a toast notification. */
export function toast(message, { error = false, duration = 3000 } = {}) {
  const root = document.getElementById("toast-root");
  const node = el("div", { class: `toast${error ? " toast--error" : ""}` }, message);
  root.appendChild(node);
  setTimeout(() => node.remove(), duration);
}
