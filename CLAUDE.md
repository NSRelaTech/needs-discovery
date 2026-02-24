# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Discovery research for [NSRelaTech](https://github.com/NSRelaTech) — what do Novi Sad neighbors actually need? Session results and synthesized findings guide what NSRT builds.

This is a content repo, not an application. No build step, no dependencies, no tests.

## Structure

- `sessions/` — Auto-synced session results. Do not edit manually — they get overwritten on next sync.
- `findings/` — Human-written synthesis of patterns across sessions. Analysis and recommendations go here.

## Automation

Session results sync automatically every 6 hours via GitHub Actions. To trigger manually: `gh workflow run sync-sessions.yml`
