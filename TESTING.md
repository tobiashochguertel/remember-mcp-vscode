# Testing Guide

This document describes the testing infrastructure and guidelines for the Remember MCP VS Code extension.

## Test Infrastructure

### Test Framework

We use [Vitest](https://vitest.dev/) as our test framework, which provides:
- Fast test execution with native ESM support
- TypeScript support out of the box
- Jest-compatible API
- Built-in code coverage with v8
- Watch mode for iterative development

### VS Code API Mocking

Since VS Code extensions rely heavily on the VS Code API, we provide a mock implementation at `src/test/mocks/vscode-mock.ts`. This mock implements the most commonly used VS Code APIs including:

- `workspace` - Configuration and workspace folder management
- `window` - UI interactions (messages, output channels, status bar)
- `commands` - Command registration and execution
- `Uri` - File path handling
- `EventEmitter` - Event subscription
- And more...

The mock is configured in `vite.config.ts` to automatically replace `vscode` imports in tests.

## Running Tests

### Available Test Commands

```bash
# Run all tests once
npm test

# Run only unit tests
npm run test:unit

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Organization

Tests are organized in the following structure:

```
src/test/
├── mocks/
│   └── vscode-mock.ts        # VS Code API mocks
└── unit/
    └── services/
        ├── analytics-service.test.ts              # AnalyticsService tests
        └── unified-session-data-service.test.ts   # UnifiedSessionDataService tests
```

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MyService', () => {
	let service: MyService;
	let mockDependency: MockType;

	beforeEach(() => {
		// Setup mocks and service instance
		mockDependency = createMock();
		service = new MyService(mockDependency);
	});

	it('should do something', () => {
		// Arrange
		const input = 'test';

		// Act
		const result = service.doSomething(input);

		// Assert
		expect(result).toBe('expected');
	});
});
```

### Mocking Dependencies

Use Vitest's `vi.fn()` to create mock functions:

```typescript
const mockLogger = {
	info: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
};
```

### Testing Async Code

Use `async/await` in test functions:

```typescript
it('should handle async operations', async () => {
	const result = await service.asyncMethod();
	expect(result).toBeDefined();
});
```

### Testing VS Code Integration

When testing code that uses the VS Code API, the mock will automatically be used:

```typescript
import * as vscode from 'vscode';

it('should use VS Code API', () => {
	const config = vscode.workspace.getConfiguration('remember-mcp');
	expect(config).toBeDefined();
});
```

## Test Coverage

### Current Coverage

As of the last test run:
- **Overall Coverage**: ~48%
- **AnalyticsService**: ~50%
- **UnifiedSessionDataService**: ~41%

### Coverage Goals

- **Target**: 70%+ overall coverage
- **Minimum**: 50% coverage for all new code
- **Critical Services**: 80%+ coverage for core business logic

### Viewing Coverage Reports

After running `npm run test:coverage`, you can view the detailed HTML coverage report:

```bash
# The report is generated at:
./coverage/index.html
```

## Best Practices

### Do's

✅ Write tests for all new features and bug fixes
✅ Test both success and failure paths
✅ Use descriptive test names that explain what is being tested
✅ Keep tests simple and focused on one thing
✅ Mock external dependencies
✅ Clean up resources in `afterEach` hooks when needed

### Don'ts

❌ Don't test implementation details
❌ Don't write tests that depend on other tests
❌ Don't use real VS Code APIs in unit tests
❌ Don't write overly complex test setups
❌ Don't ignore failing tests

## Continuous Integration

Tests are automatically run in CI on:
- Push to `main` and `develop` branches
- Pull requests to `main` and `develop`

All tests must pass before code can be merged.

## Troubleshooting

### Tests fail with "Cannot find module 'vscode'"

Make sure `vite.config.ts` is properly configured with the vscode alias:

```typescript
alias: {
	'vscode': path.resolve(__dirname, 'src/test/mocks/vscode-mock.ts'),
}
```

### Tests timeout

Increase the test timeout in `vite.config.ts`:

```typescript
test: {
	testTimeout: 10000, // 10 seconds
}
```

### Coverage not working

Ensure `@vitest/coverage-v8` is installed:

```bash
npm install --save-dev @vitest/coverage-v8
```

## Future Improvements

- [ ] Add integration tests for VS Code API interactions
- [ ] Add E2E tests using `@vscode/test-electron`
- [ ] Increase coverage to 70%+
- [ ] Add performance benchmarks
- [ ] Set up mutation testing

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
