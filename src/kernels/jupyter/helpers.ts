// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const BUILTIN_JUPYTER_SERVER_PROVIDER_PREFIX = '_builtin';
export function isBuiltInJupyterServerProvider(id: string): boolean {
    return id.startsWith(BUILTIN_JUPYTER_SERVER_PROVIDER_PREFIX);
}

export function getJupyterConnectionDisplayName(token: string, baseUrl: string): string {
    const tokenString = token.length > 0 ? `?token=${token}` : '';
    return `${baseUrl}${tokenString}`;
}
