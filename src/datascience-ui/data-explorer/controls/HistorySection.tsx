import { IList, List } from '@fluentui/react';
import * as React from 'react';
import { mergeStyleSets, getTheme, normalize } from 'office-ui-fabric-react/lib/Styling';
import './HistorySection.css';

interface IProps {
    headers: string[];
    currentVariableName: string | undefined;
    historyList: any[];
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
      backgroundColor: "var(--vscode-sideBar-background) !important",
      selectors: {
        '.ms-List-cell:nth-child(odd)': {
          backgroundColor: "var(--override-selection-background, var(--vscode-list-hoverBackground))",
          color: "var(--vscode-list-hoverForeground)",
        },
        '.ms-List-cell:nth-child(even)': {
          backgroundColor: "var(--vscode-sideBar-background)",
          color: "var(--vscode-sideBar-foreground)"
        },
        '&:hover': { background: theme.palette.neutralLight },
      },
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
        display: 'inline-block',
        paddingLeft: 15,
        paddingRight: 15,
      },
    ],
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
        this.setState({ currentVariableIndex: parseInt(this.props.currentVariableName!.slice(2)) });
        setTimeout(() => {
          this.listRef.current?.forceUpdate();
        })
      }
    }

    handleDeleteHistoryItem( ) {

    }

    viewHistoryItem(index: number | undefined) {
        if (index !== undefined) {
          this.props.submitCommand({
              command: 'get_history_item',
              args: {
                  index: index
              }
          });
          this.setState({ currentVariableIndex: -1 });
          setTimeout(() => {
            this.listRef.current?.forceUpdate();
          })
        }
    }

    onRenderCell = (item?: any, index?: number): JSX.Element => {
      const isCurrentStep = this.state.currentVariableIndex === (index! + 1); // df1 corresponds to history item 0
        const className = styles.itemContent + " history-item" + (isCurrentStep ? " selected-history-item" : "");
        return (
          <div data-is-focusable>
            <div 
                className={className}
                style={{ paddingBottom: '4px', paddingTop: '2px' }}
                onClick={() => this.viewHistoryItem(index)}>
                {/* <div
                    className="codicon codicon-close codicon-button"
                    onClick={this.handleDeleteHistoryItem}
                    style={{ verticalAlign: 'middle' }}
                    title={"Remove step"}
                /> */}
                <span style={{ verticalAlign: 'middle' }} title={`Click to view intermediate state`} >{item.name}</span>
            </div>
          </div>
        );
      };

    render() {
        return (
          <details
                open  
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                }}
            >
                <summary className="slice-summary">
                    <span className="slice-summary-detail">{'HISTORY'}</span>
                </summary>
                  {this.props.historyList.length > 0 ? 
                    <div className={styles.container} style={{ paddingTop: '10px' }} data-is-scrollable>
                      <List
                          componentRef={this.listRef}
                          items={this.props.historyList}
                          style={{ }}
                          className="historyList"
                          onRenderCell={this.onRenderCell}
                      /> 
                    </div>
                    : <span style={{ paddingLeft: '19px', display: 'inline-block', paddingTop: '10px' }}>No transformations applied.</span>}
            </details>
        );
    }
}
