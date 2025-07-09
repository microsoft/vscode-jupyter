# Jupyter Extension - Copilot Instructions

This file provides repository-wide instructions for the Jupyter Extension. These guidelines help Copilot generate code, documentation, and suggestions that match the conventions, architecture, and workflows of the vscode-jupyter project.

---

## Project Overview

The **Jupyter Extension for Visual Studio Code** is a comprehensive extension that brings the full power of Jupyter notebooks to VS Code. It provides:

-   **Multi-language support**: Works with any Jupyter kernel (Python, R, Julia, C#, etc.)
-   **Cross-platform compatibility**: Functions identically in desktop VS Code, vscode.dev, and GitHub Codespaces
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
-   Use `npm run compile` for development builds
-   Use `npm run watch` for development builds in watch mode
-   Use `npm run test:unittests` for unit tests
-   Use `npm run lint` to check code style issues and use `npm run lint-fix` to fix issues before submitting changes
-   Use `npm run format` to check formatting issues and use `npm run format-fix` to fix formatting issues before submitting changes

## Coding Standards & Best Practices

### Code Organization Principles/Guidelines

-   **Platform Implementations**:
    -   **Desktop** (`*.node.ts`): Suffix intended for desktop implementations with full file system access, and Python environments.
    -   **Web** (`*.web.ts`): Suffix intended for web implementations with browser-compatible APIs.
    -   **Common** (`*.ts`): Suffix intended for shared logic that works across both platforms.
-   **Handle Limitations**: Gracefully degrade functionality in web environment

### Dependency Injection

-   **Interface-Based**: Always inject interfaces, not concrete classes
-   **Lifecycle Management**: Use appropriate lifetime (singleton, transient, scoped)
-   **Circular Dependencies**: Avoid circular references through careful design
-   **Testing**: Use mock implementations for unit testing

### Testing Requirements

-   Write unit tests for all new features and bug fixes
-   Unit testing with assertion library (files ending with `*.unit.test.ts`)
-   Place alongside implementation as `<filename>.unit.test.ts`
-   VS Integration testing in VS Code environment (files ending with `*.test.ts`, but not `*.unit.test.ts`)
-   Use Mocha's TDD interface (`suite`, `test`, `setup`, `teardown`)
-   Follow AAA pattern (Arrange, Act, Assert)

### Error Handling & Logging

-   All user-facing messages must use `l10n.t()` from `src/platform/common/utils/localize.ts`
-   Use typed error classes in `src/platform/errors/`
-   Use injected `ILogger` service, not console.log
-   Preserve error details for debugging while scrubbing PII
-   Use appropriate levels (trace for detailed debug, error for failures)

### Code Quality

-   All files must include Microsoft copyright header
-   Prefer async/await over Promises, handle cancellation with CancellationToken
-   Use `npm run lint` and `npm run format` to ensure code style consistency.


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

### Component-Specific Instructions

**IMPORTANT**: Before modifying any code in the directories listed below, you **MUST** first read the corresponding instruction file to understand the specific conventions, patterns, and architectural requirements for that component.

Each component has detailed guidelines that cover:
- Architecture patterns and design principles
- Code organization and file naming conventions
- Testing requirements and patterns
- Dependency injection usage
- Error handling approaches
- Component-specific best practices

#### Required Reading by Directory

| Directory/Component | Instruction File | When to Read |
|-------------------|------------------|--------------|
| `src/platform/**` | `.github/instructions/platform.instructions.md` | Before working with cross-platform abstractions, utilities, or core services |
| `src/kernels/**` | `.github/instructions/kernel.instructions.md` | Before modifying kernel management, execution, or communication logic |
| `src/kernels/jupyter/**` | `.github/instructions/kernel-jupyter.instructions.md` | Before working with Jupyter protocol implementation or Jupyter-specific features |
| `src/notebooks/**` | `.github/instructions/notebooks.instructions.md` | Before modifying notebook controllers, editing, or management features |
| `src/interactive-window/**` | `.github/instructions/interactiveWindow.instructions.md` | Before working with Python Interactive window (REPL) functionality |
| `src/standalone/**` | `.github/instructions/standalone.instructions.md` | Before modifying standalone mode or isolated execution features |
| `src/notebooks/controllers/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | Before working with IPython widget support |
| `src/webviews/extension-side/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | Before modifying extension-side widget communication |
| `src/webviews/webview-side/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | Before working with frontend widget rendering |

**For AI/Copilot**: Always use the `read_file` tool to read the relevant instruction file(s) before analyzing, modifying, or creating code in these directories. This ensures adherence to component-specific patterns and prevents architectural violations.

---

This extension is a complex, multi-layered system that provides comprehensive Jupyter notebook support within VS Code. Understanding the service architecture, contribution system, and separation between platform and extension layers is crucial for making effective changes.
