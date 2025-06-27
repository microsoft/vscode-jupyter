# Jupyter Extension - Copilot Instructions

This file provides repository-wide instructions for the Jupyter Extension. These guidelines help Copilot generate code, documentation, and suggestions that match the conventions, architecture, and workflows of the vscode-jupyter project.

---

## Project Overview

The **Jupyter Extension for Visual Studio Code** is a comprehensive extension that brings the full power of Jupyter notebooks to VS Code. It provides:

-   **Multi-language support**: Works with any Jupyter kernel (Python, R, Julia, C#, etc.)
-   **Cross-platform compatibility**: Functions identically in desktop VS Code, vscode.dev, and GitHub Codespaces
-   **Native integration**: Built on VS Code's native notebook API for optimal performance and UX
-   **Rich data science features**: Interactive computing, variable exploration, debugging, and visualization

### How It Works

The extension operates through a multi-layered architecture:

1. **Extension Host Layer**: Manages extension lifecycle, commands, and VS Code integration
2. **Platform Layer**: Provides cross-platform abstractions for file systems, processes, and UI
3. **Kernel Management Layer**: Discovers, connects to, and manages Jupyter kernels
4. **Notebook Layer**: Handles notebook editing, cell execution, and output rendering
5. **WebView Layer**: Renders rich outputs, variable viewers, and interactive components

The extension uses dependency injection (Inversify) to manage complex service relationships and supports both Node.js (desktop) and web browser environments through conditional compilation.

## Tech Stack & Dependencies

### Core Technologies

-   **TypeScript**: Primary language with strict type checking enabled
-   **Node.js**: Runtime for desktop functionality
-   **Inversify**: Dependency injection container
-   **VS Code Extension API**: Core platform integration

### Build & Development Tools

-   **ESBuild**: Fast TypeScript compilation and bundling
-   **Mocha**: Unit testing framework with TDD interface
-   **ESLint**: Code linting with TypeScript-specific rules
-   **Prettier**: Code formatting (disabled in favor of ESLint rules)

### Testing Infrastructure

-   **Mocha + Chai**: Unit testing with assertion library
-   **ts-mockito**: Mocking framework for TypeScript
-   **VS Code Test Runner**: Integration testing in VS Code environment
-   **Sinon**: Test spies, stubs, and fake timers

## Project Architecture

### Directory Structure & Responsibilities

**Root Level**

-   `package.json`: Extension manifest with commands, configuration, and activation events
-   `src/`: Main TypeScript source code
-   `build/`: Build scripts, webpack configs, and CI/CD tools
-   `pythonFiles/`: Python scripts for integration and helper functions
-   `resources/`: Static assets, icons, and walkthrough content
-   `types/`: TypeScript type definitions

**Core Source Structure (`src/`)**

```
src/
├── extension.common.ts          # Shared extension activation logic
├── extension.node.ts            # Desktop-specific entry point
├── extension.web.ts             # Web browser entry point
├── extension.node.proxy.ts      # Desktop proxy for bundle optimization
├── platform/                   # Cross-platform abstractions
│   ├── common/                 # Shared utilities and interfaces
│   ├── ioc/                    # Dependency injection container
│   ├── logging/                # Logging infrastructure
│   ├── telemetry/              # Usage analytics
│   ├── activation/             # Extension lifecycle management
│   ├── interpreter/            # Python environment discovery
│   ├── pythonEnvironments/     # Python environment management
│   └── webviews/               # WebView communication layer
├── kernels/                    # Kernel management and execution
│   ├── common/                 # Shared kernel interfaces
│   ├── jupyter/                # Jupyter protocol implementation
│   ├── raw/                    # Direct kernel process management
│   ├── execution/              # Cell execution logic
│   ├── variables/              # Variable inspection and data viewer
│   └── types.ts                # Kernel-related type definitions
├── notebooks/                  # Notebook editing and management
│   ├── controllers/            # VS Code notebook controllers
│   ├── export/                 # Export to HTML, PDF, etc.
│   ├── debugger/               # Notebook debugging support
│   ├── languages/              # Language-specific features
│   └── outputs/                # Cell output rendering
├── interactive-window/         # Python Interactive window (REPL)
│   ├── commands/               # Interactive window commands
│   ├── debugger/               # Interactive debugging
│   └── editor-integration/     # Integration with Python files
├── webviews/                   # Rich UI components
│   ├── extension-side/         # Extension-side webview logic
│   └── webview-side/           # Frontend React/HTML components
└── test/                       # Integration and end-to-end tests
```

**Refer to the following files for detailed instructions of files/components in relevant subdirectories:**

-   `src/interactive-window` found in `.github/instructions/interactiveWindow.instructions.md`
-   `src/kernels` found in `.github/instructions/kernel.instructions.md`
-   `src/notebooks` found in `.github/instructions/notebooks.instructions.md`
-   `src/platform` found in `.github/instructions/platform.instructions.md`
-   `src/standalone` found in `.github/instructions/standalone.instructions.md`

### Cross-Platform Architecture

The extension supports both desktop and web environments through:

**Desktop Implementation (`.node.ts` files)**

-   Full Node.js API access for file system, process spawning, and native modules
-   Direct kernel process management via child_process
-   ZeroMQ communication with kernels
-   Full Python environment discovery and management

**Web Implementation (`.web.ts` files)**

-   Browser-compatible APIs only
-   Remote kernel connections via HTTP/WebSocket
-   Limited file system access through VS Code APIs
-   No access to Python environments

**Shared Implementation (regular `.ts` files)**

-   Common business logic that works across platforms
-   VS Code API usage for UI and editor integration
-   Platform-agnostic utilities and interfaces

### Dependency Injection Architecture

The extension uses **Inversify** for dependency injection to manage complex service relationships:

**Container Setup** (`src/platform/ioc/`)

-   `serviceManager.ts`: Central service registration and resolution
-   `types.ts`: Service identifiers and interfaces
-   Service registries in each module (`serviceRegistry.node.ts`, `serviceRegistry.web.ts`)

**Registration Pattern**

```typescript
// Each module has platform-specific service registration
export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);
    serviceManager.add<IKernel>(IKernel, Kernel);
}
```

**Resolution Pattern**

```typescript
// Services are injected via constructor parameters
@injectable()
export class NotebookController {
    constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(ILogger) private logger: ILogger
    ) {}
}
```

## Coding Standards & Best Practices

### TypeScript Standards

-   **Strict TypeScript**: `strict: true` with `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`
-   **Interface over type**: Use interfaces for object types, type aliases for unions/intersections
-   **Naming conventions**: PascalCase for classes/interfaces, camelCase for variables/functions
-   **File naming**: Use kebab-case for file names, match the primary export name

### Code Organization Principles

-   **Feature-based organization**: Group by domain functionality, not technical layers
-   **Platform separation**: Use `.node.ts`/`.web.ts` suffixes for platform-specific code
-   **Dependency injection**: All services must use Inversify DI container
-   **Interface segregation**: Define small, focused interfaces rather than large ones
-   **Service boundaries**: Platform services (`src/platform/`) vs. extension features (`src/`)

### Testing Requirements

-   **Unit tests**: Place alongside implementation as `<filename>.unit.test.ts`
-   **TDD approach**: Use Mocha's TDD interface (`suite`, `test`, `setup`, `teardown`)
-   **Mocking**: Use `ts-mockito` for TypeScript-compatible mocks
-   **Test structure**: Follow AAA pattern (Arrange, Act, Assert)

### Error Handling & Logging

-   **Localization**: All user-facing messages must use `l10n.t()` from `src/platform/common/utils/localize.ts`
-   **Error propagation**: Use typed error classes in `src/platform/errors/`
-   **Logging**: Use injected `ILogger` service, not console.log

### Code Quality

-   **ESLint rules**: Follow the extensive ruleset in `.eslintrc.js`
-   **Copyright headers**: All files must include Microsoft copyright header
-   **Async patterns**: Prefer async/await over Promises, handle cancellation with CancellationToken

### Forbidden Patterns

-   **No use of `__dirname` or `__filename`** in non-`.node.ts` files
-   **No use of `process.env`** in non-`.node.ts` files
-   **No use of `fsPath`** property in non-`.node.ts` files
-   These restrictions are enforced by custom ESLint rules

### Module Dependencies

Strict architectural boundaries are enforced via ESLint rules:

-   **`src/platform/`**: No imports from non-platform modules
-   **`src/kernels/`**: Can only import from `platform/` and `telemetry/`
-   **`src/notebooks/`**: Can import from `platform/`, `telemetry/`, and `kernels/`
-   **`src/interactive-window/`**: Can import from `platform/`, `telemetry/`, `kernels/`, and `notebooks/`
-   **`src/webviews/`**: Cannot be imported into core components
-   **`src/standalone/`**: Cannot be imported into other components

## Development Workflow

-   Use `npm install` to install dependencies
-   Use `npm run compile` for development builds (but in watch mode)
-   Use `npm run compile-nowatch` for non-incremental builds (useful on CI or Agents)
-   Use `npm run test:unittests` for unit tests
-   Use `npm run lint` to check code style issues and use `npm run lint-fix` to fix issues before submitting changes
-   Use `npm run format-check` to check formatting issues and use `npm run format` to fix formatting issues before submitting changes
-   All new features and bug fixes must include appropriate tests

## Key Component Responsibilities

-   **Notebook Management** (`notebooks/`): Notebook editor interface, controllers for kernel selection and cell execution, export functionality
-   **Kernel Management** (`kernels/`): Discovering and connecting to kernels, executing code, managing kernel lifecycle, handling output
-   **Interactive Window** (`interactive-window/`): REPL-like experience as an alternative to notebooks
-   **Platform Abstraction** (`platform/`): Cross-platform utilities, logging, telemetry, file system abstraction

## Pull Requests & Issues

-   PRs should be focused, well-scoped, and include a clear description of the problem and solution
-   Include acceptance criteria and specify which files are affected
-   Write unit and/or integration tests for new features and bug fixes
-   Document public APIs and complex logic
-   Use comments to iterate on PRs—Copilot will respond to review comments from users with write access

## Security & Privacy

-   Do not include secrets, credentials, or sensitive data in code, tests, or documentation
-   Follow best practices for handling user data and authentication
-   Do not reference external resources or private documentation in instructions

### Dependency Injection

The extension uses Inversify for dependency injection, which helps manage the complex web of dependencies between different components. The IoC (Inversion of Control) container is set up in `src/platform/ioc`

---

This extension is a complex, multi-layered system that provides comprehensive Jupyter notebook support within VS Code. Understanding the service architecture, contribution system, and separation between platform and extension layers is crucial for making effective changes.
