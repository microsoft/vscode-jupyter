import { IList, List } from '@fluentui/react';
import * as React from 'react';
import { mergeStyleSets, getTheme, normalize } from 'office-ui-fabric-react/lib/Styling';
import './HistorySection.css';
import { SidePanelSection } from './SidePanelSection';
import { DataWranglerCommands, IHistoryItem } from '../../../../client/datascience/data-viewing/data-wrangler/types';
import { getLocString } from '../../../react-common/locReactSide';

interface IProps {
    collapsed: boolean;
    currentVariableName: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    historyList: IHistoryItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    currentVariableIndex: number | undefined;
}

const theme = getTheme();
export const styles = mergeStyleSets({
    container: {
        overflow: 'auto',
        maxHeight: 300,
        marginTop: 4,
        backgroundColor: 'var(--vscode-sideBar-background) !important',
        selectors: {
            '.ms-List-cell:nth-child(odd)': {
                backgroundColor: 'var(--override-selection-background, var(--vscode-list-hoverBackground))',
                color: 'var(--vscode-list-hoverForeground)'
            },
            '.ms-List-cell:nth-child(even)': {
                backgroundColor: 'var(--vscode-sideBar-background)',
                color: 'var(--vscode-sideBar-foreground)'
            },
            '&:hover': { background: theme.palette.neutralLight }
        }
    },
    itemContent: [
        theme.fonts.medium,
        normalize,
        {
            position: 'relative',
            boxSizing: 'border-box',
            fontFamily: 'var(--vscode-font-family)',
            fontSize: 'var(--vscode-font-size)',
            fontWeight: 'var(--vscode-font-weight)',
            display: 'flex',
            paddingLeft: 10,
            paddingRight: 15
        }
    ]
});

export class HistorySection extends React.Component<IProps, IState> {
    private listRef = React.createRef<IList>();
    constructor(props: IProps) {
        super(props);
        this.state = { currentVariableIndex: 0 };
        this.viewHistoryItem = this.viewHistoryItem.bind(this);
    }

    componentDidUpdate(prevProps: IProps) {
        if (prevProps.currentVariableName !== this.props.currentVariableName) {
            // New transform applied, tell the list to rerender
            const currentVariableIndex = this.props.currentVariableName!.slice(2)
                ? parseInt(this.props.currentVariableName!.slice(2))
                : 0;
            this.setState({ currentVariableIndex });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    handleDeleteHistoryItem(index: number | undefined) {
        if (index !== undefined) {
            this.props.submitCommand({
                command: DataWranglerCommands.RemoveHistoryItem,
                args: {
                    index
                }
            });
            this.setState({ currentVariableIndex: index - 1 });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    respondToPreview(doesAccept: boolean) {
        this.props.submitCommand({
            command: DataWranglerCommands.RespondToPreview,
            args: {
                doesAccept
            }
        });
    }

    viewHistoryItem(index: number | undefined) {
        if (index !== undefined) {
            this.props.submitCommand({
                command: DataWranglerCommands.GetHistoryItem,
                args: {
                    index
                }
            });
            this.setState({ currentVariableIndex: index });
            setTimeout(() => {
                this.listRef.current?.forceUpdate();
            });
        }
    }

    onRenderCell = (item?: IHistoryItem, index?: number): JSX.Element => {
        const isCurrentStep = (this.state.currentVariableIndex ?? 0) === index!; // df1 corresponds to history item 0
        const className = styles.itemContent + ' history-item' + (isCurrentStep ? ' selected-history-item' : '');
        return (
            <div data-is-focusable>
                <div className={className} style={{ paddingBottom: '4px', paddingTop: '2px' }}>
                    <div
                        style={{ flexGrow: 1 }}
                        onClick={() => this.viewHistoryItem(index)}
                        title={getLocString(
                            'DataScience.dataWranglerViewIntermediateState',
                            'Click to view intermediate state'
                        )}
                    >
                        <span style={{ verticalAlign: 'middle', width: '100%' }}>{item?.description}</span>
                        {item?.isPreview && (
                            <span
                                style={{
                                    verticalAlign: 'bottom',
                                    width: '100%',
                                    color: 'var(--vscode-descriptionForeground)',
                                    fontSize: '10px'
                                }}
                            >
                                &nbsp;&nbsp;&nbsp;{getLocString('DataScience.dataWranglerPreview', 'Preview')}
                            </span>
                        )}
                    </div>

                    {index !== 0 && item?.isPreview && (
                        <>
                            <div
                                className="codicon codicon-check codicon-button"
                                onClick={() => this.respondToPreview(true)}
                                style={{ verticalAlign: 'middle' }}
                                title={getLocString('DataScience.dataWranglerAcceptStep', 'Accept Step')}
                            />
                            <div
                                className="codicon codicon-close codicon-button"
                                onClick={() => this.respondToPreview(false)}
                                style={{ verticalAlign: 'middle' }}
                                title={getLocString('DataScience.dataWranglerRejectStep', 'Reject Step')}
                            />
                        </>
                    )}
                    {/* Need to check that it is the latest operation that is not preview */}
                    {index !== 0 && this.props.historyList.length - 1 === index && !item?.isPreview && (
                        <div
                            className="codicon codicon-discard codicon-button show-on-hover"
                            onClick={() => this.handleDeleteHistoryItem(index)}
                            style={{ verticalAlign: 'middle' }}
                            title={getLocString('DataScience.dataWranglerRemoveStep', 'Remove Step')}
                        />
                    )}
                </div>
            </div>
        );
    };

    render() {
        const historyComponent =
            this.props.historyList.length > 0 ? (
                <div className={styles.container} data-is-scrollable>
                    <List
                        componentRef={this.listRef}
                        items={this.props.historyList}
                        style={{ marginLeft: '5px' }}
                        className="historyList"
                        onRenderCell={this.onRenderCell}
                    />
                </div>
            ) : (
                <span style={{ paddingLeft: '19px', display: 'inline-block', paddingTop: '10px' }}>
                    No transformations applied.
                </span>
            );

        return (
            <SidePanelSection
                title={getLocString('DataScience.dataWranglerPanelHistory', 'HISTORY')}
                panel={historyComponent}
                collapsed={this.props.collapsed}
                height={'100px'}
            />
        );
    }
}
