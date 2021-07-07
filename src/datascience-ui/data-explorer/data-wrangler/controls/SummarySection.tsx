import * as React from 'react';
// Need to do like this because react-plotly depends on poltly.js normally
// but we will use plotly.js-dist
import createPlotlyComponent from 'react-plotly.js/factory';
const Plotly = require('plotly.js-dist');
import {
    IDataFrameColumnInfo,
    IDataFrameInfo,
    IGetColsResponse
} from '../../../../client/datascience/data-viewing/types';
import { SidePanelSection } from './SidePanelSection';
import { summaryChildRowStyle, summaryInnerRowStyle, summaryRowStyle } from './styles';

interface ISummarySectionProps {
    collapsed: boolean;
    resizeEvent: Slick.Event<void>;
    histogramData?: IGetColsResponse;
    dataframeSummary: IDataFrameInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monacoThemeObj: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IDataframeColumnSummaryProps {
    columnSummary?: IDataFrameColumnInfo;
    shape: string;
    rowCount: number;
}

interface ISummaryRowProps {
    name: string;
    value: string | number | undefined;
    child?: boolean;
}

interface IInnerRowsProps {
    children: ISummaryRowProps[];
}

interface ISummaryTitleProps {
    name: string;
    canClose: boolean;
}

interface IHistogramProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    themeObj: any;
}

interface IState {}

const Plot = createPlotlyComponent(Plotly);

class SummaryRow extends React.Component<ISummaryRowProps> {
    render() {
        return (
            <div style={this.props.child ? summaryChildRowStyle : summaryRowStyle}>
                <span>{this.props.name}</span>
                <span>{this.props.value}</span>
            </div>
        );
    }
}

class SummaryTitle extends React.Component<ISummaryTitleProps> {
    render() {
        return (
            <div style={{...summaryRowStyle, fontWeight: 'bold'}}>
                <span>Column: {this.props.name}</span>
                {this.props.canClose && (
                    <div
                        className="codicon codicon-close codicon-button"
                        onClick={() => {console.log('button clicked');}}
                        style={{ verticalAlign: 'middle' }}
                        title={'Close column summary'}
                    />
                )}
            </div>
        );
    }
}

class InnerRows extends React.Component<IInnerRowsProps> {
    render() {
        return (
            <div style={summaryInnerRowStyle}>
                {this.props.children.map((c) => (
                    <SummaryRow key={c.name} child={true} name={c.name} value={c.value} />
                ))}
            </div>
        );
    }
}

class ColumnSummary extends React.Component<IDataframeColumnSummaryProps> {
    render() {
        if (!this.props.columnSummary) {
            return <></>;
        }
        return (
            <div>
                <SummaryTitle name={this.props.columnSummary.key} canClose={true} />
                <SummaryRow name={'Data frame shape'} value={this.props.shape} />
                <SummaryRow name={'Unique values'} value={this.props.columnSummary.uniqueCount} />
                <SummaryRow name={'Rows'} value={this.props.rowCount} />
                <InnerRows
                    children={[
                        { name: '# Missing value', value: this.props.columnSummary.missingCount },
                        {
                            name: '% Missing values',
                            value: calculatePercent(
                                this.props.columnSummary.missingCount ?? 0,
                                this.props.rowCount ?? 0
                            )
                        }
                    ]}
                />
                {/* Only shows up for numerical columns */}
                {this.props.columnSummary.statistics && (
                    <>
                        <SummaryRow name={'Statistics'} value={undefined} />
                        <InnerRows
                            children={[
                                { name: 'Average', value: this.props.columnSummary.statistics.average },
                                { name: 'Median', value: this.props.columnSummary.statistics.median },
                                { name: 'Min', value: this.props.columnSummary.statistics.min },
                                { name: 'Max', value: this.props.columnSummary.statistics.max },
                                { name: 'Standard deviation', value: this.props.columnSummary.statistics.sd }
                            ]}
                        />
                    </>
                )}
                {/* Only shows up for string/object columns */}
                {this.props.columnSummary.mostFrequentValue && (
                    <>
                        <SummaryRow name={'Most frequent'} value={this.props.columnSummary.mostFrequentValue} />
                        <InnerRows
                            children={[
                                { name: '# Occurences', value: this.props.columnSummary.mostFrequentValueAppearances }
                            ]}
                        />
                    </>
                )}
            </div>
        );
    }
}

class DataframeSummary extends React.Component<IDataFrameInfo> {
    render() {
        return (
            <div>
                <SummaryRow name={'Data frame shape'} value={shapeAsString(this.props.shape)} />
                <SummaryRow name={'Columns'} value={this.props.columns?.length} />
                <SummaryRow name={'Rows'} value={this.props.rowCount} />
                <InnerRows
                    children={[
                        { name: '# Missing value', value: this.props.missingValuesRowsCount },
                        {
                            name: '% Missing values',
                            value: calculatePercent(this.props.missingValuesRowsCount ?? 0, this.props.rowCount ?? 0)
                        },
                        { name: '# Duplicate rows', value: this.props.duplicateRowsCount },
                        {
                            name: '% Rows with duplicates',
                            value: calculatePercent(this.props.duplicateRowsCount ?? 0, this.props.rowCount ?? 0)
                        }
                    ]}
                />
                <SummaryRow name={'Missing values'} value={this.props.missingValuesRowsCount} />
                <InnerRows children={getColumnsWithMissingValues(this.props.columns ?? [])} />
            </div>
        );
    }
}

export class Histogram extends React.Component<IHistogramProps> {
    render() {
        const layout = {
            autosize: true,
            margin: {
                t: 50,
                b: 50,
                l: 50,
                r: 50,
                pad: 10
            },
            // colorway: [this.props.themeObj.colors['sideBarTitle.foreground']],
            plot_bgcolor: this.props.themeObj.colors['editor.background'],
            paper_bgcolor: this.props.themeObj.colors['editor.background'],
            font: {
                color: this.props.themeObj.colors['editor.foreground']
            }
        } as Plotly.Layout;

        return (
            <div style={{marginRight: '15px', paddingRight: '15px'}}>
                <Plot
                    style={{
                        marginLeft: '20px',
                        marginRight: '20px',
                        marginTop: '16px',
                        width: '100%',
                        height: '250px'
                    }}
                    data={[
                        {
                            x: this.props.data,
                            type: 'histogram'
                        }
                    ]}

                    layout={layout}
                    useResizeHandler={true}
                />
            </div>
        );
    }
}

export class SummarySection extends React.Component<ISummarySectionProps, IState> {
    constructor(props: ISummarySectionProps) {
        super(props);
        this.props.resizeEvent.subscribe(() => {
            this.forceUpdate();
        });
    }

    render() {
        const columnInfos = this.props.dataframeSummary.columns?.filter(
            (c) => c.key === this.props.histogramData?.columnName
        );
        let columnInfo;
        if (columnInfos && columnInfos.length > 0) {
            columnInfo = columnInfos[0];
        }

        const summaryComponent = columnInfo ? (
            <>
                <ColumnSummary
                    columnSummary={columnInfo}
                    shape={shapeAsString(this.props.dataframeSummary.shape)}
                    rowCount={this.props.dataframeSummary.rowCount ?? 0}
                />
                {this.props.histogramData && this.props.histogramData.cols.length > 0 && (
                    <Histogram data={this.props.histogramData.cols} themeObj={this.props.monacoThemeObj} />
                )}
            </>
        ) : (
            <DataframeSummary {...this.props.dataframeSummary} />
        );

        return <SidePanelSection title="SUMMARY" panel={summaryComponent} collapsed={this.props.collapsed} />;
    }
}

function shapeAsString(shape: number[] | undefined) {
    return shape ? shape.join(' x ') : 'Error calculating shape';
}

function calculatePercent(partialValue: number, totalValue: number) {
    if (totalValue === 0) {
        return '100%';
    }
    // Convert it to a float with 1 decimal point then cast it as number to get rid of any trailing zeros if there are some
    return Number(((partialValue / totalValue) * 100).toFixed(2)).toString() + '%';
}

function getColumnsWithMissingValues(cols: IDataFrameColumnInfo[]): ISummaryRowProps[] {
    // Filters for columns that have missing values then sorts them by who is missing the most
    const resultCols = cols
        .filter((col) => col.missingCount && col.missingCount > 0)
        ?.map((col) => ({ name: col.key, value: col.missingCount } as ISummaryRowProps))
        .sort((a, b) => (b.value as number) - (a.value as number));
    return resultCols;
}
