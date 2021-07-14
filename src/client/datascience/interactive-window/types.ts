// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookEditor, Uri } from 'vscode';

export type INativeInteractiveWindow = { notebookEditor: NotebookEditor; inputUri: Uri };
