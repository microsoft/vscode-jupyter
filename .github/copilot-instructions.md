# Jupyter Extension - Copilot Instructions

This file provides repository-wide instructions for the Jupyter Extension. These guidelines help Copilot generate code, documentation, and suggestions that match the conventions, architecture, and workflows of the vscode-jupyter project.

---

## Project Overview

The **Jupyter Extension for Visual Studio Code** is a comprehensive extension that brings the full power of Jupyter notebooks to VS Code. It provides:

-   **Multi-language support**: Works with any Jupyter kernel (Python, R, Julia, C#, etc.)
-   **Cross-platform compatibility**: Functions identically in desktop VS Code, vscode.dev, and GitHub Codespaces
-   **Native integration**: Built on VS Code's native notebook API for optimal performance and UX
-   **Rich data science features**: Interactive computing, variable exploration, debugging, and visualization

## Tech Stack & Dependencies

### Core Technologies

-   **TypeScript**: Primary language with strict type checking enabled
-   **Node.js**: Runtime for desktop functionality
-   **Inversify**: Dependency injection container
-   **VS Code Extension API**: Core platform integration
-   **Mocha + Chai**: Unit testing with assertion library
-   **ts-mockito**: Mocking framework for TypeScript
-   **VS Code Test Runner**: Integration testing in VS Code environment
-   **Sinon**: Test spies, stubs, and fake timers

### Build, Development & Testing Tools

-   Use `npm install` to install dependencies
-   Use `npm run compile` for development builds (but in watch mode)
-   Use `npm run compile-nowatch` for non-incremental builds (useful on CI or Agents)
-   Use `npm run test:unittests` for unit tests
-   Use `npm run lint` to check code style issues and use `npm run lint-fix` to fix issues before submitting changes
-   Use `npm run format-check` to check formatting issues and use `npm run format` to fix formatting issues before submitting changes

## Coding Standards & Best Practices

### Code Organization Principles

-   **Platform Implementations**:
    -   **Desktop** (`*.node.ts`): Suffix intended for desktop implementations with full file system access, and Python environments.
    -   **Web** (`*.web.ts`): Suffix intended for web implementations with browser-compatible APIs.
    -   **Common** (`*.ts`): Suffix intended for shared logic that works across both platforms.

### Testing Requirements

-   Unit testing with assertion library (files ending with `*.unit.test.ts`)
-   Place alongside implementation as `<filename>.unit.test.ts`
-   VS Integration testing in VS Code environment (files ending with `*.test.ts`, but not `*.unit.test.ts`)
-   Use Mocha's TDD interface (`suite`, `test`, `setup`, `teardown`)
-   Follow AAA pattern (Arrange, Act, Assert)

### Error Handling & Logging

-   All user-facing messages must use `l10n.t()` from `src/platform/common/utils/localize.ts`
-   Use typed error classes in `src/platform/errors/`
-   Use injected `ILogger` service, not console.log

### Code Quality

-   All files must include Microsoft copyright header
-   Prefer async/await over Promises, handle cancellation with CancellationToken
-   Use `npm run lint` and `npm run format-check` to ensure code style consistency.

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
-   `src/kernels/jupyter` found in `.github/instructions/kernel-jupyter.instructions.md`
-   `src/notebooks` found in `.github/instructions/notebooks.instructions.md`
-   `src/platform` found in `.github/instructions/platform.instructions.md`
-   `src/standalone` found in `.github/instructions/standalone.instructions.md`

---

This extension is a complex, multi-layered system that provides comprehensive Jupyter notebook support within VS Code. Understanding the service architecture, contribution system, and separation between platform and extension layers is crucial for making effective changes.
