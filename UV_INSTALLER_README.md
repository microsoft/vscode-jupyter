# UV Installer Implementation

This document explains the implementation of the UV installer to fix the issue where installing kernel dependencies fails in UV venv environments.

## Problem

When using `uv venv` to create a virtual environment, the Jupyter extension attempts to install kernel dependencies using regular `pip install`, but this fails because UV-managed environments require `uv pip install` instead.

From the error logs:
```
Module pip is not installed. Output 
Module ipykernel is not installed. Output 
```

## Solution

The implementation adds a new `UvInstaller` class that:

1. **Detects UV environments** by checking:
   - Environment type is `Venv` or `VirtualEnv`
   - Environment path contains `.venv` (UV's typical pattern)
   - Pip is not available (characteristic of UV environments)

2. **Uses appropriate installation method**:
   - Primary: Python Environment Extension API's `PackageManager.manage` method
   - Fallback: Direct `uv pip install` commands

3. **Has low priority (100)** to act as a fallback when higher priority installers (like PipInstaller) are not supported

## Implementation Details

### Files Added/Modified

1. **`src/platform/interpreter/installer/types.ts`**
   - Added `ModuleInstallerType.Uv`

2. **`src/platform/interpreter/installer/uvInstaller.node.ts`**
   - New UV installer implementation
   - Detects UV environments using path patterns and pip availability
   - Uses Python Environment Extension API when available
   - Falls back to `uv pip install` commands

3. **`src/platform/interpreter/serviceRegistry.node.ts`**
   - Registered UvInstaller in the dependency injection container

4. **`src/platform/interpreter/installer/uvInstaller.unit.test.ts`**
   - Unit tests for UV installer functionality

### Priority System

The installer priority system ensures UV installer is used as a fallback:

- CondaInstaller: Priority 0-10
- PipInstaller: Priority 0
- PipEnvInstaller: Priority 0-10  
- PoetryInstaller: Priority 10
- **UvInstaller: Priority 100** (lowest)

The system tries installers by priority groups. If no installer in a higher priority group supports the environment, it moves to the next priority group.

### Detection Logic

```typescript
private async isUvEnvironment(interpreter: PythonEnvironment | Environment): Promise<boolean> {
    // 1. Check environment type (must be Venv/VirtualEnv)
    // 2. Check for UV tool in environment.tools
    // 3. Check for .venv in path (UV's typical pattern)
    // 4. Verify pip is not available (UV characteristic)
}
```

## Testing

The implementation includes unit tests that verify:

- Installer properties (name, type, priority)
- Environment detection logic
- Support detection for UV vs non-UV environments
- Execution arguments for `uv pip install`

## Expected Behavior

1. User creates UV environment: `uv venv`
2. User selects this environment in Jupyter notebook
3. User runs Python cell, triggering kernel installation
4. PipInstaller checks `isSupported()` → returns false (no pip available)
5. UvInstaller checks `isSupported()` → returns true (detects UV environment)
6. UvInstaller installs dependencies using `uv pip install`

This fixes the original error and allows UV environments to work with Jupyter notebooks.