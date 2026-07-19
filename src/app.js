const SUPABASE_URL = "https://syufjyazsarkkvbebpsb.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_64eQGFVOxzFEn-Ezgj_lQQ_rpMfLZu1";
const HEART_PHOTOS_BUCKET = "heart-photos";
const CONVERT_HEART_ENDPOINT = `${SUPABASE_URL}/functions/v1/convert-heart`;
const AUTH_EMAIL_REDIRECT_URL = "https://batta-hub.github.io/the-heart-archive/";
const AUTH_STORAGE_KEY = "heartArchive.session.v1";

let approvedHeartsCache = [];
let currentSession = readStoredSession();
let currentProfile = null;

const app = document.querySelector("#main");

function cloneTemplate(id) {
  const template = document.querySelector(`#${id}`);
  return template.content.cloneNode(true);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
    ...extra,
  };
}

function authenticatedHeaders(extra = {}) {
  if (!currentSession?.access_token) {
    throw new Error("Please sign in first.");
  }

  return {
    apikey: SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${currentSession.access_token}`,
    ...extra,
  };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: supabaseHeaders(options.headers),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message || "Supabase request failed.");
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  return JSON.parse(text);
}

async function authenticatedRequest(path, options = {}) {
  await ensureSession();

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: authenticatedHeaders(options.headers),
  });

  return parseSupabaseResponse(response, "Supabase request failed.");
}

async function authRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return parseSupabaseResponse(response, "Authentication request failed.");
}

async function parseSupabaseResponse(response, fallbackMessage) {
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.msg || payload.message || payload.error_description || payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message || fallbackMessage);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  return JSON.parse(text);
}

function readStoredSession() {
  try {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  currentSession = session;
  currentProfile = null;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  currentSession = null;
  currentProfile = null;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function hasUsableSession() {
  return Boolean(currentSession?.access_token);
}

async function ensureSession() {
  if (!hasUsableSession()) return null;

  const expiresAt = Number(currentSession.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);

  if (currentSession.refresh_token && expiresAt && expiresAt - now < 120) {
    try {
      const refreshed = await authRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: currentSession.refresh_token }),
      });
      if (refreshed?.access_token) saveSession(refreshed);
    } catch (error) {
      console.error(error);
      clearSession();
      return null;
    }
  }

  return currentSession;
}

async function fetchCurrentProfile() {
  await ensureSession();
  if (!currentSession?.user?.id) return null;
  if (currentProfile) return currentProfile;

  const query = new URLSearchParams({
    select: "id,email,role",
    id: `eq.${currentSession.user.id}`,
    limit: "1",
  });

  const rows = await authenticatedRequest(`/rest/v1/profiles?${query}`);
  currentProfile = rows?.[0] || null;
  return currentProfile;
}

function isStaffProfile(profile) {
  return profile?.role === "admin" || profile?.role === "moderator";
}

async function signOut() {
  if (hasUsableSession()) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: authenticatedHeaders(),
      });
    } catch (error) {
      console.error(error);
    }
  }

  clearSession();
  await syncNavigation();
}

async function syncNavigation() {
  const reviewLinks = document.querySelectorAll("[data-review-link]");
  const accountLinks = document.querySelectorAll("[data-account-link]");
  const session = await ensureSession();
  let profile = null;

  if (session) {
    try {
      profile = await fetchCurrentProfile();
    } catch (error) {
      console.error(error);
    }
  }

  const isStaff = isStaffProfile(profile);

  reviewLinks.forEach((link) => {
    link.classList.toggle("hidden", !isStaff);
  });

  accountLinks.forEach((link) => {
    const isHeaderLink = link.dataset.accountSurface === "header";
    link.classList.toggle("hidden", isHeaderLink && isStaff);
    link.textContent = session ? "Sign out" : "Sign in";
    link.href = session ? "#/" : "#/auth/submit";
    link.dataset.accountState = session ? "signed-in" : "signed-out";
  });
}

function setupAccountLinks() {
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      if (link.dataset.accountState !== "signed-in") return;
      event.preventDefault();
      await signOut();
      window.location.hash = "#/";
    });
  });
}

async function fetchApprovedHearts() {
  const query = new URLSearchParams({
    select:
      "id,title,note,category_id,image_original_path,image_display_path,image_thumbnail_path,location_label,location_visibility,status,submitted_at,conversion_status",
    status: "eq.approved",
    order: "submitted_at.desc",
  });

  const rows = await supabaseRequest(`/rest/v1/hearts?${query}`);
  approvedHeartsCache = rows.map(mapHeartRow);
  return approvedHeartsCache;
}

async function fetchHeartById(id) {
  const query = new URLSearchParams({
    select:
      "id,title,note,category_id,image_original_path,image_display_path,image_thumbnail_path,location_label,location_visibility,status,submitted_at,conversion_status",
    id: `eq.${id}`,
    status: "eq.approved",
    limit: "1",
  });

  const rows = await supabaseRequest(`/rest/v1/hearts?${query}`);
  return rows[0] ? mapHeartRow(rows[0]) : null;
}

async function fetchPendingHearts() {
  const query = new URLSearchParams({
    select:
      "id,title,note,image_original_path,image_display_path,image_thumbnail_path,location_label,location_visibility,status,submitted_at,conversion_status,conversion_error",
    status: "eq.pending",
    order: "submitted_at.desc",
  });

  const rows = await authenticatedRequest(`/rest/v1/hearts?${query}`);
  return rows.map(mapHeartRow);
}

async function fetchRecentDecisions() {
  const query = new URLSearchParams({
    select:
      "id,title,note,image_original_path,image_display_path,image_thumbnail_path,location_label,location_visibility,status,submitted_at,reviewed_at,conversion_status",
    status: "in.(approved,rejected)",
    order: "reviewed_at.desc.nullslast",
    limit: "8",
  });

  const rows = await authenticatedRequest(`/rest/v1/hearts?${query}`);
  return rows.map((row) => ({
    ...mapHeartRow(row),
    reviewedAt: row.reviewed_at ? row.reviewed_at.slice(0, 10) : "",
  }));
}

async function fetchDashboardSummary() {
  const rows = await authenticatedRequest(
    "/rest/v1/hearts?select=id,status,conversion_status",
  );

  const summary = rows.reduce(
    (counts, row) => {
      counts.total += 1;
      counts[row.status] = (counts[row.status] || 0) + 1;
      if (row.conversion_status === "pending" || row.conversion_status === "processing") {
        counts.preparing += 1;
      }
      if (row.conversion_status === "failed") counts.needsAttention += 1;
      return counts;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      archived: 0,
      preparing: 0,
      needsAttention: 0,
    },
  );

  return summary;
}

async function updateHeartStatus(id, status) {
  const body = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: currentProfile?.id || currentSession?.user?.id || null,
    rejection_reason: status === "approved" ? null : "Not a fit for the archive.",
  };

  const query = new URLSearchParams({ id: `eq.${id}` });

  await authenticatedRequest(`/rest/v1/hearts?${query}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

function mapHeartRow(row) {
  const imagePath = displayableImagePath(row);

  return {
    id: row.id,
    title: row.title || "Untitled heart",
    note: row.note || "",
    location: row.location_label || "",
    visibility: titleCase(row.location_visibility || "hidden"),
    status: row.status,
    conversionStatus: row.conversion_status || "not_needed",
    submittedAt: row.submitted_at ? row.submitted_at.slice(0, 10) : "",
    image: {
      type: imagePath
        ? "remote"
        : row.conversion_status === "pending" || row.conversion_status === "processing"
          ? "preparing"
          : "missing",
      src: imagePath ? publicPhotoUrl(imagePath) : "",
    },
  };
}

function displayableImagePath(row) {
  const preferredPath = row.image_thumbnail_path || row.image_display_path;
  if (preferredPath) return preferredPath;

  const originalPath = row.image_original_path || "";
  const extension = originalPath.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension)) {
    return originalPath;
  }

  return "";
}

function titleCase(value) {
  const normalized = String(value).toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function publicPhotoUrl(path) {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:")) return path;

  return `${SUPABASE_URL}/storage/v1/object/public/${HEART_PHOTOS_BUCKET}/${encodePath(path)}`;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function metaForHeart(heart) {
  const bits = [];
  if (heart.location && heart.visibility !== "Hidden") bits.push(heart.location);
  if (heart.submittedAt) bits.push(formatDate(heart.submittedAt));
  return bits.join(" · ");
}

function applyPhotoStyle(element, heart) {
  if (heart.image?.src) {
    element.classList.add("uploaded-photo");
    element.style.backgroundImage = `url("${heart.image.src}")`;
    element.style.backgroundPosition = "center";
    return;
  }

  element.classList.add("image-placeholder");
  if (heart.image?.type === "preparing") {
    element.classList.add("preparing-photo");
    element.textContent = "Image preparing";
    return;
  }

  element.classList.add("missing-photo");
  element.textContent = "Image unavailable";
}

async function renderArchive() {
  app.replaceChildren(cloneTemplate("archive-template"));

  const grid = app.querySelector("[data-heart-grid]");
  const featuredGrid = app.querySelector("[data-featured-grid]");
  const featuredEmpty = app.querySelector("[data-featured-empty]");
  const count = app.querySelector("[data-archive-count]");
  const empty = app.querySelector("[data-empty-archive]");

  count.textContent = "Loading archive...";

  app.querySelectorAll("[data-scroll-gallery]").forEach((button) => {
    button.addEventListener("click", () => {
      app.querySelector("#archive")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  try {
    const hearts = await fetchApprovedHearts();
    const featuredHearts = hearts.slice(0, 8);
    const stripHearts =
      featuredHearts.length > 1 ? [...featuredHearts, ...featuredHearts] : featuredHearts;

    count.textContent = `${hearts.length} ${hearts.length === 1 ? "heart" : "hearts"}`;
    empty.classList.toggle("hidden", hearts.length > 0);
    featuredEmpty.classList.toggle("hidden", featuredHearts.length > 0);
    featuredEmpty.toggleAttribute("hidden", featuredHearts.length > 0);
    featuredGrid.classList.toggle("preview-grid-static", featuredHearts.length <= 1);
    featuredGrid.replaceChildren(
      ...stripHearts.map((heart, index) =>
        createHeartCard(
          heart,
          index >= featuredHearts.length ? "featured duplicate" : "featured",
        ),
      ),
    );
    grid.replaceChildren(...hearts.map(createHeartCard));
  } catch (error) {
    count.textContent = "Archive unavailable";
    empty.classList.remove("hidden");
    featuredEmpty.classList.remove("hidden");
    featuredEmpty.removeAttribute("hidden");
    empty.querySelector("p").textContent =
      "The archive could not load from Supabase right now.";
    console.error(error);
  }
}

function createHeartCard(heart, variant = "") {
  const card = document.createElement("article");
  card.className = "heart-card";
  const variants = String(variant || "").split(" ").filter(Boolean);
  variants.forEach((item) => card.classList.add(`heart-card-${item}`));

  const link = document.createElement("a");
  link.href = `#/heart/${heart.id}`;
  link.setAttribute("aria-label", `View ${heart.title}`);

  if (variants.includes("duplicate")) {
    card.setAttribute("aria-hidden", "true");
    link.tabIndex = -1;
  }

  if (heart.image?.src) {
    const photo = document.createElement("img");
    photo.className = "heart-photo";
    photo.src = heart.image.src;
    photo.alt = heart.title || "Shared heart";
    photo.loading = "lazy";
    link.append(photo);
  } else {
    const photo = document.createElement("span");
    photo.className = "heart-photo";
    applyPhotoStyle(photo, heart);
    link.append(photo);
  }

  const title = document.createElement("h3");
  title.textContent = heart.title || "Untitled heart";

  const meta = document.createElement("p");
  meta.className = "heart-meta";
  meta.textContent =
    variants.includes("featured") ? locationForFeaturedHeart(heart) : metaForHeart(heart);

  card.append(link, title, meta);
  return card;
}

function locationForFeaturedHeart(heart) {
  if (heart.location && heart.visibility !== "Hidden") return heart.location;
  return "Somewhere";
}

async function renderDetail(id) {
  let heart = approvedHeartsCache.find((item) => item.id === id);
  if (!heart) heart = await fetchHeartById(id);

  if (!heart || heart.status !== "approved") {
    window.location.hash = "#/";
    return;
  }

  if (!approvedHeartsCache.length) await fetchApprovedHearts();

  const approved = approvedHeartsCache;
  const index = approved.findIndex((item) => item.id === id);
  const previous = approved[(index - 1 + approved.length) % approved.length] || heart;
  const next = approved[(index + 1) % approved.length] || heart;

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

async function renderSubmit() {
  const session = await ensureSession();
  if (!session) {
    window.location.hash = "#/auth/submit";
    return;
  }

  app.replaceChildren(cloneTemplate("submit-template"));

  const form = app.querySelector("[data-submission-form]");
  const imageInput = form.elements.image;
  const preview = app.querySelector("[data-upload-preview]");
  const prompt = app.querySelector("[data-upload-prompt]");
  const status = app.querySelector("[data-form-status]");
  const locationStep = app.querySelector("[data-location-step]");
  const storyStep = app.querySelector("[data-story-step]");
  const submitStep = app.querySelector("[data-submit-step]");
  const locationInput = form.elements.location;
  const titleInput = form.elements.title;
  const noteInput = form.elements.note;
  const submitButton = form.querySelector('button[type="submit"]');
  let selectedFile = null;

  function syncShareProgress() {
    const hasPhoto = Boolean(selectedFile);
    const hasLocation = hasPhoto && Boolean(locationInput.value.trim());
    const hasTitle = hasLocation && Boolean(titleInput.value.trim());

    locationStep.hidden = !hasPhoto;
    storyStep.hidden = !hasLocation;
    submitStep.hidden = !hasTitle;
    locationInput.disabled = !hasPhoto;
    titleInput.disabled = !hasLocation;
    noteInput.disabled = !hasLocation;
    submitButton.disabled = !hasTitle;
  }

  syncShareProgress();

  imageInput.addEventListener("change", () => {
    const [file] = imageInput.files;
    if (!file) return;

    selectedFile = file;
    status.textContent = "";
    const isHeic = isLikelyHeic(file);

    if (isHeic) {
      preview.removeAttribute("src");
      preview.classList.add("hidden");
      prompt.classList.remove("hidden");
      prompt.innerHTML = `
        <span class="upload-heart" aria-hidden="true">&#9829;</span>
        <strong>Your iPhone photo is selected</strong>
        <small>${escapeHtml(file.name)}</small>
      `;
      status.textContent =
        "A preview is not available here, but your photo can still be shared.";
      syncShareProgress();
      return;
    }

    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    prompt.classList.add("hidden");
    syncShareProgress();
  });

  locationInput.addEventListener("input", syncShareProgress);
  titleInput.addEventListener("input", syncShareProgress);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedFile) return;

    const formData = new FormData(form);
    const location = String(formData.get("location") || "").trim();
    const title = String(formData.get("title") || "").trim();

    if (!location) {
      status.textContent = "Tell us where this heart found you.";
      form.elements.location?.focus();
      return;
    }

    if (!title) {
      status.textContent = "Give your heart a title.";
      form.elements.title?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Adding your heart...";
    status.textContent = "Making a place for your heart in the archive.";

    try {
      await submitHeartToConverter(formData, selectedFile);
      status.textContent = "Your heart is safely with us.";
      window.location.hash = "#/confirmation";
    } catch (error) {
      console.error(error);
      status.textContent = error.message
        ? `We couldn't share this one just yet: ${error.message}`
        : "We couldn't share this one just yet. Please try again in a moment.";
      submitButton.disabled = false;
      submitButton.innerHTML =
        '<span class="button-icon" aria-hidden="true">♥</span> Add to the Archive';
    }
  });
}

async function submitHeartToConverter(formData, file) {
  const payload = new FormData();
  payload.append("image", file);
  payload.append("title", String(formData.get("title") || "").trim());
  payload.append("note", String(formData.get("note") || ""));
  payload.append("location", String(formData.get("location") || "").trim());
  payload.append("visibility", "public");

  const response = await fetch(CONVERT_HEART_ENDPOINT, {
    method: "POST",
    headers: authenticatedHeaders(),
    body: payload,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message || "Heart sharing failed.");
  }

  return response.json();
}

function isLikelyHeic(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    extension === "heic" ||
    extension === "heif"
  );
}

function renderAuth(nextPath = "submit") {
  app.replaceChildren(cloneTemplate("auth-template"));

  const form = app.querySelector("[data-auth-form]");
  const status = app.querySelector("[data-auth-status]");
  const submitButton = form.querySelector('button[type="submit"]');
  const passwordInput = form.elements.password;
  const modeButtons = app.querySelectorAll("[data-auth-mode]");
  let mode = "signin";

  function setMode(nextMode) {
    mode = nextMode;
    modeButtons.forEach((button) => {
      const isActive = button.dataset.authMode === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    passwordInput.autocomplete =
      mode === "signin" ? "current-password" : "new-password";
    submitButton.textContent = mode === "signin" ? "Sign in" : "Create account";
    status.textContent = "";
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.authMode));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    submitButton.disabled = true;
    status.textContent =
      mode === "signin" ? "Signing you in..." : "Creating your account...";

    try {
      const payload =
        mode === "signin"
          ? await authRequest("/auth/v1/token?grant_type=password", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            })
          : await authRequest(
              `/auth/v1/signup?redirect_to=${encodeURIComponent(AUTH_EMAIL_REDIRECT_URL)}`,
              {
                method: "POST",
                body: JSON.stringify({ email, password }),
              },
            );

      if (payload?.access_token) {
        saveSession(payload);
        await fetchCurrentProfile();
        await syncNavigation();
        window.location.hash = `#/${nextPath}`;
        return;
      }

      setMode("signin");
      status.textContent =
        "Account created. Check your email, then come back here to sign in.";
    } catch (error) {
      console.error(error);
      status.textContent = error.message || "Something went wrong. Please try again.";
    } finally {
      submitButton.disabled = false;
    }
  });

  setMode("signin");
}

async function renderModeration() {
  const session = await ensureSession();
  if (!session) {
    window.location.hash = "#/auth/moderation";
    return;
  }

  const profile = await fetchCurrentProfile();

  if (!isStaffProfile(profile)) {
    app.replaceChildren(cloneTemplate("access-denied-template"));
    app.querySelector("[data-denied-sign-out]")?.addEventListener("click", async () => {
      await signOut();
      window.location.hash = "#/";
    });
    return;
  }

  app.replaceChildren(cloneTemplate("moderation-template"));

  const reviewList = app.querySelector("[data-review-list]");
  const decisionList = app.querySelector("[data-decision-list]");
  const spotlight = app.querySelector("[data-spotlight-heart]");
  const stats = app.querySelector("[data-dashboard-stats]");
  const staffLabel = app.querySelector("[data-staff-label]");
  const spotlightCount = app.querySelector("[data-spotlight-count]");
  const queueCount = app.querySelector("[data-queue-count]");
  const liveStamp = app.querySelector("[data-live-stamp]");
  const emptyReview = app.querySelector("[data-empty-review]");
  const emptyDecisions = app.querySelector("[data-empty-decisions]");
  const signOutButton = app.querySelector("[data-sign-out]");

  staffLabel.textContent = `Signed in as ${titleCase(profile.role)}`;
  liveStamp.textContent = `Checked ${formatTime(new Date())}`;

  signOutButton.addEventListener("click", async () => {
    await signOut();
    window.location.hash = "#/";
  });

  spotlight.textContent = "Loading next heart...";
  reviewList.textContent = "Loading queue...";
  decisionList.textContent = "Loading decisions...";
  stats.textContent = "Loading archive status...";

  try {
    const [summary, pending, decisions] = await Promise.all([
      fetchDashboardSummary(),
      fetchPendingHearts(),
      fetchRecentDecisions(),
    ]);

    renderDashboardStats(stats, summary);
    renderReviewStudio({
      spotlight,
      reviewList,
      emptyReview,
      spotlightCount,
      queueCount,
      pending,
    });
    decisionList.replaceChildren(...decisions.map(createDecisionCard));
    emptyDecisions.classList.toggle("hidden", decisions.length > 0);
  } catch (error) {
    console.error(error);
    stats.textContent = "";
    spotlight.textContent = "The review queue could not load right now.";
    reviewList.textContent = "";
    decisionList.textContent = "";
    emptyReview.classList.add("hidden");
    emptyDecisions.classList.add("hidden");
  }
}

function renderReviewStudio({
  spotlight,
  reviewList,
  emptyReview,
  spotlightCount,
  queueCount,
  pending,
}) {
  const nextHeart = pending.find((heart) => queueGroupForHeart(heart) === "ready") || pending[0];
  const queuedHearts = nextHeart
    ? pending.filter((heart) => heart.id !== nextHeart.id)
    : [];
  const waitingLabel = `${pending.length} ${pending.length === 1 ? "heart" : "hearts"} waiting`;

  spotlightCount.textContent = waitingLabel;
  queueCount.textContent = queuedHearts.length ? `${queuedHearts.length} more` : "No backlog";

  if (!nextHeart) {
    spotlight.replaceChildren();
    reviewList.replaceChildren();
    emptyReview.classList.remove("hidden");
    return;
  }

  emptyReview.classList.add("hidden");
  spotlight.replaceChildren(createSpotlightCard(nextHeart));
  if (!queuedHearts.length) {
    const emptyQueue = document.createElement("p");
    emptyQueue.className = "queue-empty";
    emptyQueue.textContent = "No other hearts are waiting behind this one.";
    reviewList.replaceChildren(emptyQueue);
    return;
  }

  renderQueueGroups(reviewList, queuedHearts);
}

function renderDashboardStats(container, summary) {
  const cards = [
    ["◌", "Waiting", summary.pending, "Need your review"],
    ["♥", "Live", summary.approved, "In the public archive"],
    ["↻", "Preparing", summary.preparing, "Images converting"],
    ["∑", "Total", summary.total, "Shared hearts"],
  ];

  container.replaceChildren(
    ...cards.map(([icon, label, value, detail]) => {
      const card = document.createElement("article");
      card.className = "dashboard-stat";

      const symbol = document.createElement("span");
      symbol.className = "dashboard-stat-icon";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = icon;

      const number = document.createElement("strong");
      number.textContent = value;

      const title = document.createElement("span");
      title.textContent = label;

      const note = document.createElement("p");
      note.textContent = detail;

      card.append(symbol, number, title, note);
      return card;
    }),
  );
}

function renderQueueGroups(container, hearts) {
  const groups = [
    ["ready", "✓", "Ready", hearts.filter((heart) => queueGroupForHeart(heart) === "ready")],
    [
      "preparing",
      "↻",
      "Preparing",
      hearts.filter((heart) => queueGroupForHeart(heart) === "preparing"),
    ],
    [
      "needs-help",
      "!",
      "Needs help",
      hearts.filter((heart) => queueGroupForHeart(heart) === "needs-help"),
    ],
  ].filter(([, , , items]) => items.length > 0);

  container.replaceChildren(...groups.map(([key, icon, label, items]) => {
    const group = document.createElement("section");
    group.className = `queue-group queue-group-${key}`;

    const heading = document.createElement("div");
    heading.className = "queue-group-heading";
    heading.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${label}</strong><em>${items.length}</em>`;

    const list = document.createElement("div");
    list.className = "queue-group-list";
    list.replaceChildren(...items.map((heart) => createReviewCard(heart, "compact")));

    group.append(heading, list);
    return group;
  }));
}

function queueGroupForHeart(heart) {
  if (heart.conversionStatus === "pending" || heart.conversionStatus === "processing") {
    return "preparing";
  }
  if (heart.conversionStatus === "failed" || heart.image?.type === "missing") {
    return "needs-help";
  }
  return "ready";
}

function createSpotlightCard(heart) {
  const card = document.createElement("article");
  card.className = "spotlight-card";

  const thumb = document.createElement("div");
  thumb.className = "spotlight-photo";
  applyPhotoStyle(thumb, heart);

  const body = document.createElement("div");
  body.className = "spotlight-body";

  const eyebrow = document.createElement("p");
  eyebrow.className = "spotlight-eyebrow";
  eyebrow.textContent = "Submitted heart";

  const title = document.createElement("h3");
  title.textContent = heart.title || "Untitled heart";

  const meta = document.createElement("p");
  meta.className = "decision-meta";
  meta.textContent = metaForHeart(heart) || "Location hidden";

  const badge = document.createElement("span");
  badge.className = `status-badge status-${heart.conversionStatus}`;
  badge.textContent = conversionLabel(heart.conversionStatus);

  const checks = document.createElement("div");
  checks.className = "review-checks";
  checks.innerHTML = `
    <span><b aria-hidden="true">♡</b> Shape</span>
    <span><b aria-hidden="true">⌖</b> Found</span>
    <span><b aria-hidden="true">✓</b> Safe</span>
  `;

  const note = document.createElement("p");
  note.className = "spotlight-note";
  note.textContent = heart.note || "No note added.";

  const actions = document.createElement("div");
  actions.className = "review-actions";

  const approve = document.createElement("button");
  approve.className = "button primary";
  approve.type = "button";
  approve.innerHTML = '<span class="button-icon" aria-hidden="true">✓</span> Add to Archive';
  approve.addEventListener("click", () => handleReviewDecision(heart.id, "approved"));

  const reject = document.createElement("button");
  reject.className = "button destructive";
  reject.type = "button";
  reject.innerHTML = '<span class="button-icon" aria-hidden="true">×</span> Not This One';
  reject.addEventListener("click", () => handleReviewDecision(heart.id, "rejected"));

  actions.append(approve, reject);
  body.append(eyebrow, title, meta, badge, checks, note, actions);
  card.append(thumb, body);
  return card;
}

function createReviewCard(heart, variant = "") {
  const card = document.createElement("article");
  card.className = "review-card";
  if (variant) card.classList.add(`review-card-${variant}`);

  const thumb = document.createElement("div");
  thumb.className = "review-thumb";
  applyPhotoStyle(thumb, heart);

  const body = document.createElement("div");
  body.className = "review-body";

  const title = document.createElement("h3");
  title.textContent = heart.title || "Untitled heart";

  const meta = document.createElement("p");
  meta.className = "decision-meta";
  meta.textContent = metaForHeart(heart) || "Location hidden";

  const badge = document.createElement("span");
  badge.className = `status-badge status-${heart.conversionStatus}`;
  badge.textContent = conversionLabel(heart.conversionStatus);

  const actions = document.createElement("div");
  actions.className = "review-actions";

  const approve = document.createElement("button");
  approve.className = "icon-button approve";
  approve.type = "button";
  approve.textContent = "✓";
  approve.title = "Add to Archive";
  approve.setAttribute("aria-label", `Add ${heart.title || "this heart"} to the archive`);
  approve.addEventListener("click", () => handleReviewDecision(heart.id, "approved"));

  const reject = document.createElement("button");
  reject.className = "icon-button reject";
  reject.type = "button";
  reject.textContent = "×";
  reject.title = "Not this one";
  reject.setAttribute("aria-label", `Pass on ${heart.title || "this heart"}`);
  reject.addEventListener("click", () => handleReviewDecision(heart.id, "rejected"));

  actions.append(approve, reject);
  body.append(title, meta, badge, actions);
  card.append(thumb, body);
  return card;
}

function createDecisionCard(heart) {
  const card = document.createElement("article");
  card.className = "decision-card";

  const title = document.createElement("h3");
  title.textContent = heart.title || "Untitled heart";

  const symbol = document.createElement("span");
  symbol.className = `decision-symbol decision-${heart.status}`;
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = heart.status === "approved" ? "✓" : "×";

  const meta = document.createElement("p");
  meta.className = "decision-meta";
  meta.textContent = `${titleCase(heart.status)} · ${metaForHeart(heart) || "Location hidden"}`;

  card.append(symbol, title, meta);
  return card;
}

function conversionLabel(status) {
  if (status === "pending" || status === "processing") return "Image preparing";
  if (status === "ready") return "Image ready";
  if (status === "failed") return "Needs image help";
  return "Ready to review";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

async function handleReviewDecision(id, status) {
  try {
    await updateHeartStatus(id, status);
    await renderModeration();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "This decision could not be saved.");
  }
}

function renderAbout() {
  app.replaceChildren(cloneTemplate("about-template"));
}

function renderConfirmation() {
  app.replaceChildren(cloneTemplate("confirmation-template"));
}

async function route() {
  await syncNavigation();

  const hash = window.location.hash || "#/";
  const [, path = "", id = ""] = hash.match(/^#\/?([^/]*)(?:\/(.+))?/) || [];
  window.scrollTo({ top: 0 });

  try {
    if (path === "submit") {
      await renderSubmit();
    } else if (path === "auth") {
      renderAuth(id || "submit");
    } else if (path === "confirmation") {
      renderConfirmation();
    } else if (path === "about") {
      renderAbout();
    } else if (path === "moderation") {
      renderModeration();
    } else if (path === "heart") {
      await renderDetail(id);
    } else {
      await renderArchive();
    }
  } catch (error) {
    console.error(error);
    app.replaceChildren(cloneTemplate("archive-template"));
    app.querySelector("[data-archive-count]").textContent = "Archive unavailable";
    app.querySelector("[data-empty-archive]").classList.remove("hidden");
  }
}

function normalizeSharedEntryRoute() {
  if (/^#\/?auth(?:\/|$)/.test(window.location.hash || "")) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#/`,
    );
  }
}

window.addEventListener("hashchange", () => {
  route();
});

setupAccountLinks();
normalizeSharedEntryRoute();
route();
