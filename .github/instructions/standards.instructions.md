---
applyTo: 'src/**/*.ts'
---

# TypeScript Coding Standards for VS Code Jupyter Extension

### Forbidden Patterns

-   **No use of `__dirname` or `__filename`** in non-`.node.ts` files
-   **No use of `process.env`** in non-`.node.ts` files
-   **No use of `fsPath`** property in non-`.node.ts` files
-   These restrictions are enforced by custom ESLint rules

### Module Dependencies

Strict architectural boundaries are enforced via ESLint rules:

-   **`src/platform/`**: No imports from non-platform modules
-   **`src/kernels/`**: Can only import from `platform/` and `telemetry/`
-   **`src/notebooks/`**: Can import from `platform/`, `telemetry/`, and `kernels/`
-   **`src/interactive-window/`**: Can import from `platform/`, `telemetry/`, `kernels/`, and `notebooks/`
-   **`src/webviews/`**: Cannot be imported into core components
-   **`src/standalone/`**: Cannot be imported into other components

### Localization Requirements

All user-facing messages must use localization:

```typescript
import { l10n } from '../platform/common/utils/localize';

// Correct
throw new Error(l10n.t('Failed to start kernel: {0}', kernelName));

// Incorrect - hardcoded string
throw new Error('Failed to start kernel');
```

### Async Error Handling

Always handle Promise rejections:

```typescript
// Correct
try {
    await someAsyncOperation();
} catch (error) {
    logger.error('Operation failed', error);
    throw new ProcessingError(l10n.t('Failed to process: {0}', error.message));
}

// Correct with void
void someAsyncOperation().catch((error) => {
    logger.error('Background operation failed', error);
});
```

### Unit Test Structure

Use Mocha TDD interface with proper naming:

```typescript
// kernelProvider.unit.test.ts
import { assert } from 'chai';
import { mock, instance, when, verify } from 'ts-mockito';

suite('Kernel Provider', () => {
    let kernelProvider: KernelProvider;
    let mockKernelFinder: IKernelFinder;

    setup(() => {
        mockKernelFinder = mock<IKernelFinder>();
        kernelProvider = new KernelProvider(instance(mockKernelFinder));
    });

    test('Should create kernel when valid metadata provided', async () => {
        // Arrange
        const metadata = createKernelMetadata();
        when(mockKernelFinder.kernels).thenReturn([metadata]);

        // Act
        const kernel = await kernelProvider.getOrCreate(notebook, metadata);

        // Assert
        assert.isOk(kernel);
        verify(mockKernelFinder.kernels).once();
    });
});
```

### Test File Placement

-   **Unit tests**: Place `*.unit.test.ts` files alongside implementation
-   **Integration tests**: Place in `src/test/` directory
