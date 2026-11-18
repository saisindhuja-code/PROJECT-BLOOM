// gallery.js — shows every flower this person has saved

const user = requireUser("../");
setupHeader(user, "../");

const specimens = document.getElementById("specimens");
const empty = document.getElementById("empty");
const count = document.getElementById("count");

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function render() {
  if (!user) return;
  const flowers = Journal.gallery(user);
  specimens.innerHTML = "";
  empty.hidden = flowers.length > 0;
  count.textContent = flowers.length === 1 ? "1 flower" : flowers.length ? `${flowers.length} flowers` : "";

  // newest first
  flowers.slice().reverse().forEach((flower, index) => {
    const number = flowers.length - index;

    const card = document.createElement("article");
    card.className = "specimen";

    // small copy of the flower, redrawn from its saved word, colors and seed
    const canvas = document.createElement("canvas");
    sizeCanvas(canvas, 450, 300);
    drawFlower(canvas, flower);

    const word = document.createElement("h2");
    word.className = "specimen-word";
    word.textContent = flower.word;

    const meta = document.createElement("p");
    meta.className = "specimen-meta";
    meta.textContent = `No. ${number} · saved ${formatDate(flower.created)}`;

    const actions = document.createElement("div");
    actions.className = "specimen-actions";
    actions.append(
      makeButton("Download PNG", "link-button", () => {
        const fullSize = document.createElement("canvas");
        fullSize.width = FLOWER_WIDTH * 2;
        fullSize.height = FLOWER_HEIGHT * 2;
        drawFlower(fullSize, flower);
        downloadCanvas(fullSize, flower.word);
      }),
      makeButton("Remove", "link-button muted", () => {
        if (confirm(`Remove “${flower.word}” from your gallery?`)) {
          Journal.removeFromGallery(user, flower.id);
          render();
        }
      })
    );

    card.append(canvas, word, meta, actions);
    specimens.append(card);
  });
}

render();
