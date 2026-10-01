import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

const CATEGORY_ICONS = {
  Animals: "🐾",
  Space: "🪐",
  "Magic Forest": "🍄",
  Friendship: "💖",
};

export default function CategoryScreen({ selectedAgeGroup, onBack, onSelectCategory }) {
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (selectedAgeGroup?.id) {
      loadCategories();
    }
  }, [selectedAgeGroup?.id]);

  async function loadCategories() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCategories(selectedAgeGroup?.id);
      setCategories(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredCategories = categories.filter((cat) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      cat.name.toLowerCase().includes(q) ||
      (cat.description && cat.description.toLowerCase().includes(q))
    );
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.backText}>← Change Age (Ages {selectedAgeGroup?.label})</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.badge}>Step 2 of 3 • Pick a Theme</Text>
        <Text style={styles.title}>What kind of adventure?</Text>
        <Text style={styles.subtitle}>
          Choose a soothing world to explore before drifting to sleep.
        </Text>
      </View>

      {/* Category Search Bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search themes or type any custom bedtime idea..."
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          value={searchQuery}
          onChangeText={(text) => setSearchQuery(text)}
          onSubmitEditing={() => {
            if (searchQuery.trim()) {
              const targetCat = filteredCategories.length > 0 ? filteredCategories[0] : (categories[0] || { id: "cat_animals", name: "Custom" });
              onSelectCategory(targetCat, searchQuery.trim());
            }
          }}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
        {searchQuery.trim().length > 0 && (
          <TouchableOpacity
            style={styles.searchActionBtn}
            onPress={() => {
              const targetCat = filteredCategories.length > 0 ? filteredCategories[0] : (categories[0] || { id: "cat_animals", name: "Custom" });
              onSelectCategory(targetCat, searchQuery.trim());
            }}
          >
            <Text style={styles.searchActionText}>Find Story</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primaryLight} />
          <Text style={styles.loadingText}>Fetching cozy categories...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadCategories}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filteredCategories.length === 0 ? (
        <View style={styles.customStoryBox}>
          <Text style={styles.customStoryIcon}>✨</Text>
          <Text style={styles.customStoryTitle}>
            Weave a bedtime story about "{searchQuery}"
          </Text>
          <Text style={styles.customStoryDesc}>
            No fixed theme matches this name, but we can generate a soothing, original bedtime story about it right now!
          </Text>
          <TouchableOpacity
            style={styles.customStoryBtn}
            activeOpacity={0.8}
            onPress={() => {
              const defaultCat = categories[0] || { id: "cat_animals", name: "Custom" };
              onSelectCategory(defaultCat, searchQuery.trim());
            }}
          >
            <Text style={styles.customStoryBtnText}>🎙️ Create & Listen to Story →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearSearchLink} onPress={() => setSearchQuery("")}>
            <Text style={styles.clearSearchLinkText}>Or show all {categories.length} themes</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.grid}>
          {filteredCategories.map((cat) => {
            const icon = cat.icon_url || CATEGORY_ICONS[cat.name] || "📖";
            return (
              <TouchableOpacity
                key={cat.id}
                style={styles.card}
                activeOpacity={0.8}
                onPress={() => onSelectCategory(cat, searchQuery.trim())}
              >
                <View style={styles.iconCircle}>
                  <Text style={styles.icon}>{icon}</Text>
                </View>
                <Text style={styles.catName}>{cat.name}</Text>
                <Text style={styles.catDesc}>{cat.description}</Text>
              </TouchableOpacity>
            );
          })}

          {searchQuery.trim().length > 1 && (
            <TouchableOpacity
              style={styles.customTopicPill}
              activeOpacity={0.8}
              onPress={() => {
                const targetCat = filteredCategories[0] || (categories[0] || { id: "cat_animals", name: "Custom" });
                onSelectCategory(targetCat, searchQuery.trim());
              }}
            >
              <Text style={styles.customTopicPillText}>
                ✨ Or weave a custom story about "{searchQuery}" →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingTop: 54,
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: 20,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  header: {
    marginBottom: 26,
  },
  badge: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  grid: {
    gap: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(147, 51, 234, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  icon: {
    fontSize: 26,
  },
  catName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  catDesc: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  centerBox: {
    paddingVertical: 60,
    alignItems: "center",
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: 14,
    fontSize: 14,
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 22,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    padding: 0,
  },
  clearBtn: {
    padding: 4,
    marginRight: 6,
  },
  clearText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "bold",
  },
  searchActionBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  searchActionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  customStoryBox: {
    backgroundColor: "rgba(147, 51, 234, 0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(147, 51, 234, 0.35)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginTop: 10,
  },
  customStoryIcon: {
    fontSize: 38,
    marginBottom: 12,
  },
  customStoryTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  customStoryDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    maxWidth: 320,
  },
  customStoryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  customStoryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  clearSearchLink: {
    marginTop: 16,
    paddingVertical: 6,
  },
  clearSearchLinkText: {
    color: colors.sliderThumb,
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  customTopicPill: {
    backgroundColor: "rgba(147, 51, 234, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.3)",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  customTopicPillText: {
    color: colors.sliderThumb,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
    marginBottom: 16,
  },
});
