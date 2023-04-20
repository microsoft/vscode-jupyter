// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '../../../platform/common/types';
import { Event } from 'vscode';
import { SharedMessages } from '../../../messageTypes';

export namespace PlotViewerMessages {
    export const Started = SharedMessages.Started;
    export const UpdateSettings = SharedMessages.UpdateSettings;
    export const SendPlot = 'send_plot';
    export const CopyPlot = 'copy_plot';
    export const ExportPlot = 'export_plot';
    export const RemovePlot = 'remove_plot';
}

export interface IExportPlotRequest {
    svg: string;
    png: string;
}

// Map all messages to specific payloads
export class IPlotViewerMapping {
    public [PlotViewerMessages.Started]: never | undefined;
    public [PlotViewerMessages.UpdateSettings]: string;
    public [PlotViewerMessages.SendPlot]: string;
    public [PlotViewerMessages.CopyPlot]: string;
    public [PlotViewerMessages.ExportPlot]: IExportPlotRequest;
    public [PlotViewerMessages.RemovePlot]: number;
}

export const IPlotViewerProvider = Symbol('IPlotViewerProvider');
export interface IPlotViewerProvider {
    showPlot(imageHtml: string): Promise<void>;
}
export const IPlotViewer = Symbol('IPlotViewer');

export interface IPlotViewer extends IDisposable {
    closed: Event<IPlotViewer>;
    removed: Event<number>;
    addPlot(imageHtml: string): Promise<void>;
    show(): Promise<void>;
}
