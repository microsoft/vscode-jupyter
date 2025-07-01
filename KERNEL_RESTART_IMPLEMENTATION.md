# Kernel Restart Prompt Logic Implementation

## Overview

This implementation addresses Issue #16709 by modifying the "Install Packages" tool to avoid prompting for a kernel restart when no cells have been executed in the notebook.

## Problem Statement

Previously, the Install Packages tool in Jupyter notebooks would always prompt users to restart the kernel after installing packages, even when no cells had been executed. This created unnecessary friction for users who were just setting up their environment.

## Solution

### Components Implemented

1. **CellExecutionTracker Service** (`src/platform/notebooks/cellExecutionTracker.ts`)
   - Tracks whether any cells have been executed in each notebook
   - Listens to `notebookCellExecutions.onDidChangeNotebookCellExecutionState` events
   - Maintains a map of notebook URIs to execution state
   - Provides methods to check execution state and reset on kernel restart

2. **Modified InstallPackagesTool** (`src/standalone/chat/installPackageTool.node.ts`)
   - Now checks if any cells have been executed before prompting for restart
   - Only invokes the RestartKernelTool if cells have been executed
   - Provides appropriate user feedback based on execution state

3. **Modified RestartKernelTool** (`src/standalone/chat/restartKernelTool.node.ts`)
   - Resets the execution state tracker when kernel is restarted
   - Ensures clean state after manual restarts

### Key Features

- **Smart Restart Logic**: Only prompts for kernel restart when necessary
- **Clean State Management**: Properly resets execution state on kernel restart
- **Multiple Notebook Support**: Handles multiple notebooks independently
- **User-Friendly Messages**: Provides clear feedback about why restart was/wasn't needed

### Implementation Details

The solution uses the existing `notebookCellExecutions.onDidChangeNotebookCellExecutionState` event to track when cells transition to the `Idle` state with an execution order. This indicates that a cell has actually been executed (not just started).

The CellExecutionTracker service:
- Maps notebook URIs to boolean execution state
- Only marks cells as executed when they reach `Idle` state with an execution order
- Provides methods to check and reset execution state

The InstallPackagesTool now:
- Checks execution state before deciding whether to restart
- Shows different messages based on execution state
- Maintains the same functionality for cases where restart is needed

## Testing

Comprehensive unit tests cover:
- Initial state (no cells executed)
- Cell execution detection
- State reset functionality
- Multiple notebook handling
- Edge cases (cells without execution order)

## User Experience Improvements

### Before
- Always prompted for kernel restart after package installation
- Unnecessary interruption when setting up a fresh notebook

### After
- No restart prompt when no cells have been executed
- Clear messaging about why restart was/wasn't performed
- Seamless experience for new notebook setup

## Backward Compatibility

This change is fully backward compatible:
- Existing behavior preserved when cells have been executed
- No breaking changes to existing APIs
- Same restart functionality when needed

## Files Modified

1. `src/platform/notebooks/cellExecutionTracker.ts` (new)
2. `src/notebooks/types.ts` (added interface)
3. `src/standalone/chat/installPackageTool.node.ts` (modified)
4. `src/standalone/chat/restartKernelTool.node.ts` (modified)
5. `src/notebooks/serviceRegistry.node.ts` (service registration)
6. `src/standalone/chat/extension.node.ts` (dependency injection)
7. `src/test/platform/notebooks/cellExecutionTracker.unit.test.ts` (new tests)
8. `src/test/standalone/chat/installPackageTool.integration.test.ts` (new tests)

## Future Enhancements

Potential future improvements could include:
- Persistence of execution state across VS Code sessions
- Configuration options for restart behavior
- Integration with other package management tools