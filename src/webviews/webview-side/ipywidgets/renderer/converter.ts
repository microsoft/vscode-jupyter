// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OutputItem } from 'vscode-notebook-renderer';

// Extracted function for testing - doesn't import styles.css
export function convertVSCodeOutputToExecuteResultOrDisplayData(outputItem: OutputItem): any | undefined {
    try {
        // Try to parse as JSON first if the mime type suggests JSON content
        if (outputItem.mime.toLowerCase().includes('json')) {
            const data = outputItem.json();
            // Check if this looks like widget model data - it should have a model_id
            if (data && typeof data === 'object' && 'model_id' in data) {
                return data;
            }
            // If it's JSON but not widget data, return undefined to fallback
            return undefined;
        }

        // For non-JSON content, try to parse text as JSON (for edge cases)
        const textData = outputItem.text();
        if (textData) {
            try {
                const parsed = JSON.parse(textData);
                // Only return if it looks like widget model data
                if (parsed && typeof parsed === 'object' && 'model_id' in parsed) {
                    return parsed;
                }
            } catch {
                // Not valid JSON, this is regular text content - not widget data
            }
        }
        
        // If we get here, this is not widget model data
        return undefined;
    } catch (error) {
        // If any parsing fails, this is not widget data
        return undefined;
    }
}