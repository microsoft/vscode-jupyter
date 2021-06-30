import * as React from 'react';
// Need to do like this because react-plotly depends on poltly.js normally
// but we will use plotly.js-dist
import createPlotlyComponent from 'react-plotly.js/factory';
const Plotly = require('plotly.js-dist');
import { IDataFrameInfo, IGetColsResponse } from '../../../../client/datascience/data-viewing/types';
import { SidePanelSection } from './SidePanelSection';
interface IProps {
    collapsed: boolean;
    resizeEvent: Slick.Event<void>;
    histogramData?: IGetColsResponse;
    dataframeSummary: IDataFrameInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {}

const Plot = createPlotlyComponent(Plotly);

export class SummarySection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.props.resizeEvent.subscribe(() => {
            this.forceUpdate();
        });
        console.log('summary', this.props.dataframeSummary);
    }

    render() {
        const histogramComponent =
            this.props.histogramData && this.props.histogramData.cols && this.props.histogramData.cols.length > 0 ? (
                <Plot
                    style={{
                        marginLeft: '20px',
                        marginRight: '20px',
                        marginTop: '16px',
                        width: '100%',
                        height: '300px'
                    }}
                    data={[
                        {
                            x: this.props.histogramData.cols,
                            type: 'histogram'
                        }
                    ]}
                    layout={{
                        autosize: true,
                        title: 'Column: ' + this.props.histogramData.columnName,
                        plot_bgcolor: 'gray',
                        paper_bgcolor: 'gray' // TODOV: var(--vscode-editor-background) ?
                    }}
                    useResizeHandler={true}
                />
            ) : (
                <span style={{ paddingLeft: '19px', display: 'inline-block', paddingTop: '10px' }}>
                    Right click on a column to view column statistics.
                </span>
            );

        return <SidePanelSection title="SUMMARY" panel={histogramComponent} collapsed={this.props.collapsed} />;
    }
}
