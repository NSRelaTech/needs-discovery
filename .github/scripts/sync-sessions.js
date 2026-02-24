/**
 * Sync completed Harmonica sessions to the sessions/ directory.
 * Searches for NSRT-related sessions, checks which are already saved,
 * and writes new ones as markdown files.
 *
 * Requires: HARMONICA_API_KEY, HARMONICA_API_URL env vars.
 */

const fs = require('fs');
const path = require('path');

const API_URL = (process.env.HARMONICA_API_URL || 'https://app.harmonica.chat').replace(/\/+$/, '');
const API_KEY = process.env.HARMONICA_API_KEY;

if (!API_KEY) {
  console.error('HARMONICA_API_KEY is required');
  process.exit(1);
}

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

// Search queries that match NSRT-related sessions.
// Keep these specific to avoid pulling in unrelated sessions.
const SEARCH_QUERIES = ['NSRT', 'neighborhood tools'];

// Keywords that must appear in the session topic, goal, or context
// to confirm it's actually an NSRT/needs-discovery session.
const RELEVANCE_KEYWORDS = ['nsrt', 'novi sad', 'neighborhood', 'neighbors', 'residents', 'mesna zajednica'];

async function api(endpoint) {
  const res = await fetch(`${API_URL}/api/v1${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API error ${res.status}: ${body?.error?.message || res.statusText}`);
  }
  return res.json();
}

function getExistingSessionIds() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    return new Set();
  }
  const files = fs.readdirSync(SESSIONS_DIR);
  const ids = new Set();
  for (const file of files) {
    // Extract session ID from filename: YYYY-MM-DD-hst_xxxxx.md
    const match = file.match(/(hst_[a-f0-9]+)\.md$/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

function formatDate(isoString) {
  return isoString.split('T')[0];
}

function sanitizeForFilename(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function buildMarkdown(session, summary, responses) {
  const lines = [];

  lines.push(`# ${session.topic}`);
  lines.push('');
  lines.push(`**Session ID:** ${session.id}`);
  lines.push(`**Date:** ${formatDate(session.created_at)}`);
  lines.push(`**Status:** ${session.status}`);
  lines.push(`**Participants:** ${session.participant_count}`);
  lines.push(`**Goal:** ${session.goal}`);
  if (session.critical) {
    lines.push(`**Critical Question:** ${session.critical}`);
  }
  if (session.context) {
    lines.push('');
    lines.push('## Context');
    lines.push('');
    lines.push(session.context);
  }

  if (summary) {
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(summary);
  }

  if (responses && responses.length > 0) {
    lines.push('');
    lines.push('## Participant Responses');
    lines.push('');
    for (let i = 0; i < responses.length; i++) {
      const participant = responses[i];
      const userMessages = participant.messages.filter(m => m.role === 'user');
      if (userMessages.length === 0) continue;

      lines.push(`### Participant ${i + 1}`);
      lines.push('');
      for (const msg of userMessages) {
        lines.push(`> ${msg.content.replace(/\n/g, '\n> ')}`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push(`*Synced from [Harmonica](https://app.harmonica.chat) on ${new Date().toISOString().split('T')[0]}*`);
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const existingIds = getExistingSessionIds();
  console.log(`Found ${existingIds.size} existing sessions in sessions/`);

  // Collect unique sessions across all search queries.
  // Include both completed sessions and active sessions that have summaries,
  // since Harmonica sessions may stay "active" even after generating a summary.
  const sessionMap = new Map();

  for (const query of SEARCH_QUERIES) {
    for (const status of ['completed', 'active']) {
      try {
        const result = await api(`/sessions?q=${encodeURIComponent(query)}&status=${status}&limit=50`);
        for (const session of result.data) {
          if (!sessionMap.has(session.id)) {
            sessionMap.set(session.id, session);
          }
        }
      } catch (err) {
        console.warn(`Search for "${query}" (${status}) failed: ${err.message}`);
      }
    }
  }

  console.log(`Found ${sessionMap.size} NSRT sessions total`);

  // Filter to new sessions only
  const candidates = [...sessionMap.values()].filter(s => !existingIds.has(s.id));
  console.log(`${candidates.length} candidates to check for summaries`);

  if (candidates.length === 0) return;

  // Only sync sessions that are relevant and have a summary
  for (const session of candidates) {
    // Check relevance: topic or goal must contain an NSRT-related keyword
    const text = `${session.topic} ${session.goal}`.toLowerCase();
    if (!RELEVANCE_KEYWORDS.some(kw => text.includes(kw))) {
      console.log(`Skipping: ${session.topic} (${session.id}) — not NSRT-related`);
      continue;
    }
    const summaryResult = await api(`/sessions/${session.id}/summary`).catch(() => ({ summary: null }));

    if (!summaryResult.summary) {
      console.log(`Skipping: ${session.topic} (${session.id}) — no summary yet`);
      continue;
    }

    // Fetch full details to check participant count
    const details = await api(`/sessions/${session.id}`);

    if (details.participant_count < 1) {
      console.log(`Skipping: ${session.topic} (${session.id}) — no participants yet`);
      continue;
    }

    console.log(`Syncing: ${session.topic} (${session.id}) — ${details.participant_count} participants`);

    const responsesResult = await api(`/sessions/${session.id}/responses`).catch(() => ({ data: [] }));

    const markdown = buildMarkdown(
      details,
      summaryResult.summary,
      responsesResult.data,
    );

    const filename = `${formatDate(session.created_at)}-${session.id}.md`;
    const filepath = path.join(SESSIONS_DIR, filename);

    fs.writeFileSync(filepath, markdown);
    console.log(`  Written: ${filename}`);
  }

  console.log('Sync complete');
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
