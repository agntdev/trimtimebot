import { Bot } from "grammy";
import { getDb } from "./db/index.js";
import { registerAdminSchedule } from "./admin_schedule.js";
import { registerBookingFlow } from "./booking_flow.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN environment variable is required");
  process.exit(1);
}

const db = getDb();

const bot = new Bot(token);

registerAdminSchedule(bot, db);
registerBookingFlow(bot, db);

bot.command("start", async (ctx) => {
  await ctx.reply("TrimTimeBot is running.");
});

bot.start({
  onStart: () => console.log("Bot started"),
});
