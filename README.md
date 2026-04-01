# Expense Tracker Bot

A Discord bot that logs expenses from text messages and receipt photos, powered by AI and stored in MongoDB.

---

## How It Works

Send a message or photo to a designated Discord channel and the bot will:

1. Parse the expense using an AI model (via OpenRouter)
2. Categorize it automatically
3. Store it in MongoDB
4. Reply with a confirmation

**Text example:** `supermarket €47.50` or `gas 30 euros`  
**Image example:** attach a receipt photo (with optional description)

---

## Commands

| Command | Description |
|---|---|
| _(any message / image)_ | Log an expense |
| `!summary` | View a breakdown of your expenses for the current month |
| `!delete #ABC123` | Delete an expense by its short ID |

---

## Setup

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- A Discord bot token
- A MongoDB instance
- An [OpenRouter](https://openrouter.ai) API key

### Install

```bash
pnpm install
```

### Environment Variables

Create a `.env` file:

```env
DISCORD_TOKEN=your_discord_bot_token
OPENROUTER_API_KEY=your_openrouter_api_key
MONGODB_URI=your_mongodb_connection_string
EXPENSE_CHANNEL_ID=discord_channel_id_to_listen_on
MODEL=google/gemini-2.5-flash-lite   # optional, this is the default
```

### Run

```bash
# Development (with hot reload)
pnpm dev

# Production
pnpm start

# Build & run compiled output
pnpm build
pnpm start:dist
```

---

## Categories

Expenses are automatically classified into one of:

`Groceries` · `Fuel` · `Dining` · `Transport` · `Health` · `Shopping` · `Utilities` · `Entertainment` · `Other`

---

## Stack

- **[discord.js](https://discord.js.org)** — Discord bot framework
- **[OpenRouter](https://openrouter.ai)** — AI model API (Gemini Flash Lite by default)
- **[MongoDB](https://www.mongodb.com)** — Expense storage
- **TypeScript** — Type-safe throughout
