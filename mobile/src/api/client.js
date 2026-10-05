import { API_BASE_URL } from "./config";
import { authStorage } from "./authStorage";

let onUnauthorizedCallback = null;

export function setOnUnauthorizedHandler(callback) {
  onUnauthorizedCallback = callback;
}

const REQUEST_TIMEOUT_MS = 15000;
// AI generation calls (writing story ideas, full story text, narration) can
// legitimately take much longer than a normal API round-trip, especially
// with Gemini's built-in retry/fallback backoff on a busy model. Using the
// same 15s timeout for these made a perfectly healthy, still-working
// request look like a dead connection. Endpoints that call an AI model use
// this longer budget instead.
const AI_REQUEST_TIMEOUT_MS = 60000;
// The admin "generate story from idea" call does several AI steps back to
// back in one request - grounded web research, writing the full story text,
// a safety check, AND synthesizing the voice narration - all before
// returning, since that flow always publishes fully audio-ready. That's
// meaningfully slower than a single AI call, so it gets extra budget.
const AI_HEAVY_REQUEST_TIMEOUT_MS = 90000;

async function request(endpoint, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = await authStorage.getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // Without this, a request that connects but never gets a response (e.g. a
  // firewall silently dropping the connection) hangs forever with no error -
  // the UI just spins. This forces it to fail after timeoutMs so the
  // catch block below can surface a real error instead.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      let errorMsg = `Server error (${res.status})`;
      try {
        const errJson = await res.json();
        errorMsg = errJson.detail || errorMsg;
      } catch (e) {
        // non-json response
      }

      if (res.status === 401 && !endpoint.includes("/api/auth/login")) {
        if (typeof onUnauthorizedCallback === "function") {
          onUnauthorizedCallback(errorMsg);
        }
      }

      throw new Error(errorMsg);
    }
    // 204 No Content
    if (res.status === 204) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(
        `Cannot reach backend at ${API_BASE_URL} (request timed out). Check that the server is running and reachable from this device (e.g. a firewall blocking the connection).`
      );
    }
    if (
      err.message.includes("Network request failed") ||
      err.message.includes("Failed to fetch") ||
      err.message.includes("NetworkError")
    ) {
      throw new Error(
        `Cannot connect to backend at ${API_BASE_URL}. Ensure FastAPI server is running.`
      );
    }
    throw err;
  }
}

export const api = {
  // Lookups
  getAgeGroups: () => request("/api/lookups/age-groups"),
  getCategories: (ageGroupId) =>
    request(`/api/lookups/categories${ageGroupId ? `?age_group_id=${ageGroupId}` : ""}`),
  getLanguages: () => request("/api/lookups/languages"),

  // In-app announcements (the Home screen bell) - public, plan-aware
  getAnnouncements: () => request("/api/announcements"),
  getNarratorVoices: () => request("/api/lookups/narrator-voices"),
  getVoicePreview: (voiceId, accentId = "us") =>
    request(`/api/lookups/narrator-voices/${voiceId}/preview?accent_id=${accentId}`),
  // English accent/locale choices (US, UK, Indian, Australian) available for
  // every narrator voice - same Google TTS voices, different locale.
  getAccents: () => request("/api/lookups/accents"),

  // Tab 1: Listen to Story (Pre-created from DB)
  getPrecreatedStories: (categoryId, ageGroupId, languageId = 1, sortBy = "popular") =>
    request(
      `/api/stories/precreated?age_group_id=${ageGroupId}&language_id=${languageId}${
        categoryId ? `&category_id=${categoryId}` : ""
      }&sort_by=${sortBy}`
    ),

  // Rate a story (1-5 stars)
  rateStory: (storyTextId, rating, deviceId = null) =>
    request(`/api/stories/${storyTextId}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating, device_id: deviceId }),
    }),

  browseStories: (categoryId, ageGroupId, languageId = 1, targetCount = 20) =>
    request("/api/stories/browse", {
      method: "POST",
      body: JSON.stringify({
        category_id: categoryId,
        age_group_id: ageGroupId,
        language_id: languageId,
        target_count: targetCount,
      }),
    }),

  // Tab 2: Generate New Story (AI custom with Narrator Picker & 10/mo quota)
  generateCustomStory: (prompt, ageGroupId, categoryId = null, voiceId = "luna", languageId = 1, accentId = "us") =>
    request(
      "/api/stories/generate-custom",
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          age_group_id: ageGroupId,
          category_id: categoryId,
          voice_id: voiceId,
          language_id: languageId,
          accent_id: accentId,
        }),
      },
      AI_REQUEST_TIMEOUT_MS
    ),

  // Multimodal Story Generation (Text, Book Photo, or PDF/File)
  convertToStory: async (formData) => {
    const url = `${API_BASE_URL}/api/stories/convert-to-story`;
    const token = await authStorage.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });
      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const errJson = await res.json();
          errorMsg = errJson.detail || errJson.message || errorMsg;
        } catch (e) {}
        throw new Error(typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg));
      }
      return await res.json();
    } catch (err) {
      const msg = err?.message || err?.detail || (typeof err === "string" ? err : JSON.stringify(err));
      throw new Error(msg);
    }
  },

  // Commit / Play Precreated Story (renders narration on a cache miss - can
  // take a while, so it gets the longer AI timeout budget too)
  commitStory: (storyTextId, voiceTier = "standard", voiceId = "luna", accentId = "us") =>
    request(
      `/api/stories/${storyTextId}/commit`,
      {
        method: "POST",
        body: JSON.stringify({ voice_tier: voiceTier, voice_id: voiceId, accent_id: accentId }),
      },
      AI_REQUEST_TIMEOUT_MS
    ),

  // Open & DB Search (categoryId is admin-only: which category to publish a
  // newly AI-generated story into when nothing matches in the DB)
  searchStories: (query, ageGroupId, languageId = 1, allowAiGenerate = false, categoryId = null) =>
    request(
      "/api/stories/search",
      {
        method: "POST",
        body: JSON.stringify({
          query,
          age_group_id: ageGroupId,
          language_id: languageId,
          allow_ai_generate: allowAiGenerate,
          category_id: categoryId,
        }),
      },
      allowAiGenerate ? AI_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    ),

  // Admin's ONLY story-creation call: admin types/pastes the full story text
  // directly, picks a category, narrator voice + accent, and optionally a
  // cover picture - zero Gemini calls, just Google TTS narration + DB save
  // (+ image upload), so it works even when Gemini is rate-limited or down.
  // Fully ready (text + audio + cover) before this call returns. Takes a
  // FormData built by the caller (multipart, since a cover image may ride
  // along) - see LibraryScreen's buildManualPublishFormData helper.
  publishManualStory: async (formData) => {
    const url = `${API_BASE_URL}/api/stories/publish-manual`;
    const token = await authStorage.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });
      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const errJson = await res.json();
          errorMsg = errJson.detail || errJson.message || errorMsg;
        } catch (e) {}
        throw new Error(typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg));
      }
      return await res.json();
    } catch (err) {
      const msg = err?.message || err?.detail || (typeof err === "string" ? err : JSON.stringify(err));
      throw new Error(msg);
    }
  },

  // Admin "Edit Story": full editable detail for an already-published
  // story (title, text, cover image, and its current narrator voice +
  // accent), used to pre-fill the edit screen.
  getStoryAdminDetail: (storyTextId) => request(`/api/stories/${storyTextId}/admin-detail`),

  // Admin "Edit Story": save changes to title/text/cover image. Category
  // and voice/accent stay fixed. Multipart since a new cover image may
  // ride along - same shape as publishManualStory.
  editStory: async (storyTextId, formData) => {
    const url = `${API_BASE_URL}/api/stories/${storyTextId}/edit`;
    const token = await authStorage.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });
      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const errJson = await res.json();
          errorMsg = errJson.detail || errJson.message || errorMsg;
        } catch (e) {}
        throw new Error(typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg));
      }
      return await res.json();
    } catch (err) {
      const msg = err?.message || err?.detail || (typeof err === "string" ? err : JSON.stringify(err));
      throw new Error(msg);
    }
  },

  // Admin "Delete Story": permanent hard delete - removes the story and
  // everything derived from it (audio, cover image, ratings, personalized
  // copies, history entries). Cannot be undone.
  deleteStory: (storyTextId) =>
    request(`/api/stories/${storyTextId}`, { method: "DELETE" }),

  // Quota Usage (Normal: 3 stories/0 clones, Pro: 8 stories/4 clones)
  getStoryUsage: () => request("/api/stories/usage"),

  // History (server-side, per-account - survives cache clears/device changes)
  getHistory: (limit = 60) => request(`/api/history/?limit=${limit}`),
  getMyCreations: (limit = 60) => request(`/api/history/my-creations?limit=${limit}`),

  // Personalized Story Commit (weaves child's name into tale)
  personalizeStory: (storyTextId, childProfileId, voiceTier = "standard") =>
    request(
      `/api/stories/${storyTextId}/personalize`,
      {
        method: "POST",
        body: JSON.stringify({
          child_profile_id: childProfileId,
          voice_tier: voiceTier,
        }),
      },
      AI_REQUEST_TIMEOUT_MS
    ),

  // Auth
  register: (data) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  login: (data) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  forgotPassword: (email) =>
    request("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (data) =>
    request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  changePassword: (data) =>
    request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getMe: () => request("/api/auth/me"),

  // Admin
  getAdminDashboard: () => request("/api/admin/dashboard"),
  getAdminMonthlyReport: (month) =>
    request(`/api/admin/monthly-report${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  // All categories with their current cover image_url (or null if never
  // generated yet) - powers the admin dashboard's "Category Images" section.
  getAdminCategories: () => request("/api/admin/categories"),
  // One-time (or re-run to replace) AI-generated cover picture for a category.
  generateCategoryImage: (categoryId) =>
    request(
      `/api/admin/categories/${categoryId}/generate-image`,
      { method: "POST" },
      AI_REQUEST_TIMEOUT_MS
    ),
  // Admin-only: add a brand-new category on the fly (e.g. from the "Generate
  // story" category picker, when nothing existing fits).
  createCategory: (name, description = "", iconUrl = null) =>
    request("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name, description, icon_url: iconUrl }),
    }),

  // Child Profiles
  getProfiles: () => request("/api/profiles/"),
  createProfile: (data) =>
    request("/api/profiles/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProfile: (id, data) =>
    request(`/api/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteProfile: (id) =>
    request(`/api/profiles/${id}`, {
      method: "DELETE",
    }),
  getProfileUsage: (id) => request(`/api/profiles/${id}/usage`),

  // Voice Clones
  getVoiceClones: () => request("/api/voice-clones/"),
  uploadVoiceClone: async (formData) => {
    const url = `${API_BASE_URL}/api/voice-clones/upload`;
    const token = await authStorage.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to upload voice sample");
    }
    return await res.json();
  },
  deleteVoiceClone: (id) =>
    request(`/api/voice-clones/${id}`, {
      method: "DELETE",
    }),
  narrateCloned: (storyTextId, childProfileId, voiceCloneId) =>
    request(
      "/api/voice-clones/narrate",
      {
        method: "POST",
        body: JSON.stringify({
          base_story_text_id: storyTextId,
          child_profile_id: childProfileId,
          voice_clone_id: voiceCloneId,
        }),
      },
      AI_REQUEST_TIMEOUT_MS
    ),

  // Subscriptions & Razorpay Payments (real Orders API + signature verification)
  getSubscriptionStatus: () => request("/api/subscriptions/status"),
  createSubscriptionOrder: (planId = "pro151_monthly") =>
    request("/api/subscriptions/create-order", {
      method: "POST",
      body: JSON.stringify({ plan_id: planId }),
    }),
  verifySubscriptionPayment: ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) =>
    request("/api/subscriptions/verify-payment", {
      method: "POST",
      body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature }),
    }),

  // Auto-renew (Razorpay Subscriptions): monthly mandate instead of a one-time order
  createAutopaySubscription: (planId = "pro151_monthly") =>
    request("/api/subscriptions/create-autopay", {
      method: "POST",
      body: JSON.stringify({ plan_id: planId }),
    }),
  verifyAutopay: ({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature }) =>
    request("/api/subscriptions/verify-autopay", {
      method: "POST",
      body: JSON.stringify({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature }),
    }),
  cancelAutopay: () => request("/api/subscriptions/cancel-autopay", { method: "POST" }),
};
