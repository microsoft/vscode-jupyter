---
applyTo: '**/*.ts'
---

# Jupyter Extension Development Instructions

You MUST check compilation output before running ANY script or declaring work complete!

- **ALWAYS** check the "Core - Build" task output for compilation errors
- **ALWAYS** check the "Unittest - Build" task output for compilation errors
- **ALWAYS** run `npm run format-fix` before committing changes to ensure proper code formatting
- **NEVER** run tests if there are compilation errors
- **FIX** all compilation errors before moving forward

## TypeScript Compilation steps

Typescript compilation errors can be found by running the "Core - Build" and "Unitest - Build" tasks:
- **Core - Build**: Compiles the main TypeScript sources
- **Unittest - Build**: Compiles the unit tests
- These background tasks may already be running from previous development sessions
- If not already running, start them to get real-time compilation feedback
- The tasks provide incremental compilation, so they will automatically recompile when files change

## Unit Tests
- When a mock is returned from a promise, ensure the mocked instance has an undefined `then` property to avoid hanging tests. Here's an example:
```typescript
import { mock } from 'ts-mockito';
const mockInstance = mock<YourType>();
mockInstance.then = undefined; // Ensure 'then' is undefined to prevent hanging
```

## Scripts
- Use `npm install` to install dependencies if you changed `package.json`
- Use `npm run test:unittests` for unit tests (add `--grep <pattern>` to filter tests)
- Use `npm run lint` to check for linter issues
- Use `npm run format` to check code style
- Use `npm run format-fix` to auto-fix formatting issues
