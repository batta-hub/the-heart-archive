const STORAGE_KEY = "heartArchive.v1";

const categories = [
  "All",
  "Nature",
  "City",
  "Food",
  "Sky",
  "Shadow",
  "Object",
  "Water",
  "Other",
];

let activeCategory = "All";

const app = document.querySelector("#main");

function loadStore() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { hearts: [], decisions: [] };

  try {
    const parsed = JSON.parse(raw);
    return cleanStore({
      hearts: Array.isArray(parsed.hearts) ? parsed.hearts : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    });
  } catch {
    return { hearts: [], decisions: [] };
  }
}

function saveStore(store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function resetStore() {
  saveStore({ hearts: [], decisions: [] });
}

function cleanStore(store) {
  const hearts = store.hearts.filter((heart) => {
    return heart.image?.type === "upload";
  });

  const decisions = store.decisions.filter((decision) => {
    return hearts.some((heart) => heart.title === decision.title);
  });

  const cleaned = { hearts, decisions };
  if (
    hearts.length !== store.hearts.length ||
    decisions.length !== store.decisions.length
  ) {
    saveStore(cleaned);
  }

  return cleaned;
}

function cloneTemplate(id) {
  const template = document.querySelector(`#${id}`);
  return template.content.cloneNode(true);
}

function getApprovedHearts() {
  return loadStore().hearts.filter((heart) => heart.status === "approved");
}

function getVisibleHearts() {
  const approved = getApprovedHearts();
  if (activeCategory === "All") return approved;
  return approved.filter((heart) => heart.category === activeCategory);
}

function findHeart(id) {
  return loadStore().hearts.find((heart) => heart.id === id);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function metaForHeart(heart) {
  const bits = [heart.category];
  if (heart.location && heart.visibility !== "Hidden") bits.push(heart.location);
  if (heart.submittedAt) bits.push(formatDate(heart.submittedAt));
  return bits.join(" · ");
}

function applyPhotoStyle(element, heart) {
  if (heart.image?.type === "upload") {
    element.classList.add("uploaded-photo");
    element.style.backgroundImage = `url("${heart.image.src}")`;
    element.style.backgroundPosition = "center";
    return;
  }

  element.classList.add("missing-photo");
}

function renderArchive() {
  app.replaceChildren(cloneTemplate("archive-template"));

  const grid = app.querySelector("[data-heart-grid]");
  const count = app.querySelector("[data-archive-count]");
  const empty = app.querySelector("[data-empty-archive]");
  const hearts = getVisibleHearts();

  app.querySelectorAll("[data-category]").forEach((button) => {
    const isActive = button.dataset.category === activeCategory;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderArchive();
    });
  });

  count.textContent = `${hearts.length} ${hearts.length === 1 ? "heart" : "hearts"}`;
  empty.classList.toggle("hidden", hearts.length > 0);

  hearts.forEach((heart) => {
    const card = document.createElement("article");
    card.className = "heart-card";

    const link = document.createElement("a");
    link.href = `#/heart/${heart.id}`;
    link.setAttribute("aria-label", `View ${heart.title}`);

    const photo =
      heart.image?.type === "upload" ? document.createElement("img") : document.createElement("span");
    photo.className = "heart-photo";
    if (heart.image?.type === "upload") {
      photo.src = heart.image.src;
      photo.alt = heart.title || "Submitted heart";
      photo.loading = "lazy";
    } else {
      applyPhotoStyle(photo, heart);
    }
    link.append(photo);

    const title = document.createElement("h3");
    title.textContent = heart.title || "Untitled heart";

    const meta = document.createElement("p");
    meta.className = "heart-meta";
    meta.textContent = metaForHeart(heart);

    card.append(link, title, meta);
    grid.append(card);
  });

  app.querySelector("[data-scroll-gallery]").addEventListener("click", () => {
    app.querySelector("#archive")?.scrollIntoView({ behavior: "smooth" });
  });
}

function renderDetail(id) {
  const heart = findHeart(id);
  if (!heart || heart.status !== "approved") {
    window.location.hash = "#/";
    return;
  }

  const approved = getApprovedHearts();
  const index = approved.findIndex((item) => item.id === id);
  const previous = approved[(index - 1 + approved.length) % approved.length];
  const next = approved[(index + 1) % approved.length];

  app.replaceChildren(cloneTemplate("detail-template"));
  const detail = app.querySelector("[data-detail-page]");

  const photo = document.createElement("div");
  photo.className = "detail-photo";
  photo.setAttribute("role", "img");
  photo.setAttribute("aria-label", heart.title);
  applyPhotoStyle(photo, heart);

  const panel = document.createElement("div");
  panel.className = "detail-panel";

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "Found heart";

  const title = document.createElement("h1");
  title.textContent = heart.title || "Untitled heart";

  const note = document.createElement("p");
  note.className = "detail-note";
  note.textContent = heart.note || "A small accidental heart, held in the archive.";

  const meta = document.createElement("p");
  meta.className = "detail-meta";
  meta.textContent = metaForHeart(heart);

  const nav = document.createElement("div");
  nav.className = "detail-nav";
  nav.innerHTML = `
    <a class="button secondary" href="#/heart/${previous.id}">Previous</a>
    <a class="button secondary" href="#/">Archive</a>
    <a class="button secondary" href="#/heart/${next.id}">Next</a>
  `;

  const report = document.createElement("button");
  report.className = "report-link";
  report.type = "button";
  report.textContent = "Report this heart";
  report.addEventListener("click", () => {
    report.textContent = "Report received";
    report.disabled = true;
  });

  panel.append(kicker, title, note, meta, nav, report);
  detail.append(photo, panel);
}

function renderSubmit() {
  app.replaceChildren(cloneTemplate("submit-template"));

  const form = app.querySelector("[data-submission-form]");
  const imageInput = form.elements.image;
  const preview = app.querySelector("[data-upload-preview]");
  const prompt = app.querySelector("[data-upload-prompt]");
  let imageData = "";

  imageInput.addEventListener("change", () => {
    const [file] = imageInput.files;
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      imageData = String(reader.result);
      preview.src = imageData;
      preview.classList.remove("hidden");
      prompt.classList.add("hidden");
    });
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!imageData) return;

    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const category = String(formData.get("category") || "Other");
    const note = String(formData.get("note") || "").trim();
    const location = String(formData.get("location") || "").trim();
    const visibility = String(formData.get("visibility") || "Hidden");

    const store = loadStore();
    store.hearts.unshift({
      id: `heart-${Date.now()}`,
      title: title || "Untitled heart",
      note,
      category,
      location,
      visibility,
      status: "pending",
      submittedAt: new Date().toISOString().slice(0, 10),
      image: { type: "upload", src: imageData },
    });
    saveStore(store);
    window.location.hash = "#/confirmation";
  });
}

function renderModeration() {
  app.replaceChildren(cloneTemplate("moderation-template"));

  const store = loadStore();
  const pending = store.hearts.filter((heart) => heart.status === "pending");
  const reviewList = app.querySelector("[data-review-list]");
  const decisionList = app.querySelector("[data-decision-list]");
  const emptyReview = app.querySelector("[data-empty-review]");
  const emptyDecisions = app.querySelector("[data-empty-decisions]");

  emptyReview.classList.toggle("hidden", pending.length > 0);
  emptyDecisions.classList.toggle("hidden", store.decisions.length > 0);

  pending.forEach((heart) => {
    const card = document.createElement("article");
    card.className = "review-card";

    const thumb = document.createElement("div");
    thumb.className = "review-thumb";
    applyPhotoStyle(thumb, heart);

    const body = document.createElement("div");
    body.className = "review-body";

    const title = document.createElement("h3");
    title.textContent = heart.title || "Untitled heart";

    const meta = document.createElement("p");
    meta.className = "heart-meta";
    meta.textContent = metaForHeart(heart);

    const note = document.createElement("p");
    note.className = "heart-meta";
    note.textContent = heart.note || "No note provided.";

    const actions = document.createElement("div");
    actions.className = "review-actions";

    const approve = document.createElement("button");
    approve.className = "button primary";
    approve.type = "button";
    approve.textContent = "Approve";
    approve.addEventListener("click", () => decideOnHeart(heart.id, "approved"));

    const reject = document.createElement("button");
    reject.className = "button destructive";
    reject.type = "button";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => decideOnHeart(heart.id, "rejected"));

    actions.append(approve, reject);
    body.append(title, meta, note, actions);
    card.append(thumb, body);
    reviewList.append(card);
  });

  store.decisions.slice(0, 6).forEach((decision) => {
    const card = document.createElement("article");
    card.className = "decision-card";
    card.innerHTML = `
      <h3>${escapeHtml(decision.title)}</h3>
      <p class="decision-meta">${escapeHtml(decision.status)} · ${escapeHtml(
        formatDate(decision.date),
      )}</p>
    `;
    decisionList.append(card);
  });

  app.querySelector("[data-reset-demo]").addEventListener("click", () => {
    resetStore();
    renderModeration();
  });
}

function decideOnHeart(id, status) {
  const store = loadStore();
  const heart = store.hearts.find((item) => item.id === id);
  if (!heart) return;

  heart.status = status;
  store.decisions.unshift({
    id: `decision-${Date.now()}`,
    title: heart.title || "Untitled heart",
    status: status === "approved" ? "Approved" : "Rejected",
    date: new Date().toISOString().slice(0, 10),
  });
  saveStore(store);
  renderModeration();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function renderAbout() {
  app.replaceChildren(cloneTemplate("about-template"));
}

function renderConfirmation() {
  app.replaceChildren(cloneTemplate("confirmation-template"));
}

function route() {
  const hash = window.location.hash || "#/";
  const [, path = "", id = ""] = hash.match(/^#\/?([^/]*)(?:\/(.+))?/) || [];
  window.scrollTo({ top: 0 });

  if (path === "submit") {
    renderSubmit();
  } else if (path === "confirmation") {
    renderConfirmation();
  } else if (path === "about") {
    renderAbout();
  } else if (path === "moderation") {
    renderModeration();
  } else if (path === "heart") {
    renderDetail(id);
  } else {
    renderArchive();
  }
}

window.addEventListener("hashchange", route);

if (!window.localStorage.getItem(STORAGE_KEY)) {
  resetStore();
}

route();
