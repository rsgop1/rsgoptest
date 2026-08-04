import { InlineKeyboard } from "grammy";

export function mainCategoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏆 SSC Exams", "cat_main_SSC").text("🚆 Railway Exams", "cat_main_Railway").row()
    .text("🏢 Banking Exams", "cat_main_Banking").text("🗺️ Bihar Govt Exams", "cat_main_Bihar");
}

export function sscSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎙️ SSC Steno", "cat_sub_SSC_Stenographer").text("🎩 SSC CGL", "cat_sub_SSC_CGL").row()
    .text("📝 SSC CHSL", "cat_sub_SSC_CHSL").text("🎯 SSC MTS", "cat_sub_SSC_MTS").row()
    .text("🎖️ SSC Selection Post", "cat_sub_SSC_Selection_Post").text("👮 SSC GD", "cat_sub_SSC_GD_Constable").row()
    .text("⬅️ Back", "cat_back_main");
}

export function railwaySubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛠️ RRB ALP", "cat_sub_Railway_RRB_ALP").text("🔥 RRB NTPC", "cat_sub_Railway_RRB_NTPC").row()
    .text("📦 RRC Group D", "cat_sub_Railway_RRC_Group_D").text("👮 RPF SI", "cat_sub_Railway_RPF_SI").row()
    .text("⬅️ Back", "cat_back_main");
}

export function bankingSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏦 IBPS PO/Clerk", "cat_sub_Banking_IBPS_PO_Clerk").text("🦁 SBI PO/Clerk", "cat_sub_Banking_SBI_PO_Clerk").row()
    .text("⬅️ Back", "cat_back_main");
}

export function biharSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⚡ BTSC", "cat_sub_Bihar_BTSC").text("🏛️ BSSC Inter Level", "cat_sub_Bihar_BSSC_Inter").row()
    .text("👮 Bihar Police SI", "cat_sub_Bihar_Police_SI").text("📚 BPSC Pre", "cat_sub_Bihar_BPSC_Pre").row()
    .text("⬅️ Back", "cat_back_main");
}

export function solutionNavKeyboard(index: number, total: number, testId?: string, attemptId?: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (index > 0) kb.text("⬅️ Prev", `sol_prev_${index}`);
  else kb.text("·", "sol_noop");
  kb.text(`📄 ${index + 1}/${total}`, "sol_noop");
  if (index < total - 1) kb.text("Next ➡️", `sol_next_${index}`);
  else kb.text("·", "sol_noop");
  kb.row().text("🤖 AI Info", `ai_info_${index}`).text("🚩 Report", `report_q_${index}`);
  kb.row().text("🏠 Home", "sol_home");
  return kb;
}

export function scorecardKeyboard(testId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📖 View Solutions", "view_solutions").row()
    .text("🔄 Re-Attempt", `reattempt_${testId}`).text("📊 My Attempts", `my_attempts_${testId}`);
}

export function reattemptChoiceKeyboard(testId: string, webUrl?: string): InlineKeyboard {
  const kb = new InlineKeyboard().text("🚀 Continue on Telegram", `begin_test_${testId}`).row();
  if (webUrl) kb.url("🖥️ Continue on Web App", webUrl).row();
  return kb
    .text("📊 My Attempts", `my_attempts_${testId}`).row()
    .text("⬅️ Back to Tests", "go_test_series");
}

export function paymentKeyboard(testId: string, priceInr: number, priceInStars: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(`⭐ Pay ${priceInStars} Stars`, `pay_stars_${testId}`).row()
    .text(`💳 Pay via UPI ₹${priceInr}`, `pay_upi_${testId}`);
}

export function premiumKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⭐ Pay with Telegram Stars (500)", "premium_stars").row()
    .text("💳 Pay via UPI ₹199", "premium_upi");
}

export function testDetailKeyboard(testId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚀 Start Test Now", `deeplink_start_${testId}`).row()
    .text("📚 View All Tests", "go_test_series");
}

export function testDetailWithStartKeyboard(testId: string, webUrl?: string): InlineKeyboard {
  const kb = new InlineKeyboard().text("🚀 Continue on Telegram", `begin_test_${testId}`).row();
  if (webUrl) kb.url("🖥️ Continue on Web App", webUrl).row();
  return kb.text("📚 All Tests", "go_test_series");
}

export function timerSelectKeyboard(testId: string, isPremium: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("15s ⚡", `timer_sel_${testId}_15`).text("30s 🕐", `timer_sel_${testId}_30`).text("45s 🕐", `timer_sel_${testId}_45`).row()
    .text("60s 🐢", `timer_sel_${testId}_60`).text("90s 🦥", `timer_sel_${testId}_90`);
  if (isPremium) {
    kb.row().text("♾️ No Time Limit", `timer_sel_${testId}_0`);
  }
  kb.row().text("❌ Cancel", "go_test_series");
  return kb;
}

export function practiceCountKeyboard(testId: string, totalQuestions: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const count of [10, 25, 50, 75, 100]) {
    if (count <= totalQuestions) kb.text(String(count), `practice_count_${testId}_${count}`);
    if (count === 25 || count === 100) kb.row();
  }
  kb.text("All", `practice_count_${testId}_all`).row()
    .text("Custom", `practice_custom_${testId}`).row()
    .text("Cancel", "go_test_series");
  return kb;
}

export function practiceStartKeyboard(testId: string, totalQuestions: number, prefix = "practice_start"): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const start of [1, 5, 10, 20]) {
    if (start <= totalQuestions) {
      kb.text(start === 1 ? "1 (Default)" : String(start), `${prefix}_${testId}_${start}`);
    }
  }
  kb.row().text("Custom", `${prefix}_custom_${testId}`);
  kb.row().text("Cancel", "go_test_series");
  return kb;
}

export function attemptsKeyboard(testId: string, attemptIds: number[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < attemptIds.length; i++) {
    kb.text(`Attempt ${i + 1}`, `view_attempt_${attemptIds[i]}`);
    if ((i + 1) % 5 === 0) kb.row();
  }
  kb.row().text("⬅️ Back to Tests", "go_test_series");
  return kb;
}

export function liveTestJoinKeyboard(liveTestId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✋ Join Live Test", `live_join_${liveTestId}`);
}

export function couponChoiceKeyboard(testId: string | undefined, isPremium: boolean): InlineKeyboard {
  const prefix = testId ? `testid_${testId}` : "premium";
  return new InlineKeyboard()
    .text("🏷️ Yes, I have a coupon", `coupon_yes_${prefix}`).row()
    .text("✅ No, proceed to payment", `coupon_no_${prefix}`);
}

export function skipQuestionKeyboard(msgId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏭️ Skip Question", `skip_q_${msgId}`);
}
