// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { mock, instance, when } from 'ts-mockito';
import { NotebookCell, NotebookCellOutput, NotebookCellOutputItem, NotebookDocument } from 'vscode';
import { IDisposableRegistry } from '../../../platform/common/types';
import { PlotViewHandler } from './plotViewHandler';
import { PlotViewCommandRegistry } from './plotViewCommandRegistry';

suite('PlotViewCommandRegistry', () => {
    let commandRegistry: PlotViewCommandRegistry;
    let mockDisposables: IDisposableRegistry;
    let mockPlotViewHandler: PlotViewHandler;

    setup(() => {
        mockDisposables = mock<IDisposableRegistry>();
        mockPlotViewHandler = mock<PlotViewHandler>();

        commandRegistry = new PlotViewCommandRegistry(instance(mockDisposables), instance(mockPlotViewHandler));
    });

    test('should find image outputs in cell', () => {
        // Create mock notebook cell with image output
        const mockNotebook = mock<NotebookDocument>();
        const mockCell = mock<NotebookCell>();
        const mockOutput = mock<NotebookCellOutput>();
        const mockOutputItem = mock<NotebookCellOutputItem>();

        when(mockOutputItem.mime).thenReturn('image/png');
        when(mockOutput.id).thenReturn('test-output-id');
        when(mockOutput.items).thenReturn([instance(mockOutputItem)]);
        when(mockCell.outputs).thenReturn([instance(mockOutput)]);
        when(mockCell.notebook).thenReturn(instance(mockNotebook));

        // Use reflection to access private method for testing
        const findImageOutputs = (commandRegistry as any).findImageOutputs.bind(commandRegistry);
        const result = findImageOutputs(instance(mockCell));

        expect(result).to.have.length(1);
        expect(result[0].outputId).to.equal('test-output-id');
        expect(result[0].mimeType).to.equal('image/png');
    });

    test('should return empty array when no image outputs found', () => {
        // Create mock notebook cell with non-image output
        const mockCell = mock<NotebookCell>();
        const mockOutput = mock<NotebookCellOutput>();
        const mockOutputItem = mock<NotebookCellOutputItem>();

        when(mockOutputItem.mime).thenReturn('text/plain');
        when(mockOutput.id).thenReturn('test-output-id');
        when(mockOutput.items).thenReturn([instance(mockOutputItem)]);
        when(mockCell.outputs).thenReturn([instance(mockOutput)]);

        const findImageOutputs = (commandRegistry as any).findImageOutputs.bind(commandRegistry);
        const result = findImageOutputs(instance(mockCell));

        expect(result).to.have.length(0);
    });

    test('should find multiple image outputs', () => {
        // Create mock notebook cell with multiple image outputs
        const mockCell = mock<NotebookCell>();
        const mockOutput = mock<NotebookCellOutput>();
        const mockPngItem = mock<NotebookCellOutputItem>();
        const mockJpegItem = mock<NotebookCellOutputItem>();

        when(mockPngItem.mime).thenReturn('image/png');
        when(mockJpegItem.mime).thenReturn('image/jpeg');
        when(mockOutput.id).thenReturn('test-output-id');
        when(mockOutput.items).thenReturn([instance(mockPngItem), instance(mockJpegItem)]);
        when(mockCell.outputs).thenReturn([instance(mockOutput)]);

        const findImageOutputs = (commandRegistry as any).findImageOutputs.bind(commandRegistry);
        const result = findImageOutputs(instance(mockCell));

        expect(result).to.have.length(2);
        expect(result[0].mimeType).to.equal('image/png');
        expect(result[1].mimeType).to.equal('image/jpeg');
    });
});
