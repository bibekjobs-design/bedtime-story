import React, { useEffect, useState } from "react";
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
import StoryLoadingOverlay from "../components/StoryLoadingOverlay";

// Shows every story that lives inside one category - reached by tapping a
// category tile on the Library screen. Reuses the same /precreated endpoint
// (already supports category_id filtering, including the synthetic "others"
// bucket) that Library's main list uses, just scoped to this one category.
//
// Admin edit/delete mirrors the same capability on the main Library list -
// this is a separate screen file, so it needs its own copy of that logic
// rather than inheriting it.

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

async function uriToBlob(uri) {
  const response = await fetch(uri);
  return await response.blob();
}

export default function CategoryStoriesScreen({
  category,
  activeProfile,
  currentUser,
  onPlayStory,
  onBack,
}) {
  const isAdmin = !!currentUser?.is_admin;

  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [narratingId, setNarratingId] = useState(null);
  const [deletingStoryId, setDeletingStoryId] = useState(null);

  // Admin-only edit flow - same shape as LibraryScreen's: text/cover only,
  // voice/accent/category stay fixed.
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editCoverImage, setEditCoverImage] = useState(null);
  const [editCoverImageUrl, setEditCoverImageUrl] = useState(null);
  const [editRemoveCover, setEditRemoveCover] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    loadStories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id, activeProfile]);

  async function loadStories() {
    if (!category?.id) return;
    setLoading(true);
    try {
      const ageId = activeProfile?.age_group_id || 1;
      const data = await api.getPrecreatedStories(category.id, ageId, 1, "newest");
      setStories(data || []);
    } catch (e) {
      console.warn("Failed to load category stories", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectStory(story) {
    if (narratingId) return;
    if (story.has_audio && story.audio_url && story.full_text) {
      onPlayStory({ ...story, origin: "library" });
      return;
    }
    setNarratingId(story.id);
    try {
      const committed = await api.commitStory(story.id, "standard", "luna");
      onPlayStory({ ...story, ...committed, origin: "library" });
    } catch (e) {
      notifyError(e.message || "Couldn't load this story's narration. Please try again.");
    } finally {
      setNarratingId(null);
    }
  }

  async function handleOpenEdit(story) {
    setEditingStoryId(story.id);
    setEditTitle(story.title || "");
    setEditText("");
    setEditCoverImage(null);
    setEditCoverImageUrl(story.cover_image_url || null);
    setEditRemoveCover(false);
    setShowEditModal(true);
    setLoadingEdit(true);
    try {
      const detail = await api.getStoryAdminDetail(story.id);
      setEditTitle(detail.title || "");
      setEditText(detail.full_text || "");
      setEditCoverImageUrl(detail.cover_image_url || null);
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
      setStories((prev) => prev.map((s) => (s.id === editingStoryId ? { ...s, ...updated } : s)));
      closeEditModal();

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

  function handleDeleteStory(story) {
    const doDelete = async () => {
      setDeletingStoryId(story.id);
      try {
        await api.deleteStory(story.id);
        setStories((prev) => prev.filter((s) => s.id !== story.id));
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

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerIcon}>{category?.icon_url || "📖"}</Text>
          <Text style={styles.titleSerif} numberOfLines={1}>
            {category?.name || "Category"}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {loading ? (
          <ActivityIndicator size="large" color="#f5a623" style={{ marginTop: 50 }} />
        ) : stories.length === 0 ? (
          <Text style={styles.emptyText}>No stories in this category yet.</Text>
        ) : (
          stories.map((story) => (
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
                  <Text style={styles.metaText}>
                    ⏱️ {story.duration_seconds ? Math.round(story.duration_seconds / 60) : 5}m
                  </Text>
                  <Text style={styles.metaText}>🎤 Default</Text>
                  <Text style={styles.metaText}>🌲 Ambient</Text>
                </View>
              </View>
              {narratingId === story.id && (
                <ActivityIndicator size="small" color="#f5a623" style={{ marginLeft: 10 }} />
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
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Story</Text>
            <Text style={styles.modalSubtitle}>
              Update the story text or cover picture. Narrator voice, accent, and category stay
              the same as when it was published.
            </Text>
            {loadingEdit ? (
              <ActivityIndicator size="large" color="#f5a623" style={{ marginVertical: 30 }} />
            ) : (
              <>
                <ScrollView style={styles.modalScrollArea}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Story title..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={editTitle}
                    onChangeText={setEditTitle}
                  />
                  <TextInput
                    style={[styles.textInput, styles.manualTextArea]}
                    placeholder="Full story text..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    textAlignVertical="top"
                  />

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
                    <TouchableOpacity style={styles.addCoverRow} onPress={handlePickEditCoverImage}>
                      <Text style={styles.addCoverText}>🖼️ Add Cover Picture</Text>
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
                    style={[styles.modalSaveBtn, savingEdit && { opacity: 0.6 }]}
                    disabled={savingEdit}
                    onPress={handleSaveEdit}
                  >
                    {savingEdit ? (
                      <ActivityIndicator size="small" color="#0b0e20" />
                    ) : (
                      <Text style={styles.modalSaveText}>Save Changes</Text>
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
        storyTitle={stories.find((s) => s.id === narratingId)?.title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
    paddingTop: 40,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    justifyContent: "center",
  },
  headerIcon: {
    fontSize: 20,
  },
  titleSerif: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "serif",
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
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
  modalScrollArea: {
    maxHeight: 340,
    marginBottom: 16,
  },
  textInput: {
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
  addCoverRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(245, 166, 35, 0.4)",
    alignItems: "center",
    marginBottom: 10,
  },
  addCoverText: {
    color: "#f5a623",
    fontSize: 13,
    fontWeight: "700",
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
  modalSaveBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#f5a623",
  },
  modalSaveText: {
    color: "#0b0e20",
    fontWeight: "800",
  },
});
