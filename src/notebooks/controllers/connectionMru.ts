// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const MaxMRUSizePerNotebook = 10;
// Keep the date when a connection was last used, we might need this, after all its an MRU
export type MRUItem = [lastUsed: number, connectionId: string];
