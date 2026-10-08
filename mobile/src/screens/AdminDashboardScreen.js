import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { api } from "../api/client";
import { colors } from "../theme/colors";

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <View style={[styles.statCard, accent && { borderColor: accent }]}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.statGrid}>{children}</View>
    </View>
  );
}

const SEVERITY_STYLE = {
  critical: { border: "#f87171", bg: "rgba(248, 113, 113, 0.1)", icon: "🔴" },
  warning: { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)", icon: "🟠" },
  info: { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.1)", icon: "🔵" },
};

function WarningCard({ warning }) {
  const style = SEVERITY_STYLE[warning.severity] || SEVERITY_STYLE.info;
  return (
    <View style={[styles.warningCard, { borderLeftColor: style.border, backgroundColor: style.bg }]}>
      <Text style={styles.warningHeader}>
        {style.icon} {warning.service}
      </Text>
      <Text style={styles.warningMessage}>{warning.message}</Text>
    </View>
  );
}

function ProgressBar(value, limit) {
  const pct = limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  const color = pct >= 100 ? "#f87171" : pct >= 70 ? "#fbbf24" : "#4ade80";
  return { pct, color };
}

function monthLabel(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function AdminDashboardScreen({ onGoToHome }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [monthlyReport, setMonthlyReport] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyError, setMonthlyError] = useState(null);
  const [expandedList, setExpandedList] = useState(null); // "subscribed" | "free" | null

  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [generatingCategoryId, setGeneratingCategoryId] = useState(null);

  useEffect(() => {
    load();
    loadMonthlyReport();
  }, []);

  async function loadCategories() {
    setCategoriesLoading(true);
    try {
      const res = await api.getAdminCategories();
      setCategories(res || []);
    } catch (e) {
      console.warn("Failed to load categories", e);
    } finally {
      setCategoriesLoading(false);
    }
  }

  async function handleGenerateCategoryImage(category) {
    setGeneratingCategoryId(category.id);
    try {
      const res = await api.generateCategoryImage(category.id);
      setCategories((prev) =>
        prev.map((c) => (c.id === category.id ? { ...c, image_url: res.image_url } : c))
      );
    } catch (e) {
      console.warn("Failed to generate category image", e);
    } finally {
      setGeneratingCategoryId(null);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminDashboard();
      setData(res);
    } catch (e) {
      setError(e.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthlyReport(month) {
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const res = await api.getAdminMonthlyReport(month);
      setMonthlyReport(res);
    } catch (e) {
      setMonthlyError(e.message || "Failed to load monthly report.");
    } finally {
      setMonthlyLoading(false);
    }
  }

  function shiftMonth(direction) {
    if (!monthlyReport?.available_months?.length) return;
    const months = monthlyReport.available_months;
    const idx = months.indexOf(monthlyReport.month);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= months.length) return;
    loadMonthlyReport(months[nextIdx]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.titleSerif}>Admin Dashboard</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={onGoToHome}>
          <Image source={require("../../assets/images/fox.jpg")} style={styles.homeBtnImg} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {loading ? (
          <ActivityIndicator size="large" color="#f5a623" style={{ marginTop: 50 }} />
        ) : error ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>⚠️</Text>
            <Text style={styles.emptyTitle}>Couldn't load dashboard</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.refreshBtn} onPress={load}>
              <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
            </TouchableOpacity>

            {data.capacity_forecast && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>⚠️ Cost & Capacity Warnings</Text>
                {data.capacity_forecast.warnings.length === 0 ? (
                  <View style={styles.allClearBox}>
                    <Text style={styles.allClearText}>✅ No warnings — usage is well within all plan limits.</Text>
                  </View>
                ) : (
                  data.capacity_forecast.warnings.map((w, idx) => (
                    <WarningCard key={idx} warning={w} />
                  ))
                )}
              </View>
            )}

            {data.capacity_forecast && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📈 30-Day Usage Forecast</Text>
                <Text style={styles.forecastNote}>
                  Based on the last 7 days' pace, projected forward. Growth % compares this week to the week before.
                </Text>

                <View style={styles.forecastCard}>
                  <View style={styles.forecastRow}>
                    <Text style={styles.forecastLabel}>👥 New Users</Text>
                    <Text style={styles.forecastValue}>
                      +{data.capacity_forecast.users.projected_new_users_next_30_days} / 30d
                    </Text>
                  </View>
                  <Text style={styles.forecastSub}>
                    {data.capacity_forecast.users.signups_last_7_days} signups this week vs{" "}
                    {data.capacity_forecast.users.signups_prior_7_days} last week (
                    {data.capacity_forecast.users.growth_pct_week_over_week >= 0 ? "+" : ""}
                    {data.capacity_forecast.users.growth_pct_week_over_week}%)
                  </Text>
                </View>

                <View style={styles.forecastCard}>
                  <View style={styles.forecastRow}>
                    <Text style={styles.forecastLabel}>🎙️ ElevenLabs Characters</Text>
                    <Text style={styles.forecastValue}>
                      {data.capacity_forecast.elevenlabs.actual_chars.toLocaleString()} /{" "}
                      {data.capacity_forecast.elevenlabs.actual_limit.toLocaleString()}
                    </Text>
                  </View>
                  <Text style={styles.forecastActualLabel}>
                    {data.capacity_forecast.elevenlabs.actual_source === "elevenlabs_live"
                      ? "✅ Real usage from your ElevenLabs account"
                      : "⚠️ Estimated from in-app records (ElevenLabs unreachable)"}
                    {" "}({data.capacity_forecast.elevenlabs.used_pct_this_month}% used)
                  </Text>
                  {(() => {
                    const { pct, color } = ProgressBar(
                      data.capacity_forecast.elevenlabs.actual_chars,
                      data.capacity_forecast.elevenlabs.actual_limit
                    );
                    return (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                    );
                  })()}
                  <Text style={styles.forecastSub}>
                    In-app records this month: {data.capacity_forecast.elevenlabs.app_db_chars_this_month.toLocaleString()} chars ·{" "}
                    All-time: {data.capacity_forecast.elevenlabs.app_db_chars_all_time.toLocaleString()} chars
                  </Text>
                  <Text style={styles.forecastSub}>
                    Projected (30d pace): {data.capacity_forecast.elevenlabs.projected_chars_next_30_days.toLocaleString()} ·{" "}
                    Starter plan (${data.capacity_forecast.elevenlabs.plan_cost_usd}/mo)
                  </Text>
                </View>

                <View style={styles.forecastCard}>
                  <View style={styles.forecastRow}>
                    <Text style={styles.forecastLabel}>🔊 Google TTS Characters</Text>
                    <Text style={styles.forecastValue}>
                      {data.capacity_forecast.google_tts.chars_this_month.toLocaleString()} /{" "}
                      {data.capacity_forecast.google_tts.free_limit_monthly.toLocaleString()}
                    </Text>
                  </View>
                  <Text style={styles.forecastActualLabel}>
                    Actual usage this month ({data.capacity_forecast.google_tts.used_pct_this_month}% of free tier)
                  </Text>
                  {(() => {
                    const { pct, color } = ProgressBar(
                      data.capacity_forecast.google_tts.chars_this_month,
                      data.capacity_forecast.google_tts.free_limit_monthly
                    );
                    return (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                    );
                  })()}
                  <Text style={styles.forecastSub}>
                    Last 7 days: {data.capacity_forecast.google_tts.chars_last_7_days.toLocaleString()} chars ·
                    {" "}All-time: {data.capacity_forecast.google_tts.chars_all_time.toLocaleString()} chars
                  </Text>
                  <Text style={styles.forecastSub}>
                    Projected (30d pace): {data.capacity_forecast.google_tts.projected_chars_next_30_days.toLocaleString()} ·{" "}
                    {data.capacity_forecast.google_tts.estimated_overage_cost_usd > 0
                      ? `Est. overage: ~$${data.capacity_forecast.google_tts.estimated_overage_cost_usd}/mo (~₹${data.capacity_forecast.google_tts.estimated_overage_cost_inr}/mo)`
                      : "Within free tier"}
                  </Text>
                </View>
              </View>
            )}

            {data.db_storage && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>💾 Database & Storage</Text>
                {data.db_storage.error ? (
                  <View style={[styles.allClearBox, { backgroundColor: "rgba(248, 113, 113, 0.1)", borderLeftColor: "#f87171" }]}>
                    <Text style={[styles.allClearText, { color: "#f87171" }]}>
                      ⚠️ {data.db_storage.error}
                    </Text>
                    {data.db_storage.detail ? (
                      <Text style={[styles.forecastSub, { marginTop: 6 }]}>
                        {data.db_storage.detail}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <>
                    <View style={styles.forecastCard}>
                      <View style={styles.forecastRow}>
                        <Text style={styles.forecastLabel}>🗄️ Postgres Database</Text>
                        <Text style={styles.forecastValue}>
                          {data.db_storage.db_size_pretty} / {data.db_storage.db_free_limit_pretty}
                        </Text>
                      </View>
                      <Text style={styles.forecastActualLabel}>
                        {data.db_storage.db_percent_of_free_limit}% of free-tier limit used
                      </Text>
                      {(() => {
                        const { pct, color } = ProgressBar(data.db_storage.db_percent_of_free_limit, 100);
                        return (
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                          </View>
                        );
                      })()}
                    </View>

                    <View style={styles.forecastCard}>
                      <View style={styles.forecastRow}>
                        <Text style={styles.forecastLabel}>📦 Storage (Audio Files)</Text>
                        <Text style={styles.forecastValue}>
                          {data.db_storage.storage_total_pretty} / {data.db_storage.storage_free_limit_pretty}
                        </Text>
                      </View>
                      <Text style={styles.forecastActualLabel}>
                        {data.db_storage.storage_percent_of_free_limit}% of free-tier limit used
                      </Text>
                      {(() => {
                        const { pct, color } = ProgressBar(data.db_storage.storage_percent_of_free_limit, 100);
                        return (
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                          </View>
                        );
                      })()}
                      {data.db_storage.buckets && data.db_storage.buckets.length > 0 && (
                        <Text style={styles.forecastSub}>
                          {data.db_storage.buckets
                            .map((b) => `${b.bucket_id}: ${b.pretty} (${b.file_count} files)`)
                            .join("  ·  ")}
                        </Text>
                      )}
                    </View>

                    <Text style={styles.forecastNote}>
                      {data.db_storage.note}
                    </Text>
                  </>
                )}
              </View>
            )}

            <Section title="👨‍👩‍👧 Users & Subscriptions">
              <StatCard icon="👥" label="Total Users" value={data.users.total} />
              <StatCard
                icon="👑"
                label="Premium Users"
                value={data.users.premium}
                accent="#f5a623"
              />
              <StatCard icon="🆓" label="Free Users" value={data.users.free} />
              <StatCard icon="✨" label="Signups Today" value={data.users.signups_today} />
              <StatCard icon="📈" label="Signups This Week" value={data.users.signups_this_week} />
              <StatCard icon="🧸" label="Child Profiles" value={data.profiles.total_child_profiles} />
            </Section>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🗓️ Month-wise Subscribers</Text>
              <Text style={styles.forecastNote}>
                Real users only (test/@example.com accounts excluded). "Subscribed" is derived from actual
                payment history for that month, not today's account status - so past months stay accurate
                even after a subscription has since lapsed.
              </Text>

              {monthlyLoading && !monthlyReport ? (
                <ActivityIndicator size="small" color="#f5a623" style={{ marginVertical: 20 }} />
              ) : monthlyError ? (
                <View style={styles.allClearBox}>
                  <Text style={[styles.allClearText, { color: "#f87171" }]}>{monthlyError}</Text>
                </View>
              ) : monthlyReport ? (
                <>
                  <View style={styles.monthNavRow}>
                    <TouchableOpacity
                      style={styles.monthNavBtn}
                      onPress={() => shiftMonth(-1)}
                      disabled={monthlyLoading}
                    >
                      <Text style={styles.monthNavBtnText}>◀</Text>
                    </TouchableOpacity>
                    <Text style={styles.monthNavLabel}>
                      {monthlyLoading ? "Loading…" : monthLabel(monthlyReport.month)}
                    </Text>
                    <TouchableOpacity
                      style={styles.monthNavBtn}
                      onPress={() => shiftMonth(1)}
                      disabled={monthlyLoading}
                    >
                      <Text style={styles.monthNavBtnText}>▶</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.statGrid}>
                    <StatCard
                      icon="💵"
                      label="Revenue This Month"
                      value={`₹${monthlyReport.revenue_inr_this_month}`}
                      accent="#4ade80"
                    />
                    <StatCard
                      icon="👑"
                      label="Subscribed"
                      value={monthlyReport.subscribed_count}
                      accent="#f5a623"
                    />
                    <StatCard icon="🆓" label="Free" value={monthlyReport.free_count} />
                  </View>

                  <TouchableOpacity
                    style={styles.monthListToggle}
                    onPress={() => setExpandedList(expandedList === "subscribed" ? null : "subscribed")}
                  >
                    <Text style={styles.monthListToggleText}>
                      {expandedList === "subscribed" ? "▼" : "▶"} Subscribed users ({monthlyReport.subscribed_count})
                    </Text>
                  </TouchableOpacity>
                  {expandedList === "subscribed" && (
                    <View style={styles.monthListBody}>
                      {monthlyReport.subscribed_users.length === 0 ? (
                        <Text style={styles.categoryEmptyText}>No real users were subscribed this month.</Text>
                      ) : (
                        monthlyReport.subscribed_users.map((u) => (
                          <View key={u.id} style={styles.monthUserRow}>
                            <Text style={styles.monthUserEmail}>{u.email}</Text>
                            <Text style={styles.monthUserSub}>
                              Paid ₹{u.paid_amount_inr_this_month_windows} · {u.coverage_windows.length} payment
                              {u.coverage_windows.length !== 1 ? "s" : ""} covering this window
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.monthListToggle}
                    onPress={() => setExpandedList(expandedList === "free" ? null : "free")}
                  >
                    <Text style={styles.monthListToggleText}>
                      {expandedList === "free" ? "▼" : "▶"} Free users ({monthlyReport.free_count})
                    </Text>
                  </TouchableOpacity>
                  {expandedList === "free" && (
                    <View style={styles.monthListBody}>
                      {monthlyReport.free_users.length === 0 ? (
                        <Text style={styles.categoryEmptyText}>No free (unpaid) real users that month.</Text>
                      ) : (
                        monthlyReport.free_users.map((u) => (
                          <View key={u.id} style={styles.monthUserRow}>
                            <Text style={styles.monthUserEmail}>{u.email}</Text>
                            <Text style={styles.monthUserSub}>
                              Signed up {new Date(u.signed_up_at).toLocaleDateString()}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </>
              ) : null}
            </View>

            <Section title="💰 Revenue">
              <StatCard
                icon="💵"
                label="This Month"
                value={`₹${data.revenue.this_month_inr}`}
                accent="#4ade80"
              />
              <StatCard icon="🏦" label="Total Revenue" value={`₹${data.revenue.total_inr}`} />
              <StatCard
                icon="🧾"
                label="Captured Payments"
                value={data.revenue.total_captured_payments}
              />
            </Section>

            <Section title="📖 Stories & Narration">
              <StatCard icon="📚" label="Library Stories" value={data.stories.library_stories} />
              <StatCard
                icon="📝"
                label="Personalized Total"
                value={data.stories.personalized_total}
              />
              <StatCard icon="🎙️" label="Cloned Narrations" value={data.stories.cloned_narrations} />
              <StatCard icon="🎤" label="AI Voice Narrations" value={data.stories.ai_voice_narrations} />
              <StatCard icon="📅" label="Generated Today" value={data.stories.generated_today} />
              <StatCard icon="🗓️" label="Generated This Week" value={data.stories.generated_this_week} />
            </Section>

            <Section title="🎙️ Voice Cloning">
              <StatCard icon="🎙️" label="Total Clones" value={data.voice_clones.total} />
              <StatCard
                icon="✅"
                label="Real (ElevenLabs) Clones"
                value={data.voice_clones.real_registered}
                accent="#4ade80"
              />
              <StatCard
                icon="⚠️"
                label="Still Simulated/Fake"
                value={data.voice_clones.still_simulated}
                accent={data.voice_clones.still_simulated > 0 ? "#f87171" : undefined}
              />
            </Section>

            <Text style={styles.footerNote}>
              Last updated: {new Date(data.generated_at).toLocaleString()}
            </Text>
          </>
        )}
      </ScrollView>
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
  titleSerif: {
    fontSize: 26,
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
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  refreshBtn: {
    alignSelf: "flex-end",
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.35)",
  },
  refreshBtnText: {
    color: "#f5a623",
    fontSize: 13,
    fontWeight: "700",
  },
  section: {
    marginBottom: 26,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 12,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47%",
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 18,
    padding: 14,
  },
  statIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: "#9ba1ba",
    fontWeight: "600",
  },
  statSub: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 2,
  },
  footerNote: {
    fontSize: 11,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 10,
  },
  warningCard: {
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  warningHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  warningMessage: {
    fontSize: 12,
    color: "#d0d4e3",
    lineHeight: 18,
  },
  allClearBox: {
    backgroundColor: "rgba(74, 222, 128, 0.1)",
    borderLeftWidth: 4,
    borderLeftColor: "#4ade80",
    borderRadius: 12,
    padding: 12,
  },
  allClearText: {
    fontSize: 13,
    color: "#4ade80",
    fontWeight: "600",
  },
  forecastNote: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 12,
    lineHeight: 16,
  },
  forecastCard: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  forecastRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  forecastLabel: {
    fontSize: 13,
    color: "#ffffff",
    fontWeight: "600",
  },
  forecastValue: {
    fontSize: 13,
    color: "#f5a623",
    fontWeight: "700",
  },
  forecastSub: {
    fontSize: 11,
    color: "#9ba1ba",
    marginTop: 4,
  },
  forecastActualLabel: {
    fontSize: 10.5,
    color: "#f5a623",
    fontWeight: "600",
    marginBottom: 4,
  },
  monthNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    gap: 16,
  },
  monthNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  monthNavBtnText: {
    color: "#f5a623",
    fontSize: 14,
    fontWeight: "700",
  },
  monthNavLabel: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    minWidth: 140,
    textAlign: "center",
  },
  monthListToggle: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  monthListToggleText: {
    color: "#c084fc",
    fontSize: 13,
    fontWeight: "700",
  },
  monthListBody: {
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 10,
    marginBottom: 6,
  },
  monthUserRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  monthUserEmail: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "600",
  },
  monthUserSub: {
    color: "#9ba1ba",
    fontSize: 11,
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  retryBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 20,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.35)",
  },
  retryBtnText: {
    color: "#f5a623",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyBox: {
    alignItems: "center",
    marginTop: 60,
    paddingHorizontal: 20,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: "#9ba1ba",
    textAlign: "center",
    lineHeight: 19,
  },
  categoryImgGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  categoryImgCard: {
    width: "30%",
    backgroundColor: "rgba(15, 20, 45, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 8,
    alignItems: "center",
  },
  categoryImgWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  categoryImgThumb: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  categoryImgPlaceholder: {
    fontSize: 26,
  },
  categoryImgName: {
    color: "#d0d4e3",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
  },
  categoryImgBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "rgba(245, 166, 35, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 166, 35, 0.35)",
    minHeight: 26,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  categoryImgBtnText: {
    color: "#f5a623",
    fontSize: 10,
    fontWeight: "700",
  },
});
