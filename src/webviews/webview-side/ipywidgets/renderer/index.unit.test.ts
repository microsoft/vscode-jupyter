// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { OutputItem } from 'vscode-notebook-renderer';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock the OutputItem interface for testing
class MockOutputItem implements OutputItem {
    constructor(
        public id: string,
        public mime: string,
        private _data: any,
        public metadata: Record<string, any> = {}
    ) {}

    json(): any {
        if (this.mime.toLowerCase().includes('json')) {
            return this._data;
        }
        throw new Error('Not JSON data');
    }

    text(): string {
        return typeof this._data === 'string' ? this._data : JSON.stringify(this._data);
    }

    blob(): Blob {
        throw new Error('Not implemented');
    }

    data(): Uint8Array {
        throw new Error('Not implemented');
    }
}

// Import the function we want to test
import { convertVSCodeOutputToExecuteResultOrDisplayData } from './converter';

suite('IPyWidget Renderer - convertVSCodeOutputToExecuteResultOrDisplayData', () => {
    test('Should return widget data when JSON contains model_id', () => {
        const widgetData = {
            model_id: 'test-widget-123',
            version_major: 2,
            version_minor: 0,
            state: { value: 42 }
        };

        const outputItem = new MockOutputItem('test-1', 'application/vnd.jupyter.widget-view+json', widgetData);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.deepEqual(result, widgetData);
    });

    test('Should return undefined when JSON does not contain model_id', () => {
        const nonWidgetData = {
            content: '<div>Some HTML content</div>',
            metadata: {}
        };

        const outputItem = new MockOutputItem('test-2', 'application/json', nonWidgetData);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should return widget data when text contains valid widget JSON', () => {
        const widgetData = {
            model_id: 'text-widget-456',
            version_major: 2,
            version_minor: 0,
            state: { text: 'Hello World' }
        };

        const outputItem = new MockOutputItem('test-3', 'text/plain', JSON.stringify(widgetData));
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.deepEqual(result, widgetData);
    });

    test('Should return undefined when text contains non-widget JSON', () => {
        const nonWidgetData = {
            content: 'Some content',
            type: 'text'
        };

        const outputItem = new MockOutputItem('test-4', 'text/plain', JSON.stringify(nonWidgetData));
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should return undefined when text is not valid JSON', () => {
        const plainText = '<div>Some HTML content</div>';

        const outputItem = new MockOutputItem('test-5', 'text/html', plainText);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should return undefined when text is regular plain text', () => {
        const plainText = 'This is just plain text content';

        const outputItem = new MockOutputItem('test-6', 'text/plain', plainText);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should handle empty data gracefully', () => {
        const outputItem = new MockOutputItem('test-7', 'application/json', null);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should handle invalid JSON gracefully', () => {
        // Create a mock that throws an error on json() call
        const outputItem = new MockOutputItem('test-8', 'application/json', 'invalid-json');
        // Override json method to throw
        outputItem.json = () => {
            throw new Error('Invalid JSON');
        };
        
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should return widget data for append_display_data widget output', () => {
        // This tests the specific case from the issue - append_display_data creates
        // outputs that should be processed as widget data when they contain model_id
        const appendDisplayData = {
            model_id: 'output-widget-789',
            version_major: 2,
            version_minor: 0,
            state: {
                outputs: [
                    {
                        output_type: 'display_data',
                        data: {
                            'text/html': '<div style="color: green;">Content added via append_display_data</div>'
                        }
                    }
                ]
            }
        };

        const outputItem = new MockOutputItem('test-9', 'application/vnd.jupyter.widget-view+json', appendDisplayData);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.deepEqual(result, appendDisplayData);
        assert.isNotNull(result);
        assert.equal((result as any).model_id, 'output-widget-789');
    });

    test('Should return undefined for regular HTML content from append_display_data', () => {
        // This tests the case where append_display_data creates regular HTML/text content
        // that should NOT be processed by the widget renderer
        const regularContent = '<div style="color: blue;">Regular HTML content</div>';

        const outputItem = new MockOutputItem('test-10', 'text/html', regularContent);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.isUndefined(result);
    });

    test('Should handle widget data with complex nested structures', () => {
        const complexWidgetData = {
            model_id: 'complex-widget-999',
            version_major: 2,
            version_minor: 0,
            state: {
                children: ['IPY_MODEL_child1', 'IPY_MODEL_child2'],
                layout: {
                    width: '100%',
                    height: '200px'
                },
                style: {
                    background_color: '#ffffff'
                }
            }
        };

        const outputItem = new MockOutputItem('test-11', 'application/vnd.jupyter.widget-view+json', complexWidgetData);
        const result = convertVSCodeOutputToExecuteResultOrDisplayData(outputItem);

        assert.deepEqual(result, complexWidgetData);
        assert.isNotNull(result);
        assert.equal((result as any).model_id, 'complex-widget-999');
        assert.deepEqual((result as any).state.children, ['IPY_MODEL_child1', 'IPY_MODEL_child2']);
    });
});