// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export function getJupyterConnectionDisplayName(token: string, baseUrl: string): string {
    const tokenString = token.length > 0 ? `?token=${token}` : '';
    return `${baseUrl}${tokenString}`;
}
