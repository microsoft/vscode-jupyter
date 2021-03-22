// These styles are passed to the FluentUI dropdown controls
const styleOverrides = {
    color: 'var(--vscode-dropdown-foreground) !important',
    backgroundColor: 'var(--vscode-dropdown-background) !important',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: 'var(--vscode-font-weight)',
    fontSize: 'var(--vscode-font-size)',
    opacity: 1,
    border: 'var(--vscode-dropdown-border)',
    ':focus': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':active': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':hover': {
        color: 'var(--vscode-dropdown-foreground)',
        backgroundColor: 'var(--vscode-dropdown-background)'
    }
};
export const dropdownStyles = {
    root: {
        color: 'var(--vscode-dropdown-foreground) !important'
    },
    dropdownItems: {
        ...styleOverrides,
        selectors: {
            '@media(min-width: 300px)': {
                maxHeight: 100
            }
        }
    },
    caretDown: {
        visibility: 'hidden' // Override the FluentUI caret and use ::after selector on the caretDownWrapper in order to match VS Code. See sliceContro.css
    }
};
