// Tiny DOM helpers. Text always goes in through textContent / text nodes,
// never innerHTML, because site names, sheet names and headers come from files.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * h("button", { class: "btn", text: "Save", onclick }, child, ...)
 * Attributes: class, text, style, on<event> handlers, booleans (true -> "").
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** SVG element with attributes, optionally appended to a parent. */
export function s(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}
