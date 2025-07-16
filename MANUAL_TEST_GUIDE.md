# Manual Testing Guide for Kernel Persistence During File Rename

## Overview
This guide describes how to manually test the kernel persistence feature when renaming notebook files.

## Test Setup

1. **Build the Extension**
   ```bash
   npm run compile
   ```

2. **Create Test Environment**
   - Open VS Code with the modified Jupyter extension
   - Create a new notebook file: `test_notebook.ipynb`
   - Add some test code that creates variables:
     ```python
     # Cell 1
     x = 42
     y = "Hello World"
     print(f"x = {x}, y = {y}")
     ```

## Test Scenarios

### Test 1: Basic Kernel Persistence
1. **Execute code** in the notebook to start a kernel
2. **Create variables** by running cells with variable assignments
3. **Verify kernel state** by checking the Variables view or running `%whos`
4. **Rename the file** using right-click → Rename in VS Code explorer
5. **Expected Result**: 
   - Kernel should remain connected (no restart notification)
   - Variables should still be accessible
   - No loss of execution history

### Test 2: Multiple Notebooks
1. **Open multiple notebooks** with active kernels
2. **Rename one notebook** while others are still open
3. **Expected Result**: 
   - Only the renamed notebook should migrate its kernel
   - Other notebooks should remain unaffected

### Test 3: Edge Cases
1. **Rename to different directory**: Move and rename simultaneously
2. **Rename with special characters**: Test with spaces, unicode, etc.
3. **Rename while kernel is executing**: Test during active cell execution

## Validation Points

### ✅ Success Indicators
- [ ] No kernel restart notification appears
- [ ] Variables remain accessible after rename
- [ ] Execution count continues from previous state
- [ ] No error messages in output or console
- [ ] Performance remains normal

### ❌ Failure Indicators
- [ ] "Kernel restarting" notification appears
- [ ] Variables are lost/reset
- [ ] Execution count resets to 1
- [ ] Error messages in Developer Console (`Ctrl+Shift+I`)
- [ ] Multiple kernel processes running for same notebook

## Debugging

### Check Extension Logs
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Developer: Reload Window" if needed
3. Check "Output" panel → "Jupyter" channel for debug messages
4. Look for messages containing:
   - "Preparing for notebook file rename"
   - "Migrating kernel"
   - "Successfully migrated kernel"

### Verify No Duplicate Kernels
1. Open Command Palette
2. Run "Jupyter: Show Running Kernels"
3. Verify only one kernel per notebook (not duplicates)

### Console Debugging
1. Open Developer Tools (`Ctrl+Shift+I`)
2. Check Console for any JavaScript errors
3. Check Network tab for unexpected kernel connection attempts

## Expected Log Messages
When working correctly, you should see logs like:
```
[debug] Preparing for notebook file rename from /path/old.ipynb to /path/new.ipynb
[debug] Found kernel kernel-xyz for old URI /path/old.ipynb, storing for migration
[debug] Executing kernel migration for notebook file rename from /path/old.ipynb to /path/new.ipynb
[debug] Migrating kernel kernel-xyz from old.ipynb to new.ipynb
[debug] Successfully migrated kernel in kernel provider
[debug] Successfully migrated kernel mapping in controller jupyter-kernel-xyz
```

## Rollback Testing
If the feature doesn't work as expected:
1. The behavior should gracefully fall back to the previous implementation
2. Kernels may restart (existing behavior) but shouldn't cause crashes
3. No data corruption should occur

## Performance Testing
- Renaming should be fast (< 1 second)
- No memory leaks from kernel mappings
- No accumulation of orphaned kernel processes