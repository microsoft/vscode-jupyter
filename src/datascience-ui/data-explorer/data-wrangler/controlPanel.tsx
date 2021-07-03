import * as React from 'react';
import { ISlickRow } from '../reactSlickGrid';

import './sliceControl.css';
import { IDataFrameInfo, IGetColsResponse } from '../../../client/datascience/data-viewing/types';
import { HistorySection } from './controls/HistorySection';
import { SummarySection } from './controls/SummarySection';
import { ColumnsSection } from './controls/ColumnsSection';
import { RowsSection } from './controls/RowsSection';
import { CodeSection } from './controls/CodeSection';
import { IHistoryItem } from '../../../client/datascience/data-viewing/data-wrangler/types';

interface IControlPanelProps {
    data: ISlickRow[];
    headers: string[];
    resizeEvent: Slick.Event<void>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    historyList: IHistoryItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monacoThemeObj: any;
    histogramData: IGetColsResponse;
    currentVariableName: string;
    dataframeSummary: IDataFrameInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

export class ControlPanel extends React.Component<IControlPanelProps> {
    render() {
        const columnDropdownOptions = this.generateColumnDropdownOptions();

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
                <SummarySection
                    collapsed={false}
                    histogramData={this.props.histogramData}
                    monacoThemeObj={this.props.monacoThemeObj}
                    submitCommand={this.props.submitCommand}
                    resizeEvent={this.props.resizeEvent}
                    dataframeSummary={this.props.dataframeSummary}
                />
                <ColumnsSection
                    collapsed={true}
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <RowsSection
                    collapsed={true}
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <HistorySection
                    collapsed={false}
                    historyList={this.props.historyList}
                    currentVariableName={this.props.currentVariableName}
                    submitCommand={this.props.submitCommand}
                    headers={this.props.headers}
                />
                <CodeSection
                    collapsed={false}
                    code={this.props.historyList.map((item) => item.code).join('')}
                    monacoTheme={this.props.monacoThemeObj.base}
                    currentVariableName={this.props.currentVariableName}
                    submitCommand={this.props.submitCommand}
                />
            </div>
        );
    }

    private generateColumnDropdownOptions() {
        const result = [];
        if (this.props.headers && this.props.headers.length) {
            const range = this.props.headers.length;
            for (let i = 0; i < range; i++) {
                const text = this.props.headers[i];
                if (text) {
                    result.push({ key: i, text });
                }
            }
        }
        return result;
    }
}
