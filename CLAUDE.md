# Claude Development Guide

This document provides guidance for working with Claude on the Meet Recording Quiz Maker project.

## Project Overview

This is a Cloud Run service that converts Google Meet recordings (transcripts stored as Google Docs in Drive) into Google Forms quizzes using Gemini AI, with state tracked in Firestore.

### Tech Stack
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Hono (Express alternative)
- **Package Manager**: pnpm
- **AI**: Google Gemini (via Vercel AI SDK)
- **Google APIs**: Drive, Forms, Firestore
- **Linting/Formatting**: Biome (Prettier-style)

## Development Setup

```bash
# Install dependencies
pnpm install

# Run development server
pnpm run dev

# Lint and format
pnpm run lint
pnpm run format
```

### Environment Variables

Create a `.env` file based on `.env.example`. Required variables:
- `GOOGLE_DRIVE_FOLDER_ID`: Target Drive folder containing transcripts
- `GOOGLE_GENERATIVE_AI_API_KEY`: API key for Gemini
- `FIRESTORE_COLLECTION`: Firestore collection name

See `README.md` for optional variables.

## Code Style

- Use Biome for linting and formatting (Prettier-style configuration)
- Run `pnpm run lint:fix` before committing
- TypeScript strict mode is enabled

## Architecture Notes

### Key Components
- **Drive Client** (`src/services/drive.ts`): Lists and fetches Google Docs transcripts
- **Gemini Client** (`src/services/gemini.ts`): Generates quiz JSON from transcripts
- **Forms Client** (`src/services/forms.ts`): Creates Google Forms quizzes
- **Firestore** (`src/services/firestore.ts`): Tracks processing state

### API Endpoints
- `POST /tasks/scan`: Scans Drive folder for new/changed files
- `POST /tasks/process`: Processes a single file by fileId
- `POST /manual`: Processes a file from a Drive URL
- `GET /files/:fileId`: Returns file status and metadata
- `GET /`: Minimal UI for manual submission

## Working with Claude

### When Making Changes

1. **Understand the context**: Read relevant source files before making changes
2. **Test your changes**: Run `pnpm run dev` and test endpoints
3. **Lint before committing**: Run `pnpm run lint:fix` to ensure code quality
4. **Update documentation**: Keep README.md and this file up to date

### Common Tasks

#### Adding a new feature
1. Review existing code structure
2. Create or modify relevant service files in `src/services/`
3. Update route handlers in `src/index.ts` if needed
4. Test with real credentials
5. Update README.md with any new environment variables or endpoints

#### Debugging issues
1. Check Firestore for file processing status
2. Review logs from the service
3. Test with a small sample transcript first
4. Verify Google API permissions (Drive, Forms, Firestore)

#### Refactoring
1. Run existing code to understand current behavior
2. Make incremental changes
3. Test after each change
4. Use Biome to maintain consistent style

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `.agent/PLANS.md`) from design to implementation.

### What Requires an ExecPlan?

- Multi-service changes (e.g., modifying Drive + Gemini + Forms flow)
- New major features (e.g., adding authentication, webhook support)
- Significant architectural changes
- Complex debugging scenarios

### ExecPlan Process

1. **Analysis**: Understand the current implementation
2. **Design**: Plan the changes with clear steps
3. **Implementation**: Execute the plan incrementally
4. **Testing**: Verify each component works
5. **Documentation**: Update relevant docs

## Deployment

This service is designed to run on Google Cloud Run:

1. **Service Account**: Needs Drive (read-only), Forms (create/body), and Firestore access
2. **Cloud Scheduler**: Set up periodic calls to `/tasks/scan`
3. **Environment Variables**: Configure all required env vars in Cloud Run
4. **Monitoring**: Add logging and error tracking once basic flow is verified

## Resources

- **README.md**: Architecture and endpoint documentation
- **AGENTS.md**: ExecPlan guidelines
- **package.json**: Available scripts and dependencies
- **.env.example**: Required environment variables
- **biome.json**: Linting and formatting configuration

## Tips for Claude Sessions

1. **Start by reading**: Use Read tool to understand existing code
2. **Plan complex changes**: Use TodoWrite for multi-step tasks
3. **Test incrementally**: Don't make all changes at once
4. **Check git status**: Review changes before committing
5. **Follow conventions**: Match existing code style and patterns
6. **Ask for clarification**: If requirements are unclear, ask before implementing

## Known Limitations

- Currently no retry logic for API failures
- No authentication on endpoints (consider Basic Auth or IAP for production)
- No Drive file properties written back after processing
- Manual UI is minimal (single page for URL submission)

## Next Development Steps

See "Next steps" section in README.md for planned improvements.
