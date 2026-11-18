// auth.js — the sign in / start a journal page

// Already signed in? Go straight to the studio.
if (Journal.currentUser()) window.location.replace("studio.html");

const forms = {
  signin: document.getElementById("signin-form"),
  signup: document.getElementById("signup-form"),
};
const message = document.getElementById("message");

// Switching between the two tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(other => {
      const active = other === tab;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-selected", active);
    });
    forms.signin.hidden = tab.dataset.tab !== "signin";
    forms.signup.hidden = tab.dataset.tab !== "signup";
    message.textContent = "";
  });
});

forms.signin.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(forms.signin);
  try {
    await Journal.signIn(data.get("name"), data.get("password"));
    window.location.href = "studio.html";
  } catch (error) {
    message.textContent = error.message;
  }
});

forms.signup.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(forms.signup);
  if (data.get("password") !== data.get("confirm")) {
    message.textContent = "The two passwords don't match.";
    return;
  }
  try {
    await Journal.signUp(data.get("name"), data.get("password"));
    window.location.href = "studio.html";
  } catch (error) {
    message.textContent = error.message;
  }
});
