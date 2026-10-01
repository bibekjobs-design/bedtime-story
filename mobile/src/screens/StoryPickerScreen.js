import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";
import { api } from "../api/client";
import SafeAudio from "../utils/safeAudio";

const DEFAULT_VOICES = [
  {
    id: "luna",
    name: "Luna",
    icon: "🌸",
    tone: "Soft & Motherly",
    description: "Warm, gentle & soothing female voice",
  },
  {
    id: "oliver",
    name: "Oliver",
    icon: "🌲",
    tone: "Deep & Gentle",
    description: "Calm, protective & gentle fatherly voice",
  },
  {
    id: "willow",
    name: "Willow",
    icon: "🍃",
    tone: "Calm & Whispering",
    description: "Peaceful & meditative whispery voice",
  },
  {
    id: "jasper",
    name: "Jasper",
    icon: "✨",
    tone: "Storybook & Cozy",
    description: "Whimsical & comforting bedtime storyteller",
  },
];

const PROMPT_SUGGESTIONS = [
  "A sleepy little bear finding the softest moss bed",
  "A gentle sea otter floating under the moonlit waves",
  "The little star that yawned across the quiet sky",
  "A peaceful bunny in a warm burrow listening to rain",
  "A friendly baby dinosaur drifting off to sleep",
];

const STORAGE_KEY_GENERATED_HISTORY = "@bedtime_user_generated_history";

export default function StoryPickerScreen({
  selectedAgeGroup,
  selectedCategory,
  activeProfile,
  voiceClones = [],
  initialSearchQuery = "",
  onBack,
  onPlayStory,
  onGoToUpgrade,
}) {
  // Accordion sections: 'library' | 'generate' | 'cloned' | 'history' | null
  const [openSection, setOpenSection] = useState("library");

  function toggleSection(name) {
    setOpenSection((prev) => (prev === name ? null : name));
  }

  // Precreated Stories (Tab 1)
  const [stories, setStories] = useState([]);
  const [loadingStories, setLoadingStories] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [isSearching, setIsSearching] = useState(false);
  const [librarySort, setLibrarySort] = useState("popular"); // 'popular' | 'top_rated' | 'newest' | 'favorites'
  const [favoriteIds, setFavoriteIds] = useState([]);

  // Custom Story Generation (Tab 2)
  // 'text' | 'image' | 'pdf'
  const [createMode, setCreateMode] = useState("text");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedImage, setSelectedImage] = useState(null); // { uri, name, type }
  const [selectedPdf, setSelectedPdf] = useState(null); // { uri, name, size }
  const [isSearchingConcepts, setIsSearchingConcepts] = useState(false);
  const [conceptResults, setConceptResults] = useState([]);
  const [selectedConcept, setSelectedConcept] = useState(null);

  const [narratorVoices, setNarratorVoices] = useState(DEFAULT_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState("luna");
  const [previewingVoiceId, setPreviewingVoiceId] = useState(null);

  // English accent/locale (US/UK/India/Australia) for whichever narrator
  // persona is picked above - same Google TTS voice, different locale.
  const [accents, setAccents] = useState([]);
  const [selectedAccentId, setSelectedAccentId] = useState("us");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewSoundRef = useRef(null);

  // Voice Clones (Section 3)
  const [selectedCloneId, setSelectedCloneId] = useState(
    voiceClones.length > 0 ? voiceClones[0].id : null
  );
  // 'library' | 'text' | 'image' | 'file' | 'search'
  const [cloneSourceMode, setCloneSourceMode] = useState("library");
  const [clonePrompt, setClonePrompt] = useState("");
  const [cloneImage, setCloneImage] = useState(null);
  const [cloneFile, setCloneFile] = useState(null);
  const [isSearchingCloneConcepts, setIsSearchingCloneConcepts] = useState(false);
  const [cloneConceptResults, setCloneConceptResults] = useState([]);
  const [selectedCloneConcept, setSelectedCloneConcept] = useState(null);
  const [generatingClonedCustom, setGeneratingClonedCustom] = useState(false);

  // Quotas & Usage
  const [usageInfo, setUsageInfo] = useState(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitModalType, setLimitModalType] = useState("generate"); // 'generate' | 'clone'

  // Subscription & Trial Status
  const [subStatus, setSubStatus] = useState(null);

  // User-Generated History (Tab 4)
  const [generatedHistory, setGeneratedHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Processing state
  const [generatingCustom, setGeneratingCustom] = useState(false);
  const [committingStoryId, setCommittingStoryId] = useState(null);
  const [cloningStoryId, setCloningStoryId] = useState(null);
  const [countdown, setCountdown] = useState(15);
  const countdownIntervalRef = useRef(null);
  const [error, setError] = useState(null);

  const isGenerating =
    generatingCustom || generatingClonedCustom || !!committingStoryId || !!cloningStoryId;

  useEffect(() => {
    if (isGenerating) {
      setCountdown(15);
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
      }, 1000);
    } else {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [isGenerating]);

  useEffect(() => {
    // 1. Immediately load local caches synchronously
    loadSavedVoice();
    loadGeneratedHistory();
    loadFavorites();
    loadPrecreatedStoriesFast();

    // 2. Parallel background fetch for metadata without blocking UI
    Promise.allSettled([
      loadNarratorVoices(),
      loadUsageInfo(),
      loadSubStatus(),
    ]);

    return () => {
      if (previewSoundRef.current) {
        previewSoundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, [selectedAgeGroup?.id, selectedCategory?.id]);

  async function loadSubStatus() {
    try {
      const res = await api.getSubscriptionStatus();
      setSubStatus(res);
    } catch (e) {}
  }

  async function loadSavedVoice() {
    try {
      const saved = await AsyncStorage.getItem("@bedtime_selected_voice");
      if (saved) setSelectedVoiceId(saved);
    } catch (e) {}
  }

  async function loadNarratorVoices() {
    try {
      const list = await api.getNarratorVoices();
      if (list && list.length > 0) setNarratorVoices(list);
    } catch (e) {}
    try {
      const accentList = await api.getAccents();
      if (accentList && accentList.length > 0) setAccents(accentList);
    } catch (e) {}
  }

  // Blazing Fast Instant 0ms Cached Loader for Pre-created Library Stories
  async function loadPrecreatedStoriesFast(sortBy = librarySort) {
    const ageId = selectedAgeGroup?.id || 1;
    const catId = selectedCategory?.id || "all";
    const cacheKey = `@bedtime_precreated_cache_${ageId}_${catId}_${sortBy}`;

    // 1. Instantly load from local storage cache (0ms perceived time!)
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          setStories(parsed);
          setLoadingStories(false);
        } else {
          setLoadingStories(true);
        }
      } else {
        setLoadingStories(true);
      }
    } catch (e) {
      setLoadingStories(true);
    }

    // 2. Fetch fresh from API in background and update cache silently
    try {
      setError(null);
      const data = await api.getPrecreatedStories(
        selectedCategory?.id || null,
        ageId,
        1,
        sortBy
      );
      if (data && data.length > 0) {
        setStories(data);
        AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
      }
    } catch (err) {
      if (stories.length === 0) {
        setError(err.message);
      }
    } finally {
      setLoadingStories(false);
    }
  }

  async function loadFavorites() {
    try {
      const raw = await AsyncStorage.getItem("@bedtime_user_favorites");
      setFavoriteIds(raw ? JSON.parse(raw) : []);
    } catch (e) {}
  }

  async function toggleFavorite(storyId) {
    try {
      const raw = await AsyncStorage.getItem("@bedtime_user_favorites");
      const list = raw ? JSON.parse(raw) : [];
      let updated;
      if (list.includes(storyId)) {
        updated = list.filter((id) => id !== storyId);
      } else {
        updated = [storyId, ...list];
      }
      await AsyncStorage.setItem("@bedtime_user_favorites", JSON.stringify(updated));
      setFavoriteIds(updated);
    } catch (e) {}
  }

  async function loadUsageInfo() {
    try {
      const info = await api.getStoryUsage();
      setUsageInfo(info);
    } catch (e) {}
  }

  async function loadGeneratedHistory() {
    try {
      setLoadingHistory(true);
      const raw = await AsyncStorage.getItem(STORAGE_KEY_GENERATED_HISTORY);
      setGeneratedHistory(raw ? JSON.parse(raw) : []);
    } catch (e) {
      setGeneratedHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function saveToGeneratedHistory(storyItem) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_GENERATED_HISTORY);
      const list = raw ? JSON.parse(raw) : [];
      const storyId = storyItem.story_text_id || storyItem.id;
      const filtered = list.filter((item) => (item.story_text_id || item.id) !== storyId);
      const updated = [
        {
          story_text_id: storyId,
          title: storyItem.title,
          teaser: storyItem.teaser,
          audio_url: storyItem.audio_url,
          duration_seconds: storyItem.duration_seconds,
          origin: storyItem.origin || (storyItem.voice_tier === "cloned" ? "cloned" : storyItem.voice_tier === "library" ? "library" : "custom"),
          voice_tier: storyItem.voice_tier || (storyItem.origin === "library" ? "library" : "standard"),
          narrator_name: storyItem.narrator_name || "Luna",
          narrator_icon: storyItem.narrator_icon || "🌸",
          ambient_sound: storyItem.ambient_sound,
          full_text: storyItem.full_text || "",
          created_at: new Date().toISOString(),
        },
        ...filtered,
      ].slice(0, 50);

      await AsyncStorage.setItem(STORAGE_KEY_GENERATED_HISTORY, JSON.stringify(updated));
      setGeneratedHistory(updated);
    } catch (e) {
      console.warn("Failed to save story to history:", e);
    }
  }

  async function handleSelectVoice(voiceId) {
    setSelectedVoiceId(voiceId);
    await AsyncStorage.setItem("@bedtime_selected_voice", voiceId);
  }

  async function handlePlayVoicePreview(voiceId) {
    try {
      if (previewingVoiceId === voiceId) {
        if (previewSoundRef.current) {
          await previewSoundRef.current.stopAsync();
          await previewSoundRef.current.unloadAsync();
          previewSoundRef.current = null;
        }
        setPreviewingVoiceId(null);
        return;
      }

      if (previewSoundRef.current) {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }

      setPreviewLoading(true);
      setPreviewingVoiceId(voiceId);

      const res = await api.getVoicePreview(voiceId, selectedAccentId);
      if (res && res.preview_url) {
        const { sound } = await SafeAudio.Sound.createAsync(
          { uri: res.preview_url },
          { shouldPlay: true }
        );
        previewSoundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            setPreviewingVoiceId(null);
            sound.unloadAsync().catch(() => {});
            previewSoundRef.current = null;
          }
        });
      }
    } catch (e) {
      setPreviewingVoiceId(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // TAB 1: Play Pre-created Story & Add to History
  async function handlePlayPrecreatedStory(story) {
    try {
      setCommittingStoryId(story.id);
      setError(null);
      const res = await api.commitStory(story.id, "standard", "luna");

      const storyPayload = {
        ...res,
        origin: "library",
        voice_tier: "library",
        narrator_name: "Luna",
        narrator_icon: "🌸",
        ambient_sound: res.ambient_sound || story.ambient_sound,
        mode: "audio_only",
      };

      // Record pre-created library story into history tab
      await saveToGeneratedHistory(storyPayload);
      onPlayStory(storyPayload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommittingStoryId(null);
    }
  }

  // TAB 2: Search for Story Concepts / Ideas
  async function handleSearchConcepts() {
    const query = customPrompt.trim();
    if (!query) {
      setError("Please type a story idea or pick a suggestion first!");
      return;
    }

    try {
      setIsSearchingConcepts(true);
      setError(null);
      const results = await api.searchStories(
        query,
        selectedAgeGroup?.id || 1,
        1,
        true
      );
      const items = results || [];
      setConceptResults(items);
      if (items.length > 0) {
        setSelectedConcept(items[0]);
      } else {
        setSelectedConcept({
          title: `The Tale of ${query.slice(0, 30)}`,
          teaser: query,
        });
      }
    } catch (err) {
      setError("Could not find ideas: " + err.message);
    } finally {
      setIsSearchingConcepts(false);
    }
  }

  // Media Pickers
  async function handleTakePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is required to snap book pages.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedImage(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to open camera: " + e.message);
    }
  }

  async function handlePickImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photos permission is required to choose a storybook picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedImage(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to pick image: " + e.message);
    }
  }

  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["*/*"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedPdf(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to pick file: " + (e?.message || e));
    }
  }

  // Helper to convert URI to Blob on Web for FormData
  async function uriToBlob(uri) {
    const response = await fetch(uri);
    return await response.blob();
  }

  // TAB 2: Generate Brand New Story (Text, Photo, File, or Search)
  async function handleGenerateCustomStory() {
    // Check subscription trial status
    if (subStatus && !subStatus.is_subscribed && !subStatus.is_trial_active) {
      onGoToUpgrade();
      return;
    }

    if (createMode === "image" && !selectedImage) {
      setError("Please snap or upload a storybook picture first!");
      return;
    }
    if (createMode === "file" && !selectedPdf) {
      setError("Please choose a story file (PDF, TXT, DOC) first!");
      return;
    }

    const promptToUse = selectedConcept
      ? `${selectedConcept.title}: ${selectedConcept.teaser}`
      : customPrompt.trim();

    if (createMode === "text" && !promptToUse) {
      setError("Please write your story idea above!");
      return;
    }

    if (createMode === "search" && !promptToUse) {
      setError("Please search and select a story idea first!");
      return;
    }

    // Check monthly limit
    const remaining = usageInfo?.new_story_remaining ?? 10;
    if (remaining <= 0) {
      setLimitModalType("generate");
      setShowLimitModal(true);
      return;
    }

    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }
      setPreviewingVoiceId(null);

      setGeneratingCustom(true);
      setError(null);

      // Build Multipart Form Data
      const formData = new FormData();
      formData.append("input_mode", createMode === "search" ? "text" : createMode);
      formData.append("prompt", promptToUse || "");
      formData.append("age_group_id", String(selectedAgeGroup?.id || 1));
      if (selectedCategory?.id) {
        formData.append("category_id", selectedCategory.id);
      }
      formData.append("language_id", "1");
      formData.append("voice_id", selectedVoiceId || "luna");
      formData.append("accent_id", selectedAccentId || "us");

      if (createMode === "image" && selectedImage) {
        const uri = selectedImage.uri;
        const uriParts = uri.split(".");
        const fileType = uriParts[uriParts.length - 1] || "jpeg";
        const fileName = `storybook_page.${fileType}`;
        const mimeType = `image/${fileType}`;

        if (Platform.OS === "web") {
          if (selectedImage.file) {
            formData.append("file", selectedImage.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("file", blob, fileName);
          }
        } else {
          formData.append("file", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      } else if (createMode === "file" && selectedPdf) {
        const uri = selectedPdf.uri;
        const fileName = selectedPdf.name || "storybook_document.pdf";
        const mimeType = selectedPdf.mimeType || "application/pdf";

        if (Platform.OS === "web") {
          if (selectedPdf.file) {
            formData.append("file", selectedPdf.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("file", blob, fileName);
          }
        } else {
          formData.append("file", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      }

      const res = await api.convertToStory(formData);

      loadUsageInfo();
      loadSubStatus();
      const voiceObj = narratorVoices.find((v) => v.id === selectedVoiceId);

      const storyPayload = {
        ...res,
        origin: "custom",
        narrator_name: voiceObj?.name || "Luna",
        narrator_icon: voiceObj?.icon || "🌸",
        ambient_sound: res.ambient_sound,
        mode: "audio_only",
      };

      await saveToGeneratedHistory(storyPayload);
      onPlayStory(storyPayload);
    } catch (err) {
      if (err.message.includes("Monthly limit reached") || err.message.includes("limit reached")) {
        setLimitModalType("generate");
        setShowLimitModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setGeneratingCustom(false);
    }
  }

  // TAB 3: Narrate in Cloned Parent Voice
  async function handleNarrateClonedStory(story) {
    // Check subscription trial status
    if (subStatus && !subStatus.is_subscribed && !subStatus.is_trial_active) {
      onGoToUpgrade();
      return;
    }

    const remaining = usageInfo?.voice_clone_remaining ?? 2;
    if (remaining <= 0) {
      setLimitModalType("clone");
      setShowLimitModal(true);
      return;
    }

    const cloneObj = voiceClones.find((c) => c.id === selectedCloneId) || voiceClones[0];
    if (!cloneObj) {
      setError("Please record or select a parent voice clone first.");
      return;
    }

    try {
      setCloningStoryId(story.id);
      setError(null);
      const res = await api.narrateCloned(
        story.id,
        activeProfile?.id || null,
        cloneObj.id
      );

      loadUsageInfo();
      loadSubStatus();
      const storyPayload = {
        story_text_id: story.id,
        title: `${story.title} (in ${cloneObj.display_name || "Parent's Voice"})`,
        teaser: story.teaser,
        full_text: res.full_text,
        audio_url: res.audio_url,
        duration_seconds: res.duration_seconds,
        origin: "cloned",
        voice_tier: "cloned",
        narrator_name: cloneObj.display_name || "Parent Voice",
        narrator_icon: "🎙️",
        ambient_sound: res.ambient_sound || story.ambient_sound,
        mode: "audio_only",
      };

      await saveToGeneratedHistory(storyPayload);
      onPlayStory(storyPayload);
    } catch (err) {
      if (err.message.includes("Monthly limit reached") || err.message.includes("limit reached")) {
        setLimitModalType("clone");
        setShowLimitModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setCloningStoryId(null);
    }
  }

  // Clone Multi-Mode Pickers
  async function handleTakeClonePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is required to snap a book page.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCloneImage(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to open camera: " + e.message);
    }
  }

  async function handlePickCloneImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCloneImage(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to pick image: " + e.message);
    }
  }

  async function handlePickCloneFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["*/*"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCloneFile(result.assets[0]);
        setError(null);
      }
    } catch (e) {
      setError("Failed to pick file: " + (e?.message || e));
    }
  }

  async function handleSearchCloneConcepts() {
    if (!clonePrompt.trim()) return;
    try {
      setIsSearchingCloneConcepts(true);
      setError(null);
      const res = await api.searchStories(
        clonePrompt.trim(),
        selectedAgeGroup?.id || 1,
        1,
        true
      );
      setCloneConceptResults(res || []);
    } catch (e) {
      setError("Concept search failed: " + e.message);
    } finally {
      setIsSearchingCloneConcepts(false);
    }
  }

  // Narrate Custom (Write/Photo/File/Search) in Parent Voice Clone
  async function handleGenerateClonedCustomStory() {
    if (subStatus && !subStatus.is_subscribed && !subStatus.is_trial_active) {
      onGoToUpgrade();
      return;
    }

    const cloneRemaining = usageInfo?.voice_clone_remaining ?? 2;
    if (cloneRemaining <= 0) {
      setLimitModalType("clone");
      setShowLimitModal(true);
      return;
    }

    const cloneObj = voiceClones.find((c) => c.id === selectedCloneId) || voiceClones[0];
    if (!cloneObj) {
      setError("Please record or select a parent voice clone first!");
      return;
    }

    if (cloneSourceMode === "image" && !cloneImage) {
      setError("Please snap or upload a storybook picture first!");
      return;
    }
    if (cloneSourceMode === "file" && !cloneFile) {
      setError("Please choose a story file (PDF, TXT, DOC) first!");
      return;
    }

    const promptToUse = selectedCloneConcept
      ? `${selectedCloneConcept.title}: ${selectedCloneConcept.teaser}`
      : clonePrompt.trim();

    if (cloneSourceMode === "text" && !promptToUse) {
      setError("Please write the story idea for parent to narrate!");
      return;
    }
    if (cloneSourceMode === "search" && !promptToUse) {
      setError("Please search and select a story idea first!");
      return;
    }

    try {
      setGeneratingClonedCustom(true);
      setError(null);

      const formData = new FormData();
      formData.append("input_mode", cloneSourceMode === "search" ? "text" : cloneSourceMode);
      formData.append("prompt", promptToUse || "");
      formData.append("age_group_id", String(selectedAgeGroup?.id || 1));
      if (selectedCategory?.id) {
        formData.append("category_id", selectedCategory.id);
      }
      formData.append("language_id", "1");
      formData.append("voice_id", "luna");

      if (cloneSourceMode === "image" && cloneImage) {
        const uri = cloneImage.uri;
        const uriParts = uri.split(".");
        const fileType = uriParts[uriParts.length - 1] || "jpeg";
        const fileName = `storybook_page.${fileType}`;
        const mimeType = `image/${fileType}`;

        if (Platform.OS === "web") {
          if (cloneImage.file) {
            formData.append("file", cloneImage.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("file", blob, fileName);
          }
        } else {
          formData.append("file", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      } else if (cloneSourceMode === "file" && cloneFile) {
        const uri = cloneFile.uri;
        const fileName = cloneFile.name || "storybook_document.pdf";
        const mimeType = cloneFile.mimeType || "application/pdf";

        if (Platform.OS === "web") {
          if (cloneFile.file) {
            formData.append("file", cloneFile.file, fileName);
          } else {
            const blob = await uriToBlob(uri);
            formData.append("file", blob, fileName);
          }
        } else {
          formData.append("file", {
            uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
            name: fileName,
            type: mimeType,
          });
        }
      }

      // Step 1: Weave story text using Gemini multimodal engine
      const convertedRes = await api.convertToStory(formData);
      const storyTextId = convertedRes.story_text_id;

      // Step 2: Narrate in parent cloned voice
      const clonedAudioRes = await api.narrateCloned(
        storyTextId,
        activeProfile?.id || null,
        cloneObj.id
      );

      loadUsageInfo();
      loadSubStatus();

      const storyPayload = {
        story_text_id: storyTextId,
        title: `${convertedRes.title || "Custom Bedtime Story"} (in ${cloneObj.display_name || "Parent's Voice"})`,
        teaser: convertedRes.teaser,
        full_text: clonedAudioRes.full_text || convertedRes.full_text,
        audio_url: clonedAudioRes.audio_url || convertedRes.audio_url,
        duration_seconds: clonedAudioRes.duration_seconds || convertedRes.duration_seconds,
        origin: "cloned",
        voice_tier: "cloned",
        narrator_name: cloneObj.display_name || "Parent Voice",
        narrator_icon: "🎙️",
        ambient_sound: clonedAudioRes.ambient_sound || convertedRes.ambient_sound,
        mode: "audio_only",
      };

      await saveToGeneratedHistory(storyPayload);
      onPlayStory(storyPayload);
    } catch (err) {
      if (err.message.includes("Monthly limit reached") || err.message.includes("limit reached")) {
        setLimitModalType("clone");
        setShowLimitModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setGeneratingClonedCustom(false);
    }
  }


  async function handleSearchLibrary(query) {
    setSearchQuery(query);
    if (!query.trim()) {
      loadPrecreatedStoriesFast();
      return;
    }
    try {
      setIsSearching(true);
      setError(null);
      const results = await api.searchStories(
        query.trim(),
        selectedAgeGroup?.id || 1,
        1,
        false
      );
      setStories(results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  }

  const newStoryLimit = usageInfo?.new_story_limit ?? 10;
  const newStoryRemaining = usageInfo?.new_story_remaining ?? newStoryLimit;
  const cloneLimit = usageInfo?.voice_clone_limit ?? 2;
  const cloneRemaining = usageInfo?.voice_clone_remaining ?? cloneLimit;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Age Groups</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.ageBadge}>
            {activeProfile ? `🧸 ${activeProfile.name}` : selectedAgeGroup?.label || "Bedtime Stories"}
          </Text>
          <Text style={styles.categoryTitle}>Bedtime Audio Library</Text>
        </View>
      </View>

      {/* Free Trial / Subscription Status Banner */}
      {subStatus ? (
        subStatus.subscription_tier === "admin_vip" ? (
          <View style={styles.adminBanner}>
            <Text style={styles.adminBannerText}>
              👑 Admin VIP Access Active • Unlimited AI Generations & Voice Clones
            </Text>
          </View>
        ) : subStatus.is_subscribed ? (
          <View style={styles.premiumBanner}>
            <Text style={styles.premiumBannerText}>
              {subStatus.plan_tier === "pro"
                ? `👑 Bedtime Story Pro Active • ₹${subStatus.pro_plan_price_inr}/mo (8 Custom Stories + 4 Voice Clones)`
                : `📖 Bedtime Story Normal Active • ₹${subStatus.normal_plan_price_inr}/mo (3 Custom Stories/mo, up to 3 min)`}
            </Text>
          </View>
        ) : subStatus.is_trial_active ? (
          <View style={styles.trialBanner}>
            <View style={styles.trialBannerLeft}>
              <Text style={styles.trialBannerTitle}>
                ⏳ {subStatus.trial_duration_days || 15}-Day Free Trial Active
              </Text>
              <Text style={styles.trialBannerSubtitle}>
                {subStatus.trial_days_left > 1
                  ? `${subStatus.trial_days_left} days left`
                  : `${subStatus.trial_hours_left} hours left`}{" "}
                • Unlimited Library • Normal ₹{subStatus.normal_plan_price_inr}/mo or Pro ₹{subStatus.pro_plan_price_inr}/mo after trial
              </Text>
            </View>
            <TouchableOpacity style={styles.trialUpgradeBtn} onPress={onGoToUpgrade}>
              <Text style={styles.trialUpgradeBtnText}>👑 View Plans</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.trialBanner, styles.trialBannerExpired]}>
            <View style={styles.trialBannerLeft}>
              <Text style={styles.trialBannerTitle}>🔒 Free Trial Expired</Text>
              <Text style={styles.trialBannerSubtitle}>
                Library is still free! Subscribe to create new stories — Normal ₹{subStatus.normal_plan_price_inr}/mo or Pro ₹{subStatus.pro_plan_price_inr}/mo
              </Text>
            </View>
            <TouchableOpacity style={[styles.trialUpgradeBtn, styles.trialUpgradeBtnGlow]} onPress={onGoToUpgrade}>
              <Text style={styles.trialUpgradeBtnText}>👑 Upgrade Now</Text>
            </TouchableOpacity>
          </View>
        )
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      ) : null}

      {/* Generating Overlay Animation */}
      {isGenerating ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTitle}>
            {generatingCustom
              ? "✨ Weaving Your Custom Bedtime Story..."
              : cloningStoryId
              ? "🎙️ Narrating Story in Parent's Voice..."
              : "🌙 Loading Bedtime Tale..."}
          </Text>
          <Text style={styles.loadingSubtitle}>
            Calibrating gentle cadence and soothing ambient soundscape (~{countdown}s)
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.contentContainer}>

          {/* ═══════════════════════════════════════════ */}
          {/* SECTION 1: 📚 LIBRARY                      */}
          {/* ═══════════════════════════════════════════ */}
          <TouchableOpacity
            style={[styles.accordionHeader, openSection === "library" && styles.accordionHeaderActive]}
            onPress={() => toggleSection("library")}
            activeOpacity={0.85}
          >
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionHeaderEmoji}>📚</Text>
              <View>
                <Text style={styles.accordionHeaderTitle}>Library</Text>
                <Text style={styles.accordionHeaderSub}>Pre-created bedtime stories curated for you</Text>
              </View>
            </View>
            <Text style={styles.accordionChevron}>
              {openSection === "library" ? "▼" : "▶"}
            </Text>
          </TouchableOpacity>

          {openSection === "library" && (
          <View style={[styles.tabContent, styles.accordionBody]}>
              {/* Search Bar */}
              <View style={styles.searchBarContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="🔍 Search pre-created bedtime stories..."
                  placeholderTextColor={colors.textDim}
                  value={searchQuery}
                  onChangeText={handleSearchLibrary}
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => handleSearchLibrary("")}>
                    <Text style={styles.searchClear}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>📚 Story Library ({stories.length})</Text>
              </View>

              {/* Sort & Filter Chips Bar */}
              <View style={styles.sortChipsRow}>
                <TouchableOpacity
                  style={[styles.sortChip, librarySort === "popular" && styles.sortChipActive]}
                  onPress={() => {
                    setLibrarySort("popular");
                    loadPrecreatedStoriesFast("popular");
                  }}
                >
                  <Text style={[styles.sortChipText, librarySort === "popular" && styles.sortChipTextActive]}>
                    🔥 Popular
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sortChip, librarySort === "top_rated" && styles.sortChipActive]}
                  onPress={() => {
                    setLibrarySort("top_rated");
                    loadPrecreatedStoriesFast("top_rated");
                  }}
                >
                  <Text style={[styles.sortChipText, librarySort === "top_rated" && styles.sortChipTextActive]}>
                    ⭐ Top Rated
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sortChip, librarySort === "newest" && styles.sortChipActive]}
                  onPress={() => {
                    setLibrarySort("newest");
                    loadPrecreatedStoriesFast("newest");
                  }}
                >
                  <Text style={[styles.sortChipText, librarySort === "newest" && styles.sortChipTextActive]}>
                    ✨ Newest
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sortChip, librarySort === "favorites" && styles.sortChipActive]}
                  onPress={() => setLibrarySort("favorites")}
                >
                  <Text style={[styles.sortChipText, librarySort === "favorites" && styles.sortChipTextActive]}>
                    ❤️ Saved ({favoriteIds.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {loadingStories && stories.length === 0 ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
              ) : (librarySort === "favorites" ? stories.filter((s) => favoriteIds.includes(s.id)) : stories).length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyEmoji}>{librarySort === "favorites" ? "❤️" : "🌙"}</Text>
                  <Text style={styles.emptyTitle}>
                    {librarySort === "favorites" ? "No saved favorites yet" : "No stories found"}
                  </Text>
                  <Text style={styles.emptyText}>
                    {librarySort === "favorites"
                      ? "Tap the ❤️ heart icon on any bedtime story to bookmark it for instant bedtime listening!"
                      : "Try searching another word, or switch to the 'Generate' tab to create your own original story!"}
                  </Text>
                </View>
              ) : (
                (librarySort === "favorites" ? stories.filter((s) => favoriteIds.includes(s.id)) : stories).map((story) => (
                  <View key={story.id} style={styles.storyCard}>
                    <View style={styles.storyCardTop}>
                      <Text style={styles.storyCardTitle}>{story.title}</Text>
                      <View style={styles.cardBadgeRow}>
                        <TouchableOpacity
                          style={styles.favBadgeBtn}
                          onPress={() => toggleFavorite(story.id)}
                        >
                          <Text style={styles.favBadgeIcon}>
                            {favoriteIds.includes(story.id) ? "❤️" : "🤍"}
                          </Text>
                        </TouchableOpacity>

                        <View style={styles.ratingBadge}>
                          <Text style={styles.ratingBadgeText}>
                            ⭐ {story.average_rating ? Number(story.average_rating).toFixed(1) : "5.0"}
                          </Text>
                        </View>
                        {story.ambient_sound ? (
                          <View style={styles.ambientBadge}>
                            <Text style={styles.ambientBadgeText}>
                              {story.ambient_sound.icon} {story.ambient_sound.name}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.storyCardTeaser}>{story.teaser}</Text>

                    <View style={styles.storyCardBottom}>
                      <Text style={styles.durationTag}>
                        ⏱️ {story.duration_seconds ? `${Math.round(story.duration_seconds / 60)} mins` : "5-7 mins"}
                      </Text>
                      <TouchableOpacity
                        style={styles.listenNowButton}
                        onPress={() => handlePlayPrecreatedStory(story)}
                      >
                        <Text style={styles.listenNowText}>▶️ Listen Now</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* ══════════════════════════════════════════════ */}
          {/* SECTION 2: ✨ GENERATE STORY                  */}
          {/* ══════════════════════════════════════════════ */}
          <TouchableOpacity
            style={[styles.accordionHeader, openSection === "generate" && styles.accordionHeaderActive]}
            onPress={() => toggleSection("generate")}
            activeOpacity={0.85}
          >
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionHeaderEmoji}>✨</Text>
              <View>
                <Text style={styles.accordionHeaderTitle}>Generate Story</Text>
                <Text style={styles.accordionHeaderSub}>Create a custom AI bedtime tale</Text>
              </View>
            </View>
            <View style={styles.accordionHeaderRight}>
              {(subStatus?.is_subscribed || subStatus?.is_trial_active) && (
                <View style={[styles.quotaPill, newStoryRemaining === 0 && styles.quotaPillZero]}>
                  <Text style={styles.quotaPillText}>{newStoryRemaining}/{newStoryLimit}</Text>
                </View>
              )}
              <Text style={styles.accordionChevron}>
                {openSection === "generate" ? "▼" : "▶"}
              </Text>
            </View>
          </TouchableOpacity>

          {openSection === "generate" && (
          <View style={[styles.tabContent, styles.accordionBody]}>
              {(!subStatus?.is_subscribed && !subStatus?.is_trial_active) ? (
                <View style={styles.lockedFeatureCard}>
                  <Text style={styles.lockedEmoji}>✨ 🔒</Text>
                  <Text style={styles.lockedTitle}>Custom AI Bedtime Stories</Text>
                  <Text style={styles.lockedSubtitle}>
                    Your free trial has ended. Subscribe to Normal (₹{subStatus?.normal_plan_price_inr || 99}/month, 3 stories) or Pro (₹{subStatus?.pro_plan_price_inr || 219}/month, 8 stories + voice cloning) to keep creating new stories!
                  </Text>
                  <View style={styles.lockedBenefitsList}>
                    <Text style={styles.lockedBenefitItem}>✨ Up to 8 Original AI bedtime stories every month (Pro)</Text>
                    <Text style={styles.lockedBenefitItem}>🎙️ Choose storyteller voices (Luna, Oliver, Willow, Jasper)</Text>
                    <Text style={styles.lockedBenefitItem}>🧸 Weave your child's name into personalized tales</Text>
                    <Text style={styles.lockedBenefitItem}>🌲 Story-matched ambient sleep soundscapes</Text>
                  </View>
                  <TouchableOpacity style={styles.lockedUpgradeBtn} onPress={onGoToUpgrade}>
                    <Text style={styles.lockedUpgradeBtnText}>👑 View Plans (from ₹{subStatus?.normal_plan_price_inr || 99}/mo)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.lockedExploreBtn} onPress={() => {}}>
                    <Text style={styles.lockedExploreBtnText}>🎧 Scroll up to Library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Monthly Quota Banner */}
                  <View style={styles.quotaBanner}>
                    <View style={styles.quotaBannerLeft}>
                      <Text style={styles.quotaBannerTitle}>✨ Custom Story Generations</Text>
                      <Text style={styles.quotaBannerSubtitle}>
                        {newStoryRemaining} of {newStoryLimit} stories remaining this month
                      </Text>
                    </View>
                    <View style={styles.quotaProgressBox}>
                      <View
                        style={[
                          styles.quotaProgressBar,
                          { width: `${Math.min(100, (newStoryRemaining / newStoryLimit) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>

                  {/* Step 1: Multimodal Creation Mode Selector (4 Dedicated Tabs) */}
                  <View style={styles.createModePillsContainer}>
                    <TouchableOpacity
                      style={[styles.createModePill, createMode === "text" && styles.createModePillActive]}
                      onPress={() => {
                        setCreateMode("text");
                        setSelectedConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, createMode === "text" && styles.createModePillTextActive]}>
                        ✍️ Write
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, createMode === "image" && styles.createModePillActive]}
                      onPress={() => {
                        setCreateMode("image");
                        setSelectedConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, createMode === "image" && styles.createModePillTextActive]}>
                        📸 Book Photo
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, createMode === "file" && styles.createModePillActive]}
                      onPress={() => {
                        setCreateMode("file");
                        setSelectedConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, createMode === "file" && styles.createModePillTextActive]}>
                        📁 Upload File
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, createMode === "search" && styles.createModePillActive]}
                      onPress={() => {
                        setCreateMode("search");
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, createMode === "search" && styles.createModePillTextActive]}>
                        🔍 Search Ideas
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Mode 1: ✍️ Write Story Direct */}
                  {createMode === "text" && (
                    <View style={styles.creatorCard}>
                      <Text style={styles.creatorCardTitle}>📝 Write Your Bedtime Story or Idea:</Text>
                      <Text style={styles.uploadSubtext}>
                        Type characters, adventures, or a calming moral lesson. Our AI will weave it into a gentle bedtime tale!
                      </Text>
                      <TextInput
                        style={[styles.creatorInput, { minHeight: 90, textAlignVertical: "top" }]}
                        placeholder="e.g. A playful little puppy named Toby who wanders into a dandelion field and takes a nap under the stars..."
                        placeholderTextColor={colors.textDim}
                        value={customPrompt}
                        onChangeText={(txt) => {
                          setCustomPrompt(txt);
                          setSelectedConcept(null);
                        }}
                        multiline
                        numberOfLines={4}
                      />

                      {/* Prompt Suggestions */}
                      <Text style={styles.suggestionsTitle}>💡 Quick Idea Starters:</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsRow}>
                        {PROMPT_SUGGESTIONS.map((suggestion, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={styles.suggestionChip}
                            onPress={() => {
                              setCustomPrompt(suggestion);
                              setSelectedConcept(null);
                            }}
                          >
                            <Text style={styles.suggestionText}>{suggestion}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Mode 2: 📸 Book Photo / Screenshot */}
                  {createMode === "image" && (
                    <View style={styles.uploadDropCard}>
                      <Text style={styles.creatorCardTitle}>📸 Snap a Storybook Page</Text>
                      <Text style={styles.uploadSubtext}>
                        Take a photo of any storybook page, children's poem, or screenshot. Our AI will turn it into a soothing bedtime audio story!
                      </Text>

                      {selectedImage ? (
                        <View style={styles.imagePreviewBox}>
                          <Image
                            source={{ uri: selectedImage.uri }}
                            style={styles.imageThumbnail}
                            resizeMode="cover"
                          />
                          <View style={styles.imagePreviewMeta}>
                            <Text style={styles.imagePreviewTitle}>📖 Page Captured!</Text>
                            <Text style={styles.imagePreviewSub}>Ready to transform into bedtime tale</Text>
                            <TouchableOpacity
                              style={styles.changeFileButton}
                              onPress={() => setSelectedImage(null)}
                            >
                              <Text style={styles.changeFileButtonText}>✕ Remove / Retake</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.uploadActionButtonsRow}>
                          <TouchableOpacity
                            style={styles.primaryUploadButton}
                            onPress={handleTakePhoto}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.uploadButtonEmoji}>📷</Text>
                            <Text style={styles.uploadButtonTitle}>Take Photo</Text>
                            <Text style={styles.uploadButtonSub}>Snap from book</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.secondaryUploadButton}
                            onPress={handlePickImage}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.uploadButtonEmoji}>🖼️</Text>
                            <Text style={styles.uploadButtonTitle}>Choose Photo</Text>
                            <Text style={styles.uploadButtonSub}>From gallery</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Mode 3: 📁 Upload File (PDF, TXT, DOC) */}
                  {createMode === "file" && (
                    <View style={styles.uploadDropCard}>
                      <Text style={styles.creatorCardTitle}>📁 Upload Story File</Text>
                      <Text style={styles.uploadSubtext}>
                        Select a children's book PDF, text file (.txt), or reading document. We will read it and weave it into a gentle bedtime tale.
                      </Text>

                      {selectedPdf ? (
                        <View style={styles.pdfPreviewBox}>
                          <Text style={styles.pdfIconLarge}>📑</Text>
                          <View style={styles.pdfMeta}>
                            <Text style={styles.pdfName} numberOfLines={1}>
                              {selectedPdf.name || "Story Document"}
                            </Text>
                            <Text style={styles.pdfSize}>
                              {selectedPdf.size ? `${(selectedPdf.size / 1024).toFixed(1)} KB` : "File Ready"}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.changeFileButtonSmall}
                            onPress={() => setSelectedPdf(null)}
                          >
                            <Text style={styles.changeFileButtonText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.pdfUploadFullButton}
                          onPress={handlePickFile}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.pdfUploadEmoji}>📂</Text>
                          <Text style={styles.pdfUploadTitle}>Select Document File</Text>
                          <Text style={styles.pdfUploadSub}>Supports PDF, Text (.txt), and readable files</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* Mode 4: 🔍 Search Story Ideas & Database */}
                  {createMode === "search" && (
                    <View style={styles.creatorCard}>
                      <Text style={styles.creatorCardTitle}>🎨 What should this story be about?</Text>
                      <TextInput
                        style={styles.creatorInput}
                        placeholder="e.g. A sleepy baby otter floating under starry night waves..."
                        placeholderTextColor={colors.textDim}
                        value={customPrompt}
                        onChangeText={(txt) => {
                          setCustomPrompt(txt);
                          setSelectedConcept(null);
                        }}
                      />

                      {/* Search / Explore Button */}
                      <TouchableOpacity
                        style={[styles.searchIdeasButton, !customPrompt.trim() && styles.searchIdeasButtonDisabled]}
                        onPress={handleSearchConcepts}
                        disabled={isSearchingConcepts || !customPrompt.trim()}
                        activeOpacity={0.8}
                      >
                        {isSearchingConcepts ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.searchIdeasButtonText}>🔍 Explore Ideas</Text>
                        )}
                      </TouchableOpacity>

                      {/* Search Results Display */}
                      {conceptResults.length > 0 && (
                        <View style={styles.conceptResultsSection}>
                          <Text style={styles.conceptSectionTitle}>📖 Select Your Story Concept:</Text>
                          {conceptResults.map((concept, idx) => {
                            const isSelected =
                              selectedConcept?.title === concept.title ||
                              (selectedConcept?.id && selectedConcept.id === concept.id);
                            return (
                              <TouchableOpacity
                                key={concept.id || idx}
                                style={[styles.conceptCard, isSelected && styles.conceptCardSelected]}
                                onPress={() => setSelectedConcept(concept)}
                                activeOpacity={0.85}
                              >
                                <View style={styles.conceptCardTop}>
                                  <Text style={[styles.conceptCardTitle, isSelected && styles.conceptCardTitleSelected]}>
                                    {concept.title}
                                  </Text>
                                  {isSelected && (
                                    <View style={styles.selectedPill}>
                                      <Text style={styles.selectedPillText}>✓ Selected</Text>
                                    </View>
                                  )}
                                </View>
                                <Text style={styles.conceptCardTeaser}>{concept.teaser}</Text>
                                {concept.ambient_sound ? (
                                  <View style={styles.ambientBadgeSmall}>
                                    <Text style={styles.ambientBadgeSmallText}>
                                      {concept.ambient_sound.icon} {concept.ambient_sound.name}
                                    </Text>
                                  </View>
                                ) : null}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}

                  {/* Step 3: Narrator Voice Picker */}
                  <View style={styles.narratorSection}>
                    <Text style={styles.narratorSectionTitle}>🎙️ 3. Choose Storyteller Narrator</Text>
                    <Text style={styles.narratorSectionSubtitle}>
                      Select your favorite soothing bedtime voice persona
                    </Text>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceCarousel}>
                      {narratorVoices.map((voice) => {
                        const isSelected = selectedVoiceId === voice.id;
                        const isPreviewing = previewingVoiceId === voice.id;
                        return (
                          <TouchableOpacity
                            key={voice.id}
                            style={[styles.voiceCard, isSelected && styles.voiceCardActive]}
                            onPress={() => handleSelectVoice(voice.id)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.voiceEmoji}>{voice.icon || "🌙"}</Text>
                            <Text style={[styles.voiceName, isSelected && styles.voiceNameActive]}>
                              {voice.name}
                            </Text>
                            <Text style={styles.voiceTone}>{voice.tone}</Text>

                            {/* Sample Preview Button */}
                            <TouchableOpacity
                              style={[styles.sampleBtn, isPreviewing && styles.sampleBtnActive]}
                              onPress={() => handlePlayVoicePreview(voice.id)}
                              disabled={previewLoading}
                            >
                              {previewLoading && previewingVoiceId === voice.id ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.sampleBtnText}>
                                  {isPreviewing ? "⏸ Stop" : "▶ Sample"}
                                </Text>
                              )}
                            </TouchableOpacity>

                            {isSelected && <Text style={styles.activeCheckmark}>✓ Selected</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {accents.length > 0 && (
                      <>
                        <Text style={styles.accentSectionLabel}>Accent</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accentCarousel}>
                          {accents.map((accent) => (
                            <TouchableOpacity
                              key={accent.id}
                              style={[styles.accentPill, selectedAccentId === accent.id && styles.accentPillActive]}
                              onPress={() => setSelectedAccentId(accent.id)}
                            >
                              <Text style={styles.accentPillIcon}>{accent.flag || "🌍"}</Text>
                              <Text style={[styles.accentPillText, selectedAccentId === accent.id && styles.accentPillTextActive]}>
                                {accent.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </>
                    )}
                  </View>

                  {/* Step 4: Generate & Narrate CTA Button */}
                  <TouchableOpacity
                    style={[
                      styles.generateButton,
                      (createMode === "text" && !customPrompt.trim()) && styles.generateButtonDisabled,
                      (createMode === "image" && !selectedImage) && styles.generateButtonDisabled,
                      (createMode === "file" && !selectedPdf) && styles.generateButtonDisabled,
                      (createMode === "search" && !selectedConcept && !customPrompt.trim()) && styles.generateButtonDisabled,
                      newStoryRemaining <= 0 && styles.generateButtonDisabled,
                    ]}
                    onPress={handleGenerateCustomStory}
                    disabled={
                      isGenerating ||
                      newStoryRemaining <= 0 ||
                      (createMode === "text" && !customPrompt.trim()) ||
                      (createMode === "image" && !selectedImage) ||
                      (createMode === "file" && !selectedPdf) ||
                      (createMode === "search" && !selectedConcept && !customPrompt.trim())
                    }
                    activeOpacity={0.85}
                  >
                    <Text style={styles.generateButtonText}>
                      {newStoryRemaining > 0
                        ? createMode === "image"
                          ? "✨ Transform Book Photo into Bedtime Story"
                          : createMode === "file"
                          ? "✨ Transform Document File into Bedtime Story"
                          : createMode === "search" && selectedConcept
                          ? `✨ Weave & Narrate "${selectedConcept.title.slice(0, 24)}..."`
                          : "✨ Generate & Narrate Bedtime Story"
                        : `⚠️ Monthly Limit Reached (0/${newStoryLimit})`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* ══════════════════════════════════════════════ */}
          {/* SECTION 3: 🎙️ VOICE CLONED STORY              */}
          {/* ══════════════════════════════════════════════ */}
          <TouchableOpacity
            style={[styles.accordionHeader, openSection === "cloned" && styles.accordionHeaderActive]}
            onPress={() => toggleSection("cloned")}
            activeOpacity={0.85}
          >
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionHeaderEmoji}>🎙️</Text>
              <View>
                <Text style={styles.accordionHeaderTitle}>Voice Cloned Story</Text>
                <Text style={styles.accordionHeaderSub}>Hear stories in Mom or Dad's voice</Text>
              </View>
            </View>
            <View style={styles.accordionHeaderRight}>
              {subStatus?.can_clone_voices && (
                <View style={[styles.quotaPill, cloneRemaining === 0 && styles.quotaPillZero]}>
                  <Text style={styles.quotaPillText}>{cloneRemaining}/{cloneLimit}</Text>
                </View>
              )}
              <Text style={styles.accordionChevron}>
                {openSection === "cloned" ? "▼" : "▶"}
              </Text>
            </View>
          </TouchableOpacity>

          {openSection === "cloned" && (
          <View style={[styles.tabContent, styles.accordionBody]}>
              {!subStatus?.can_clone_voices ? (
                <View style={styles.lockedFeatureCard}>
                  <Text style={styles.lockedEmoji}>🎙️ 🔒</Text>
                  <Text style={styles.lockedTitle}>Parent Voice Cloning</Text>
                  <Text style={styles.lockedSubtitle}>
                    Narrating bedtime stories in Mom or Dad's cloned voice is a Pro feature (₹{subStatus?.pro_plan_price_inr || 219}/month) — not included in Normal.
                  </Text>
                  <View style={styles.lockedBenefitsList}>
                    <Text style={styles.lockedBenefitItem}>🎙️ 4 Full Parent Voice Narrations every month (up to ~3 min / 2,430 characters each)</Text>
                    <Text style={styles.lockedBenefitItem}>🌙 Comforting voice when parents travel or work late</Text>
                    <Text style={styles.lockedBenefitItem}>🌲 Background HD soundscapes mixed automatically</Text>
                  </View>
                  <TouchableOpacity style={styles.lockedUpgradeBtn} onPress={onGoToUpgrade}>
                    <Text style={styles.lockedUpgradeBtnText}>👑 Unlock Voice Cloning (Pro, ₹{subStatus?.pro_plan_price_inr || 219}/mo)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.lockedExploreBtn} onPress={() => {}}>
                    <Text style={styles.lockedExploreBtnText}>🎧 Scroll up to Library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Quota Banner */}
                  <View style={styles.quotaBanner}>
                    <View style={styles.quotaBannerLeft}>
                      <Text style={styles.quotaBannerTitle}>🎙️ Parent Voice Narrations</Text>
                      <Text style={styles.quotaBannerSubtitle}>
                        {cloneRemaining} of {cloneLimit} parent voice stories remaining this month
                      </Text>
                    </View>
                    <View style={styles.quotaProgressBox}>
                      <View
                        style={[
                          styles.quotaProgressBar,
                          { width: `${Math.min(100, (cloneRemaining / cloneLimit) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>

                  {/* Parent Voice Selector */}
                  {voiceClones.length === 0 ? (
                    <View style={styles.noClonesBox}>
                      <Text style={styles.noClonesEmoji}>🎙️</Text>
                      <Text style={styles.noClonesTitle}>No Parent Voice Recorded Yet</Text>
                      <Text style={styles.noClonesText}>
                        Record a 30-second reading sample so your child can hear bedtime stories in Dad or Mom's voice.
                      </Text>
                      <TouchableOpacity style={styles.upgradeCloneBtn} onPress={onGoToUpgrade}>
                        <Text style={styles.upgradeCloneBtnText}>➕ Set Up Parent Voice Clone</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.clonePickerContainer}>
                      <Text style={styles.clonePickerTitle}>Select Parent Voice:</Text>
                      <View style={styles.clonePillsRow}>
                        {voiceClones.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.clonePill, selectedCloneId === c.id && styles.clonePillActive]}
                            onPress={() => setSelectedCloneId(c.id)}
                          >
                            <Text
                              style={[
                                styles.clonePillText,
                                selectedCloneId === c.id && styles.clonePillTextActive,
                              ]}
                            >
                              👤 {c.display_name || "Parent"}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Parent Voice Sourcing Pills */}
                  <View style={styles.createModePillsContainer}>
                    <TouchableOpacity
                      style={[styles.createModePill, cloneSourceMode === "library" && styles.createModePillActive]}
                      onPress={() => {
                        setCloneSourceMode("library");
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, cloneSourceMode === "library" && styles.createModePillTextActive]}>
                        📚 From Library
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, cloneSourceMode === "text" && styles.createModePillActive]}
                      onPress={() => {
                        setCloneSourceMode("text");
                        setSelectedCloneConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, cloneSourceMode === "text" && styles.createModePillTextActive]}>
                        ✍️ Write
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, cloneSourceMode === "image" && styles.createModePillActive]}
                      onPress={() => {
                        setCloneSourceMode("image");
                        setSelectedCloneConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, cloneSourceMode === "image" && styles.createModePillTextActive]}>
                        📸 Book Photo
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, cloneSourceMode === "file" && styles.createModePillActive]}
                      onPress={() => {
                        setCloneSourceMode("file");
                        setSelectedCloneConcept(null);
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, cloneSourceMode === "file" && styles.createModePillTextActive]}>
                        📁 Upload File
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.createModePill, cloneSourceMode === "search" && styles.createModePillActive]}
                      onPress={() => {
                        setCloneSourceMode("search");
                        setError(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.createModePillText, cloneSourceMode === "search" && styles.createModePillTextActive]}>
                        🔍 Search
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* SUB-MODE 1: 📚 Pick from Existing Library Stories */}
                  {cloneSourceMode === "library" && (
                    <View style={{ marginTop: 6 }}>
                      <Text style={styles.sectionTitle}>Pick a Story to Narrate in Your Voice:</Text>
                      {stories.map((story) => (
                        <View key={story.id} style={styles.storyCard}>
                          <Text style={styles.storyCardTitle}>{story.title}</Text>
                          <Text style={styles.storyCardTeaser}>{story.teaser}</Text>
                          <TouchableOpacity
                            style={[
                              styles.listenNowButton,
                              (voiceClones.length === 0 || cloneRemaining <= 0) && styles.listenNowButtonDisabled,
                            ]}
                            onPress={() => handleNarrateClonedStory(story)}
                            disabled={voiceClones.length === 0 || cloneRemaining <= 0}
                          >
                            <Text style={styles.listenNowText}>
                              {cloneRemaining > 0
                                ? `🎙️ Narrate in ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Voice`
                                : `⚠️ Monthly Limit Reached (0/${cloneLimit})`}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* SUB-MODE 2: ✍️ Write Story Direct in Parent Voice */}
                  {cloneSourceMode === "text" && (
                    <View style={styles.creatorCard}>
                      <Text style={styles.creatorCardTitle}>
                        📝 Write Story for {voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"} to Narrate:
                      </Text>
                      <Text style={styles.uploadSubtext}>
                        Describe an adventure, family memory, or gentle bedtime moral. We'll weave it and narrate in your voice!
                      </Text>
                      <TextInput
                        style={[styles.creatorInput, { minHeight: 90, textAlignVertical: "top" }]}
                        placeholder="e.g. Advik and Dad build a cozy secret treehouse under the starry sky..."
                        placeholderTextColor={colors.textDim}
                        value={clonePrompt}
                        onChangeText={(txt) => {
                          setClonePrompt(txt);
                          setSelectedCloneConcept(null);
                        }}
                        multiline
                        numberOfLines={4}
                      />

                      {/* Prompt Suggestions */}
                      <Text style={styles.suggestionsTitle}>💡 Quick Idea Starters:</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsRow}>
                        {PROMPT_SUGGESTIONS.map((suggestion, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={styles.suggestionChip}
                            onPress={() => {
                              setClonePrompt(suggestion);
                              setSelectedCloneConcept(null);
                            }}
                          >
                            <Text style={styles.suggestionText}>{suggestion}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>

                      {/* Action CTA */}
                      <TouchableOpacity
                        style={[
                          styles.generateButton,
                          (!clonePrompt.trim() || voiceClones.length === 0 || cloneRemaining <= 0) && styles.generateButtonDisabled,
                        ]}
                        onPress={handleGenerateClonedCustomStory}
                        disabled={!clonePrompt.trim() || voiceClones.length === 0 || cloneRemaining <= 0 || isGenerating}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.generateButtonText}>
                          {cloneRemaining > 0
                            ? `✨ Weave & Narrate in ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Voice`
                            : `⚠️ Monthly Limit Reached (0/${cloneLimit})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* SUB-MODE 3: 📸 Book Photo in Parent Voice */}
                  {cloneSourceMode === "image" && (
                    <View style={styles.uploadDropCard}>
                      <Text style={styles.creatorCardTitle}>📸 Snap a Storybook Page</Text>
                      <Text style={styles.uploadSubtext}>
                        Take a photo of any children's book. {voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s voice will read it as a soothing bedtime tale!
                      </Text>

                      {cloneImage ? (
                        <View style={styles.imagePreviewBox}>
                          <Image
                            source={{ uri: cloneImage.uri }}
                            style={styles.imageThumbnail}
                            resizeMode="cover"
                          />
                          <View style={styles.imagePreviewMeta}>
                            <Text style={styles.imagePreviewTitle}>📖 Page Captured!</Text>
                            <Text style={styles.imagePreviewSub}>Ready to narrate in your voice</Text>
                            <TouchableOpacity
                              style={styles.changeFileButton}
                              onPress={() => setCloneImage(null)}
                            >
                              <Text style={styles.changeFileButtonText}>✕ Remove / Retake</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.uploadActionButtonsRow}>
                          <TouchableOpacity
                            style={styles.primaryUploadButton}
                            onPress={handleTakeClonePhoto}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.uploadButtonEmoji}>📷</Text>
                            <Text style={styles.uploadButtonTitle}>Take Photo</Text>
                            <Text style={styles.uploadButtonSub}>Snap from book</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.secondaryUploadButton}
                            onPress={handlePickCloneImage}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.uploadButtonEmoji}>🖼️</Text>
                            <Text style={styles.uploadButtonTitle}>Choose Photo</Text>
                            <Text style={styles.uploadButtonSub}>From gallery</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Action CTA */}
                      <TouchableOpacity
                        style={[
                          styles.generateButton,
                          (!cloneImage || voiceClones.length === 0 || cloneRemaining <= 0) && styles.generateButtonDisabled,
                        ]}
                        onPress={handleGenerateClonedCustomStory}
                        disabled={!cloneImage || voiceClones.length === 0 || cloneRemaining <= 0 || isGenerating}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.generateButtonText}>
                          {cloneRemaining > 0
                            ? `✨ Transform Book Photo into ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Bedtime Story`
                            : `⚠️ Monthly Limit Reached (0/${cloneLimit})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* SUB-MODE 4: 📁 Upload File in Parent Voice */}
                  {cloneSourceMode === "file" && (
                    <View style={styles.uploadDropCard}>
                      <Text style={styles.creatorCardTitle}>📁 Upload Story File</Text>
                      <Text style={styles.uploadSubtext}>
                        Select a children's book PDF, text file (.txt), or reading document to narrate in your voice.
                      </Text>

                      {cloneFile ? (
                        <View style={styles.pdfPreviewBox}>
                          <Text style={styles.pdfIconLarge}>📑</Text>
                          <View style={styles.pdfMeta}>
                            <Text style={styles.pdfName} numberOfLines={1}>
                              {cloneFile.name || "Story Document"}
                            </Text>
                            <Text style={styles.pdfSize}>
                              {cloneFile.size ? `${(cloneFile.size / 1024).toFixed(1)} KB` : "File Ready"}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.changeFileButtonSmall}
                            onPress={() => setCloneFile(null)}
                          >
                            <Text style={styles.changeFileButtonText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.pdfUploadFullButton}
                          onPress={handlePickCloneFile}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.pdfUploadEmoji}>📂</Text>
                          <Text style={styles.pdfUploadTitle}>Select Document File</Text>
                          <Text style={styles.pdfUploadSub}>Supports PDF, Text (.txt), and readable files</Text>
                        </TouchableOpacity>
                      )}

                      {/* Action CTA */}
                      <TouchableOpacity
                        style={[
                          styles.generateButton,
                          (!cloneFile || voiceClones.length === 0 || cloneRemaining <= 0) && styles.generateButtonDisabled,
                        ]}
                        onPress={handleGenerateClonedCustomStory}
                        disabled={!cloneFile || voiceClones.length === 0 || cloneRemaining <= 0 || isGenerating}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.generateButtonText}>
                          {cloneRemaining > 0
                            ? `✨ Transform File into ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Bedtime Story`
                            : `⚠️ Monthly Limit Reached (0/${cloneLimit})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* SUB-MODE 5: 🔍 Search Story Ideas in Parent Voice */}
                  {cloneSourceMode === "search" && (
                    <View style={styles.creatorCard}>
                      <Text style={styles.creatorCardTitle}>🎨 What should this story be about?</Text>
                      <TextInput
                        style={styles.creatorInput}
                        placeholder="e.g. A sleepy baby dragon and Dad counting stars..."
                        placeholderTextColor={colors.textDim}
                        value={clonePrompt}
                        onChangeText={(txt) => {
                          setClonePrompt(txt);
                          setSelectedCloneConcept(null);
                        }}
                      />

                      <TouchableOpacity
                        style={[styles.searchIdeasButton, !clonePrompt.trim() && styles.searchIdeasButtonDisabled]}
                        onPress={handleSearchCloneConcepts}
                        disabled={isSearchingCloneConcepts || !clonePrompt.trim()}
                        activeOpacity={0.8}
                      >
                        {isSearchingCloneConcepts ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.searchIdeasButtonText}>🔍 Explore Ideas</Text>
                        )}
                      </TouchableOpacity>

                      {cloneConceptResults.length > 0 && (
                        <View style={styles.conceptResultsSection}>
                          <Text style={styles.conceptSectionTitle}>📖 Select Your Story Concept:</Text>
                          {cloneConceptResults.map((concept, idx) => {
                            const isSelected =
                              selectedCloneConcept?.title === concept.title ||
                              (selectedCloneConcept?.id && selectedCloneConcept.id === concept.id);
                            return (
                              <TouchableOpacity
                                key={concept.id || idx}
                                style={[styles.conceptCard, isSelected && styles.conceptCardSelected]}
                                onPress={() => setSelectedCloneConcept(concept)}
                                activeOpacity={0.85}
                              >
                                <View style={styles.conceptCardTop}>
                                  <Text style={[styles.conceptCardTitle, isSelected && styles.conceptCardTitleSelected]}>
                                    {concept.title}
                                  </Text>
                                  {isSelected && (
                                    <View style={styles.selectedPill}>
                                      <Text style={styles.selectedPillText}>✓ Selected</Text>
                                    </View>
                                  )}
                                </View>
                                <Text style={styles.conceptCardTeaser}>{concept.teaser}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}

                      {/* Action CTA */}
                      <TouchableOpacity
                        style={[
                          styles.generateButton,
                          (!selectedCloneConcept && !clonePrompt.trim() || voiceClones.length === 0 || cloneRemaining <= 0) &&
                            styles.generateButtonDisabled,
                        ]}
                        onPress={handleGenerateClonedCustomStory}
                        disabled={
                          (!selectedCloneConcept && !clonePrompt.trim()) ||
                          voiceClones.length === 0 ||
                          cloneRemaining <= 0 ||
                          isGenerating
                        }
                        activeOpacity={0.85}
                      >
                        <Text style={styles.generateButtonText}>
                          {cloneRemaining > 0
                            ? selectedCloneConcept
                              ? `✨ Weave & Narrate "${selectedCloneConcept.title.slice(0, 20)}..." in ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Voice`
                              : `✨ Weave & Narrate in ${voiceClones.find((c) => c.id === selectedCloneId)?.display_name || "Parent"}'s Voice`
                            : `⚠️ Monthly Limit Reached (0/${cloneLimit})`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Replay Previously Cloned Stories in Parent's Voice */}
                  {generatedHistory.filter(
                    (h) => h.origin === "cloned" || h.voice_tier === "cloned" || h.narrator_icon === "🎙️"
                  ).length > 0 && (
                    <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255, 255, 255, 0.08)" }}>
                      <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>
                        🎧 Replay Bedtime Stories in Parent Voice ({generatedHistory.filter(
                          (h) => h.origin === "cloned" || h.voice_tier === "cloned" || h.narrator_icon === "🎙️"
                        ).length}):
                      </Text>
                      {generatedHistory
                        .filter(
                          (h) => h.origin === "cloned" || h.voice_tier === "cloned" || h.narrator_icon === "🎙️"
                        )
                        .map((item, idx) => (
                          <View key={idx} style={styles.storyCard}>
                            <View style={styles.storyCardTop}>
                              <Text style={styles.storyCardTitle}>{item.title}</Text>
                              <View style={styles.cloneBadge}>
                                <Text style={styles.cloneBadgeText}>🎙️ Cloned</Text>
                              </View>
                            </View>
                            <Text style={styles.storyCardTeaser}>{item.teaser}</Text>
                            <View style={styles.storyCardBottom}>
                              <Text style={styles.durationTag}>
                                ⏱️ {item.duration_seconds ? `${Math.round(item.duration_seconds / 60)} mins` : "5-7 mins"}
                              </Text>
                              <TouchableOpacity
                                style={styles.listenNowButton}
                                onPress={() => onPlayStory({ ...item, mode: "audio_only" })}
                              >
                                <Text style={styles.listenNowText}>▶️ Replay</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {/* ══════════════════════════════════════════════ */}
          {/* SECTION 4: 📖 HISTORY                         */}
          {/* ══════════════════════════════════════════════ */}
          <TouchableOpacity
            style={[styles.accordionHeader, openSection === "history" && styles.accordionHeaderActive]}
            onPress={() => toggleSection("history")}
            activeOpacity={0.85}
          >
            <View style={styles.accordionHeaderLeft}>
              <Text style={styles.accordionHeaderEmoji}>📖</Text>
              <View>
                <Text style={styles.accordionHeaderTitle}>History</Text>
                <Text style={styles.accordionHeaderSub}>All your previously played stories</Text>
              </View>
            </View>
            <View style={styles.accordionHeaderRight}>
              {generatedHistory.length > 0 && (
                <View style={styles.historyCountBadge}>
                  <Text style={styles.historyCountBadgeText}>{generatedHistory.length}</Text>
                </View>
              )}
              <Text style={styles.accordionChevron}>
                {openSection === "history" ? "▼" : "▶"}
              </Text>
            </View>
          </TouchableOpacity>

          {openSection === "history" && (
          <View style={[styles.tabContent, styles.accordionBody]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>📚 Bedtime History ({generatedHistory.length})</Text>
              </View>

              {loadingHistory ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
              ) : generatedHistory.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyEmoji}>📖</Text>
                  <Text style={styles.emptyTitle}>No bedtime history yet</Text>
                  <Text style={styles.emptyText}>
                    All stories you listen to from the Library, AI Generator, or Parent Voice Clones will appear here for 1-tap bedtime replay!
                  </Text>
                  <TouchableOpacity
                    style={[styles.listenNowButton, { marginTop: 16 }]}
                    onPress={() => {}}
                  >
                    <Text style={styles.listenNowText}>🎧 Scroll up to Library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                generatedHistory.map((item, idx) => {
                  const isCloned = item.voice_tier === "cloned" || item.origin === "cloned" || item.narrator_icon === "🎙️";
                  const isLibrary = item.voice_tier === "library" || item.origin === "library";

                  return (
                    <View key={idx} style={styles.storyCard}>
                      <View style={styles.storyCardTop}>
                        <Text style={styles.storyCardTitle}>{item.title}</Text>
                        {isCloned ? (
                          <View style={styles.cloneBadge}>
                            <Text style={styles.cloneBadgeText}>🎙️ Voice Cloned</Text>
                          </View>
                        ) : isLibrary ? (
                          <View style={styles.libraryBadge}>
                            <Text style={styles.libraryBadgeText}>🎧 Library Story</Text>
                          </View>
                        ) : (
                          <View style={styles.aiBadge}>
                            <Text style={styles.aiBadgeText}>
                              ✨ AI Voice ({item.narrator_name || "Luna"})
                            </Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.storyCardTeaser}>{item.teaser}</Text>

                      <View style={styles.storyCardBottom}>
                        <View style={styles.historyMetaRow}>
                          <Text style={styles.durationTag}>
                            ⏱️ {item.duration_seconds ? `${Math.round(item.duration_seconds / 60)} mins` : "5-7 mins"}
                          </Text>
                          {item.ambient_sound ? (
                            <Text style={styles.ambientHistoryTag}>
                              {item.ambient_sound.icon} {item.ambient_sound.name}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={styles.listenNowButton}
                          onPress={() => onPlayStory({ ...item, mode: "audio_only" })}
                        >
                          <Text style={styles.listenNowText}>▶️ Replay Story</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* MONTHLY LIMIT REACHED MODAL */}
      <Modal visible={showLimitModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>
              {limitModalType === "generate" ? "✨" : "🎙️"}
            </Text>
            <Text style={styles.modalTitle}>Monthly Limit Over</Text>
            <Text style={styles.modalBody}>
              {limitModalType === "generate"
                ? `You've completed all ${newStoryLimit} custom story generations for this month.\n\nYou can continue enjoying unlimited pre-created stories in the library!`
                : `You've used your ${cloneLimit} monthly parent voice-clone narrations.\n\nYour limit resets at the start of next month.`}
            </Text>
            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => setShowLimitModal(false)}
            >
              <Text style={styles.modalPrimaryBtnText}>🎧 Explore Story Library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowLimitModal(false)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  backButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  headerInfo: {
    alignItems: "center",
  },
  ageBadge: {
    color: colors.sliderThumb,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  categoryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  historyNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(147, 51, 234, 0.15)",
  },
  historyNavText: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Accordion Layout Styles ──────────────────────────────
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 50,
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(109, 40, 217, 0.2)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.25)",
    borderLeftWidth: 4,
    borderLeftColor: "#a855f7",
    marginTop: 10,
    marginBottom: 4,
  },
  accordionHeaderActive: {
    backgroundColor: "rgba(109, 40, 217, 0.38)",
    borderColor: "rgba(192, 132, 252, 0.5)",
    borderLeftColor: "#c084fc",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginBottom: 0,
  },
  accordionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  accordionHeaderEmoji: {
    fontSize: 22,
    marginRight: 12,
  },
  accordionHeaderTitle: {
    color: "#f3e8ff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  accordionHeaderSub: {
    color: "rgba(216, 180, 254, 0.7)",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  accordionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  accordionChevron: {
    fontSize: 14,
    color: "#c084fc",
    fontWeight: "800",
    paddingHorizontal: 4,
  },
  accordionBody: {
    backgroundColor: "rgba(15, 8, 38, 0.5)",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "rgba(168, 85, 247, 0.25)",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  historyCountBadge: {
    backgroundColor: "rgba(168, 85, 247, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(192, 132, 252, 0.4)",
  },
  historyCountBadgeText: {
    color: "#f3e8ff",
    fontSize: 11,
    fontWeight: "700",
  },
  // ─────────────────────────────────────────────────────────

  trialBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(147, 51, 234, 0.18)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(147, 51, 234, 0.35)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  trialBannerExpired: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderBottomColor: "rgba(239, 68, 68, 0.35)",
  },
  trialBannerLeft: {
    flex: 1,
    marginRight: 10,
  },
  trialBannerTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 2,
  },
  trialBannerSubtitle: {
    color: colors.sliderThumb,
    fontSize: 11,
    fontWeight: "600",
  },
  trialUpgradeBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  trialUpgradeBtnGlow: {
    backgroundColor: "#10b981",
  },
  trialUpgradeBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  adminBanner: {
    backgroundColor: "rgba(147, 51, 234, 0.25)",
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: "center",
  },
  adminBannerText: {
    color: "#e9d5ff",
    fontSize: 12,
    fontWeight: "800",
  },
  premiumBanner: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 129, 0.3)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
  },
  premiumBannerText: {
    color: "#34d399",
    fontSize: 12,
    fontWeight: "800",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.card,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    gap: 4,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
  },
  tabButtonText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  tabButtonTextActive: {
    color: "#fff",
  },
  quotaPill: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  quotaPillZero: {
    backgroundColor: "rgba(239, 68, 68, 0.5)",
  },
  quotaPillText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
  lockedPill: {
    backgroundColor: "rgba(236, 72, 153, 0.25)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(236, 72, 153, 0.4)",
  },
  lockedPillText: {
    color: "#f472b6",
    fontSize: 8,
    fontWeight: "800",
  },
  lockedFeatureCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.35)",
    marginTop: 10,
    marginBottom: 20,
  },
  lockedEmoji: {
    fontSize: 44,
    marginBottom: 10,
  },
  lockedTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
  },
  lockedSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 16,
  },
  lockedBenefitsList: {
    width: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    gap: 8,
  },
  lockedBenefitItem: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  lockedUpgradeBtn: {
    width: "100%",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 10,
  },
  lockedUpgradeBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  lockedExploreBtn: {
    paddingVertical: 8,
  },
  lockedExploreBtnText: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "700",
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 60,
  },
  tabContent: {
    width: "100%",
  },
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  searchClear: {
    color: colors.textDim,
    fontSize: 16,
    paddingHorizontal: 6,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  storyCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 14,
  },
  storyCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  storyCardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginRight: 8,
  },
  sortChipsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  sortChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  sortChipActive: {
    backgroundColor: "rgba(147, 51, 234, 0.2)",
    borderColor: colors.sliderThumb,
  },
  sortChipText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  sortChipTextActive: {
    color: colors.sliderThumb,
    fontWeight: "700",
  },
  cardBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  favBadgeBtn: {
    padding: 3,
  },
  favBadgeIcon: {
    fontSize: 14,
  },
  ratingBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingBadgeText: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "700",
  },
  ambientBadge: {
    backgroundColor: "rgba(147, 51, 234, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  ambientBadgeText: {
    color: colors.sliderThumb,
    fontSize: 11,
    fontWeight: "700",
  },
  libraryBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  libraryBadgeText: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "800",
  },
  cloneBadge: {
    backgroundColor: "rgba(236, 72, 153, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(236, 72, 153, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  cloneBadgeText: {
    color: "#f472b6",
    fontSize: 11,
    fontWeight: "800",
  },
  aiBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  aiBadgeText: {
    color: "#60a5fa",
    fontSize: 11,
    fontWeight: "800",
  },
  storyCardTeaser: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  storyCardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  durationTag: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  ambientHistoryTag: {
    color: colors.sliderThumb,
    fontSize: 11,
    fontWeight: "600",
  },
  listenNowButton: {
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  listenNowButtonDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  listenNowText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  quotaBanner: {
    backgroundColor: "rgba(147, 51, 234, 0.12)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.3)",
    marginBottom: 18,
  },
  quotaBannerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  quotaBannerSubtitle: {
    color: colors.sliderThumb,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 10,
  },
  quotaProgressBox: {
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 3,
    overflow: "hidden",
  },
  quotaProgressBar: {
    height: "100%",
    backgroundColor: colors.sliderThumb,
    borderRadius: 3,
  },
  creatorCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 18,
  },
  creatorCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  creatorInput: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 65,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  searchIdeasButton: {
    backgroundColor: "rgba(147, 51, 234, 0.25)",
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  searchIdeasButtonDisabled: {
    opacity: 0.5,
  },
  searchIdeasButtonText: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "700",
  },
  suggestionsTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
  },
  suggestionsRow: {
    flexDirection: "row",
  },
  suggestionChip: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    marginRight: 8,
  },
  suggestionText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  conceptResultsSection: {
    marginBottom: 20,
  },
  conceptSectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  conceptCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 10,
  },
  conceptCardSelected: {
    borderColor: colors.sliderThumb,
    backgroundColor: "rgba(147, 51, 234, 0.16)",
  },
  conceptCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  conceptCardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  conceptCardTitleSelected: {
    color: colors.sliderThumb,
  },
  selectedPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  selectedPillText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  conceptCardTeaser: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  ambientBadgeSmall: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ambientBadgeSmallText: {
    color: colors.textDim,
    fontSize: 10,
  },
  narratorSection: {
    marginBottom: 20,
  },
  narratorSectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  narratorSectionSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 12,
  },
  voiceCarousel: {
    flexDirection: "row",
  },
  accentSectionLabel: {
    color: colors.textSecondary || "#9ba1ba",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  accentCarousel: {
    flexDirection: "row",
  },
  accentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginRight: 10,
  },
  accentPillActive: {
    borderColor: colors.sliderThumb,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
  },
  accentPillIcon: {
    fontSize: 14,
  },
  accentPillText: {
    color: "#d0d4e3",
    fontSize: 12,
    fontWeight: "600",
  },
  accentPillTextActive: {
    color: colors.sliderThumb,
  },
  voiceCard: {
    width: 140,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginRight: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  voiceCardActive: {
    borderColor: colors.sliderThumb,
    backgroundColor: "rgba(147, 51, 234, 0.18)",
  },
  voiceEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  voiceName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  voiceNameActive: {
    color: colors.sliderThumb,
  },
  voiceTone: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: "center",
    marginBottom: 10,
  },
  sampleBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginBottom: 6,
  },
  sampleBtnActive: {
    backgroundColor: colors.primary,
  },
  sampleBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  activeCheckmark: {
    color: colors.sliderThumb,
    fontSize: 11,
    fontWeight: "800",
  },
  generateButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  generateButtonDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  generateButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  clonePickerContainer: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 18,
  },
  clonePickerTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
  },
  clonePillsRow: {
    flexDirection: "row",
    gap: 8,
  },
  clonePill: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  clonePillActive: {
    backgroundColor: colors.primary,
  },
  clonePillText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  clonePillTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  noClonesBox: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 18,
  },
  noClonesEmoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  noClonesTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },
  noClonesText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
  },
  upgradeCloneBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  upgradeCloneBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 20,
    marginBottom: 8,
    textAlign: "center",
  },
  loadingSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
  },
  modalBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  modalPrimaryBtn: {
    width: "100%",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 8,
  },
  modalPrimaryBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  modalCloseBtn: {
    paddingVertical: 8,
  },
  modalCloseBtnText: {
    color: colors.textDim,
    fontSize: 13,
  },
  // Multimodal Creator Styles
  createModePillsContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.2)",
    gap: 4,
  },
  createModePill: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  createModePillActive: {
    backgroundColor: "rgba(168, 85, 247, 0.35)",
    borderWidth: 1,
    borderColor: "#c084fc",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  createModePillText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  createModePillTextActive: {
    color: "#fff",
    fontWeight: "800",
  },
  uploadDropCard: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "rgba(168, 85, 247, 0.3)",
    borderStyle: "dashed",
  },
  uploadSubtext: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 16,
  },
  uploadActionButtonsRow: {
    flexDirection: "row",
    gap: 12,
  },
  primaryUploadButton: {
    flex: 1,
    backgroundColor: "rgba(147, 51, 234, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.5)",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryUploadButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButtonEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  uploadButtonTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  uploadButtonSub: {
    color: colors.textDim,
    fontSize: 11,
  },
  imagePreviewBox: {
    flexDirection: "row",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    borderRadius: 14,
    padding: 10,
    alignItems: "center",
    gap: 12,
  },
  imageThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  imagePreviewMeta: {
    flex: 1,
  },
  imagePreviewTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  imagePreviewSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginVertical: 4,
  },
  changeFileButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  changeFileButtonSmall: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  changeFileButtonText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "700",
  },
  pdfUploadFullButton: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfUploadEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  pdfUploadTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  pdfUploadSub: {
    color: colors.textDim,
    fontSize: 12,
  },
  pdfPreviewBox: {
    flexDirection: "row",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 12,
  },
  pdfIconLarge: {
    fontSize: 32,
  },
  pdfMeta: {
    flex: 1,
  },
  pdfName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  pdfSize: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
});
