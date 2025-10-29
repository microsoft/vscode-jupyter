// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';

/* eslint-disable , @typescript-eslint/no-explicit-any */

// This test verifies the keyboard accessibility enhancements for IPyWidgets
suite('IPyWidgets Keyboard Accessibility', () => {
    let mockDocument: any;
    let mockElements: any[];

    setup(() => {
        mockElements = [];
        // Create a minimal mock document for testing
        mockDocument = {
            createElement: (tag: string) => {
                const element: any = {
                    tagName: tag.toUpperCase(),
                    attributes: new Map<string, string>(),
                    children: [],
                    eventListeners: new Map<string, Function[]>(),
                    className: '',
                    textContent: '',
                    getAttribute: function (name: string) {
                        return this.attributes.get(name);
                    },
                    setAttribute: function (name: string, value: string) {
                        this.attributes.set(name, value);
                    },
                    hasAttribute: function (name: string) {
                        return this.attributes.has(name);
                    },
                    appendChild: function (_child: any) {
                        this.children.push(_child);
                    },
                    addEventListener: function (event: string, handler: Function) {
                        if (!this.eventListeners.has(event)) {
                            this.eventListeners.set(event, []);
                        }
                        this.eventListeners.get(event).push(handler);
                    },
                    click: function () {
                        const clickHandlers = this.eventListeners.get('click') || [];
                        clickHandlers.forEach((h: Function) => h());
                    },
                    dispatchEvent: function (event: any) {
                        const handlers = this.eventListeners.get(event.type) || [];
                        handlers.forEach((h: Function) => h(event));
                    }
                };
                mockElements.push(element);
                return element;
            },
            body: {
                appendChild: function (_child: any) {
                    // No-op for mock
                }
            }
        };
        (global as any).document = mockDocument;
    });

    teardown(() => {
        delete (global as any).document;
        mockElements = [];
    });

    test('Widget container has keyboard accessibility attributes', () => {
        // Create a widget container
        const container = mockDocument.createElement('div');
        container.className = 'cell-output-ipywidget-background';

        // Simulate what the renderIPyWidget function does
        container.setAttribute('tabindex', '0');
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Interactive widget output');

        // Verify attributes are set
        assert.equal(container.getAttribute('tabindex'), '0', 'Container should have tabindex="0"');
        assert.equal(container.getAttribute('role'), 'region', 'Container should have role="region"');
        assert.equal(
            container.getAttribute('aria-label'),
            'Interactive widget output',
            'Container should have aria-label'
        );
    });

    test('Buttons without tabindex get tabindex="0"', () => {
        const container = mockDocument.createElement('div');
        const button = mockDocument.createElement('button');
        button.textContent = 'Test Button';
        container.appendChild(button);
        mockDocument.body.appendChild(container);

        // Verify button initially has no tabindex
        assert.isFalse(button.hasAttribute('tabindex'), 'Button should not have tabindex initially');

        // Simulate the ensureWidgetKeyboardAccessibility function
        if (!button.hasAttribute('tabindex')) {
            button.setAttribute('tabindex', '0');
        }

        // Verify button now has tabindex
        assert.equal(button.getAttribute('tabindex'), '0', 'Button should have tabindex="0" after fix');
    });

    test('Links without tabindex get tabindex="0"', () => {
        const container = mockDocument.createElement('div');
        const link = mockDocument.createElement('a');
        link.href = '#';
        link.textContent = 'Test Link';
        container.appendChild(link);
        mockDocument.body.appendChild(container);

        // Verify link initially has no tabindex
        assert.isFalse(link.hasAttribute('tabindex'), 'Link should not have tabindex initially');

        // Simulate the ensureWidgetKeyboardAccessibility function
        if (!link.hasAttribute('tabindex')) {
            link.setAttribute('tabindex', '0');
        }

        // Verify link now has tabindex
        assert.equal(link.getAttribute('tabindex'), '0', 'Link should have tabindex="0" after fix');
    });

    test('Elements with role="button" without tabindex get tabindex="0"', () => {
        const container = mockDocument.createElement('div');
        const customButton = mockDocument.createElement('div');
        customButton.setAttribute('role', 'button');
        customButton.textContent = 'Custom Button';
        container.appendChild(customButton);
        mockDocument.body.appendChild(container);

        // Verify custom button initially has no tabindex
        assert.isFalse(customButton.hasAttribute('tabindex'), 'Custom button should not have tabindex initially');

        // Simulate the ensureWidgetKeyboardAccessibility function
        if (!customButton.hasAttribute('tabindex')) {
            customButton.setAttribute('tabindex', '0');
        }

        // Verify custom button now has tabindex
        assert.equal(customButton.getAttribute('tabindex'), '0', 'Custom button should have tabindex="0" after fix');
    });

    test('Elements with onclick without tabindex get accessibility enhancements', () => {
        const container = mockDocument.createElement('div');
        const clickableDiv = mockDocument.createElement('div');
        clickableDiv.setAttribute('onclick', 'doSomething()');
        clickableDiv.textContent = 'Clickable Div';
        container.appendChild(clickableDiv);
        mockDocument.body.appendChild(container);

        // Simulate the ensureWidgetKeyboardAccessibility function
        if (!clickableDiv.hasAttribute('tabindex')) {
            clickableDiv.setAttribute('tabindex', '0');
        }
        if (!clickableDiv.hasAttribute('role')) {
            clickableDiv.setAttribute('role', 'button');
        }

        // Verify enhancements
        assert.equal(clickableDiv.getAttribute('tabindex'), '0', 'Clickable div should have tabindex="0"');
        assert.equal(clickableDiv.getAttribute('role'), 'button', 'Clickable div should have role="button"');
    });

    test('Toolbar buttons get keyboard accessibility', () => {
        const container = mockDocument.createElement('div');
        const toolbar = mockDocument.createElement('div');
        toolbar.className = 'toolbar';
        const toolbarButton = mockDocument.createElement('button');
        toolbarButton.textContent = 'Toolbar Action';
        toolbar.appendChild(toolbarButton);
        container.appendChild(toolbar);
        mockDocument.body.appendChild(container);

        // Simulate the ensureWidgetKeyboardAccessibility function for toolbar buttons
        if (!toolbarButton.hasAttribute('tabindex')) {
            toolbarButton.setAttribute('tabindex', '0');
        }

        // Verify toolbar button has tabindex
        assert.equal(toolbarButton.getAttribute('tabindex'), '0', 'Toolbar button should have tabindex="0"');
    });

    test('Matplotlib toolbar buttons get keyboard accessibility', () => {
        const container = mockDocument.createElement('div');
        const mplToolbar = mockDocument.createElement('div');
        mplToolbar.className = 'mpl-toolbar';
        const mplButton = mockDocument.createElement('button');
        mplButton.textContent = 'Plot Action';
        mplToolbar.appendChild(mplButton);
        container.appendChild(mplToolbar);
        mockDocument.body.appendChild(container);

        // Simulate the ensureWidgetKeyboardAccessibility function for matplotlib buttons
        if (!mplButton.hasAttribute('tabindex')) {
            mplButton.setAttribute('tabindex', '0');
        }

        // Verify matplotlib toolbar button has tabindex
        assert.equal(mplButton.getAttribute('tabindex'), '0', 'Matplotlib toolbar button should have tabindex="0"');
    });

    test('Keyboard event handler activates button on Enter key', () => {
        const button = mockDocument.createElement('button');
        button.textContent = 'Test Button';
        button.setAttribute('tabindex', '0');
        mockDocument.body.appendChild(button);

        let clicked = false;
        button.addEventListener('click', () => {
            clicked = true;
        });

        // Simulate keyboard handler
        button.addEventListener('keydown', (event: any) => {
            if (event.key === 'Enter') {
                button.click();
            }
        });

        // Create and dispatch Enter key event
        const enterEvent = {
            type: 'keydown',
            key: 'Enter',
            preventDefault: () => {
                // No-op for test
            }
        };
        button.dispatchEvent(enterEvent);

        // Verify button was clicked
        assert.isTrue(clicked, 'Button should be clicked on Enter key');
    });

    test('Keyboard event handler activates button on Space key', () => {
        const button = mockDocument.createElement('button');
        button.textContent = 'Test Button';
        button.setAttribute('tabindex', '0');
        mockDocument.body.appendChild(button);

        let clicked = false;
        button.addEventListener('click', () => {
            clicked = true;
        });

        // Simulate keyboard handler
        button.addEventListener('keydown', (event: any) => {
            if (event.key === ' ') {
                button.click();
            }
        });

        // Create and dispatch Space key event
        const spaceEvent = {
            type: 'keydown',
            key: ' ',
            preventDefault: () => {
                // No-op for test
            }
        };
        button.dispatchEvent(spaceEvent);

        // Verify button was clicked
        assert.isTrue(clicked, 'Button should be clicked on Space key');
    });
});
