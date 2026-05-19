import { InlineKeyboard } from "grammy";

export function mainCategoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏆 SSC Exams", "cat_ssc").text("🚆 Railway Exams", "cat_railway").row()
    .text("🏢 Banking Exams", "cat_banking").text("🗺️ Bihar Govt Exams", "cat_bihar");
}

export function sscSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎙️ SSC Stenographer", "sub_SSC Exams_SSC Stenographer").text("🎩 SSC CGL", "sub_SSC Exams_SSC CGL").row()
    .text("📝 SSC CHSL", "sub_SSC Exams_SSC CHSL").text("🎯 SSC MTS", "sub_SSC Exams_SSC MTS").row()
    .text("🎖️ SSC Selection Post", "sub_SSC Exams_SSC Selection Post").text("👮 SSC GD Constable", "sub_SSC Exams_SSC GD Constable").row()
    .text("⬅️ Back", "back_main");
}

export function railwaySubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛠️ RRB ALP / Technician", "sub_Railway Exams_RRB ALP Technician").text("🔥 RRB NTPC", "sub_Railway Exams_RRB NTPC").row()
    .text("📦 RRC Group D", "sub_Railway Exams_RRC Group D").text("👮 RPF SI", "sub_Railway Exams_RPF SI").row()
    .text("⬅️ Back", "back_main");
}

export function bankingSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏦 IBPS PO / Clerk", "sub_Banking Exams_IBPS PO Clerk").text("🦁 SBI PO / Clerk", "sub_Banking Exams_SBI PO Clerk").row()
    .text("⬅️ Back", "back_main");
}

export function biharSubKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⚡ BTSC", "sub_Bihar Govt Exams_BTSC Instructor Technical").text("🏛️ BSSC Inter Level", "sub_Bihar Govt Exams_BSSC Inter Level").row()
    .text("👮 Bihar Police SI", "sub_Bihar Govt Exams_Bihar Police SI Constable").text("📚 BPSC (Pre)", "sub_Bihar Govt Exams_BPSC Pre").row()
    .text("⬅️ Back", "back_main");
}

export function solutionNavKeyboard(index: number, total: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (index > 0) kb.text("⬅️ Previous Q", `sol_prev_${index}`);
  else kb.text("·", "sol_noop");
  kb.text(`🔢 Q ${index + 1}/${total}`, "sol_noop");
  if (index < total - 1) kb.text("Next Q ➡️", `sol_next_${index}`);
  else kb.text("·", "sol_noop");
  kb.row().text("❓ Clear Doubt via AI", "doubt_ai");
  return kb;
}

export function scorecardKeyboard(testId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔍 View Detailed Solutions", "view_solutions")
    .text("🔄 Re-Attempt Test", `reattempt_${testId}`);
}

export function paymentKeyboard(testId: string, priceInr: number, priceInStars: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(`⭐ Pay with ${priceInStars} Stars`, `pay_stars_${testId}`).row()
    .text(`💳 Pay via UPI ₹${priceInr}`, `pay_upi_${testId}`);
}

export function premiumKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⭐ Pay with Telegram Stars (500)", "premium_stars").row()
    .text("💳 Pay via UPI ₹199", "premium_upi");
}
