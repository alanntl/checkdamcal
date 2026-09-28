// Longitudinal section of the check dam for one day: the pond behind the
// wall, the staff gauge on its upstream face and the spillway crest.
//
// The bed is drawn from the survey, not from a stock shape: at each level the
// pond reaches upstream a distance proportional to √(surface area), so a pond
// that widens quickly with height reads as a shallow, spreading bed. Not to
// scale horizontally; the vertical scale is true.

import { stageAt } from "./engine.js";
import { num } from "./format.js";
import { s } from "./dom.js";

function text(parent, x, y, str, cls, anchor = "start") {
  const t = s("text", { x, y, class: cls, "text-anchor": anchor }, parent);
  t.textContent = str;
  return t;
}

/**
 * A made-up pond shape for the Step 1 diagram when the survey isn't entered
 * yet, built around the levels the user has typed (or Badgaon's).
 */
export function diagramStage(params) {
  const gz = Number.isFinite(params.gaugeZeroRl) ? params.gaugeZeroRl : 98.43;
  const ctf = Number.isFinite(params.ctfRl) && params.ctfRl > gz ? params.ctfRl : gz + 1.57;
  const bed = gz - Math.max(0.4, (ctf - gz) * 0.45);
  const rls = [bed, gz, (gz + ctf) / 2, ctf, ctf + 0.5];
  return { rows: rls.map((rl) => ({ rl, area: 40000 * ((rl - bed) / (ctf + 0.5 - bed)) ** 1.6, volume: 0 })), errors: [] };
}

/**
 * @param {HTMLElement} host
 * @param {{stage:{rows:object[]}, params:object, level:number, levelMax:number,
 *          gauge:number|null, spill:number, diagram?:boolean}} view
 *   diagram: label the levels the user enters in Step 1 instead of a day's water.
 */
export function drawSection(host, view) {
  const W = host.clientWidth;
  if (!W) return;
  const { stage, params, level, levelMax } = view;
  const rows = stage.rows;
  if (!rows || rows.length < 2) {
    host.replaceChildren();
    return;
  }
  const narrow = W < 520;
  const H = Math.round(Math.min(310, Math.max(220, W * (narrow ? 0.62 : 0.44))));
  const bed = rows[0].rl;
  const ctf = params.ctfRl;
  const gz = params.gaugeZeroRl;
  const gaugeTop = Math.max(ctf + 0.3, gz + 1);
  const yLo = bed - 0.45;
  const yHi = Math.max(ctf + 0.65, (levelMax || level) + 0.25, gaugeTop + 0.15);
  const padTop = 18;
  const padBottom = 6;
  const Y = (rl) => padTop + ((yHi - rl) / (yHi - yLo)) * (H - padTop - padBottom);

  const damX = Math.round(W * (narrow ? 0.66 : 0.6));
  const crestW = narrow ? 16 : 24;
  const dsGround = bed - 0.2;
  const toeX = damX + crestW + (Y(dsGround) - Y(ctf)) * 0.6;
  const leftLimit = narrow ? 6 : 18;

  // Upstream reach at a level, scaled so the top of the survey meets the left edge.
  const topRl = Math.min(rows[rows.length - 1].rl, yHi);
  const k = (damX - leftLimit) / Math.sqrt(Math.max(1, stageAt(stage, topRl).area));
  const reach = (rl) => Math.min(damX - leftLimit + 40, k * Math.sqrt(Math.max(0, stageAt(stage, rl).area)));
  const steps = 48;
  const bedCurve = [];
  for (let i = 0; i <= steps; i++) {
    const rl = bed + ((yHi - bed) * i) / steps;
    bedCurve.push([Math.max(0, damX - reach(rl)), Y(rl), rl]);
  }

  const svg = s("svg", {
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    class: "section-svg",
    role: "img",
    "aria-label": `Section through the check dam: water at ${num(level, 2)} m, spillway crest at ${num(ctf, 2)} m, bed at ${num(bed, 2)} m.`,
  });
  const defs = s("defs", {}, svg);
  const clipId = `dam-clip-${Math.random().toString(36).slice(2, 8)}`;
  const damPts = `${damX},${Y(ctf)} ${damX + crestW},${Y(ctf)} ${toeX},${Y(dsGround)} ${damX},${Y(bed)}`;
  s("polygon", { points: damPts }, s("clipPath", { id: clipId }, defs));

  // Earth: upstream bed rising to the bank, under the wall, downstream apron.
  const earth = [
    ...bedCurve.map(([x, y]) => `${x},${y}`),
    `0,${bedCurve[bedCurve.length - 1][1]}`,
    `0,${H}`,
    `${W},${H}`,
    `${W},${Y(dsGround - 0.05)}`,
    `${toeX},${Y(dsGround)}`,
    `${damX},${Y(bed)}`,
  ];
  s("polygon", { points: earth.join(" "), class: "sec-earth" }, svg);
  s("polyline", { points: bedCurve.map(([x, y]) => `${x},${y}`).join(" "), class: "sec-bed" }, svg);
  s("polyline", { points: `${toeX},${Y(dsGround)} ${W},${Y(dsGround - 0.05)}`, class: "sec-bed" }, svg);

  // The wall, with stone courses.
  s("polygon", { points: damPts, class: "sec-dam" }, svg);
  const courses = s("g", { "clip-path": `url(#${clipId})`, class: "sec-course" }, svg);
  const course = 9;
  for (let y = Y(ctf) + course, row = 0; y < Y(dsGround); y += course, row++) {
    s("line", { x1: damX, x2: toeX + 4, y1: y, y2: y }, courses);
    for (let x = damX + (row % 2 ? 7 : 16); x < toeX; x += 18) s("line", { x1: x, x2: x, y1: y - course, y2: y }, courses);
  }
  s("line", { x1: damX, x2: damX + crestW, y1: Y(ctf), y2: Y(ctf), class: "sec-crest" }, svg);

  // Staff gauge on the upstream face: alternating 5 cm blocks, the classic "E".
  const gx = damX - (narrow ? 10 : 13);
  const gw = narrow ? 8 : 11;
  s("rect", { x: gx, y: Y(gaugeTop), width: gw, height: Y(gz) - Y(gaugeTop), class: "sec-gauge" }, svg);
  const marks = s("g", { class: "sec-gauge-mark" }, svg);
  const cmTop = Math.floor((gaugeTop - gz) * 100);
  for (let cm = 0; cm < cmTop; cm += 10) {
    const y0 = Y(gz + (cm + 5) / 100);
    const y1 = Y(gz + cm / 100);
    s("rect", { x: cm % 20 ? gx + gw / 2 : gx, y: y0, width: gw / 2, height: y1 - y0 }, marks);
  }
  const scale = s("g", { class: "sec-scale" }, svg);
  for (let cm = 0; cm <= cmTop; cm += 50) {
    const y = Y(gz + cm / 100);
    s("line", { x1: gx - 4, x2: gx, y1: y, y2: y }, scale);
    if (view.diagram && cm === 0) text(scale, gx - 6, y + 4, `0 cm = ${view.numbers ? `${num(gz, 2)} m` : "gauge zero"}`, "sec-label sec-label-strong", "end");
    else text(scale, gx - 6, y + 4, cm === 0 ? "0 cm" : String(cm), "sec-tick", "end");
  }

  // Water: from the wall back along the bed to where the bed meets the surface.
  const lv = Math.max(bed, level);
  if (level > bed + 1e-6) {
    const under = bedCurve.filter(([, , rl]) => rl < lv);
    const edgeX = Math.max(0, damX - reach(lv));
    const pts = [`${damX},${Y(lv)}`, `${edgeX},${Y(lv)}`, ...under.reverse().map(([x, y]) => `${x},${y}`), `${damX},${Y(bed)}`];
    s("polygon", { points: pts.join(" "), class: "sec-water" }, svg);
    let surfaceEnd = damX;
    if (level > ctf) {
      // Water over the crest and the nappe down the downstream face.
      const over = Y(level);
      s("polygon", { points: `${damX},${over} ${damX + crestW},${over} ${damX + crestW},${Y(ctf)} ${damX},${Y(ctf)}`, class: "sec-water" }, svg);
      const drop = Math.min(Y(dsGround) - over, 60);
      s(
        "path",
        {
          d: `M${damX + crestW},${over} C${damX + crestW + 14},${over + 2} ${damX + crestW + 22},${over + drop * 0.5} ${damX + crestW + 26},${over + drop}`,
          class: "sec-nappe",
        },
        svg,
      );
      surfaceEnd = damX + crestW;
    }
    s("line", { x1: edgeX, x2: surfaceEnd, y1: Y(lv), y2: Y(lv), class: "sec-surface" }, svg);
    // The day before's water line, for comparing one day with the next.
    if (Number.isFinite(view.prevLevel) && Math.abs(view.prevLevel - level) > 1e-6 && view.prevLevel > bed) {
      const pl = Math.min(view.prevLevel, yHi);
      const px = Math.max(0, damX - reach(pl));
      s("line", { x1: px, x2: damX, y1: Y(pl), y2: Y(pl), class: "sec-prev" }, svg);
      text(svg, px + 4, Y(pl) + (pl > level ? -6 : 14), narrow ? "Day before" : `Day before ${num(view.prevLevel, 2)} m`, "sec-label sec-label-muted");
    }
    // Reading on the gauge.
    if (view.gauge != null && level >= gz) {
      const y = Y(level);
      s("path", { d: `M${gx - 3},${y} l-7,-5 v10 z`, class: "sec-pointer" }, svg);
    }
    const labelX = Math.max(edgeX + 6, 8);
    const lbl = s("g", {}, svg);
    if (!view.diagram) text(lbl, Math.min(labelX, gx - 150), Y(lv) - 8, `Water ${num(level, 2)} m`, "sec-label sec-label-strong");
    else text(lbl, Math.min(labelX, gx - 120), Y(lv) + 18, "Water in the pond", "sec-label");
  } else {
    text(svg, damX - 20, Y(bed) - 8, "Dry", "sec-label", "end");
  }

  // Levels, labelled downstream of the wall where there is open space.
  const crestText = view.diagram ? (view.numbers ? `Spillway ${num(ctf, 2)} m` : "Spillway level") : `Spillway crest ${num(ctf, 2)} m`;
  if (narrow) {
    text(svg, W - 4, Y(ctf) - 6, view.diagram ? crestText : `Crest ${num(ctf, 2)} m`, "sec-label sec-label-strong", "end");
    if (level > ctf && view.spill > 0) text(svg, W - 4, Y(ctf) + 16, `Spilling`, "sec-label sec-label-strong", "end");
  } else {
    const lx = damX + crestW + 8;
    text(svg, lx, Y(ctf) - 6, crestText, view.diagram ? "sec-label sec-label-strong" : "sec-label");
    if (level > ctf && view.spill > 0) {
      const sx = damX + crestW + 34;
      text(svg, sx, Y(ctf) + 16, "Spilling", "sec-label sec-label-strong");
      text(svg, sx, Y(ctf) + 32, `${num(view.spill)} m³ that day`, "sec-label");
    }
    if (view.diagram) text(svg, lx, Y(ctf) + 12, "water flows over above this", "sec-label sec-label-muted");
  }
  if (!view.diagram) text(svg, damX - 20, Math.min(H - 8, Y(bed) + 16), `Bed ${num(bed, 2)} m`, "sec-label sec-label-muted", "end");
  else text(svg, damX - 20, Math.min(H - 8, Y(bed) + 16), "Lowest point of the pond", "sec-label sec-label-muted", "end");

  host.replaceChildren(svg);
}

/**
 * The picture on the Start page: what happens to the water a check dam holds.
 * Arrows use the same colours as the results — inflow blue, evaporation
 * orange, recharge aqua, spill grey — so the legend is learned once.
 */
export function drawExplainer(host) {
  const W = host.clientWidth;
  if (!W) return;
  const narrow = W < 560;
  const H = Math.round(Math.min(400, Math.max(280, W * (narrow ? 0.9 : 0.46))));
  const svg = s("svg", {
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    class: "section-svg explainer-svg",
    role: "img",
    "aria-label":
      "Rain runs off the land into the pond behind the check dam. From the pond, some water evaporates, some soaks into the ground to the groundwater, and the rest spills over the dam. A gauge board on the dam shows the water level.",
  });
  const defs = s("defs", {}, svg);
  for (const [id, color] of [
    ["in", "var(--c-water)"],
    ["evap", "var(--c-evap)"],
    ["rech", "var(--c-recharge)"],
    ["spill", "var(--c-spill)"],
  ]) {
    const m = s("marker", { id: `arrow-${id}`, viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    s("path", { d: "M0,0 L10,5 L0,10 z", fill: color }, m);
  }

  // Geometry: a hillside on the left, the pond, the wall, the stream below.
  const damX = W * (narrow ? 0.66 : 0.62);
  const crestW = narrow ? 14 : 22;
  const crestY = H * 0.36;
  const waterY = crestY - 3;
  const bedBottom = H * 0.64;
  const gwY = H * 0.8;
  const bedAt = (x) => {
    // A smooth bowl from the bank (x0) down to the foot of the wall.
    const x0 = W * 0.2;
    if (x <= x0) return H * 0.46 - (x0 - x) * 0.55;
    const t = (x - x0) / (damX - x0);
    return H * 0.46 + (bedBottom - H * 0.46) * Math.sin((t * Math.PI) / 2);
  };
  const bankTop = Math.max(8, bedAt(0));
  const pts = [];
  for (let x = 0; x <= damX; x += 6) pts.push([x, bedAt(x)]);
  pts.push([damX, bedAt(damX)]);
  const toeX = damX + crestW + (bedBottom - crestY) * 0.5;
  s("rect", { x: 0, y: gwY, width: W, height: H - gwY, class: "sec-groundwater" }, svg);
  s(
    "polygon",
    {
      points: [...pts.map(([x, y]) => `${x},${y}`), `${toeX},${bedBottom + 6}`, `${W},${bedBottom + 10}`, `${W},${gwY}`, `0,${gwY}`, `0,${bankTop}`].join(" "),
      class: "sec-earth",
    },
    svg,
  );
  s("polyline", { points: pts.map(([x, y]) => `${x},${y}`).join(" "), class: "sec-bed" }, svg);
  // Water in the pond, up to where it meets the bank.
  let edge = 0;
  for (const [x, y] of pts) if (y <= waterY) edge = x;
  const under = pts.filter(([x, y]) => x >= edge && y >= waterY);
  s("polygon", { points: [`${edge},${waterY}`, ...under.map(([x, y]) => `${x},${y}`), `${damX},${waterY}`].join(" "), class: "sec-water" }, svg);
  s("line", { x1: edge, x2: damX + crestW, y1: waterY, y2: waterY, class: "sec-surface" }, svg);
  // The wall and its gauge board.
  s("polygon", { points: `${damX},${crestY} ${damX + crestW},${crestY} ${toeX},${bedBottom + 6} ${damX},${bedAt(damX)}`, class: "sec-dam" }, svg);
  const gx = damX - (narrow ? 9 : 12);
  const gw = narrow ? 7 : 10;
  s("rect", { x: gx, y: crestY - 26, width: gw, height: bedAt(damX) - crestY - 10, class: "sec-gauge" }, svg);
  const marks = s("g", { class: "sec-gauge-mark" }, svg);
  for (let y = crestY - 22, k = 0; y < bedAt(damX) - 40; y += 7, k++) s("rect", { x: k % 2 ? gx + gw / 2 : gx, y, width: gw / 2, height: 3.5 }, marks);

  // Rain on the catchment.
  const rain = s("g", { class: "sec-rain" }, svg);
  for (let i = 0; i < (narrow ? 7 : 12); i++) {
    const x = W * 0.02 + i * (W * (narrow ? 0.06 : 0.035)) + (i % 2) * 6;
    const y = H * 0.05 + (i % 3) * 12;
    s("line", { x1: x, y1: y, x2: x - 4, y2: y + 10 }, rain);
  }

  // Arrows.
  const arrow = (d, kind) => s("path", { d, class: `sec-arrow sec-arrow-${kind}`, "marker-end": `url(#arrow-${kind})` }, svg);
  const inX0 = W * 0.04;
  arrow(`M${inX0},${bedAt(inX0) - 16} Q${W * 0.12},${bedAt(W * 0.12) - 18} ${Math.max(edge - 6, W * 0.16)},${waterY - 8}`, "in");
  const evapXs = [0.34, 0.42, 0.5].map((f) => W * f);
  for (const x of evapXs) arrow(`M${x},${waterY - 6} l0,-${narrow ? 22 : 30}`, "evap");
  const rechXs = [0.32, 0.41, 0.5].map((f) => W * f);
  for (const x of rechXs) arrow(`M${x},${bedAt(x) + 6} L${x},${gwY - 4}`, "rech");
  arrow(`M${damX + crestW},${waterY} C${damX + crestW + 16},${waterY + 2} ${damX + crestW + 24},${waterY + 30} ${damX + crestW + 26},${bedBottom - 4}`, "spill");
  arrow(`M${toeX + 8},${bedBottom} L${W - 10},${bedBottom + 4}`, "spill");

  // Labels. The recharge label sits under the arrowheads, in the groundwater
  // band they point at; the gauge label goes right of the wall, in open air.
  const L = (x, y, str, anchor = "start", cls = "sec-label sec-label-strong") => text(svg, x, y, str, cls, anchor);
  const gaugeTop = crestY - 26;
  const gLabelX = damX + crestW + 14;
  s("path", { d: `M${gx + gw / 2},${gaugeTop - 2} L${gx + gw / 2},${gaugeTop - 12} L${gLabelX - 4},${gaugeTop - 12}`, class: "leader" }, svg);
  if (narrow) {
    L(W * 0.03, H * 0.05 + 40, "Rain runs in");
    L(W * 0.42, waterY - 38, "Evaporates", "middle");
    L(W * 0.41, gwY + 16, "Soaks in: recharge", "middle");
    L(W - 6, bedBottom + 24, "Spills over", "end");
    L(gLabelX, gaugeTop - 8, "Gauge board", "start", "sec-label");
    L(W * 0.5, H - 8, "Groundwater", "middle", "sec-label");
  } else {
    L(W * 0.03, H * 0.05 + 44, "Rain runs off the land into the pond");
    L(W * 0.42, waterY - 42, "Some evaporates", "middle");
    L(W * 0.41, gwY + 18, "Some soaks into the ground: groundwater recharge", "middle");
    L(W - 8, bedBottom - 12, "The rest spills over the dam", "end");
    L(gLabelX, gaugeTop - 8, "Gauge board: read the level every day", "start", "sec-label");
    L(W * 0.5, H - 10, "Groundwater, the water that wells draw on", "middle", "sec-label");
  }
  host.replaceChildren(svg);
}
