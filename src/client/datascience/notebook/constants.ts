// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export const JupyterNotebookView = 'jupyter-notebook';
export const JupyterNotebookImageRenderer = 'jupyter-notebook-image-renderer';
export const RendererExtensionId = 'ms-toolsai.notebook-renderers';
export const RendererExtensionDownloadUri = 'https://aka.ms/NotebookRendererDownloadLink';
export const InteractiveWindowView = 'interactive';
export type OpenImageInPlotViewer = {
    type: 'openImageInPlotViewer';
    outputId: string;
    mimeType: string;
};
export type SaveImageAs = {
    type: 'saveImageAs';
    outputId: string;
    mimeType: string;
};
