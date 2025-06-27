---
applyTo: 'src/interactive-window/**/*.ts'
---

# Notebooks System Architecture

The `src/notebooks` directory contains the core components responsible for notebook management, control, execution, debugging, export capabilities, and output handling in the Jupyter extension. This system provides the bridge between VS Code's notebook API and the kernel execution layer.

## Core Components Overview

### Notebook Controllers (`controllers/`)

The controller system manages the lifecycle of notebook kernel connections and provides the interface between VS Code notebooks and kernel execution:

#### Core Controller Components

- **`VSCodeNotebookController`**: The main implementation of VS Code's NotebookController API
- **`ControllerRegistration`**: Central registry for managing available notebook controllers
- **`KernelConnector`**: Handles the connection process between notebooks and kernels
- **`KernelSelector`**: Provides UI for selecting kernels for notebooks

```mermaid
classDiagram
    VSCodeNotebookController --|> IVSCodeNotebookController
    ControllerRegistration --|> IControllerRegistration
    KernelConnector --> IKernelProvider
    KernelSelector --> IKernelFinder

    class VSCodeNotebookController {
        +controller: NotebookController
        +kernelConnection: KernelConnectionMetadata
        +executeHandler()
        +interrupt()
        +dispose()
    }

    class ControllerRegistration {
        +registered: IVSCodeNotebookController[]
        +loadControllers()
        +getSelected()
        +setSelectedController()
    }

    class KernelConnector {
        +connectToKernel()
        +handleKernelError()
        +showKernelError()
    }
```

#### Kernel Source Selection (`controllers/kernelSource/`)

The kernel source selection system provides specialized UI for different types of kernel connections:

- **`LocalNotebookKernelSourceSelector`**: Selects local kernel specs
- **`LocalPythonEnvNotebookKernelSourceSelector`**: Selects Python environments
- **`RemoteNotebookKernelSourceSelector`**: Selects remote Jupyter kernels
- **`KernelSourceCommandHandler`**: Coordinates kernel source selection UI

#### Connection Display and Management

- **`ConnectionDisplayDataProvider`**: Formats kernel connection information for display
- **`PreferredKernelConnectionService`**: Manages preferred kernel selections
- **`RemoteKernelConnectionHandler`**: Handles remote kernel connection lifecycle

### Notebook Debugging (`debugger/`)

The debugging system provides comprehensive debugging support for notebook cells:

#### Core Debugging Components

- **`DebuggingManager`**: Central manager for debugging sessions
- **`KernelDebugAdapter`**: Bridges VS Code debug protocol with kernel debugging
- **`DebugLocationTracker`**: Tracks execution location during debugging

```mermaid
sequenceDiagram
    participant User as User
    participant DM as DebuggingManager
    participant DA as DebugAdapter
    participant K as Kernel
    participant UI as VS Code UI

    User->>DM: Start debugging cell
    DM->>DA: Create debug adapter
    DA->>K: Initialize debug session
    K-->>DA: Debug session ready
    DA-->>DM: Adapter created
    DM->>UI: Show debug controls

    User->>DA: Set breakpoint
    DA->>K: Set kernel breakpoint

    User->>DM: Execute cell
    DM->>K: Execute with debugging
    K-->>DA: Hit breakpoint
    DA-->>UI: Show debug state
```

#### Debugging Controllers (`debugger/controllers/`)

Specialized controllers for different debugging modes:

- **`RunByLineController`**: Implements run-by-line debugging functionality
- **`DebugCellController`**: Manages cell-level debugging
- **`RestartController`**: Handles debug session restarts

#### Debug Services

- **`JupyterDebugService`**: Provides Jupyter-specific debugging capabilities
- **`MultiplexingDebugService`**: Manages multiple debug sessions
- **`DebuggerVariables`**: Handles variable inspection during debugging

### Export System (`export/`)

The export system enables converting notebooks to various formats:

#### Export Architecture

```mermaid
flowchart TD
    NB[NotebookDocument] --> FC[FileConverter]
    FC --> EB[ExportBase]
    EB --> EU[ExportUtil]

    FC --> ETP[ExportToPython]
    FC --> ETH[ExportToHTML]
    FC --> ETPDF[ExportToPDF]

    ETP --> PY[.py file]
    ETH --> HTML[.html file]
    ETPDF --> PDF[.pdf file]

    EU --> ED[ExportDialog]
    EU --> EFO[ExportFileOpener]
```

#### Key Export Components

- **`FileConverter`**: Main coordinator for export operations
- **`ExportBase`**: Base class for export implementations (Node.js/Web variants)
- **`ExportUtil`**: Utilities for export operations
- **`ExportDialog`**: File picker UI for export destinations

#### Export Formats

- **`ExportToPython`**: Converts notebooks to Python scripts
- **`ExportToHTML`**: Exports notebooks as HTML documents
- **`ExportToPDF`**: Generates PDF versions of notebooks
- **`ExportInterpreterFinder`**: Finds appropriate Python environments for export

### Language Support (`languages/`)

Manages programming language support within notebooks:

- **`NotebookCellLanguageService`**: Manages cell language identification and switching
- **`EmptyNotebookCellLanguageService`**: Fallback service for unsupported scenarios

### Output Handling (`outputs/`)

Manages notebook cell outputs and their presentation:

- **`CellOutputMimeTypeTracker`**: Tracks and categorizes output MIME types
- **`TracebackFormatter`**: Formats Python tracebacks for display
- **`LinkProvider`**: Provides clickable links in outputs

### Service Registration

Platform-specific service registration:

- **`serviceRegistry.node.ts`**: Services for Node.js environment
- **`serviceRegistry.web.ts`**: Services for web browser environment

## Key Interfaces and Types

## Major Workflows

### Controller Selection and Connection Workflow

```mermaid
sequenceDiagram
    participant User as User/VS Code
    participant CR as ControllerRegistration
    participant KSC as KernelSourceCommandHandler
    participant KC as KernelConnector
    participant KP as KernelProvider

    User->>CR: Request kernel selection
    CR->>KSC: Show kernel picker
    KSC->>User: Display available kernels
    User->>KSC: Select kernel
    KSC->>KC: Connect to selected kernel
    KC->>KP: Get/create kernel
    KP-->>KC: Return kernel instance
    KC-->>CR: Update controller
    CR-->>User: Controller ready
```

### Cell Execution Workflow

```mermaid
sequenceDiagram
    participant UI as VS Code UI
    participant VC as VSCodeNotebookController
    participant K as Kernel
    participant CE as CellExecution

    UI->>VC: Execute cell
    VC->>K: Get kernel for notebook
    K->>CE: Create cell execution
    CE->>K: Execute code
    K-->>CE: Stream outputs
    CE-->>VC: Update cell outputs
    VC-->>UI: Display results
```

### Export Workflow

```mermaid
sequenceDiagram
    participant User as User
    participant EC as ExportCommands
    participant FC as FileConverter
    participant EB as ExportBase
    participant NE as nbconvert/Export Engine

    User->>EC: Trigger export command
    EC->>FC: Export notebook
    FC->>EB: Convert format
    EB->>NE: Execute conversion
    NE-->>EB: Return converted content
    EB-->>FC: Save to file
    FC-->>EC: Export complete
    EC-->>User: Show success/open file
```

### Debugging Workflow

```mermaid
sequenceDiagram
    participant User as User
    participant DM as DebuggingManager
    participant RBL as RunByLineController
    participant KDA as KernelDebugAdapter
    participant K as Kernel

    User->>DM: Start run-by-line debugging
    DM->>RBL: Create RBL controller
    RBL->>KDA: Set up debug adapter
    KDA->>K: Initialize debug session

    User->>RBL: Step through code
    RBL->>KDA: Send step command
    KDA->>K: Execute step
    K-->>KDA: Return debug state
    KDA-->>RBL: Update UI
    RBL-->>User: Show current line
```

## Platform-Specific Implementations

### Node.js Environment Features

- **Full Export Capabilities**: Complete nbconvert integration for all export formats
- **Python Environment Detection**: Deep integration with Python extension APIs
- **File System Access**: Direct file system operations for export and import
- **Process Management**: Can spawn external processes for export operations

### Web Environment Limitations

- **Limited Export**: Only basic export formats supported
- **Remote Operations**: Relies on remote Jupyter servers for advanced features
- **Browser APIs**: Constrained by browser security model
- **No File System**: Uses VS Code's file system abstraction

## Component Interactions

### Controller Registration Flow

1. **Discovery**: `KernelFinder` discovers available kernels
2. **Filtering**: `PythonEnvironmentFilter` applies user preferences
3. **Registration**: `ControllerRegistration` creates controllers for valid kernels
4. **Display**: `ConnectionDisplayDataProvider` formats kernel information
5. **Selection**: User selects kernel through VS Code UI
6. **Connection**: `KernelConnector` establishes kernel connection

### Export Process Flow

1. **Command**: User triggers export command
2. **Format Selection**: `ExportDialog` presents format options
3. **Conversion**: `FileConverter` coordinates the export process
4. **Engine**: `ExportBase` uses appropriate export engine (nbconvert/custom)
5. **Output**: `ExportFileOpener` handles result presentation

### Debugging Session Flow

1. **Initialization**: `DebuggingManager` sets up debug environment
2. **Adapter Creation**: `KernelDebugAdapter` bridges VS Code and kernel debugging
3. **Controller Setup**: Specialized controllers handle debug modes
4. **Execution**: Debug commands are translated to kernel operations
5. **State Management**: Debug state is synchronized with VS Code UI

## Key Extension Points

### Adding New Export Formats

1. Create new export class implementing `IExport`
2. Register in appropriate `serviceRegistry` file
3. Add format to `ExportFormat` enum
4. Update `FileConverter` to handle new format
5. Add UI elements to export quick pick

### Adding New Kernel Sources

1. Implement `ILocalNotebookKernelSourceSelector` or similar interface
2. Create UI provider for kernel selection
3. Register in `KernelSourceCommandHandler`
4. Add to service registry

### Extending Debugging Capabilities

1. Create new controller implementing `IDebuggingDelegate`
2. Add to `DebuggingManager` creation logic
3. Implement debug protocol handling
4. Register appropriate commands and UI elements

## Error Handling and Recovery

### Controller Error Handling

- **Connection Failures**: `KernelConnector` provides user-friendly error messages
- **Kernel Death**: Automatic detection and recovery options
- **Authentication Issues**: Specialized handling for remote connections

### Export Error Handling

- **Missing Dependencies**: `ExportInterpreterFinder` validates requirements
- **Conversion Failures**: Detailed error reporting with suggested fixes
- **File System Issues**: Graceful handling of permission/space issues

## Testing Architecture

### Unit Tests

- Controller logic testing with mocked dependencies
- Export format validation
- Debug adapter protocol compliance
- Service registration verification

### Integration Tests

- End-to-end controller workflows
- Export process validation
- Debug session management
- Cross-platform compatibility

This architecture provides a comprehensive foundation for notebook management in VS Code, supporting multiple execution environments, debugging capabilities, and export formats while maintaining extensibility for future enhancements.

Based on my comprehensive analysis of the VS Code Jupyter extension's notebooks system, I've created the `.github/notebooks-instructions.md` file. This file documents:

## Major Components Covered:

1. **Notebook Controllers** - Central management of kernel connections and VS Code integration
2. **Debugging System** - Comprehensive debugging support including run-by-line functionality
3. **Export System** - Multi-format export capabilities (Python, HTML, PDF)
4. **Language Support** - Programming language management within notebooks
5. **Output Handling** - Cell output processing and presentation
6. **Service Registration** - Platform-specific service organization

## Key Architectural Insights:

- **Component Interactions**: Detailed workflows showing how controllers, kernels, and debugging systems work together
- **Platform Differences**: Clear distinction between Node.js and web capabilities
- **Extension Points**: Guidance for adding new export formats, kernel sources, and debugging features
- **Error Handling**: Comprehensive error recovery strategies
- **Testing Architecture**: Both unit and integration testing approaches

## Workflow Documentation:

- Controller selection and connection process
- Cell execution flow
- Export operations from start to finish
- Debugging session management
- Cross-component communication patterns

The documentation follows the same structure as the existing kernel instructions file and provides the comprehensive context needed for working effectively with the notebooks system components. This should significantly improve development efficiency when working on notebook-related features, bugs, or enhancements.
