// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const renderersAndMimetypes = new Map<string, string[]>([
    // Ability to render nested outputs widgets.
    // I.e. Jupyter Labl widget manager must be able to render a widget as well, not just regular mimetypes.
    ['jupyter-ipywidget-renderer', ['application/vnd.jupyter.widget-view+json']],
    // https://github.com/microsoft/vscode-notebook-renderers/blob/homely-louse/package.json#L80
    [
        'jupyter-notebook-renderer',
        [
            'image/gif',
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/svg+xml',
            'application/geo+json',
            'application/vdom.v1+json',
            'application/vnd.dataresource+json',
            'application/vnd.plotly.v1+json',
            'application/vnd.vega.v2+json',
            'application/vnd.vega.v3+json',
            'application/vnd.vega.v4+json',
            'application/vnd.vegalite.v1+json',
            'application/vnd.vegalite.v2+json',
            'application/x-nteract-model-debug+json',
            'text/vnd.plotly.v1+html'
        ]
    ],
    // Built in extensions in core.
    ['vscode.markdown-it-renderer', ['text/markdown', 'text/latex', 'application/json']],
    // Built in extensions in core.
    [
        'vscode.builtin-renderer',
        [
            'image/git',
            'text/html',
            'application/javascript',
            'application/vnd.code.notebook.error',
            'application/vnd.code.notebook.stdout',
            'application/vnd.code.notebook.stderr',
            'application/x.notebook.stdout',
            'application/x.notebook.stream',
            'application/x.notebook.stderr',
            'text/plain'
        ]
    ]
]);
