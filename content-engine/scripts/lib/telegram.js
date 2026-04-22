/**
 * Telegram Bot API utilities
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_USER_ID;
const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export async function sendTelegram(text, chatId = TELEGRAM_CHAT_ID) {
  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram sendMessage: ${json.description}`);
  }
  return json.result;
}

export async function sendPhoto(photoUrl, caption, chatId = TELEGRAM_CHAT_ID) {
  // Handle base64 data URLs (from Nano Banana/Gemini)
  if (photoUrl.startsWith("data:")) {
    const matches = photoUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Invalid data URL format");
    }
    const [, mimeType, base64Data] = matches;
    const buffer = Buffer.from(base64Data, "base64");
    const ext = mimeType.split("/")[1] || "png";
    
    // Use FormData for cleaner multipart handling
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("caption", caption);
    formData.append("parse_mode", "Markdown");
    formData.append("photo", new Blob([buffer], { type: mimeType }), `image.${ext}`);
    
    const res = await fetch(`${BASE_URL}/sendPhoto`, {
      method: "POST",
      body: formData,
    });
    
    const json = await res.json();
    if (!json.ok) {
      throw new Error(`Telegram sendPhoto: ${json.description}`);
    }
    return json.result;
  }
  
  // Regular URL
  const res = await fetch(`${BASE_URL}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "Markdown",
    }),
  });
  
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram sendPhoto: ${json.description}`);
  }
  return json.result;
}

export async function getTelegramUpdates(offset, timeout = 30) {
  const params = new URLSearchParams({ timeout: timeout.toString() });
  if (offset) params.set("offset", offset.toString());
  
  const res = await fetch(`${BASE_URL}/getUpdates?${params}`);
  const json = await res.json();
  
  if (!json.ok) {
    throw new Error(`Telegram getUpdates: ${json.description}`);
  }
  return json.result;
}

export function validateChatId(update) {
  const messageChatId = update.message?.chat?.id?.toString();
  return messageChatId === TELEGRAM_CHAT_ID;
}

export function getMessageText(update) {
  return update.message?.text?.trim().toUpperCase() || "";
}

export function getReplyToMessageId(update) {
  return update.message?.reply_to_message?.message_id || null;
}
