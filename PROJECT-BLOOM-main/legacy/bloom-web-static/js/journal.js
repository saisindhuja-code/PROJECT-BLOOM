// =====================================================================
// journal.js — sign up / sign in and the gallery.
//
// IMPORTANT: GitHub Pages only hosts files; it has no server or database.
// So accounts and saved flowers are kept in the browser's localStorage.
// They stay on that one browser/computer and are not shared online.
// Passwords are never stored as plain text: we store a SHA-256 hash.
// =====================================================================

const KEYS = {
  users: "bloom.users",
  session: "bloom.session",
  gallery: user => `bloom.gallery.${user.key}`,
};

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("This browser won't let BLOOM save anything. Private/incognito windows often block saving.");
  }
}

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error("This browser can't protect passwords here. Please use Chrome, Edge or Firefox.");
  }
  const data = new TextEncoder().encode(salt + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

const Journal = {
  async signUp(name, password) {
    name = name.trim();
    if (!/^[A-Za-z0-9 _.-]{3,20}$/.test(name)) {
      throw new Error("Pick a name of 3–20 letters or numbers.");
    }
    if (password.length < 6) {
      throw new Error("Your password needs at least 6 characters.");
    }
    const users = readJSON(KEYS.users, {});
    const key = name.toLowerCase();
    if (users[key]) {
      throw new Error("That name already has a journal here. Try signing in.");
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    users[key] = {
      name,
      salt,
      hash: await hashPassword(password, salt),
      joined: new Date().toISOString(),
    };
    writeJSON(KEYS.users, users);
    localStorage.setItem(KEYS.session, key);
  },

  async signIn(name, password) {
    const users = readJSON(KEYS.users, {});
    const user = users[name.trim().toLowerCase()];
    if (!user || (await hashPassword(password, user.salt)) !== user.hash) {
      throw new Error("That name and password don't match.");
    }
    localStorage.setItem(KEYS.session, name.trim().toLowerCase());
  },

  signOut() {
    localStorage.removeItem(KEYS.session);
  },

  currentUser() {
    const key = localStorage.getItem(KEYS.session);
    const users = readJSON(KEYS.users, {});
    return key && users[key] ? { key, name: users[key].name } : null;
  },

  gallery(user) {
    const list = readJSON(KEYS.gallery(user), []);
    return Array.isArray(list) ? list.filter(item => item && typeof item.word === "string") : [];
  },

  addToGallery(user, flower) {
    const list = this.gallery(user);
    list.push(flower);
    writeJSON(KEYS.gallery(user), list);
  },

  removeFromGallery(user, id) {
    writeJSON(KEYS.gallery(user), this.gallery(user).filter(item => item.id !== id));
  },
};

// Pages that need a signed-in person call this. rootPath is "" for pages in
// the main folder and "../" for pages inside the gallery folder.
function requireUser(rootPath) {
  const user = Journal.currentUser();
  if (!user) window.location.replace(rootPath + "index.html");
  return user;
}

function setupHeader(user, rootPath) {
  if (!user) return;
  document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = user.name);
  document.querySelectorAll("[data-sign-out]").forEach(button => {
    button.addEventListener("click", () => {
      Journal.signOut();
      window.location.href = rootPath + "index.html";
    });
  });
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
