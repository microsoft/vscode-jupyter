# Jupyter Extension - Copilot Instructions

Guidelines for generating code that matches conventions, architecture, and workflows of vscode-jupyter.

## Project Overview

Jupyter Extension for VS Code brings Jupyter notebooks to VS Code with:
- Multi-language support (Python, R, Julia, C#, etc.)
- Works in desktop VS Code, vscode.dev, and GitHub Codespaces
- Interactive computing, variable exploration, debugging, visualization

## Tech Stack

- **Core**: TypeScript, Node.js, Inversify (DI), VS Code Extension API
- **Testing**: Mocha + Chai, ts-mockito, VS Code Test Runner, Sinon
- **Commands**:
  - `npm run compile|watch` - build
  - `npm run test:unittests` - unit tests
  - `npm run lint|lint-fix` - code style
  - `npm run format|format-fix` - formatting

## Coding Standards

### Platform Implementation
- **Desktop** (`*.node.ts`): Full file system access, Python environments
- **Web** (`*.web.ts`): Browser-compatible APIs
- **Common** (`*.ts`): Shared cross-platform logic

### Dependency Injection
- Inject interfaces, not concrete classes
- Use appropriate lifecycle (singleton, transient, scoped)
- Avoid circular dependencies
- Use mocks for testing

### Testing
- Write unit tests for new features/fixes (`*.unit.test.ts`)
- Integration tests (`*.test.ts`, not `*.unit.test.ts`)
- Use Mocha TDD interface and AAA pattern

### Error Handling
- User messages via `l10n.t()` from `src/platform/common/utils/localize.ts`
- Use typed error classes in `src/platform/errors/`
- Use `ILogger` service, not console.log
- Preserve error details, scrub PII

### Code Quality
- Include Microsoft copyright header
- Prefer async/await, handle cancellation with CancellationToken
- Use lint/format tools

## Project Architecture

### Core Structure
```
build/                              # Build scripts and CI/CD tools
pythonFiles/                        # Python scripts for integration and helper functions
src/                                # Source code for the extension
├── platform/                       # Cross-platform abstractions
│   ├── common/                     # Shared utilities and interfaces
│   ├── ioc/                        # Dependency injection container
│   ├── logging/                    # Logging infrastructure
│   ├── telemetry/                  # Usage analytics
│   ├── activation/                 # Extension lifecycle management
│   ├── interpreter/                # Python environment discovery
│   ├── pythonEnvironments/         # Python environment management
│   └── webviews/                   # WebView communication layer
├── kernels/                        # Kernel management and execution
│   ├── common/                     # Shared kernel interfaces
│   ├── jupyter/                    # Jupyter protocol implementation
│   ├── raw/                        # Direct kernel process management
│   ├── execution/                  # Cell execution logic
│   ├── variables/                  # Variable inspection and data viewer
│   └── types.ts                    # Kernel-related type definitions
├── notebooks/                      # Notebook editing and management
│   ├── controllers/                # VS Code notebook controllers
│   │   └── ipywidgets/             # IPython widgets (interactive Notebook outputs)
│   ├── export/                     # Export to HTML, PDF, etc.
│   ├── debugger/                   # Notebook debugging support
│   ├── languages/                  # Language-specific features
│   └── outputs/                    # Cell output rendering
├── interactive-window/             # Python Interactive window (REPL)
│   ├── commands/                   # Interactive window commands
│   ├── debugger/                   # Interactive debugging
│   └── editor-integration/         # Integration with Python files
├── standalone/                     # Standalone features
├── webviews/                       # Rich UI components
│   ├── extension-side/             # Extension-side webview logic
│   │   └── ipywidgets/             # IPython widgets (interactive Notebook outputs) in extension-side
│   └── webview-side/               # Frontend React/HTML components
│       └── ipywidgets/             # IPython widgets (interactive Notebook outputs) in webview
└── test/                           # Integration, unit and end-to-end tests
```

### Component Instructions

**IMPORTANT**: Before modifying code in directories below, you **MUST** read the corresponding instruction file(s).

Each component has detailed guidelines that cover:
- Architecture patterns and design principles
- Code organization and file naming conventions
- Testing requirements and patterns
- Dependency injection usage
- Error handling approaches
- Component-specific best practices


| Directory | Instruction File | Purpose |
|-----------|------------------|---------|
| `src/platform/**` | `.github/instructions/platform.instructions.md` | Cross-platform abstractions |
| `src/kernels/**` | `.github/instructions/kernel.instructions.md` | Kernel management |
| `src/kernels/jupyter/**` | `.github/instructions/kernel-jupyter.instructions.md` | Jupyter protocol |
| `src/notebooks/**` | `.github/instructions/notebooks.instructions.md` | Notebook controllers |
| `src/interactive-window/**` | `.github/instructions/interactiveWindow.instructions.md` | REPL functionality |
| `src/standalone/**` | `.github/instructions/standalone.instructions.md` | Standalone features |
| `src/notebooks/controllers/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | IPython widgets (interactive Notebook outputs) |
| `src/webviews/extension-side/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | IPython Widget (interactive Notebook outputs) communication |
| `src/webviews/webview-side/ipywidgets/**` | `.github/instructions/ipywidgets.instructions.md` | IPython Widget (interactive Notebook outputs) rendering |

**For AI/Copilot**: Always read the relevant instruction file(s) before modifying code in these directories to ensure adherence to component-specific patterns.
