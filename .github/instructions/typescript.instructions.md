---
applyTo: '**/*.ts'
---

# Jupyter Extension Development Instructions

## ⚠️ MANDATORY COMPILATION CHECK

**CRITICAL: You MUST check compilation output before running ANY script or declaring work complete!**

### Before running any command:
1. **ALWAYS** check the "Core - Build" task output for compilation errors
2. **ALWAYS** check the "Unittest - Build" task output for compilation errors
3. **NEVER** run tests if there are compilation errors
4. **FIX** all compilation errors before moving forward

## Scripts
- `npm install` to install dependencies if you changed `package.json`
- `npm run test:unittests` for unit tests (add `--grep <pattern>` to filter tests)
- `npm run lint|lint-fix` - code style
- `npm run format|format-fix` - formatting

## Compilation Tasks
Typescript compilation errors can be found by running the "Core - Build" and "Unitest - Build" tasks:
- **Core - Build**: Compiles the main TypeScript sources
- **Unittest - Build**: Compiles the unit tests
- These background tasks may already be running from previous development sessions
- If not already running, start them to get real-time compilation feedback
- The tasks provide incremental compilation, so they will automatically recompile when files change
