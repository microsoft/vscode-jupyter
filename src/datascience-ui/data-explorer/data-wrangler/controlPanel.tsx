import * as React from 'react';
import { ISlickRow } from '../reactSlickGrid';

import './sliceControl.css';
import { IDataFrameInfo, IGetColsResponse } from '../../../client/datascience/data-viewing/types';
import { HistorySection } from './controls/HistorySection';
import { SummarySection } from './controls/SummarySection';
import { ColumnsSection } from './controls/ColumnsSection';
import { RowsSection } from './controls/RowsSection';
import { CodeSection } from './controls/CodeSection';
import { IHistoryItem, SidePanelSections } from '../../../client/datascience/data-viewing/data-wrangler/types';

interface IControlPanelProps {
    data: ISlickRow[];
    headers: string[];
    resizeEvent: Slick.Event<void>;

    historyList: IHistoryItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monacoThemeObj: any;
    histogramData: IGetColsResponse | undefined;
    currentVariableName: string;
    dataframeSummary: IDataFrameInfo;
    sidePanels: SidePanelSections[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;

    primarySelectedColumn?: string;
    selectedColumns: string[];
    setSelectedColumns(selectedColumns: string[], primarySelectedColumn?: string | undefined): void;
    setSelectedRows(selectedRows: number[], primarySelectedRow?: number | undefined): void;
}

export class ControlPanel extends React.Component<IControlPanelProps> {
    render() {
        const columnDropdownOptions = this.generateColumnDropdownOptions();
        const showSummary = this.props.sidePanels?.includes(SidePanelSections.Summary);
        const showColumns = this.props.sidePanels?.includes(SidePanelSections.Columns);
        const showRows = this.props.sidePanels?.includes(SidePanelSections.Rows);
        const showHistory = this.props.sidePanels?.includes(SidePanelSections.History);
        const showCode = this.props.sidePanels?.includes(SidePanelSections.Code);

        return (
            <div
                style={{
                    resize: 'horizontal',
                    height: '100%',
                    zIndex: 99999,
                    overflowX: 'hidden',
                    overflowY: 'scroll',
                    border: '1px solid var(--vscode-sideBar-border)',
                    color: 'var(--vscode-sideBar-foreground)',
                    backgroundColor: 'var(--vscode-sideBar-background)'
                }}
            >
                {showSummary && (
                    <SummarySection
                        collapsed={false}
                        histogramData={this.props.histogramData}
                        monacoThemeObj={this.props.monacoThemeObj}
                        submitCommand={this.props.submitCommand}
                        resizeEvent={this.props.resizeEvent}
                        dataframeSummary={this.props.dataframeSummary}
                        selectedColumns={this.props.selectedColumns}
                    />
                )}
                {showColumns && (
                    <ColumnsSection
                        collapsed={true}
                        submitCommand={this.props.submitCommand}
                        options={columnDropdownOptions}
                        selectedColumns={this.props.selectedColumns}
                        primarySelectedColumn={this.props.primarySelectedColumn}
                        setSelectedColumns={this.props.setSelectedColumns}
                        setSelectedRows={this.props.setSelectedRows}
                    />
                )}
                {showRows && (
                    <RowsSection
                        collapsed={true}
                        submitCommand={this.props.submitCommand}
                        options={columnDropdownOptions}
                        setSelectedColumns={this.props.setSelectedColumns}
                        setSelectedRows={this.props.setSelectedRows}
                    />
                )}
                {showHistory && (
                    <HistorySection
                        collapsed={false}
                        historyList={this.props.historyList}
                        currentVariableName={this.props.currentVariableName}
                        submitCommand={this.props.submitCommand}
                    />
                )}
                {showCode && (
                    <CodeSection
                        collapsed={false}
                        code={this.props.historyList.map((item) => item.code).join('')}
                        monacoTheme={this.props.monacoThemeObj.base}
                        currentVariableName={this.props.currentVariableName}
                        submitCommand={this.props.submitCommand}
                    />
                )}
            </div>
        );
    }

    private generateColumnDropdownOptions() {
        return this.props.headers ? this.props.headers.map((col) => ({ key: col, text: col })) : [];
    }
}
