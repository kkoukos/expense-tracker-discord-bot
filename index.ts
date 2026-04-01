// index.ts — Discord Expense Tracker Bot
// Stack: discord.js, OpenRouter (Gemini Flash Lite), MongoDB

import { Client, GatewayIntentBits, Events, type Message } from "discord.js";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import type {
  ExpenseCategory,
  ExpenseDoc,
  ParsedExpense,
  SummaryRow,
} from "./types/index.js";

// ── Config (set these in Railway environment variables) ──────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const MONGODB_URI = process.env.MONGODB_URI!;
const EXPENSE_CHANNEL_ID = process.env.EXPENSE_CHANNEL_ID!; // Discord channel ID to listen on
const MODEL = process.env.MODEL || "google/gemini-2.5-flash-lite"; // OpenRouter model to use for parsing receipts

// ── MongoDB setup ────────────────────────────────────────────────────────────
const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();
console.log(
  `[MongoDB] Connected — host: ${mongo.options.hosts?.map((h) => `${h.host}:${h.port}`).join(", ")}`,
);
const db = mongo.db("expense_tracker");
const expenses = db.collection<ExpenseDoc>("expenses");

// Create indexes for fast querying
await expenses.createIndex({ userId: 1, date: -1 });
await expenses.createIndex({ category: 1 });

// ── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── OpenRouter: parse receipt (image or text) ────────────────────────────────
async function parseExpense(
  text: string,
  imageUrl: string | null = null,
): Promise<ParsedExpense | null> {
  const userContent: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [];

  if (imageUrl) {
    userContent.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  userContent.push({
    type: "text",
    text: imageUrl
      ? `Extract expense info from this receipt image.${text ? `\n\nAdditional context: "${text}"` : ""}\n\nInfer the category from the merchant name and items. If you cannot determine the amount, set amount to null. Set date to null if not visible.`
      : `Extract expense info from this text message: "${text}"\n\nThe message may be in the form "<description> <amount>", e.g. "gas 30 euros", "gas € 30", "supermarket €47.50", "lunch 12.5". Parse the numeric amount directly from the text — do NOT set amount to null just because there is no formal receipt. Only set amount to null if no number is present at all. Infer the category from the description. Set date to null unless explicitly mentioned.`,
  });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: userContent }],
      max_tokens: 300,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_expense",
          strict: true,
          schema: {
            type: "object",
            properties: {
              merchant: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description: "Store or place name, or null if unknown",
              },
              amount: {
                anyOf: [{ type: "number" }, { type: "null" }],
                description:
                  "Expense amount as a number, or null if not determinable",
              },
              currency: {
                type: "string",
                description: "ISO 4217 currency code, e.g. EUR",
              },
              category: {
                type: "string",
                enum: [
                  "Groceries",
                  "Fuel",
                  "Dining",
                  "Transport",
                  "Health",
                  "Shopping",
                  "Utilities",
                  "Entertainment",
                  "Other",
                ] satisfies ExpenseCategory[],
                description:
                  "Expense category inferred from merchant and items",
              },
              items: {
                type: "array",
                items: { type: "string" },
                description: "Notable items if visible, otherwise empty array",
              },
              date: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description:
                  "Date in YYYY-MM-DD format, or null if not visible",
              },
            },
            required: [
              "merchant",
              "amount",
              "currency",
              "category",
              "items",
              "date",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(
      `[OpenRouter] HTTP ${res.status} ${res.statusText} — body: ${errBody}`,
    );
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string };
  };

  if (data.error) {
    console.error(
      `[OpenRouter] API error — code: ${data.error.code}, message: ${data.error.message}`,
    );
    return null;
  }

  const raw = data.choices?.[0]?.message?.content ?? "";
  console.log(`[OpenRouter] Raw response: ${raw}`);

  try {
    return JSON.parse(raw) as ParsedExpense;
  } catch (err) {
    console.error(
      `[OpenRouter] JSON parse failed — raw: "${raw}", error: ${err}`,
    );
    return null;
  }
}

// ── Format the confirmation message ─────────────────────────────────────────
function formatConfirmation(
  parsed: ParsedExpense | null,
  docId: string,
): string {
  if (!parsed || parsed.amount == null) {
    return "⚠️ Couldn't extract an amount from that. Try again with a clearer photo or something like `supermarket €47.50`.";
  }

  const categoryEmoji: Record<ExpenseCategory, string> = {
    Groceries: "🛒",
    Fuel: "⛽",
    Dining: "🍽️",
    Transport: "🚌",
    Health: "💊",
    Shopping: "🛍️",
    Utilities: "💡",
    Entertainment: "🎬",
    Other: "📦",
  };

  const emoji = categoryEmoji[parsed.category] ?? "📦";
  const merchant = parsed.merchant ? ` @ ${parsed.merchant}` : "";
  const items = parsed.items?.length
    ? `\n> 📝 ${parsed.items.slice(0, 4).join(", ")}${parsed.items.length > 4 ? "…" : ""}`
    : "";

  return `✅ **Logged!** \`${docId}\`\n${emoji} **${parsed.category}**${merchant}\n💶 **${parsed.amount.toFixed(2)} ${parsed.currency ?? "EUR"}**${items}`;
}

// ── Message handler ──────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (msg: Message) => {
  // Only listen to the designated channel, ignore bots
  if (msg.channelId !== EXPENSE_CHANNEL_ID || msg.author.bot) return;

  // Commands
  if (msg.content.startsWith("!summary")) {
    await handleSummary(msg);
    return;
  }
  if (msg.content.startsWith("!delete ")) {
    await handleDelete(msg);
    return;
  }

  // Expense logging: needs either an image or non-empty text
  const imageUrl = msg.attachments.first()?.url ?? null;
  const text = msg.content.trim();

  if (!imageUrl && !text) return;

  if ("sendTyping" in msg.channel) await msg.channel.sendTyping();

  try {
    const parsed = await parseExpense(text, imageUrl);

    const doc: ExpenseDoc = {
      userId: msg.author.id,
      username: msg.author.username,
      merchant: parsed?.merchant ?? null,
      amount: parsed?.amount ?? null,
      currency: parsed?.currency ?? "EUR",
      category: (parsed?.category ?? "Other") as ExpenseCategory,
      items: parsed?.items ?? [],
      date: parsed?.date ? new Date(parsed.date) : new Date(),
      loggedAt: new Date(),
      messageId: msg.id,
      rawText: text || null,
      hasImage: !!imageUrl,
    };

    console.log(
      `[DB] INSERT expense — user: ${msg.author.username} (${msg.author.id}), amount: ${doc.amount} ${doc.currency}, category: ${doc.category}, merchant: ${doc.merchant ?? "n/a"}`,
    );
    const result = await expenses.insertOne(doc);
    const shortId = result.insertedId.toString().slice(-6).toUpperCase();
    console.log(
      `[DB] INSERT OK — id: ${result.insertedId}, shortId: #${shortId}`,
    );

    if (parsed?.amount == null) {
      console.warn(
        `[Parse] Amount extraction failed — user: ${msg.author.username}, text: "${text}", imageUrl: ${imageUrl ?? "none"}, parsed:`,
        parsed,
      );
    }

    await msg.reply(formatConfirmation(parsed, `#${shortId}`));
  } catch (err) {
    console.error("Error processing expense:", err);
    await msg.reply("❌ Something went wrong. Check the logs.");
  }
});

// ── !summary [month?] ────────────────────────────────────────────────────────
async function handleSummary(msg: Message): Promise<void> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const pipeline = [
    {
      $match: {
        userId: msg.author.id,
        date: { $gte: start, $lte: end },
        amount: { $ne: null },
      },
    },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ];

  console.log(
    `[DB] READ summary — user: ${msg.author.username} (${msg.author.id}), range: ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
  );
  const rows = await expenses.aggregate<SummaryRow>(pipeline).toArray();
  console.log(
    `[DB] READ summary OK — ${rows.length} categories, grand total: ${rows.reduce((s, r) => s + r.total, 0).toFixed(2)}`,
  );

  if (!rows.length) {
    await msg.reply("No expenses logged this month yet.");
    return;
  }

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const month = now.toLocaleString("en", { month: "long", year: "numeric" });

  const categoryEmoji: Record<ExpenseCategory, string> = {
    Groceries: "🛒",
    Fuel: "⛽",
    Dining: "🍽️",
    Transport: "🚌",
    Health: "💊",
    Shopping: "🛍️",
    Utilities: "💡",
    Entertainment: "🎬",
    Other: "📦",
  };

  const lines = rows.map((r) => {
    const emoji = categoryEmoji[r._id] ?? "📦";
    return `${emoji} **${r._id}**: €${r.total.toFixed(2)} (${r.count}x)`;
  });

  await msg.reply(
    `📊 **${month} Summary**\n${lines.join("\n")}\n\n💶 **Total: €${grandTotal.toFixed(2)}**`,
  );
}

// ── !delete <ID> ─────────────────────────────────────────────────────────────
async function handleDelete(msg: Message): Promise<void> {
  const shortId = msg.content.split(" ")[1]?.replace("#", "").toUpperCase();
  if (!shortId) {
    await msg.reply("Usage: `!delete #ABC123`");
    return;
  }

  // Find most recent doc for this user where last 6 chars of _id match
  const all = await expenses
    .find({ userId: msg.author.id })
    .sort({ loggedAt: -1 })
    .limit(50)
    .toArray();
  const match = all.find(
    (d) => d._id!.toString().slice(-6).toUpperCase() === shortId,
  );

  if (!match) {
    await msg.reply(`❌ No expense found with ID \`#${shortId}\`.`);
    return;
  }

  console.log(
    `[DB] DELETE expense — user: ${msg.author.username} (${msg.author.id}), shortId: #${shortId}, amount: ${match.amount} ${match.currency}, category: ${match.category}`,
  );
  await expenses.deleteOne({ _id: match._id });
  console.log(`[DB] DELETE OK — id: ${match._id}`);
  await msg.reply(
    `🗑️ Deleted: **${match.category}** €${match.amount?.toFixed(2)} @ ${match.merchant ?? "unknown"}`,
  );
}

// ── Start ────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`[Discord] Logged in as ${client.user!.tag}`);
  console.log(`[Discord] Listening on channel ID: ${EXPENSE_CHANNEL_ID}`);

  client.channels
    .fetch(EXPENSE_CHANNEL_ID)
    .then((channel) => {
      if (channel && "guild" in channel && channel.guild) {
        console.log(
          `[Discord] Server: ${channel.guild.name} — #${"name" in channel ? channel.name : "unknown"}`,
        );
      }
    })
    .catch(() => {
      console.warn(
        `[Discord] Channel ${EXPENSE_CHANNEL_ID} not found — check the ID or bot permissions`,
      );
    });
});

client.login(DISCORD_TOKEN);
