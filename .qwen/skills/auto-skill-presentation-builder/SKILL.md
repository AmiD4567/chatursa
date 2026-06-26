---
name: presentation-builder
description: Generate structured business presentations from project data using repository analysis and narrative flow (problem → solution → implementation → results → next steps)
source: auto-skill
extracted_at: '2026-06-24T13:58:00.000Z'
---

# Presentation Builder Skill

## Overview

This skill analyzes a project repository to extract relevant information and generates a structured business presentation with 8–12 slides following a logical narrative flow (problem → solution → implementation → results → next steps). Each slide includes a clear title, 3–5 key bullet points, visualization recommendations, and speaker notes.

## When to Use

Use this skill when:
- The user requests a business presentation based on an existing project/repository
- You need to translate technical work into executive-friendly format
- Stakeholders require documentation of project achievements, metrics, or roadmap

## Data Sources

The skill systematically extracts information from these repository files:

### Core Project Files
- **`package.json`** (or equivalent): Project name, version, description, author, build scripts, dependencies — provides product identity and technical stack context.
- **`README.md`**: Feature list, usage instructions, architecture overview, technology choices — reveals what the project does and why it matters.
- **`LICENSE`**: Licensing model — indicates open-source vs proprietary positioning.

### Feature-Specific Files (as applicable)
- **UI/UX assets** (`emojiData.json`, icon files, design specs): Show user-facing features like emoji categories, avatars, notifications.
- **Backend configuration** (`app-update.yml`, `docker-compose.yml`): Deployment strategy, auto-update capabilities.
- **API documentation**: Endpoints, authentication methods — demonstrates technical depth and integration potential.

### Project History & Metrics
- **Git log** (`git -C <repo> log --oneline -20`): Recent commits reveal feature additions, bug fixes, version releases — provides timeline evidence of active development.
- **Tags/releases**: Version history shows maturity level (e.g., v1.0.x series indicates stable release track).

### Build & Distribution Artifacts
- **Electron build config** (`build.*` sections): Platform targets (Windows NSIS installer, MSI), auto-update provider (GitHub releases), icon assets — demonstrates production readiness.
- **Docker files**: Containerization strategy for deployment flexibility.

## Slide Structure

Each slide follows this template:

| Component | Description |
|-----------|-------------|
| **Title** | Result-oriented or value-focused heading (e.g., "Real-time messaging with persistent history" not just "Features") |
| **3–5 Bullet Points** | Concise, business-relevant facts extracted from repository evidence |
| **Visualization Recommendation** | Specific suggestion: chart type, screenshot location, icon set, comparative table format |
| **Speaker Notes** | 1–2 sentences on how to present this slide — what story arc it serves, which metric to emphasize |

## Narrative Flow

The skill organizes slides into a coherent business narrative:

1. **Problem/Opportunity**: What gap does the project address? (derived from README description and feature list)
2. **Solution Overview**: High-level architecture and approach (tech stack from package.json, design philosophy from code comments/docs)
3. **Key Features**: User-facing capabilities with evidence (emoji categories, notifications, file sharing — pulled from UI assets and documentation)
4. **Implementation Progress**: Timeline and milestones (git log analysis showing feature additions, version releases)
5. **Technical Excellence**: Build quality, deployment strategy, platform support (Electron config, Docker files)
6. **Results/Metrics**: Quantifiable outcomes where available (user counts, performance benchmarks — if documented)
7. **Challenges & Solutions**: What obstacles were overcome (derived from commit messages mentioning fixes or workarounds)
8. **Roadmap/Next Steps**: Planned features or scaling initiatives (if mentioned in docs or recent commits)

## Output Format

The skill returns a numbered list of slides with each containing:
- Slide number and title
- Bullet points as a sub-list
- Visualization recommendation
- Speaker notes

Followed by 3–5 practical recommendations covering design consistency, timing guidance for presentations, and handling audience questions.

## Example Usage Pattern

```
User: "Create a presentation about this chat app project"
Skill: Analyzes repository → extracts data from package.json, README.md, emojiData.json, git log → generates structured slide deck with business narrative flow
```

## Limitations & Notes

- This skill assumes the user has provided or can access a local repository path. If only remote URLs are available, additional tools (web_fetch, github) may be needed to gather data first.
- The skill focuses on evidence-based content — claims should always be traceable to actual files in the repository.
- For highly technical audiences, you may want to supplement with deeper code analysis; for executive presentations, keep slides high-level and visually engaging.
