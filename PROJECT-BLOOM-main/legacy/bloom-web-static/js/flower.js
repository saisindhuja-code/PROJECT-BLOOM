// =====================================================================
// flower.js — YOUR original Python Turtle flower, rewritten in JavaScript
// Every step matches your Python code: same rings, same stem, same leaves,
// the word written at every point of every petal, and the ♡ hearts.
// =====================================================================

const FLOWER_WIDTH = 900;               // screen.setup(width=900, height=600)
const FLOWER_HEIGHT = 600;
const PETAL_FONT = "bold 11px Arial";   // Tk ("arial", 8, "bold") ≈ 11 px
const HEART_FONT = "bold 13px 'Courier New', monospace";

// The colors from your original code
const DEFAULT_COLORS = {
  ring1: "#ffe6f2",
  ring2: "#ffb3d9",
  ring3: "#ff66b2",
  ring4: "#ff1493",
  ring5: "#c71585",
  green: "#2e8b57",
  hearts: "#ff99cc",
  background: "#180018",
};

// A random-number generator that gives the SAME numbers for the same seed,
// so a flower saved in the gallery redraws with its hearts in the same spots.
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds the list of drawing steps (like the turtle's moves) for one flower.
function planFlowerSteps(recipe) {
  const word = String(recipe.word);
  const colors = { ...DEFAULT_COLORS, ...recipe.colors };
  const random = seededRandom(recipe.seed || 1);
  const steps = [];

  // ---- a tiny turtle ----
  // Turtle: (0, 0) in the middle, y goes UP. Canvas: (0, 0) top-left, y goes DOWN.
  const pen = { x: 0, y: 0, heading: 0, down: false, color: "#000", size: 1 };
  const toCanvas = (x, y) => [FLOWER_WIDTH / 2 + x, FLOWER_HEIGHT / 2 - y];

  function goto(x, y) {
    if (pen.down) {
      const [x1, y1] = toCanvas(pen.x, pen.y);
      const [x2, y2] = toCanvas(x, y);
      const { color, size } = pen;
      steps.push(ctx => {
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });
    }
    pen.x = x;
    pen.y = y;
  }

  function write(text, font) {
    const [x, y] = toCanvas(pen.x, pen.y);
    const color = pen.color;
    steps.push(ctx => {
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = "center";     // align="center"
      ctx.textBaseline = "bottom";  // turtle writes just above the point
      ctx.fillText(text, x, y);
    });
  }

  // Same as t.circle(radius, extent): the turtle turns left around a circle.
  function circle(radius, extent) {
    const h = pen.heading * Math.PI / 180;
    const centerX = pen.x + radius * Math.cos(h + Math.PI / 2);
    const centerY = pen.y + radius * Math.sin(h + Math.PI / 2);
    for (let d = 1; d <= extent; d++) {
      const a = (pen.heading - 90 + d) * Math.PI / 180;
      goto(centerX + radius * Math.cos(a), centerY + radius * Math.sin(a));
    }
    pen.heading += extent;
  }

  // ---- your draw_petal and draw_leaf ----
  function drawPetal(base, baseAngle, length, width, color, points = 20) {
    pen.color = color;
    const [bx, by] = base;
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);
    for (let i = 0; i <= points; i++) {
      const theta = i * Math.PI / points;
      const out = length * Math.sin(theta);
      const side = width * Math.sin(theta) * Math.cos(theta);
      const rx = out * cosA - side * sinA;
      const ry = out * sinA + side * cosA;
      goto(bx + rx, by + ry);
      write(word, PETAL_FONT);
    }
  }

  function drawLeaf(base, angleDeg, length, width) {
    drawPetal(base, angleDeg * Math.PI / 180, length, width, colors.green, 22);
  }

  // ---- your rings ----
  const rings = [
    { radius: 0,  count: 4,  length: 40,  width: 15, color: colors.ring1, offset: 45 },
    { radius: 10, count: 5,  length: 50,  width: 25, color: colors.ring2, offset: 0 },
    { radius: 20, count: 7,  length: 70,  width: 35, color: colors.ring3, offset: 30 },
    { radius: 30, count: 9,  length: 90,  width: 45, color: colors.ring4, offset: 15 },
    { radius: 40, count: 12, length: 110, width: 55, color: colors.ring5, offset: 0 },
  ];

  // ---- the stem and leaves, in the same order as your code ----
  goto(0, -30);
  pen.heading = 260;
  pen.down = true;
  pen.color = colors.green;
  pen.size = 4;
  circle(250, 25);

  const pos1 = [pen.x, pen.y], head1 = pen.heading;
  pen.size = 1;
  drawLeaf(pos1, 160, 50, 25);           // pen is still down here, like your code
  pen.down = false;
  goto(...pos1);
  pen.heading = head1;
  pen.down = true;

  pen.color = colors.green;
  pen.size = 4;
  circle(250, 30);
  pen.down = false;
  pen.size = 1;

  const pos2 = [pen.x, pen.y], head2 = pen.heading;
  drawLeaf(pos2, 20, 55, 28);
  pen.down = false;
  goto(...pos2);
  pen.heading = head2;
  pen.down = true;

  pen.color = colors.green;
  pen.size = 4;
  circle(250, 30);
  pen.down = false;
  pen.size = 1;

  // ---- the petal rings ----
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const angle = (360 / ring.count) * i + ring.offset;
      const rad = angle * Math.PI / 180;
      const base = [ring.radius * Math.cos(rad), ring.radius * Math.sin(rad)];
      drawPetal(base, rad, ring.length, ring.width, ring.color);
    }
  }

  // ---- the floating hearts ----
  pen.color = colors.hearts;
  for (let n = 0; n < 12; n++) {
    const x = Math.floor(random() * 501) - 250;   // random.randint(-250, 250)
    const y = Math.floor(random() * 501) - 250;
    if (Math.hypot(x, y) > 130) {
      goto(x, y);
      write("♡", HEART_FONT);
    }
  }

  return { steps, background: colors.background };
}

// Makes a canvas sharp on high-resolution screens.
function sizeCanvas(canvas, width, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
}

// Draws a flower on any canvas (big or small). With animate: true it grows
// a few steps per frame, like watching the turtle draw.
function drawFlower(canvas, recipe, { animate = false, stepsPerFrame = 8 } = {}) {
  const ctx = canvas.getContext("2d");
  const zoom = canvas.width / FLOWER_WIDTH;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);

  const { steps, background } = planFlowerSteps(recipe);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, FLOWER_WIDTH, FLOWER_HEIGHT);

  if (!animate) {
    steps.forEach(step => step(ctx));
    return { done: Promise.resolve(), cancel() {} };
  }

  let frameId = null;
  let cancelled = false;
  const done = new Promise(resolve => {
    let index = 0;
    function frame() {
      if (cancelled) return;
      const end = Math.min(index + stepsPerFrame, steps.length);
      for (; index < end; index++) steps[index](ctx);
      if (index < steps.length) frameId = requestAnimationFrame(frame);
      else resolve();
    }
    frame();
  });
  return {
    done,
    cancel() {
      cancelled = true;
      cancelAnimationFrame(frameId);
    },
  };
}

// The empty canvas shown before anything has grown.
function drawPlaceholder(canvas, background, text) {
  const ctx = canvas.getContext("2d");
  const zoom = canvas.width / FLOWER_WIDTH;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, FLOWER_WIDTH, FLOWER_HEIGHT);
  ctx.fillStyle = isLightColor(background) ? "rgba(47, 41, 37, 0.45)" : "rgba(255, 255, 255, 0.5)";
  ctx.font = "italic 30px 'Cormorant Garamond', Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, FLOWER_WIDTH / 2, FLOWER_HEIGHT / 2);
}

function isLightColor(hex) {
  const value = parseInt(hex.slice(1), 16);
  const r = value >> 16, g = (value >> 8) & 255, b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// Saves a canvas as a PNG file.
function downloadCanvas(canvas, word) {
  const safeName = String(word).trim().replace(/[^\w-]+/g, "-") || "flower";
  const link = document.createElement("a");
  link.download = `bloom-${safeName}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
