import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  TextInput,
  Platform,
  Alert,
  Modal,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import SafeAudio from "../utils/safeAudio";
import StoryLoadingOverlay from "../components/StoryLoadingOverlay";
import LanguagePicker, { LANGUAGES, languageByCode, openStoryInView } from "../components/LanguagePicker";

// How long to wait after the parent stops typing before we hit the DB.
// Kept short so search still feels instant.
const SEARCH_DEBOUNCE_MS = 300;

// Home remounts every time the tab is clicked. Keep the last feed in memory so
// it shows instantly, then refresh quietly in the background.
const FEED_CACHE = {};
const FEED_FRESH_MS = 8000;
export function clearFeedCache() {
  Object.keys(FEED_CACHE).forEach((k) => delete FEED_CACHE[k]);
}
function feedKey(ageId, filter, lang) {
  return `${ageId}|${filter}|${lang}`;
}

function notifyError(message) {
  if (Platform.OS === "web") {
    window.alert(message);
  } else {
    Alert.alert("Oops", message);
  }
}

function notifyInfo(title, message) {
  if (Platform.OS === "web") {
    window.alert(message);
  } else {
    Alert.alert(title, message);
  }
}

// Helper to convert a picked image's URI to a Blob on Web for FormData.
async function uriToBlob(uri) {
  const response = await fetch(uri);
  return await response.blob();
}

// A story is tagged NEW when it was published within this many days.
const NEW_DAYS = 14;
const BG = "#05060c";

// Placeholder look for stories that have no cover picture yet: a coloured
// card with an emoji picked from the story's title.
const EMOJI_RULES = [
  [/rabbit|hare|bunny/i, "🐰"],
  [/tortoise|turtle/i, "🐢"],
  [/fox/i, "🦊"],
  [/owl/i, "🦉"],
  [/elephant/i, "🐘"],
  [/bear/i, "🐻"],
  [/lion/i, "🦁"],
  [/tiger/i, "🐯"],
  [/monkey/i, "🐵"],
  [/sheep|lamb/i, "🐑"],
  [/cat|kitten/i, "🐱"],
  [/dog|puppy/i, "🐶"],
  [/mouse|mice/i, "🐭"],
  [/frog/i, "🐸"],
  [/duck/i, "🦆"],
  [/bird|crow|parrot|sparrow/i, "🐦"],
  [/fish|whale|dolphin|ocean|sea/i, "🐠"],
  [/mermaid/i, "🧜"],
  [/dragon/i, "🐉"],
  [/unicorn/i, "🦄"],
  [/fairy/i, "🧚"],
  [/castle|kingdom|king|queen|prince|princess/i, "🏰"],
  [/wizard|magic|wand/i, "🪄"],
  [/rocket|space|astronaut/i, "🚀"],
  [/alien/i, "👽"],
  [/planet/i, "🪐"],
  [/star/i, "⭐"],
  [/moon|night|sleep|dream|lullaby|goodnight/i, "🌙"],
  [/sun/i, "☀️"],
  [/rain|cloud/i, "☁️"],
  [/forest|tree|woods/i, "🌳"],
  [/flower|garden/i, "🌸"],
  [/pirate|ship|treasure/i, "🏴‍☠️"],
  [/train/i, "🚂"],
  [/boat/i, "⛵"],
  [/snow|winter/i, "❄️"],
];
const GRADIENT_COLORS = [
  "#3a8f4d", "#5b3aa8", "#1f5fa8", "#c24d1a", "#a8265b", "#157a6a", "#2a2f6b",
];

function emojiFor(title) {
  const t = String(title || "");
  const found = [];
  for (const [re, em] of EMOJI_RULES) {
    if (re.test(t)) found.push(em);
    if (found.length === 2) break;
  }
  return found.length ? found.join("") : "🌙";
}

function colorFor(title) {
  let h = 0;
  const t = String(title || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 9973;
  return GRADIENT_COLORS[h % GRADIENT_COLORS.length];
}

function isNewStory(story) {
  if (!story?.created_at) return false;
  const t = Date.parse(story.created_at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

// One story card: real cover picture if there is one, otherwise the
// emoji placeholder. A broken picture link falls back to the placeholder.
function StoryCard({ story, width, height, onPress, busy, showNew, isAdmin, onEdit, onDelete, deleting }) {
  const [broken, setBroken] = useState(false);
  const hasCover =
    !broken && typeof story.cover_image_url === "string" && story.cover_image_url.startsWith("http");
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.card, { width, height }]}>
      {hasCover ? (
        <Image
          source={{ uri: story.cover_image_url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colorFor(story.title) }]}>
          <View style={styles.placeholderShade} />
          <Text style={[styles.placeholderEmoji, { fontSize: typeof width === "string" || width > 150 ? 76 : 44 }]}>
            {emojiFor(story.title)}
          </Text>
        </View>
      )}
      <View style={styles.titleShade1} pointerEvents="none" />
      <View style={styles.titleShade2} pointerEvents="none" />
      <Text style={styles.cardTitle} numberOfLines={3}>
        {story.title}
      </Text>
      {Array.isArray(story.language_codes) && story.language_codes.length > 1 ? (
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeText}>{story.language_codes.map((c) => c.toUpperCase()).join(" · ")}</Text>
        </View>
      ) : null}
      {Number(story.total_ratings) > 0 && Number(story.average_rating) > 0 ? (
        <View style={[styles.ratingBadge, { top: showNew ? 30 : 7 }]}>
          <Text style={styles.ratingBadgeText}>⭐ {Number(story.average_rating).toFixed(1)}</Text>
        </View>
      ) : null}
      {showNew ? (
        <View style={styles.newBadge}>
          <Text style={styles.newBadgeText}>NEW</Text>
        </View>
      ) : null}
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {isAdmin ? (
        <View style={styles.feedAdminBtns}>
          <TouchableOpacity style={styles.feedAdminBtn} disabled={deleting} onPress={onEdit}>
            <Text style={styles.feedAdminBtnText}>✎</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.feedAdminBtn, styles.feedAdminBtnDel]} disabled={deleting} onPress={onDelete}>
            {deleting ? <ActivityIndicator size="small" color="#ff8a8a" /> : <Text style={styles.feedAdminBtnText}>🗑</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function HomeFeedScreen({
  activeProfile,
  onPlayStory,
  onGoToHome,
  currentUser,
  onOpenCategory,
  browseLanguage = "en",
  onBrowseLanguageChange,
}) {
  const isAdmin = !!currentUser?.is_admin;

  const initialCache = FEED_CACHE[feedKey(activeProfile?.age_group_id || 1, "popular", browseLanguage)];
  const [stories, setStories] = useState(initialCache ? initialCache.stories : []);
  const [feedRows, setFeedRows] = useState(initialCache ? initialCache.rows : []); // [{ category, stories }] shown as Netflix-style rows
  const heroRef = useRef(null);
  const [loading, setLoading] = useState(!initialCache);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("popular"); // popular, newest, favorites
  const [dbResults, setDbResults] = useState(null); // null = not searched, [] = searched & empty
  const [searching, setSearching] = useState(false);
  const [narratingId, setNarratingId] = useState(null); // story currently being committed/narrated

  // Categories, shown as a "browse by category" grid below the search results.
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Narrator voices (Luna/Oliver/Willow/Jasper) and English accents
  // (US/UK/India/Australia) available for the admin's "Create New Story"
  // publish flow - same Google TTS voices, the accent just picks the locale.
  const [narratorVoices, setNarratorVoices] = useState([]);
  const [accents, setAccents] = useState([]);

  // Admin-only: create a brand-new Library story from scratch, via a
  // standalone "+ Create New Story" button (no longer tied to search).
  // modalStep: "category" (pick where to publish, or add a new one) ->
  // "write" (title, full text, cover picture, narrator voice + accent).
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [modalStep, setModalStep] = useState("category");
  const [generateCategoryId, setGenerateCategoryId] = useState(null);

  const [manualTitle, setManualTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("luna");
  const [selectedAccentId, setSelectedAccentId] = useState("us");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [extraLanguages, setExtraLanguages] = useState([]); // extra language versions to publish
  const [editLanguages, setEditLanguages] = useState([]); // codes this story already has
  const [editAddLanguages, setEditAddLanguages] = useState([]); // codes to add on save
  const [editTab, setEditTab] = useState(null); // language code whose text is shown in the edit box
  const [editTrans, setEditTrans] = useState({}); // code -> { title, text, dirty } for non-original versions
  const [editTabLoading, setEditTabLoading] = useState(false);
  const [langProgress, setLangProgress] = useState("");
  const [coverImage, setCoverImage] = useState(null); // { uri, name, type } | null
  const [publishingManual, setPublishingManual] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState(null);

  // Admin-only: add a brand-new category inline, right from the picker, when
  // nothing existing fits the story being published.
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Admin-only: edit an already-published story's text/cover, or hard-delete
  // it entirely. Voice/accent and category are intentionally not editable
  // (kept as-is from when the story was first published).
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editCoverImage, setEditCoverImage] = useState(null); // newly picked { uri, ... } | null
  const [editCoverImageUrl, setEditCoverImageUrl] = useState(null); // existing url to preview
  const [editRemoveCover, setEditRemoveCover] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingStoryId, setDeletingStoryId] = useState(null);

  const searchTimerRef = useRef(null);
  const searchTokenRef = useRef(0); // guards against a stale response overwriting a newer one

  useEffect(() => {
    loadStories();
  }, [activeFilter, activeProfile, browseLanguage]);

  useEffect(() => {
    // Deliberately unfiltered - every active category should be browsable,
    // regardless of which categories happen to be curated for this
    // profile's specific age group in the category_age_groups table. Age
    // filtering already happens at the story level once you're inside a
    // category, so nothing inappropriate leaks through.
    loadCategories();

    if (isAdmin) {
      api
        .getNarratorVoices()
        .then((data) => setNarratorVoices(data || []))
        .catch((e) => console.warn("Failed to load narrator voices", e));
      api
        .getAccents()
        .then((data) => setAccents(data || []))
        .catch((e) => console.warn("Failed to load accents", e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Browse by Category" grid data - the real categories plus a synthetic
  // "Others" tile whenever at least one currently-loaded story isn't tagged
  // with a real, currently-existing category, so nothing uncategorized
  // silently disappears from Library. Derived straight from the stories
  // and categories already loaded for the flat list below - no extra
  // network round trip, so it can never silently go stale if that fails.
  const knownCategoryIds = new Set(categories.map((c) => c.id));
  const hasUncategorized = stories.some((s) => !s.category_id || !knownCategoryIds.has(s.category_id));
  const displayCategories = hasUncategorized
    ? [...categories, { id: "others", name: "Others", icon_url: "📦" }]
    : categories;

  async function loadCategories() {
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      const data = await api.getCategories();
      setCategories(data || []);
    } catch (e) {
      console.warn("Failed to load categories", e);
      setCategoriesError(e.message || "Couldn't load categories.");
    } finally {
      setCategoriesLoading(false);
    }
  }

  async function loadStories(force = false) {
    const ageId = activeProfile?.age_group_id || 1;
    const key = feedKey(ageId, activeFilter, browseLanguage);
    const cached = FEED_CACHE[key];
    if (cached) {
      setCategories(cached.cats);
      setFeedRows(cached.rows);
      setStories(cached.stories);
      setLoading(false);
      if (!force && Date.now() - cached.at < FEED_FRESH_MS) return;
    } else {
      setLoading(true);
    }
    try {
      const cats = (await api.getCategories()) || [];
      // Category lists and the "Others" list load together (one round trip, not two)
      const [catLists, others] = await Promise.all([
        Promise.all(
          cats.map((c) =>
            api
              .getPrecreatedStories(c.id, ageId, 1, activeFilter, browseLanguage)
              .then((d) => d || [])
              .catch(() => [])
          )
        ),
        api
          .getPrecreatedStories("others", ageId, 1, activeFilter, browseLanguage)
          .then((d) => d || [])
          .catch(() => []),
      ]);
      const rows = cats.map((c, i) => ({ category: c, stories: catLists[i] }));
      if (others.length > 0) {
        rows.push({ category: { id: "others", name: "Others", icon_url: "📦" }, stories: others });
      }
      // A story is shown only once on screen: drop repeats across rows
      // (same id, or the same title published twice, counts as a repeat)
      const seenIds = new Set();
      const seenTitles = new Set();
      rows.forEach((r) => {
        r.stories = r.stories.filter((st) => {
          const titleKey = String(st.title || "").trim().toLowerCase().replace(/\s+/g, " ");
          if (seenIds.has(st.id)) return false;
          if (titleKey && seenTitles.has(titleKey)) return false;
          seenIds.add(st.id);
          if (titleKey) seenTitles.add(titleKey);
          return true;
        });
      });
      const nonEmpty = rows.filter((r) => r.stories.length > 0);
      const flat = nonEmpty.flatMap((r) => r.stories);
      FEED_CACHE[key] = { at: Date.now(), cats, rows: nonEmpty, stories: flat };
      setCategories(cats);
      setFeedRows(nonEmpty);
      setStories(flat);
    } catch (e) {
      console.warn("Failed to load library", e);
    } finally {
      setLoading(false);
    }
  }

  const localMatches = searchQuery
    ? stories.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.teaser && s.teaser.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : stories;

  // If the parent is searching and nothing in the already-loaded list matches,
  // fall back to a real DB search so a story outside the top-50 cache is
  // still found (debounced so we don't fire a request on every keystroke).
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const q = searchQuery.trim();
    if (!q) {
      setDbResults(null);
      setSearching(false);
      return;
    }

    if (localMatches.length > 0) {
      // Already have a match in the cached list - no need to hit the DB.
      setDbResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const myToken = ++searchTokenRef.current;
    searchTimerRef.current = setTimeout(async () => {
      try {
        const ageId = activeProfile?.age_group_id || 1;
        const results = await api.searchStories(q, ageId, 1, false, null, browseLanguage);
        if (searchTokenRef.current === myToken) {
          setDbResults(results || []);
        }
      } catch (e) {
        console.warn("DB search failed", e);
        if (searchTokenRef.current === myToken) {
          setDbResults([]);
        }
      } finally {
        if (searchTokenRef.current === myToken) {
          setSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, stories]);

  const displayedStoriesRaw =
    searchQuery && localMatches.length === 0 && dbResults !== null
      ? dbResults
      : localMatches;
  const displayedStories = displayedStoriesRaw.filter(
    (st, i, arr) => arr.findIndex((x) => x.id === st.id) === i
  );

  // A story fetched from the browse/search list only carries a title + teaser
  // until it's actually narrated. Tapping it must go through /commit so the
  // full text + audio get generated (or the cached audio is returned in
  // ~0.1s) - otherwise the player has no narration to play and only the
  // ambient background track is heard.
  async function handleSelectStory(story) {
    if (narratingId) return; // already narrating one, ignore extra taps
    setNarratingId(story.id);
    try {
      onPlayStory(await openStoryInView(api, story));
    } catch (e) {
      notifyError(e.message || "Couldn't load this story's narration. Please try again.");
    } finally {
      setNarratingId(null);
    }
  }

  function openCreateModal() {
    setModalStep("category");
    setShowGenerateModal(true);
  }

  function closeGenerateModal() {
    setShowGenerateModal(false);
    setModalStep("category");
    setGenerateCategoryId(null);
    setShowNewCategoryForm(false);
    setNewCategoryName("");
    setManualTitle("");
    setManualText("");
    setSelectedVoiceId("luna");
    setSelectedAccentId("us");
    setSelectedLanguage("en");
    setExtraLanguages([]);
    setCoverImage(null);
  }

  async function handlePickCoverImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notifyError("Photos permission is required to pick a cover picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCoverImage(result.assets[0]);
      }
    } catch (e) {
      notifyError("Failed to pick image: " + e.message);
    }
  }

  // Lets the admin hear exactly what a narrator voice + accent combination
  // sounds like (e.g. Luna in Indian English) before publishing with it.
  async function handlePreviewVoice(voice) {
    if (previewingVoiceId === voice.id) {
      if (Platform.OS === "web" && window.currentAudioPreview) {
        window.currentAudioPreview.pause();
        window.currentAudioPreview = null;
      } else {
        await SafeAudio.stopPreview().catch(() => {});
      }
      setPreviewingVoiceId(null);
      return;
    }
    setPreviewingVoiceId(voice.id);
    try {
      const res = await api.getVoicePreview(voice.id, selectedAccentId);
      if (res && res.preview_url) {
        if (Platform.OS === "web") {
          if (window.currentAudioPreview) window.currentAudioPreview.pause();
          const audio = new Audio(res.preview_url);
          window.currentAudioPreview = audio;
          audio.onended = () => setPreviewingVoiceId(null);
          audio.play().catch(() => setPreviewingVoiceId(null));
        } else {
          await SafeAudio.playPreview(res.preview_url);
          setPreviewingVoiceId(null);
        }
      } else {
        setPreviewingVoiceId(null);
        notifyError("Couldn't load a preview for this voice right now.");
      }
    } catch (e) {
      setPreviewingVoiceId(null);
      notifyError("Couldn't load a preview for this voice right now.");
    }
  }

  // The one and only way admin content gets created: type/paste the story
  // text directly - zero Gemini calls, just Google TTS narration (in the
  // chosen voice + accent) and a DB save, plus an optional cover picture.
  async function handlePublishManual() {
    if (publishingManual) return;
    if (!generateCategoryId) {
      notifyError("Please choose a category first.");
      return;
    }
    if (!manualTitle.trim()) {
      notifyError("Please give the story a title.");
      return;
    }
    if (!manualText.trim() || manualText.trim().split(/\s+/).length < 20) {
      notifyError("Please enter the full story text (at least a few sentences).");
      return;
    }
    setPublishingManual(true);
    try {
      const ageId = activeProfile?.age_group_id || 1;

      const formData = new FormData();
      formData.append("title", manualTitle.trim());
      formData.append("full_text", manualText.trim());
      formData.append("category_id", generateCategoryId);
      formData.append("age_group_id", String(ageId));
      formData.append("language_id", "1");
      formData.append("language_code", selectedLanguage);
      formData.append("voice_id", selectedVoiceId || "luna");
      formData.append("accent_id", selectedAccentId || "us");

      if (coverImage) {
        const uri = coverImage.uri;
        const uriParts = uri.split(".");
        const fileType = (uriParts[uriParts.length - 1] || "jpg").toLowerCase();
        const fileName = `story_cover.${fileType}`;
        const mimeType = `image/${fileType === "jpg" ? "jpeg" : fileType}`;

        if (Platform.OS === "web") {
          if (coverImage.file) {
            formData.append("cover_image", coverImage.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("cover_image", blob, fileName);
          }
        } else {
          formData.append("cover_image", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      }

      const published = await api.publishManualStory(formData);
      setDbResults((prev) => [published, ...(prev || [])]);

      // Extra language versions: one request per language (translate + narrate),
      // so each call stays short and the admin sees progress.
      const langFailures = [];
      const wanted = extraLanguages.filter((c) => c !== selectedLanguage);
      for (let i = 0; i < wanted.length; i++) {
        const code = wanted[i];
        setLangProgress(`Adding ${languageByCode(code).label} (${i + 1}/${wanted.length})...`);
        try {
          const r = await api.addStoryLanguages(published.id, [code]);
          if (r && r.errors && r.errors.length) langFailures.push(...r.errors);
        } catch (e) {
          langFailures.push(`${languageByCode(code).label}: ${e.message}`);
        }
      }
      setLangProgress("");

      closeGenerateModal();
      clearFeedCache();
      loadStories(true);
      if (langFailures.length) {
        notifyError("Story published, but some languages failed:\n" + langFailures.join("\n"));
        return;
      }

      if (coverImage) {
        if (published.cover_image_upload_failed) {
          notifyInfo(
            "Story published",
            "The story was published and narrated, but the cover picture failed to upload. You can try adding it again by editing the story."
          );
        } else if (published.cover_image_url) {
          notifyInfo("Story published", "Story published with cover picture uploaded successfully!");
        } else {
          notifyInfo("Story published", "Story published!");
        }
      } else {
        notifyInfo("Story published", "Story published!");
      }
    } catch (e) {
      notifyError(e.message || "Couldn't publish that story. Please try again.");
    } finally {
      setPublishingManual(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      const created = await api.createCategory(name);
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setGenerateCategoryId(created.id);
      setShowNewCategoryForm(false);
      setNewCategoryName("");
    } catch (e) {
      notifyError(e.message || "Couldn't create that category. Please try again.");
    } finally {
      setCreatingCategory(false);
    }
  }

  // Admin-only: open the edit flow for an already-published story. The
  // library list cards only carry title/teaser, so we fetch the full detail
  // (full_text, cover, voice/accent) before showing the edit modal.
  async function handleOpenEdit(story) {
    setEditingStoryId(story.id);
    setEditTitle(story.title || "");
    setEditText("");
    setEditCoverImage(null);
    setEditCoverImageUrl(story.cover_image_url || null);
    setEditRemoveCover(false);
    setEditLanguages([]);
    setEditAddLanguages([]);
    setEditTab(null);
    setEditTrans({});
    setShowEditModal(true);
    setLoadingEdit(true);
    try {
      const detail = await api.getStoryAdminDetail(story.id);
      setEditTitle(detail.title || "");
      setEditText(detail.full_text || "");
      setEditCoverImageUrl(detail.cover_image_url || null);
      try {
        const lr = await api.getStoryLanguages(story.id);
        const codes = ((lr && lr.languages) || []).map((l) => l.code);
        setEditLanguages(codes);
        setEditTab(codes[0] || "en");
      } catch (e) {}
    } catch (e) {
      notifyError(e.message || "Couldn't load this story for editing. Please try again.");
      setShowEditModal(false);
    } finally {
      setLoadingEdit(false);
    }
  }

  function closeEditModal() {
    setShowEditModal(false);
    setEditingStoryId(null);
    setEditTitle("");
    setEditText("");
    setEditCoverImage(null);
    setEditCoverImageUrl(null);
    setEditRemoveCover(false);
    setEditLanguages([]);
    setEditAddLanguages([]);
    setEditTab(null);
    setEditTrans({});
  }

  const editOrigCode = editLanguages[0] || "en";
  const editIsOrig = !editTab || editTab === editOrigCode;

  async function loadEditTranslation(code, force = false) {
    if (!force && editTrans[code]) return;
    setEditTabLoading(true);
    try {
      const d = await api.getStoryLanguageText(editingStoryId, code);
      setEditTrans((prev) => ({ ...prev, [code]: { title: d.title || "", text: d.full_text || "", dirty: false } }));
    } catch (e) {
      notifyError(e.message || "Couldn't load that language version.");
    } finally {
      setEditTabLoading(false);
    }
  }

  function handleEditTab(code) {
    setEditTab(code);
    if (code !== editOrigCode) loadEditTranslation(code);
  }

  function setTransField(code, field, value) {
    setEditTrans((prev) => ({ ...prev, [code]: { ...(prev[code] || { title: "", text: "" }), [field]: value, dirty: true } }));
  }

  function handleRetranslate(code) {
    const label = languageByCode(code).label;
    const go = async () => {
      setEditTabLoading(true);
      try {
        const r = await api.addStoryLanguages(editingStoryId, [code], true);
        if (r && r.errors && r.errors.length) notifyError(r.errors.join("\n"));
        await loadEditTranslation(code, true);
        notifyInfo("Done", `${label} was translated again from the main text.`);
      } catch (e) {
        notifyError(e.message || "Re-translate failed.");
      } finally {
        setEditTabLoading(false);
      }
    };
    const msg = `This replaces the ${label} version (including any edits you made there) with a fresh translation of the main text, and re-records the audio (about ₹5).`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) go();
    } else {
      Alert.alert(`Re-translate ${label}?`, msg, [{ text: "Cancel", style: "cancel" }, { text: "Re-translate", onPress: go }]);
    }
  }

  async function handlePickEditCoverImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notifyError("Photos permission is required to pick a cover picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setEditCoverImage(result.assets[0]);
        setEditRemoveCover(false);
      }
    } catch (e) {
      notifyError("Failed to pick image: " + e.message);
    }
  }

  async function handleSaveEdit() {
    if (savingEdit || !editingStoryId) return;
    if (!editTitle.trim()) {
      notifyError("Please give the story a title.");
      return;
    }
    if (!editText.trim() || editText.trim().split(/\s+/).length < 20) {
      notifyError("Please enter the full story text (at least a few sentences).");
      return;
    }
    setSavingEdit(true);
    try {
      const formData = new FormData();
      formData.append("title", editTitle.trim());
      formData.append("full_text", editText.trim());
      if (editRemoveCover) {
        formData.append("remove_cover_image", "true");
      }

      if (editCoverImage) {
        const uri = editCoverImage.uri;
        const uriParts = uri.split(".");
        const fileType = (uriParts[uriParts.length - 1] || "jpg").toLowerCase();
        const fileName = `story_cover.${fileType}`;
        const mimeType = `image/${fileType === "jpg" ? "jpeg" : fileType}`;

        if (Platform.OS === "web") {
          if (editCoverImage.file) {
            formData.append("cover_image", editCoverImage.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("cover_image", blob, fileName);
          }
        } else {
          formData.append("cover_image", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      }

      const updated = await api.editStory(editingStoryId, formData);

      // Other-language versions are never touched by editing the main text;
      // only the ones edited on their own tab are saved (and re-narrated).
      const addFailures = [];
      const dirtyCodes = Object.keys(editTrans).filter((c) => editTrans[c] && editTrans[c].dirty);
      for (let i = 0; i < dirtyCodes.length; i++) {
        const c = dirtyCodes[i];
        setLangProgress(`Saving ${languageByCode(c).label}...`);
        try {
          const fd = new FormData();
          fd.append("language_code", c);
          fd.append("title", (editTrans[c].title || "").trim());
          fd.append("full_text", (editTrans[c].text || "").trim());
          await api.editStory(editingStoryId, fd);
        } catch (e) {
          addFailures.push(`${languageByCode(c).label}: ${e.message}`);
        }
      }
      const toAdd = editAddLanguages.slice();
      for (let i = 0; i < toAdd.length; i++) {
        setLangProgress(`Adding ${languageByCode(toAdd[i]).label} (${i + 1}/${toAdd.length})...`);
        try {
          const r = await api.addStoryLanguages(editingStoryId, [toAdd[i]]);
          if (r && r.errors && r.errors.length) addFailures.push(...r.errors);
        } catch (e) {
          addFailures.push(`${languageByCode(toAdd[i]).label}: ${e.message}`);
        }
      }
      setLangProgress("");

      const applyUpdate = (list) =>
        list ? list.map((s) => (s.id === editingStoryId ? { ...s, ...updated } : s)) : list;
      clearFeedCache();
      setStories((prev) => applyUpdate(prev));
      setFeedRows((prev) => prev.map((r) => ({ ...r, stories: applyUpdate(r.stories) })));
      setDbResults((prev) => applyUpdate(prev));

      closeEditModal();

      if (addFailures.length) {
        notifyError("Story saved, but some languages failed:\n" + addFailures.join("\n"));
        return;
      }

      if (editCoverImage) {
        if (updated.cover_image_upload_failed) {
          notifyInfo(
            "Story updated",
            "The story text was updated, but the new cover picture failed to upload. You can try again by editing the story."
          );
        } else {
          notifyInfo("Story updated", "Story updated with new cover picture!");
        }
      } else {
        notifyInfo("Story updated", "Story updated!");
      }
    } catch (e) {
      notifyError(e.message || "Couldn't save changes. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Admin-only: permanently delete a story from the DB and every related
  // table (audio, ratings, personalized copies, history) plus its storage
  // files. Cross-platform confirmation since window.confirm doesn't exist
  // on native and Alert.alert doesn't exist on web.
  function handleDeleteStory(story) {
    const doDelete = async () => {
      setDeletingStoryId(story.id);
      try {
        await api.deleteStory(story.id);
        const filterOut = (list) => (list ? list.filter((s) => s.id !== story.id) : list);
        clearFeedCache();
        setStories((prev) => filterOut(prev));
        setFeedRows((prev) => prev.map((r) => ({ ...r, stories: filterOut(r.stories) })).filter((r) => r.stories.length > 0));
        setDbResults((prev) => filterOut(prev));
        notifyInfo("Story deleted", "The story was permanently deleted.");
      } catch (e) {
        notifyError(e.message || "Couldn't delete this story. Please try again.");
      } finally {
        setDeletingStoryId(null);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Permanently delete "${story.title}"? This cannot be undone.`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        "Delete Story",
        `Permanently delete "${story.title}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ]
      );
    }
  }

  // Featured story at the top: a random one (prefers stories with a cover picture)
  const hero = useMemo(() => {
    const all = feedRows.flatMap((r) => r.stories.map((st) => ({ ...st, _cat: r.category.name })));
    if (all.length === 0) return null;
    const keep = heroRef.current && all.find((st) => st.id === heroRef.current);
    if (keep) return keep;
    const withCover = all.filter((st) => typeof st.cover_image_url === "string" && st.cover_image_url.startsWith("http"));
    const pool = withCover.length > 0 ? withCover : all;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    heroRef.current = pick.id;
    return pick;
  }, [feedRows]);

  // The featured story already has its big card, so it isn't repeated in its row
  const visibleRows = feedRows
    .map((r) => ({ ...r, stories: r.stories.filter((st) => !hero || st.id !== hero.id) }))
    .filter((r) => r.stories.length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search stories, themes..."
          placeholderTextColor="rgba(255,255,255,0.5)"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searching && <ActivityIndicator size="small" color="#f5a623" />}
      </View>

      {isAdmin && (
        <TouchableOpacity style={styles.createStoryBtn} onPress={openCreateModal}>
          <Text style={styles.createStoryBtnText}>+ Create New Story</Text>
        </TouchableOpacity>
      )}

      {onBrowseLanguageChange && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, zIndex: 20 }}>
          <LanguagePicker value={browseLanguage} onChange={onBrowseLanguageChange} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.listContent}>
        {!searchQuery && loading && feedRows.length === 0 && (
          <ActivityIndicator size="large" color="#f5a623" style={{ marginTop: 50 }} />
        )}

        {!searchQuery && !loading && feedRows.length === 0 && (
          <View style={{ alignItems: "center", marginTop: 40 }}>
            <Text style={styles.emptyText}>
              {browseLanguage !== "en"
                ? `No stories in ${languageByCode(browseLanguage).label} yet. Check back soon!`
                : "No stories yet for this age. Check back soon!"}
            </Text>
            <TouchableOpacity style={styles.chip} onPress={() => loadStories(true)}>
              <Text style={styles.chipText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!searchQuery && hero ? (
          <View style={styles.feedHeroWrap}>
            <StoryCard
              story={hero}
              width="100%"
              height={190}
              busy={narratingId === hero.id}
              showNew={isNewStory(hero)}
              onPress={() => handleSelectStory(hero)}
              isAdmin={isAdmin}
              onEdit={() => handleOpenEdit(hero)}
              onDelete={() => handleDeleteStory(hero)}
              deleting={deletingStoryId === hero.id}
            />
            <Text style={styles.feedHeroLabel} pointerEvents="none">
              Tonight's pick · {hero._cat}
            </Text>
          </View>
        ) : null}

        {!searchQuery &&
          visibleRows.map((row) => (
            <View key={row.category.id}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => onOpenCategory && onOpenCategory(row.category)}>
                <Text style={styles.feedRowTitle}>
                  {row.category.name} <Text style={styles.feedRowChevron}>›</Text>
                </Text>
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedRowScroll}>
                {row.stories.map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    width={112}
                    height={164}
                    busy={narratingId === story.id}
                    showNew={isNewStory(story)}
                    onPress={() => handleSelectStory(story)}
                    isAdmin={isAdmin}
                    onEdit={() => handleOpenEdit(story)}
                    onDelete={() => handleDeleteStory(story)}
                    deleting={deletingStoryId === story.id}
                  />
                ))}
              </ScrollView>
            </View>
          ))}

        {!searchQuery ? null : loading ? (
          <ActivityIndicator size="large" color="#f5a623" style={{marginTop: 50}} />
        ) : displayedStories.length === 0 ? (
          <View style={{ alignItems: "center" }}>
            <Text style={styles.emptyText}>
              {searching ? "Searching..." : "No stories found."}
            </Text>
          </View>
        ) : (
          displayedStories.map((story) => (
            <TouchableOpacity
              key={story.id}
              style={styles.storyCard}
              activeOpacity={0.8}
              disabled={narratingId === story.id}
              onPress={() => handleSelectStory(story)}
            >
              <View style={styles.storyThumb}>
                <Image
                  source={story.cover_image_url ? { uri: story.cover_image_url } : require("../../assets/images/moon.jpg")}
                  style={styles.thumbImg}
                />
              </View>
              <View style={styles.storyInfo}>
                <Text style={styles.storyTitle}>{story.title}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>⏱️ {story.duration_seconds ? Math.round(story.duration_seconds/60) : 5}m</Text>
                  <Text style={styles.metaText}>🎤 Default</Text>
                  <Text style={styles.metaText}>🌲 Ambient</Text>
                </View>
              </View>
              {narratingId === story.id && (
                <ActivityIndicator size="small" color="#f5a623" style={{marginLeft: 10}} />
              )}
              {isAdmin && (
                <View style={styles.adminCardActions}>
                  <TouchableOpacity
                    style={styles.adminIconBtn}
                    disabled={deletingStoryId === story.id}
                    onPress={(e) => {
                      e.stopPropagation && e.stopPropagation();
                      handleOpenEdit(story);
                    }}
                  >
                    <Text style={styles.adminIconBtnText}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.adminIconBtn, styles.adminIconBtnDelete]}
                    disabled={deletingStoryId === story.id}
                    onPress={(e) => {
                      e.stopPropagation && e.stopPropagation();
                      handleDeleteStory(story);
                    }}
                  >
                    {deletingStoryId === story.id ? (
                      <ActivityIndicator size="small" color="#ff8a8a" />
                    ) : (
                      <Text style={styles.adminIconBtnDeleteText}>🗑</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal
        visible={showGenerateModal}
        transparent
        animationType="fade"
        onRequestClose={closeGenerateModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {modalStep === "category" ? (
              <>
                <Text style={styles.modalTitle}>Create New Story</Text>
                <Text style={styles.modalSubtitle}>
                  Choose a category to publish this story into.
                </Text>
                <ScrollView style={styles.modalCategoryList}>
                  {categories.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.modalCategoryRow,
                        generateCategoryId === cat.id && styles.modalCategoryRowActive,
                      ]}
                      onPress={() => setGenerateCategoryId(cat.id)}
                    >
                      <Text style={styles.modalCategoryIcon}>
                        {(cat.icon_url && cat.icon_url.trim()) || "📖"}
                      </Text>
                      <Text
                        style={[
                          styles.modalCategoryText,
                          generateCategoryId === cat.id && styles.modalCategoryTextActive,
                        ]}
                      >
                        {cat.name}
                      </Text>
                      {generateCategoryId === cat.id && <Text style={styles.modalCategoryCheck}>✓</Text>}
                    </TouchableOpacity>
                  ))}

                  {showNewCategoryForm ? (
                    <View style={styles.newCategoryForm}>
                      <TextInput
                        style={styles.newCategoryInput}
                        placeholder="New category name..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={newCategoryName}
                        onChangeText={setNewCategoryName}
                        autoFocus
                      />
                      <View style={styles.newCategoryActions}>
                        <TouchableOpacity
                          style={styles.newCategoryCancelBtn}
                          disabled={creatingCategory}
                          onPress={() => {
                            setShowNewCategoryForm(false);
                            setNewCategoryName("");
                          }}
                        >
                          <Text style={styles.newCategoryCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.newCategoryCreateBtn, creatingCategory && { opacity: 0.6 }]}
                          disabled={creatingCategory || !newCategoryName.trim()}
                          onPress={handleCreateCategory}
                        >
                          {creatingCategory ? (
                            <ActivityIndicator size="small" color="#0b0e20" />
                          ) : (
                            <Text style={styles.newCategoryCreateText}>Create</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addCategoryRow}
                      onPress={() => setShowNewCategoryForm(true)}
                    >
                      <Text style={styles.addCategoryText}>+ Add New Category</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={closeGenerateModal}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalGenerateBtn}
                    onPress={() => {
                      if (!generateCategoryId) {
                        notifyError("Please choose a category first.");
                        return;
                      }
                      setModalStep("write");
                    }}
                  >
                    <Text style={styles.modalGenerateText}>Next →</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Write your story</Text>
                <Text style={styles.modalSubtitle}>
                  Type or paste the full story text. It will be narrated exactly as you enter it - no AI writing
                  is used - and saved for every parent to enjoy.
                </Text>
                <ScrollView style={styles.modalCategoryList}>
                  <TextInput
                    style={styles.newCategoryInput}
                    placeholder="Story title..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={manualTitle}
                    onChangeText={setManualTitle}
                  />
                  <TextInput
                    style={[styles.newCategoryInput, styles.manualTextArea]}
                    placeholder="Full story text..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={manualText}
                    onChangeText={setManualText}
                    multiline
                    textAlignVertical="top"
                  />

                  <Text style={styles.sectionLabel}>Cover Picture (optional)</Text>
                  {coverImage ? (
                    <View style={styles.coverPreviewRow}>
                      <Image source={{ uri: coverImage.uri }} style={styles.coverPreviewImg} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <TouchableOpacity style={styles.coverChangeBtn} onPress={handlePickCoverImage}>
                          <Text style={styles.coverChangeBtnText}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.coverRemoveBtn} onPress={() => setCoverImage(null)}>
                          <Text style={styles.coverRemoveBtnText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.addCategoryRow} onPress={handlePickCoverImage}>
                      <Text style={styles.addCategoryText}>🖼️ Add Cover Picture</Text>
                    </TouchableOpacity>
                  )}

                  <Text style={styles.sectionLabel}>Story language</Text>
                  <Text style={styles.sectionHint}>
                    Text in another language is translated automatically, then narrated in the language you pick.
                  </Text>
                  <LanguagePicker value={selectedLanguage} onChange={setSelectedLanguage} style={{ marginBottom: 10 }} />

                  <Text style={styles.sectionLabel}>Also publish in (optional)</Text>
                  <Text style={styles.sectionHint}>
                    Listeners can switch language inside the player. Each extra language is translated and narrated once.
                  </Text>
                  <View style={styles.pickerRow}>
                    {LANGUAGES.filter((l) => l.code !== selectedLanguage).map((l) => {
                      const on = extraLanguages.includes(l.code);
                      return (
                        <TouchableOpacity
                          key={l.code}
                          style={[styles.pickerChip, on && styles.pickerChipActive]}
                          onPress={() =>
                            setExtraLanguages((prev) => (on ? prev.filter((c) => c !== l.code) : [...prev, l.code]))
                          }
                        >
                          <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]}>
                            {on ? "✓ " : ""}{l.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {selectedLanguage === "en" && accents.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>Accent</Text>
                      <Text style={styles.sectionHint}>
                        Pick an accent first, then tap ▶ on a voice below to hear that combination.
                      </Text>
                      <View style={styles.pickerRow}>
                        {accents.map((accent) => (
                          <TouchableOpacity
                            key={accent.id}
                            style={[styles.pickerChip, selectedAccentId === accent.id && styles.pickerChipActive]}
                            onPress={() => setSelectedAccentId(accent.id)}
                          >
                            <Text style={styles.pickerChipIcon}>{accent.flag || "🌍"}</Text>
                            <Text
                              style={[
                                styles.pickerChipText,
                                selectedAccentId === accent.id && styles.pickerChipTextActive,
                              ]}
                            >
                              {accent.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  {narratorVoices.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>Narrator Voice</Text>
                      <View style={styles.pickerRow}>
                        {narratorVoices.map((voice) => (
                          <View key={voice.id} style={styles.voicePreviewWrapper}>
                            <TouchableOpacity
                              style={[styles.pickerChip, selectedVoiceId === voice.id && styles.pickerChipActive]}
                              onPress={() => setSelectedVoiceId(voice.id)}
                            >
                              <Text style={styles.pickerChipIcon}>{voice.icon || "🎤"}</Text>
                              <Text
                                style={[
                                  styles.pickerChipText,
                                  selectedVoiceId === voice.id && styles.pickerChipTextActive,
                                ]}
                              >
                                {voice.name}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.previewMiniBtn}
                              onPress={() => handlePreviewVoice(voice)}
                            >
                              <Text style={styles.previewMiniBtnText}>
                                {previewingVoiceId === voice.id ? "⏸" : "▶"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </ScrollView>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    disabled={publishingManual}
                    onPress={() => setModalStep("category")}
                  >
                    <Text style={styles.modalCancelText}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalGenerateBtn, publishingManual && { opacity: 0.6 }]}
                    disabled={publishingManual}
                    onPress={handlePublishManual}
                  >
                    {publishingManual ? (
                      langProgress ? (
                        <Text style={styles.modalGenerateText}>{langProgress}</Text>
                      ) : (
                        <ActivityIndicator size="small" color="#0b0e20" />
                      )
                    ) : (
                      <Text style={styles.modalGenerateText}>Publish</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Story</Text>
            <Text style={styles.modalSubtitle}>
              Update the story text or cover picture. Other languages are never deleted when you edit.
              Narrator voice, accent, and category stay the same as when it was published.
            </Text>
            {loadingEdit ? (
              <ActivityIndicator size="large" color="#f5a623" style={{ marginVertical: 30 }} />
            ) : (
              <>
                <ScrollView style={styles.modalCategoryList}>
                  {editLanguages.length > 1 && (
                    <View style={styles.pickerRow}>
                      {editLanguages.map((c) => {
                        const on = (editTab || editOrigCode) === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            style={[styles.pickerChip, on && styles.pickerChipActive]}
                            onPress={() => handleEditTab(c)}
                          >
                            <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]}>
                              {languageByCode(c).label}{c === editOrigCode ? " (main)" : ""}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  {editTabLoading ? (
                    <ActivityIndicator size="small" color="#f5a623" style={{ marginVertical: 20 }} />
                  ) : editIsOrig ? (
                    <>
                      <TextInput
                        style={styles.newCategoryInput}
                        placeholder="Story title..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={editTitle}
                        onChangeText={setEditTitle}
                      />
                      <TextInput
                        style={[styles.newCategoryInput, styles.manualTextArea]}
                        placeholder="Full story text..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        textAlignVertical="top"
                      />
                      {editLanguages.length > 1 && (
                        <Text style={styles.sectionHint}>
                          Changing the main text does not change the other languages. Edit each one on its own tab, or use "Re-translate" there.
                        </Text>
                      )}
                    </>
                  ) : (
                    <>
                      <TextInput
                        style={styles.newCategoryInput}
                        placeholder="Title..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={(editTrans[editTab] || {}).title || ""}
                        onChangeText={(v) => setTransField(editTab, "title", v)}
                      />
                      <TextInput
                        style={[styles.newCategoryInput, styles.manualTextArea]}
                        placeholder="Full story text..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={(editTrans[editTab] || {}).text || ""}
                        onChangeText={(v) => setTransField(editTab, "text", v)}
                        multiline
                        textAlignVertical="top"
                      />
                      <TouchableOpacity style={styles.addCategoryRow} onPress={() => handleRetranslate(editTab)}>
                        <Text style={styles.addCategoryText}>🔄 Re-translate from main text (~₹5)</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {LANGUAGES.some((l) => !editLanguages.includes(l.code)) && (
                    <>
                      <Text style={styles.sectionLabel}>Add another language</Text>
                      <View style={styles.pickerRow}>
                        {LANGUAGES.filter((l) => !editLanguages.includes(l.code)).map((l) => {
                          const on = editAddLanguages.includes(l.code);
                          return (
                            <TouchableOpacity
                              key={l.code}
                              style={[styles.pickerChip, on && styles.pickerChipActive]}
                              onPress={() =>
                                setEditAddLanguages((prev) => (on ? prev.filter((c) => c !== l.code) : [...prev, l.code]))
                              }
                            >
                              <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]}>
                                {on ? "✓ " : "+ "}{l.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  <Text style={styles.sectionLabel}>Cover Picture</Text>
                  {editCoverImage ? (
                    <View style={styles.coverPreviewRow}>
                      <Image source={{ uri: editCoverImage.uri }} style={styles.coverPreviewImg} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <TouchableOpacity style={styles.coverChangeBtn} onPress={handlePickEditCoverImage}>
                          <Text style={styles.coverChangeBtnText}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.coverRemoveBtn}
                          onPress={() => {
                            setEditCoverImage(null);
                            setEditRemoveCover(true);
                          }}
                        >
                          <Text style={styles.coverRemoveBtnText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : editCoverImageUrl && !editRemoveCover ? (
                    <View style={styles.coverPreviewRow}>
                      <Image source={{ uri: editCoverImageUrl }} style={styles.coverPreviewImg} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <TouchableOpacity style={styles.coverChangeBtn} onPress={handlePickEditCoverImage}>
                          <Text style={styles.coverChangeBtnText}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.coverRemoveBtn}
                          onPress={() => setEditRemoveCover(true)}
                        >
                          <Text style={styles.coverRemoveBtnText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.addCategoryRow} onPress={handlePickEditCoverImage}>
                      <Text style={styles.addCategoryText}>🖼️ Add Cover Picture</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    disabled={savingEdit}
                    onPress={closeEditModal}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalGenerateBtn, savingEdit && { opacity: 0.6 }]}
                    disabled={savingEdit}
                    onPress={handleSaveEdit}
                  >
                    {savingEdit ? (
                      langProgress ? (
                        <Text style={styles.modalGenerateText}>{langProgress}</Text>
                      ) : (
                        <ActivityIndicator size="small" color="#0b0e20" />
                      )
                    ) : (
                      <Text style={styles.modalGenerateText}>Save Changes</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      <StoryLoadingOverlay
        visible={!!narratingId}
        mode="library"
        storyTitle={[...stories, ...(dbResults || [])].find((s) => s.id === narratingId)?.title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060c",
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  titleSerif: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "serif",
  },
  homeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  homeBtnImg: {
    width: "100%",
    height: "100%",
  },
  searchBar: {
    marginHorizontal: 24,
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    outlineStyle: "none",
  },
  createStoryBtn: {
    marginHorizontal: 24,
    marginBottom: 14,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.5)",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  createStoryBtnText: {
    color: "#f5a623",
    fontWeight: "800",
    fontSize: 14,
  },
  chipsContainer: {
    marginBottom: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 24,
    gap: 10,
    alignItems: "center",
  },
  chipsContent: {
    // deprecated
  },
  chip: {
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: "center",
  },
  chipFlex: {
    flex: 1,
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: "#f5a623",
    borderColor: "#f5a623",
  },
  chipText: {
    color: "#9ba1ba",
    fontSize: 14,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#0b0e20",
    fontWeight: "800",
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100, // space for bottom nav
  },
  storyCard: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  storyThumb: {
    width: 80,
    height: 80,
    borderRadius: 16,
    overflow: "hidden",
    marginRight: 15,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  storyInfo: {
    flex: 1,
  },
  storyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "serif",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 11,
    color: "#d0d4e3",
  },
  emptyText: {
    color: "#9ba1ba",
    textAlign: "center",
    marginTop: 40,
  },
  categorySection: {
    marginBottom: 24,
  },
  categorySectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  categoryTile: {
    width: "30%",
    alignItems: "center",
  },
  categoryTileImgWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  categoryTileImgWrapOthers: {
    borderStyle: "dashed",
    borderColor: "rgba(245, 166, 35, 0.5)",
  },
  categoryTileImg: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  categoryTileIcon: {
    fontSize: 30,
    color: "#ffffff",
    textAlign: "center",
  },
  categoryTileName: {
    color: "#d0d4e3",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    backgroundColor: "#161b33",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 20,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  modalSubtitle: {
    color: "#9ba1ba",
    fontSize: 13,
    marginBottom: 16,
  },
  modalCategoryList: {
    maxHeight: 340,
    marginBottom: 16,
  },
  modalCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalCategoryRowActive: {
    backgroundColor: "rgba(245, 166, 35, 0.2)",
    borderColor: "rgba(245, 166, 35, 0.5)",
  },
  modalCategoryIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  modalCategoryText: {
    color: "#d0d4e3",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  modalCategoryTextActive: {
    color: "#f5a623",
  },
  modalCategoryCheck: {
    color: "#f5a623",
    fontWeight: "800",
    fontSize: 16,
  },
  addCategoryRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(245, 166, 35, 0.4)",
    alignItems: "center",
    marginBottom: 10,
  },
  addCategoryText: {
    color: "#f5a623",
    fontSize: 13,
    fontWeight: "700",
  },
  newCategoryForm: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  newCategoryInput: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#ffffff",
    fontSize: 14,
    marginBottom: 10,
  },
  newCategoryActions: {
    flexDirection: "row",
    gap: 8,
  },
  newCategoryCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  newCategoryCancelText: {
    color: "#d0d4e3",
    fontWeight: "700",
    fontSize: 12,
  },
  newCategoryCreateBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f5a623",
  },
  newCategoryCreateText: {
    color: "#0b0e20",
    fontWeight: "800",
    fontSize: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  modalCancelText: {
    color: "#d0d4e3",
    fontWeight: "700",
  },
  modalGenerateBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#f5a623",
  },
  modalGenerateText: {
    color: "#0b0e20",
    fontWeight: "800",
  },
  manualTextArea: {
    minHeight: 140,
    paddingTop: 10,
  },
  sectionLabel: {
    color: "#9ba1ba",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 8,
  },
  sectionHint: {
    color: "#6b7290",
    fontSize: 11,
    marginTop: -4,
    marginBottom: 8,
  },
  voicePreviewWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  previewMiniBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  previewMiniBtnText: {
    fontSize: 11,
    color: "#ffffff",
  },
  coverPreviewRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    alignItems: "center",
  },
  coverPreviewImg: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  coverChangeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  coverChangeBtnText: {
    color: "#d0d4e3",
    fontWeight: "700",
    fontSize: 12,
  },
  coverRemoveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,90,90,0.15)",
    alignItems: "center",
  },
  coverRemoveBtnText: {
    color: "#ff8a8a",
    fontWeight: "700",
    fontSize: 12,
  },
  pickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  pickerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pickerChipActive: {
    backgroundColor: "rgba(245, 166, 35, 0.2)",
    borderColor: "rgba(245, 166, 35, 0.5)",
  },
  pickerChipIcon: {
    fontSize: 14,
  },
  pickerChipText: {
    color: "#d0d4e3",
    fontSize: 12,
    fontWeight: "600",
  },
  pickerChipTextActive: {
    color: "#f5a623",
  },
  adminCardActions: {
    flexDirection: "column",
    gap: 8,
    marginLeft: 10,
  },
  adminIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  adminIconBtnText: {
    fontSize: 13,
    color: "#ffffff",
  },
  adminIconBtnDelete: {
    backgroundColor: "rgba(255,90,90,0.15)",
    borderColor: "rgba(255,90,90,0.3)",
  },
  adminIconBtnDeleteText: {
    fontSize: 13,
    color: "#ff8a8a",
  },
  card: { borderRadius: 10, overflow: "hidden", backgroundColor: "#15172a" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  placeholderEmoji: { marginBottom: 14 },
  titleShade1: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 62,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  titleShade2: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 34,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  cardTitle: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
  },
  newBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    backgroundColor: "#e50914",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingBadge: {
    position: "absolute",
    left: 7,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  ratingBadgeText: { color: "#ffd24a", fontSize: 10, fontWeight: "900" },
  langBadge: {
    position: "absolute",
    right: 7,
    bottom: 7,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  langBadgeText: { color: "#f5a623", fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  newBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  feedHeroWrap: { marginHorizontal: 16, marginTop: 6 },
  feedHeroLabel: { position: "absolute", left: 14, bottom: 40, color: "#ffe2a3", fontSize: 11, fontWeight: "700" },
  feedRowTitle: { color: "#ffffff", fontSize: 17, fontWeight: "800", marginTop: 20, marginBottom: 10, marginHorizontal: 16 },
  feedRowChevron: { color: "#9ba1ba", fontWeight: "600" },
  feedRowScroll: { paddingHorizontal: 16, gap: 10 },
  feedAdminBtns: { position: "absolute", right: 5, top: 5, flexDirection: "row", gap: 4 },
  feedAdminBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  feedAdminBtnDel: { backgroundColor: "rgba(120,0,0,0.7)" },
  feedAdminBtnText: { color: "#fff", fontSize: 13 },
});
