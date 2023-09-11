# Installation

`npm install @vscode/jupyter`

# Summary

First we need to define a `package.json` for the extension that wants to use the API:
(https://github.com/Microsoft/vscode-jupyter).

# Requirements

User is expected to install type definitions for VS Code via `@types/vscode` or `@vscode-dts` or other.
See [here](https://code.visualstudio.com/api/get-started/your-first-extension) for more information on creating your first VS Code.

See [here](https://code.visualstudio.com/api/references/vscode-api#extensions) for more information on consuming Extension APIs.

# Sample

```typescript
import { extensions } from 'vscode';
import type { JupyterAPI } from '@vscode/jupyter';

const jupyterApi = extensions.getExtension<JupyterAPI>('ms-jupyter.jupyter')?.exports;
```

