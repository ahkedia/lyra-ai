#!/usr/bin/env node

/**
 * Analyze Claude Setup - Correlate tweet themes with Claude setup patterns
 *
 * This script reads the Twitter Insights database and looks for patterns
 * that might suggest workflow improvements or optimization opportunities.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const TWITTER_INSIGHTS_DB_ID = process.env.TWITTER_INSIGHTS_DB_ID;
const CONTENT_IDEAS_DB_ID = process.env.CONTENT_IDEAS_DB_ID;
const RECRUITER_TRACKER_DB_ID = process.env.RECRUITER_TRACKER_DB_ID;

// Theme categories and their work patterns
const THEME_PATTERNS = {
  'infrastructure': ['server', 'deployment', 'cost', 'optimization'],
  'AI': ['model', 'training', 'inference', 'eval', 'prompt'],
  'fintech': ['payment', 'banking', 'crypto', 'trading', 'compliance'],
  'product': ['feature', 'UX', 'design', 'user', 'adoption'],
  'recruiting': ['hiring', 'interview', 'career', 'growth', 'leadership'],
  'personal': ['learning', 'reflection', 'lifestyle', 'health', 'mindset']
};

// Helper: Make HTTPS request to Notion API
async function notionRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.notion.com/v1${endpoint}`);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Main analysis function
async function analyzeClaudeSetup() {
  console.log('[analyze-claude-setup] Starting Claude setup analysis...');

  try {
    // Step 1: Fetch recent tweets from Twitter Insights DB
    console.log('[analyze-claude-setup] Fetching recent tweets from Twitter Insights...');

    const recentTweetsResponse = await notionRequest('POST', `/databases/${TWITTER_INSIGHTS_DB_ID}/query`, {
      filter: {
        property: 'Generated At',
        date: {
          past_week: {}
        }
      },
      sorts: [{ property: 'Generated At', direction: 'descending' }]
    });

    const tweets = recentTweetsResponse.results || [];
    console.log(`[analyze-claude-setup] Found ${tweets.length} tweets from past week`);

    if (tweets.length === 0) {
      console.log('[analyze-claude-setup] No recent tweets to analyze');
      return {
        tweet_count: 0,
        theme_distribution: {},
        suggestions: [
          {
            theme: 'general',
            observation: 'No bookmarked tweets this week',
            suggestion: 'Keep bookmarking interesting ideas - they inform product improvements',
            estimated_impact: 'Consistent tweet bookmarking builds content library over time'
          }
        ]
      };
    }

    // Step 2: Extract themes and build distribution
    console.log('[analyze-claude-setup] Analyzing theme distribution...');

    const themes = {};
    const themeTimeline = {};

    for (const tweet of tweets) {
      const themesProperty = tweet.properties?.Themes?.multi_select || [];
      const generatedAt = tweet.properties?.['Generated At']?.date?.start || new Date().toISOString();

      for (const theme of themesProperty) {
        themes[theme.name] = (themes[theme.name] || 0) + 1;

        if (!themeTimeline[theme.name]) themeTimeline[theme.name] = [];
        themeTimeline[theme.name].push(generatedAt);
      }
    }

    console.log(`[analyze-claude-setup] Theme distribution:`, themes);

    // Step 3: Fetch work patterns from Content Ideas database
    console.log('[analyze-claude-setup] Fetching recent work patterns from Content Ideas...');

    let contentIdeasResponse = { results: [] };
    if (CONTENT_IDEAS_DB_ID) {
      try {
        contentIdeasResponse = await notionRequest('POST', `/databases/${CONTENT_IDEAS_DB_ID}/query`, {
          sorts: [{ property: 'Created', direction: 'descending' }],
          page_size: 50
        });
      } catch (e) {
        console.log(`[analyze-claude-setup] Warning: Could not fetch Content Ideas (${e.message})`);
      }
    }

    const workPatterns = {};
    for (const idea of contentIdeasResponse.results || []) {
      const status = idea.properties?.Status?.select?.name || 'unknown';
      workPatterns[status] = (workPatterns[status] || 0) + 1;
    }

    console.log(`[analyze-claude-setup] Work patterns:`, workPatterns);

    // Step 4: Generate insights and suggestions
    console.log('[analyze-claude-setup] Generating insights...');

    const suggestions = [];
    const sortedThemes = Object.entries(themes).sort((a, b) => b[1] - a[1]);

    // Insight 1: Theme concentration
    const topTheme = sortedThemes[0];
    if (topTheme && topTheme[1] > 3) {
      suggestions.push({
        theme: topTheme[0],
        observation: `High focus on "${topTheme[0]}" (${topTheme[1]} bookmarks this week)`,
        suggestion: `Consider creating a skill or workflow specifically for "${topTheme[0]}" work`,
        estimated_impact: 'Could save 10-15 min per day on related tasks'
      });
    }

    // Insight 2: Theme diversity
    if (sortedThemes.length >= 4) {
      suggestions.push({
        theme: 'general',
        observation: `Working across ${sortedThemes.length} different domains (${sortedThemes.map(t => t[0]).join(', ')})`,
        suggestion: 'Context switching is high. Consider batching work by theme (e.g., "AI Tuesday", "Recruiting Thursday")',
        estimated_impact: 'Could improve focus and reduce context switch overhead'
      });
    }

    // Insight 3: Gap analysis
    const bookmarkThemes = sortedThemes.map(t => t[0]);
    const workThemes = Object.keys(workPatterns);
    const gaps = bookmarkThemes.filter(t => !workThemes.includes(t));
    if (gaps.length > 0) {
      suggestions.push({
        theme: 'alignment',
        observation: `Bookmarking "${gaps[0]}" ideas but no active projects in that area`,
        suggestion: `Start a small project or skill to explore "${gaps[0]}" ideas you're collecting`,
        estimated_impact: 'Could uncover next product opportunity or learning area'
      });
    }

    // Insight 4: Recruiter positioning
    const recruiterReady = tweets.filter(t => t.properties?.['For Recruiter']?.checkbox).length;
    if (recruiterReady >= 5) {
      suggestions.push({
        theme: 'recruiting',
        observation: `${recruiterReady} content bytes ready for recruiter outreach`,
        suggestion: 'Consolidate these into a 3-5 piece content brief for next recruiter conversation',
        estimated_impact: 'Could increase recruiter response rate by 20-30%'
      });
    }

    // Insight 5: Token optimization
    if (sortedThemes.length > 4) {
      suggestions.push({
        theme: 'efficiency',
        observation: `Running diverse model tiers across ${sortedThemes.length} domains`,
        suggestion: 'Group similar work types and use consistent model tier (MiniMax for simple, Haiku for moderate, Sonnet for synthesis)',
        estimated_impact: 'Could reduce daily API costs by 15-20%'
      });
    }

    // If no suggestions generated, add a default one
    if (suggestions.length === 0) {
      suggestions.push({
        theme: 'general',
        observation: 'Consistent bookmarking and synthesis happening',
        suggestion: 'Keep the momentum - you\'re building a strong idea corpus for future work',
        estimated_impact: 'Ideas compound over time'
      });
    }

    return {
      tweet_count: tweets.length,
      theme_distribution: themes,
      top_themes: sortedThemes.slice(0, 3).map(t => t[0]),
      suggestions,
      generated_at: new Date().toISOString()
    };

  } catch (error) {
    console.error('[analyze-claude-setup] Error:', error.message);
    return {
      tweet_count: 0,
      theme_distribution: {},
      suggestions: [
        {
          theme: 'error',
          observation: `Analysis failed: ${error.message}`,
          suggestion: 'Check that NOTION_API_KEY and database IDs are configured correctly',
          estimated_impact: 'None - analysis needs to succeed to provide insights'
        }
      ],
      error: error.message
    };
  }
}

// Run if called directly
if (require.main === module) {
  analyzeClaudeSetup().then(result => {
    console.log('\n=== Claude Setup Analysis ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.error ? 1 : 0);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { analyzeClaudeSetup };
