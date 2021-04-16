import { List } from '@fluentui/react';
import * as React from 'react';
import { mergeStyleSets, getTheme, normalize } from 'office-ui-fabric-react/lib/Styling';
import './HistorySection.css';

interface IProps {
    headers: string[];
    historyList: any[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
}

const theme = getTheme();
export const styles = mergeStyleSets({
    container: {
      overflow: 'auto',
      maxHeight: 300,
      marginTop: 4,
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
        borderLeft: '3px solid ' + theme.palette.themePrimary,
        paddingLeft: 15,
        paddingRight: 15,
      },
    ],
  });

export class HistorySection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.viewHistoryItem = this.viewHistoryItem.bind(this);
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
        }
    }

    onRenderCell = (item?: any, index?: number): JSX.Element => {
        return (
          <div data-is-focusable>
            <div 
                className={styles.itemContent + " history-item"}
                style={{ paddingBottom: '4px', paddingTop: '2px' }}
                onClick={() => this.viewHistoryItem(index)}>
                {/* <div
                    className="codicon codicon-close codicon-button"
                    onClick={this.handleDeleteHistoryItem}
                    style={{ verticalAlign: 'middle' }}
                    title={"Remove step"}
                /> */}
                <span style={{ verticalAlign: 'middle' }}>{item.name}</span>
            </div>
          </div>
        );
      };

    //TODO add the ability to X and delete list items
    render() {
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
                    <span className="slice-summary-detail">{'HISTORY'}</span>
                </summary>
                  {this.props.historyList.length > 0 ? 
                    <div className={styles.container} data-is-scrollable>
                      <List
                          items={this.props.historyList}
                          style={{ }}
                          className="historyList"
                          onRenderCell={this.onRenderCell}
                      /> 
                    </div>
                    : <span style={{ paddingLeft: '19px' }}>No transformations applied.</span>}
            </details>
        );
    }
}
