---
applyTo: '**'
---

# Jupyter Extension - Copilot Instructions

This file contains key information to help AI assistants work more efficiently with the VS Code Jupyter codebase.

## Build & Test Workflow
1. **Compile**: `npm run compile` (required before testing code changes)
2. **Run specific tests**: `npm run test:unittests -- --grep "pattern"`
3. **Linting**: `npm run lint` to check for linter issues
4. **Formatting**: `npm run format` to check code style, `npm run lint-fix` to auto-fix issues

## Coding Standards

### Platform Implementation
- **Desktop** (`*.node.ts`): Full file system access, Python environments
- **Web** (`*.web.ts`): Browser-compatible APIs
- **Common** (`*.ts`): Shared cross-platform logic

### Dependency Injection
- Inject interfaces, not concrete classes
- Avoid circular dependencies

### Testing
- Unit tests in `*.unit.test.ts`
- Integration tests in `*.test.ts` (not `*.unit.test.ts`)
- Look for existing test patterns before creating new structures

### User Messages
- Use `l10n.t()` for user facing strings
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
