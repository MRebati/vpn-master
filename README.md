# VPN Master Telegram Bot

This is a Telegram bot for managing VPN subscriptions, built with [grammY](https://grammy.dev/) and deployed on Cloudflare Workers.

## Features

- 🛍 Purchase VPN subscriptions
- 🔄 Renew existing subscriptions
- 💳 Handle payments via card transfer
- 👥 User session management
- 📱 Beautiful Persian interface with buttons
- 🧾 Unique transaction IDs for reliable payment tracking

## Setup

1. Create a new Telegram bot with [@BotFather](https://t.me/botfather) and get your bot token
2. Sign up for [Cloudflare Workers](https://workers.dev)
3. Install dependencies:
   ```bash
   npm install
   ```
4. Set up a Supabase project and create the database tables:
   ```bash
   # Run the database setup script in the Supabase SQL editor
   cat setup-database.sql | pbcopy  # Copy to clipboard
   ```
5. Set up your environment variables in `wrangler.jsonc`:
   - `BOT_TOKEN`: Your Telegram bot token
   - `ADMIN_USER_ID`: Your Telegram user ID (to receive payment notifications)
   - `CARD_NUMBER`: Your bank card number for receiving payments
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase anon/public key

## Development

1. Run `wrangler dev` to start the bot locally
2. Use [ngrok](https://ngrok.com) to create a tunnel to your local server
3. Set the webhook URL for your bot:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<YOUR_NGROK_URL>
   ```

## Deployment

1. Run `wrangler deploy` to deploy to Cloudflare Workers
2. Set the webhook URL to your Cloudflare Worker URL:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
   ```

## Usage

1. Start the bot by sending `/start`
2. Use the menu buttons to:
   - Purchase a new subscription
   - Renew an existing subscription
   - Get help
   - Contact support
3. Follow these steps to complete your purchase:
   - Select your desired subscription plan
   - Enter your preferred username
   - Make payment to the provided card number
   - Send the last 6 digits of your card
4. Once payment is verified, you'll receive your VPN account details

## Payment System

The bot uses a unique transaction ID system to track payments reliably:

- Each payment gets a unique ID in the format `TXN-XXXXXX-XXX`
- Users see this ID in their payment instructions
- Admins see this ID in payment notifications
- When making payment, users only need to provide the last 6 digits of their card
- This helps with tracking and reconciliation of payments

## Database Migration

If you're upgrading from a previous version without transaction IDs, run the provided migration script:

```bash
# Run the migration script in the Supabase SQL editor
cat migration-add-transaction-id.sql | pbcopy  # Copy to clipboard
```
