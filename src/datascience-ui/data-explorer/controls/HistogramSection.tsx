import * as React from 'react';
import Plot from 'react-plotly.js';
import { IGetColsResponse } from '../../../client/datascience/data-viewing/types';

interface IProps {
    headers: string[];
    histogramData: IGetColsResponse;
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
}

export class HistogramSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
    }

    render() {
        console.log(this.props.histogramData);
        return (
            <details
				open
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px'
                }}
            >
                <summary className="slice-summary">
                    <span className="slice-summary-detail">{'HISTOGRAM'}</span>
                </summary>
                <Plot
                    data={[
                        {
                          x: this.props.histogramData.cols,
                          type: 'histogram'
                        }
                      ]}
                    layout={{ autosize: true, title: 'Column: ' + this.props.histogramData.columnName}}
                    useResizeHandler={true}
                />
            </details>
        );
    }
}
