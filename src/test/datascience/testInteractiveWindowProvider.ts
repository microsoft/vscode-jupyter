// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// export interface ITestInteractiveWindowProvider extends IInteractiveWindowProvider {
//     getMountedWebView(window: IInteractiveWindow | undefined): IMountedWebView;
//     waitForMessage(identity: Uri | undefined, message: string, options?: WaitForMessageOptions): Promise<void>;
// }

// @injectable()
// export class TestInteractiveWindowProvider extends InteractiveWindowProvider implements ITestInteractiveWindowProvider {
//     private windowToMountMap = new Map<string, IMountedWebView>();
//     private pendingMessageWaits: {
//         message: string;
//         options?: WaitForMessageOptions;
//         deferred: Deferred<void>;
//     }[] = [];

//     constructor(
//         @inject(IServiceContainer) private readonly container: IServiceContainer,
//         @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
//         @inject(IDisposableRegistry) disposables: IDisposableRegistry,
//         @inject(IFileSystem) fileSystem: IFileSystem,
//         @inject(IConfigurationService) configService: IConfigurationService,
//         @inject(IMemento) @named(GLOBAL_MEMENTO) globalMemento: Memento,
//         @inject(types.IApplicationShell) appShell: types.IApplicationShell,
//         @inject(types.IWorkspaceService) worksapce: types.IWorkspaceService
//     ) {
//         super(container, asyncRegistry, disposables, fileSystem, configService, globalMemento, appShell, worksapce);

//         // Reset our identity IDs when we create a new TestInteractiveWindowProvider
//         resetIdentity();
//     }

//     public getMountedWebView(window: IInteractiveWindow | undefined): IMountedWebView {
//         const key = window ? window.identity.toString() : this.windows[0]?.identity.toString();
//         if (!this.windowToMountMap.has(key)) {
//             throw new Error('Test Failure: Window not mounted yet.');
//         }
//         return this.windowToMountMap.get(key)!;
//     }

//     public waitForMessage(identity: Uri | undefined, message: string, options?: WaitForMessageOptions): Promise<void> {
//         // We may already have this editor. Check. Undefined may also match.
//         const key = identity ? identity.toString() : this.windows[0] ? this.windows[0].identity.toString() : undefined;
//         if (key && this.windowToMountMap.has(key)) {
//             return this.windowToMountMap.get(key)!.waitForMessage(message, options);
//         }

//         // Otherwise pend for the next create.
//         this.pendingMessageWaits.push({ message, options, deferred: createDeferred() });
//         return this.pendingMessageWaits[this.pendingMessageWaits.length - 1].deferred.promise;
//     }

//     protected create(resource: Resource, mode: InteractiveWindowMode): InteractiveWindow {
//         // Generate the mount wrapper using a custom id
//         const id = uuid();
//         const mounted = this.container
//             .get<DataScienceIocContainer>(DataScienceIocContainer)
//             .createWebView(() => mountConnectedMainPanel('interactive'), id);

//         // Might have a pending wait for message
//         if (this.pendingMessageWaits.length) {
//             const list = [...this.pendingMessageWaits];
//             this.pendingMessageWaits = [];
//             list.forEach((p) => {
//                 mounted
//                     .waitForMessage(p.message, p.options)
//                     .then(() => {
//                         p.deferred.resolve();
//                     })
//                     .catch((e) => p.deferred.reject(e));
//             });
//         }

//         // Call the real create
//         const result = super.create(resource, mode);

//         // Associate the real create with our id in order to find the wrapper
//         const key = result.identity.toString();
//         this.windowToMountMap.set(key, mounted);
//         mounted.onDisposed(() => this.windowToMountMap.delete(key));

//         // Also need the css request so that other messages can go through
//         const webHost = result as InteractiveWindow;
//         webHost.setTheme(false);

//         return result;
//     }
// }
