// studio.js — the page where you type a word, pick paints and grow a flower

const user = requireUser("");
setupHeader(user, "");

const COLOR_IDS = Object.keys(DEFAULT_COLORS);
const form = document.getElementById("grow-form");
const wordInput = document.getElementById("word");
const canvas = document.getElementById("flower-canvas");
const caption = document.getElementById("caption");
const saveButton = document.getElementById("save");
const downloadButton = document.getElementById("download");
const toast = document.getElementById("toast");

sizeCanvas(canvas, FLOWER_WIDTH, FLOWER_HEIGHT);

let drawing = null;          // the flower currently growing
let currentFlower = null;    // word + colors + seed of the flower on the canvas

// ---- paint dabs ----
function paintDab(input) {
  input.closest(".dab").style.setProperty("--paint", input.value);
}

function readColors() {
  const colors = {};
  COLOR_IDS.forEach(id => colors[id] = document.getElementById(id).value);
  return colors;
}

function setColors(colors) {
  COLOR_IDS.forEach(id => {
    const input = document.getElementById(id);
    input.value = colors[id];
    paintDab(input);
  });
}

function showEmptyCanvas() {
  drawPlaceholder(canvas, readColors().background, "your flower will grow here");
}

COLOR_IDS.forEach(id => {
  document.getElementById(id).addEventListener("input", event => {
    paintDab(event.target);
    if (id === "background" && !currentFlower) showEmptyCanvas();
  });
});

document.getElementById("reset-paints").addEventListener("click", () => {
  setColors(DEFAULT_COLORS);
  if (!currentFlower) showEmptyCanvas();
});

setColors(DEFAULT_COLORS);
showEmptyCanvas();
document.fonts.ready.then(() => { if (!currentFlower) showEmptyCanvas(); });

// ---- growing a flower ----
form.addEventListener("submit", event => {
  event.preventDefault();
  const word = wordInput.value.trim();
  if (!word) {
    wordInput.focus();
    return;
  }

  if (drawing) drawing.cancel();
  currentFlower = {
    word,
    colors: readColors(),
    seed: Math.floor(Math.random() * 2 ** 31),   // decides where the hearts go
  };
  saveButton.disabled = true;
  downloadButton.disabled = true;
  toast.textContent = "";
  caption.textContent = "growing…";

  const thisDrawing = drawFlower(canvas, currentFlower, { animate: true });
  drawing = thisDrawing;
  thisDrawing.done.then(() => {
    if (drawing !== thisDrawing) return;      // a newer flower started
    caption.textContent = `“${word}”, grown ${formatDate(new Date())}`;
    saveButton.disabled = false;
    downloadButton.disabled = false;
  });
});

// ---- saving ----
saveButton.addEventListener("click", () => {
  try {
    Journal.addToGallery(user, {
      ...currentFlower,
      id: Date.now().toString(36),
      created: new Date().toISOString(),
    });
    saveButton.disabled = true;
    toast.innerHTML = 'Saved to your gallery ✿ <a href="gallery/index.html">have a look</a>';
  } catch (error) {
    toast.textContent = error.message;
  }
});

downloadButton.addEventListener("click", () => downloadCanvas(canvas, currentFlower.word));
