# Inversion of Control (IoC) Architecture in vscode-jupyter

## Overview

The vscode-jupyter extension implements an Inversion of Control (IoC) pattern using InversifyJS, a powerful dependency injection container for TypeScript and JavaScript applications. This document outlines the architecture, key components, and usage patterns of the IoC implementation within the codebase.

## Table of Contents

1. [Key Components](#key-components)
2. [Service Container](#service-container)
3. [Service Manager](#service-manager)
4. [Usage Patterns](#usage-patterns)

## Key Components

The IoC implementation in vscode-jupyter consists of the following key components:

- **Container**: The main InversifyJS container that manages dependencies and their lifecycles
- **ServiceContainer**: A wrapper around the InversifyJS container that provides access to services
- **ServiceManager**: Manages service registration, binding, and retrieval

## Service Container

The `ServiceContainer` class, defined in `container.ts`, wraps the InversifyJS container and implements the `IServiceContainer` interface. Key features include:

- A singleton instance accessible via `ServiceContainer.instance`
- Methods to retrieve services by their identifiers:
  - `get<T>`: Retrieves a service by its identifier
  - `getAll<T>`: Retrieves all services registered for a given identifier
  - `tryGet<T>`: Safely attempts to retrieve a service, returning undefined if not found

The `ServiceContainer` also decorates `EventEmitter` with the `@injectable()` decorator, making it available for dependency injection.

```typescript
// Example of ServiceContainer singleton access
const container = ServiceContainer.instance;
const myService = container.get<MyServiceInterface>(MyServiceSymbol);
```

## Service Manager

The `ServiceManager` class, defined in `serviceManager.ts`, provides methods for registering and managing services. Key features include:

- **Service Registration**:
  - `add<T>`: Registers a service with transient scope
  - `addSingleton<T>`: Registers a service with singleton scope
  - `addSingletonInstance<T>`: Registers an existing instance as a singleton

- **Binding Management**:
  - `addBinding<T1, T2>`: Creates a binding between two service identifiers
  - `addFactory<T>`: Registers a factory function for creating service instances

- **Service Retrieval**:
  - `get<T>`: Retrieves a service by its identifier
  - `getAll<T>`: Retrieves all services registered for a given identifier
  - `tryGet<T>`: Safely attempts to retrieve a service

- **Service Rebinding**:
  - `rebind<T>`: Replaces an existing service registration
  - `rebindSingleton<T>`: Replaces an existing singleton registration
  - `rebindInstance<T>`: Replaces an existing instance registration

The `ServiceManager` provides a comprehensive API for managing the entire lifecycle of services within the application.

```typescript
// Example of ServiceManager usage
serviceManager.addSingleton<IMyService>(Symbols.IMyService, MyServiceImplementation);
serviceManager.addSingletonInstance<IConfig>(Symbols.IConfig, config);
```

## Usage Patterns

### Service Registration

Services are typically registered during extension activation:

```typescript
// Example of service registration
const container = new Container();
const serviceManager = new ServiceManager(container);
const serviceContainer = new ServiceContainer(container);

// Register services
serviceManager.addSingleton<ILoggerService>(Symbols.ILoggerService, LoggerService);
serviceManager.addSingleton<IKernelProvider>(Symbols.IKernelProvider, KernelProvider);

// Make the service container available globally
setServiceContainer(serviceContainer);
```

### Service Consumption

Services can be consumed in two ways:

1. **Constructor Injection**: Using the `@inject` decorator from InversifyJS

```typescript
@injectable()
export class KernelProvider implements IKernelProvider {
    constructor(
        @inject(Symbols.ILoggerService) private readonly logger: ILoggerService,
        @inject(Symbols.IConfigService) private readonly config: IConfigService
    ) {}
}
```

2. **Service Locator Pattern**: Retrieving services directly from the container

```typescript
import { getServiceContainer } from '../../platform/ioc';

export function activateFeature() {
    const container = getServiceContainer();
    const logger = container.get<ILoggerService>(Symbols.ILoggerService);

    // Use the logger
}
```
