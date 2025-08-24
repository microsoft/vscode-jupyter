---
applyTo: '**'
---

# VS Code Jupyter Extension

Jupyter Extension for Visual Studio Code - TypeScript-based VS Code extension providing comprehensive Jupyter notebook support and interactive Python execution capabilities.

**CRITICAL**: Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Environment Setup
- **Node.js Version**: Requires Node.js 22.15.1 (see `.nvmrc`), but 20.x also works
- **NPM Version**: Uses npm 10.9.2
- **Python Version**: Python 3.12 required for development and testing

### Bootstrap and Build Commands
Execute these commands in sequence to set up the development environment:

```bash
npm install          # Install dependencies - takes 15-20 seconds
npm run compile      # Compile TypeScript + ESBuild - takes 25 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
npm run test:unittests   # Run unit tests - takes 8 seconds. NEVER CANCEL. Set timeout to 30+ minutes.
```

### Core Development Commands
- **Build (development)**: `npm run compile` - TypeScript + ESBuild compilation
- **Build (production)**: `npm run build` - Optimized build for packaging
- **Watch mode**: `npm run watch` - Continuous compilation during development
- **Clean**: `npm run clean` - Clean all build artifacts

### Testing Commands
- **Unit tests**: `npm run test:unittests` - Fast unit tests (8 seconds)
- **Integration tests**: `npm run test:integration` - Requires VS Code download (fails in CI without network)
- **Python script tests**: `python3 -m pythonFiles.tests` (requires pytest setup)

### Code Quality Commands  
- **Linting**: `npm run lint` - ESLint validation (30 seconds)
- **Formatting check**: `npm run format` - Prettier formatting validation (15 seconds)
- **Formatting fix**: `npm run format-fix` - Auto-fix formatting issues (15 seconds)

## Validation Requirements

### CRITICAL Build and Test Timing
- **NEVER CANCEL** any build or test commands - builds may take 30+ seconds, tests may take several minutes
- **Build timeout**: Set minimum 60 minutes for build commands
- **Test timeout**: Set minimum 30 minutes for test commands
- **npm install**: Takes 15-20 seconds with postinstall scripts
- **Compilation**: Takes 20-30 seconds for full build
- **Unit tests**: Takes 8 seconds for 1159 tests

### Pre-Commit Validation
**ALWAYS** run these commands before committing changes:
```bash
npm run format-fix   # Auto-fix formatting issues
npm run lint        # Check for linting issues  
npm run test:unittests  # Validate unit tests pass
```

### Manual Testing Scenarios
After making code changes, **ALWAYS** test these workflows:
1. **Extension Loading**: Launch extension in VS Code using F5 (Extension debug configuration)
2. **Notebook Creation**: Create new Jupyter notebook via Command Palette
3. **Kernel Selection**: Select and connect to a Python kernel
4. **Cell Execution**: Execute a simple Python cell with `print("Hello World")`
5. **Interactive Window**: Run Python code in Interactive Window (Shift+Enter)

Read `.github/typescript-instructions.md` for detailed TypeScript development steps.

## Repository Structure

### Key Source Directories
- `src/platform/` - Cross-platform abstractions and core services
- `src/kernels/` - Kernel management, discovery, and execution  
- `src/notebooks/` - Notebook UI controllers and management
- `src/interactive-window/` - Python Interactive window (REPL)
- `src/standalone/` - Standalone features and API endpoints
- `src/webviews/` - React-based UI components for data viewers

### Important Files
- `package.json` - Main package configuration and npm scripts
- `.vscode/tasks.json` - VS Code build tasks and configurations
- `.vscode/launch.json` - Debug configurations for extension development
- `tsconfig.json` - TypeScript compiler configuration
- `gulpfile.js` - Gulp build tasks and utilities

### Build Output
- `out/` - TypeScript compilation output
- `dist/` - ESBuild bundled output for distribution

## Development Workflow

### Standard Development Process
1. **Setup**: `npm install` (if dependencies changed)
2. **Development**: 
   - Run `npm run watch` for continuous compilation
   - Launch VS Code extension with F5 (uses Extension launch configuration)
   - Make code changes and test in the extension host
3. **Testing**: `npm run test:unittests` to validate changes
4. **Quality**: `npm run lint && npm run format-fix` before committing

### Debugging the Extension
- **Extension Host**: Use "Extension" launch configuration in VS Code
- **Web Extension**: Use "Extension (web)" launch configuration  
- **Debug Variables**: Set `XVSC_JUPYTER_FORCE_LOGGING=1` for debug output
- **Kernel Debug**: Set `XDEBUGPY_LOG_DIR` for kernel debugging logs

### Working with Kernels
- Local kernels use ZeroMQ for communication (Node.js only)
- Remote kernels use HTTP/WebSocket via Jupyter protocol
- Web extension supports remote kernels only
- Kernel discovery happens through multiple finder services

## Platform Differences

### Desktop (Node.js) Features
- Full kernel support including raw/local kernels
- Complete debugging capabilities
- File system access for notebooks and data export
- Python environment discovery and management
- ZeroMQ communication for local kernels

### Web Extension Limitations
- Remote Jupyter kernels only (no local kernel support)
- Limited debugging capabilities
- Browser-based file API restrictions
- HTTP/WebSocket communication only

## Common Issues and Solutions

### Build Failures
- **TypeScript errors**: Check "Core - Build" and "Unittest - Build" task outputs
- **Missing dependencies**: Run `npm install` if package.json changed
- **Clean build**: Run `npm run clean && npm run compile`

### Test Failures
- **Unit test failures**: Check for TypeScript compilation errors first
- **Integration test issues**: Require VS Code download and network access
- **Python test setup**: Install `pytest` for Python script testing

### Extension Loading Issues
- **Build first**: Always run `npm run compile` before debugging
- **Check logs**: Enable debug logging with environment variables
- **Restart VS Code**: Extension host issues may require VS Code restart

## Architecture Notes

### Key Systems
- **Kernel System**: Manages Python/Jupyter kernel connections and execution
- **Notebook System**: VS Code notebook controller integration
- **Interactive Window**: REPL-like Python execution environment  
- **IPyWidgets**: Interactive widget rendering and communication
- **Variable Explorer**: Data inspection and visualization tools

### Extension Points
- Kernel finders for discovering available kernels
- Export formats for notebook conversion
- Variable viewers for custom data types
- Server providers for remote Jupyter connections

### Cross-Platform Design
- Platform abstraction layer in `src/platform/`
- Separate service registrations for Node.js vs Web
- Unified interfaces with platform-specific implementations
- Dependency injection throughout the codebase

## Integration Dependencies

### VS Code APIs
- Notebook API for notebook document management
- Extension Host API for extension lifecycle
- Webview API for custom UI components
- Debug Protocol for notebook debugging

### External Libraries
- `@jupyterlab/services` for Jupyter protocol communication
- `zeromq` for local kernel communication (Node.js only)
- React ecosystem for webview UI components
- TypeScript for type safety and development

Always validate your changes work correctly by running the extension in VS Code and testing notebook functionality end-to-end.

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
