import { ErrorTypes, EModelEndpoint, FileSources } from 'librechat-data-provider';
import type { TEndpoint, TCustomConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { EndpointDbMethods, ServerRequest } from '~/types';
import { initializeCustom } from './initialize';

// Mock dependencies
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    extractEnvVariable: jest.fn((value: string) => {
      // Simulate environment variable extraction
      if (value === '${A4F_API_KEY}') {
        return process.env.A4F_API_KEY || '${A4F_API_KEY}';
      }
      if (value === '${MISSING_VAR}') {
        return '${MISSING_VAR}';
      }
      return value;
    }),
  };
});

jest.mock('~/app/config', () => ({
  getCustomEndpointConfig: jest.fn(),
}));

jest.mock('~/endpoints/openai/config', () => ({
  getOpenAIConfig: jest.fn((apiKey, options) => ({
    llmConfig: {
      streaming: true,
      model: options.modelOptions?.model || 'test-model',
      apiKey,
    },
    configOptions: {
      baseURL: options.reverseProxyUrl,
    },
    tools: [],
  })),
}));

jest.mock('~/endpoints/models', () => ({
  fetchModels: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/cache', () => ({
  standardCache: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('~/utils', () => ({
  isUserProvided: jest.fn((value) => value === 'user_provided'),
  checkUserKeyExpiry: jest.fn(),
}));

import { getCustomEndpointConfig } from '~/app/config';
import { extractEnvVariable } from 'librechat-data-provider';

const mockGetCustomEndpointConfig = getCustomEndpointConfig as jest.MockedFunction<
  typeof getCustomEndpointConfig
>;
const mockExtractEnvVariable = extractEnvVariable as jest.MockedFunction<typeof extractEnvVariable>;

// Helper function to create a minimal AppConfig for testing
const createTestAppConfig = (customEndpoints: Partial<TEndpoint>[] = []): AppConfig => {
  const minimalConfig: TCustomConfig = {
    version: '1.0.0',
    cache: true,
    interface: {
      endpointsMenu: true,
    },
    registration: {
      socialLogins: [],
    },
    endpoints: {
      [EModelEndpoint.custom]: customEndpoints as TEndpoint[],
    },
  };

  return {
    config: minimalConfig,
    paths: {
      uploads: '',
      imageOutput: '',
      publicPath: '',
    },
    fileStrategy: FileSources.local,
    fileStrategies: {},
    imageOutputType: 'png',
    endpoints: minimalConfig.endpoints,
  };
};

// Helper to create mock request
const createMockRequest = (overrides: Partial<ServerRequest> = {}): ServerRequest => {
  const appConfig = createTestAppConfig();
  return {
    user: { id: 'test-user-id' },
    body: {},
    config: appConfig,
    ...overrides,
  } as ServerRequest;
};

// Helper to create mock db methods
const createMockDb = (overrides: Partial<EndpointDbMethods> = {}): EndpointDbMethods => ({
  getUserKey: jest.fn().mockResolvedValue('test-api-key'),
  getUserKeyValues: jest.fn().mockResolvedValue({ apiKey: 'user-api-key', baseURL: 'https://user-base-url.com' }),
  ...overrides,
});

// A4F endpoint configuration
const mockA4FConfig: Partial<TEndpoint> = {
  name: 'A4F',
  apiKey: '${A4F_API_KEY}',
  baseURL: 'https://api.a4f.co/v1',
  models: {
    default: ['provider-1/chatgpt-4o-latest', 'provider-3/claude-3-5-sonnet-20240620'],
    fetch: true,
  },
  titleConvo: true,
  titleModel: 'provider-1/chatgpt-4o-latest',
  modelDisplayLabel: 'A4F',
};

describe('initializeCustom', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.A4F_API_KEY;
  });

  describe('A4F endpoint initialization', () => {
    it('should throw error when A4F config is not found', async () => {
      mockGetCustomEndpointConfig.mockReturnValue(undefined);

      const req = createMockRequest();
      const db = createMockDb();

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow('Config not found for the A4F custom endpoint.');
    });

    it('should throw error when A4F_API_KEY environment variable is not set', async () => {
      // Return config but extractEnvVariable returns the unresolved variable
      mockGetCustomEndpointConfig.mockReturnValue(mockA4FConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === '${A4F_API_KEY}') {
          return '${A4F_API_KEY}'; // Unresolved - env var not set
        }
        return value;
      });

      const req = createMockRequest();
      const db = createMockDb();

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow('Missing API Key for A4F.');
    });

    it('should throw error when base URL contains unresolved environment variable', async () => {
      const configWithEnvBaseURL: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        baseURL: '${MISSING_BASE_URL}',
      };
      mockGetCustomEndpointConfig.mockReturnValue(configWithEnvBaseURL);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'valid-api-key') {
          return 'valid-api-key';
        }
        if (value === '${MISSING_BASE_URL}') {
          return '${MISSING_BASE_URL}'; // Unresolved
        }
        return value;
      });

      const req = createMockRequest();
      const db = createMockDb();

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow('Missing Base URL for A4F.');
    });

    it('should successfully initialize A4F endpoint with valid config', async () => {
      process.env.A4F_API_KEY = 'test-a4f-api-key';
      mockGetCustomEndpointConfig.mockReturnValue(mockA4FConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === '${A4F_API_KEY}') {
          return 'test-a4f-api-key';
        }
        return value;
      });

      const req = createMockRequest();
      const db = createMockDb();

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
      expect(result.llmConfig).toBeDefined();
      expect(result.llmConfig.apiKey).toBe('test-a4f-api-key');
      expect(result.configOptions?.baseURL).toBe('https://api.a4f.co/v1');
    });

    it('should handle user-provided API key for A4F', async () => {
      const userProvidedConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'user_provided',
      };
      mockGetCustomEndpointConfig.mockReturnValue(userProvidedConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'user_provided') {
          return 'user_provided';
        }
        return value;
      });

      const req = createMockRequest({
        body: { key: new Date(Date.now() + 86400000).toISOString() }, // Future expiry
      });
      const db = createMockDb({
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: 'user-provided-a4f-key',
          baseURL: undefined,
        }),
      });

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
      expect(result.llmConfig).toBeDefined();
      expect(result.llmConfig.apiKey).toBe('user-provided-a4f-key');
      expect(db.getUserKeyValues).toHaveBeenCalledWith({
        userId: 'test-user-id',
        name: 'A4F',
      });
    });

    it('should throw NO_USER_KEY error when user-provided key is missing', async () => {
      const userProvidedConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'user_provided',
      };
      mockGetCustomEndpointConfig.mockReturnValue(userProvidedConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'user_provided') {
          return 'user_provided';
        }
        return value;
      });

      const req = createMockRequest({
        body: { key: new Date(Date.now() + 86400000).toISOString() },
      });
      const db = createMockDb({
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: undefined, // No user key provided
          baseURL: undefined,
        }),
      });

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    });

    it('should handle user-provided base URL for A4F', async () => {
      const userProvidedURLConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        baseURL: 'user_provided',
      };
      mockGetCustomEndpointConfig.mockReturnValue(userProvidedURLConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'valid-api-key') {
          return 'valid-api-key';
        }
        if (value === 'user_provided') {
          return 'user_provided';
        }
        return value;
      });

      const req = createMockRequest({
        body: { key: new Date(Date.now() + 86400000).toISOString() },
      });
      const db = createMockDb({
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: undefined,
          baseURL: 'https://user-custom-url.com/v1',
        }),
      });

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
      expect(result.configOptions?.baseURL).toBe('https://user-custom-url.com/v1');
    });

    it('should throw NO_BASE_URL error when user-provided base URL is missing', async () => {
      const userProvidedURLConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        baseURL: 'user_provided',
      };
      mockGetCustomEndpointConfig.mockReturnValue(userProvidedURLConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'valid-api-key') {
          return 'valid-api-key';
        }
        if (value === 'user_provided') {
          return 'user_provided';
        }
        return value;
      });

      const req = createMockRequest({
        body: { key: new Date(Date.now() + 86400000).toISOString() },
      });
      const db = createMockDb({
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: undefined,
          baseURL: undefined, // No user base URL provided
        }),
      });

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow(JSON.stringify({ type: ErrorTypes.NO_BASE_URL }));
    });

    it('should throw error when API key is empty after extraction', async () => {
      const emptyKeyConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: '',
        baseURL: 'https://api.a4f.co/v1',
      };
      mockGetCustomEndpointConfig.mockReturnValue(emptyKeyConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => value);

      const req = createMockRequest();
      const db = createMockDb();

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow('A4F API key not provided.');
    });

    it('should throw error when base URL is empty after extraction', async () => {
      const emptyURLConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        baseURL: '',
      };
      mockGetCustomEndpointConfig.mockReturnValue(emptyURLConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => value);

      const req = createMockRequest();
      const db = createMockDb();

      await expect(
        initializeCustom({
          req,
          endpoint: 'A4F',
          db,
        }),
      ).rejects.toThrow('A4F Base URL not provided.');
    });

    it('should pass model_parameters to the result', async () => {
      process.env.A4F_API_KEY = 'test-a4f-api-key';
      mockGetCustomEndpointConfig.mockReturnValue(mockA4FConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === '${A4F_API_KEY}') {
          return 'test-a4f-api-key';
        }
        return value;
      });

      const req = createMockRequest();
      const db = createMockDb();

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        model_parameters: {
          model: 'provider-1/chatgpt-4o-latest',
          temperature: 0.7,
        },
        db,
      });

      expect(result).toBeDefined();
      expect(result.llmConfig).toBeDefined();
    });

    it('should handle both user-provided API key and base URL', async () => {
      const bothUserProvidedConfig: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'user_provided',
        baseURL: 'user_provided',
      };
      mockGetCustomEndpointConfig.mockReturnValue(bothUserProvidedConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === 'user_provided') {
          return 'user_provided';
        }
        return value;
      });

      const req = createMockRequest({
        body: { key: new Date(Date.now() + 86400000).toISOString() },
      });
      const db = createMockDb({
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: 'user-custom-api-key',
          baseURL: 'https://user-custom-url.com/v1',
        }),
      });

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
      expect(result.llmConfig.apiKey).toBe('user-custom-api-key');
      expect(result.configOptions?.baseURL).toBe('https://user-custom-url.com/v1');
    });
  });

  describe('edge cases', () => {
    it('should handle missing user id gracefully', async () => {
      process.env.A4F_API_KEY = 'test-a4f-api-key';
      mockGetCustomEndpointConfig.mockReturnValue(mockA4FConfig);
      mockExtractEnvVariable.mockImplementation((value: string) => {
        if (value === '${A4F_API_KEY}') {
          return 'test-a4f-api-key';
        }
        return value;
      });

      const req = createMockRequest({
        user: undefined,
      });
      const db = createMockDb();

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
    });

    it('should handle endpoint config with custom headers', async () => {
      const configWithHeaders: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      };
      mockGetCustomEndpointConfig.mockReturnValue(configWithHeaders);
      mockExtractEnvVariable.mockImplementation((value: string) => value);

      const req = createMockRequest();
      const db = createMockDb();

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
    });

    it('should handle endpoint config with addParams and dropParams', async () => {
      const configWithParams: Partial<TEndpoint> = {
        ...mockA4FConfig,
        apiKey: 'valid-api-key',
        addParams: {
          customParam: 'value',
        },
        dropParams: ['user'],
      };
      mockGetCustomEndpointConfig.mockReturnValue(configWithParams);
      mockExtractEnvVariable.mockImplementation((value: string) => value);

      const req = createMockRequest();
      const db = createMockDb();

      const result = await initializeCustom({
        req,
        endpoint: 'A4F',
        db,
      });

      expect(result).toBeDefined();
    });
  });
});