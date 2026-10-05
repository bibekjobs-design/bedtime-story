import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { api } from "../api/client";

// Loads Razorpay's hosted Checkout script once (web only) and resolves when
// window.Razorpay is ready to use.
let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (Platform.OS !== "web") return Promise.resolve(false);
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

const PLANS = {
  normal: {
    id: "normal_monthly",
    label: "Normal",
    price: 99,
    originalPrice: null,
    tagline: "Listen to every story in the Library, anytime",
    emoji: "📖",
    benefits: [
      { icon: "🎧", text: "Unlimited Library Stories & offline playback" },
      { icon: "🧸", text: "Unlimited Child Profiles with custom sleep timers" },
      { icon: "🌲", text: "All 5 Story-Matched HD Soundscapes" },
      { icon: "🔒", text: "Listening only - creating new stories is part of Pro and Super" },
    ],
  },
  pro: {
    id: "pro151_monthly",
    label: "Pro",
    price: 151,
    originalPrice: null,
    tagline: "Everything in Normal, plus AI-narrated stories you create",
    emoji: "✨",
    benefits: [
      { icon: "🎧", text: "Unlimited Library Stories & offline playback" },
      { icon: "✨", text: "5 Custom AI Stories / month, narrated by Luna & friends (up to 3 min each)" },
      { icon: "🧸", text: "Unlimited Child Profiles with custom sleep timers" },
      { icon: "🌲", text: "All 5 Story-Matched HD Soundscapes" },
    ],
  },
  super: {
    id: "super_monthly",
    label: "Super",
    price: 219,
    originalPrice: 299,
    tagline: "Everything in Pro, plus parent voice cloning",
    emoji: "👑",
    benefits: [
      { icon: "🎧", text: "Unlimited Library Stories & offline playback" },
      { icon: "✨", text: "8 Custom AI Stories / month (up to 5 min each)" },
      { icon: "🎙️", text: "4 Parent Voice Cloned Stories / month (up to ~3 min / 2,430 characters each)" },
      { icon: "🧸", text: "Unlimited Child Profiles with custom sleep timers" },
      { icon: "🌲", text: "All 5 Story-Matched HD Soundscapes" },
    ],
  },
};

export default function SubscriptionModal({
  visible,
  onClose,
  onSubscriptionSuccess,
  defaultPlan = "pro",
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [successCelebration, setSuccessCelebration] = useState(false);
  const [selectedPlanKey, setSelectedPlanKey] = useState(
    PLANS[defaultPlan] ? defaultPlan : "pro"
  );
  const plan = PLANS[selectedPlanKey];
  // "autopay" = Subscribe monthly (renews automatically, cancel anytime)
  // "once"    = Pay for 1 month only (no renewal)
  const [billingMode, setBillingMode] = useState("autopay");

  function resetAndClose() {
    setError(null);
    setProcessing(false);
    onClose();
  }

  async function handlePayNow() {
    setError(null);
    setProcessing(true);
    try {
      // 1. Create a real Razorpay Subscription (auto-renew) or Order (one
      //    month only) on our backend for the selected plan.
      const isAutopay = billingMode === "autopay";
      const order = isAutopay
        ? await api.createAutopaySubscription(plan.id)
        : await api.createSubscriptionOrder(plan.id);

      if (Platform.OS === "web") {
        await payOnWeb(order, isAutopay);
      } else {
        await payOnNative(order, isAutopay);
      }
    } catch (err) {
      setError(err.message || "Something went wrong starting the payment.");
      setProcessing(false);
    }
  }

  async function payOnWeb(order, isAutopay) {
    const ready = await loadRazorpayScript();
    if (!ready || typeof window === "undefined" || !window.Razorpay) {
      setError("Could not load the secure payment window. Check your connection and try again.");
      setProcessing(false);
      return;
    }

    const rzp = new window.Razorpay({
      key: order.razorpay_key_id,
      ...(isAutopay
        ? { subscription_id: order.subscription_id }
        : { amount: order.amount_paise, currency: order.currency, order_id: order.order_id }),
      name: `Bedtime Story ${plan.label}`,
      description: `Monthly ${plan.label} Subscription`,
      prefill: {
        email: order.prefill_email || "",
        name: order.prefill_name || "",
        contact: order.prefill_contact || "",
      },
      theme: { color: "#7c3aed" },
      handler: async function (response) {
        // response = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
        await confirmPayment(response, isAutopay);
      },
      modal: {
        ondismiss: function () {
          setProcessing(false);
        },
      },
    });

    rzp.on("payment.failed", function (resp) {
      setError(
        "Payment failed: " + (resp?.error?.description || "Please try again or use another method.")
      );
      setProcessing(false);
    });

    rzp.open();
  }

  async function payOnNative(order, isAutopay) {
    // Native checkout needs the react-native-razorpay SDK, which requires a
    // custom EAS dev build (it isn't available inside Expo Go). Loaded
    // dynamically so the app doesn't crash where it isn't installed yet.
    let RazorpayCheckout;
    try {
      RazorpayCheckout = require("react-native-razorpay").default;
    } catch (e) {
      setError(
        "In-app payment isn't set up for this device build yet. Please open Bedtime Story in a web browser to subscribe for now."
      );
      setProcessing(false);
      return;
    }

    try {
      const response = await RazorpayCheckout.open({
        key: order.razorpay_key_id,
        ...(isAutopay
          ? { subscription_id: order.subscription_id }
          : { amount: order.amount_paise, currency: order.currency, order_id: order.order_id }),
        name: `Bedtime Story ${plan.label}`,
        description: `Monthly ${plan.label} Subscription`,
        prefill: {
          email: order.prefill_email || "",
          name: order.prefill_name || "",
          contact: order.prefill_contact || "",
        },
        theme: { color: "#7c3aed" },
      });
      await confirmPayment(response, isAutopay);
    } catch (err) {
      // User cancelled or the SDK reported an error.
      if (err?.description) {
        setError("Payment cancelled: " + err.description);
      }
      setProcessing(false);
    }
  }

  async function confirmPayment(response, isAutopay) {
    try {
      const res = isAutopay
        ? await api.verifyAutopay({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id,
            razorpay_signature: response.razorpay_signature,
          })
        : await api.verifySubscriptionPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });

      if (res.success) {
        setSuccessCelebration(true);
        setTimeout(() => {
          if (onSubscriptionSuccess) onSubscriptionSuccess();
          resetAndClose();
        }, 1800);
      } else {
        setError("Payment could not be verified. If money was deducted, it will be refunded automatically.");
        setProcessing(false);
      }
    } catch (err) {
      setError("Payment verification failed: " + err.message);
      setProcessing(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.badgeRow}>
              <Text style={styles.crownEmoji}>{plan.emoji}</Text>
              <Text style={styles.planBadge}>Bedtime Story {plan.label}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={resetAndClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {successCelebration ? (
            <View style={styles.successBox}>
              <Text style={styles.successEmoji}>🎉</Text>
              <Text style={styles.successTitle}>Subscription Activated!</Text>
              <Text style={styles.successDesc}>
                Welcome to Bedtime Story {plan.label}. {plan.tagline}.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {/* Plan Picker */}
              <View style={styles.planPickerRow}>
                {Object.keys(PLANS).map((key) => {
                  const p = PLANS[key];
                  const active = key === selectedPlanKey;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.planPickerBtn, active && styles.planPickerBtnActive]}
                      onPress={() => setSelectedPlanKey(key)}
                    >
                      <Text style={[styles.planPickerLabel, active && styles.planPickerLabelActive]}>
                        {p.emoji} {p.label}
                      </Text>
                      <Text style={[styles.planPickerPrice, active && styles.planPickerLabelActive]}>
                        ₹{p.price}/mo
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Pricing Hero */}
              <View style={styles.priceHero}>
                {plan.originalPrice ? (
                  <View style={styles.discountRow}>
                    <Text style={styles.originalPrice}>₹{plan.originalPrice}</Text>
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountBadgeText}>
                        SAVE ₹{plan.originalPrice - plan.price}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.priceRow}>
                  <Text style={styles.currencySymbol}>₹</Text>
                  <Text style={styles.priceAmount}>{plan.price}</Text>
                  <Text style={styles.pricePeriod}>/ month</Text>
                </View>
                <Text style={styles.priceTagline}>{plan.tagline}</Text>
              </View>

              {/* Plan Benefits List */}
              <View style={styles.benefitsCard}>
                <Text style={styles.benefitsTitle}>What's Included in {plan.label}:</Text>
                {plan.benefits.map((b, idx) => (
                  <View style={styles.benefitItem} key={idx}>
                    <Text style={styles.benefitIcon}>{b.icon}</Text>
                    <Text style={styles.benefitText}>{b.text}</Text>
                  </View>
                ))}
              </View>

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠️ {error}</Text>
                </View>
              )}

              <View style={styles.secureRow}>
                <Text style={styles.secureText}>🔒 Payments are securely processed by Razorpay</Text>
              </View>

              {/* Billing choice: auto-renew vs one month only */}
              <View style={styles.billingRow}>
                <TouchableOpacity
                  style={[styles.billingBtn, billingMode === "autopay" && styles.billingBtnActive]}
                  onPress={() => setBillingMode("autopay")}
                  disabled={processing}
                >
                  <Text style={[styles.billingTitle, billingMode === "autopay" && styles.billingTitleActive]}>
                    🔁 Subscribe monthly
                  </Text>
                  <Text style={styles.billingSub}>Renews automatically</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.billingBtn, billingMode === "once" && styles.billingBtnActive]}
                  onPress={() => setBillingMode("once")}
                  disabled={processing}
                >
                  <Text style={[styles.billingTitle, billingMode === "once" && styles.billingTitleActive]}>
                    1️⃣ Pay for 1 month
                  </Text>
                  <Text style={styles.billingSub}>No renewal</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.payBtn, processing && styles.payBtnDisabled]}
                onPress={handlePayNow}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.payBtnText}>
                    {billingMode === "autopay"
                      ? `Subscribe ₹${plan.price}/month & Activate ${plan.label}`
                      : `Pay ₹${plan.price} for 1 month & Activate ${plan.label}`}
                  </Text>
                )}
              </TouchableOpacity>

              <Text style={styles.cancelNote}>
                {billingMode === "autopay"
                  ? `You approve the monthly payment once. ₹${plan.price} is charged every month until you cancel - cancel anytime from your Parent Area.`
                  : "One payment for 30 days. It won't renew automatically."}
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
    paddingTop: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  crownEmoji: {
    fontSize: 22,
  },
  planBadge: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  planPickerRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  planPickerBtn: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.1)",
    paddingVertical: 12,
    alignItems: "center",
  },
  planPickerBtnActive: {
    backgroundColor: "rgba(147, 51, 234, 0.18)",
    borderColor: colors.primary,
  },
  planPickerLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  planPickerLabelActive: {
    color: colors.text,
  },
  planPickerPrice: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  priceHero: {
    alignItems: "center",
    marginBottom: 16,
  },
  discountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  originalPrice: {
    color: colors.textDim,
    fontSize: 16,
    fontWeight: "600",
    textDecorationLine: "line-through",
  },
  discountBadge: {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  discountBadgeText: {
    color: "#22c55e",
    fontSize: 11,
    fontWeight: "800",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  currencySymbol: {
    color: colors.sliderThumb,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 6,
  },
  priceAmount: {
    color: colors.text,
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: -1,
  },
  pricePeriod: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: "600",
    alignSelf: "flex-end",
    marginBottom: 10,
    marginLeft: 4,
  },
  priceTagline: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  benefitsCard: {
    backgroundColor: "rgba(147, 51, 234, 0.12)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(147, 51, 234, 0.25)",
    marginBottom: 18,
  },
  benefitsTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 12,
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 10,
  },
  benefitIcon: {
    fontSize: 16,
  },
  benefitText: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  boldText: {
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    padding: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 12,
    textAlign: "center",
    fontWeight: "600",
  },
  secureRow: {
    alignItems: "center",
    marginBottom: 14,
  },
  secureText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "600",
  },
  payBtn: {
    width: "100%",
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  payBtnDisabled: {
    opacity: 0.7,
  },
  payBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  billingRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  billingBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  billingBtnActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(124, 58, 237, 0.18)",
  },
  billingTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  billingTitleActive: {
    color: "#ffffff",
  },
  billingSub: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  cancelNote: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: "center",
    marginTop: 12,
  },
  successBox: {
    alignItems: "center",
    padding: 30,
  },
  successEmoji: {
    fontSize: 60,
    marginBottom: 14,
  },
  successTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  successDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
