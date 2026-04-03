#!/usr/bin/env node

/**
 * Aggregate Morning Digest - Combine news, calendar, weather, and Twitter Insights
 *
 * This script fetches all morning digest components and produces a single
 * formatted output for the daily 7am Telegram notification.
 */

const https = require('https');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const TWITTER_INSIGHTS_DB_ID = process.env.TWITTER_INSIGHTS_DB_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Helper: Make HTTPS request
async function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// Fetch Twitter Insights entries from past 24h
async function fetchTwitterInsights() {
  console.log('[digest] Fetching Twitter Insights...');

  try {
    const url = 'https://api.notion.com/v1/databases/' + TWITTER_INSIGHTS_DB_ID + '/query';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const response = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: {
        filter: {
          property: 'Generated At',
          date: {
            on_or_after: yesterday.toISOString().split('T')[0]
          }
        },
        sorts: [{ property: 'For Recruiter', direction: 'descending' }],
        page_size: 10
      }
    });

    const entries = response.results || [];
    console.log(`[digest] Found ${entries.length} Twitter Insights entries`);

    // Format for digest
    const formatted = entries.slice(0, 3).map(entry => {
      const byte = entry.properties?.['Content Byte']?.title?.[0]?.text?.content || '';
      const type = entry.properties?.Type?.select?.name || '';
      const forRecruiter = entry.properties?.['For Recruiter']?.checkbox ? '⭐' : '';

      return `${forRecruiter} [${type}] ${byte}`;
    });

    return {
      count: entries.length,
      preview: formatted,
      section: formatted.length > 0 ? `📱 TWITTER INSIGHTS\n${formatted.join('\n')}` : null
    };

  } catch (error) {
    console.log(`[digest] Warning: Could not fetch Twitter Insights (${error.message})`);
    return { count: 0, preview: [], section: null };
  }
}

// Fetch recent activity from Lyra memory
async function fetchRecentActivity() {
  console.log('[digest] Fetching recent activity...');

  try {
    // This would normally read from /root/.openclaw/workspace/memory/YYYY-MM-DD.md
    // For now, return empty (can be implemented later)
    return {
      section: null
    };
  } catch (error) {
    console.log(`[digest] Warning: Could not fetch recent activity`);
    return { section: null };
  }
}

// Build the complete digest message
async function buildDigest() {
  console.log('[digest] Building morning digest...');

  const sections = [];

  // Header
  sections.push('🌅 MORNING DIGEST');
  sections.push('─'.repeat(40));
  sections.push('');

  // Fetch all components
  const twitter = await fetchTwitterInsights();
  const activity = await fetchRecentActivity();

  // Add sections
  if (twitter.section) {
    sections.push(twitter.section);
    sections.push('');
  }

  if (activity.section) {
    sections.push(activity.section);
    sections.push('');
  }

  // Footer with stats
  sections.push('─'.repeat(40));
  sections.push(`📊 Stats: ${twitter.count} Twitter insights`);
  sections.push(`Generated: ${new Date().toLocaleString()}`);

  const message = sections.join('\n');
  return message;
}

// Send to Telegram
async function sendTelegramMessage(message) {
  console.log('[digest] Sending to Telegram...');

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[digest] Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }
    });

    console.log('[digest] Sent successfully');
    return true;
  } catch (error) {
    console.error('[digest] Error sending to Telegram:', error.message);
    return false;
  }
}

// Main function
async function main() {
  try {
    const message = await buildDigest();
    console.log('\n=== DIGEST PREVIEW ===');
    console.log(message);
    console.log('\n');

    const sent = await sendTelegramMessage(message);
    process.exit(sent ? 0 : 1);
  } catch (error) {
    console.error('[digest] Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildDigest, sendTelegramMessage };
