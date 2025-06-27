# Jupyter Extension - Copilot Instructions

This file provides repository-wide instructions for the Jupyter Extension. These guidelines help Copilot generate code, documentation, and suggestions that match the conventions, architecture, and workflows of the vscode-jupyter project.

---

## Project Overview

-   This repository is the **Jupyter extension for Visual Studio Code**. It enables rich Jupyter notebook, interactive computing, and Python data science experiences in VS Code.
-   The codebase is primarily TypeScript, with some JavaScript and Python for integration and testing.
-   The extension uses the VS Code Extension API, proposed APIs, and integrates with Jupyter, Python, and other data science tools.
-   The extension works in both desktop environments and web browsers (vscode.dev and GitHub Codespaces), providing consistent functionality across platforms.

## Key Features

-   Jupyter notebook and interactive window support in VS Code
-   Python, data science, and notebook integration
-   Rich UI, code completions, and debugging for notebooks
-   Support for multiple kernels and remote Jupyter servers
-   Export to various formats (HTML, PDF)
-   Custom renderers for various output types
-   Web-based editing support through vscode.dev and GitHub Codespaces
-   Integration with other VS Code extensions and features

## Tech Stack

-   **TypeScript**: Main language, follows VS Code coding standards
-   **Node.js**: Extension host and backend features
-   **Python**: For integration, testing, and notebook support
-   **VS Code Extension API**: Core integration, including proposed APIs
-   **ESBuild**: Bundling and compilation
-   **Mocha**: Unit testing
-   **Inversify**: Dependency injection framework

## Architecture & File Organization

-   Organize features by functionality, not technical layer
-   Separate platform services (`src/platform/`) from extension features (`src/`)
-   Place unit tests close to implementation (in files named `<filename>.unit.test.ts`)
-   Integration tests go in `src/test` folder
-   Use clear interfaces for service boundaries
-   Do not introduce breaking changes to the extension API without discussion
-   The extension uses Inversify for dependency injection in `src/platform/ioc`
-   The extension has multiple entry points for different environments:
    -   `extension.node.ts`: Node.js-specific activation logic
    -   `extension.web.ts`: Web browser-specific activation logic
-   Cross-platform support is implemented with separate files:
    -   `.node.ts` files for Node.js-specific implementations
    -   `.web.ts` files for web browser-specific implementations
    -   Regular `.ts` files for common functionality


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


## Key Entry Points for Edits

**Notebook Features**

-   `src/notebooks/`: Notebook integration and support, including:
    -   `controllers/`: Notebook controller implementations
    -   `debugger/`: Notebook debugging capabilities
    -   `export/`: Functionality for exporting notebooks
    -   `languages/`: Language-specific notebook features
    -   `outputs/`: Handling of notebook cell outputs

**Interactive Window Features**

-   `src/interactive-window/`: Interactive window features
    -   `debugger/`: Interactive window debugging capabilities
    -   `outputs/`: Handling of interactive window outputs

**Kernel and Execution**

-   `src/kernels/`: Kernel management and execution logic, including:
    -   `common/`: Shared kernel functionality
    -   `execution/`: Cell execution logic
    -   `jupyter/`: Jupyter-specific kernel implementation
    -   `raw/`: Raw kernel interface
    -   `lite/`: Lightweight kernel implementation
    -   `variables/`: Variable handling and data exploration
- Raw Kernels: This term will be used throughout the codebase to refer to kernels that are launched directly by spawning the relevant processes and ZMQ sockets used to communicate with these kernels.

**UI and Commands**

-   `src/webviews/`: Components used for communication and rendering of UI components in Web Views and Notebook Outputs (Data explorer, Variables View,Notebook Renderers, Plot viewer)

**Testing**

-   `src/test/`: Comprehensive test suite including unit, integration, and simulation tests

**Platform Services**

-   `src/platform/`: Shared platform services, including:
    -   `common/`: Common utilities and interfaces
    -   `ioc/`: Dependency injection container
    -   `logging/`: Logging infrastructure
    -   `telemetry/`: Telemetry collection

---

This extension is a complex, multi-layered system that provides comprehensive Jupyter notebook support within VS Code. Understanding the service architecture, contribution system, and separation between platform and extension layers is crucial for making effective changes.
